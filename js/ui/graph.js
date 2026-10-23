// Small SVG line chart for lift and body-weight history.
import { html, raw } from '../core/dom.js';
import { parseYmd, fmtShort } from '../core/dates.js';

/** points: [{ date: 'YYYY-MM-DD', w: number }], oldest first. */
export function lineChart(points, { unit = 'kg', markBest = false, label = 'History' } = {}) {
  if (!points.length) return '';
  const W = 320, H = 132, L = 36, R = 14, T = 16, B = 24;
  const ws = points.map((p) => p.w);
  let min = Math.min(...ws), max = Math.max(...ws);
  if (min === max) { min -= 2; max += 2; }
  const pad = (max - min) * 0.2;
  min = Math.max(0, min - pad); max += pad;
  const ts = points.map((p) => parseYmd(p.date).getTime());
  const t0 = ts[0], span = (ts[ts.length - 1] - t0) || 1;
  const X = (t) => (points.length === 1 ? L + (W - L - R) / 2 : L + ((t - t0) / span) * (W - L - R));
  const Y = (w) => T + (1 - (w - min) / (max - min)) * (H - T - B);
  const f = (n) => n.toFixed(1);
  let grid = '';
  for (let i = 0; i < 3; i++) {
    const v = min + ((max - min) * i) / 2, y = Y(v);
    grid += `<line class="g-grid" x1="${L}" x2="${W - R}" y1="${f(y)}" y2="${f(y)}"/><text class="g-tick" x="${L - 6}" y="${f(y + 3)}" text-anchor="end">${Math.round(v * 10) / 10}</text>`;
  }
  const line = points.map((p, i) => f(X(ts[i])) + ',' + f(Y(p.w))).join(' ');
  const area = `${f(X(ts[0]))},${H - B} ${line} ${f(X(ts[ts.length - 1]))},${H - B}`;
  const dots = points.map((p, i) => `<circle class="g-dot" cx="${f(X(ts[i]))}" cy="${f(Y(p.w))}" r="2.6"/>`).join('');
  let best = '';
  if (markBest) {
    let bi = 0;
    ws.forEach((w, i) => { if (w >= ws[bi]) bi = i; });
    best = `<circle class="g-best" cx="${f(X(ts[bi]))}" cy="${f(Y(ws[bi]))}" r="6"/>`;
  }
  const last = points.length - 1;
  const labels = `<text class="g-tick" x="${L}" y="${H - 6}">${fmtShort(points[0].date)}</text>` +
    (points.length > 1 ? `<text class="g-tick" x="${W - R}" y="${H - 6}" text-anchor="end">${fmtShort(points[last].date)}</text>` : '') +
    `<text class="g-value" x="${f(Math.min(X(ts[last]), W - R))}" y="${f(Y(ws[last]) - 8)}" text-anchor="end">${ws[last]} ${unit}</text>`;
  // Every value interpolated above is a number or a formatted date, never user text.
  return html`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${raw(grid)}<polygon class="g-area" points="${area}"/><polyline class="g-line" points="${line}"/>${raw(dots + best + labels)}</svg>`;
}
