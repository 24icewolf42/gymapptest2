// Plan: weekly schedule, routine library and the routine editor.
import { cut } from '../core/text.js';
import { $, html, render, on, toast, busyAttr } from '../core/dom.js';
import { DOW, fmtClock } from '../core/dates.js';
import { pushLayer } from '../core/router.js';
import { state, savePlan, createWorkout, deleteWorkout, planTombstones, setPlanTombstones } from '../state.js';
import { sanitizeWorkoutName, sanitizeWorkout, workoutSummary, displaySets, scheduledDays, renameInSchedule, MAX_SETS, DEFAULT_TARGET, DEFAULT_SETS, REST_DEFAULTS, DEFAULT_REST } from '../domain/plan.js';
import { searchCatalog, categoryLabel, CATEGORIES, CATALOG, GROUP_FILTERS, looksUnilateral } from '../domain/catalog.js';
import { account } from '../cloud/sync.js';
import { shareWorkout } from '../cloud/social.js';
import { openSheet, confirmDialog, promptDialog } from './sheet.js';
import { renameRunningWorkout } from './session.js';
import { icons } from './icons.js';

let editing = null; // routine name open in the editor
let editorCopy = null; // what the editor last showed, to offer it back if the routine is deleted elsewhere
let closeEditorLayer = null;
let query = '';
let group = 'All';
const REST_OPTIONS = [0, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300];

function weekView() {
  const names = Object.keys(state.workouts);
  return html`
    <header class="top" data-view="week"><div><p class="eyebrow">Your training, your way</p><h1>Plan</h1></div>
      <button type="button" class="icon-btn" data-open-settings aria-label="Settings">${icons.settings}</button></header>
    <section class="card list" data-key="week">
      <h2 class="card-title">Your week</h2>
      ${DOW.map((day, i) => html`<button type="button" class="row row-btn" data-day="${i}" data-key="wd-${i}">
        <span class="row-day">${day.slice(0, 3)}</span>
        <div class="row-main"><b class="${state.schedule[i] ? '' : 'muted'}">${state.schedule[i] || 'Rest'}</b>${state.schedule[i] ? html`<small>${workoutSummary(state.workouts[state.schedule[i]])}</small>` : ''}</div>
        <span class="chev">${icons.chevron}</span></button>`)}
    </section>
    <h2 class="section-title" data-key="mine">My workouts</h2>
    ${names.length ? html`<div class="routine-list" data-key="routines">${names.map((n) => {
      const days = scheduledDays(state.schedule, n);
      return html`<button type="button" class="routine" data-edit="${n}" data-key="routine-${n}">
        <span class="routine-mark" aria-hidden="true">${(Array.from(n)[0] || '').toUpperCase()}</span>
        <span class="row-main"><b>${n}</b><small>${workoutSummary(state.workouts[n])} · ${days ? days + (days === 1 ? ' day a week' : ' days a week') : 'not scheduled'}</small></span>
        <span class="chev">${icons.chevron}</span></button>`;
    })}</div>` : html`<div class="empty-inline" data-key="no-routines"><p>No workouts yet.</p><p class="muted">Create one like Push, Pull, Legs, Upper or Lower.</p></div>`}
    <button type="button" class="btn btn-primary btn-block" data-new data-key="new">${icons.plus} New workout</button>`;
}

function exerciseRow(e, i, count) {
  return html`<li class="ex-edit" data-ex="${e.name}" data-key="ex-${e.name}">
    <div class="ex-edit-head">
      <span class="drag-handle" data-drag aria-hidden="true" title="Drag to reorder">${icons.grip}</span>
      <div class="row-main"><b>${e.name}</b><small>${categoryLabel(e.cat)}</small></div>
      <button type="button" class="icon-btn sm" data-move="-1" aria-label="Move ${e.name} up"${busyAttr(i === 0)}>${icons.up}</button>
      <button type="button" class="icon-btn sm" data-move="1" aria-label="Move ${e.name} down"${busyAttr(i === count - 1)}>${icons.down}</button>
      <button type="button" class="icon-btn sm danger" data-remove aria-label="Remove ${e.name}">${icons.trash}</button>
    </div>
    <div class="ex-edit-fields">
      <div class="field compact"><span>${e.unilateral ? 'Sets / side' : 'Sets'}</span>
        <div class="stepper"><button type="button" data-sets="-1" aria-label="Fewer sets for ${e.name}">${icons.minus}</button><output aria-live="off">${displaySets(e)}</output><button type="button" data-sets="1" aria-label="More sets for ${e.name}">${icons.plus}</button></div></div>
      <label class="field compact"><span>Reps</span><input class="input" data-field="target" value="${e.target}" maxlength="20" placeholder="${DEFAULT_TARGET}"></label>
      <label class="field compact"><span>Rest</span><select class="input" data-field="rest">${REST_OPTIONS.map((r) => html`<option value="${r}"${r === e.rest ? ' selected' : ''}>${r ? fmtClock(r) : 'None'}</option>`)}${REST_OPTIONS.includes(e.rest) ? '' : html`<option value="${e.rest}" selected>${fmtClock(e.rest)}</option>`}</select></label>
      <label class="toggle compact"><input type="checkbox" data-field="unilateral"${e.unilateral ? ' checked' : ''}><span>Left/right</span></label>
    </div>
    <label class="field compact"><span class="sr-only">Note for ${e.name}</span><input class="input input-note" data-field="note" value="${e.note}" maxlength="200" placeholder="Note (seat height, grip…)"></label>
  </li>`;
}

