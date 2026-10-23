// Crew tab: gym dates, friends and the leaderboard.
import { $, html, render, on, toast, avatar, haptic } from '../core/dom.js';
import { KEYS, read, write, listen, emit } from '../core/store.js';
import { ymd, fmtTime, relativeDay, relativeFromNow, toLocalInput } from '../core/dates.js';
import { go, refresh, currentPage } from '../core/router.js';
import { state, createWorkout } from '../state.js';
import { supabase, cloudConfigured } from '../cloud/client.js';
import { account } from '../cloud/sync.js';
import * as social from '../cloud/social.js';
import * as api from '../cloud/gym-dates.js';
import {
  DURATIONS, QUICK_STARTS, phase, canCheckIn, quickStartTime, validateDraft, groupDates, unanswered, rememberGym, startOf,
} from '../domain/gym-dates.js';
import { leaderboardStats } from '../domain/logs.js';
import { sanitizeWorkoutName, workoutSummary } from '../domain/plan.js';
import { openSheet, confirmDialog, promptDialog } from './sheet.js';
import { icons } from './icons.js';

export const crew = {
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

// ---------- data ----------
let loading = null;
export function refreshCrew() {
  if (!account.user) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    const [f, d] = await Promise.all([social.loadFriendships(), api.loadDates()]);
    crew.error = f.error && !f.missing ? f.error : '';
    if (!f.error) crew.friendships = f.data;
    crew.missingDates = !!d.missing;
    if (!d.error) crew.dates = d.data;
    else if (!d.missing) crew.error = crew.error || d.error;
    crew.loadedFor = me();
    updateBadge();
    emit('gym:crew-updated');
    if (currentPage() === 'crew') renderCrew();
  })().finally(() => { loading = null; });
  return loading;
}

async function loadTabData() {
  if (crew.tab === 'ranking') {
    const r = await social.loadLeaderboard(crew.friendships?.friends || []);
    crew.leaderboard = r.error ? { error: r.error } : r.data;
  }
  if (crew.tab === 'friends') {
    const r = await social.loadSharedWorkouts();
    crew.shared = r.error ? { error: r.error } : r.data;
  }
  if (currentPage() === 'crew') renderCrew();
}

function usernameOf(userId) {
  if (userId === me()) return account.profile?.username || 'you';
  return crew.friendships?.friends.find((f) => f.userId === userId)?.username || null;
}

export function myUpcomingDates() {
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
    const host = next.host_id === me() ? 'You' : '@' + (next.host?.username || usernameOf(next.host_id) || 'friend');
    const live = phase(next) === 'live';
    return html`<button type="button" class="teaser" data-go-crew>
      <span class="teaser-icon">${icons.users}</span>
      <span class="teaser-copy"><small>${live ? 'Gym date · live now' : 'Next gym date'}</small>
        <b>${relativeDay(startOf(next))} ${fmtTime(startOf(next))} · ${next.gym}</b>
        <small>${host}${countText(next) ? ' · ' + countText(next) : ''}</small></span>
      <span class="chev">${icons.chevron}</span></button>`;
  }
  return html`<button type="button" class="teaser" data-go-crew>
    <span class="teaser-icon">${icons.users}</span>
    <span class="teaser-copy"><small>Gym dates</small><b>${open.length} friend${open.length === 1 ? '' : 's'} going to the gym</b><small>Tap to join or reply</small></span>
    <span class="chev">${icons.chevron}</span></button>`;
}

function countText(d) {
  const c = crew.dates?.counts[d.id];
  if (!c) return '';
  return [c.going ? c.going + ' going' : '', c.maybe ? c.maybe + ' maybe' : '', c.here ? c.here + ' there now' : ''].filter(Boolean).join(' · ');
}

