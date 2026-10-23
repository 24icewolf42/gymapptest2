import { describe, it, expect } from 'vitest';
import { phase, canCheckIn, quickStartTime, validateDraft, groupDates, unanswered, rememberGym } from '../../js/domain/gym-dates.js';

const now = new Date(2026, 9, 23, 12, 0);
const at = (h, m = 0, day = 23) => new Date(2026, 9, day, h, m).toISOString();
const date = (id, starts, extra = {}) => ({ id, host_id: 'h', starts_at: starts, duration_min: 90, ...extra });

describe('phase and check-in', () => {
  it('derives the phase from start, duration and cancellation', () => {
    expect(phase(date(1, at(13)), now)).toBe('upcoming');
    expect(phase(date(1, at(11)), now)).toBe('live');
    expect(phase(date(1, at(10)), now)).toBe('ended');
    expect(phase(date(1, at(13), { cancelled_at: at(9) }), now)).toBe('cancelled');
  });

  it('opens check-in 30 minutes early until the end', () => {
    expect(canCheckIn(date(1, at(12, 25)), now)).toBe(true);
    expect(canCheckIn(date(1, at(12, 35)), now)).toBe(false);
    expect(canCheckIn(date(1, at(10, 31)), now)).toBe(true);
    expect(canCheckIn(date(1, at(10, 30)), now)).toBe(false);
  });
});

describe('quickStartTime', () => {
  it('starts now, or rounds up to the next 5 minutes', () => {
    const n = new Date(2026, 9, 23, 12, 7, 31);
    expect(quickStartTime(0, n).getTime()).toBe(n.getTime());
    expect(quickStartTime(30, n)).toEqual(new Date(2026, 9, 23, 12, 40));
  });
});

describe('validateDraft', () => {
  const ok = { gym: 'McFit', startsAt: new Date(now.getTime() + 3600e3), duration: 90 };
  it('accepts a valid plan and explains invalid ones', () => {
    expect(validateDraft(ok, now)).toBe('');
    expect(validateDraft({ ...ok, gym: '  ' }, now)).toMatch(/gym/);
    expect(validateDraft({ ...ok, startsAt: new Date(now.getTime() - 3600e3) }, now)).toMatch(/passed/);
    expect(validateDraft({ ...ok, startsAt: new Date(now.getTime() + 61 * 86400e3) }, now)).toMatch(/60 days/);
    expect(validateDraft({ ...ok, startsAt: new Date('x') }, now)).toMatch(/start time/);
    expect(validateDraft({ ...ok, duration: 5 }, now)).toMatch(/duration/);
  });
});

describe('groupDates', () => {
  it('groups live, today, tomorrow and later, dropping ended and cancelled', () => {
    const list = [date('later', at(9, 0, 26)), date('live', at(11)), date('ended', at(8)), date('today', at(18)), date('tmr', at(7, 0, 24)), date('x', at(19), { cancelled_at: at(9) })];
    const g = groupDates(list, now);
    expect(g.live.map((d) => d.id)).toEqual(['live']);
    expect(g.today.map((d) => d.id)).toEqual(['today']);
    expect(g.tomorrow.map((d) => d.id)).toEqual(['tmr']);
    expect(g.later.map((d) => d.id)).toEqual(['later']);
  });
});

describe('unanswered', () => {
  it('lists open dates from friends without my reply', () => {
    const dates = [date('a', at(13)), date('b', at(14)), date('mine', at(15), { host_id: 'me' }), date('old', at(8))];
    expect(unanswered(dates, [{ date_id: 'b', user_id: 'me' }], 'me', now).map((d) => d.id)).toEqual(['a']);
  });
});

describe('rememberGym', () => {
  it('keeps the five most recent gyms without duplicates', () => {
    expect(rememberGym(['A', 'b', 'C'], 'B')).toEqual(['B', 'A', 'C']);
    expect(rememberGym(['1', '2', '3', '4', '5'], '6')).toEqual(['6', '1', '2', '3', '4']);
    expect(rememberGym(['A'], ' ')).toEqual(['A']);
  });
});