function searchResults(list) {
  const added = new Set(list.map((e) => e.name.toLowerCase()));
  const all = searchCatalog(query, group);
  const results = all.slice(0, 60);
  const q = query.trim();
  const exact = results.some((x) => x.name.toLowerCase() === q.toLowerCase());
  return html`<p class="muted small picks-count">${all.length} exercises${group === 'All' ? '' : ' · ' + group}${all.length > results.length ? ' · showing ' + results.length + ', search to narrow down' : ''}</p>
    ${results.map((x) => html`<button type="button" class="pick${added.has(x.name.toLowerCase()) ? ' added' : ''}" data-add="${x.name}" data-key="pick-${x.name}"${busyAttr(added.has(x.name.toLowerCase()))}>
      <span class="row-main"><b>${x.name}</b><small>${categoryLabel(x.cat)}${x.unilateral ? ' · left/right' : ''}</small></span>
      <span class="pick-tag">${added.has(x.name.toLowerCase()) ? 'Added' : html`${icons.plus} Add`}</span></button>`)}
    ${q && !exact && !added.has(q.toLowerCase()) ? html`<button type="button" class="pick custom" data-add-custom="${q}" data-key="pick-custom"><span class="row-main"><b>Add “${q}”</b><small>Your own exercise</small></span><span class="pick-tag">${icons.plus} Add</span></button>` : ''}`;
}

function editorView() {
  const name = editing, list = state.workouts[name];
  editorCopy = { name, list: JSON.parse(JSON.stringify(list)) };
  return html`
    <header class="top editor-top" data-view="editor-${name}">
      <button type="button" class="icon-btn" data-close-editor data-key="back" aria-label="Back to my plan">${icons.back}</button>
      <div class="grow"><p class="eyebrow">Workout · ${workoutSummary(list)}</p><h1 class="h1-sm">${name}</h1></div>
      <button type="button" class="icon-btn" data-rename data-key="rename" aria-label="Rename workout">${icons.edit}</button>
      ${account.user ? html`<button type="button" class="icon-btn" data-share data-key="share" aria-label="Share with friends">${icons.share}</button>` : ''}
      <button type="button" class="icon-btn danger" data-delete data-key="delete" aria-label="Delete workout">${icons.trash}</button>
    </header>
    ${list.length ? html`<ol class="ex-edit-list" data-key="ex-list">${list.map((e, i) => exerciseRow(e, i, list.length))}</ol>`
      : html`<div class="empty-inline" data-key="ex-empty"><p>Start with one exercise.</p><p class="muted">Search below or add your own.</p></div>`}
    <section class="card add-ex" data-key="add-ex">
      <label class="field"><span>Add exercises</span>
        <input class="input" id="exSearch" type="search" value="${query}" placeholder="Search by name or muscle" autocomplete="off" enterkeyhint="search"></label>
      <div class="chips no-swipe group-filters" role="radiogroup" aria-label="Muscle group">${GROUP_FILTERS.map((g) => html`<button type="button" class="chip${g === group ? ' on' : ''}" role="radio" aria-checked="${g === group ? 'true' : 'false'}" tabindex="${g === group ? '0' : '-1'}" data-group="${g}">${g}</button>`)}</div>
      <div class="picks no-swipe" id="exResults">${searchResults(list)}</div>
    </section>
    <p class="sr-only" role="status" id="planStatus"></p>`;
}

