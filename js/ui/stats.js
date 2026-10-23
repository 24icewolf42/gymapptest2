// Stats: totals, body weight and per-exercise progress.
import { $, html, render, on, toast } from '../core/dom.js';
import { ymd, fmtShort, fmtDuration } from '../core/dates.js';
import { state, setWeight, deleteWeight } from '../state.js';
import { totals, exerciseNames, liftPoints, streak, bestStreak } from '../domain/logs.js';
import { KEYS, read } from '../core/store.js';
import { weightTrend } from '../domain/weights.js';
import { lineChart } from './graph.js';
import { icons } from './icons.js';

const MIN_KG = 20, MAX_KG = 350;
let showEntries = false;
let showAllLifts = false;

function tiles() {
  const t = totals(state.logs, ymd().slice(0, 7));
  const st = streak(state.logs, state.bypass, state.schedule);
  const best = Math.max(bestStreak(state.logs, state.bypass, state.schedule), Number((read(KEYS.legacyStats, {}) || {}).best_streak) || 0);
  const tile = (value, label) => html`<div class="tile"><b>${value}</b><span>${label}</span></div>`;
  return html`<div class="tiles">${tile(t.workouts, 'Workouts')}${tile(t.month, 'This month')}${tile(t.seconds ? fmtDuration(t.seconds) : '–', 'Total time')}${tile(st + (best > st ? ' / ' + best : ''), best > st ? 'Streak / best' : 'Streak')}</div>`;
}

function weightCard() {
  const list = state.weights;
  const trend = weightTrend(list);
  const points = list.slice(-60).map((x) => ({ date: x.date, w: x.weight }));
  return html`<section class="card" id="weightCard">
    <header class="card-head"><h2>Body weight</h2>
      ${trend ? html`<div class="big-num">${trend.latest.weight}<small> kg</small>${trend.change ? html`<span class="delta">${trend.change > 0 ? '+' : ''}${trend.change} kg / 30 d</span>` : ''}</div>` : ''}</header>
    ${points.length > 1 ? lineChart(points, { label: 'Body weight over time' }) : ''}
    <form class="input-row" id="weightForm">
      <label class="sr-only" for="weightInput">Body weight in kg</label>
      <input class="input" id="weightInput" type="number" inputmode="decimal" step="0.1" min="${MIN_KG}" max="${MAX_KG}" placeholder="Today’s weight in kg">
      <button class="btn btn-primary" type="submit">Log</button>
    </form>
    ${list.length ? html`
      <button type="button" class="link-btn" data-toggle-entries aria-expanded="${showEntries ? 'true' : 'false'}">${showEntries ? 'Hide entries' : 'Show all ' + list.length + ' entries'}</button>
      ${showEntries ? html`<ol class="entries">${[...list].reverse().map((x) => html`<li><span>${fmtShort(x.date)}</span><b>${x.weight} kg</b><button type="button" class="icon-btn sm" data-del-weight="${x.date}" aria-label="Delete weigh-in from ${fmtShort(x.date)}">${icons.x}</button></li>`)}</ol>` : ''}`
      : html`<p class="muted small">Log your weight now and then to see the trend.</p>`}
  </section>`;
}

function liftCards() {
  const names = exerciseNames(state.logs);
  if (!names.length) return html`<div class="empty-inline"><p>No lifts yet.</p><p class="muted">Finish a workout and your progress shows up here.</p></div>`;
  const shown = showAllLifts ? names : names.slice(0, 12);
  return html`${shown.map((name) => {
    const p = liftPoints(state.logs, name);
    const best = Math.max(...p.map((x) => x.w));
    const diff = p.length > 1 ? Math.round((p[p.length - 1].w - p[0].w) * 10) / 10 : 0;
    return html`<section class="card lift">
      <header class="card-head"><div><h3>${name}</h3><small class="${diff > 0 ? 'up' : ''}">${p.length === 1 ? 'First session' : diff > 0 ? '▲ +' + diff + ' kg since the first session' : diff < 0 ? '▼ ' + diff + ' kg since the first session' : 'Same as the first session'}</small></div>
        <div class="big-num sm">${best}<small> kg best</small></div></header>
      ${lineChart(p.slice(-30), { markBest: true, label: name + ' progress' })}
      <p class="muted small">${p.length} ${p.length === 1 ? 'session' : 'sessions'} · ring marks your best</p></section>`;
  })}
  ${names.length > shown.length ? html`<button type="button" class="btn btn-ghost btn-block" data-all-lifts>Show all ${names.length} exercises</button>` : ''}`;
}

export function renderStats() {
  render($('page-stats'), html`
    <header class="top"><div><p class="eyebrow">Your progress</p><h1>Stats</h1></div>
      <button type="button" class="icon-btn" data-open-settings aria-label="Settings">${icons.settings}</button></header>
    ${tiles()}
    ${weightCard()}
    <h2 class="section-title">Lifts</h2>
    ${liftCards()}`);
}

export function initStats() {
  const page = $('page-stats');
  on(page, 'submit', '#weightForm', (e) => {
    e.preventDefault();
    const v = parseFloat($('weightInput').value);
    if (!(v >= MIN_KG && v <= MAX_KG)) { toast(`Enter a weight between ${MIN_KG} and ${MAX_KG} kg.`, { tone: 'error' }); return; }
    setWeight(ymd(), Math.round(v * 10) / 10);
    toast('Weight logged.');
  });
  on(page, 'click', '[data-toggle-entries]', () => { showEntries = !showEntries; renderStats(); });
  on(page, 'click', '[data-all-lifts]', () => { showAllLifts = true; renderStats(); });
  on(page, 'click', '[data-del-weight]', (e, b) => { deleteWeight(b.dataset.delWeight); toast('Weigh-in deleted.'); });
}
