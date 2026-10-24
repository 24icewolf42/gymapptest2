// Workout history: { "YYYY-MM-DD": [ { day, exercises: [{ name, target, sets: [{ w, r, done }] }], time, duration } ] }
// Pure functions, no DOM or storage.
import { mondayIndex, addDays, ymd } from '../core/dates.js';

// Markup characters in names and values become look-alikes: the original app
// puts them into the page unescaped (see plain() in plan.js).
const LOOKALIKE = { '<': '‹', '>': '›', '"': '”', '`': '’' };
const plain = (s) => s.replace(/[<>"`]/g, (c) => LOOKALIKE[c]);
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Id for a session the original app keys by its full JSON (no id, no time).
 * A short hash of that key: the key itself contains quotes, which the
 * database refuses in workout history. The original app's tombstone for the
 * session hashes to the same id (see mergeLogs).
 */
function legacyId(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 'l' + (h >>> 0).toString(36) + key.length.toString(36);
}

/**
 * Identity of a logged session, shared with the original app so deletions
 * sync between both versions: the session id, or date|workout|time for
 * sessions saved before ids existed.
 */
export function sessionKey(date, s) {
  if (s.id) return s.id;
  return s.time ? date + '|' + s.day + '|' + s.time : date + '|' + s.day + '|' + JSON.stringify(s);
}

/** New session id. */
export function newSessionId() {
  return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

const validDate = (y, m, d) => {
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? ymd(dt) : null;
};

/**
 * Turns the date formats older versions and imports produced ("2026-10-23",
 * "23.10.2026", "10/23/2026", epoch timestamps, ISO times) into YYYY-MM-DD.
 * Falls back to the session's own date or time. Returns null if nothing fits.
 */
export function canonicalLogDate(raw, session) {
  const candidates = [raw, session && (session.date || session.dateStr || session.date_key), session && (session.time || session.timestamp || session.createdAt || session.created_at)];
  for (const value of candidates) {
    if (value == null || value === '') continue;
    const str = String(value).trim();
    let m = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) { const r = validDate(+m[1], +m[2], +m[3]); if (r) return r; }
    m = str.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})$/);
    if (m) {
      const a = +m[1], b = +m[2];
      // Day first unless that is impossible (matches the original app).
      const [d, mo] = b > 12 ? [b, a] : [a, b];
      const r = validDate(+m[3], mo, d);
      if (r) return r;
    }
    if (/^\d{10,13}$/.test(str)) {
      const dt = new Date(str.length === 10 ? +str * 1000 : +str);
      if (!Number.isNaN(dt.getTime())) return ymd(dt);
    }
  }
  return null;
}

function cleanSet(s) {
  if (!s || typeof s !== 'object') return null;
  return { w: plain(String(s.w ?? '')).slice(0, 12), r: plain(String(s.r ?? '')).slice(0, 12), done: !!s.done };
}

function cleanSession(s) {
  if (!s || typeof s !== 'object' || typeof s.day !== 'string' || !s.day) return null;
  const exercises = (Array.isArray(s.exercises) ? s.exercises : [])
    .filter((e) => e && typeof e.name === 'string')
    .map((e) => ({ name: plain(e.name).slice(0, 80), target: plain(String(e.target ?? '')).slice(0, 20), sets: (Array.isArray(e.sets) ? e.sets : []).map(cleanSet).filter(Boolean) }));
  const out = { day: plain(s.day).slice(0, 40), exercises, time: typeof s.time === 'string' && ISO_TIME.test(s.time) ? s.time : '' };
  // An id that is an original-app key (date|day|JSON, stored by an earlier version) becomes its hash.
  if (typeof s.id === 'string' && s.id) out.id = s.id.includes('|') ? legacyId(s.id) : s.id.slice(0, 64);
  if (Number.isFinite(+s.duration) && +s.duration >= 0) out.duration = Math.round(+s.duration);
  return out;
}

const byTime = (a, b) => (Date.parse(a.time) || 0) - (Date.parse(b.time) || 0);

/**
 * Validates and normalises history: well-formed sessions only, keyed by a real
 * calendar date, oldest first. Accepts the object form and the array form
 * some older backups used.
 */
