import { describe, it, expect } from 'vitest';
import {
  sanitizeExercise, sanitizeWorkout, sanitizeWorkouts, sanitizeSchedule, upgradeExercises,
  removeStockPresets, mergePlans, workoutSummary, displaySets, fingerprint, emptySchedule, planHashes, stableStringify, deepPlain,
} from '../../js/domain/plan.js';

describe('sanitizeExercise', () => {
  it('clamps and defaults fields from untrusted data', () => {
    expect(sanitizeExercise({ name: '  Bench ', sets: 100000000, rest: 'x' })).toEqual({ name: 'Bench', cat: 'other', sets: 40, target: '8–12', rest: 90, note: '' });
    expect(sanitizeExercise(null)).toBeNull();
    expect(sanitizeExercise({ name: 42 })).toBeNull();
    expect(sanitizeExercise({ name: 'Leg Press' }).rest).toBe(180);
  });

  it('keeps unilateral set rows even', () => {
    expect(sanitizeExercise({ name: 'Curl', sets: 3, unilateral: true })).toMatchObject({ sets: 4, unilateral: true, sides: 'both' });
    expect(sanitizeExercise({ name: 'Curl', sets: 4, sides: 'both' }).unilateral).toBe(true);
  });

  it('keeps names as typed (escaping happens when shown); deepPlain cleans what comes from others', () => {
    expect(sanitizeExercise({ name: 'Arms <3', note: 'RPE <8' })).toMatchObject({ name: 'Arms <3', note: 'RPE <8' });
    expect(deepPlain({ 'Arms <3': [{ name: '<img src=x onerror="alert(1)">', note: 'grip `wide`' }] })).toEqual({ 'Arms ‹3': [{ name: '‹img src=x onerror=”alert(1)”›', note: 'grip ’wide’' }] });
    expect(sanitizeExercise({ name: "Farmer's walk" }).name).toBe("Farmer's walk");
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
    expect(w.Arms[0]).toMatchObject({ unilateral: true, sides: 'both', sets: 6 });
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

describe('mergePlans (three-way, per routine and day)', () => {
  const ex = (name) => [{ name, cat: 'chest', sets: 3, target: '8', rest: 90, note: '' }];
  const full = { 0: 'Push', 1: null, 2: 'Pull', 3: null, 4: 'Push', 5: null, 6: null };
  const cloud = { workouts: { Push: ex('Bench'), Pull: ex('Row') }, schedule: full };

  it('does not let a fresh phone wipe the weekly schedule', () => {
    const fresh = { workouts: {}, schedule: emptySchedule(), itemUpdatedAt: {} };
    const m = mergePlans(cloud, fresh, null);
    expect(m.schedule).toEqual(full);
    expect(Object.keys(m.workouts)).toEqual(['Push', 'Pull']);
  });

  it('keeps edits to different routines made on two devices', () => {
    const base = planHashes(cloud);
    const remote = { ...cloud, workouts: { ...cloud.workouts, Pull: ex('Chin-up') } };
    const local = { ...cloud, workouts: { ...cloud.workouts, Push: ex('Dips') }, itemUpdatedAt: { workouts: { Push: 5 } } };
    const m = mergePlans(remote, local, base);
    expect(m.workouts.Push[0].name).toBe('Dips');
    expect(m.workouts.Pull[0].name).toBe('Chin-up');
  });

  it('takes a change from the old app version (no timestamps) when this phone did not touch that routine', () => {
    const base = planHashes(cloud);
    const remote = { ...cloud, workouts: { ...cloud.workouts, Push: ex('Incline') } };
    expect(mergePlans(remote, { ...cloud, itemUpdatedAt: {} }, base).workouts.Push[0].name).toBe('Incline');
  });

  it('resolves a conflict on the same routine by the newer edit', () => {
    const base = planHashes(cloud);
    const remote = { ...cloud, workouts: { ...cloud.workouts, Push: ex('Remote') }, itemUpdatedAt: { workouts: { Push: 20 } } };
    const local = { ...cloud, workouts: { ...cloud.workouts, Push: ex('Local') }, itemUpdatedAt: { workouts: { Push: 10 } } };
    expect(mergePlans(remote, local, base).workouts.Push[0].name).toBe('Remote');
    local.itemUpdatedAt.workouts.Push = 30;
    expect(mergePlans(remote, local, base).workouts.Push[0].name).toBe('Local');
  });

  it('keeps a deletion even when the other device still has the routine', () => {
    const base = planHashes(cloud);
    const local = { workouts: { Pull: ex('Row') }, schedule: { ...full, 0: null, 4: null }, deletedWorkouts: ['Push'], itemUpdatedAt: { workouts: { Push: 9 } } };
    const m = mergePlans(cloud, local, base);
    expect(m.workouts.Push).toBeUndefined();
    expect(m.deletedWorkouts).toContain('Push');
    expect(m.schedule[0]).toBeNull();
  });

  it('deletes again after delete -> re-create -> delete (previously resurrected)', () => {
    const recreated = { ...cloud, restoredWorkouts: ['Push'] };
    const base = planHashes(recreated);
    const local = { workouts: { Pull: ex('Row') }, schedule: full, deletedWorkouts: ['Push'], restoredWorkouts: [], itemUpdatedAt: { workouts: { Push: 50 } } };
    const m = mergePlans(recreated, local, base);
    expect(m.workouts.Push).toBeUndefined();
    expect(m.restoredWorkouts).not.toContain('Push');
  });

  it('keeps routines made offline before the first sign-in', () => {
    const local = { workouts: { Legs: ex('Squat') }, schedule: { ...emptySchedule(), 1: 'Legs' } };
    const m = mergePlans({ workouts: {}, schedule: {} }, local, null);
    expect(Object.keys(m.workouts)).toEqual(['Legs']);
    expect(m.schedule[1]).toBe('Legs');
  });

  it('respects an explicit deletion from the cloud over an untouched local copy', () => {
    const remote = { workouts: {}, schedule: {}, deletedWorkouts: ['Old'] };
    expect(mergePlans(remote, { workouts: { Old: ex('x') }, schedule: {} }, null).workouts.Old).toBeUndefined();
  });

  it('keeps this phone\'s routine order and syncs the rest-day picture', () => {
    const reordered = { workouts: { Pull: ex('Row'), Push: ex('Bench') }, schedule: full, restImage: 'data:image/jpeg;base64,AAA' };
    const local = { workouts: { Push: ex('Bench'), Pull: ex('Row') }, schedule: full };
    const m = mergePlans(reordered, local, planHashes(local));
    expect(Object.keys(m.workouts)).toEqual(['Push', 'Pull']);
    expect(m.restImage).toBe('data:image/jpeg;base64,AAA');
  });

  it('sanitizes routines coming from the cloud', () => {
    const m = mergePlans({ workouts: { Bad: [null, { name: 'ok', sets: 1e9 }] } }, {}, null);
    expect(m.workouts.Bad).toEqual([{ name: 'ok', cat: 'other', sets: 40, target: '8–12', rest: 90, note: '' }]);
  });

  it('compares JSON regardless of key order', () => {
    expect(stableStringify({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(stableStringify({ a: [{ c: 3, d: 2 }], b: 1 }));
  });
});

describe('summaries', () => {
  it('counts unilateral sets per side', () => {
    expect(displaySets({ sets: 4, unilateral: true })).toBe(2);
    expect(workoutSummary([{ sets: 3 }, { sets: 4, unilateral: true }])).toBe('2 exercises · 5 sets');
    expect(workoutSummary([])).toBe('0 exercises · 0 sets');
  });
});

describe('routine names', () => {
  it('are kept exactly as stored (the original app does not trim or shorten them)', () => {
    const long = 'A very long routine name that goes past forty characters';
    expect(Object.keys(sanitizeWorkouts({ 'Legs ': [{ name: 'Squat' }], [long]: [{ name: 'Dips' }], 'A|B': [{ name: 'Row' }] }))).toEqual(['Legs ', long, 'A|B']);
    expect(Object.keys(sanitizeWorkouts({ '   ': [{ name: 'x' }], __proto__: [] }))).toEqual([]);
  });
});
