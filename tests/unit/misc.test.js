import { describe, it, expect } from 'vitest';
import { sanitizeWeights, mergeWeights, upsertWeight } from '../../js/domain/weights.js';
import { restState, roundToStep } from '../../js/domain/rest-timer.js';
import { makeBackup, parseBackup } from '../../js/domain/backup.js';
import { html, raw, esc } from '../../js/core/dom.js';
import { fmtClock, fmtDuration, relativeDay, relativeFromNow, mondayIndex, ymd } from '../../js/core/dates.js';
import { searchCatalog } from '../../js/domain/catalog.js';

describe('weights', () => {
  it('validates and de-duplicates entries', () => {
    expect(sanitizeWeights([{ date: '2026-01-02', weight: '70.555' }, { date: '2026-01-01', weight: 7550 }, { date: 'x', weight: 70 }, { date: '2026-01-02', weight: 71 }]))
      .toEqual([{ date: '2026-01-02', weight: 71 }]);
  });

  it('merges cloud rows by latest change, drops entries deleted elsewhere, keeps new local ones', () => {
    const remote = [{ log_date: '2026-01-01', weight_kg: '70.00', updated_at: '2026-01-05T00:00:00Z' }, { log_date: '2026-01-04', weight_kg: '66', updated_at: '2026-01-05T00:00:00Z' }];
    const local = [
      { date: '2026-01-01', weight: 69, updatedAt: Date.parse('2026-01-02') },
      { date: '2026-01-02', weight: 68 },
      { date: '2026-01-03', weight: 67 },
      { date: '2026-01-04', weight: 65 },
    ];
    expect(mergeWeights(remote, local, ['2026-01-01', '2026-01-02'])).toEqual([
      { date: '2026-01-01', weight: 70, updatedAt: Date.parse('2026-01-05T00:00:00Z') },
      { date: '2026-01-03', weight: 67 },
      { date: '2026-01-04', weight: 65 },
    ]);
  });

  it('keeps entries changed here until they are uploaded, whatever the clocks say', () => {
    const remote = [{ log_date: '2026-01-01', weight_kg: 80, updated_at: '2026-01-05T00:00:10Z' }];
    const local = [{ date: '2026-01-01', weight: 82, updatedAt: Date.parse('2026-01-05T00:00:05Z') }, { date: '2026-01-02', weight: 81, updatedAt: 1 }];
    expect(mergeWeights(remote, local, ['2026-01-01', '2026-01-02'], ['2026-01-01', '2026-01-02']).map((x) => x.weight)).toEqual([82, 81]);
    expect(mergeWeights(remote, local, ['2026-01-01', '2026-01-02']).map((x) => x.weight)).toEqual([80]);
  });

  it('upserts by day', () => {
    expect(upsertWeight([{ date: '2026-01-01', weight: 1 }], '2026-01-01', 2, 99)).toEqual([{ date: '2026-01-01', weight: 2, updatedAt: 99 }]);
  });
});

describe('rest timer', () => {
  const ex = { cat: 'chest', rest: 120 };
  it('uses the full rest for the same muscle and a short gap otherwise', () => {
    const now = 1_000_000;
    expect(restState(ex, { chest: now - 60_000 }, now - 60_000, now)).toMatchObject({ remaining: 60, reason: 'same', ready: false });
    expect(restState(ex, { back: now - 10_000 }, now - 10_000, now)).toMatchObject({ remaining: 20, reason: 'switch' });
    expect(restState(ex, {}, 0, now).ready).toBe(true);
    expect(restState({ cat: 'forearms', rest: 60 }, { biceps: now }, now, now).remaining).toBe(60);
  });

  it('rounds to the chosen plate step, or not at all', () => {
    expect(roundToStep('2', 0)).toBe('2');
    expect(roundToStep('62.4', 2.5)).toBe('62.5');
    expect(roundToStep('12', 5)).toBe('10');
    expect(roundToStep('-3', 5)).toBe('');
  });
});

