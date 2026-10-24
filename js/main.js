// App start-up: load data, wire pages and events, then connect the cloud.
import { $, html, render, on, toast, enableArrowKeys } from './core/dom.js';
import { listen } from './core/store.js';
import { registerPage, initNav, go, refresh, currentPage, TABS } from './core/router.js';
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
const NAV_LABELS = { today: 'Today', plan: 'Plan', calendar: 'Calendar', stats: 'Stats', crew: 'Crew' };
render($('bottomNav'), html`${TABS.map((id) => html`<button type="button" class="nav-btn${id === 'today' ? ' active' : ''}" data-page="${id}"${id === 'today' ? html` aria-current="page"` : ''}>${navIcons[id]}<span>${NAV_LABELS[id]}</span>${id === 'crew' ? html`<span class="badge" hidden></span>` : ''}</button>`)}`);

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
  if (!show && !activeBar.hidden && activeBar.contains(document.activeElement)) {
    // The workout ended elsewhere (another tab): keep focus on the page.
    const to = document.querySelector('.page.active [data-start], .page.active h1');
    if (to?.matches('h1') && !to.hasAttribute('tabindex')) to.setAttribute('tabindex', '-1');
    to?.focus({ preventScroll: true });
  }
  activeBar.hidden = !show;
  document.body.classList.toggle('has-active', show);
  clearInterval(activeTimer);
  if (!show) return;
  // render() patches in place, so only the clock text changes each second.
  const tick = () => {
    // The running state expires after 12 hours; stop showing it then.
    if (!getActive()) { paintActive(); return; }
    render(activeBar, html`<button type="button" class="active-btn" aria-label="Open the running workout, ${a.day}"><span><small>Workout running</small><b>${a.day}</b></span><b class="clock" aria-hidden="true">${fmtClock((Date.now() - a.startedAt) / 1000)}</b></button>`);
  };
  tick();
  activeTimer = setInterval(tick, 1000);
}
activeBar.addEventListener('click', () => { const a = getActive(); if (a) openSession(a.day, a.date, a.key ? { key: a.key } : {}); });
listen('gym:active-changed', () => { paintActive(); if (currentPage() === 'today') refresh('today'); });
paintActive();

// Another tab or window of the app changed the data: load it at once, so
// neither copy overwrites the other. An open workout keeps its own exercise
// list, and saving it re-reads the logs, so it is safe to reload under it.
window.addEventListener('storage', (e) => {
  if (e.key !== null && !e.key.startsWith('gym')) return;
  loadState();
  paintActive();
  refresh();
});

// An account this phone's data did not come from signed in: nothing joins it
// without asking, and the question names the account.
onAccountSwitch(({ email, first }) => openSheet(first ? {
  dismissible: false,
  title: 'Add this phone’s workouts to this account?',
  body: html`<p class="sheet-text">You are signed in as <b>${email}</b>. The workouts, plan and weigh-ins on this phone will be saved in that account. If you did not sign in yourself, sign out.</p>`,
  actions: [
    { label: 'Add them to this account', value: 'merge', tone: 'primary' },
    { label: 'Sign out', value: 'cancel', tone: 'ghost' },
  ],
} : {
  dismissible: false,
  title: 'Someone else used this phone',
  body: html`<p class="sheet-text">You are signed in as <b>${email}</b>, but this phone has workouts from another account. What should happen to them?</p>`,
  actions: [
    { label: 'Replace with my account’s data', value: 'replace', tone: 'primary' },
    { label: 'Add them to my account', value: 'merge', tone: 'secondary' },
    { label: 'Cancel and sign out', value: 'cancel', tone: 'ghost' },
  ],
}).then((v) => {
  if (!v || v === 'cancel') toast('Signed out. Nothing from this phone was added to that account.');
  return v || 'cancel';
}));

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
