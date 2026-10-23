// Body weight entries: [{ date: "YYYY-MM-DD", weight: number, updatedAt: ms }]. Pure functions.
import { isYmd } from '../core/dates.js';

export function sanitizeWeights(list) {
  const byDate = {};
  (Array.isArray(list) ? list : []).forEach((x) => {
    const w = parseFloat(x && x.weight);
    if (!x || !isYmd(x.date) || !(w > 0 && w < 1000)) return;
    const entry = { date: x.date, weight: Math.round(w * 100) / 100 };
    const stamp = Number(x.updatedAt) || Date.parse(x.updated_at || '') || 0;
    if (stamp) entry.updatedAt = stamp;
    byDate[x.date] = entry;
  });
  return Object.keys(byDate).sort().map((d) => byDate[d]);
}

export function upsertWeight(list, date, weight, now = Date.now()) {
  return sanitizeWeights([...list.filter((x) => x.date !== date), { date, weight, updatedAt: now }]);
}

/**
 * Merges cloud rows ({ log_date, weight_kg, updated_at }) with this phone's list.
 * Per day the most recent change wins; an entry without a timestamp (saved by
 * an older version) counts as this phone's latest. An entry this phone already
 * uploaded (syncedDates) that is gone from the cloud was deleted elsewhere.
 */
export function mergeWeights(remoteRows, local, syncedDates = []) {
  const synced = new Set(syncedDates);
  const remote = sanitizeWeights((remoteRows || []).map((x) => ({ date: x.log_date, weight: x.weight_kg, updated_at: x.updated_at })));
  const byDate = new Map(remote.map((x) => [x.date, x]));
  sanitizeWeights(local).forEach((x) => {
    const r = byDate.get(x.date);
    if (!r) { if (!synced.has(x.date)) byDate.set(x.date, x); return; }
    if (!x.updatedAt || x.updatedAt >= (r.updatedAt || 0)) byDate.set(x.date, x);
  });
  return sanitizeWeights([...byDate.values()]);
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
