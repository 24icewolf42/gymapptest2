// In-memory app state, loaded from and saved to localStorage. UI modules read
// `state` and call the save functions; cloud sync listens for the events.
import { KEYS, read, write, readText, writeText, remove, emit } from './core/store.js';
import { ymd } from './core/dates.js';
import { sanitizeWorkouts, sanitizeSchedule, upgradeExercises, removeStockPresets, emptySchedule } from './domain/plan.js';
import { sanitizeLogs, upgradeLastUsed, sessionKey, mergeProgress } from './domain/logs.js';
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
  settings: { ...DEFAULT_SETTINGS },
  // Cloud bookkeeping: what this phone last uploaded, and deletions not yet uploaded.
  sync: { accountId: null, syncedKeys: [], pendingDeletes: {}, syncedWeightDates: [], pendingWeightDeletes: {} },
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

  state.logs = sanitizeLogs(read(KEYS.logs, {}));
  const upgraded = upgradeLastUsed(read(KEYS.lastUsed, {}), state.logs, read(KEYS.draft, null));
  state.lastUsed = mergeProgress({}, upgraded.lastUsed);
  if (upgraded.changed) write(KEYS.lastUsed, state.lastUsed);
  state.weights = sanitizeWeights(read(KEYS.weights, []));
  state.bypass = read(KEYS.bypass, {}) || {};
  state.settings = { ...DEFAULT_SETTINGS, ...(read(KEYS.settings, {}) || {}) };
  state.sync = { accountId: null, syncedKeys: [], pendingDeletes: {}, syncedWeightDates: [], pendingWeightDeletes: {}, ...(read(KEYS.sync, {}) || {}) };
  if (!readText(KEYS.sidesFrom)) writeText(KEYS.sidesFrom, ymd());
}

function persistPlan() {
  write(KEYS.workouts, state.workouts);
  write(KEYS.schedule, state.schedule);
}

/** Saves routines and schedule. `silent` skips the cloud upload (used when applying cloud data). */
export function savePlan({ silent = false } = {}) {
  persistPlan();
  if (!silent) write(KEYS.planUpdatedAt, new Date().toISOString());
  emit('gym:plan-updated');
  if (!silent) emit('gym:plan-changed');
}

export function planTombstones() {
  const deleted = read(KEYS.deletedWorkouts, []), restored = read(KEYS.restoredWorkouts, []);
  return { deleted: Array.isArray(deleted) ? deleted : [], restored: Array.isArray(restored) ? restored : [] };
}

export function setPlanTombstones(deleted, restored) {
  write(KEYS.deletedWorkouts, deleted);
  write(KEYS.restoredWorkouts, restored);
}

export function localPlan() {
  const { deleted, restored } = planTombstones();
  return { workouts: state.workouts, schedule: state.schedule, deletedWorkouts: deleted, restoredWorkouts: restored, updatedAt: read(KEYS.planUpdatedAt, null) };
}

export function applyPlan(plan) {
  state.workouts = plan.workouts;
  state.schedule = plan.schedule;
  setPlanTombstones(plan.deletedWorkouts, plan.restoredWorkouts);
  if (plan.updatedAt) write(KEYS.planUpdatedAt, plan.updatedAt);
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

export function saveLogs({ silent = false } = {}) {
  write(KEYS.logs, state.logs);
  emit('gym:logs-updated');
  if (!silent) emit('gym:logs-changed');
}

export function deleteSession(date, day) {
  const list = (state.logs[date] || []).filter((s) => s.day !== day);
  if (list.length) state.logs[date] = list;
  else delete state.logs[date];
  state.sync.pendingDeletes[sessionKey(date, day)] = new Date().toISOString();
  saveSync();
  saveLogs();
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
  if (state.sync.pendingWeightDeletes[date]) { delete state.sync.pendingWeightDeletes[date]; saveSync(); }
  saveWeights();
}

export function deleteWeight(date) {
  state.weights = state.weights.filter((x) => x.date !== date);
  state.sync.pendingWeightDeletes[date] = true;
  saveSync();
  saveWeights();
}

export function saveBypass() {
  write(KEYS.bypass, state.bypass);
  emit('gym:logs-updated');
}

export function saveSettings() {
  write(KEYS.settings, state.settings);
}

export function saveSync() {
  write(KEYS.sync, state.sync);
}

const LOCAL_DATA_KEYS = [KEYS.logs, KEYS.lastUsed, KEYS.weights, KEYS.bypass, KEYS.workouts, KEYS.schedule,
  KEYS.deletedWorkouts, KEYS.restoredWorkouts, KEYS.planUpdatedAt, KEYS.draft, KEYS.active, KEYS.sync];

export function hasLocalData() {
  return Object.keys(state.logs).length > 0 || Object.keys(state.workouts).length > 0 || state.weights.length > 0;
}

/** Removes this phone's training data (used when another account signs in, or on request at sign-out). */
export function clearLocalData() {
  LOCAL_DATA_KEYS.forEach(remove);
  state.sync = { accountId: null, syncedKeys: [], pendingDeletes: {}, syncedWeightDates: [], pendingWeightDeletes: {} };
  loadState();
  emit('gym:plan-updated');
  emit('gym:logs-updated');
  emit('gym:weights-updated');
}

export function restImage() {
  return readText(KEYS.restImage) || 'rest.png';
}

export function setRestImage(dataUrl) {
  if (dataUrl) return writeText(KEYS.restImage, dataUrl);
  remove(KEYS.restImage);
  return true;
}
