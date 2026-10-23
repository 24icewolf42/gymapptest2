// Body weight entries: [{ date: "YYYY-MM-DD", weight: number }]. Pure functions.
import { isYmd } from '../core/dates.js';

export function sanitizeWeights(list) {
  const byDate = {};
  (Array.isArray(list) ? list : []).forEach((x) => {
    const w = parseFloat(x && x.weight);
    if (x && isYmd(x.date) && w > 0 && w < 1000) byDate[x.date] = { date: x.date, weight: Math.round(w * 100) / 100 };
  });
  return Object.keys(byDate).sort().map((d) => byDate[d]);
}

export function upsertWeight(list, date, weight) {
  return sanitizeWeights([...list.filter((x) => x.date !== date), { date, weight }]);
}

/**
 * Merges cloud rows ({ log_date, weight_kg }) with this phone's list. This phone
 * wins per day. An entry this phone already uploaded (syncedDates) that is gone
 * from the cloud was deleted on another device and is dropped.
 */
export function mergeWeights(remoteRows, local, syncedDates = []) {
  const synced = new Set(syncedDates);
  const remote = sanitizeWeights((remoteRows || []).map((x) => ({ date: x.log_date, weight: x.weight_kg })));
  const remoteDates = new Set(remote.map((x) => x.date));
  const keep = sanitizeWeights(local).filter((x) => remoteDates.has(x.date) || !synced.has(x.date));
  return sanitizeWeights([...remote, ...keep]);
}

/** Latest entry and change versus roughly 30 days earlier. */
export function weightTrend(list) {
  if (!list.length) return null;
  const last = list[list.length - 1];
  const cutoff = new Date(last.date);
  cutoff.setDate(cutoff.getDate() - 30);
  const base = list.find((x) => new Date(x.date) >= cutoff) || list[0];
  return { latest: last, change: Math.round((last.weight - base.weight) * 10) / 10, since: base.date };
}
