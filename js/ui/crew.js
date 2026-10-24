// Crew tab: gym dates, friends and the leaderboard. All server traffic runs in
// the background; results patch the page in place (render() keeps focus).
import { $, html, render, on, toast, avatar, haptic, busyAttr } from '../core/dom.js';
import { KEYS, read, write, listen, emit } from '../core/store.js';
import { ymd, fmtTime, relativeDay, relativeFromNow, toLocalInput } from '../core/dates.js';
import { refresh, currentPage } from '../core/router.js';
import { state, createWorkout, streaks } from '../state.js';
import { supabase, cloudConfigured } from '../cloud/client.js';
import { account } from '../cloud/sync.js';
import * as social from '../cloud/social.js';
import * as api from '../cloud/gym-dates.js';
import {
  DURATIONS, QUICK_STARTS, phase, canCheckIn, quickStartTime, validateDraft, groupDates, unanswered, rememberGym, startOf,
} from '../domain/gym-dates.js';
import { leaderboardStats } from '../domain/logs.js';
import { sanitizeWorkoutName, workoutSummary, deepPlain } from '../domain/plan.js';
import { openSheet, confirmDialog, promptDialog } from './sheet.js';
import { icons } from './icons.js';

const REFRESH_MS = 60000;

const crew = {
  tab: 'dates',
  friendships: null,
  dates: null,
  leaderboard: null,
  shared: null,
  missingDates: false,
  error: '',
  loadedFor: null,
};

const me = () => account.user && account.user.id;
const pending = new Set(); // keys of actions in flight, to block double taps

// ---------- data ----------
let loading = null, reloadAfter = false;
let retrying = false; // a "Try again" the user pressed is running
/** Reloads friends and dates. A call while a load runs queues one more, so writes are never shown stale. */
function refreshCrew() {
  if (!account.user || !account.ready) return Promise.resolve();
  if (loading) { reloadAfter = true; return loading; }
  const forUser = me();
  loading = (async () => {
    const [f, d] = await Promise.all([social.loadFriendships(), api.loadDates()]);
    if (me() !== forUser) return; // signed out or switched account meanwhile
    crew.error = (f.error && !f.missing ? f.error : '') || (d.error && !d.missing ? d.error : '');
    if (!f.error) crew.friendships = f.data;
    crew.missingDates = !!d.missing;
    if (!d.error) crew.dates = d.data;
    crew.loadedFor = forUser;
    updateBadge();
    emit('gym:crew-updated');
    if (currentPage() === 'crew') renderCrew();
  })().finally(() => {
    loading = null;
    if (reloadAfter) { reloadAfter = false; refreshCrew(); }
  });
  return loading;
}

async function loadTabData() {
  const forUser = me();
  if (!forUser) return;
  if (crew.tab === 'ranking') {
    const r = await social.loadLeaderboard(crew.friendships?.friends || []);
    if (me() !== forUser) return;
    crew.leaderboard = r.error ? { error: r.error } : r.data;
  }
  if (crew.tab === 'friends') {
    const r = await social.loadSharedWorkouts();
    if (me() !== forUser) return;
    crew.shared = r.error ? { error: r.error } : r.data;
  }
  if (currentPage() === 'crew') renderCrew();
}

function clearCrew() {
  Object.assign(crew, { friendships: null, dates: null, leaderboard: null, shared: null, error: '', loadedFor: null, missingDates: false });
  updateBadge();
}

function usernameOf(userId) {
  if (userId === me()) return account.profile?.username || 'you';
  return crew.friendships?.friends.find((f) => f.userId === userId)?.username || null;
}

function hostLabel(d) {
  return d.host_id === me() ? 'You' : '@' + (d.host?.username || usernameOf(d.host_id) || 'friend');
}

function myUpcomingDates() {
  if (!crew.dates || !me()) return [];
  return crew.dates.dates.filter((d) => ['live', 'upcoming'].includes(phase(d)) &&
    (d.host_id === me() || crew.dates.rsvps.some((r) => r.date_id === d.id && r.user_id === me() && r.status === 'going')));
}

/** Days ('YYYY-MM-DD') with a gym date I host or am going to. */
export function gymDateDays() {
  return new Set(myUpcomingDates().map((d) => ymd(startOf(d))));
}

function updateBadge() {
  const n = crew.dates && me() ? unanswered(crew.dates.dates, crew.dates.rsvps, me()).length : 0;
  const badge = document.querySelector('.nav-btn[data-page="crew"] .badge');
  if (badge) { badge.textContent = n ? String(n) : ''; badge.hidden = !n; }
  document.querySelector('.nav-btn[data-page="crew"]')?.setAttribute('aria-label', n ? `Crew, ${n} new gym date${n === 1 ? '' : 's'}` : 'Crew');
}

