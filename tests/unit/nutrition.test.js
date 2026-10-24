import { describe, it, expect } from 'vitest';
import { sanitizeNutrition, sanitizeEntry, entrySummary } from '../../js/domain/nutrition.js';
import { sanitizeLogs } from '../../js/domain/logs.js';

describe('nutrition', () => {
  it('keeps only known picks, a short note, a known time and plausible amounts', () => {
    expect(sanitizeEntry({ items: ['shake', 'shake', 'pizza'], note: '  banana  ', when: '30-60', water: '500', protein: 25.4 }, 'pre'))
      .toEqual({ items: ['shake'], note: 'banana', when: '30-60', water: 500, protein: 25.4 });
    expect(sanitizeEntry({ water: true, protein: '  ' }, 'pre')).toBeNull();
    expect(sanitizeEntry({ items: ['nothing', 'meal'], water: 330, protein: '22,5' }, 'pre')).toEqual({ items: ['meal'], note: '', when: '', water: 330, protein: 22.5 });
    expect(sanitizeEntry({ items: [], note: '', water: -1, protein: 9999, when: 'soon' }, 'post')).toBeNull();
    expect(sanitizeEntry({ note: 'x'.repeat(200) }, 'pre').note).toHaveLength(80);
  });

  it('drops empty sides and returns null when nothing is logged', () => {
    expect(sanitizeNutrition({ pre: { items: ['meal'] }, post: {} })).toEqual({ pre: { items: ['meal'], note: '', when: '' } });
    expect(sanitizeNutrition({ pre: null, post: { note: '' } })).toBeNull();
    expect(sanitizeNutrition('nope')).toBeNull();
  });

  it('describes an entry in one line', () => {
    expect(entrySummary({ items: ['shake', 'fruit'], note: 'banana', when: 'lt30', water: 500, protein: 25 }, 'post'))
      .toBe('Shake, Fruit: banana · Within 30 min after · 500 ml water · 25 g protein');
  });

  it('travels with the session through sync and backups, cleaned', () => {
    const logs = sanitizeLogs({ '2026-10-20': [{ id: 'n1', day: 'Push', time: '2026-10-20T10:00:00.000Z', exercises: [], nutrition: { pre: { items: ['meal', '<script>'], note: 'rice' }, extra: 1 } }] });
    expect(logs['2026-10-20'][0].nutrition).toEqual({ pre: { items: ['meal'], note: 'rice', when: '' } });
    const none = sanitizeLogs({ '2026-10-20': [{ id: 'n2', day: 'Push', time: '2026-10-20T10:00:00.000Z', exercises: [] }] });
    expect('nutrition' in none['2026-10-20'][0]).toBe(false);
  });
});
