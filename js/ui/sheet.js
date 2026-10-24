// Bottom sheets and dialogs, replacing window.prompt/confirm.
import { html, replaceContent, updateToastReach } from '../core/dom.js';
import { pushLayer } from '../core/router.js';
import { icons } from './icons.js';

const open = []; // stack of open sheets; only the top one reacts to Escape
let counter = 0;

/**
 * Opens a bottom sheet. Resolves with the value of the action pressed, or with
 * whatever `close(value)` was called with; null when dismissed.
 * - body: SafeHtml (use html``)
 * - actions: [{ label, value, tone: 'primary'|'secondary'|'danger'|'ghost', submit, onClick(finish, sheet) }]
 *   listed in the order they are shown and read (main action first)
 * - onMount(sheet, close): wire up custom controls
 * - dismissible: false for a question that must be answered (no close button;
 *   Escape, the backdrop, dragging and Back do not close it)
 */
export function openSheet({ title, subtitle = '', body = '', actions = [], onMount, className = '', dismissible = true }) {
  return new Promise((resolve) => {
    const id = 'sheet-title-' + ++counter;
    const root = document.getElementById('sheetRoot');
    const backdrop = document.createElement('div');
    backdrop.className = 'sheet-backdrop';
    replaceContent(backdrop, html`
      <form class="sheet ${className}" role="${dismissible ? 'dialog' : 'alertdialog'}" aria-modal="true" aria-labelledby="${id}" tabindex="-1" novalidate>
        <div class="sheet-handle" aria-hidden="true"></div>
        <header class="sheet-head">
          <div>
            <h2 id="${id}">${title}</h2>
            ${subtitle ? html`<p class="sheet-sub">${subtitle}</p>` : ''}
          </div>
          ${dismissible ? html`<button type="button" class="icon-btn" data-sheet-close aria-label="Close">${icons.x}</button>` : ''}
        </header>
        <div class="sheet-body" id="${id}-body">${body}</div>
        ${actions.length ? html`<div class="sheet-actions">${actions.map((a, i) => html`<button type="${a.submit ? 'submit' : 'button'}" class="btn btn-${a.tone || 'secondary'}" data-sheet-action="${i}">${a.label}</button>`)}</div>` : ''}
      </form>`);
    root.appendChild(backdrop);
    updateToastReach();
    // Described by its first sentence of text, not the whole body.
    const lead = backdrop.querySelector('.sheet-body .sheet-text');
    if (lead) { lead.id = id + '-desc'; backdrop.querySelector('.sheet').setAttribute('aria-describedby', lead.id); }
    const sheet = backdrop.querySelector('.sheet');
    // Everything behind the sheet (the page, the workout screen, older sheets) is inert.
    const behind = [...document.querySelectorAll('#app, #bottomNav, #activeBar, #session, #sheetRoot > .sheet-backdrop')].filter((el) => el !== backdrop && !el.inert);
    behind.forEach((el) => { el.inert = true; });
    let done = false;
    // While it saves (prompt submit), the sheet can't be closed: the result must be seen.
    const closable = () => dismissible && !sheet.dataset.busy;
    const entry = { close: () => { if (closable()) finish(null); }, backdrop, behind, previousFocus: document.activeElement };
    open.push(entry);

    const finish = (value, fromBack) => {
      if (done) return;
      done = true;
      const at = open.indexOf(entry);
      open.splice(at, 1);
      if (!fromBack) closeLayer();
      backdrop.classList.remove('open');
      backdrop.classList.add('closing');
      updateToastReach();
      setTimeout(() => backdrop.remove(), 180);
      const above = open[at];
      if (above) {
        // A sheet above this one is still open: it keeps the page inert and
        // takes over where focus returns to; focus stays in it.
        entry.behind.forEach((el) => { if (el !== above.backdrop && !above.behind.includes(el)) above.behind.push(el); });
        if (!above.previousFocus?.isConnected || backdrop.contains(above.previousFocus)) above.previousFocus = entry.previousFocus;
        resolve(value === undefined ? null : value);
        return;
      }
      entry.behind.forEach((el) => { el.inert = false; });
      const previousFocus = entry.previousFocus;
      // Back to where the user was; if that control is gone, to the page heading.
      if (previousFocus && previousFocus.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus({ preventScroll: true });
      else {
        const h = document.querySelector('.page.active h1, #session:not([hidden]) h2');
        if (h) { if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
      }
      resolve(value === undefined ? null : value);
    };
    // Back closes the sheet, unless it must be answered: then it stays.
    const onBack = () => { if (closable()) finish(null, true); else closeLayer = pushLayer(onBack); };
    let closeLayer = pushLayer(onBack);

    backdrop.addEventListener('click', (e) => { if (e.target === backdrop && closable()) finish(null); });
    if (dismissible) sheet.querySelector('[data-sheet-close]').onclick = () => { if (closable()) finish(null); };
    sheet.querySelectorAll('[data-sheet-action]').forEach((b) => {
      const a = actions[+b.dataset.sheetAction];
      if (!a.submit) b.onclick = () => { if (!sheet.dataset.busy) (a.onClick ? a.onClick(finish, sheet) : finish(a.value)); };
    });
    sheet.addEventListener('submit', (e) => {
      e.preventDefault();
      const a = actions.find((x) => x.submit);
      if (a) a.onClick ? a.onClick(finish, sheet) : finish(a.value);
    });
    if (dismissible) enableDragToClose(sheet, () => { if (closable()) finish(null); });
    onMount?.(sheet, finish);
    requestAnimationFrame(() => {
      backdrop.classList.add('open');
      (sheet.querySelector('[autofocus]') || sheet).focus({ preventScroll: true });
    });
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && open.length) {
    e.stopPropagation();
    open[open.length - 1].close();
  }
}, true);

function enableDragToClose(sheet, close) {
  const handle = sheet.querySelector('.sheet-handle'), head = sheet.querySelector('.sheet-head');
  let startY = 0, dy = 0, dragging = false;
  const start = (e) => { dragging = true; startY = e.touches[0].clientY; dy = 0; sheet.style.transition = 'none'; };
  const move = (e) => { if (!dragging) return; dy = Math.max(0, e.touches[0].clientY - startY); sheet.style.transform = `translateY(${dy}px)`; };
  const end = () => {
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (dy > 110) close();
  };
  [handle, head].forEach((el) => {
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', end, { passive: true });
  });
}

export async function confirmDialog(message, { title = 'Are you sure?', ok = 'OK', cancel = 'Cancel', danger = false } = {}) {
  const value = await openSheet({
    title,
    body: html`<p class="sheet-text">${message}</p>`,
    actions: [{ label: ok, value: true, tone: danger ? 'danger' : 'primary' }, { label: cancel, value: false, tone: 'ghost' }],
  });
  return value === true;
}

/**
 * Asks for one value. `input` adds attributes for the field
 * (e.g. { inputmode: 'numeric', autocomplete: 'one-time-code' }).
 */
export function promptDialog({ title, label, value = '', placeholder = '', maxLength = 80, hint = '', ok = 'Save', type = 'text', validate, input = {}, submit, trim = true }) {
  const extra = Object.entries({ autocomplete: 'off', ...input }).map(([k, v]) => html` ${k}="${v}"`);
  // The hint (why this is asked) and any error describe the field.
  const hintId = 'prompt-hint-' + ++counter, errorId = 'prompt-error-' + counter;
  return openSheet({
    title,
    body: html`
      <label class="field"><span>${label}</span>
        <input class="input" name="value" type="${type}" value="${value}" placeholder="${placeholder}" maxlength="${maxLength}"${extra} aria-describedby="${hint ? hintId + ' ' : ''}${errorId}" autofocus>
      </label>
      ${hint ? html`<p class="hint" id="${hintId}">${hint}</p>` : ''}
      <p class="form-error" id="${errorId}" aria-live="polite"></p>`,
    actions: [
      {
        label: ok, tone: 'primary', submit: true,
        onClick: async (finish, sheet) => {
          const field = sheet.querySelector('input[name=value]'), v = trim ? field.value.trim() : field.value;
          const button = sheet.querySelector('[type=submit]');
          if (button.getAttribute('aria-disabled') === 'true') return;
          const showError = (error) => { sheet.querySelector('.form-error').textContent = error; field.focus(); };
          const error = validate ? validate(v) : (v ? '' : 'Please fill this in.');
          if (error) { showError(error); return; }
          // submit(v) saves on the server and returns an error to show, or '' (the prompt stays open on an error).
          if (submit) {
            // Saving: said in the status line, the field is read-only, and the
            // ways to close are marked unavailable until the server answers.
            const label = button.textContent;
            const closers = [...sheet.querySelectorAll('[data-sheet-close], [data-sheet-action]:not([type=submit])')];
            const status = sheet.querySelector('.form-error');
            const busy = (on) => {
              if (on) sheet.dataset.busy = '1'; else delete sheet.dataset.busy;
              [button, ...closers].forEach((b) => (on ? b.setAttribute('aria-disabled', 'true') : b.removeAttribute('aria-disabled')));
              button.textContent = on ? 'Saving…' : label;
              field.readOnly = on;
              status.textContent = on ? 'Saving…' : '';
            };
            busy(true);
            // A step that throws (e.g. the session ended) must not leave the prompt stuck.
            const failed = await Promise.resolve().then(() => submit(v)).catch((e) => (e && e.message) || 'Something went wrong. Try again.');
            busy(false);
            if (failed) { showError(failed); return; }
          }
          finish(v);
        },
      },
      { label: 'Cancel', value: null, tone: 'ghost' },
    ],
  });
}
