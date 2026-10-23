// The workout screen: log sets, smart rest timer, autosave, start/finish.
import { $, html, render, on, toast, haptic } from '../core/dom.js';
import { KEYS, read, write, remove, emit } from '../core/store.js';
import { ymd, fmtLong, fmtClock, fmtShort } from '../core/dates.js';
import { pushLayer } from '../core/router.js';
import { state, saveLogs, saveLastUsed, markSessionsDeleted } from '../state.js';
import { sanitizeWorkout, rowCount } from '../domain/plan.js';
import { bestWeight, trimSets, sessionKey, newSessionId } from '../domain/logs.js';
import { restState, roundToStep, muscleGroup } from '../domain/rest-timer.js';
import { categoryLabel } from '../domain/catalog.js';
import { confirmDialog } from './sheet.js';
import { icons } from './icons.js';

const DRAFT_STALE_MS = 4 * 3600 * 1000;
const ACTIVE_MAX_MS = 12 * 3600 * 1000;

let s = null; // the open session
let closeLayer = null;
let tickTimer = null;
let wakeLock = null;
let audio = null;

export function getActive() {
  const a = read(KEYS.active, null);
  if (a && Date.now() - a.startedAt > ACTIVE_MAX_MS) { remove(KEYS.active); return null; }
  return a;
}

function setActive(a) {
  if (a) write(KEYS.active, a); else remove(KEYS.active);
  emit('gym:active-changed');
}

function readDraft() { return read(KEYS.draft, null); }

export function isOpen() { return !!s; }

/**
 * Opens a workout for a date (defaults to today). If that workout was already
 * logged on that date, the latest copy opens for editing, unless `fresh` asks
 * for a new session or `key` picks a specific one.
 */
export function openSession(day, date = ymd(), { key = null, fresh = false } = {}) {
  const sameDay = (state.logs[date] || []).filter((x) => x.day === day);
  const existing = fresh ? null : key ? sameDay.find((x) => sessionKey(date, x) === key) || null : sameDay[sameDay.length - 1] || null;
  const draft = readDraft();
  const resume = draft && draft.day === day && draft.date === date && draft.ex ? draft : null;
  let exercises = state.workouts[day] ? sanitizeWorkout(state.workouts[day]) : null;
  if (!exercises) {
    // The routine was deleted or renamed: rebuild from the draft or the log.
    const names = resume ? Object.keys(resume.ex) : existing ? existing.exercises.map((e) => e.name) : [];
    if (!names.length) {
      if (getActive()?.day === day) setActive(null);
      toast('This workout no longer exists.');
      return;
    }
    exercises = names.map((name) => ({ name, cat: 'other', sets: Math.max(1, (resume?.ex[name] || existing?.exercises.find((e) => e.name === name)?.sets || []).length), target: '', rest: 90, note: '' }));
  }
  const active = getActive();
  const started = !!(active && active.day === day && active.date === date);
  s = {
    day, date, exercises, existing,
    started,
    startedAt: started ? active.startedAt : (resume && Date.now() - (resume.active || 0) < DRAFT_STALE_MS ? resume.startedAt || 0 : 0),
    retro: date < ymd() || !!existing,
    doneAt: {}, anyAt: 0, selected: null, wasWaiting: false, prs: {},
  };
  renderSession(resume);
  $('session').hidden = false;
  document.body.classList.add('session-open');
  setBackgroundInert(true);
  $('sessionList').scrollTop = 0;
  closeLayer = pushLayer(() => closeSession(true));
  clearInterval(tickTimer);
  tickTimer = setInterval(tick, 1000);
  tick();
  if (s.started) lockScreen();
  emit('gym:active-changed');
}