export function sanitizeLogs(source) {
  const out = {};
  if (!source || typeof source !== 'object') return out;
  const entries = Array.isArray(source)
    ? source.map((s, i) => [s && (s.date || s.dateStr || s.time) || 'undated-' + i, [s]])
    : Object.keys(source).map((date) => [date, Array.isArray(source[date]) ? source[date] : []]);
  entries.forEach(([raw, sessions]) => sessions.forEach((s) => {
    const clean = cleanSession(s);
    const date = clean && canonicalLogDate(raw, s);
    if (!date) return;
    // Without id or time the original app keys a session by its full JSON; the
    // id is derived from that key, so deletions match between both versions.
    if (!clean.id && !clean.time) clean.id = legacyId(date + '|' + s.day + '|' + JSON.stringify(s));
    (out[date] || (out[date] = [])).push(clean);
  }));
  Object.values(out).forEach((list) => list.sort(byTime));
  return out;
}

/**
 * Merges two histories. The same session (same key) keeps its most recently
 * saved copy. Sessions listed in `deleted`, or saved on a date before that date
 * was cleared (`deletedDates`, ms or ISO), are dropped. Tombstones come from
 * both this phone and the cloud, so a deletion on any device sticks.
 */
export function mergeLogs(remote, local, { deleted = [], deletedDates = {} } = {}) {
  // The original app's tombstones for JSON-keyed sessions match by their hash.
  const gone = new Set(deleted.flatMap((k) => (typeof k === 'string' && k.includes('|{') ? [k, legacyId(k)] : [k])));
  const merged = {};
  [sanitizeLogs(remote), sanitizeLogs(local)].forEach((logs) => Object.keys(logs).forEach((date) => logs[date].forEach((s) => {
    const key = sessionKey(date, s);
    if (gone.has(key)) return;
    const clearedAt = Number(deletedDates[date]) || Date.parse(deletedDates[date]) || 0;
    if (clearedAt && (Date.parse(s.time) || 0) <= clearedAt) return;
    const list = merged[date] || (merged[date] = []);
    const i = list.findIndex((x) => sessionKey(date, x) === key);
    if (i < 0) list.push(s);
    else if ((Date.parse(s.time) || 0) >= (Date.parse(list[i].time) || 0)) list[i] = s;
  })));
  Object.values(merged).forEach((list) => list.sort(byTime));
  return merged;
}

/** Per-day totals, written to the cloud for the original app's calendar. */
export function dailySummaries(logs) {
  const days = {};
  Object.keys(logs).forEach((date) => {
    const sessions = logs[date] || [];
    if (!sessions.length) return;
    const d = days[date] = { workouts: sessions.length, total_seconds: 0, volume_kg_reps: 0 };
    sessions.forEach((s) => {
      d.total_seconds += Math.max(0, Number(s.duration) || 0);
      (s.exercises || []).forEach((e) => (e.sets || []).forEach((x) => { d.volume_kg_reps += (parseFloat(x.w) || 0) * (parseFloat(x.r) || 0); }));
    });
    d.volume_kg_reps = Math.round(d.volume_kg_reps);
  });
  return days;
}

export function eachSession(logs, fn) {
  Object.keys(logs).sort().forEach((date) => (logs[date] || []).forEach((s) => fn(s, date)));
}

export function totals(logs, monthPrefix) {
  let workouts = 0, month = 0, seconds = 0;
  eachSession(logs, (s, date) => {
    workouts++;
    if (date.startsWith(monthPrefix)) month++;
    seconds += s.duration || 0;
  });
  return { workouts, month, seconds };
}

const num = (v) => parseFloat(v) || 0;

/** Heaviest logged weight per session, oldest first. */
export function liftPoints(logs, name) {
  const out = [];
  eachSession(logs, (s, date) => (s.exercises || []).forEach((e) => {
    if (e.name !== name) return;
    const best = (e.sets || []).reduce((m, x) => Math.max(m, num(x.w)), 0);
    const reps = (e.sets || []).filter((x) => num(x.w) === best).reduce((m, x) => Math.max(m, num(x.r)), 0);
    if (best > 0) out.push({ date, w: best, r: reps });
  }));
  return out;
}

export function bestWeight(logs, name) {
  return liftPoints(logs, name).reduce((m, p) => Math.max(m, p.w), 0);
}

