// Workout routines and the weekly schedule. Pure functions, no DOM or storage.

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

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

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
  if (e.unilateral === true || e.unilateral === false) out.unilateral = e.unilateral;
  if (out.unilateral && out.sets % 2) out.sets += 1;
  return out;
}

export function sanitizeWorkout(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.map(sanitizeExercise).filter((e) => e && !seen.has(e.name) && seen.add(e.name));
}

export function sanitizeWorkoutName(name) {
  const n = text(name, 40);
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
    const name = schedule[i];
    out[i] = typeof name === 'string' && workouts[name] ? name : null;
  }
  return out;
}

/**
 * One-time upgrade of exercises saved by older versions: mark the original
 * single-arm movements as unilateral. Unlike before, this no longer rewrites the
 * set count on every launch, so edits stick.
 */
export function upgradeExercises(workouts) {
  let changed = false;
  Object.values(workouts).forEach((list) => list.forEach((e) => {
    if (e.unilateral === undefined && UNILATERAL_DEFAULTS.includes(e.name)) {
      e.unilateral = true;
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

/**
 * Merges the cloud plan with this phone's plan. The side saved most recently
 * wins for routines and days that both have; routines only one side has are
 * kept unless they were deleted (tombstones). Plans written by older app
 * versions carry no timestamp, which makes this phone win, as before.
 */
export function mergePlans(remote, local) {
  remote = remote || {};
  local = local || {};
  const remoteNewer = (Date.parse(remote.updatedAt || '') || 0) > (Date.parse(local.updatedAt || '') || 0);
  const [newer, older] = remoteNewer ? [remote, local] : [local, remote];
  const workouts = { ...sanitizeWorkouts(older.workouts), ...sanitizeWorkouts(newer.workouts) };
  const list = (side, key) => (Array.isArray(side[key]) ? side[key] : []);
  // Deleting and re-creating a name flips it between the two lists. When the
  // sides disagree, the newer side's list decides; otherwise any deletion holds.
  const names = new Set([...list(newer, 'deletedWorkouts'), ...list(older, 'deletedWorkouts'), ...list(newer, 'restoredWorkouts'), ...list(older, 'restoredWorkouts')]);
  const deleted = [], restored = [];
  names.forEach((name) => {
    const isDeleted = list(newer, 'deletedWorkouts').includes(name) ||
      (!list(newer, 'restoredWorkouts').includes(name) && list(older, 'deletedWorkouts').includes(name) && !list(older, 'restoredWorkouts').includes(name));
    (isDeleted ? deleted : restored).push(name);
  });
  removeStockPresets(workouts).forEach((name) => { if (!deleted.includes(name)) deleted.push(name); });
  deleted.forEach((name) => { delete workouts[name]; });
  const schedule = sanitizeSchedule({ ...emptySchedule(), ...(older.schedule || {}), ...(newer.schedule || {}) }, workouts);
  return {
    workouts,
    schedule,
    deletedWorkouts: deleted,
    restoredWorkouts: restored,
    updatedAt: newer.updatedAt || older.updatedAt || null,
  };
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
