// DOM helpers. Every string that reaches the page goes through html``, which
// escapes interpolated values unless they are already SafeHtml. With Trusted
// Types enforced by the CSP, the escaped strings enter the DOM only through
// the policy below.

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

// The only way markup reaches innerHTML. Input is either built by html`` (all
// values escaped) or fixed strings from this codebase.
const policy = globalThis.trustedTypes?.createPolicy?.('tracker', {
  createHTML: (s) => s,
  // The service worker is the only script URL the app ever loads at runtime.
  createScriptURL: (u) => { if (u !== 'sw.js') throw new TypeError('Script URL not allowed: ' + u); return u; },
}) ?? null;

/** Script URL accepted by the Trusted Types policy (only the service worker). */
export const scriptURL = (u) => (policy ? policy.createScriptURL(u) : u);

/** Parses content into a fragment. */
export function fragment(content) {
  const tpl = document.createElement('template');
  const markup = part(content);
  tpl.innerHTML = policy ? policy.createHTML(markup) : markup;
  return tpl.content;
}

const focusable = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusHeading(el) {
  const h = el.querySelector('h1, h2');
  if (!h) return;
  if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
  h.focus({ preventScroll: true });
}

/**
 * Updates `el` to show `content`, changing only what differs. Elements that
 * stay keep their identity, so focus, caret, scroll position and screen-reader
 * position survive background refreshes. Rows can carry data-key to be matched
 * by identity instead of position. If the focused control disappears (e.g. a
 * row was removed by a server update), focus moves to the same row, the next
 * row, or the page heading instead of being lost.
 */
export function render(el, content) {
  if (!el) return;
  const next = fragment(content);
  const active = document.activeElement;
  const hadFocus = !!active && active !== document.body && el.contains(active);
  // A different view (marked with data-view on its first element) is a new
  // screen: replace it, so a button being clicked is never morphed into another.
  const view = (node) => node?.firstElementChild?.getAttribute('data-view') ?? null;
  if (!el.firstChild || view(el) !== view(next)) {
    el.replaceChildren(next);
    if (hadFocus) focusHeading(el);
    return;
  }
  const row = hadFocus ? active.closest('[data-key]') : null;
  const siblings = row && row.parentElement ? [...row.parentElement.children] : [];
  const keys = row ? [row, ...siblings.slice(siblings.indexOf(row) + 1)].map((n) => n.getAttribute('data-key')).filter(Boolean) : [];
  const selection = hadFocus && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  morphChildren(el, next);
  if (!hadFocus) return;
  // A control that became disabled still looks focused here, but the browser
  // drops its focus a frame later, so it counts as lost.
  const usable = active.isConnected && el.contains(active) && !active.matches(':disabled');
  if (usable && document.activeElement === active) return;
  if (usable) {
    active.focus({ preventScroll: true });
    if (selection) { try { active.setSelectionRange(...selection); } catch { /* not a text field */ } }
    return;
  }
  const target = keys.map((k) => el.querySelector(`[data-key="${CSS.escape(k)}"]`)).find(Boolean);
  const control = target && (target.matches(focusable) || target.getAttribute('tabindex') === '-1' ? target : target.querySelector(focusable));
  if (control) control.focus({ preventScroll: true });
  else focusHeading(el);
}

/** Replaces the content outright (a new screen, not an update of the current one). */
export function replaceContent(el, content) {
  if (el) el.replaceChildren(fragment(content));
}

/** Inserts content at the end of `el`. */
export function appendContent(el, content) {
  if (el) el.append(fragment(content));
}

const keyOf = (n) => (n.nodeType === 1 ? n.getAttribute('data-key') || (n.id ? '#' + n.id : null) : null);

function sameKind(a, b) {
  return a.nodeType === b.nodeType && (a.nodeType !== 1 || (a.tagName === b.tagName && a.getAttribute('type') === b.getAttribute('type')));
}

