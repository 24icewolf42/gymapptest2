import { describe, it, expect } from 'vitest';
import {
  sanitizeLogs, mergeLogs, totals, liftPoints, bestWeight, exerciseNames, leaderboardStats,
  streak, bestStreak, trimSets, upgradeLastUsed, mergeProgress, sessionKey, canonicalLogDate,
  dailySummaries, mergeBypass, normalizeBypass, activeBypass,
} from '../../js/domain/logs.js';

const session = (day, time, w = '50', r = '8') => ({ day, time, duration: 3600, exercises: [{ name: 'Bench', target: '8', sets: [{ w, r, done: true }] }] });

describe('sanitizeLogs', () => {
  it('drops malformed sessions and sets', () => {
    const out = sanitizeLogs({ '2026-01-01': 'x', '2026-01-02': [null, { day: 'Push', exercises: [{ name: 'Bench', sets: [null, { w: 5 }] }] }] });
    expect(Object.keys(out)).toEqual(['2026-01-02']);
    expect(out['2026-01-02'][0].exercises[0].sets).toEqual([{ w: '5', r: '', done: false }]);
  });

  it('repairs dates written in other formats, like the original app does', () => {
    const s = session('Push', '2026-10-05T18:00:00Z');
    const out = sanitizeLogs({ '05.10.2026': [s], '1760000000': [session('Pull', 'x')], nonsense: [{ ...s, day: 'Legs', time: '2026-10-07T10:00:00Z' }], never: [{ day: 'X', exercises: [] }] });
    expect(Object.keys(out).sort()).toEqual(['2025-10-09', '2026-10-05', '2026-10-07'].sort());
    expect(canonicalLogDate('10/23/2026')).toBe('2026-10-23');
    expect(canonicalLogDate('31.02.2026')).toBeNull();
  });

  it('keeps session ids and accepts the array form', () => {
    const out = sanitizeLogs([{ id: 'a1', day: 'Push', time: '2026-03-01T10:00:00Z', exercises: [] }]);
    expect(out['2026-03-01'][0].id).toBe('a1');
  });
});

