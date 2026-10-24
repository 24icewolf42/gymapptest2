// The workout screen: log sets, smart rest timer, autosave, start/finish.
// Every opened session has its own draft, so editing an old workout never
// touches the one that is running.
import { $, html, replaceContent, appendContent, on, toast, haptic, reducedMotion, dismissUndo } from '../core/dom.js';
import { KEYS, read, write, remove, emit, listen } from '../core/store.js';
import { ymd, parseYmd, fmtLong, fmtClock, fmtShort, relativeDay } from '../core/dates.js';
import { pushLayer } from '../core/router.js';
import { state, saveLogs, saveLastUsed, markSessionsDeleted } from '../state.js';
import { sanitizeWorkout, rowCount, REST_DEFAULTS, DEFAULT_REST, defang } from '../domain/plan.js';
import { bestWeight, trimSets, sessionKey, newSessionId } from '../domain/logs.js';
import { restState, roundToStep, muscleGroup } from '../domain/rest-timer.js';
import { categoryLabel, CATALOG, looksUnilateral } from '../domain/catalog.js';
import { confirmDialog } from './sheet.js';
import { icons } from './icons.js';

const DRAFT_STALE_MS = 4 * 3600 * 1000;
const DRAFT_MAX_AGE_MS = 7 * 86400 * 1000;
const ACTIVE_MAX_MS = 12 * 3600 * 1000;
const NEW = 'new:';

let s = null; // the open session
let closeLayer = null;
let tickTimer = null;
let wakeLock = null;
let audio = null;
let returnFocus = null;

/** The workout whose timer is running: { day, date, key, startedAt }. */
export function getActive() {
  const a = read(KEYS.active, null);
  if (!a || typeof a !== 'object') return null;
  if (Date.now() - a.startedAt > ACTIVE_MAX_MS) { remove(KEYS.active); return null; }
  return a;
}

function setActive(a) {
  if (a) write(KEYS.active, a); else remove(KEYS.active);
  emit('gym:active-changed');
}

const draftId = (day, date, key) => date + '|' + day + '|' + key;

function readDrafts() {
  const drafts = read(KEYS.drafts, {}) || {};
  // The previous app version kept one draft for the open workout.
  const legacy = read(KEYS.draft, null);
  if (legacy && legacy.day && legacy.date && legacy.ex) {
    const active = getActive();
    const key = active && active.day === legacy.day && active.date === legacy.date && active.key ? active.key : NEW + 'legacy';
    const id = draftId(legacy.day, legacy.date, key);
    if (!drafts[id]) drafts[id] = { ...legacy, key };
    write(KEYS.drafts, drafts);
    remove(KEYS.draft);
  }
  return drafts;
}

function writeDraft(id, draft) {
  const drafts = readDrafts();
  if (draft) drafts[id] = draft; else delete drafts[id];
  Object.keys(drafts).forEach((k) => { if (Date.now() - (drafts[k].active || 0) > DRAFT_MAX_AGE_MS) delete drafts[k]; });
  write(KEYS.drafts, drafts);
}

export function isOpen() { return !!s; }

/** A routine was renamed: the running workout and its drafts follow the new name. */
export function renameRunningWorkout(from, to) {
  // The open workout follows too, so it is saved under the new name and its draft.
  if (s && s.day === from) {
    s.day = to;
    s.draftId = draftId(to, s.date, s.key);
    $('sessionTitle').textContent = to;
  }
  const active = getActive();
  if (active && active.day === from) setActive({ ...active, day: to });
  const drafts = readDrafts();
  let changed = false;
  Object.keys(drafts).forEach((k) => {
    // Keys are date|routine|session and names may contain "|": go by the draft's own routine.
    const prefix = k.slice(0, 11) + from + '|';
    if (drafts[k].day !== from || !k.startsWith(prefix)) return;
    drafts[k.slice(0, 11) + to + '|' + k.slice(prefix.length)] = { ...drafts[k], day: to };
    delete drafts[k];
    changed = true;
  });
  if (changed) write(KEYS.drafts, drafts);
}

/**
 * Opens a workout. Without options it resumes the running session of that
 * workout and date, else edits the latest logged one, else starts a new one.
 * `key` edits a specific logged session; `fresh` starts a new one instead of
 * editing a logged one (an unsaved new one of this workout and day is continued).
 * Future dates can be previewed in the calendar but not logged.
 */
