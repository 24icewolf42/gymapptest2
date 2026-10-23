// App start-up: load data, wire pages and events, then connect the cloud.
import { $, html, render, on, toast, enableArrowKeys } from './core/dom.js';
import { listen } from './core/store.js';
import { registerPage, initNav, go, refresh, currentPage } from './core/router.js';
import { loadState } from './state.js';
import { initAccount, onAccountSwitch } from './cloud/sync.js';
import { renderToday, initToday } from './ui/today.js';
import { renderPlan, initPlan, onPlanUpdated, leavePlan } from './ui/plan.js';
import { renderCalendar, initCalendar, onCalendarShown } from './ui/calendar.js';
import { renderStats, initStats } from './ui/stats.js';
import { renderCrew, initCrew, onCrewShown } from './ui/crew.js';
import { renderSettings, initSettings, openSettings, onSettingsShown } from './ui/settings.js';
import { initSession, getActive, isOpen, openSession } from './ui/session.js';
import { openSheet } from './ui/sheet.js';
import { navIcons } from './ui/icons.js';
import { initNative } from './native.js';
import { fmtClock } from './core/dates.js';

loadState();

// Bottom navigation
const NAV = [['today', 'Today'], ['plan', 'Plan'], ['calendar', 'Calendar'], ['stats', 'Stats'], ['crew', 'Crew']];
render($('bottomNav'), html`${NAV.map(([id, label]) => html`<button type="button" class="nav-btn${id === 'today' ? ' active' : ''}" data-page="${id}"${id === 'today' ? ' aria-current="page"' : ''}>${navIcons[id]}<span>${label}</span>${id === 'crew' ? html`<span class="badge" hidden></span>` : ''}</button>`)}`);

registerPage('today', { render: renderToday });
registerPage('plan', { render: renderPlan, leave: leavePlan });
registerPage('calendar', { render: renderCalendar, shown: onCalendarShown });
registerPage('stats', { render: renderStats });
registerPage('crew', { render: renderCrew, shown: onCrewShown });
registerPage('settings', { render: renderSettings, shown: onSettingsShown });

initToday();
initPlan();
initCalendar();
initStats();
initCrew();
initSettings();
initSession();
initNav();

on(document.body, 'click', '[data-open-settings]', openSettings);
enableArrowKeys();

// Re-render whatever is visible when data changes.
listen('gym:plan-updated', () => { if (currentPage() === 'plan') onPlanUpdated(); else refresh(); });
listen('gym:logs-updated', () => refresh());
listen('gym:weights-updated', () => refresh('stats'));
listen('gym:crew-updated', () => { if (['today', 'calendar'].includes(currentPage())) refresh(); });
listen('gym:storage-error', () => toast('This phone’s storage is full. Free up space or make a backup.', { tone: 'error', ms: 5000 }));

// "Workout running" bar while a started workout is closed.
const activeBar = $('activeBar');
let activeTimer = null;
function paintActive() {
  const a = getActive();
  const show = !!a && !isOpen();
  activeBar.hidden = !show;
  document.body.classList.toggle('has-active', show);
  clearInterval(activeTimer);
  if (!show) return;
  // render() patches in place, so only the clock text changes each second.
  const tick = () => render(activeBar, html`<button type="button" class="active-btn" aria-label="Open the running workout, ${a.day}"><span><small>Workout running</small><b>${a.day}</b></span><b class="clock" aria-hidden="true">${fmtClock((Date.now() - a.startedAt) / 1000)}</b></button>`);
  tick();
  activeTimer = setInterval(tick, 1000);
}
activeBar.addEventListener('click', () => { const a = getActive(); if (a) openSession(a.day, a.date, a.key ? { key: a.key } : {}); });
listen('gym:active-changed', () => { paintActive(); if (currentPage() === 'today') refresh('today'); });
paintActive();

// A different account signing in on this phone must not absorb the previous person's data.
onAccountSwitch(() => openSheet({
  title: 'Someone else used this phone',
  body: html`<p class="sheet-text">This phone has workouts from another account. What should happen to them?</p>`,
  actions: [
    { label: 'Replace with my account’s data', value: 'replace', tone: 'primary' },
    { label: 'Add them to my account', value: 'merge', tone: 'secondary' },
    { label: 'Cancel and sign out', value: 'cancel', tone: 'ghost' },
  ],
}).then((v) => v || 'cancel'));

go('today');
initAccount();
initNative();

// Hide the loading screen once the first page has painted.
requestAnimationFrame(() => setTimeout(() => {
  const ls = $('loadingScreen');
  if (!ls) return;
  ls.classList.add('gone');
  setTimeout(() => ls.remove(), 400);
}, 300));
