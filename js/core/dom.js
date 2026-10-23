// DOM helpers. Every string that reaches innerHTML goes through html``, which
// escapes interpolated values unless they are already SafeHtml.

class SafeHtml {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

/** Trusted markup that should not be escaped (icons, already-built fragments). */
export function raw(markup) {
  return new SafeHtml(String(markup ?? ''));
}

function part(value) {
  if (value == null || typeof value === 'boolean') return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(part).join('');
  return esc(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => { out += part(value) + strings[i + 1]; });
  return new SafeHtml(out);
}

/**
 * Updates `el` to show `content`, changing only what differs. Elements that
 * stay keep their identity, so focus, caret, scroll position and screen-reader
 * position survive background refreshes. Rows can carry data-key to be matched
 * by identity instead of position.
 */
export function render(el, content) {
  if (!el) return;
  const tpl = document.createElement('template');
  tpl.innerHTML = part(content);
  // A different view (marked with data-view on its first element) is a new
  // screen: replace it, so a button being clicked is never morphed into another.
  const view = (node) => node?.firstElementChild?.getAttribute('data-view') ?? null;
  if (!el.firstChild || view(el) !== view(tpl.content)) { el.replaceChildren(tpl.content); return; }
  morphChildren(el, tpl.content);
}

/** Replaces the content outright (a new screen, not an update of the current one). */
export function replaceContent(el, content) {
  if (el) el.innerHTML = part(content);
}

const keyOf = (n) => (n.nodeType === 1 ? n.getAttribute('data-key') || (n.id ? '#' + n.id : null) : null);

function sameKind(a, b) {
  return a.nodeType === b.nodeType && (a.nodeType !== 1 || (a.tagName === b.tagName && a.getAttribute('type') === b.getAttribute('type')));
}

function morphChildren(from, to) {
  const keyed = new Map();
  [...from.childNodes].forEach((n) => { const k = keyOf(n); if (k) keyed.set(k, n); });
  let cursor = from.firstChild;
  [...to.childNodes].forEach((next) => {
    const k = keyOf(next);
    let match = null;
    if (k) {
      match = keyed.get(k) || null;
      if (match && !sameKind(match, next)) match = null;
    } else if (cursor && !keyOf(cursor) && sameKind(cursor, next)) {
      match = cursor;
    }
    if (match) {
      if (match !== cursor) from.insertBefore(match, cursor);
      else cursor = cursor.nextSibling;
      morphNode(match, next);
      if (k) keyed.delete(k);
    } else {
      from.insertBefore(next, cursor);
    }
  });
  while (cursor) { const n = cursor.nextSibling; cursor.remove(); cursor = n; }
}

function morphNode(a, b) {
  if (a.nodeType === 3 || a.nodeType === 8) {
    if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue;
    return;
  }
  const focused = a === document.activeElement;
  const isField = a.matches('input, textarea, select');
  [...a.attributes].forEach((attr) => { if (!b.hasAttribute(attr.name)) a.removeAttribute(attr.name); });
  [...b.attributes].forEach((attr) => {
    if (focused && isField && (attr.name === 'value' || attr.name === 'checked')) return;
    if (a.getAttribute(attr.name) !== attr.value) a.setAttribute(attr.name, attr.value);
  });
  if (isField && !focused) {
    if (a.type === 'checkbox' || a.type === 'radio') a.checked = b.hasAttribute('checked');
    else if (a.tagName !== 'SELECT' && a.value !== (b.getAttribute('value') ?? b.textContent ?? '')) a.value = b.getAttribute('value') ?? (a.tagName === 'TEXTAREA' ? b.textContent : '');
  }
  if (a.tagName === 'TEXTAREA') return;
  morphChildren(a, b);
  if (a.tagName === 'SELECT' && !focused) {
    const sel = [...b.options].findIndex((o) => o.hasAttribute('selected'));
    if (sel >= 0) a.selectedIndex = sel;
  }
}

export const $ = (id) => document.getElementById(id);

/** Delegated event listener: handler(event, matchedElement). */
export function on(root, type, selector, handler, options) {
  root.addEventListener(type, (event) => {
    const target = event.target.closest?.(selector);
    if (target && root.contains(target)) handler(event, target);
  }, options);
}

let toastTimer = null;
/** Short message; `action: { label, onClick }` adds a button (e.g. Undo). */
export function toast(message, { tone = 'default', ms = 2600, action = null } = {}) {
  const el = $('toast');
  if (!el) return;
  el.replaceChildren(document.createTextNode(message));
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-action';
    b.textContent = action.label;
    b.onclick = () => { el.classList.remove('show'); action.onClick(); };
    el.append(' ', b);
  }
  el.dataset.tone = tone;
  el.classList.toggle('has-action', !!action);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? Math.max(ms, 5000) : ms);
}

/** Arrow keys move between tabs, radio chips and list options (ARIA keyboard model). */
export function enableArrowKeys(root = document) {
  root.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    const group = e.target.closest?.('[role=tablist], [role=radiogroup], [role=listbox]');
    if (!group) return;
    const items = [...group.querySelectorAll('[role=tab], [role=radio], [role=option]')].filter((x) => !x.disabled);
    const i = items.indexOf(e.target);
    if (i < 0) return;
    e.preventDefault();
    const n = items.length;
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + n) % n;
    items[next].focus();
    // Tabs and radios follow focus; list options are chosen with Enter/Space.
    if (group.getAttribute('role') !== 'listbox') items[next].click();
  });
}

export function haptic(pattern = 12) {
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}

/** Stable colour for a username, used for avatar circles. */
export function avatarHue(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

export function avatar(name, size = 'md') {
  const label = String(name || '?').slice(0, 1).toUpperCase();
  return html`<span class="avatar avatar-${size}" style="--hue:${avatarHue(name)}" aria-hidden="true">${label}</span>`;
}
