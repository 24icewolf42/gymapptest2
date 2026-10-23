// Date helpers. Days are local calendar dates stored as "YYYY-MM-DD"; weeks start on Monday.

export const DOW = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DOW_LETTER = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));

/** JS getDay() (Sunday = 0) to Monday-first index (Monday = 0). */
export function mondayIndex(jsDay) {
  return (jsDay + 6) % 7;
}

export function ymd(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function isYmd(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function startOfWeek(d = new Date()) {
  return addDays(d, -mondayIndex(d.getDay()));
}

export function fmtShort(s) {
  const d = parseYmd(s);
  return d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()];
}

export function fmtLong(s) {
  const d = parseYmd(s);
  return DOW[mondayIndex(d.getDay())] + ', ' + d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()];
}

/** Stopwatch style: 5:07 or 1:05:07. */
export function fmtClock(totalSeconds) {
  const t = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = String(t % 60).padStart(2, '0');
  return h > 0 ? h + ':' + String(m).padStart(2, '0') + ':' + s : m + ':' + s;
}

/** Human duration: 45m or 1h 5m. */
export function fmtDuration(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600), m = Math.round((totalSeconds % 3600) / 60);
  return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
}

export function fmtTime(date) {
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
}

/** "Today", "Tomorrow", or "Fri 24 Oct". */
export function relativeDay(date, now = new Date()) {
  const diff = Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return DOW[mondayIndex(date.getDay())].slice(0, 3) + ' ' + date.getDate() + ' ' + MONTHS_SHORT[date.getMonth()];
}

/** "now", "in 25 min", "in 2 h", "10 min ago". */
export function relativeFromNow(date, now = new Date()) {
  const mins = Math.round((date - now) / 60000);
  if (Math.abs(mins) < 1) return 'now';
  const abs = Math.abs(mins);
  const text = abs < 60 ? abs + ' min' : abs < 60 * 24 ? Math.round(abs / 60) + ' h' : Math.round(abs / 1440) + ' d';
  return mins > 0 ? 'in ' + text : text + ' ago';
}

/** Value for <input type="datetime-local">. */
export function toLocalInput(date) {
  return ymd(date) + 'T' + fmtTime(date);
}
