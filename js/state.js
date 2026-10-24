// In-memory app state, loaded from and saved to localStorage. UI modules read
// `state` and call the save functions; cloud sync listens for the events.
import { KEYS, read, write, readText, writeText, remove, emit } from './core/store.js';
import { ymd } from './core/dates.js';
import { sanitizeWorkouts, sanitizeSchedule, upgradeExercises, removeStockPresets, emptySchedule, planHashes, isSafeImage, sanitizeWorkoutName, deepDefang, defang } from './domain/plan.js';
import { sanitizeLogs, upgradeLastUsed, sessionKey, newSessionId, mergeProgress, normalizeBypass, activeBypass, streak, bestStreak } from './domain/logs.js';
import { sanitizeWeights, upsertWeight } from './domain/weights.js';

// weightStep 0 = keep exactly what was typed. Older versions always rounded to
// 5 kg, which saved a 2 kg dumbbell as 0.
export const DEFAULT_SETTINGS = { weightStep: 0 };

export const state = {
  workouts: {},
  schedule: emptySchedule(),
  logs: {},
  lastUsed: {},
  weights: [],
  bypass: {},
  bypassState: {},
  // Deletion records shared with other devices: session keys, and dates cleared at a time (ms).
  deletedSessions: [],
  deletedDates: {},
  settings: { ...DEFAULT_SETTINGS },
  // Cloud bookkeeping: what this phone last uploaded, and deletions not yet uploaded.
  sync: { accountId: null, syncedWeightDates: [], pendingWeightDeletes: {}, dirtyWeightDates: [] },
};

export function loadState() {
  state.workouts = sanitizeWorkouts(read(KEYS.workouts, {}));
  let planChanged = upgradeExercises(state.workouts);
  const removed = removeStockPresets(state.workouts);
  if (removed.length) {
    const deleted = read(KEYS.deletedWorkouts, []);
    write(KEYS.deletedWorkouts, [...new Set([...(Array.isArray(deleted) ? deleted : []), ...removed])]);
    planChanged = true;
  }
  state.schedule = sanitizeSchedule(read(KEYS.schedule, {}), state.workouts);
  if (planChanged) persistPlan();

  const rawLogs = read(KEYS.logs, {});
  state.logs = sanitizeLogs(rawLogs);
  // Persist the normalised form (fixed dates, sorted sessions) once.
  if (JSON.stringify(rawLogs) !== JSON.stringify(state.logs)) write(KEYS.logs, state.logs);
  state.deletedSessions = read(KEYS.deletedSessions, []);
  if (!Array.isArray(state.deletedSessions)) state.deletedSessions = [];
  state.deletedDates = read(KEYS.deletedDates, {}) || {};
  const upgraded = upgradeLastUsed(read(KEYS.lastUsed, {}), state.logs, read(KEYS.draft, null));
  state.lastUsed = mergeProgress({}, upgraded.lastUsed);
  if (upgraded.changed) write(KEYS.lastUsed, state.lastUsed);
  state.weights = sanitizeWeights(read(KEYS.weights, []));
  state.bypassState = normalizeBypass(read(KEYS.bypassState, {}), read(KEYS.bypass, {}));
  state.bypass = activeBypass(state.bypassState);
  state.settings = { ...DEFAULT_SETTINGS, ...(read(KEYS.settings, {}) || {}) };
  state.sync = { accountId: null, syncedWeightDates: [], pendingWeightDeletes: {}, dirtyWeightDates: [], ...(read(KEYS.sync, {}) || {}) };
  if (!readText(KEYS.sidesFrom)) writeText(KEYS.sidesFrom, ymd());
  savedHashes = planHashes(localPlan());
}

function persistPlan() {
  write(KEYS.workouts, state.workouts);
  write(KEYS.schedule, state.schedule);
}

// Hashes of the plan as last saved, to find which routines/days an edit touched.
let savedHashes = null;

function stampChanges() {
  const now = Date.now();
  const times = read(KEYS.planTimes, {}) || {};
  times.workouts = times.workouts || {};
  times.schedule = times.schedule || {};
  const next = planHashes(localPlan());
  const prev = savedHashes || { workouts: {}, schedule: {} };
  new Set([...Object.keys(next.workouts), ...Object.keys(prev.workouts)]).forEach((n) => {
    if (next.workouts[n] !== prev.workouts[n]) times.workouts[n] = now;
  });
  Object.keys(next.schedule).forEach((d) => { if (next.schedule[d] !== prev.schedule[d]) times.schedule[d] = now; });
  if (next.restImage !== prev.restImage) times.restImage = now;
  write(KEYS.planTimes, times);
  savedHashes = next;
}

/** Saves routines and schedule. `silent` skips the cloud upload (used when applying cloud data). */
export function savePlan({ silent = false } = {}) {
  persistPlan();
  if (silent) savedHashes = planHashes(localPlan());
  else stampChanges();
  emit('gym:plan-updated');
  if (!silent) emit('gym:plan-changed');
}