export function exerciseNames(logs) {
  const names = new Set();
  eachSession(logs, (s) => (s.exercises || []).forEach((e) => { if ((e.sets || []).some((x) => num(x.w) > 0)) names.add(e.name); }));
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** Aggregates published to the friends leaderboard. */
export function leaderboardStats(logs) {
  let workouts = 0, volume = 0, seconds = 0;
  eachSession(logs, (s) => {
    workouts++;
    seconds += Math.max(0, Number(s.duration) || 0);
    (s.exercises || []).forEach((e) => (e.sets || []).forEach((x) => { volume += num(x.w) * num(x.r); }));
  });
  return { workouts_count: workouts, volume_kg_reps: Math.round(volume), total_seconds: seconds };
}

/**
 * Consecutive scheduled training days that were logged or marked as bypass.
 * Rest days never break the streak; today does not break it until it is over.
 */
export function streak(logs, bypass, schedule, today = new Date()) {
  let count = 0;
  // Scan until the streak breaks (ten years at most), like bestStreak.
  for (let i = 0; i < 3660; i++) {
    const d = addDays(today, -i);
    if (!schedule[mondayIndex(d.getDay())]) continue;
    const ds = ymd(d);
    if ((logs[ds] && logs[ds].length) || bypass[ds]) count++;
    else if (i === 0) continue;
    else break;
  }
  return count;
}

/** Longest run of scheduled days that were trained or bypassed, up to today. */
export function bestStreak(logs, bypass, schedule, today = new Date()) {
  const active = new Set([...Object.keys(logs).filter((d) => logs[d] && logs[d].length), ...Object.keys(bypass).filter((d) => bypass[d])]);
  const first = [...active].sort()[0];
  if (!first) return 0;
  let best = 0, run = 0;
  const [y, m, d] = first.split('-').map(Number);
  for (let day = new Date(y, m - 1, d); day <= today; day = addDays(day, 1)) {
    if (!schedule[mondayIndex(day.getDay())]) continue;
    if (active.has(ymd(day))) best = Math.max(best, ++run);
    else if (ymd(day) !== ymd(today)) run = 0;
  }
  return best;
}

/** Last-used kg/reps per exercise, without trailing empty rows. */
export function trimSets(sets) {
  const a = (sets || []).map((x) => ({ w: String(x.w ?? ''), r: String(x.r ?? '') }));
  while (a.length && a[a.length - 1].w === '' && a[a.length - 1].r === '') a.pop();
  return a;
}

/**
 * Older versions keyed last-used values as "Workout||Exercise". Values are now
 * shared by every workout, keyed by exercise name. The newest log wins.
 */
export function upgradeLastUsed(lastUsed, logs, draft) {
  const keys = Object.keys(lastUsed || {});
  const bare = (k) => { const i = k.indexOf('||'); return i >= 0 ? k.slice(i + 2) : k; };
  const out = {};
  keys.forEach((k) => { out[bare(k)] = lastUsed[k]; });
  if (!keys.some((k) => k.includes('||'))) return { lastUsed: out, changed: false };
  eachSession(logs, (s) => (s.exercises || []).forEach((e) => { const a = trimSets(e.sets); if (a.length) out[e.name] = { sets: a }; }));
  if (draft && draft.ex) Object.keys(draft.ex).forEach((n) => { const a = trimSets(draft.ex[n]); if (a.length) out[n] = { sets: a }; });
  return { lastUsed: out, changed: true };
}

/**
 * Last-used values from two devices: per exercise the most recently changed
 * entry wins (updatedAt, as the original app stores it); ties keep this phone's.
 */
export function mergeProgress(remote, local) {
  const out = {};
  const clean = (v) => (v && Array.isArray(v.sets) ? { sets: trimSets(v.sets), updatedAt: Number(v.updatedAt) || 0 } : null);
  Object.keys(remote || {}).forEach((k) => { const v = clean(remote[k]); if (v && !k.includes('||')) out[k] = v; });
  Object.keys(local || {}).forEach((k) => {
    const v = clean(local[k]);
    if (!v || k.includes('||')) return;
    if (!out[k] || v.updatedAt >= out[k].updatedAt) out[k] = v;
  });
  return out;
}

/**
 * Bypass days as stored by the original app: { date: { value, updatedAt } }.
 * Older data is a plain { date: true } map. The newest change per day wins.
 */
export function normalizeBypass(state, legacy = {}) {
  const out = {};
  Object.keys(legacy || {}).forEach((d) => { if (legacy[d]) out[d] = { value: true, updatedAt: 0 }; });
  Object.keys(state || {}).forEach((d) => {
    const v = state[d];
    out[d] = v === true ? { value: true, updatedAt: 0 } : { value: !!(v && v.value), updatedAt: Number(v && v.updatedAt) || 0 };
  });
  return out;
}

export function mergeBypass(remote, local) {
  const out = normalizeBypass(remote);
  const here = normalizeBypass(local);
  Object.keys(here).forEach((d) => { if (!out[d] || here[d].updatedAt >= out[d].updatedAt) out[d] = here[d]; });
  return out;
}

export function activeBypass(state) {
  const out = {};
  Object.keys(state).forEach((d) => { if (state[d].value) out[d] = true; });
  return out;
}
