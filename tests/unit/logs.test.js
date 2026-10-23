import { describe, it, expect } from 'vitest';
import {
  sanitizeLogs, mergeLogs, totals, liftPoints, bestWeight, exerciseNames, leaderboardStats,
  streak, trimSets, upgradeLastUsed, mergeProgress, sessionKey,
} from '../../js/domain/logs.js';

const session = (day, time, w = '50', r = '8') => ({ day, time, duration: 3600, exercises: [{ name: 'Bench', target: '8', sets: [{ w, r, done: true }] }] });

describe('sanitizeLogs', () => {
  it('drops malformed dates, sessions and sets', () => {
    const out = sanitizeLogs({ 'not-a-date': [session('A', 't')], '2026-01-01': 'x', '2026-01-02': [null, { day: 'Push', exercises: [{ name: 'Bench', sets: [null, { w: 5 }] }] }] });
    expect(Object.keys(out)).toEqual(['2026-01-02']);
    expect(out['2026-01-02'][0].exercises[0].sets).toEqual([{ w: '5', r: '', done: false }]);
  });
});

describe('mergeLogs', () => {
  it('keeps the most recently saved copy of the same workout on the same day', () => {
    const remote = { '2026-10-01': [session('Push', '2026-10-01T18:00:00Z', '60')] };
    const local = { '2026-10-01': [session('Push', '2026-10-01T17:00:00Z', '50')] };
    expect(mergeLogs(remote, local)['2026-10-01'][0].exercises[0].sets[0].w).toBe('60');
  });

  it('unions different workouts and days', () => {
    const m = mergeLogs({ '2026-10-01': [session('Push', 'a')] }, { '2026-10-01': [session('Abs', 'b')], '2026-10-02': [session('Pull', 'c')] });
    expect(m['2026-10-01'].map((s) => s.day).sort()).toEqual(['Abs', 'Push']);
    expect(m['2026-10-02']).toHaveLength(1);
  });

  it('does not bring back a session deleted here but not yet uploaded', () => {
    const remote = { '2026-10-01': [session('Push', 'a')] };
    const m = mergeLogs(remote, {}, { pendingDeletes: { [sessionKey('2026-10-01', 'Push')]: 'now' } });
    expect(m).toEqual({});
  });

  it('drops a session another device deleted, but keeps sessions recorded offline', () => {
    const local = { '2026-10-01': [session('Push', 'a')], '2026-10-02': [session('Pull', 'b')] };
    const m = mergeLogs({}, local, { syncedKeys: [sessionKey('2026-10-01', 'Push')] });
    expect(Object.keys(m)).toEqual(['2026-10-02']);
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
    expect(leaderboardStats(logs)).toEqual({ workouts_count: 3, volume_kg_reps: 800 });
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

  it('merges progress with this phone winning', () => {
    expect(mergeProgress({ A: { sets: [{ w: '1', r: '1' }] }, B: { sets: [] }, 'X||Y': {} }, { A: { sets: [{ w: '2', r: '2' }] } }))
      .toEqual({ A: { sets: [{ w: '2', r: '2' }] }, B: { sets: [] } });
  });
});
