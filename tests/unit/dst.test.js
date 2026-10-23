// Daylight-saving days in Europe: 25 Oct 2026 has 25 hours.
process.env.TZ = 'Europe/Berlin';
const { describe, it, expect } = await import('vitest');
const { groupDates } = await import('../../js/domain/gym-dates.js');

describe('gym dates on a daylight-saving day', () => {
  it('files late dates under the right calendar day', () => {
    const now = new Date(2026, 9, 25, 12, 0);
    const date = (id, d, h, m) => ({ id, host_id: 'h', starts_at: new Date(2026, 9, d, h, m).toISOString(), duration_min: 60 });
    const g = groupDates([date(1, 25, 23, 30), date(2, 26, 23, 30), date(3, 27, 0, 30)], now);
    expect(g.today.map((x) => x.id)).toEqual([1]);
    expect(g.tomorrow.map((x) => x.id)).toEqual([2]);
    expect(g.later.map((x) => x.id)).toEqual([3]);
  });
});