/** Card for the Today page: my next gym date, or friends' dates waiting for an answer. */
export function todayTeaser() {
  if (!account.user || !crew.dates) return '';
  const next = myUpcomingDates()[0];
  const open = unanswered(crew.dates.dates, crew.dates.rsvps, me());
  if (!next && !open.length) return '';
  if (next) {
    const live = phase(next) === 'live';
    return html`<button type="button" class="teaser" data-go-crew data-key="teaser">
      <span class="teaser-icon">${icons.users}</span>
      <span class="teaser-copy"><small>${live ? 'Gym date · live now' : 'Next gym date'}</small>
        <b>${relativeDay(startOf(next))} ${fmtTime(startOf(next))} · ${next.gym}</b>
        <small>${hostLabel(next)}${countText(next) ? ' · ' + countText(next) : ''}</small></span>
      <span class="chev">${icons.chevron}</span></button>`;
  }
  return html`<button type="button" class="teaser" data-go-crew data-key="teaser">
    <span class="teaser-icon">${icons.users}</span>
    <span class="teaser-copy"><small>Gym dates</small><b>${open.length} gym date${open.length === 1 ? '' : 's'} from friends</b><small>Tap to join or reply</small></span>
    <span class="chev">${icons.chevron}</span></button>`;
}

function countText(d) {
  const c = crew.dates?.counts[d.id];
  if (!c) return '';
  return [c.going ? c.going + ' going' : '', c.maybe ? c.maybe + ' maybe' : '', c.here ? c.here + ' there now' : ''].filter(Boolean).join(' · ');
}

// ---------- rendering ----------
const SECTIONS = [['dates', 'Gym dates'], ['friends', 'Friends'], ['ranking', 'Ranking']];

export function renderCrew() {
  const page = $('page-crew');
  const head = (view) => html`<header class="top" data-view="${view}"><div><p class="eyebrow">Train together</p><h1>Crew</h1></div>
    <button type="button" class="icon-btn" data-open-settings aria-label="Settings">${icons.settings}</button></header>`;
  if (!cloudConfigured()) {
    render(page, html`${head('none')}<div class="card empty"><h2>Accounts are not available</h2><p>This version of the app was built without accounts, so friends and gym dates are off.</p></div>`);
    return;
  }
  if (!account.user) {
    render(page, html`${head('signed-out')}
      <div class="card hero-card crew-intro">
        <span class="big-icon">${icons.users}</span>
        <h2>Go to the gym together</h2>
        <p>Post when you are heading to the gym, see which friends are going, and join them, even last minute. Only friends you accept can see your plans.</p>
        <button type="button" class="btn btn-primary" data-open-settings>Sign in or create an account</button>
      </div>`);
    return;
  }
  if (crew.loadedFor !== me() && !loading) refreshCrew();
  const incoming = crew.friendships?.incoming.length || 0;
  render(page, html`${head('crew')}
    <div class="segmented" role="tablist" aria-label="Crew sections">
      ${SECTIONS.map(([id, label]) => html`<button type="button" role="tab" id="crew-tab-${id}" aria-controls="crew-panel" aria-selected="${crew.tab === id ? 'true' : 'false'}" tabindex="${crew.tab === id ? '0' : '-1'}" data-crew-tab="${id}">${label}${id === 'friends' && incoming ? html`<span class="dot-badge" aria-hidden="true">${incoming}</span><span class="sr-only">, ${incoming} new</span>` : ''}</button>`)}
    </div>
    ${crew.error || retrying ? html`<div class="notice error" data-key="crew-error"><span>${crew.error || 'Loading…'}</span> <button type="button" class="link-btn inline" data-retry${busyAttr(retrying)}>${retrying ? 'Trying…' : 'Try again'}</button></div>` : ''}
    <div id="crew-panel" role="tabpanel" aria-labelledby="crew-tab-${crew.tab}">
      <div data-key="panel-${crew.tab}">${crew.tab === 'dates' ? datesPanel() : crew.tab === 'friends' ? friendsPanel() : rankingPanel()}</div>
    </div>`);
}

function loadingCard(text) {
  return crew.error ? '' : html`<div class="card skeleton" aria-busy="true"><p>${text}</p></div>`;
}

