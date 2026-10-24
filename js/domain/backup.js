// Backup and restore of everything stored on this phone.
import { isSafeImage } from './plan.js';

// Earlier backups only had the first four keys, so routines and the weekly plan
// were lost on restore. Restore still accepts that older format.
export const BACKUP_KEYS = [
  'gymLogs', 'gymLastUsed', 'bodyWeightLogs', 'gymBypass',
  'gymCustomWorkouts', 'gymPlanSchedule', 'gymDeletedWorkouts', 'gymRestoredWorkouts',
  'gymPlanUpdatedAt', 'gymSettings', 'gymSidesFrom', 'gymFavoriteGyms',
  'gymDeletedSessions', 'gymDeletedLogDates', 'gymBypassState', 'gymLegacyStats', 'gymPlanItemTimes', 'gymRestImage',
];

export function makeBackup(getItem, version) {
  const data = {};
  BACKUP_KEYS.forEach((k) => { const v = getItem(k); if (v != null) data[k] = v; });
  // The keys are also written at the top level, the format the original app restores.
  return JSON.stringify({ ...data, gymLogs: data.gymLogs ?? '{}', app: 'tracker', version, createdAt: new Date().toISOString(), data });
}

/** Returns { key: rawString } to write back, or throws with a readable message. */
export function parseBackup(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error('That is not a valid backup.'); }
  const current = !!(obj && obj.app === 'tracker' && obj.data && typeof obj.data === 'object');
  const data = current ? obj.data : obj;
  // Old-format backups are recognised by their gymLogs key; new ones by the header,
  // so a backup made before the first logged workout still restores.
  if (!data || typeof data !== 'object' || (!current && !('gymLogs' in data))) throw new Error('That is not a valid backup.');
  const out = {};
  BACKUP_KEYS.forEach((k) => {
    if (data[k] == null) return;
    const value = typeof data[k] === 'string' ? data[k] : JSON.stringify(data[k]);
    if (k !== 'gymSidesFrom' && k !== 'gymRestImage') {
      try { JSON.parse(value); } catch { throw new Error('The backup is damaged (' + k + ').'); }
    }
    if (k === 'gymRestImage' && !isSafeImage(value)) return; // only a picture, never markup
    out[k] = value;
  });
  return out;
}
