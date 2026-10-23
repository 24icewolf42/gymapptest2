// Calendar: every month from the first log to six months ahead, with streak.
import { $, html, render, on, toast } from '../core/dom.js';
import { ymd, parseYmd, fmtLong, mondayIndex, MONTHS, DOW_LETTER, fmtDuration, fmtClock } from '../core/dates.js';
import { state, setBypass, deleteSession } from '../state.js';
import { streak, sessionKey } from '../domain/logs.js';
import { categoryLabel } from '../domain/catalog.js';
import { displaySets } from '../domain/plan.js';
import { openSession } from './session.js';
import { gymDateDays } from './crew.js';
import { openSheet, confirmDialog } from './sheet.js';
import { icons } from './icons.js';

const MONTHS_AHEAD = 6;

function monthGrid(y, m, today, dates) {
  const days = new Date(y, m + 1, 0).getDate(), first = mondayIndex(new Date(y, m, 1).getDay());
  let count = 0, seconds = 0;
  const cells = [];
  for (let i = 0; i < first; i++) cells.push(html`<span class="cal-cell empty" aria-hidden="true"></span>`);
  for (let d = 1; d <= days; d++) {
    const ds = ymd(new Date(y, m, d)), planned = state.schedule[mondayIndex(new Date(y, m, d).getDay())];
    const logs = state.logs[ds] || [];
    logs.forEach((s) => { count++; seconds += s.duration || 0; });
    const logged = logs.length > 0, bypass = !logged && !!state.bypass[ds];
    const secs = logs.reduce((n, s) => n + (s.duration || 0), 0);
    const tag = logged ? (logs.length > 1 ? logs.length + '× ' : '') + (secs ? shortTime(secs) : short(logs[0].day)) : bypass ? 'Bypass' : planned ? short(planned) : '';
    const cls = ['cal-cell', planned ? 'planned' : 'rest', logged ? 'logged' : '', bypass ? 'bypass' : '', ds === today ? 'today' : '', ds > today ? 'future' : '', dates.has(ds) ? 'has-date' : ''].filter(Boolean).join(' ');
    const label = fmtLong(ds) + ': ' + (logged ? 'trained ' + logs.map((s) => s.day).join(', ') : bypass ? 'bypass day' : planned || 'rest day') + (dates.has(ds) ? ', gym date' : '');
    cells.push(html`<button type="button" class="${cls}" data-day="${ds}" aria-label="${label}"><span class="cal-num">${d}</span><span class="cal-tag">${tag}</span></button>`);
  }
  return html`<section class="cal-month" data-month="${y}-${m}">
    <header class="cal-month-head"><h2>${MONTHS[m]} ${y}</h2><small>${count ? count + (count === 1 ? ' workout · ' : ' workouts · ') + fmtDuration(seconds) : ''}</small></header>
    <div class="cal-dow" aria-hidden="true">${DOW_LETTER.map((l) => html`<span>${l}</span>`)}</div>
    <div class="cal-grid">${cells}</div></section>`;
}

function shortTime(sec) {
  const m = Math.round(sec / 60);
  return m >= 60 ? Math.floor(m / 60) + 'h' + (m % 60 ? String(m % 60).padStart(2, '0') : '') : m + 'm';
}

function short(name) {
  return name === 'Full Body' ? 'Full' : String(name).slice(0, 6);
}

export function renderCalendar() {
  const now = new Date(), today = ymd(now), dates = gymDateDays();
  const firstLog = Object.keys(state.logs).sort()[0];
  let y = firstLog ? +firstLog.slice(0, 4) : now.getFullYear();
  let m = firstLog ? +firstLog.slice(5, 7) - 1 : now.getMonth();
  if (y * 12 + m > now.getFullYear() * 12 + now.getMonth()) { y = now.getFullYear(); m = now.getMonth(); }
  const end = now.getFullYear() * 12 + now.getMonth() + MONTHS_AHEAD;
  const months = [];
  while (y * 12 + m <= end) { months.push(monthGrid(y, m, today, dates)); m++; if (m > 11) { m = 0; y++; } }
  const st = streak(state.logs, state.bypass, state.schedule);
  render($('page-calendar'), html`
    <header class="top"><div><p class="eyebrow">${st ? st + (st === 1 ? ' training day in a row' : ' training days in a row') : 'Your training history'}</p><h1>Calendar</h1></div>
      <button type="button" class="btn btn-soft btn-sm" data-jump-today>Today</button></header>
    <div class="legend" aria-hidden="true"><span class="lg logged"></span>Trained <span class="lg planned"></span>Planned <span class="lg bypass"></span>Bypass <span class="lg has-date"></span>Gym date</div>
    ${months}`);
}

