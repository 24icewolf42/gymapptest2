// Color themes: base (dark or light), a preset or custom primary color, and
// the contrast rules that keep any chosen color readable. Pure functions.

export const BASES = ['dark', 'light', 'system'];

export const PRESETS = [
  { id: 'lime', name: 'Lime', color: '#c8f53d' },
  { id: 'ocean', name: 'Ocean', color: '#38bdf8' },
  { id: 'grape', name: 'Grape', color: '#a78bfa' },
  { id: 'ember', name: 'Ember', color: '#fb923c' },
  { id: 'rose', name: 'Rose', color: '#f472b6' },
  { id: 'mint', name: 'Mint', color: '#34d399' },
];

// The surfaces text in the primary color sits on, per base (see css/app.css).
const SURFACES = {
  dark: ['#0d0e10', '#16181b', '#1d2024', '#262a2f'],
  light: ['#f5f6f8', '#ffffff', '#eef0f3', '#e3e6ea'],
};
const INKS = ['#0d0e10', '#ffffff'];
const TEXT_CONTRAST = 4.5; // WCAG AA for normal text
const TINT = 0.16; // the strongest tint of the color used behind text in it (css/app.css)

export const DEFAULT_THEME = { base: 'dark', preset: 'lime', color: PRESETS[0].color };

const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = (v) => typeof v === 'string' && HEX.test(v);

/** A theme from settings, which may come from a backup file: only known values pass. */
export function sanitizeTheme(t) {
  const base = BASES.includes(t?.base) ? t.base : DEFAULT_THEME.base;
  const preset = PRESETS.find((p) => p.id === t?.preset);
  if (preset) return { base, preset: preset.id, color: preset.color };
  if (t?.preset === 'custom' && isHex(t.color)) return { base, preset: 'custom', color: t.color.toLowerCase() };
  return { ...DEFAULT_THEME, base };
}

const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb) => '#' + rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('');

/** Relative luminance (WCAG 2). */
export function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two colors, 1 to 21. */
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

const mix = (hex, toward, amount) => {
  const a = toRgb(hex), b = toRgb(toward);
  return toHex(a.map((c, i) => c + (b[i] - c) * amount));
};

/**
 * The color, made just dark or light enough to reach `min` contrast against
 * every one of `surfaces` (mixed toward black on light surfaces, toward white
 * on dark ones). Returns the original when it already does.
 */
export function readableOn(hex, surfaces, min = TEXT_CONTRAST, tint = 0) {
  // With `tint`, also on each surface tinted with the color itself (soft chips, hero cards).
  const all = (c) => (tint ? surfaces.concat(surfaces.map((s) => mix(s, c, tint))) : surfaces);
  const ok = (c) => all(c).every((s) => contrast(c, s) >= min);
  if (ok(hex)) return hex;
  const toward = luminance(surfaces[0]) > 0.5 ? '#000000' : '#ffffff';
  for (let step = 1; step <= 50; step++) {
    const c = mix(hex, toward, step / 50);
    if (ok(c)) return c;
  }
  return toward;
}

/** The text color (dark or white) with the higher contrast on a fill. */
export function inkFor(fill) {
  return contrast(fill, INKS[0]) >= contrast(fill, INKS[1]) ? INKS[0] : INKS[1];
}

/** Which base is shown: 'system' follows the phone's setting. */
export function resolveBase(base, prefersLight) {
  return base === 'system' ? (prefersLight ? 'light' : 'dark') : base;
}

/**
 * CSS custom properties for a theme on a resolved base: the primary color as
 * shown (adjusted for contrast if needed), the text color on it, and its soft
 * tint. `adjusted` says whether the chosen color had to change.
 */
export function themeColors(theme, base) {
  const t = sanitizeTheme(theme);
  const accent = readableOn(t.color, SURFACES[base] || SURFACES.dark, TEXT_CONTRAST, TINT);
  const [r, g, b] = toRgb(accent);
  return {
    accent,
    ink: inkFor(accent),
    soft: `rgba(${r}, ${g}, ${b}, ${base === 'light' ? 0.12 : 0.14})`,
    adjusted: accent !== t.color,
  };
}