export function planTombstones() {
  const deleted = read(KEYS.deletedWorkouts, []), restored = read(KEYS.restoredWorkouts, []);
  // Names as routines are named (old lists, backups and old cloud rows may hold raw ones).
  const clean = (list) => (Array.isArray(list) ? [...new Set(list.map(sanitizeWorkoutName).filter(Boolean))] : []);
  return { deleted: clean(deleted), restored: clean(restored) };
}

export function setPlanTombstones(deleted, restored) {
  write(KEYS.deletedWorkouts, deleted);
  write(KEYS.restoredWorkouts, restored);
}

/** The plan in the shared cloud format, with per-item edit times. */
export function localPlan() {
  const { deleted, restored } = planTombstones();
  const img = isSafeImage(readText(KEYS.restImage)) ? readText(KEYS.restImage) : null;
  return {
    workouts: state.workouts,
    schedule: state.schedule,
    deletedWorkouts: deleted.filter((n) => !state.workouts[n]),
    restoredWorkouts: restored,
    restImage: img || null,
    itemUpdatedAt: read(KEYS.planTimes, {}) || {},
  };
}

/** Hashes of the cloud plan at the last successful sync (null before the first). */
export function planBase() {
  return read(KEYS.planBase, null);
}

export function setPlanBase(base) {
  write(KEYS.planBase, base);
}

/** Applies a merged plan from the cloud without marking anything as edited here. */
export function applyPlan(plan) {
  state.workouts = plan.workouts;
  upgradeExercises(state.workouts);
  state.schedule = plan.schedule;
  setPlanTombstones(plan.deletedWorkouts, plan.restoredWorkouts);
  write(KEYS.planTimes, plan.itemUpdatedAt || {});
  if (isSafeImage(plan.restImage)) writeText(KEYS.restImage, plan.restImage); else remove(KEYS.restImage);
  savePlan({ silent: true });
}

export function deleteWorkout(name) {
  delete state.workouts[name];
  const { deleted, restored } = planTombstones();
  setPlanTombstones([...new Set([...deleted, name])], restored.filter((n) => n !== name));
  Object.keys(state.schedule).forEach((k) => { if (state.schedule[k] === name) state.schedule[k] = null; });
  savePlan();
}

export function createWorkout(name, exercises = []) {
  const { deleted, restored } = planTombstones();
  if (deleted.includes(name)) setPlanTombstones(deleted.filter((n) => n !== name), [...new Set([...restored, name])]);
  state.workouts[name] = exercises;
  savePlan();
}

/** Saves history; returns false if the phone's storage is full (nothing was saved). */
export function saveLogs({ silent = false } = {}) {
  const ok = write(KEYS.logs, state.logs);
  emit('gym:logs-updated');
  if (ok && !silent) emit('gym:logs-changed');
  return ok;
}

/**
 * Deletes one logged session everywhere (the key is recorded so other devices
 * drop it too). Returns the removed session, for Undo.
 */
export function deleteSession(date, key) {
  const removed = (state.logs[date] || []).find((s) => sessionKey(date, s) === key) || null;
  const list = (state.logs[date] || []).filter((s) => sessionKey(date, s) !== key);
  if (list.length) state.logs[date] = list;
  else delete state.logs[date];
  markSessionsDeleted([key]);
  saveLogs();
  return removed;
}

/** Undo of a deletion: the session comes back under a new id, since the old one stays deleted. */
export function restoreSession(date, session) {
  state.logs[date] = [...(state.logs[date] || []), { ...session, id: newSessionId() }];
  saveLogs();
}

export function markSessionsDeleted(keys) {
  state.deletedSessions = [...new Set([...state.deletedSessions, ...keys])];
  write(KEYS.deletedSessions, state.deletedSessions);
}

export function saveTombstones() {
  write(KEYS.deletedSessions, state.deletedSessions);
  write(KEYS.deletedDates, state.deletedDates);
}

export function saveLastUsed({ silent = false } = {}) {
  write(KEYS.lastUsed, state.lastUsed);
  if (!silent) emit('gym:progress-changed');
}

export function saveWeights({ silent = false } = {}) {
  write(KEYS.weights, state.weights);
  emit('gym:weights-updated');
  if (!silent) emit('gym:weight-changed');
}

export function setWeight(date, kg) {
  state.weights = upsertWeight(state.weights, date, kg);
  // A new entry is not "already uploaded", even if this day was synced and deleted before.
  delete state.sync.pendingWeightDeletes[date];
  state.sync.syncedWeightDates = state.sync.syncedWeightDates.filter((d) => d !== date);
  // Changed here and not uploaded yet: wins over the cloud copy and over a deletion there.
  if (!state.sync.dirtyWeightDates.includes(date)) state.sync.dirtyWeightDates.push(date);
  saveSync();
  saveWeights();
}

