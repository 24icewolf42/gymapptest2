// Bottom sheets and dialogs, replacing window.prompt/confirm.
import { html, render } from '../core/dom.js';
import { pushLayer } from '../core/router.js';

/**
 * Opens a bottom sheet. Resolves with the value of the action pressed, or with
 * whatever `close(value)` was called with; null when dismissed.
 * - body: SafeHtml (use html``)
 * - actions: [{ label, value, tone: 'primary'|'secondary'|'danger'|'ghost', submit }]
 * - onMount(el, close): wire up custom controls
 */
export function openSheet({ title, subtitle = '', body = '', actions = [], onMount, className = '' }) {
  return new Promise((resolve) => {
    const root = document.getElementById('sheetRoot');
    const backdrop = document.createElement('div');
    backdrop.className = 'sheet-backdrop';
    render(backdrop, html`
      <form class="sheet ${className}" role="dialog" aria-modal="true" aria-labelledby="sheetTitle" novalidate>
        <div class="sheet-handle" aria-hidden="true"></div>
        <header class="sheet-head">
          <div>
            <h2 id="sheetTitle">${title}</h2>
            ${subtitle ? html`<p class="sheet-sub">${subtitle}</p>` : ''}
          </div>
          <button type="button" class="icon-btn" data-sheet-close aria-label="Close">${closeIcon}</button>
        </header>
        <div class="sheet-body">${body}</div>
        ${actions.length ? html`<div class="sheet-actions">${actions.map((a, i) => html`<button type="${a.submit ? 'submit' : 'button'}" class="btn btn-${a.tone || 'secondary'}" data-sheet-action="${i}">${a.label}</button>`)}</div>` : ''}
      </form>`);
    root.appendChild(backdrop);
    const sheet = backdrop.querySelector('.sheet');
    let done = false;
    const previousFocus = document.activeElement;

    const finish = (value, fromBack) => {
      if (done) return;
      done = true;
      if (!fromBack) closeLayer();
      backdrop.classList.add('closing');
      setTimeout(() => backdrop.remove(), 180);
      document.removeEventListener('keydown', onKey);
      previousFocus?.focus?.({ preventScroll: true });
      resolve(value === undefined ? null : value);
    };
    const closeLayer = pushLayer(() => finish(null, true));
    const onKey = (e) => { if (e.key === 'Escape') finish(null); };
    document.addEventListener('keydown', onKey);

    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) finish(null); });
    sheet.querySelector('[data-sheet-close]').onclick = () => finish(null);
    sheet.querySelectorAll('[data-sheet-action]').forEach((b) => {
      const a = actions[+b.dataset.sheetAction];
      if (!a.submit) b.onclick = () => (a.onClick ? a.onClick(finish) : finish(a.value));
    });
    sheet.addEventListener('submit', (e) => {
      e.preventDefault();
      const a = actions.find((x) => x.submit);
      if (a) a.onClick ? a.onClick(finish) : finish(a.value);
    });
    enableDragToClose(sheet, () => finish(null));
    onMount?.(sheet, finish);
    requestAnimationFrame(() => {
      backdrop.classList.add('open');
      (sheet.querySelector('[autofocus]') || sheet.querySelector('.sheet-actions .btn') || sheet).focus?.({ preventScroll: true });
    });
  });
}

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
    actions: [{ label: cancel, value: false, tone: 'ghost' }, { label: ok, value: true, tone: danger ? 'danger' : 'primary' }],
  });
  return value === true;
}

export function promptDialog({ title, label, value = '', placeholder = '', maxLength = 80, hint = '', ok = 'Save', type = 'text', validate }) {
  return openSheet({
    title,
    body: html`
      <label class="field"><span>${label}</span>
        <input class="input" name="value" type="${type}" value="${value}" placeholder="${placeholder}" maxlength="${maxLength}" autocomplete="off" autofocus>
      </label>
      ${hint ? html`<p class="hint">${hint}</p>` : ''}
      <p class="form-error" aria-live="polite"></p>`,
    actions: [
      { label: 'Cancel', value: null, tone: 'ghost' },
      {
        label: ok, tone: 'primary', submit: true,
        onClick: (finish) => {
          const sheet = document.querySelector('.sheet-backdrop:last-child .sheet');
          const input = sheet.querySelector('input[name=value]'), v = input.value.trim();
          const error = validate ? validate(v) : (v ? '' : 'Please fill this in.');
          if (error) { sheet.querySelector('.form-error').textContent = error; input.focus(); return; }
          finish(v);
        },
      },
    ],
  });
}

export const closeIcon = html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