function rowsFor(e, i, resume) {
  const lastUsed = state.lastUsed[e.name]?.sets || [];
  const drafted = resume?.ex[e.name];
  const logged = s.existing?.exercises.find((x) => x.name === e.name)?.sets;
  const source = drafted || logged || null;
  let n = rowCount(e);
  if (source) n = Math.max(n, source.length);
  if (e.unilateral && n % 2) n++;
  const rows = [];
  for (let r = 0; r < n; r++) {
    const src = source ? source[r] : lastUsed[r];
    rows.push(setRow(e, i, r, src ? src.w : '', src ? src.r : '', !!(source && source[r] && source[r].done)));
  }
  return rows;
}

function setLabel(e, r) {
  return e.unilateral ? (r % 2 ? 'R' : 'L') + (Math.floor(r / 2) + 1) : String(r + 1);
}

function setRow(e, i, r, w, reps, done) {
  const label = setLabel(e, r);
  return html`<tr class="set-row${done ? ' done' : ''}">
    <td class="set-label">${label}</td>
    <td><input class="w" type="number" inputmode="decimal" step="any" min="0" value="${w}" placeholder="kg" aria-label="Set ${label} weight in kg"></td>
    <td><input class="r" type="number" inputmode="numeric" step="1" min="0" value="${reps}" placeholder="reps" aria-label="Set ${label} reps"></td>
    <td><label class="check"><input type="checkbox" class="d"${done ? ' checked' : ''} aria-label="Set ${label} done"><span aria-hidden="true">${icons.check}</span></label></td>
  </tr>`;
}

function lastText(name) {
  const sets = (state.lastUsed[name]?.sets || []).filter((x) => x.w !== '' || x.r !== '');
  if (!sets.length) return '';
  const top = sets.reduce((m, x) => ((parseFloat(x.w) || 0) > (parseFloat(m.w) || 0) ? x : m), sets[0]);
  return 'Last ' + (top.w || '–') + ' kg × ' + (top.r || '–');
}

function renderSession(resume) {
  $('sessionTitle').textContent = s.day;
  $('sessionDate').textContent = s.date === ymd() ? 'Today' : fmtLong(s.date);
  render($('sessionList'), html`
    ${s.existing ? html`<p class="banner-note">You are editing the workout saved on ${fmtShort(s.date)}. Saving replaces it.</p>` : ''}
    ${s.exercises.map((e, i) => html`
      <article class="ex-card" data-index="${i}">
        <div class="ex-head">
          <div class="ex-title">
            <p class="ex-cat">${categoryLabel(e.cat)}${e.rest ? ' · ' + fmtClock(e.rest) + ' rest' : ''}${e.unilateral ? ' · left/right' : ''}</p>
            <h3>${e.name}</h3>
            <p class="ex-meta">${[e.target ? 'Target ' + e.target : '', lastText(e.name)].filter(Boolean).join(' · ')}</p>
          </div>
          <span class="ex-saved" aria-hidden="true">Saved</span>
          <span class="ex-count">0/0</span>
        </div>
        ${e.note ? html`<p class="ex-note">${e.note}</p>` : ''}
        <table class="sets">
          <thead><tr><th scope="col">Set</th><th scope="col">kg</th><th scope="col">Reps</th><th scope="col"><span class="sr-only">Done</span></th></tr></thead>
          <tbody>${rowsFor(e, i, resume)}</tbody>
        </table>
        <div class="ex-actions">
          <button type="button" class="btn btn-soft btn-sm" data-add>${icons.plus} Set</button>
          <button type="button" class="btn btn-ghost btn-sm" data-remove>${icons.minus} Set</button>
        </div>
      </article>`)}
    <div class="session-end-space"></div>`);
  paintMain();
  updateProgress();
}

function paintMain() {
  const btn = $('sessionMain');
  btn.textContent = s.existing ? 'Save changes' : s.retro ? 'Save workout' : s.started ? 'Finish workout' : 'Start workout';
  $('sessionClockLabel').textContent = s.started ? 'In gym' : s.retro ? fmtShort(s.date) : 'Not started';
  if (!s.started) $('sessionClock').textContent = s.existing?.duration ? fmtClock(s.existing.duration) : '0:00';
}

