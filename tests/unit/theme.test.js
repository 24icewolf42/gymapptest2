import { describe, it, expect } from 'vitest';
import { PRESETS, sanitizeTheme, contrast, readableOn, inkFor, themeColors, resolveBase, DEFAULT_THEME } from '../../js/domain/theme.js';

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const tinted = (s, c, t = 0.25) => '#' + hex(s).map((v, i) => Math.round(v + (hex(c)[i] - v) * t).toString(16).padStart(2, '0')).join('');
const surfaces = {
  dark: ['#0d0e10', '#16181b', '#1d2024', '#262a2f'],
  light: ['#f5f6f8', '#ffffff', '#eef0f3', '#e3e6ea'],
};

describe('theme', () => {
  it('accepts only known bases, presets and plain hex colors (settings can come from a backup file)', () => {
    expect(sanitizeTheme(null)).toEqual(DEFAULT_THEME);
    expect(sanitizeTheme({ base: 'light', preset: 'ocean', color: '#000000' })).toEqual({ base: 'light', preset: 'ocean', color: '#38bdf8' });
    expect(sanitizeTheme({ base: 'dark', preset: 'custom', color: '#AABBCC' })).toEqual({ base: 'dark', preset: 'custom', color: '#aabbcc' });
    expect(sanitizeTheme({ base: 'neon', preset: 'custom', color: 'red; background:url(x)' })).toEqual(DEFAULT_THEME);
    expect(sanitizeTheme({ preset: 'custom', color: '#abc' }).preset).toBe('lime');
  });

  it('computes WCAG contrast', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#777777')).toBe(1);
  });

  it('keeps a readable color as it is and adjusts one that is not', () => {
    expect(readableOn('#c8f53d', surfaces.dark)).toBe('#c8f53d');
    const dark = readableOn('#c8f53d', surfaces.light);
    expect(dark).not.toBe('#c8f53d');
    surfaces.light.forEach((s) => expect(contrast(dark, s)).toBeGreaterThanOrEqual(4.5));
    const light = readableOn('#1a1a40', surfaces.dark);
    surfaces.dark.forEach((s) => expect(contrast(light, s)).toBeGreaterThanOrEqual(4.5));
  });

  it('the fill stays brighter than the text color where it can (3:1 for fills, 4.5:1 for text)', () => {
    const c = themeColors({ preset: 'lime' }, 'light');
    expect(contrast(c.accent, '#ffffff')).toBeLessThan(contrast(c.text, '#ffffff'));
  });

  it('every preset is readable on both bases, and the text on it too', () => {
    for (const p of PRESETS) {
      for (const base of ['dark', 'light']) {
        const c = themeColors({ base, preset: p.id }, base);
        surfaces[base].forEach((s) => expect(contrast(c.accent, s)).toBeGreaterThanOrEqual(3));
        surfaces[base].forEach((s) => expect(contrast(c.text, s)).toBeGreaterThanOrEqual(4.5));
        surfaces[base].forEach((s) => expect(contrast(c.text, tinted(s, c.accent))).toBeGreaterThanOrEqual(4.5));
        expect(contrast(c.ink, c.accent)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('any custom color ends up readable, and says when it was changed', () => {
    for (const color of ['#ffff00', '#000000', '#ffffff', '#808080', '#0000ff', '#ff0000']) {
      for (const base of ['dark', 'light']) {
        const c = themeColors({ base, preset: 'custom', color }, base);
        surfaces[base].forEach((s) => expect(contrast(c.accent, s)).toBeGreaterThanOrEqual(3));
        surfaces[base].forEach((s) => expect(contrast(c.text, s)).toBeGreaterThanOrEqual(4.5));
        expect(contrast(inkFor(c.accent), c.accent)).toBeGreaterThanOrEqual(4.5);
        expect(c.adjusted).toBe(c.accent !== color || c.text !== color);
      }
    }
  });

  it('follows the phone for "system"', () => {
    expect(resolveBase('system', true)).toBe('light');
    expect(resolveBase('system', false)).toBe('dark');
    expect(resolveBase('light', false)).toBe('light');
  });
});
