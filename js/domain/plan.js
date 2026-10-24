// Workout routines and the weekly schedule. Pure functions, no DOM or storage.
import { UNILATERAL_PATTERN } from './catalog.js';

export const MAX_SETS = 20;

// Earlier versions shipped these presets; untouched copies are removed so people
// start from their own routines. Matching is by content fingerprint, so edited
// copies survive.
export const STOCK_PRESETS = { 'Push + Abs': '5422adf1', Push: '5422adf1', Pull: '4381bc68', Legs: '7dbd6bbd', 'Full Body': 'f1647e8e' };

// Exercise defaults carried over from the original app.
export const UNILATERAL_DEFAULTS = ['Single-Arm Cable Lateral Raises', 'Single-Arm Tricep Pushdowns', 'Reverse Chest Fly Machine'];
export const REST_DEFAULTS = {
  'Smith Machine Incline Bench Press': 180, 'Chest Press Machine': 150, 'Shoulder Press Machine': 150,
  'Single-Arm Cable Lateral Raises': 90, 'Single-Arm Tricep Pushdowns': 90, 'Abdominal Crunch Machine': 90,
  'T-Bar Row': 180, 'Assisted Pull-Ups': 180, 'Seated Cable Row': 150, 'Reverse Chest Fly Machine': 90,
  'Preacher Curls': 90, 'Reverse Cable Bicep Curls': 60, 'Meow Curls': 60,
  'Leg Press': 180, 'Seated Leg Curl': 120, 'Leg Extensions': 120,
  'Hip Abduction Machine': 75, 'Hip Adduction Machine': 75, 'Standing Calf Raises': 60,
};
export const DEFAULT_REST = 90;
export const DEFAULT_TARGET = '8–12';
export const DEFAULT_SETS = 2; // per side for one-sided moves

export function fingerprint(list) {
  const s = JSON.stringify((list || []).map((e) => [e.name, e.target || '', e.cat || '', e.note || '']));
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

// Names are kept exactly as typed: both apps identify routines and workouts
// by them. Markup characters become look-alikes (Arms <3 -> Arms ‹3) only in
// what comes from someone else (shared routines, backup files), because the
// original app (still on some phones) puts names into the page unescaped.
const LOOKALIKE = { '<': '‹', '>': '›', '"': '”', '`': '’' };
export const plain = (s) => s.replace(/[<>"`]/g, (c) => LOOKALIKE[c]);

// Only what could start markup in the original app: "<" before a letter, "/",
// "!" or "?" (a tag; it puts names into element content, never into
// attributes). "Arms <3" or Bench "heavy" stay as they are, so a user's own
// backup keeps its names.
export const defang = (s) => s.replace(/<(?=[A-Za-z/!?])/g, '‹');

const deep = (fn) => function walk(value) {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map(walk);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [fn(k), walk(v)]));
  return value;
};
/** plain() applied to every string and key of a JSON value (for shared routines). */
export const deepPlain = deep(plain);
/** defang() applied to every string and key (for backup files). */
export const deepDefang = deep(defang);

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** A rest-day picture as this app stores it (a resized photo); anything else is dropped. */
export const isSafeImage = (v) => typeof v === 'string' && v.length < 2000000 && /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(v);

/**
 * Validates one exercise. Data can come from other people (shared routines) or
 * an old app version, so every field is type-checked and length-limited.
 * For unilateral exercises `sets` counts rows (left and right), so it is even.
 */
export function sanitizeExercise(e) {
  if (!e || typeof e !== 'object') return null;
  const name = text(e.name, 80);
  if (!name) return null;
  const out = {
    name,
    cat: text(e.cat, 20) || 'other',
    sets: clampInt(e.sets, 1, MAX_SETS * 2, 3),
    target: text(e.target, 20) || DEFAULT_TARGET,
    rest: clampInt(e.rest, 0, 600, REST_DEFAULTS[name] ?? DEFAULT_REST),
    note: text(e.note, 200),
  };
  // Upstream versions mark one-sided moves with sides: 'both'; keep both fields.
  if (e.unilateral === true || e.unilateral === false) out.unilateral = e.unilateral;
  else if (e.sides === 'both') out.unilateral = true;
  if (out.unilateral) {
    out.sides = 'both';
    if (out.sets % 2) out.sets += 1;
  }
  return out;
}

export function sanitizeWorkout(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.map(sanitizeExercise).filter((e) => e && !seen.has(e.name) && seen.add(e.name));
}

export function sanitizeWorkoutName(name) {
  // Kept exactly as stored, spaces and length included: the original app
  // identifies routines by name and does not trim them (a copied routine can
  // be "Legs "). Only the app's own name prompts trim and limit what is typed.
  const n = typeof name === 'string' && name.trim() ? name.slice(0, 200) : '';
  return n === '__proto__' ? '' : n;
}

export function sanitizeWorkouts(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  Object.keys(obj).forEach((key) => {
    const name = sanitizeWorkoutName(key);
    if (name && !out[name]) out[name] = sanitizeWorkout(obj[key]);
  });
  return out;
}

export function emptySchedule() {
  return { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null };
}

export function sanitizeSchedule(schedule, workouts) {
  const out = emptySchedule();
  if (!schedule || typeof schedule !== 'object') return out;
  for (let i = 0; i < 7; i++) {
    // Names are cleaned the same way as routine names, so a day keeps its routine.
    const name = typeof schedule[i] === 'string' ? sanitizeWorkoutName(schedule[i]) : null;
    out[i] = name && workouts[name] ? name : null;
  }
  return out;
}

/**
 * One-time upgrade of exercises saved by older versions: mark single-arm and
 * single-leg movements as unilateral. Unlike before, this no longer rewrites the
 * set count on every launch, so edits stick.
 */
export function upgradeExercises(workouts) {
  let changed = false;
  Object.values(workouts).forEach((list) => list.forEach((e) => {
    // Only the original list and clear single-arm/leg names: existing entries of
    // other movements keep the set count the user chose.
    if (e.unilateral === undefined && (UNILATERAL_DEFAULTS.includes(e.name) || UNILATERAL_PATTERN.test(e.name))) {
      e.unilateral = true;
      e.sides = 'both';
      if (e.sets % 2) e.sets += 1;
      changed = true;
    }
  }));
  return changed;
}

/** Removes untouched stock presets. Returns the removed names. */
export function removeStockPresets(workouts) {
  const removed = [];
  Object.keys(workouts).forEach((name) => {
    if (STOCK_PRESETS[name] && fingerprint(workouts[name]) === STOCK_PRESETS[name]) {
      delete workouts[name];
      removed.push(name);
    }
  });
  return removed;
}

/** JSON with object keys sorted, so equal data compares equal after Postgres reorders it. */
export function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
  }
  return JSON.stringify(value ?? null);
}