// ---------- rendering ----------
export function renderCrew() {
  const page = $('page-crew');
  const head = html`<header class="top"><div><p class="eyebrow">Train together</p><h1>Crew</h1></div>
    <button type="button" class="icon-btn" data-open-settings aria-label="Settings">${icons.settings}</button></header>`;
  if (!cloudConfigured()) {
    render(page, html`${head}<div class="card empty"><h2>Accounts are not set up</h2><p>Check cloud-config.js, then reload the app.</p></div>`);
    return;
  }
  if (!account.user) {
    render(page, html`${head}
      <div class="card hero-card crew-intro">
        <span class="big-icon">${icons.users}</span>
        <h2>Go to the gym together</h2>
        <p>Post when you are heading to the gym, see which friends are going, and join them, even last minute. Only friends you accept can see your plans.</p>
        <button type="button" class="btn btn-primary" data-open-settings>Sign in or create an account</button>
      </div>`);
    return;
  }
  if (crew.loadedFor !== me() && !loading) refreshCrew();
  const typed = $('friendName')?.value || '';
  const typedFocused = document.activeElement?.id === 'friendName';
  const tabs = [['dates', 'Gym dates'], ['friends', 'Friends'], ['ranking', 'Ranking']];
  const incoming = crew.friendships?.incoming.length || 0;
  render(page, html`${head}
    <div class="segmented" role="tablist" aria-label="Crew sections">
      ${tabs.map(([id, label]) => html`<button type="button" role="tab" id="crew-tab-${id}" aria-controls="crew-panel" aria-selected="${crew.tab === id ? 'true' : 'false'}" data-crew-tab="${id}">${label}${id === 'friends' && incoming ? html`<span class="dot-badge">${incoming}</span>` : ''}</button>`)}
    </div>
    ${crew.error ? html`<p class="notice error">${crew.error}</p>` : ''}
    <div id="crew-panel" role="tabpanel" aria-labelledby="crew-tab-${crew.tab}">
      ${crew.tab === 'dates' ? datesPanel() : crew.tab === 'friends' ? friendsPanel() : rankingPanel()}
    </div>`);
  // Background refreshes must not wipe a half-typed username.
  const input = $('friendName');
  if (input && typed) { input.value = typed; if (typedFocused) input.focus({ preventScroll: true }); }
}

function datesPanel() {
  if (crew.missingDates) {
    return html`<div class="card empty"><h2>Gym dates are almost ready</h2><p>The app's database needs a one-time update before gym dates work. Ask whoever runs the app to apply the gym dates migration.</p></div>`;
  }
  if (!crew.dates || !crew.friendships) return html`<div class="card skeleton" aria-busy="true"><p>Loading gym dates…</p></div>`;
  const hasFriends = crew.friendships.friends.length > 0;
  const groups = groupDates(crew.dates.dates);
  const section = (title, list) => (list.length ? html`<h2 class="section-title">${title}</h2>${list.map(dateCard)}` : '');
  const any = groups.live.length + groups.today.length + groups.tomorrow.length + groups.later.length;
  return html`
    <section class="card quick-card">
      <div class="quick-head"><span class="big-icon small">${icons.bolt}</span><div><h2>Heading to the gym?</h2><p>Let your friends know so they can join.</p></div></div>
      <div class="chips">
        ${QUICK_STARTS.map((q) => html`<button type="button" class="chip chip-lg" data-quick="${q.minutes}">${q.label}</button>`)}
        <button type="button" class="chip chip-lg chip-outline" data-quick="later">Plan later</button>
      </div>
      ${hasFriends ? '' : html`<p class="hint">Add friends first. Only accepted friends can see your gym dates.</p>`}
    </section>
    ${section('Live now', groups.live)}
    ${section('Today', groups.today)}
    ${section('Tomorrow', groups.tomorrow)}
    ${section('Coming up', groups.later)}
    ${any ? '' : html`<div class="empty-inline"><p>No gym dates yet.</p><p class="muted">Post one and your friends can join you.</p></div>`}`;
}