function datesPanel() {
  if (crew.missingDates) {
    return html`<div class="card empty"><h2>Gym dates are not available yet</h2><p>The app's server needs an update before gym dates work. Everything else works as usual.</p></div>`;
  }
  if (!crew.dates || !crew.friendships) return loadingCard('Loading gym dates…');
  const hasFriends = crew.friendships.friends.length > 0;
  const groups = groupDates(crew.dates.dates);
  const section = (title, list) => (list.length ? html`<h2 class="section-title" data-key="sec-${title}">${title}</h2>${list.map(dateCard)}` : '');
  const any = groups.live.length + groups.today.length + groups.tomorrow.length + groups.later.length;
  return html`
    <section class="card quick-card" data-key="quick">
      <div class="quick-head"><span class="big-icon small">${icons.bolt}</span><div><h2>Heading to the gym?</h2><p>Let your friends know so they can join.</p></div></div>
      <div class="chips wrap no-swipe">
        ${QUICK_STARTS.map((q) => html`<button type="button" class="chip chip-lg" data-quick="${q.minutes}">${q.label}</button>`)}
        <button type="button" class="chip chip-lg chip-outline" data-quick="later">Plan later</button>
      </div>
      ${hasFriends ? '' : html`<p class="hint">Add friends first. Only accepted friends can see your gym dates.</p>`}
    </section>
    ${section('Live now', groups.live)}
    ${section('Today', groups.today)}
    ${section('Tomorrow', groups.tomorrow)}
    ${section('Coming up', groups.later)}
    ${any ? '' : html`<div class="empty-inline" data-key="no-dates"><p>No gym dates yet.</p><p class="muted">Post one and your friends can join you.</p></div>`}`;
}

function dateCard(d) {
  const p = phase(d);
  const mine = d.host_id === me();
  const myReply = crew.dates.rsvps.find((r) => r.date_id === d.id && r.user_id === me());
  const status = mine ? 'going' : myReply?.status;
  const replies = crew.dates.rsvps.filter((r) => r.date_id === d.id && r.status !== 'no');
  const c = crew.dates.counts[d.id] || { going: replies.filter((r) => r.status === 'going').length, maybe: 0, here: 0 };
  const hidden = Math.max(0, c.going + c.maybe - replies.length);
  const invites = mine && d.invite_only ? crew.dates.invites.filter((i) => i.date_id === d.id).length : 0;
  const checkedIn = !!myReply?.checked_in_at;
  const start = startOf(d);
  const name = (r) => r.user?.username || usernameOf(r.user_id) || 'friend';
  const going = replies.filter((r) => r.status === 'going').map(name);
  const maybe = replies.filter((r) => r.status === 'maybe').map(name);
  const here = replies.filter((r) => r.checked_in_at).map(name);
  const peopleText = [going.length ? 'Going: ' + going.join(', ') : '', maybe.length ? 'Maybe: ' + maybe.join(', ') : '', hidden ? hidden + ' more' : '', here.length ? 'At the gym: ' + here.join(', ') : ''].filter(Boolean).join('. ') || 'Nobody has replied yet.';
  const busy = pending.has('date:' + d.id);
  return html`
    <article class="date-card${p === 'live' ? ' live' : ''}${mine ? ' mine' : ''}" data-date-id="${d.id}" data-key="date-${d.id}" aria-labelledby="when-${d.id}">
      <header class="date-head">
        ${avatar(mine ? account.profile?.username : d.host?.username)}
        <div class="date-who"><b>${hostLabel(d)}</b><small>${mine ? 'Your gym date' : 'wants to train'}</small></div>
        <span class="pill${p === 'live' ? ' pill-live' : ''}">${p === 'live' ? 'Live now' : relativeFromNow(start)}</span>
      </header>
      <h3 class="date-when" id="when-${d.id}">${relativeDay(start)} · ${fmtTime(start)} <span class="muted">· ${d.duration_min} min</span></h3>
      <p class="date-meta"><span>${icons.pin} ${d.gym}</span>${d.workout ? html`<span>${icons.dumbbell} ${d.workout}</span>` : ''}${d.invite_only ? html`<span>${icons.users} ${mine ? invites + ' invited' : 'Invite only'}</span>` : ''}</p>
      ${d.note ? html`<p class="date-note">${d.note}</p>` : ''}
      <div class="people">
        <div class="avatars" aria-hidden="true">${replies.slice(0, 6).map((r) => html`<span class="avatar-wrap${r.checked_in_at ? ' here' : ''}">${avatar(name(r))}</span>`)}${hidden ? html`<span class="avatar avatar-more">+${hidden}</span>` : ''}</div>
        <small aria-hidden="true">${countText(d) || 'Be the first to join'}</small>
        <span class="sr-only">${peopleText}</span>
      </div>
      ${mine ? '' : html`
        <div class="rsvp" role="radiogroup" aria-label="Your answer" data-manual>
          ${[['going', 'Going'], ['maybe', 'Maybe'], ['no', 'Can’t']].map(([v, l], i) => html`<button type="button" role="radio" class="rsvp-btn${status === v ? ' on' : ''}" aria-checked="${status === v ? 'true' : 'false'}" tabindex="${status === v || (!status && i === 0) ? '0' : '-1'}" data-reply="${v}"${busyAttr(busy)}>${l}</button>`)}
        </div>`}
      <div class="date-actions">
        ${(mine || status === 'going' || status === 'maybe') && canCheckIn(d) ? (checkedIn
          ? html`<span class="pill pill-ok" tabindex="-1" data-key="checkin-${d.id}">${icons.check} You are at the gym</span>`
          : html`<button type="button" class="btn btn-primary btn-sm" data-key="checkin-${d.id}" data-checkin${busyAttr(busy)}>${icons.pin} I’m here</button>`) : ''}
        ${mine ? html`<button type="button" class="btn btn-ghost btn-sm" data-cancel-date${busyAttr(busy)}>Cancel date</button>` : ''}
      </div>
    </article>`;
}