export function deleteWeight(date) {
  state.weights = state.weights.filter((x) => x.date !== date);
  state.sync.pendingWeightDeletes[date] = true;
  state.sync.dirtyWeightDates = state.sync.dirtyWeightDates.filter((d) => d !== date);
  saveSync();
  saveWeights();
}

export function setBypass(date, on) {
  state.bypassState[date] = { value: !!on, updatedAt: Date.now() };
  saveBypass();
}

/** Writes both the timestamped state and the plain map older versions read. */
export function saveBypass({ silent = false } = {}) {
  state.bypass = activeBypass(state.bypassState);
  write(KEYS.bypassState, state.bypassState);
  write(KEYS.bypass, state.bypass);
  emit('gym:logs-updated');
  if (!silent) emit('gym:progress-changed');
}

export function saveSettings() {
  write(KEYS.settings, state.settings);
}

export function saveSync() {
  write(KEYS.sync, state.sync);
}

// Everything personal on this phone, removed on "Sign out and remove my data".
const LOCAL_DATA_KEYS = [KEYS.logs, KEYS.lastUsed, KEYS.weights, KEYS.bypass, KEYS.bypassState, KEYS.workouts, KEYS.schedule,
  KEYS.deletedWorkouts, KEYS.restoredWorkouts, KEYS.planUpdatedAt, KEYS.planTimes, KEYS.planBase, KEYS.draft, KEYS.drafts,
  KEYS.active, KEYS.sync, KEYS.deletedSessions, KEYS.deletedDates, KEYS.legacyStats, KEYS.gyms, KEYS.restImage,
  KEYS.switchBackup, KEYS.settings];

export function hasLocalData() {
  return Object.keys(state.logs).length > 0 || Object.keys(state.workouts).length > 0 || state.weights.length > 0 ||
    Object.keys(state.lastUsed).length > 0 || Object.keys(state.bypassState).length > 0 || !!readText(KEYS.restImage) || (read(KEYS.gyms, []) || []).length > 0;
}

/**
 * Data on this phone that joins an account it did not come from may have been
 * entered by someone else; the original app shows names unescaped on the
 * account's other devices. Routines the account does not have yet are defused
 * (a name the account already has is the user's own and stays, so nothing is
 * duplicated in the original app). Returns true if anything changed.
 */
export function defangNewRoutines(remotePlan) {
  const remote = remotePlan?.workouts && typeof remotePlan.workouts === 'object' ? remotePlan.workouts : {};
  // Names the account deleted count as known too: such a routine must stay
  // deleted under its own name, not come back under a defused one.
  const deletedThere = Array.isArray(remotePlan?.deletedWorkouts) ? remotePlan.deletedWorkouts : [];
  const known = new Set([...Object.keys(remote), ...deletedThere]);
  let changed = false;
  const next = {};
  Object.entries(state.workouts).forEach(([name, list]) => {
    if (known.has(name)) {
      // A routine the account has: exercises it does not have there are new, and defused.
      const had = new Set((Array.isArray(remote[name]) ? remote[name] : []).map((e) => e && e.name));
      const cleanList = list.map((e) => (had.has(e.name) ? e : deepDefang(e)));
      if (JSON.stringify(cleanList) !== JSON.stringify(list)) changed = true;
      next[name] = cleanList;
      return;
    }
    const clean = defang(name), cleanList = deepDefang(list);
    if (clean !== name || JSON.stringify(cleanList) !== JSON.stringify(list)) changed = true;
    next[Object.hasOwn(next, clean) ? name : clean] = cleanList;
  });
  if (!changed) return false;
  Object.keys(state.schedule).forEach((d) => { if (state.schedule[d] && !known.has(state.schedule[d])) state.schedule[d] = defang(state.schedule[d]); });
  state.workouts = next;
  persistPlan();
  return true;
}

/** Removes this phone's training data (used when another account signs in, or on request at sign-out). */
export function clearLocalData() {
  LOCAL_DATA_KEYS.forEach(remove);
  state.sync = { accountId: null, syncedWeightDates: [], pendingWeightDeletes: {}, dirtyWeightDates: [] };
  loadState();
  emit('gym:plan-updated');
  emit('gym:logs-updated');
  emit('gym:weights-updated');
}

export function restImage() {
  const img = isSafeImage(readText(KEYS.restImage)) ? readText(KEYS.restImage) : null;
  return isSafeImage(img) ? img : 'rest.png';
}

export function setRestImage(dataUrl) {
  if (dataUrl) { if (!writeText(KEYS.restImage, dataUrl)) return false; } else remove(KEYS.restImage);
  savePlan();
  return true;
}

/** Current streak and the best ever, including a best kept from before this phone's history. */
export function streaks() {
  const current = streak(state.logs, state.bypass, state.schedule);
  const legacy = Number((read(KEYS.legacyStats, {}) || {}).best_streak) || 0;
  return { current, best: Math.max(current, bestStreak(state.logs, state.bypass, state.schedule), legacy) };
}