function dateCard(d) {
  const p = phase(d);
  const mine = d.host_id === me();
  const myReply = crew.dates.rsvps.find((r) => r.date_id === d.id && r.user_id === me());
  const status = mine ? 'going' : myReply?.status;
  const hostName = mine ? 'You' : '@' + (d.host?.username || usernameOf(d.host_id) || 'friend');
  const replies = crew.dates.rsvps.filter((r) => r.date_id === d.id && r.status !== 'no');
  const going = replies.filter((r) => r.status === 'going');
  const c = crew.dates.counts[d.id] || { going: going.length, maybe: 0, here: 0 };
  const hidden = Math.max(0, c.going + c.maybe - replies.length);
  const invites = mine && d.invite_only ? crew.dates.invites.filter((i) => i.date_id === d.id).length : 0;
  const checkedIn = !!myReply?.checked_in_at;
  const start = startOf(d);
  return html`
    <article class="date-card${p === 'live' ? ' live' : ''}${mine ? ' mine' : ''}" data-date-id="${d.id}">
      <header class="date-head">
        ${avatar(mine ? account.profile?.username : d.host?.username)}
        <div class="date-who"><b>${hostName}</b><small>${mine ? 'Your gym date' : 'wants to train'}</small></div>
        <span class="pill${p === 'live' ? ' pill-live' : ''}">${p === 'live' ? 'Live now' : relativeFromNow(start)}</span>
      </header>
      <h3 class="date-when">${relativeDay(start)} · ${fmtTime(start)} <span class="muted">· ${d.duration_min} min</span></h3>
      <p class="date-meta"><span>${icons.pin} ${d.gym}</span>${d.workout ? html`<span>${icons.dumbbell} ${d.workout}</span>` : ''}${d.invite_only ? html`<span>${icons.users} ${mine ? invites + ' invited' : 'Invite only'}</span>` : ''}</p>
      ${d.note ? html`<p class="date-note">${d.note}</p>` : ''}
      <div class="people">
        <div class="avatars">${replies.slice(0, 6).map((r) => html`<span class="avatar-wrap${r.checked_in_at ? ' here' : ''}" title="${r.user?.username || ''}">${avatar(r.user?.username || usernameOf(r.user_id))}</span>`)}${hidden ? html`<span class="avatar avatar-more">+${hidden}</span>` : ''}</div>
        <small>${countText(d) || 'Be the first to join'}</small>
      </div>
      ${mine ? '' : html`
        <div class="rsvp" role="group" aria-label="Your answer">
          ${[['going', 'Going'], ['maybe', 'Maybe'], ['no', 'Can’t']].map(([v, l]) => html`<button type="button" class="rsvp-btn${status === v ? ' on' : ''}" aria-pressed="${status === v ? 'true' : 'false'}" data-reply="${v}">${l}</button>`)}
        </div>`}
      <div class="date-actions">
        ${(mine || status === 'going' || status === 'maybe') && canCheckIn(d) ? (checkedIn
          ? html`<span class="pill pill-ok">${icons.check} You are at the gym</span>`
          : html`<button type="button" class="btn btn-primary btn-sm" data-checkin>${icons.pin} I’m here</button>`) : ''}
        ${mine ? html`<button type="button" class="btn btn-ghost btn-sm" data-cancel-date>Cancel date</button>` : ''}
      </div>
    </article>`;
}

function friendsPanel() {
  const f = crew.friendships;
  if (!f) return html`<div class="card skeleton" aria-busy="true"><p>Loading friends…</p></div>`;
  const shared = crew.shared;
  return html`
    <form class="card add-friend" id="addFriendForm">
      <label class="field"><span>Add a friend by username</span>
        <div class="input-row"><span class="input-prefix">@</span><input class="input" id="friendName" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="21" placeholder="username" enterkeyhint="send"><button class="btn btn-primary" type="submit">Add</button></div>
      </label>
      <p class="hint">Your username is <b>@${account.profile?.username || '…'}</b>. Share it with friends so they can add you.</p>
    </form>
    ${f.incoming.length ? html`<h2 class="section-title">Requests</h2><div class="card list">${f.incoming.map((x) => html`
      <div class="row">${avatar(x.username)}<div class="row-main"><b>@${x.username}</b><small>wants to be friends</small></div>
        <button type="button" class="btn btn-primary btn-sm" data-accept="${x.id}">Accept</button>
        <button type="button" class="btn btn-ghost btn-sm" data-decline="${x.id}" aria-label="Decline request from ${x.username}">Decline</button></div>`)}</div>` : ''}
    <h2 class="section-title">Friends ${f.friends.length ? html`<span class="muted">${f.friends.length}</span>` : ''}</h2>
    ${f.friends.length ? html`<div class="card list">${f.friends.map((x) => html`
      <div class="row">${avatar(x.username)}<div class="row-main"><b>@${x.username}</b></div>
        <button type="button" class="icon-btn" data-unfriend="${x.id}" data-name="${x.username}" aria-label="Remove ${x.username}">${icons.x}</button></div>`)}</div>`
      : html`<div class="empty-inline"><p>No friends yet.</p><p class="muted">Add someone by their username above.</p></div>`}
    ${f.outgoing.length ? html`<h2 class="section-title">Sent</h2><div class="card list">${f.outgoing.map((x) => html`
      <div class="row">${avatar(x.username)}<div class="row-main"><b>@${x.username}</b><small>waiting for an answer</small></div>
        <button type="button" class="btn btn-ghost btn-sm" data-decline="${x.id}">Cancel</button></div>`)}</div>` : ''}
    <h2 class="section-title">Shared routines</h2>
    ${!shared ? html`<p class="muted">Loading…</p>` : shared.error ? html`<p class="notice error">${shared.error}</p>` : shared.length ? html`<div class="card list">${shared.map((x) => html`
      <div class="row"><div class="row-main"><b>${x.title}</b><small>${x.mine ? 'Shared by you' : '@' + (x.owner?.username || 'friend')} · ${workoutSummary(x.workout)}</small></div>
        ${x.mine ? html`<button type="button" class="btn btn-ghost btn-sm" data-unshare="${x.id}">Remove</button>` : html`<button type="button" class="btn btn-soft btn-sm" data-copy-shared="${x.id}">${icons.copy} Copy</button>`}</div>`)}</div>`
      : html`<p class="muted small">Routines you or your friends share from the Plan tab show up here.</p>`}`;
}