/** Short content hash used to remember what the cloud looked like at the last sync. */
export function hashOf(value) {
  const s = stableStringify(value ?? null);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36) + ':' + s.length;
}

const listOf = (side, key) => (Array.isArray(side && side[key]) ? side[key] : []);

/** Per-item view of a plan: routine name -> list|null, day -> name|null, restImage -> string|null. */
export function planItems(plan) {
  plan = plan || {};
  const workouts = sanitizeWorkouts(plan.workouts);
  const deleted = new Set(listOf(plan, 'deletedWorkouts').filter((n) => !listOf(plan, 'restoredWorkouts').includes(n)));
  const items = { workouts: {}, schedule: {}, restImage: isSafeImage(plan.restImage) ? plan.restImage : null };
  Object.keys(workouts).forEach((n) => { if (!deleted.has(n)) items.workouts[n] = workouts[n]; });
  deleted.forEach((n) => { items.workouts[n] = null; });
  for (let i = 0; i < 7; i++) {
    const v = plan.schedule && plan.schedule[i];
    items.schedule[i] = typeof v === 'string' && v ? v : null;
  }
  return items;
}

/** Hashes of every item, the "base" remembered after a sync. */
export function planHashes(plan) {
  const items = planItems(plan);
  const out = { workouts: {}, schedule: {}, restImage: hashOf(items.restImage) };
  Object.keys(items.workouts).forEach((n) => { out.workouts[n] = hashOf(items.workouts[n]); });
  Object.keys(items.schedule).forEach((d) => { out.schedule[d] = hashOf(items.schedule[d]); });
  return out;
}

/**
 * Three-way merge of the cloud plan and this phone's plan, item by item
 * (each routine, each weekday, the rest-day image).
 *
 * `base` holds the hashes of the cloud plan at this phone's last sync (null if
 * it never synced). An item changed only on one side takes that side; changed
 * on both, the newer edit wins (`itemUpdatedAt` timestamps; plans saved by
 * older app versions have none, so this phone wins). Without a base, an item
 * that only one side has is kept, and an untouched local item never
 * overwrites the cloud, so a fresh phone can't wipe the weekly schedule.
 */
