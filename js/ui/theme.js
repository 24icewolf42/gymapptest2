// Applies the chosen theme (Settings → Appearance) to the page.
import { state } from '../state.js';
import { sanitizeTheme, resolveBase, themeColors } from '../domain/theme.js';

const light = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;

/** The theme as shown now: { base, accent, ink, soft, adjusted } plus the stored choice. */
export function currentTheme() {
  const theme = sanitizeTheme(state.settings.theme);
  const base = resolveBase(theme.base, !!light?.matches);
  return { ...theme, shown: base, ...themeColors(theme, base) };
}

export function applyTheme() {
  const t = currentTheme();
  const root = document.documentElement;
  if (t.shown === 'light') root.dataset.theme = 'light'; else delete root.dataset.theme;
  root.style.setProperty('--accent', t.accent);
  root.style.setProperty('--accent-ink', t.ink);
  root.style.setProperty('--accent-soft', t.soft);
  // The phone's status bar matches the page.
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg || '#0d0e10');
}

/** Follows the phone's dark/light setting while "Match phone" is chosen. */
export function initTheme() {
  applyTheme();
  light?.addEventListener?.('change', () => { if (sanitizeTheme(state.settings.theme).base === 'system') applyTheme(); });
}