export function renderPlan() {
  const page = $('page-plan');
  if (editing && !Object.hasOwn(state.workouts, editing)) {
    // Deleted on another device or tab: say so, keep focus on the plan, and offer it back.
    const gone = editorCopy, hadFocus = page.contains(document.activeElement);
    // Keep what was being typed, so "Keep it" brings it back too.
    const field = document.activeElement?.closest?.('#page-plan [data-ex] [data-field]');
    if (gone && field && field.type !== 'checkbox') {
      const ex = gone.list.find((x) => x.name === field.closest('[data-ex]').dataset.ex);
      if (ex) ex[field.dataset.field] = field.dataset.field === 'rest' ? +field.value : field.value;
    }
    closeEditor();
    render(page, weekView());
    const h = page.querySelector('[data-key="mine"]');
    if (hadFocus && h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    if (gone) {
      toast(`${gone.name} was deleted or renamed on another device or tab.`, {
        action: { label: 'Keep it', onClick: () => { if (!Object.hasOwn(state.workouts, gone.name)) { state.workouts[gone.name] = sanitizeWorkout(gone.list); savePlan(); } openEditor(gone.name); } },
      });
    }
    return;
  }
  render(page, editing ? editorView() : weekView());
}

function openEditor(name) {
  editing = name;
  query = '';
  if (!closeEditorLayer) closeEditorLayer = pushLayer(() => { closeEditorLayer = null; editing = null; renderPlan(); });
  renderPlan();
  window.scrollTo(0, 0);
}

/** Called when the user switches tabs: the editor's back entry must not linger. */
export function leavePlan() {
  if (editing) closeEditor();
}

function closeEditor() {
  editing = null;
  if (closeEditorLayer) { const c = closeEditorLayer; closeEditorLayer = null; c(); }
}

function list() { return state.workouts[editing]; }

/** The exercise a control belongs to, found by name (positions can change under a sync). */
function exerciseOf(el) {
  const l = list();
  if (editing && !l) setTimeout(renderPlan); // the routine went away meanwhile: tell the user
  const name = el.closest('[data-ex]')?.dataset.ex;
  return l && name ? { l, i: l.findIndex((x) => x.name === name), name } : { l: null, i: -1, name };
}

function nameError(v, current) {
  const n = sanitizeWorkoutName(v);
  if (!n) return 'Give it a name.';
  if (n !== current && Object.hasOwn(state.workouts, n)) return 'You already have a workout with that name.';
  return '';
}

async function chooseForDay(i) {
  const names = Object.keys(state.workouts);
  const current = state.schedule[i];
  const value = await openSheet({
    title: DOW[i],
    subtitle: 'Choose a workout or keep it a rest day.',
    body: html`<div class="list" role="listbox" aria-label="Workout for ${DOW[i]}">
      ${[[null, 'Rest day'], ...names.map((n) => [n, n])].map(([v, label]) => html`<button type="button" role="option" aria-selected="${v === current ? 'true' : 'false'}" class="row row-btn${v === current ? ' selected' : ''}" data-choose="${v ?? ''}">
        <div class="row-main"><b>${label}</b>${v ? html`<small>${workoutSummary(state.workouts[v])}</small>` : ''}</div>${v === current ? html`<span class="tick">${icons.check}</span>` : ''}</button>`)}
      </div>
      ${names.length ? '' : html`<p class="hint">Create a workout first, then put it on a day.</p>`}`,
    onMount: (sheet, close) => sheet.querySelectorAll('[data-choose]').forEach((b) => { b.onclick = () => close({ v: b.dataset.choose || null }); }),
  });
  if (!value) return;
  state.schedule[i] = value.v;
  savePlan();
}

// Drag an exercise by its grip to reorder (from upstream v2.12.3); near the
// top or bottom edge the page scrolls on its own (upstream e622386). The
// up/down buttons do the same with a tap or the keyboard.
function enableDragReorder(page) {
  page.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-drag]');
    if (!handle || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const row = handle.closest('.ex-edit'), listEl = row?.parentElement;
    if (!row || !listEl) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const rows = [...listEl.children];
    const from = rows.indexOf(row), startY = e.clientY, startScroll = window.scrollY;
    let to = from, pointerY = e.clientY, raf = 0;
    row.classList.add('dragging');
    const update = () => {
      // The row follows the finger, also while the page scrolls under it.
      row.style.transform = `translateY(${pointerY - startY + window.scrollY - startScroll}px)`;
      const mid = row.getBoundingClientRect().top + row.offsetHeight / 2;
      to = rows.filter((r) => r !== row && r.getBoundingClientRect().top + r.offsetHeight / 2 < mid).length;
      rows.forEach((r, i) => r.classList.toggle('drop-before', r !== row && i === (to >= from ? to + 1 : to)));
    };
    const autoScroll = () => {
      const top = 110, bottom = window.innerHeight - 130; // clear of the header and the bottom bar
      const speed = pointerY < top ? -(4 + 20 * Math.min(1, (top - pointerY) / top))
        : pointerY > bottom ? 4 + 20 * Math.min(1, (pointerY - bottom) / 110) : 0;
      if (speed) {
        const before = window.scrollY;
        window.scrollBy(0, Math.round(speed));
        if (window.scrollY !== before) update();
      }
      raf = requestAnimationFrame(autoScroll);
    };
    const move = (ev) => { pointerY = ev.clientY; update(); };
    // pointerup drops the row; pointercancel (the system took the gesture) puts it back.
    const end = (ev) => {
      cancelAnimationFrame(raf);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      row.classList.remove('dragging');
      row.style.transform = '';
      rows.forEach((r) => r.classList.remove('drop-before'));
      const l = list();
      if (ev.type === 'pointercancel' || !l || to === from) return;
      const [item] = l.splice(from, 1);
      l.splice(to, 0, item);
      savePlan();
      toast(`${item.name} moved to position ${to + 1}.`);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    raf = requestAnimationFrame(autoScroll);
  });
}