function friendsPanel() {
  const f = crew.friendships;
  if (!f) return loadingCard('Loading friends…');
  const shared = crew.shared;
  return html`
    <form class="card add-friend" id="addFriendForm" data-key="add-friend">
      <label class="field-label" for="friendName">Add a friend by username</label>
      <div class="input-row"><span class="input-prefix" aria-hidden="true">@</span><input class="input" id="friendName" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="21" placeholder="username" enterkeyhint="send"><button class="btn btn-primary" type="submit"${busyAttr(pending.has('add'))}>Add</button></div>
      <p class="hint">Your username is <b>@${account.profile?.username || '…'}</b>. Share it with friends so they can add you.</p>
    </form>
    ${f.incoming.length ? html`<h2 class="section-title" data-key="req-title">Requests</h2><div class="card list" data-key="req-list">${f.incoming.map((x) => html`
      <div class="row row-request" data-key="req-${x.id}">${avatar(x.username)}<div class="row-main"><b>@${x.username}</b><small>wants to be friends</small></div>
        <button type="button" class="btn btn-primary btn-sm" data-accept="${x.id}"${busyAttr(pending.has(x.id))} aria-label="Accept request from ${x.username}">Accept</button>
        <button type="button" class="btn btn-ghost btn-sm" data-decline="${x.id}" data-user="${x.userId}" data-name="${x.username}"${busyAttr(pending.has(x.id))} aria-label="Decline request from ${x.username}">Decline</button></div>`)}</div>` : ''}
    <h2 class="section-title" data-key="friends-title">Friends ${f.friends.length ? html`<span class="muted">${f.friends.length}</span>` : ''}</h2>
    ${f.friends.length ? html`<div class="card list" data-key="friends-list">${f.friends.map((x) => html`
      <div class="row" data-key="friend-${x.id}">${avatar(x.username)}<div class="row-main"><b>@${x.username}</b></div>
        <button type="button" class="icon-btn" data-unfriend="${x.id}" data-user="${x.userId}" data-name="${x.username}"${busyAttr(pending.has(x.id))} aria-label="Remove or block ${x.username}">${icons.x}</button></div>`)}</div>`
      : html`<div class="empty-inline" data-key="no-friends"><p>No friends yet.</p><p class="muted">Add someone by their username above.</p></div>`}
    ${f.outgoing.length ? html`<h2 class="section-title" data-key="sent-title">Sent</h2><div class="card list" data-key="sent-list">${f.outgoing.map((x) => html`
      <div class="row" data-key="out-${x.id}">${avatar(x.username)}<div class="row-main"><b>@${x.username}</b><small>waiting for an answer</small></div>
        <button type="button" class="btn btn-ghost btn-sm" data-cancel-request="${x.id}"${busyAttr(pending.has(x.id))} aria-label="Cancel request to ${x.username}">Cancel</button></div>`)}</div>` : ''}
    <h2 class="section-title" data-key="shared-title">Shared routines</h2>
    ${!shared ? html`<p class="muted" data-key="shared-loading">Loading…</p>` : shared.error ? html`<p class="notice error" data-key="shared-error">${shared.error} <button type="button" class="link-btn inline" data-retry${busyAttr(retrying)}>${retrying ? 'Trying…' : 'Try again'}</button></p>` : shared.length ? html`<div class="card list" data-key="shared-list">${shared.map((x) => html`
      <div class="row" data-key="shared-${x.id}"><div class="row-main"><b>${x.title}</b><small>${x.mine ? 'Shared by you' : '@' + (x.owner?.username || 'friend')} · ${workoutSummary(x.workout)}</small></div>
        ${x.mine ? html`<button type="button" class="btn btn-ghost btn-sm" data-unshare="${x.id}" aria-label="Stop sharing ${x.title}">Remove</button>` : html`<button type="button" class="btn btn-soft btn-sm" data-copy-shared="${x.id}" aria-label="Copy ${x.title} to my plan">${icons.copy} Copy</button>`}</div>`)}</div>`
      : html`<p class="muted small" data-key="shared-none">Routines you or your friends share from the Plan tab show up here.</p>`}`;
}