function rankingPanel() {
  const lb = crew.leaderboard;
  if (!lb) return html`<div class="card skeleton" aria-busy="true"><p>Loading ranking…</p></div>`;
  if (lb.error) return html`<p class="notice error">${lb.error}</p>`;
  const rows = [...lb].sort((a, b) => (b.workouts_count || 0) - (a.workouts_count || 0));
  const mine = rows.find((r) => r.user_id === me());
  const published = mine && mine.workouts_count != null;
  return html`
    <section class="card">
      <h2>Your stats</h2>
      <p class="muted small">${published ? 'Friends see your workout count and total volume. Update it after training.' : 'Share your workout count and total volume (kg × reps) with friends. Session details stay private.'}</p>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" data-publish>${published ? 'Update my stats' : 'Share my stats'}</button>
        ${published ? html`<button type="button" class="btn btn-ghost" data-unpublish>Stop sharing</button>` : ''}
      </div>
    </section>
    <div class="card list ranking">
      ${rows.map((r, i) => html`
        <div class="row${r.user_id === me() ? ' me' : ''}">
          <span class="rank">${i + 1}</span>${avatar(r.username)}
          <div class="row-main"><b>@${r.username}${r.user_id === me() ? ' (you)' : ''}</b>
            <small>${r.workouts_count == null ? 'Not shared' : r.workouts_count + ' workouts · ' + Number(r.volume_kg_reps || 0).toLocaleString() + ' kg·reps'}${r.routines != null ? ' · ' + r.routines + ' routines' : ''}</small></div>
          <span class="row-end">${r.weight_kg == null ? '' : html`<b>${Number(r.weight_kg).toFixed(1)} kg</b><small>${r.weight_date || ''}</small>`}</span>
        </div>`)}
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
        <div class="chips" role="radiogroup" aria-labelledby="durLabel">${DURATIONS.map((m) => html`<button type="button" class="chip${m === duration ? ' on' : ''}" role="radio" aria-checked="${m === duration ? 'true' : 'false'}" data-duration="${m}">${m < 60 ? m + ' min' : m / 60 + ' h'}</button>`)}</div>
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
    actions: [{ label: 'Cancel', tone: 'ghost', value: null }, { label: 'Post gym date', tone: 'primary', submit: true, onClick: (finish) => submit(finish) }],
    onMount: (sheet) => {
      sheet.querySelectorAll('[data-duration]').forEach((b) => {
        b.onclick = () => {
          duration = +b.dataset.duration;
          sheet.querySelectorAll('[data-duration]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
        };
      });
      sheet.querySelectorAll('input[name=who]').forEach((r) => { r.onchange = () => { sheet.querySelector('.friend-picks').hidden = sheet.querySelector('input[name=who]:checked').value !== 'some'; }; });
    },
  });

  async function submit(finish) {
    const sheet = document.querySelector('.date-sheet');
    const form = (n) => sheet.querySelector(`[name=${n}]`);
    const err = sheet.querySelector('.form-error');
    const startsAt = new Date(form('start').value);
    const draft = { gym: form('gym').value, startsAt, duration, note: form('note').value };
    const pickOnly = sheet.querySelector('input[name=who]:checked')?.value === 'some';
    const inviteIds = pickOnly ? [...sheet.querySelectorAll('input[name=invite]:checked')].map((x) => x.value) : [];
    const problem = validateDraft(draft) || (pickOnly && !inviteIds.length ? 'Pick at least one friend.' : '');
    if (problem) { err.textContent = problem; return; }
    const button = sheet.querySelector('[type=submit]');
    button.disabled = true;
    const r = await api.createDate({ ...draft, workout: form('workout').value, inviteIds });
    button.disabled = false;
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
  if (!supabase || !account.user || crew.missingDates) { if (realtimeFor) { api.unsubscribe(); realtimeFor = null; } return; }
  if (realtimeFor === me()) return;
  realtimeFor = me();
  let timer = null;
  api.subscribe((payload) => {
    if (payload.table === 'gym_dates' && payload.eventType === 'INSERT' && payload.new.host_id !== me()) {
      const who = usernameOf(payload.new.host_id);
      const when = new Date(payload.new.starts_at);
      toast(`${who ? '@' + who : 'A friend'} is going to the gym ${relativeDay(when).toLowerCase()} at ${fmtTime(when)}`, { tone: 'accent', ms: 4500 });
    }
    clearTimeout(timer);
    timer = setTimeout(refreshCrew, 400);
  });
}

async function act(promise, success) {
  const r = await promise;
  if (r.error) { toast(r.error, { tone: 'error' }); return false; }
  if (success) toast(success);
  return true;
}

export function initCrew() {
  const page = $('page-crew');
  on(page, 'click', '[data-crew-tab]', (e, b) => {
    crew.tab = b.dataset.crewTab;
    renderCrew();
    loadTabData();
  });
  on(page, 'click', '[data-quick]', (e, b) => openDateSheet(b.dataset.quick === 'later' ? 'later' : +b.dataset.quick));
  on(page, 'click', '[data-reply]', async (e, b) => {
    const id = b.closest('[data-date-id]').dataset.dateId;
    haptic(10);
    if (await act(api.reply(id, b.dataset.reply))) refreshCrew();
  });
  on(page, 'click', '[data-checkin]', async (e, b) => {
    const id = b.closest('[data-date-id]').dataset.dateId;
    if (await act(api.checkIn(id), 'Checked in. Have a great session!')) refreshCrew();
  });
  on(page, 'click', '[data-cancel-date]', async (e, b) => {
    const id = b.closest('[data-date-id]').dataset.dateId;
    if (!(await confirmDialog('Your friends will see that it is off.', { title: 'Cancel this gym date?', ok: 'Cancel date', cancel: 'Keep it', danger: true }))) return;
    if (await act(api.cancelDate(id), 'Gym date cancelled.')) refreshCrew();
  });
  on(page, 'submit', '#addFriendForm', async (e) => {
    e.preventDefault();
    const input = $('friendName');
    const r = await social.sendFriendRequest(input.value);
    if (r.error) { toast(r.error, { tone: 'error' }); return; }
    toast(r.data);
    input.value = '';
    refreshCrew();
  });
  on(page, 'click', '[data-accept]', async (e, b) => { if (await act(social.acceptRequest(b.dataset.accept), 'You are now friends.')) refreshCrew(); });
  on(page, 'click', '[data-decline]', async (e, b) => { if (await act(social.removeFriendship(b.dataset.decline))) refreshCrew(); });
  on(page, 'click', '[data-unfriend]', async (e, b) => {
    const ok = await confirmDialog(`@${b.dataset.name} will no longer see your gym dates, stats or shared routines.`, { title: 'Remove this friend?', ok: 'Remove', danger: true });
    if (ok && (await act(social.removeFriendship(b.dataset.unfriend), 'Friend removed.'))) refreshCrew();
  });
  on(page, 'click', '[data-copy-shared]', async (e, b) => {
    const item = (crew.shared || []).find((x) => x.id === b.dataset.copyShared);
    if (!item) return;
    const name = await promptDialog({
      title: 'Copy routine', label: 'Name in your plan', value: sanitizeWorkoutName(item.title), maxLength: 40, ok: 'Copy',
      validate: (v) => (!sanitizeWorkoutName(v) ? 'Give it a name.' : Object.hasOwn(state.workouts, v) ? 'You already have a routine with that name.' : ''),
    });
    if (!name) return;
    createWorkout(sanitizeWorkoutName(name), item.workout.map((x) => ({ ...x })));
    toast('Copied to your plan.');
  });
  on(page, 'click', '[data-unshare]', async (e, b) => {
    if (await act(social.deleteSharedWorkout(b.dataset.unshare), 'Removed.')) loadTabData();
  });
  on(page, 'click', '[data-publish]', async () => {
    if (await act(social.publishStats(leaderboardStats(state.logs)), 'Your stats are shared.')) loadTabData();
  });
  on(page, 'click', '[data-unpublish]', async () => {
    if (await act(social.unpublishStats(), 'Stats removed.')) loadTabData();
  });

  listen('gym:account', () => {
    if (!account.user) { crew.friendships = crew.dates = crew.leaderboard = crew.shared = null; crew.loadedFor = null; updateBadge(); }
    else if (crew.loadedFor !== me()) refreshCrew().then(ensureRealtime);
    ensureRealtime();
    refresh('crew');
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && account.user) refreshCrew(); });
  // Keep "in 20 min" labels and the live section current.
  setInterval(() => { if (!document.hidden && currentPage() === 'crew' && crew.tab === 'dates') renderCrew(); }, 60000);
}

export function onCrewShown() {
  if (account.user) { refreshCrew(); loadTabData(); }
}

export const goCrew = () => go('crew');