describe('backup', () => {
  it('round-trips every key, including routines and the schedule', () => {
    const store = { gymLogs: '{}', gymCustomWorkouts: '{"Push":[]}', gymPlanSchedule: '{"0":"Push"}', other: 'x' };
    const parsed = parseBackup(makeBackup((k) => store[k] ?? null, '3.0.0'));
    expect(parsed).toEqual({ gymLogs: '{}', gymCustomWorkouts: '{"Push":[]}', gymPlanSchedule: '{"0":"Push"}' });
  });

  it('restores a backup made before any workout was logged', () => {
    expect(parseBackup(makeBackup((k) => ({ gymCustomWorkouts: '{"Push":[]}' })[k] ?? null, '3.0.0'))).toEqual({ gymCustomWorkouts: '{"Push":[]}' });
  });

  it('accepts the old flat format and rejects junk', () => {
    expect(parseBackup(JSON.stringify({ gymLogs: '{}', gymBypass: '{}' }))).toEqual({ gymLogs: '{}', gymBypass: '{}' });
    expect(() => parseBackup('nope')).toThrow();
    expect(() => parseBackup('{"x":1}')).toThrow();
    expect(() => parseBackup(JSON.stringify({ gymLogs: '{broken' }))).toThrow(/damaged/);
  });
});

describe('html escaping', () => {
  it('escapes interpolations unless raw', () => {
    const name = '<img src=x onerror=alert(1)>';
    expect(String(html`<b>${name}</b>`)).toBe('<b>&lt;img src=x onerror=alert(1)&gt;</b>');
    expect(String(html`<i>${raw('<br>')}</i>`)).toBe('<i><br></i>');
    expect(String(html`${['<a>', html`<b>${'&'}</b>`]}`)).toBe('&lt;a&gt;<b>&amp;</b>');
    expect(String(html`${null}${false}${true}${0}`)).toBe('0');
    expect(esc(`"'`)).toBe('&quot;&#39;');
  });
});

describe('dates', () => {
  it('formats clocks and durations', () => {
    expect(fmtClock(65)).toBe('1:05');
    expect(fmtClock(3725)).toBe('1:02:05');
    expect(fmtDuration(3900)).toBe('1h 5m');
    expect(mondayIndex(0)).toBe(6);
    expect(ymd(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('describes relative times', () => {
    const now = new Date(2026, 9, 23, 12, 0);
    expect(relativeDay(new Date(2026, 9, 23, 18), now)).toBe('Today');
    expect(relativeDay(new Date(2026, 9, 24, 1), now)).toBe('Tomorrow');
    expect(relativeDay(new Date(2026, 9, 27), now)).toBe('Tue 27 Oct');
    expect(relativeFromNow(new Date(now.getTime() + 25 * 60000), now)).toBe('in 25 min');
    expect(relativeFromNow(new Date(now.getTime() - 120 * 60000), now)).toBe('2 h ago');
  });
});

describe('catalog', () => {
  it('searches by name and muscle', () => {
    expect(searchCatalog('squat').every((x) => /squat/i.test(x.name))).toBe(true);
    expect(searchCatalog('biceps').length).toBeGreaterThan(3);
    expect(searchCatalog('', 'Arms').every((x) => ['biceps', 'triceps', 'forearms'].includes(x.cat))).toBe(true);
    expect(searchCatalog('').length).toBeGreaterThan(250);
    expect(searchCatalog('Single-Arm Cable Curl')[0].unilateral).toBe(true);
  });
});

describe('backup files', () => {
  it('defuse tags from a backup but keep names like "Arms <3" and quotes, and drop a rest picture that is not an image', async () => {
    const { parseBackup } = await import('../../js/domain/backup.js');
    const out = parseBackup(JSON.stringify({ gymLogs: '{}', gymCustomWorkouts: { 'Arms <3': [{ name: '<b>x</b>', note: 'seat "4"' }] }, gymRestImage: 'rest.png" onerror="x' }));
    expect(JSON.parse(out.gymCustomWorkouts)).toEqual({ 'Arms <3': [{ name: '‹b>x‹/b>', note: 'seat "4"' }] });
    expect(out.gymRestImage).toBeUndefined();
  });
});