export function initPlan() {
  const page = $('page-plan');
  enableDragReorder(page);
  on(page, 'click', '[data-day]', (e, b) => chooseForDay(+b.dataset.day));
  on(page, 'click', '[data-edit]', (e, b) => openEditor(b.dataset.edit));
  on(page, 'click', '[data-close-editor]', () => { closeEditor(); renderPlan(); });
  on(page, 'click', '[data-new]', async () => {
    const name = await promptDialog({ title: 'New workout', label: 'Name', placeholder: 'e.g. Push day', maxLength: 40, ok: 'Create', validate: (v) => nameError(v) });
    if (!name) return;
    createWorkout(sanitizeWorkoutName(name));
    openEditor(sanitizeWorkoutName(name));
  });
  on(page, 'click', '[data-rename]', async () => {
    const from = editing;
    const to = await promptDialog({ title: 'Rename workout', label: 'Name', value: from, maxLength: 40, validate: (v) => nameError(v, from) });
    if (!to || sanitizeWorkoutName(to) === from) return;
    const name = sanitizeWorkoutName(to);
    // Rebuild the object so the routine keeps its position in the list.
    const next = {};
    Object.keys(state.workouts).forEach((k) => { next[k === from ? name : k] = state.workouts[k]; });
    state.workouts = next;
    renameInSchedule(state.schedule, from, name);
    const { deleted, restored } = planTombstones();
    setPlanTombstones([...new Set([...deleted, from])].filter((n) => n !== name), [...new Set([...restored.filter((n) => n !== from), ...(deleted.includes(name) ? [name] : [])])]);
    editing = name;
    renameRunningWorkout(from, name);
    savePlan();
    toast('Renamed. Past logs keep the old name.');
  });
  on(page, 'click', '[data-delete]', async () => {
    const name = editing;
    if (!(await confirmDialog(`“${name}” will be removed from your plan. Your workout history stays.`, { title: 'Delete workout?', ok: 'Delete', danger: true }))) return;
    closeEditor();
    deleteWorkout(name);
    toast('Workout deleted.');
  });
  on(page, 'click', '[data-share]', async () => {
    // Shared from inside the prompt: busy while it sends, once, with any error shown there.
    const routine = list();
    const title = await promptDialog({ title: 'Share with friends', label: 'Title your friends will see', value: editing, maxLength: 80, ok: 'Share', busy: 'Sharing…', hint: 'Friends can copy this routine into their plan.', submit: async (t) => (await shareWorkout(t, routine)).error || '' });
    if (title) toast('Shared with your friends.');
  });
  on(page, 'click', '[data-move]', (e, b) => {
    const { l, i, name } = exerciseOf(b), j = i + +b.dataset.move;
    if (!l || i < 0 || j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    savePlan();
    // Follow the exercise: focus its move button in the new position (or the other one at an end).
    const row = page.querySelector(`[data-ex="${CSS.escape(name)}"]`);
    const again = row?.querySelector(`[data-move="${b.dataset.move}"]:not([aria-disabled])`) || row?.querySelector('[data-move]:not([aria-disabled])');
    again?.focus({ preventScroll: true });
  });
  on(page, 'click', '[data-remove]', (e, b) => {
    const { l, i } = exerciseOf(b), routine = editing;
    if (!l || i < 0) return;
    const [removed] = l.splice(i, 1);
    savePlan();
    toast(removed.name + ' removed.', {
      action: { label: 'Undo', onClick: () => { const r = state.workouts[routine]; if (!r || r.some((x) => x.name === removed.name)) return; r.splice(Math.min(i, r.length), 0, removed); savePlan(); } },
    });
  });
  on(page, 'click', '[data-sets]', (e, b) => {
    const { l, i } = exerciseOf(b);
    if (!l || i < 0) return;
    const ex = l[i], step = ex.unilateral ? 2 : 1;
    ex.sets = Math.max(step, Math.min(MAX_SETS * step, ex.sets + +b.dataset.sets * step));
    savePlan();
    // Announce only the change the user made (the counters themselves are silent).
    const status = $('planStatus');
    if (status) status.textContent = `${ex.name}: ${displaySets(ex)} ${ex.unilateral ? 'sets per side' : 'sets'}`;
  });
  on(page, 'change', '[data-field]', (e, input) => {
    const { l, i } = exerciseOf(input);
    if (!l || i < 0) return;
    const ex = l[i];
    const field = input.dataset.field;
    if (field === 'unilateral') {
      // Keep the number of sets per side when switching.
      ex.sets = input.checked ? ex.sets * 2 : Math.max(1, Math.round(ex.sets / 2));
      ex.unilateral = input.checked;
      if (input.checked) ex.sides = 'both'; else delete ex.sides;
    } else if (field === 'rest') ex.rest = +input.value;
    else ex[field] = input.value.trim().slice(0, field === 'note' ? 200 : 20);
    savePlan();
  });
  on(page, 'click', '[data-group]', (e, b) => {
    group = b.dataset.group;
    page.querySelectorAll('[data-group]').forEach((c) => { c.classList.toggle('on', c === b); c.setAttribute('aria-checked', String(c === b)); c.setAttribute('tabindex', c === b ? '0' : '-1'); });
    render($('exResults'), searchResults(list()));
  });
  on(page, 'input', '#exSearch', (e, input) => {
    query = input.value;
    render($('exResults'), searchResults(list()));
  });
  const add = (name, cat, unilateral) => {
    const l = list();
    if (l.some((x) => x.name.toLowerCase() === name.toLowerCase())) return;
    const ex = { name, cat, sets: unilateral ? DEFAULT_SETS * 2 : DEFAULT_SETS, target: DEFAULT_TARGET, rest: REST_DEFAULTS[name] ?? DEFAULT_REST, note: '' };
    if (unilateral) { ex.unilateral = true; ex.sides = 'both'; }
    l.push(ex);
    savePlan();
    toast(name + ' added.');
  };
  on(page, 'click', '[data-add]', (e, b) => {
    const x = CATALOG.find((c) => c.name === b.dataset.add);
    if (x) add(x.name, x.cat, x.unilateral);
  });
  on(page, 'click', '[data-add-custom]', async (e, b) => {
    const name = cut(b.dataset.addCustom.trim(), 80);
    const cat = await openSheet({
      title: 'Which muscle?', subtitle: name,
      body: html`<div class="chips wrap">${Object.entries(CATEGORIES).map(([k, v]) => html`<button type="button" class="chip" data-cat="${k}">${v}</button>`)}</div>`,
      onMount: (sheet, close) => sheet.querySelectorAll('[data-cat]').forEach((c) => { c.onclick = () => close(c.dataset.cat); }),
    });
    if (!cat) return;
    query = '';
    add(name, cat, looksUnilateral(name));
  });
}

/** Re-render after a data change, but not while the user is typing in the editor. */
export function onPlanUpdated() {
  const page = $('page-plan');
  if (!page.classList.contains('active')) return;
  const focused = document.activeElement;
  const typing = focused && page.contains(focused) && focused.matches('input:not([type=checkbox]), select, textarea');
  if (typing && focused.id !== 'exSearch') return;
  const keepSearch = focused && focused.id === 'exSearch';
  const scroll = window.scrollY;
  renderPlan();
  window.scrollTo(0, scroll);
  if (keepSearch) $('exSearch')?.focus({ preventScroll: true });
}