function cards() { return [...$('sessionList').querySelectorAll('.ex-card')]; }

function collectSets(card) {
  return [...card.querySelectorAll('tbody tr')].map((tr) => ({
    w: tr.querySelector('.w').value.trim(),
    r: tr.querySelector('.r').value.trim(),
    done: tr.querySelector('.d').checked,
  }));
}

function updateProgress() {
  let total = 0, done = 0;
  cards().forEach((card) => {
    const boxes = card.querySelectorAll('.d');
    const n = [...boxes].filter((b) => b.checked).length;
    total += boxes.length; done += n;
    card.querySelector('.ex-count').textContent = n + '/' + boxes.length;
    card.classList.toggle('complete', boxes.length > 0 && n === boxes.length);
  });
  $('sessionSets').textContent = done + '/' + total + ' sets';
  $('sessionProgress').style.width = (total ? (done / total) * 100 : 0) + '%';
  $('sessionProgress').parentElement.setAttribute('aria-valuenow', String(total ? Math.round((done / total) * 100) : 0));
}

function saveDraft() {
  if (!s) return;
  const ex = {};
  cards().forEach((card) => { ex[s.exercises[+card.dataset.index].name] = collectSets(card); });
  write(KEYS.draft, { day: s.day, date: s.date, startedAt: s.startedAt, active: Date.now(), ex });
}

function autosave(card) {
  if (!s) return;
  const e = s.exercises[+card.dataset.index];
  const sets = trimSets(collectSets(card));
  if (sets.length) state.lastUsed[e.name] = { sets, updatedAt: Date.now() }; else delete state.lastUsed[e.name];
  saveLastUsed();
  const tag = card.querySelector('.ex-saved');
  tag.classList.add('show');
  clearTimeout(tag._t);
  tag._t = setTimeout(() => tag.classList.remove('show'), 1200);
}

function select(card) {
  if (!card) return;
  const e = s.exercises[+card.dataset.index];
  if (s.selected !== e.name) { s.selected = e.name; s.wasWaiting = restState(e, s.doneAt, s.anyAt).remaining > 0; }
  cards().forEach((c) => c.classList.toggle('active', c === card));
  renderRest();
}

function renderRest() {
  const bar = $('restBar');
  const e = s && s.selected && s.exercises.find((x) => x.name === s.selected);
  if (!e || !s.anyAt) { bar.hidden = true; return; }
  const r = restState(e, s.doneAt, s.anyAt);
  bar.hidden = false;
  bar.classList.toggle('ready', r.ready);
  $('restEx').textContent = e.name;
  $('restTime').textContent = r.ready ? 'GO' : fmtClock(r.remaining);
  $('restSub').textContent = r.ready ? 'Rested. You are good to go.' : r.reason === 'same' ? 'Same muscle, full ' + fmtClock(e.rest) + ' rest' : 'Different muscle, short break';
  if (s.wasWaiting && r.ready) { haptic([200, 100, 200]); beep(); }
  s.wasWaiting = !r.ready;
}

function beep() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 880; g.gain.value = 0.15;
    o.connect(g); g.connect(audio.destination);
    o.start(); o.stop(audio.currentTime + 0.25);
  } catch { /* audio unavailable */ }
}

function unlockAudio() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch { /* audio unavailable */ }
}

function tick() {
  if (!s) return;
  if (s.started) $('sessionClock').textContent = fmtClock((Date.now() - s.startedAt) / 1000);
  renderRest();
}