export function mergePlans(remote, local, base = null) {
  remote = remote || {};
  local = local || {};
  const R = planItems(remote), L = planItems(local);
  const rTimes = remote.itemUpdatedAt || {}, lTimes = local.itemUpdatedAt || {};
  const pick = (group, key, rv, lv) => {
    const rh = hashOf(rv), lh = hashOf(lv);
    const rt = Number(group === 'restImage' ? rTimes.restImage : rTimes[group]?.[key]) || 0;
    const lt = Number(group === 'restImage' ? lTimes.restImage : lTimes[group]?.[key]) || 0;
    if (rh === lh) return { value: lv, time: Math.max(rt, lt) };
    const b = base ? (group === 'restImage' ? base.restImage : base[group]?.[key]) : undefined;
    let takeLocal;
    if (b !== undefined) {
      if (lh === b) takeLocal = false;
      else if (rh === b) takeLocal = true;
      else takeLocal = lt >= rt;
    } else if (lv == null && !lt) takeLocal = false;
    // The cloud has nothing for it, unless it is an explicit deletion.
    else if (rv == null && !(group === 'workouts' && listOf(remote, 'deletedWorkouts').includes(key))) takeLocal = true;
    // Equal (or no) timestamps: this phone wins, except against an explicit deletion.
    else takeLocal = lt > rt || (lt === rt && rv != null);
    return takeLocal ? { value: lv, time: lt } : { value: rv, time: rt };
  };

  const merged = { workouts: {}, schedule: {}, restImage: null };
  const times = { workouts: {}, schedule: {}, restImage: 0 };
  const names = new Set([...Object.keys(R.workouts), ...Object.keys(L.workouts)]);
  names.forEach((n) => {
    const r = pick('workouts', n, R.workouts[n] ?? null, L.workouts[n] ?? null);
    merged.workouts[n] = r.value;
    if (r.time) times.workouts[n] = r.time;
  });
  for (let i = 0; i < 7; i++) {
    const r = pick('schedule', String(i), R.schedule[i], L.schedule[i]);
    merged.schedule[i] = r.value;
    if (r.time) times.schedule[i] = r.time;
  }
  const img = pick('restImage', 'restImage', R.restImage, L.restImage);
  merged.restImage = img.value;
  times.restImage = img.time || 0;

  // Keep this phone's routine order (Postgres does not keep JSON key order).
  const order = [...new Set([...Object.keys(local.workouts || {}), ...listOf(remote, 'workoutOrder'), ...Object.keys(remote.workouts || {})])];
  const workouts = {};
  order.forEach((n) => { if (merged.workouts[n]) workouts[n] = merged.workouts[n]; });
  Object.keys(merged.workouts).forEach((n) => { if (merged.workouts[n] && !workouts[n]) workouts[n] = merged.workouts[n]; });
  const removed = removeStockPresets(workouts);

  // Tombstone lists in the format the original app reads: every name that is
  // gone, and every present name that some old list still marks as deleted.
  const everDeleted = new Set([...listOf(remote, 'deletedWorkouts'), ...listOf(local, 'deletedWorkouts')]);
  const deletedWorkouts = [...new Set([...Object.keys(merged.workouts).filter((n) => !merged.workouts[n]), ...removed, ...[...everDeleted].filter((n) => !workouts[n])])];
  const restoredWorkouts = Object.keys(workouts).filter((n) => everDeleted.has(n));

  const plan = {
    workouts,
    schedule: sanitizeSchedule(merged.schedule, workouts),
    deletedWorkouts,
    restoredWorkouts,
    restImage: merged.restImage,
    workoutOrder: Object.keys(workouts),
    itemUpdatedAt: times,
  };
  return plan;
}

/** Number of set rows a session shows for an exercise. */
export function rowCount(e) {
  return Math.max(1, e.sets | 0);
}

/** Sets as the user thinks of them (per side for unilateral moves). */
export function displaySets(e) {
  return e.unilateral ? Math.max(1, Math.round(e.sets / 2)) : e.sets;
}

export function workoutSummary(list) {
  const exercises = (list || []).length;
  const sets = (list || []).reduce((n, e) => n + displaySets(e), 0);
  return exercises + (exercises === 1 ? ' exercise · ' : ' exercises · ') + sets + (sets === 1 ? ' set' : ' sets');
}

/** Rough session length in minutes, assuming ~45 s per set plus rest. */
export function estimateMinutes(list) {
  const seconds = (list || []).reduce((n, e) => n + rowCount(e) * (45 + (e.unilateral ? e.rest / 2 : e.rest)), 0);
  return Math.max(5, Math.round(seconds / 300) * 5);
}

export function renameInSchedule(schedule, from, to) {
  Object.keys(schedule).forEach((k) => { if (schedule[k] === from) schedule[k] = to; });
}

export function scheduledDays(schedule, name) {
  return Object.keys(schedule).filter((k) => schedule[k] === name).length;
}
