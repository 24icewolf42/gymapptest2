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

export function render(el, content) {
  if (el) el.innerHTML = part(content);
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
export function toast(message, { tone = 'default', ms = 2600 } = {}) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.dataset.tone = tone;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
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