function timeText(seconds) {
  return seconds >= 3600 ? Math.round(seconds / 3600) + ' h' : Math.round(seconds / 60) + ' min';
}

function rankingPanel() {
  const lb = crew.leaderboard;
  if (!lb) return loadingCard('Loading ranking…');
  if (lb.error) return html`<p class="notice error">${lb.error} <button type="button" class="link-btn inline" data-retry${busyAttr(retrying)}>${retrying ? 'Trying…' : 'Try again'}</button></p>`;
  const shared = lb.filter((r) => r.workouts_count != null).sort((a, b) => (b.workouts_count || 0) - (a.workouts_count || 0));
  const notShared = lb.filter((r) => r.workouts_count == null);
  const mine = lb.find((r) => r.user_id === me());
  const published = mine && mine.workouts_count != null;
  const row = (r, rank) => html`
    <div class="row${r.user_id === me() ? ' me' : ''}" data-key="rank-${r.user_id}">
      <span class="rank"><span aria-hidden="true">${rank || '–'}</span><span class="sr-only">${rank ? 'Rank ' + rank : 'Not ranked'}</span></span>${avatar(r.username)}
      <div class="row-main"><b>@${r.username}${r.user_id === me() ? ' (you)' : ''}</b>
        <small>${r.workouts_count == null ? 'Stats not shared' : [r.workouts_count + (r.workouts_count === 1 ? ' workout' : ' workouts'), Number(r.volume_kg_reps || 0).toLocaleString() + ' kg·reps', r.total_seconds ? timeText(r.total_seconds) : '', r.current_streak ? r.current_streak + '-day streak' : ''].filter(Boolean).join(' · ')}${r.routines != null ? ' · ' + r.routines + (r.routines === 1 ? ' routine' : ' routines') : ''}</small></div>
      <span class="row-end">${r.weight_kg == null ? '' : html`<b>${Number(r.weight_kg).toFixed(1)} kg</b><small>${r.weight_date || ''}</small>`}</span>
    </div>`;
  return html`
    <section class="card">
      <h2>Your stats</h2>
      <p class="muted small">${published
        ? 'Friends see your number of workouts, total kg × reps and training time, which update by themselves after each synced workout, plus your streak and how many routines you have (Update refreshes those).'
        : 'Share your number of workouts, total kg × reps, training time, streak and how many routines you have with your friends. The totals then update after each synced workout, so friends can tell when you trained and for how long. Your sets stay private.'}</p>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" data-publish${busyAttr(pending.has('publish'))}>${published ? 'Update my stats' : 'Share my stats'}</button>
        ${published ? html`<button type="button" class="btn btn-ghost" data-unpublish${busyAttr(pending.has('publish'))}>Stop sharing</button>` : ''}
      </div>
    </section>
    <div class="card list ranking">
      ${shared.map((r, i) => row(r, i + 1))}
      ${notShared.map((r) => row(r, 0))}
    </div>
    <p class="hint">Body weight shows only for people who turned on weight sharing in Settings.</p>`;
}