describe('mergeLogs', () => {
  it('keeps the most recently saved copy of the same session', () => {
    const remote = { '2026-10-01': [{ ...session('Push', '2026-10-01T18:00:00Z', '60'), id: 's1' }] };
    const local = { '2026-10-01': [{ ...session('Push', '2026-10-01T17:00:00Z', '50'), id: 's1' }] };
    const m = mergeLogs(remote, local);
    expect(m['2026-10-01']).toHaveLength(1);
    expect(m['2026-10-01'][0].exercises[0].sets[0].w).toBe('60');
  });

  it('keeps two different sessions of the same workout on one day', () => {
    const m = mergeLogs({ '2026-10-01': [{ ...session('Push', '2026-10-01T08:00:00Z'), id: 'a' }] }, { '2026-10-01': [{ ...session('Push', '2026-10-01T18:00:00Z'), id: 'b' }] });
    expect(m['2026-10-01'].map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('drops deleted sessions from either side', () => {
    const s = session('Push', '2026-10-01T18:00:00Z');
    const key = sessionKey('2026-10-01', s);
    expect(key).toBe('2026-10-01|Push|2026-10-01T18:00:00Z');
    expect(mergeLogs({ '2026-10-01': [s] }, {}, { deleted: [key] })).toEqual({});
  });

  it('drops sessions saved before a date was cleared, but keeps later ones', () => {
    const before = session('Push', '2026-10-01T08:00:00Z'), after = session('Pull', '2026-10-01T20:00:00Z');
    const m = mergeLogs({ '2026-10-01': [before, after] }, {}, { deletedDates: { '2026-10-01': Date.parse('2026-10-01T12:00:00Z') } });
    expect(m['2026-10-01'].map((x) => x.day)).toEqual(['Pull']);
  });
});

describe('daily summaries and bypass', () => {
  it('sums sessions per day', () => {
    expect(dailySummaries({ '2026-10-01': [session('A', 'a', '10', '5'), session('B', 'b', '20', '1')] }))
      .toEqual({ '2026-10-01': { workouts: 2, total_seconds: 7200, volume_kg_reps: 70 } });
  });

  it('merges bypass days by their latest change and reads the old plain format', () => {
    const local = normalizeBypass({}, { '2026-10-01': true });
    expect(local).toEqual({ '2026-10-01': { value: true, updatedAt: 0 } });
    const merged = mergeBypass({ '2026-10-01': { value: false, updatedAt: 5 }, '2026-10-02': { value: true, updatedAt: 1 } }, local);
    expect(activeBypass(merged)).toEqual({ '2026-10-02': true });
  });
});

describe('stats', () => {
  const logs = {
    '2026-09-30': [session('Push', 'a', '50', '10')],
    '2026-10-01': [{ ...session('Push', 'b', '60', '5'), duration: 1800 }],
    '2026-10-03': [{ day: 'Cardio', time: 'c', exercises: [{ name: 'Run', sets: [{ w: '', r: '' }] }] }],
  };

  it('totals workouts, this month and time', () => {
    expect(totals(logs, '2026-10')).toEqual({ workouts: 3, month: 2, seconds: 5400 });
  });

  it('tracks best weight per session', () => {
    expect(liftPoints(logs, 'Bench')).toEqual([{ date: '2026-09-30', w: 50, r: 10 }, { date: '2026-10-01', w: 60, r: 5 }]);
    expect(bestWeight(logs, 'Bench')).toBe(60);
    expect(exerciseNames(logs)).toEqual(['Bench']);
  });

  it('computes leaderboard aggregates', () => {
    expect(leaderboardStats(logs)).toEqual({ workouts_count: 3, volume_kg_reps: 800, total_seconds: 5400 });
  });
});

describe('streak', () => {
  const schedule = { 0: 'Push', 1: null, 2: 'Pull', 3: null, 4: 'Legs', 5: null, 6: null };
  it('counts scheduled days logged or bypassed, skipping rest days and an unfinished today', () => {
    // Friday 2026-10-23 is today (scheduled, not yet logged).
    const today = new Date(2026, 9, 23);
    const logs = { '2026-10-21': [session('Pull', 'a')], '2026-10-19': [session('Push', 'b')] };
    expect(streak(logs, { '2026-10-16': true }, schedule, today)).toBe(3);
    expect(streak(logs, {}, schedule, today)).toBe(2);
    expect(bestStreak(logs, { '2026-10-16': true }, schedule, today)).toBe(3);
  });
});

describe('last-used values', () => {
  it('trims trailing empty rows', () => {
    expect(trimSets([{ w: '5', r: '' }, { w: '', r: '' }])).toEqual([{ w: '5', r: '' }]);
  });

  it('upgrades "Workout||Exercise" keys and prefers values from logs', () => {
    const { lastUsed, changed } = upgradeLastUsed({ 'Push||Bench': { sets: [{ w: '1', r: '1' }] } }, { '2026-01-01': [session('Push', 'a', '70')] }, null);
    expect(changed).toBe(true);
    expect(lastUsed.Bench.sets[0].w).toBe('70');
    expect(upgradeLastUsed({ Bench: { sets: [] } }, {}, null).changed).toBe(false);
  });

  it('merges progress by the latest change', () => {
    const merged = mergeProgress(
      { A: { sets: [{ w: '1', r: '1' }], updatedAt: 10 }, B: { sets: [], updatedAt: 1 }, 'X||Y': {} },
      { A: { sets: [{ w: '2', r: '2' }], updatedAt: 5 }, B: { sets: [{ w: '3', r: '3' }], updatedAt: 2 } },
    );
    expect(merged).toEqual({ A: { sets: [{ w: '1', r: '1' }], updatedAt: 10 }, B: { sets: [{ w: '3', r: '3' }], updatedAt: 2 } });
  });
});

describe('sessions the original app keys by their JSON', () => {
  it('get a short id without quotes that still matches the original app\'s tombstone', () => {
    const raw = { day: 'Push', exercises: [{ name: 'Dips', target: '8', sets: [] }] };
    const logs = sanitizeLogs({ '2026-01-05': [raw] });
    const id = logs['2026-01-05'][0].id;
    expect(id).toMatch(/^l[0-9a-z]+$/);
    const upstreamKey = '2026-01-05|Push|' + JSON.stringify(raw);
    expect(mergeLogs({}, { '2026-01-05': [raw] }, { deleted: [upstreamKey] })).toEqual({});
  });

  it('drops a time that is not a timestamp', () => {
    const logs = sanitizeLogs({ '2026-01-05': [{ id: 'a', day: 'Push', time: '2026-01-05T10:00:00Z"', exercises: [] }] });
    expect(logs['2026-01-05'][0].time).toBe('');
  });
});
