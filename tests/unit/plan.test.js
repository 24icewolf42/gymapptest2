import { describe, it, expect } from 'vitest';
import {
  sanitizeExercise, sanitizeWorkout, sanitizeWorkouts, sanitizeSchedule, upgradeExercises,
  removeStockPresets, mergePlans, workoutSummary, displaySets, fingerprint, emptySchedule,
} from '../../js/domain/plan.js';

describe('sanitizeExercise', () => {
  it('clamps and defaults fields from untrusted data', () => {
    expect(sanitizeExercise({ name: '  Bench ', sets: 100000000, rest: 'x' })).toEqual({ name: 'Bench', cat: 'other', sets: 40, target: '8–12', rest: 90, note: '' });
    expect(sanitizeExercise(null)).toBeNull();
    expect(sanitizeExercise({ name: 42 })).toBeNull();
    expect(sanitizeExercise({ name: 'Leg Press' }).rest).toBe(180);
  });

  it('keeps unilateral set rows even', () => {
    expect(sanitizeExercise({ name: 'Curl', sets: 3, unilateral: true }).sets).toBe(4);
  });

  it('keeps markup as plain text (escaping happens at render time)', () => {
    expect(sanitizeExercise({ name: '<img src=x onerror=alert(1)>' }).name).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('sanitizeWorkout(s)', () => {
  it('drops garbage entries and duplicate names', () => {
    expect(sanitizeWorkout([null, { name: 'A' }, { name: 'A' }, 'x', { name: 'B' }]).map((e) => e.name)).toEqual(['A', 'B']);
    expect(sanitizeWorkout('nope')).toEqual([]);
  });

  it('ignores prototype keys', () => {
    const out = sanitizeWorkouts(JSON.parse('{"__proto__":[{"name":"x"}],"Push":[]}'));
    expect(Object.keys(out)).toEqual(['Push']);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });
});

describe('schedule', () => {
  it('clears days pointing at missing routines', () => {
    expect(sanitizeSchedule({ 0: 'Push', 1: 'Gone', 3: 7 }, { Push: [] })).toEqual({ ...emptySchedule(), 0: 'Push' });
  });
});

describe('upgradeExercises', () => {
  it('marks the original single-arm moves once and does not touch user edits again', () => {
    const w = { Arms: [{ name: 'Single-Arm Tricep Pushdowns', sets: 6 }] };
    expect(upgradeExercises(w)).toBe(true);
    expect(w.Arms[0]).toMatchObject({ unilateral: true, sets: 6 });
    w.Arms[0].sets = 8;
    expect(upgradeExercises(w)).toBe(false);
    expect(w.Arms[0].sets).toBe(8);
  });
});

describe('removeStockPresets', () => {
  it('removes only untouched presets', () => {
    const w = { Push: [{ name: 'X' }] };
    const hash = fingerprint(w.Push);
    expect(removeStockPresets(w)).toEqual(hash === '5422adf1' ? ['Push'] : []);
    expect(Object.keys(w)).toEqual(hash === '5422adf1' ? [] : ['Push']);
  });
});

describe('mergePlans', () => {
  const ex = (name) => [{ name, cat: 'chest', sets: 3, target: '8', rest: 90, note: '' }];

  it('lets the newer side win for shared routines and keeps one-sided ones', () => {
    const remote = { workouts: { Push: ex('Remote bench'), Pull: ex('Row') }, schedule: { 0: 'Push' }, updatedAt: '2026-10-02T00:00:00Z' };
    const local = { workouts: { Push: ex('Local bench'), Legs: ex('Squat') }, schedule: { 1: 'Legs' }, updatedAt: '2026-10-01T00:00:00Z' };
    const m = mergePlans(remote, local);
    expect(m.workouts.Push[0].name).toBe('Remote bench');
    expect(Object.keys(m.workouts).sort()).toEqual(['Legs', 'Pull', 'Push']);
    expect(m.schedule[0]).toBe('Push');
    expect(m.schedule[1]).toBe('Legs');
  });

  it('treats plans from older app versions (no timestamp) as older than this phone', () => {
    const m = mergePlans({ workouts: { Push: ex('Remote') } }, { workouts: { Push: ex('Local') }, updatedAt: '2026-10-01T00:00:00Z' });
    expect(m.workouts.Push[0].name).toBe('Local');
  });

  it('keeps a deletion even when the other device still has the routine', () => {
    const m = mergePlans(
      { workouts: { Push: ex('a'), Pull: ex('b') }, updatedAt: '2026-10-05T00:00:00Z' },
      { workouts: { Pull: ex('b') }, deletedWorkouts: ['Push'], updatedAt: '2026-10-01T00:00:00Z' },
    );
    expect(m.workouts.Push).toBeUndefined();
    expect(m.deletedWorkouts).toContain('Push');
  });

  it('deletes again after delete -> re-create -> delete (previously resurrected)', () => {
    const remote = { workouts: { Push: ex('a') }, restoredWorkouts: ['Push'], updatedAt: '2026-10-01T00:00:00Z' };
    const local = { workouts: {}, deletedWorkouts: ['Push'], restoredWorkouts: [], updatedAt: '2026-10-02T00:00:00Z' };
    const m = mergePlans(remote, local);
    expect(m.workouts.Push).toBeUndefined();
    expect(m.restoredWorkouts).not.toContain('Push');
  });

  it('keeps a routine re-created on the newer side', () => {
    const remote = { workouts: {}, deletedWorkouts: ['Push'], updatedAt: '2026-10-01T00:00:00Z' };
    const local = { workouts: { Push: ex('new') }, restoredWorkouts: ['Push'], updatedAt: '2026-10-02T00:00:00Z' };
    expect(mergePlans(remote, local).workouts.Push[0].name).toBe('new');
  });

  it('sanitizes routines coming from the cloud', () => {
    const m = mergePlans({ workouts: { Bad: [null, { name: 'ok', sets: 1e9 }] } }, {});
    expect(m.workouts.Bad).toEqual([{ name: 'ok', cat: 'other', sets: 40, target: '8–12', rest: 90, note: '' }]);
  });
});

describe('summaries', () => {
  it('counts unilateral sets per side', () => {
    expect(displaySets({ sets: 4, unilateral: true })).toBe(2);
    expect(workoutSummary([{ sets: 3 }, { sets: 4, unilateral: true }])).toBe('2 exercises · 5 sets');
    expect(workoutSummary([])).toBe('0 exercises · 0 sets');
  });
});