export function openSession(day, date = ymd(), { key = null, fresh = false } = {}) {
  const today = ymd();
  if (date > today) {
    toast(`You can log ${day} on ${relativeDay(parseYmd(date))}.`);
    return;
  }
  const sameDay = (state.logs[date] || []).filter((x) => x.day === day);
  const active = getActive();
  const activeHere = active && active.day === day && active.date === date ? active : null;
  // The previous app version's running workout has no key: treat it as new.
  if (activeHere && !activeHere.key) { activeHere.key = NEW + 'legacy'; write(KEYS.active, activeHere); }
  let existing = null, sessionRef;
  if (key) {
    existing = sameDay.find((x) => sessionKey(date, x) === key) || null;
    sessionRef = existing || key.startsWith(NEW) ? key : NEW + newSessionId();
  } else if (!fresh && activeHere) {
    existing = sameDay.find((x) => sessionKey(date, x) === activeHere.key) || null;
    sessionRef = activeHere.key;
  } else if (!fresh && sameDay.length) {
    existing = sameDay[sameDay.length - 1];
    sessionRef = sessionKey(date, existing);
  } else {
    // Continue an unsaved new session of this workout and day if there is one.
    const prefix = date + '|' + day + '|' + NEW;
    const drafts = readDrafts();
    const newest = Object.keys(drafts).filter((k) => k.startsWith(prefix)).sort((a, b) => (drafts[b].active || 0) - (drafts[a].active || 0))[0];
    sessionRef = newest ? newest.slice(date.length + day.length + 2) : NEW + newSessionId();
  }
  const id = draftId(day, date, sessionRef);
  const saved = readDrafts()[id];
  const resume = saved && saved.ex ? saved : null;

  const routine = state.workouts[day] ? sanitizeWorkout(state.workouts[day]) : null;
  // What the routine says about an exercise, or a sensible guess if it is not in it.
  const meta = (name, target = '') => routine?.find((e) => e.name === name) ||
    { name, cat: CATALOG.find((c) => c.name === name)?.cat || 'other', sets: 1, target, rest: REST_DEFAULTS[name] ?? DEFAULT_REST, note: '', ...(looksUnilateral(name) ? { unilateral: true, sides: 'both' } : {}) };
  let exercises;
  if (existing) {
    // Editing: exactly what was logged, in that order (the routine may have changed since).
    exercises = existing.exercises.map((e) => ({ ...meta(e.name, e.target), target: e.target || meta(e.name).target, sets: Math.max(1, e.sets.length) }));
  } else if (routine) {
    exercises = routine;
  } else {
    // The routine was deleted or renamed: rebuild from the draft.
    const names = resume ? Object.keys(resume.ex) : [];
    if (!names.length) {
      if (activeHere) setActive(null);
      toast('This workout no longer exists.');
      return;
    }
    exercises = names.map((name) => ({ ...meta(name), sets: Math.max(1, (resume.ex[name] || []).length) }));
  }
  const started = !!(activeHere && activeHere.key === sessionRef);
  s = {
    day, date, key: sessionRef, draftId: id, exercises, existing,
    existingText: existing ? JSON.stringify(existing.exercises) : '', // to see a sync change it meanwhile
    started,
    startedAt: started ? activeHere.startedAt : (resume && Date.now() - (resume.active || 0) < DRAFT_STALE_MS ? resume.startedAt || 0 : 0),
    retro: date < today || !!existing,
    // Decided once: only a new workout started today updates "last used" (also after midnight).
    updatesLastUsed: !existing && date === today,
    doneAt: {}, anyAt: 0, selected: null, wasWaiting: false, prs: {},
  };
  returnFocus = document.activeElement;
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
  $('sessionTitle').focus({ preventScroll: true });
  emit('gym:active-changed');
}

const updatesLastUsed = () => !!s && s.updatesLastUsed;