async function lockScreen() {
  try { if (navigator.wakeLock && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch { /* not allowed */ }
}

function unlockScreen() {
  try { wakeLock?.release(); } catch { /* ignore */ }
  wakeLock = null;
}

// The workout screen is modal: the page behind it must not be focusable or clickable.
function setBackgroundInert(on) {
  ['app', 'bottomNav', 'activeBar'].forEach((id) => { const el = $(id); if (el) el.inert = on; });
}

function closeSession(fromBack) {
  if (!s) return;
  const hadInput = cards().some((c) => collectSets(c).some((x) => x.done));
  s = null;
  clearInterval(tickTimer);
  unlockScreen();
  $('session').hidden = true;
  $('restBar').hidden = true;
  document.body.classList.remove('session-open');
  setBackgroundInert(false);
  if (!fromBack && closeLayer) closeLayer();
  closeLayer = null;
  if (hadInput && readDraft()) toast('Workout kept. Open it again to continue.');
  emit('gym:active-changed');
}

function start() {
  s.started = true;
  s.startedAt = Date.now();
  setActive({ day: s.day, date: s.date, startedAt: s.startedAt });
  saveDraft();
  paintMain();
  tick();
  lockScreen();
  toast('Workout started. Have a good one!');
}

async function finish() {
  const all = cards().map((card) => ({ e: s.exercises[+card.dataset.index], sets: collectSets(card) }));
  const entry = all
    .map(({ e, sets }) => ({ name: e.name, target: e.target, sets: sets.filter((x) => x.w !== '' || x.r !== '' || x.done) }))
    .filter((x) => x.sets.length);
  if (!entry.length) { toast('Log at least one set first.'); return; }
  const done = entry.reduce((n, x) => n + x.sets.filter((y) => y.done).length, 0);
  const total = all.reduce((n, x) => n + x.sets.length, 0);
  const duration = s.started ? Math.round((Date.now() - s.startedAt) / 1000) : s.existing?.duration;
  const ok = await confirmDialog(
    `${done} of ${total} sets ticked off${duration ? ' · ' + fmtClock(duration) : ''}.`,
    { title: s.existing ? 'Save your changes?' : 'Finish and save this workout?', ok: 'Save workout' },
  );
  if (!ok || !s) return;
  const record = { id: s.existing?.id || newSessionId(), day: s.day, exercises: entry, time: new Date().toISOString() };
  if (duration) record.duration = duration;
  let list = state.logs[s.date] || [];
  if (s.existing) {
    const oldKey = sessionKey(s.date, s.existing);
    list = list.filter((x) => sessionKey(s.date, x) !== oldKey);
    // Sessions saved before ids existed are keyed by their time, which changes now.
    if (oldKey !== record.id) markSessionsDeleted([oldKey]);
  }
  state.logs[s.date] = [...list, record];
  all.forEach(({ e, sets }) => {
    const filled = trimSets(sets);
    if (filled.length) state.lastUsed[e.name] = { sets: filled, updatedAt: Date.now() };
  });
  saveLogs();
  saveLastUsed();
  remove(KEYS.draft);
  if (getActive()?.day === s.day) setActive(null);
  closeSession(false);
  haptic(30);
  toast('Workout saved' + (duration ? ' · ' + fmtClock(duration) : '') + '. Nice work!');
}

export function initSession() {
  const root = $('session');
  render(root, html`
    <header class="session-top">
      <button type="button" class="icon-btn" id="sessionBack" aria-label="Close workout">${icons.back}</button>
      <div class="session-heading">
        <p class="eyebrow"><span id="sessionDate"></span> · <span id="sessionSets">0/0 sets</span></p>
        <h2 id="sessionTitle"></h2>
      </div>
      <div class="session-clock"><span id="sessionClock">0:00</span><small id="sessionClockLabel">Not started</small></div>
    </header>
    <div class="progress" role="progressbar" aria-label="Sets done" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div id="sessionProgress"></div></div>
    <div class="session-scroll" id="sessionList"></div>
    <div class="rest-bar" id="restBar" hidden role="timer" aria-live="off">
      <div class="rest-main"><b id="restEx"></b><small id="restSub"></small></div>
      <span class="rest-time" id="restTime"></span>
      <button type="button" class="btn btn-ghost btn-sm" id="restSkip">Skip</button>
    </div>
    <footer class="session-footer"><button type="button" class="btn btn-primary btn-lg" id="sessionMain">Start workout</button></footer>`);

  $('sessionBack').onclick = () => closeSession(false);
  $('sessionMain').onclick = () => { unlockAudio(); if (s.retro || s.started) finish(); else start(); };
  $('restSkip').onclick = () => {
    const e = s && s.exercises.find((x) => x.name === s.selected);
    if (!e) return;
    s.doneAt = {}; s.anyAt = 0;
    renderRest();
  };

  const list = $('sessionList');
  list.addEventListener('focusin', (e) => {
    if (!s) return;
    if (e.target.matches('input[type=number]')) setTimeout(() => { try { e.target.select(); } catch { /* ignore */ } }, 0);
    select(e.target.closest('.ex-card'));
  });
  list.addEventListener('click', (e) => { if (!s) return; unlockAudio(); select(e.target.closest('.ex-card')); });
  on(list, 'click', '[data-add]', (e, btn) => {
    const card = btn.closest('.ex-card'), ex = s.exercises[+card.dataset.index], body = card.querySelector('tbody');
    const n = body.rows.length;
    const add = ex.unilateral ? 2 : 1;
    for (let k = 0; k < add; k++) body.insertAdjacentHTML('beforeend', String(setRow(ex, +card.dataset.index, n + k, '', '', false)));
    updateProgress(); saveDraft(); autosave(card);
  });
  on(list, 'click', '[data-remove]', (e, btn) => {
    const card = btn.closest('.ex-card'), ex = s.exercises[+card.dataset.index], body = card.querySelector('tbody');
    const step = ex.unilateral ? 2 : 1;
    if (body.rows.length <= step) return;
    for (let k = 0; k < step; k++) body.deleteRow(-1);
    updateProgress(); saveDraft(); autosave(card);
  });
  list.addEventListener('input', (e) => {
    if (!s) return;
    const card = e.target.closest('.ex-card');
    if (!card) return;
    saveDraft();
    clearTimeout(card._as);
    card._as = setTimeout(() => autosave(card), 400);
  });
  list.addEventListener('change', (e) => {
    if (!s) return;
    const card = e.target.closest('.ex-card');
    if (!card) return;
    const ex = s.exercises[+card.dataset.index];
    if (e.target.classList.contains('w') && e.target.value !== '' && state.settings.weightStep) {
      e.target.value = roundToStep(e.target.value, state.settings.weightStep);
    }
    if (e.target.classList.contains('d')) {
      const row = e.target.closest('tr');
      row.classList.toggle('done', e.target.checked);
      const wasComplete = card.classList.contains('complete');
      updateProgress();
      if (e.target.checked) {
        haptic(15);
        s.doneAt[muscleGroup(ex.cat)] = Date.now();
        s.anyAt = Date.now();
        s.selected = ex.name;
        s.wasWaiting = true;
        const w = parseFloat(row.querySelector('.w').value) || 0;
        if (w) {
          if (s.prs[ex.name] === undefined) s.prs[ex.name] = bestWeight(state.logs, ex.name);
          if (s.prs[ex.name] > 0 && w > s.prs[ex.name]) toast('New PR · ' + ex.name + ' · ' + w + ' kg', { tone: 'accent' });
          s.prs[ex.name] = Math.max(s.prs[ex.name], w);
        }
        if (!wasComplete && card.classList.contains('complete')) {
          card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
          const next = card.nextElementSibling;
          if (next && next.classList.contains('ex-card')) setTimeout(() => next.scrollIntoView({ behavior: 'smooth', block: 'start' }), 450);
        }
        renderRest();
      }
    }
    saveDraft();
    autosave(card);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && s && s.started) lockScreen(); });
}