function morphChildren(from, to) {
  const wanted = new Set([...to.childNodes].map(keyOf).filter(Boolean));
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
      // Moving an element blurs it, so remove what stands in front of it
      // instead, as long as those nodes are not needed later.
      while (cursor && cursor !== match && !wanted.has(keyOf(cursor)) && isAfter(match, cursor)) {
        const n = cursor.nextSibling;
        cursor.remove();
        cursor = n;
      }
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

function isAfter(node, ref) {
  return !!(ref.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function morphNode(a, b) {
  if (a.nodeType === 3 || a.nodeType === 8) {
    if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue;
    return;
  }
  const focused = a === document.activeElement;
  const isField = a.matches('input, textarea, select');
  const oldValue = a.getAttribute('value'), oldChecked = a.hasAttribute('checked');
  // Headings made focusable as a focus fallback (tabindex="-1") stay focusable.
  const keep = (name) => name === 'tabindex' && /^H[1-6]$/.test(a.tagName) && a.getAttribute('tabindex') === '-1';
  [...a.attributes].forEach((attr) => { if (!b.hasAttribute(attr.name) && !keep(attr.name)) a.removeAttribute(attr.name); });
  [...b.attributes].forEach((attr) => {
    if (focused && isField && (attr.name === 'value' || attr.name === 'checked')) return;
    if (a.getAttribute(attr.name) !== attr.value) a.setAttributeNode(attr.cloneNode()); // older WebViews reject some parsed names in setAttribute
  });
  if (isField && !focused) {
    // Only apply what the app changed: text the user typed into a field the
    // app did not touch survives a background refresh.
    if (a.type === 'checkbox' || a.type === 'radio') {
      if (b.hasAttribute('checked') !== oldChecked) a.checked = b.hasAttribute('checked');
    } else if (a.tagName === 'TEXTAREA') {
      if (b.textContent !== a.defaultValue) a.value = b.textContent;
    } else if (a.tagName !== 'SELECT' && b.getAttribute('value') !== oldValue) {
      a.value = b.getAttribute('value') ?? '';
    }
  }
  if (a.tagName === 'TEXTAREA') return;
  morphChildren(a, b);
  if (a.tagName === 'SELECT' && !focused) {
    const sel = [...b.options].findIndex((o) => o.hasAttribute('selected'));
    if (sel >= 0) a.selectedIndex = sel;
  }
}

export const $ = (id) => document.getElementById(id);

/** Delegated event listener: handler(event, matchedElement). Busy (aria-disabled) controls are ignored. */
export function on(root, type, selector, handler, options) {
  root.addEventListener(type, (event) => {
    const target = event.target.closest?.(selector);
    if (!target || !root.contains(target)) return;
    if (target.getAttribute('aria-disabled') === 'true') { event.preventDefault(); return; }
    handler(event, target);
  }, options);
}

/** Marks a control busy without disabling it (disabling a focused control blurs it). */
export function busyAttr(isBusy) {
  return isBusy ? raw(' aria-disabled="true"') : '';
}

let toastTimer = null;
let toastOrigin = null;
let errorUntil = 0;
const TOAST_RESUME_MS = 3000;
/**
 * Short message. `action: { label, onClick }` adds a button (e.g. Undo).
 * Errors stay longer, are announced assertively (through a separate alert
 * region), and a routine message that arrives right after one does not
 * replace it. The toast stays while it has focus or the pointer.
 */
export function toast(message, { tone = 'default', ms = 2600, action = null } = {}) {
  const el = $('toast');
  if (!el) return;
  if (tone !== 'error' && Date.now() < errorUntil) return;
  wireToast(el);
  const active = document.activeElement;
  if (active && active !== document.body && !el.contains(active)) toastOrigin = active;
  el.replaceChildren(document.createTextNode(message));
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-action';
    b.textContent = action.label;
    b.onclick = () => { hideToast(el); action.onClick(); };
    el.append(' ', b);
  }
  const alert = $('toastAlert');
  const assertive = tone === 'error' && !action && alert;
  if (alert) alert.textContent = assertive ? message : '';
  // The visible toast is a polite status; an error is read from the alert region instead.
  if (assertive) el.setAttribute('aria-hidden', 'true');
  else el.removeAttribute('aria-hidden');
  el.dataset.tone = tone;
  el.classList.toggle('has-action', !!action);
  el.classList.add('show');
  const duration = tone === 'error' ? Math.max(ms, 6000) : action ? Math.max(ms, 10000) : ms;
  if (tone === 'error') errorUntil = Date.now() + duration;
  scheduleHide(el, duration);
}

function scheduleHide(el, ms) {
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hideToast(el), ms);
}

function wireToast(el) {
  if (el.dataset.wired) return;
  el.dataset.wired = '1';
  const hold = () => clearTimeout(toastTimer);
  const resume = () => { if (el.classList.contains('show')) scheduleHide(el, TOAST_RESUME_MS); };
  el.addEventListener('focusin', hold);
  el.addEventListener('mouseenter', hold);
  el.addEventListener('focusout', (e) => { if (!el.contains(e.relatedTarget)) resume(); });
  el.addEventListener('mouseleave', () => { if (!el.contains(document.activeElement)) resume(); });
}

function hideToast(el) {
  clearTimeout(toastTimer);
  // Focus on the toast goes back to where the user was, not to the page top.
  if (el.contains(document.activeElement)) {
    const origin = toastOrigin;
    if (origin && origin.isConnected && !origin.closest('[inert]') && !origin.matches(':disabled')) origin.focus({ preventScroll: true });
    else focusHeading(document.querySelector('#session:not([hidden])') || document.querySelector('.page.active') || document.body);
  }
  toastOrigin = null;
  el.classList.remove('show', 'has-action');
  // An invisible Undo button must not stay reachable by keyboard.
  setTimeout(() => { if (!el.classList.contains('show')) el.replaceChildren(); }, 250);
}

/** Arrow keys move between tabs, radio chips, list options and calendar days (ARIA keyboard models). */
export function enableArrowKeys(root = document) {
  root.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    const grid = e.target.closest?.('[data-grid]');
    if (grid) {
      const cells = [...grid.querySelectorAll('[data-day]')];
      const i = cells.indexOf(e.target);
      if (i < 0) return;
      e.preventDefault();
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -i, End: cells.length - 1 - i }[e.key];
      const next = cells[Math.max(0, Math.min(cells.length - 1, i + step))];
      cells.forEach((c) => c.setAttribute('tabindex', c === next ? '0' : '-1'));
      next.focus();
      return;
    }
    const group = e.target.closest?.('[role=tablist], [role=radiogroup], [role=listbox]');
    if (!group) return;
    const items = [...group.querySelectorAll('[role=tab], [role=radio], [role=option]')].filter((x) => !x.disabled);
    const i = items.indexOf(e.target);
    if (i < 0) return;
    e.preventDefault();
    const n = items.length;
    const next = items[e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + n) % n];
    items.forEach((x) => x.setAttribute('tabindex', x === next ? '0' : '-1'));
    next.focus();
    // Tabs and radios follow focus; list options, and groups marked data-manual
    // (where choosing sends something to the server), wait for Enter/Space.
    if (group.getAttribute('role') !== 'listbox' && !group.hasAttribute('data-manual')) next.click();
  });
}

export function haptic(pattern = 12) {
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}

/** Colour bucket (0-11) for a username, used for avatar circles. */
function avatarHue(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.codePointAt(0)) % 360;
  return Math.floor(h / 30);
}

export function avatar(name, size = 'md') {
  const label = String(name || '?').slice(0, 1).toUpperCase();
  return html`<span class="avatar avatar-${size} hue-${avatarHue(name)}" aria-hidden="true">${label}</span>`;
}

/** Whether the user asked the system for less motion. */
export const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