// ---------- create a gym date ----------
async function openDateSheet(minutes) {
  const gyms = read(KEYS.gyms, []);
  const now = new Date();
  const start = minutes === 'later' ? quickStartTime(120, now) : quickStartTime(minutes, now);
  const friends = crew.friendships?.friends || [];
  const todays = state.schedule[(now.getDay() + 6) % 7];
  const workouts = Object.keys(state.workouts);
  let duration = 90;
  const result = await openSheet({
    title: minutes === 0 ? 'Going to the gym now' : 'Plan a gym date',
    subtitle: 'Only your friends can see this.',
    className: 'date-sheet',
    body: html`
      <label class="field"><span>Gym</span>
        <input class="input" name="gym" list="gymList" maxlength="60" value="${gyms[0] || ''}" placeholder="e.g. McFit Mitte" autocomplete="off" ${gyms[0] ? '' : 'autofocus'}>
        <datalist id="gymList">${gyms.map((g) => html`<option value="${g}"></option>`)}</datalist>
      </label>
      <label class="field"><span>Start</span>
        <input class="input" type="datetime-local" name="start" value="${toLocalInput(start)}" min="${toLocalInput(new Date(now.getTime() - 5 * 60000))}">
      </label>
      <div class="field"><span id="durLabel">How long</span>
        <div class="chips wrap" role="radiogroup" aria-labelledby="durLabel">${DURATIONS.map((m) => html`<button type="button" class="chip${m === duration ? ' on' : ''}" role="radio" aria-checked="${m === duration ? 'true' : 'false'}" tabindex="${m === duration ? '0' : '-1'}" data-duration="${m}">${m < 60 ? m + ' min' : m / 60 + ' h'}</button>`)}</div>
      </div>
      <label class="field"><span>Workout (optional)</span>
        <select class="input" name="workout"><option value="">No plan, just training</option>${workouts.map((w) => html`<option value="${w}"${w === todays ? ' selected' : ''}>${w}</option>`)}</select>
      </label>
      <label class="field"><span>Note (optional)</span>
        <textarea class="input" name="note" maxlength="200" rows="2" placeholder="Meet at the entrance, bring chalk…"></textarea>
      </label>
      ${friends.length ? html`
        <fieldset class="field who"><legend>Who can see it</legend>
          <label class="radio"><input type="radio" name="who" value="all" checked> All friends</label>
          <label class="radio"><input type="radio" name="who" value="some"> Only friends I pick</label>
          <div class="friend-picks" hidden>${friends.map((f) => html`<label class="check-row"><input type="checkbox" name="invite" value="${f.userId}"> @${f.username}</label>`)}</div>
        </fieldset>` : html`<p class="hint">You have no friends added yet, so nobody will see this until you add some.</p>`}
      <p class="form-error" aria-live="polite"></p>`,
    actions: [{ label: 'Post gym date', tone: 'primary', submit: true, onClick: (finish, sheet) => submit(finish, sheet) }, { label: 'Cancel', tone: 'ghost', value: null }],
    onMount: (sheet) => {
      sheet.querySelectorAll('[data-duration]').forEach((b) => {
        b.onclick = () => {
          duration = +b.dataset.duration;
          sheet.querySelectorAll('[data-duration]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); x.setAttribute('tabindex', x === b ? '0' : '-1'); });
        };
      });
      sheet.querySelectorAll('input[name=who]').forEach((r) => { r.onchange = () => { sheet.querySelector('.friend-picks').hidden = sheet.querySelector('input[name=who]:checked').value !== 'some'; }; });
    },
  });

  async function submit(finish, sheet) {
    const form = (n) => sheet.querySelector(`[name=${n}]`);
    const err = sheet.querySelector('.form-error');
    // "Now" stays now: if the start field was not changed, use the current time.
    const startField = form('start');
    const startsAt = minutes === 0 && startField.value === startField.defaultValue ? new Date() : new Date(startField.value);
    const draft = { gym: form('gym').value, startsAt, duration, note: form('note').value };
    const pickOnly = sheet.querySelector('input[name=who]:checked')?.value === 'some';
    const inviteIds = pickOnly ? [...sheet.querySelectorAll('input[name=invite]:checked')].map((x) => x.value) : [];
    const problem = validateDraft(draft) || (pickOnly && !inviteIds.length ? 'Pick at least one friend.' : '');
    if (problem) { err.textContent = problem; return; }
    const button = sheet.querySelector('[type=submit]');
    // Busy, not disabled: disabling the focused button would push focus out of the sheet.
    if (button.getAttribute('aria-disabled') === 'true') return;
    button.setAttribute('aria-disabled', 'true');
    button.setAttribute('aria-busy', 'true');
    const r = await api.createDate({ ...draft, workout: form('workout').value, inviteIds });
    button.removeAttribute('aria-disabled');
    button.removeAttribute('aria-busy');
    // Closed while sending: the user changed their mind, so the date is taken back.
    if (!sheet.closest('.sheet-backdrop.open')) {
      if (!r.error) {
        const c = await api.cancelDate(r.data.id);
        toast(c.error ? 'The gym date was posted and could not be taken back. Cancel it in Crew.' : 'Gym date taken back (you closed the sheet while it was being posted). Friends with the app open may already have seen it.', { tone: c.error ? 'error' : 'default' });
        refreshCrew();
      } else {
        // It may still have reached the server (e.g. a timeout): show what is there.
        toast('Posting the gym date failed or timed out. Check Crew whether it is there.', { tone: 'error' });
        refreshCrew();
      }
      return;
    }
    if (r.error) { err.textContent = r.error; return; }
    write(KEYS.gyms, rememberGym(gyms, draft.gym));
    finish(true);
  }

  if (result) {
    haptic(20);
    toast('Gym date posted. Your friends can join now.', { tone: 'accent' });
    refreshCrew();
  }
}

// ---------- events ----------
let realtimeFor = null;
function ensureRealtime() {
  if (!supabase || !account.user || !account.ready || crew.missingDates) { if (realtimeFor) { api.unsubscribe(); realtimeFor = null; } return; }
  if (realtimeFor === me()) return;
  realtimeFor = me();
  let timer = null;
  api.subscribe((payload) => {
    if (payload.eventType === 'INSERT' && payload.new.host_id !== me()) {
      const who = usernameOf(payload.new.host_id);
      const when = new Date(payload.new.starts_at);
      const day = relativeDay(when);
      toast(`${who ? '@' + who : 'A friend'} is going to the gym ${/^(Today|Tomorrow)$/.test(day) ? day.toLowerCase() : 'on ' + day} at ${fmtTime(when)}`, { tone: 'accent', ms: 4500, background: true });
    }
    clearTimeout(timer);
    timer = setTimeout(refreshCrew, 400);
  }, () => refreshCrew());
}

/** Runs a server action with its buttons disabled, then shows the result. */
async function act(key, run, success) {
  if (pending.has(key)) return false;
  pending.add(key);
  if (currentPage() === 'crew') renderCrew();
  const r = await run();
  pending.delete(key);
  if (r.error) toast(r.error, { tone: 'error' });
  else if (success) toast(success);
  if (currentPage() === 'crew') renderCrew();
  return !r.error;
}

async function removeOrBlock(id, userId, name, kind) {
  const choice = await openSheet({
    title: kind === 'friend' ? `Remove @${name}?` : `Decline @${name}?`,
    body: html`<p class="sheet-text">${kind === 'friend' ? `@${name} will no longer see your gym dates, stats or shared routines.` : 'They are not told.'} Block them if they should not be able to send you requests again.</p>`,
    actions: [
      { label: kind === 'friend' ? 'Remove friend' : 'Decline', value: 'remove', tone: 'secondary' },
      { label: kind === 'friend' ? 'Remove and block' : 'Decline and block', value: 'block', tone: 'danger' },
      { label: 'Cancel', value: null, tone: 'ghost' },
    ],
  });
  if (!choice) return;
  const ok = await act(id, () => (choice === 'block' ? social.block(userId) : social.removeFriendship(id)), choice === 'block' ? `@${name} is blocked.` : kind === 'friend' ? 'Friend removed.' : 'Request declined.');
  if (ok) refreshCrew();
}

export function initCrew() {
  const page = $('page-crew');
  on(page, 'click', '[data-crew-tab]', (e, b) => {
    crew.tab = b.dataset.crewTab;
    renderCrew();
    $('crew-tab-' + crew.tab)?.focus({ preventScroll: true });
    loadTabData();
    if (crew.tab !== 'ranking') refreshCrew(); // pick up requests and dates sent since the last poll
  });
  // A retry the user asked for keeps its button (busy) and says how it went.
  on(page, 'click', '[data-retry]', async () => {
    retrying = true;
    renderCrew();
    await refreshCrew();
    await loadTabData();
    // The notice stayed while retrying; move focus only if the user is still on it.
    const stayed = !!document.activeElement?.closest?.('[data-key="crew-error"]');
    retrying = false;
    renderCrew();
    // Only what this retry loaded counts (other tabs keep their own state).
    const err = crew.error || (crew.tab === 'friends' && crew.shared?.error) || (crew.tab === 'ranking' && crew.leaderboard?.error);
    toast(err || 'Loaded.', { tone: err ? 'error' : 'default' });
    if (!err && stayed) $('crew-tab-' + crew.tab)?.focus({ preventScroll: true }); // the notice is gone: back to the section
  });
  on(page, 'click', '[data-quick]', (e, b) => openDateSheet(b.dataset.quick === 'later' ? 'later' : +b.dataset.quick));
  on(page, 'click', '[data-reply]', async (e, b) => {
    const id = b.closest('[data-date-id]').dataset.dateId, status = b.dataset.reply;
    haptic(10);
    // Show the answer right away; the server confirms in the background.
    const list = crew.dates.rsvps;
    const mine = list.find((r) => r.date_id === id && r.user_id === me());
    const before = mine ? { ...mine } : null;
    if (mine) mine.status = status; else list.push({ date_id: id, user_id: me(), status, checked_in_at: null, user: { username: account.profile?.username } });
    updateBadge();
    const ok = await act('date:' + id, () => api.reply(id, status));
    if (!ok) {
      const i = list.findIndex((r) => r.date_id === id && r.user_id === me());
      if (before) list[i] = before; else if (i >= 0) list.splice(i, 1);
      updateBadge();
      renderCrew();
    }
    refreshCrew();
  });
  on(page, 'click', '[data-checkin]', async (e, b) => {
    const id = b.closest('[data-date-id]').dataset.dateId;
    if (await act('date:' + id, () => api.checkIn(id), 'Checked in. Have a great session!')) refreshCrew();
  });
  on(page, 'click', '[data-cancel-date]', async (e, b) => {
    const id = b.closest('[data-date-id]').dataset.dateId;
    if (!(await confirmDialog('Your friends will see that it is off.', { title: 'Cancel this gym date?', ok: 'Cancel date', cancel: 'Keep it', danger: true }))) return;
    if (await act('date:' + id, () => api.cancelDate(id), 'Gym date cancelled.')) refreshCrew();
  });
  on(page, 'submit', '#addFriendForm', async (e) => {
    e.preventDefault();
    const input = $('friendName');
    const name = input.value;
    if (!name.trim()) { input.focus(); return; }
    let message = '';
    const ok = await act('add', async () => { const r = await social.sendFriendRequest(name); message = r.data; return r; });
    if (!ok) return;
    toast(message);
    input.value = '';
    refreshCrew();
  });
  on(page, 'click', '[data-accept]', async (e, b) => { if (await act(b.dataset.accept, () => social.acceptRequest(b.dataset.accept), 'You are now friends.')) refreshCrew(); });
  on(page, 'click', '[data-decline]', (e, b) => removeOrBlock(b.dataset.decline, b.dataset.user, b.dataset.name, 'request'));
  on(page, 'click', '[data-unfriend]', (e, b) => removeOrBlock(b.dataset.unfriend, b.dataset.user, b.dataset.name, 'friend'));
  on(page, 'click', '[data-cancel-request]', async (e, b) => { if (await act(b.dataset.cancelRequest, () => social.removeFriendship(b.dataset.cancelRequest), 'Request cancelled.')) refreshCrew(); });
  on(page, 'click', '[data-copy-shared]', async (e, b) => {
    const item = (crew.shared || []).find((x) => x.id === b.dataset.copyShared);
    if (!item) return;
    const name = await promptDialog({
      title: 'Copy routine', label: 'Name in your plan', value: sanitizeWorkoutName(item.title).trim().slice(0, 40), maxLength: 40, ok: 'Copy',
      validate: (v) => (!sanitizeWorkoutName(v) ? 'Give it a name.' : Object.hasOwn(state.workouts, sanitizeWorkoutName(v)) ? 'You already have a routine with that name.' : ''),
    });
    if (!name) return;
    createWorkout(sanitizeWorkoutName(name), deepPlain(item.workout));
    toast('Copied to your plan.');
  });
  on(page, 'click', '[data-unshare]', async (e, b) => {
    if (!(await confirmDialog('Friends can no longer copy it. Copies they already made stay with them.', { title: 'Stop sharing this routine?', ok: 'Stop sharing', danger: true }))) return;
    if (await act(b.dataset.unshare, () => social.deleteSharedWorkout(b.dataset.unshare), 'No longer shared.')) loadTabData();
  });
  on(page, 'click', '[data-publish]', async () => {
    const { current, best } = streaks();
    const stats = { ...leaderboardStats(state.logs), current_streak: current, best_streak: best };
    if (await act('publish', () => social.publishStats(stats), 'Your stats are shared.')) loadTabData();
  });
  on(page, 'click', '[data-unpublish]', async () => {
    if (await act('publish', () => social.unpublishStats(), 'Stats removed.')) loadTabData();
  });

  listen('gym:account', () => {
    if (!account.user || (crew.loadedFor && crew.loadedFor !== me())) clearCrew();
    if (account.user && account.ready && crew.loadedFor !== me()) refreshCrew();
    ensureRealtime();
    refresh('crew');
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && account.user) refreshCrew(); });
  // Background refresh while the tab is open, also covering a dropped live connection.
  setInterval(() => {
    if (document.hidden || currentPage() !== 'crew' || !account.user) return;
    refreshCrew();
    if (crew.tab !== 'dates') loadTabData();
  }, REFRESH_MS);
}

export function onCrewShown() {
  if (account.user) { refreshCrew(); loadTabData(); }
}
