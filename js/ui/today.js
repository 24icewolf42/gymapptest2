// Today: this week, today's workout, gym dates and what is coming up.
import { $, html, render, on, busyAttr } from '../core/dom.js';
import { ymd, fmtLong, fmtShort, mondayIndex, addDays, startOfWeek, DOW, DOW_LETTER, MONTHS, fmtClock } from '../core/dates.js';
import { go, refresh } from '../core/router.js';
import { state, restImage } from '../state.js';
import { workoutSummary, estimateMinutes } from '../domain/plan.js';
import { streak } from '../domain/logs.js';
import { openSession, getActive } from './session.js';
import { todayTeaser, gymDateDays } from './crew.js';
import { pickWorkout, openDay } from './calendar.js';
import { icons } from './icons.js';

let upcomingDays = 14;

function loggedOn(date, day) {
  return (state.logs[date] || []).some((s) => !day || s.day === day);
}

function weekStrip() {
  const start = startOfWeek(), today = ymd(), dates = gymDateDays();
  return html`<ol class="week" aria-label="This week" data-key="week">${DOW_LETTER.map((letter, i) => {
    const d = addDays(start, i), ds = ymd(d), planned = state.schedule[i];
    const cls = ['week-day', planned ? 'planned' : 'rest', loggedOn(ds) ? 'done' : '', state.bypass[ds] ? 'bypass' : '', ds === today ? 'today' : '', dates.has(ds) ? 'has-date' : ''].filter(Boolean).join(' ');
    const label = DOW[i] + ': ' + (loggedOn(ds) ? 'trained' : planned ? planned : 'rest day') + (dates.has(ds) ? ', gym date' : '');
    return html`<li class="${cls}" aria-label="${label}"><span class="wd-letter" aria-hidden="true">${letter}</span><span class="wd-num" aria-hidden="true">${d.getDate()}</span></li>`;
  })}</ol>`;
}

function hero() {
  const today = ymd(), name = state.schedule[mondayIndex(new Date().getDay())];
  if (!Object.keys(state.workouts).length) {
    return html`<section class="card hero-card onboarding" data-key="hero">
      <span class="big-icon">${icons.dumbbell}</span>
      <h2>Build your first workout</h2>
      <p>Create routines like Push, Pull or Legs and put them on your week. Your log, stats and streak start from there.</p>
      <button type="button" class="btn btn-primary" data-go="plan">Open my plan</button></section>`;
  }
  if (!name) {
    let next = null;
    for (let k = 1; k <= 7; k++) { const j = (mondayIndex(new Date().getDay()) + k) % 7; if (state.schedule[j]) { next = { name: state.schedule[j], day: DOW[j] }; break; } }
    return html`<section class="card hero-card rest" data-key="hero">
      <img class="rest-img" src="${restImage()}" alt="">
      <div class="rest-copy"><p class="eyebrow">Rest day</p><h2>Recover and recharge</h2>
      <p class="muted">${next ? html`Next up: <b>${next.name}</b> on ${next.day}` : 'No workouts planned this week.'}</p></div>
      ${loggedOn(today) ? '' : html`<button type="button" class="btn btn-soft btn-sm" data-log-any>Train anyway</button>`}</section>`;
  }
  const list = state.workouts[name] || [];
  // The latest session of today's workout (the one "View or edit" opens).
  const session = (state.logs[today] || []).filter((s) => s.day === name).pop();
  const active = getActive();
  const running = active && active.day === name && active.date === today;
  if (session) {
    const sets = session.exercises.reduce((n, e) => n + e.sets.length, 0);
    return html`<section class="card hero-card done" data-key="hero">
      <p class="eyebrow">${icons.check} Done today</p>
      <h2 class="hero-title">${name}</h2>
      <p class="hero-meta">${[session.duration ? fmtClock(session.duration) : '', session.exercises.length + ' exercises', sets + ' sets'].filter(Boolean).join(' · ')}</p>
      <button type="button" class="btn btn-soft" data-start="${name}" data-key="hero-action">View or edit</button></section>`;
  }
  return html`<section class="card hero-card" data-key="hero">
    <p class="eyebrow">Today’s workout</p>
    <h2 class="hero-title">${name}</h2>
    <p class="hero-meta">${workoutSummary(list)} · ~${estimateMinutes(list)} min</p>
    ${list.length ? html`<ul class="tags">${list.slice(0, 5).map((e) => html`<li>${e.name}</li>`)}${list.length > 5 ? html`<li>+${list.length - 5}</li>` : ''}</ul>` : html`<p class="muted">This routine has no exercises yet.</p>`}
    <button type="button" class="btn btn-primary btn-lg" data-start="${name}" data-key="hero-action" id="startToday"${busyAttr(!list.length)}>${running ? 'Resume workout' : 'Start workout'}</button></section>`;
}