function scrollToThisMonth(smooth) {
  const now = new Date();
  const el = document.querySelector(`[data-month="${now.getFullYear()}-${now.getMonth()}"]`);
  if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 12, behavior: smooth ? 'smooth' : 'auto' });
}

/** Lets the user choose any routine to log on a date. Resolves with its name or null. */
export function pickWorkout(date) {
  const names = Object.keys(state.workouts);
  if (!names.length) { toast('Create a workout in your plan first.'); return Promise.resolve(null); }
  return openSheet({
    title: 'Which workout?',
    subtitle: fmtLong(date),
    body: html`<div class="list">${names.map((n) => html`<button type="button" class="row row-btn" data-pick="${n}"><div class="row-main"><b>${n}</b></div><span class="chev">${icons.chevron}</span></button>`)}</div>`,
    onMount: (sheet, close) => sheet.querySelectorAll('[data-pick]').forEach((b) => { b.onclick = () => close(b.dataset.pick); }),
  });
}

async function openDay(ds) {
  const planned = state.schedule[mondayIndex(parseYmd(ds).getDay())];
  const logs = state.logs[ds] || [];
  const today = ymd();
  if (logs.length) {
    const action = await openSheet({
      title: fmtLong(ds),
      subtitle: logs.length === 1 ? '1 workout logged' : logs.length + ' workouts logged',
      body: html`${logs.map((s) => html`
        <section class="log-session">
          <header class="log-head"><h3>${s.day}</h3><small>${s.duration ? fmtClock(s.duration) : ''}</small></header>
          ${s.exercises.map((e) => html`<div class="log-ex"><b>${e.name}</b>
            <ol class="log-sets">${e.sets.map((x) => html`<li><span>${x.w || '–'} kg × ${x.r || '–'}</span>${x.done ? html`<i aria-label="done">${icons.check}</i>` : ''}</li>`)}</ol></div>`)}
          <div class="btn-row">
            <button type="button" class="btn btn-soft btn-sm" data-edit="${sessionKey(ds, s)}" data-name="${s.day}">${icons.edit} Edit</button>
            <button type="button" class="btn btn-ghost btn-sm danger" data-del="${sessionKey(ds, s)}" data-name="${s.day}">${icons.trash} Delete</button>
          </div>
        </section>`)}`,
      actions: ds <= today ? [{ label: 'Log another workout', tone: 'secondary', value: { add: true } }] : [],
      onMount: (sheet, close) => {
        sheet.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => close({ edit: b.dataset.edit, name: b.dataset.name }); });
        sheet.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => close({ del: b.dataset.del, name: b.dataset.name }); });
      },
    });
    if (!action) return;
    if (action.edit) openSession(action.name, ds, { key: action.edit });
    if (action.add) { const n = await pickWorkout(ds); if (n) openSession(n, ds, { fresh: true }); }
    if (action.del && await confirmDialog(`The ${action.name} workout on ${fmtLong(ds)} will be deleted from all your devices.`, { title: 'Delete this workout?', ok: 'Delete', danger: true })) {
      deleteSession(ds, action.del);
      toast('Workout deleted.');
    }
    return;
  }
  if (!planned) {
    if (ds > today) { toast('Rest day'); return; }
    const n = await pickWorkout(ds);
    if (n) openSession(n, ds);
    return;
  }
  const list = state.workouts[planned] || [];
  const isBypass = !!state.bypass[ds];
  const action = await openSheet({
    title: fmtLong(ds),
    subtitle: planned + (isBypass ? ' · bypass day' : ''),
    body: html`<div class="list">${list.map((e) => html`<div class="row"><div class="row-main"><b>${e.name}</b><small>${categoryLabel(e.cat)}</small></div><span class="row-end muted">${displaySets(e)} sets${e.unilateral ? ' · L/R' : ''}</span></div>`)}</div>
      <p class="hint">A bypass day keeps your streak when you could not train, for example when you were ill.</p>`,
    actions: [
      { label: isBypass ? 'Remove bypass' : 'Mark as bypass day', tone: 'ghost', value: 'bypass' },
      ...(ds <= today ? [{ label: 'Log ' + planned, tone: 'primary', value: 'start' }] : []),
    ],
  });
  if (action === 'start') openSession(planned, ds);
  if (action === 'bypass') {
    setBypass(ds, !isBypass);
    toast(isBypass ? 'Bypass removed.' : 'Marked as bypass day.');
  }
}

export function initCalendar() {
  const page = $('page-calendar');
  on(page, 'click', '[data-day]', (e, b) => openDay(b.dataset.day));
  on(page, 'click', '[data-jump-today]', () => scrollToThisMonth(true));
}

export function onCalendarShown() {
  requestAnimationFrame(() => scrollToThisMonth(false));
}
