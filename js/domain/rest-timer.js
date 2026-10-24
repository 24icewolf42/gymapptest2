// Smart rest timer: a full rest after training the same muscle group, and a
// short switch gap after any set.

export const SWITCH_GAP = 30;
const GROUP = { forearms: 'biceps' };

export const muscleGroup = (cat) => GROUP[cat] || cat;

/**
 * doneAt: { muscleGroup: timestamp of the last completed set }
 * anyAt:  timestamp of the last completed set of any exercise
 */
export function restState(exercise, doneAt, anyAt, now = Date.now()) {
  const last = doneAt[muscleGroup(exercise.cat)];
  const same = last ? Math.max(0, exercise.rest - (now - last) / 1000) : 0;
  const sw = anyAt ? Math.max(0, SWITCH_GAP - (now - anyAt) / 1000) : 0;
  const remaining = Math.ceil(Math.max(same, sw));
  return { remaining, ready: remaining <= 0, reason: same >= sw ? 'same' : 'switch' };
}

/** Rounds a weight to the chosen plate step (e.g. 5, 2.5, 1). */
export function roundToStep(value, step) {
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n < 0) return '';
  if (!step) return String(n);
  const r = Math.round(n / step) * step;
  return String(Math.round(r * 100) / 100);
}