function upcoming() {
  const rows = [], now = new Date(), dates = gymDateDays();
  let month = now.getMonth();
  for (let i = 1; i <= upcomingDays; i++) {
    const d = addDays(now, i), ds = ymd(d), idx = mondayIndex(d.getDay()), w = state.schedule[idx];
    if (d.getMonth() !== month) { month = d.getMonth(); rows.push(html`<li class="up-month" data-key="m-${ds.slice(0, 7)}">${MONTHS[month]}</li>`); }
    const done = w && loggedOn(ds, w);
    const inner = html`<span class="up-day"><b>${DOW[idx].slice(0, 3)}</b><small>${fmtShort(ds)}</small></span>
      <span class="up-name">${w || 'Rest'}<small>${w ? (done ? 'Logged' : state.bypass[ds] ? 'Bypass day' : workoutSummary(state.workouts[w])) : ''}${dates.has(ds) ? ' · gym date' : ''}</small></span>`;
    // Rows are keyed by date; a rest day has nothing to open, so it is not a button.
    rows.push(w
      ? html`<li data-key="up-${ds}"><button type="button" class="up-row${done ? ' done' : ''}" data-preview="${ds}">${inner}<span class="chev">${icons.chevron}</span></button></li>`
      : html`<li data-key="up-${ds}"><div class="up-row rest">${inner}</div></li>`);
  }
  return html`<ol class="up-list" data-key="up-list">${rows}</ol>
    ${upcomingDays < 56 ? html`<button type="button" class="btn btn-ghost btn-block" data-more data-key="more">Show more days</button>` : ''}`;
}

export function renderToday() {
  const today = ymd();
  const st = streak(state.logs, state.bypass, state.schedule);
  render($('page-today'), html`
    <header class="top" data-key="top"><div><p class="eyebrow">${fmtLong(today)}</p><h1>Today</h1></div>
      <div class="top-actions">${st ? html`<span class="streak" role="img" aria-label="Training streak: ${st} ${st === 1 ? 'day' : 'days'}">${icons.flame} ${st}</span>` : ''}
      <button type="button" class="icon-btn" data-open-settings aria-label="Settings">${icons.settings}</button></div></header>
    ${weekStrip()}
    ${hero()}
    ${todayTeaser()}
    ${Object.keys(state.workouts).length ? html`<h2 class="section-title" data-key="up-title">Coming up</h2>${upcoming()}` : ''}`);
}

export function initToday() {
  const page = $('page-today');
  // The date is read when tapped, so a page left open overnight logs to the right day.
  on(page, 'click', '[data-start]', (e, b) => openSession(b.dataset.start, ymd()));
  // Upcoming days can be previewed (and marked as bypass) but not logged in advance.
  on(page, 'click', '[data-preview]', (e, b) => openDay(b.dataset.preview));
  on(page, 'click', '[data-go]', (e, b) => go(b.dataset.go));
  on(page, 'click', '[data-go-crew]', () => go('crew'));
  on(page, 'click', '[data-more]', () => { upcomingDays += 14; renderToday(); });
  on(page, 'click', '[data-log-any]', async () => {
    const name = await pickWorkout(ymd());
    if (name) openSession(name, ymd(), { fresh: true });
  });
  // Redraw when the app comes back and at midnight, so "today" is never stale.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshToday(); });
  scheduleMidnight();
}

let shownDay = ymd();
function refreshToday() {
  if (ymd() !== shownDay) { shownDay = ymd(); renderToday(); refresh(); }
}

function scheduleMidnight() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  setTimeout(() => { refreshToday(); scheduleMidnight(); }, next - now);
}
