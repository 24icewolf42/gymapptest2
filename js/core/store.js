// localStorage access. Key names are unchanged from earlier versions so existing
// phones keep their history after updating.

export const KEYS = Object.freeze({
  logs: 'gymLogs',
  lastUsed: 'gymLastUsed',
  weights: 'bodyWeightLogs',
  bypass: 'gymBypass',
  workouts: 'gymCustomWorkouts',
  schedule: 'gymPlanSchedule',
  deletedWorkouts: 'gymDeletedWorkouts',
  restoredWorkouts: 'gymRestoredWorkouts',
  restImage: 'gymRestImage',
  draft: 'gymDraft',
  active: 'gymActive',
  sidesFrom: 'gymSidesFrom',
  settings: 'gymSettings',
  planUpdatedAt: 'gymPlanUpdatedAt',
  planTimes: 'gymPlanItemTimes',
  planBase: 'gymPlanBase',
  drafts: 'gymDrafts',
  switchBackup: 'gymBackupBeforeSwitch',
  sync: 'gymSyncState',
  gyms: 'gymFavoriteGyms',
  // Shared with the original app's sync format:
  deletedSessions: 'gymDeletedSessions',
  deletedDates: 'gymDeletedLogDates',
  bypassState: 'gymBypassState',
  legacyStats: 'gymLegacyStats',
});

export function read(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn('Could not save', key, error);
    emit('gym:storage-error', { key });
    return false;
  }
}

export function readText(key, fallback = null) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

export function writeText(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn('Could not save', key, error);
    emit('gym:storage-error', { key });
    return false;
  }
}

export function remove(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

export function emit(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function listen(name, handler) {
  window.addEventListener(name, handler);
  return () => window.removeEventListener(name, handler);
}
