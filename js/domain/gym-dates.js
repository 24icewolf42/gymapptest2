// Gym dates: planned gym visits that friends can join. Pure helpers shared by
// the UI; the database enforces the same limits.

export const DURATIONS = [45, 60, 90, 120];
export const CHECK_IN_EARLY_MIN = 30;
export const MAX_DAYS_AHEAD = 60;
export const QUICK_STARTS = [
  { id: 'now', label: 'Now', minutes: 0 },
  { id: '30', label: 'In 30 min', minutes: 30 },
  { id: '60', label: 'In 1 h', minutes: 60 },
];

export function startOf(d) { return new Date(d.starts_at); }
export function endOf(d) { return new Date(startOf(d).getTime() + d.duration_min * 60000); }

/** 'cancelled' | 'ended' | 'live' | 'upcoming' */
export function phase(d, now = new Date()) {
  if (d.cancelled_at) return 'cancelled';
  if (endOf(d) <= now) return 'ended';
  if (startOf(d) <= now) return 'live';
  return 'upcoming';
}

export function canCheckIn(d, now = new Date()) {
  return !d.cancelled_at && now >= new Date(startOf(d).getTime() - CHECK_IN_EARLY_MIN * 60000) && now < endOf(d);
}

/** Start time for a quick option, rounded up to the next 5 minutes (except "now"). */
export function quickStartTime(minutes, now = new Date()) {
  if (!minutes) return new Date(now.getTime());
  const t = new Date(now.getTime() + minutes * 60000);
  t.setSeconds(0, 0);
  t.setMinutes(Math.ceil(t.getMinutes() / 5) * 5);
  return t;
}

/** Returns an error message, or '' when the draft is valid. */
export function validateDraft({ gym, startsAt, duration, note }, now = new Date()) {
  const place = String(gym || '').trim();
  if (!place) return 'Add the gym you are going to.';
  if (place.length > 60) return 'Keep the gym name under 60 characters.';
  if (!(startsAt instanceof Date) || Number.isNaN(startsAt.getTime())) return 'Pick a start time.';
  if (startsAt < new Date(now.getTime() - 10 * 60000)) return 'That time has already passed.';
  if (startsAt > new Date(now.getTime() + MAX_DAYS_AHEAD * 86400000)) return 'Plan at most 60 days ahead.';
  if (!(duration >= 15 && duration <= 360)) return 'Pick a duration.';
  if (note && note.length > 200) return 'Keep the note under 200 characters.';
  return '';
}

/** Groups visible dates for the list: live, today, tomorrow, later. Ended and cancelled are dropped. */
export function groupDates(dates, now = new Date()) {
  const groups = { live: [], today: [], tomorrow: [], later: [] };
  // Calendar days, so a 23- or 25-hour daylight-saving day is handled.
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const after = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
  [...dates].sort((a, b) => startOf(a) - startOf(b)).forEach((d) => {
    const p = phase(d, now);
    if (p === 'live') groups.live.push(d);
    else if (p === 'upcoming') {
      const s = startOf(d);
      if (s < tomorrow) groups.today.push(d);
      else if (s < after) groups.tomorrow.push(d);
      else groups.later.push(d);
    }
  });
  return groups;
}

/** Dates from friends that still need my answer. */
export function unanswered(dates, rsvps, myId, now = new Date()) {
  return dates.filter((d) => d.host_id !== myId && ['live', 'upcoming'].includes(phase(d, now)) &&
    !rsvps.some((r) => r.date_id === d.id && r.user_id === myId));
}

/** Remembers recently used gyms, most recent first, max 5. */
export function rememberGym(list, gym) {
  const name = String(gym || '').trim();
  if (!name) return list;
  return [name, ...list.filter((g) => g.toLowerCase() !== name.toLowerCase())].slice(0, 5);
}