function rowsFor(e, i, resume) {
  // Edits never get pre-filled values: only what was logged (or drafted) is shown.
  const lastUsed = s.existing ? [] : state.lastUsed[e.name]?.sets || [];
  const drafted = resume?.ex[e.name];
  const logged = s.existing?.exercises.find((x) => x.name === e.name)?.sets;
  const source = drafted || logged || null;
  let n = rowCount(e);
  if (source) n = Math.max(n, source.length);
  if (e.unilateral && n % 2) n++;
  const rows = [];
  for (let r = 0; r < n; r++) {
    const src = source ? source[r] : lastUsed[r];
    rows.push(setRow(e, r, src ? src.w : '', src ? src.r : '', !!(source && source[r] && source[r].done)));
  }
  return rows;
}

function setLabel(e, r) {
  return e.unilateral ? (r % 2 ? 'R' : 'L') + (Math.floor(r / 2) + 1) : String(r + 1);
}

function setRow(e, r, w, reps, done) {
  const label = setLabel(e, r);
  return html`<tr class="set-row${done ? ' done' : ''}">
    <td class="set-label">${label}</td>
    <td><input class="w" type="number" inputmode="decimal" step="any" min="0" value="${w}" placeholder="kg" aria-label="${e.name}, set ${label}, weight in kg"></td>
    <td><input class="r" type="number" inputmode="numeric" step="1" min="0" value="${reps}" placeholder="reps" aria-label="${e.name}, set ${label}, reps"></td>
    <td><label class="check"><input type="checkbox" class="d"${done ? ' checked' : ''} aria-label="${e.name}, set ${label} done"><span aria-hidden="true">${icons.check}</span></label></td>
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
  replaceContent($('sessionList'), html`
    ${s.existing ? html`<p class="banner-note">You are editing the workout saved on ${fmtShort(s.date)}. Saving replaces it.</p>` : ''}
    ${s.exercises.map((e, i) => html`
      <article class="ex-card" data-index="${i}" aria-labelledby="ex-title-${i}">
        <div class="ex-head">
          <div class="ex-title">
            <p class="ex-cat">${categoryLabel(e.cat)}${e.rest ? ' · ' + fmtClock(e.rest) + ' rest' : ''}${e.unilateral ? ' · left/right' : ''}</p>
            <h3 id="ex-title-${i}">${e.name}</h3>
            <p class="ex-meta">${[e.target ? 'Target ' + e.target : '', lastText(e.name)].filter(Boolean).join(' · ')}</p>
          </div>
          <span class="ex-saved" aria-hidden="true">Saved</span>
          <span class="ex-count"><span aria-hidden="true">0/0</span><span class="sr-only"></span></span>
        </div>
        ${e.note ? html`<p class="ex-note">${e.note}</p>` : ''}
        <table class="sets">
          <thead><tr><th scope="col">Set</th><th scope="col">kg</th><th scope="col">Reps</th><th scope="col"><span class="sr-only">Done</span></th></tr></thead>
          <tbody>${rowsFor(e, i, resume)}</tbody>
        </table>
        <div class="ex-actions">
          <button type="button" class="btn btn-soft btn-sm" data-add aria-label="Add a set to ${e.name}">${icons.plus} Set</button>
          <button type="button" class="btn btn-ghost btn-sm" data-remove aria-label="Remove the last set of ${e.name}">${icons.minus} Set</button>
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
    const count = card.querySelector('.ex-count');
    count.firstElementChild.textContent = n + '/' + boxes.length;
    count.lastElementChild.textContent = `${n} of ${boxes.length} sets done`;
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
  writeDraft(s.draftId, { day: s.day, date: s.date, key: s.key, startedAt: s.startedAt, active: Date.now(), ex });
}

function autosave(card) {
  if (!updatesLastUsed()) return;
  const e = s.exercises[+card.dataset.index];
  // An empty entry instead of a deletion, so clearing values also syncs.
  state.lastUsed[e.name] = { sets: trimSets(collectSets(card)), updatedAt: Date.now() };
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
  if (s.wasWaiting && r.ready) { haptic([200, 100, 200]); beep(); $('restAnnounce').textContent = 'Rest over for ' + e.name; }
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
  const hadInput = cards().some((c) => collectSets(c).some((x) => x.done || x.w !== '' || x.r !== ''));
  const kept = hadInput && !!readDrafts()[s.draftId];
  cards().forEach((c) => clearTimeout(c._as));
  s = null;
  clearInterval(tickTimer);
  unlockScreen();
  $('session').hidden = true;
  $('restBar').hidden = true;
  document.body.classList.remove('session-open');
  setBackgroundInert(false);
  if (!fromBack && closeLayer) closeLayer();
  closeLayer = null;
  dismissUndo(); // an Undo for a set can't act once the workout is closed
  // Show the "Workout running" bar first, so focus can go back to it.
  emit('gym:active-changed');
  if (returnFocus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
  if (document.activeElement !== returnFocus) {
    const fallback = document.querySelector('#activeBar:not([hidden]) button, .page.active [data-start], .page.active h1');
    if (fallback?.matches('h1') && !fallback.hasAttribute('tabindex')) fallback.setAttribute('tabindex', '-1');
    fallback?.focus({ preventScroll: true });
  }
  returnFocus = null;
  if (kept) toast('Workout kept. Open it again to continue.');
}

async function start({ quiet = false } = {}) {
  const other = getActive();
  if (other && other.key !== s.key) {
    const mins = Math.round((Date.now() - other.startedAt) / 60000);
    const ok = await confirmDialog(`${other.day} has been running for ${mins} min. Its sets stay saved as a draft, but its timer stops.`, { title: 'Start this workout instead?', ok: 'Start this one', cancel: 'Keep the other' });
    if (!ok || !s) return false;
  }
  s.started = true;
  s.startedAt = Date.now();
  setActive({ day: s.day, date: s.date, key: s.key, startedAt: s.startedAt });
  saveDraft();
  paintMain();
  tick();
  lockScreen();
  toast(quiet ? 'Workout started. The timer is running.' : 'Workout started. Have a good one!');
  return true;
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
  const id = s.existing?.id || (s.key.startsWith(NEW) && s.key !== NEW + 'legacy' ? s.key.slice(NEW.length) : newSessionId());
  // A logged workout that a sync defused while it was open: its text stays defused.
  const stored = s.existing && (state.logs[s.date] || []).find((x) => sessionKey(s.date, x) === sessionKey(s.date, s.existing));
  if (stored && JSON.stringify(stored.exercises) !== s.existingText) {
    entry.forEach((x) => { x.name = defang(x.name); if (x.target) x.target = defang(x.target); x.sets.forEach((y) => { y.w = defang(String(y.w)); y.r = defang(String(y.r)); }); });
  }
  const record = { id, day: s.day, exercises: entry, time: new Date().toISOString() };
  if (duration) record.duration = duration;
  const previous = state.logs[s.date];
  let list = previous || [];
  const oldKey = s.existing ? sessionKey(s.date, s.existing) : null;
  if (oldKey) list = list.filter((x) => sessionKey(s.date, x) !== oldKey);
  state.logs[s.date] = [...list, record];
  if (!saveLogs()) {
    // Nothing was stored (phone storage full): keep the draft and the running timer.
    state.logs[s.date] = previous;
    toast('This phone’s storage is full, so the workout was not saved. Your sets are kept: free up space or make a backup, then try again.', { tone: 'error', ms: 9000 });
    return;
  }
  // Sessions saved before ids existed are keyed by their time, which changes now.
  if (oldKey && oldKey !== record.id) markSessionsDeleted([oldKey]);
  if (updatesLastUsed()) {
    all.forEach(({ e, sets }) => {
      const filled = trimSets(sets);
      if (filled.length) state.lastUsed[e.name] = { sets: filled, updatedAt: Date.now() };
    });
    saveLastUsed();
  }
  writeDraft(s.draftId, null);
  const active = getActive();
  if (active && active.key === s.key && active.date === s.date) setActive(null);
  closeSession(false);
  haptic(30);
  toast('Workout saved' + (duration ? ' · ' + fmtClock(duration) : '') + '. Nice work!');
}

export function initSession() {
  // Routines renamed by the sync's defusing: the running workout and drafts follow.
  listen('gym:routines-renamed', (e) => Object.entries(e.detail || {}).forEach(([from, to]) => renameRunningWorkout(from, to)));
  // A sync defused exercise names in the open workout's routine: the workout
  // follows, so it is saved (and its last-used values kept) under the new names.
  listen('gym:plan-updated', () => {
    const routine = new Map((state.workouts[s?.day] || []).map((e) => [e.name, e]));
    if (!s || !routine.size) return;
    let changed = false;
    s.exercises = s.exercises.map((e, i) => {
      const clean = defang(e.name);
      const now = routine.get(e.name) || (clean !== e.name ? routine.get(clean) : null);
      if (!now) return e;
      // The routine has the defused name or target: the workout takes it.
      const target = now.target !== e.target && now.target === defang(e.target || '') ? now.target : e.target;
      if (now.name === e.name && target === e.target) return e;
      changed = true;
      if (now.name !== e.name) {
        const title = document.getElementById('ex-title-' + i);
        if (title) title.textContent = now.name;
        // Its last-used values move along, so there are not two for one exercise.
        if (state.lastUsed[e.name] && !state.lastUsed[now.name]) state.lastUsed[now.name] = { ...state.lastUsed[e.name], updatedAt: Date.now() };
        delete state.lastUsed[e.name];
      }
      return { ...e, name: now.name, target };
    });
    if (changed) { saveDraft(); saveLastUsed(); }
  });
  const root = $('session');
  replaceContent(root, html`
    <header class="session-top">
      <button type="button" class="icon-btn" id="sessionBack" aria-label="Close workout">${icons.back}</button>
      <div class="session-heading">
        <p class="eyebrow"><span id="sessionDate"></span> · <span id="sessionSets">0/0 sets</span></p>
        <h2 id="sessionTitle" tabindex="-1"></h2>
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
    <p class="sr-only" id="restAnnounce" aria-live="polite"></p>
    <footer class="session-footer"><button type="button" class="btn btn-primary btn-lg" id="sessionMain">Start workout</button></footer>`);

  $('sessionBack').onclick = () => closeSession(false);
  $('sessionMain').onclick = () => { unlockAudio(); if (s.retro || s.started) finish(); else start(); };
  $('restSkip').onclick = () => {
    const e = s && s.exercises.find((x) => x.name === s.selected);
    if (!e) return;
    // Like the original app: skip the rest for this muscle group only.
    s.doneAt[muscleGroup(e.cat)] = 0;
    s.anyAt = 0;
    renderRest();
  };
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && s && !document.querySelector('.sheet-backdrop')) closeSession(false); });

  const list = $('sessionList');
  list.addEventListener('focusin', (e) => {
    if (!s) return;
    if (e.target.matches('input[type=number]')) setTimeout(() => { try { e.target.select(); } catch { /* ignore */ } }, 0);
    select(e.target.closest('.ex-card'));
  });
  list.addEventListener('click', (e) => { if (!s) return; unlockAudio(); select(e.target.closest('.ex-card')); });
  on(list, 'click', '[data-add]', (e, btn) => {
    if (!s) return;
    const card = btn.closest('.ex-card'), ex = s.exercises[+card.dataset.index], body = card.querySelector('tbody');
    const n = body.rows.length;
    const add = ex.unilateral ? 2 : 1;
    for (let k = 0; k < add; k++) appendContent(body, setRow(ex, n + k, '', '', false));
    updateProgress(); saveDraft(); autosave(card);
  });
  on(list, 'click', '[data-remove]', (e, btn) => {
    if (!s) return;
    const card = btn.closest('.ex-card'), ex = s.exercises[+card.dataset.index], body = card.querySelector('tbody');
    const step = ex.unilateral ? 2 : 1;
    if (body.rows.length <= step) return;
    const removed = [...body.rows].slice(-step);
    const values = removed.map((tr) => ({ w: tr.querySelector('.w').value, r: tr.querySelector('.r').value, done: tr.querySelector('.d').checked }));
    removed.forEach((tr) => tr.remove());
    updateProgress(); saveDraft(); autosave(card);
    // A filled set can be brought back.
    if (values.some((v) => v.w || v.r || v.done)) {
      toast('Set removed.', {
        action: {
          label: 'Undo',
          onClick: () => {
            if (!s || !card.isConnected) return;
            values.forEach((v) => appendContent(body, setRow(ex, body.rows.length, v.w, v.r, v.done)));
            updateProgress(); saveDraft(); autosave(card);
          },
        },
      });
    }
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
        // Ticking the first set of today's workout starts the timer.
        if (!s.started && !s.retro) start({ quiet: true });
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
          if (next && next.classList.contains('ex-card')) setTimeout(() => next.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }), 450);
        }
        renderRest();
      }
    }
    saveDraft();
    autosave(card);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && s && s.started) lockScreen(); });
}
