// Workout history: { "YYYY-MM-DD": [ { day, exercises: [{ name, target, sets: [{ w, r, done }] }], time, duration } ] }
// Pure functions, no DOM or storage.
import { isYmd, mondayIndex, addDays, ymd } from '../core/dates.js';

export const sessionKey = (date, day) => date + '|' + day;

function cleanSet(s) {
  if (!s || typeof s !== 'object') return null;
  return { w: String(s.w ?? '').slice(0, 12), r: String(s.r ?? '').slice(0, 12), done: !!s.done };
}

function cleanSession(s) {
  if (!s || typeof s !== 'object' || typeof s.day !== 'string' || !s.day) return null;
  const exercises = (Array.isArray(s.exercises) ? s.exercises : [])
    .filter((e) => e && typeof e.name === 'string')
    .map((e) => ({ name: e.name.slice(0, 80), target: String(e.target ?? '').slice(0, 20), sets: (Array.isArray(e.sets) ? e.sets : []).map(cleanSet).filter(Boolean) }));
  const out = { day: s.day.slice(0, 40), exercises, time: typeof s.time === 'string' ? s.time : '' };
  if (Number.isFinite(s.duration) && s.duration >= 0) out.duration = Math.round(s.duration);
  return out;
}

/** Drops anything that is not a well-formed log (e.g. from a hand-edited backup). */
export function sanitizeLogs(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  Object.keys(obj).forEach((date) => {
    if (!isYmd(date) || !Array.isArray(obj[date])) return;
    const sessions = obj[date].map(cleanSession).filter(Boolean);
    if (sessions.length) out[date] = sessions;
  });
  return out;
}

export function allKeys(logs) {
  const keys = [];
  Object.keys(logs).forEach((date) => (logs[date] || []).forEach((s) => keys.push(sessionKey(date, s.day))));
  return keys;
}

/**
 * Merges cloud history into this phone's history.
 * - Same workout on the same day: the most recently saved copy wins.
 * - pendingDeletes: sessions deleted here but not yet uploaded; the cloud copy is ignored.
 * - syncedKeys: sessions this phone had already uploaded. If one of them is now
 *   missing from the cloud, another device deleted it, so it is dropped here too.
 *   Sessions recorded offline are not in syncedKeys and are kept.
 */
export function mergeLogs(remote, local, { pendingDeletes = {}, syncedKeys = [] } = {}) {
  remote = sanitizeLogs(remote);
  local = sanitizeLogs(local);
  const synced = new Set(syncedKeys);
  const remoteKeys = new Set(allKeys(remote));
  const merged = {};
  const add = (date, session) => {
    const list = merged[date] || (merged[date] = []);
    const i = list.findIndex((s) => s.day === session.day);
    if (i < 0) list.push(session);
    else if ((Date.parse(session.time) || 0) >= (Date.parse(list[i].time) || 0)) list[i] = session;
  };
  Object.keys(remote).forEach((date) => remote[date].forEach((s) => {
    if (!pendingDeletes[sessionKey(date, s.day)]) add(date, s);
  }));
  Object.keys(local).forEach((date) => local[date].forEach((s) => {
    const key = sessionKey(date, s.day);
    if (synced.has(key) && !remoteKeys.has(key)) return;
    add(date, s);
  }));
  return merged;
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
  let workouts = 0, volume = 0;
  eachSession(logs, (s) => {
    workouts++;
    (s.exercises || []).forEach((e) => (e.sets || []).forEach((x) => { volume += num(x.w) * num(x.r); }));
  });
  return { workouts_count: workouts, volume_kg_reps: Math.round(volume) };
}

/**
 * Consecutive scheduled training days that were logged or marked as bypass.
 * Rest days never break the streak; today does not break it until it is over.
 */
export function streak(logs, bypass, schedule, today = new Date()) {
  let count = 0;
  for (let i = 0; i < 400; i++) {
    const d = addDays(today, -i);
    if (!schedule[mondayIndex(d.getDay())]) continue;
    const ds = ymd(d);
    if ((logs[ds] && logs[ds].length) || bypass[ds]) count++;
    else if (i === 0) continue;
    else break;
  }
  return count;
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

export function mergeProgress(remote, local) {
  const out = {};
  const add = (src) => Object.keys(src || {}).forEach((k) => {
    if (k.includes('||')) return;
    const v = src[k];
    if (v && Array.isArray(v.sets)) out[k] = { sets: trimSets(v.sets) };
  });
  add(remote);
  add(local);
  return out;
}
