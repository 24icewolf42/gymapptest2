// Gym dates API: list, create, reply, check in, cancel, and live updates.
import { supabase, errorText, isMissingSchema } from './client.js';
import { account } from './sync.js';

const fail = (error) => ({ data: null, error: errorText(error), missing: isMissingSchema(error) });

/**
 * Dates I can see that have not ended more than a few hours ago, with replies,
 * counts and (for my own invite-only dates) the invite list.
 */
export async function loadDates() {
  const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  // Open dates only (cancelled ones are never shown), soonest first; the
  // user's own are fetched separately so they are always there to manage.
  const query = () => supabase.from('gym_dates')
    .select('id,host_id,starts_at,duration_min,gym,workout,note,invite_only,cancelled_at,created_at,host:profiles!gym_dates_host_id_fkey(username)')
    .is('cancelled_at', null)
    .gte('starts_at', new Date(Date.now() - 6 * 3600 * 1000 - 360 * 60000).toISOString())
    .order('starts_at', { ascending: true });
  const [r, own] = await Promise.all([query().limit(200), query().eq('host_id', account.user.id).limit(50)]);
  if (r.error) return fail(r.error);
  if (own.error) return fail(own.error);
  const byId = new Map([...(r.data || []), ...(own.data || [])].map((d) => [d.id, d]));
  // Dates the user said they'd go to are always there too, however many come before them.
  const replies = await supabase.from('gym_date_rsvps').select('date_id').eq('user_id', account.user.id).in('status', ['going', 'maybe']).limit(100);
  if (replies.error) return fail(replies.error);
  const missing = [...new Set((replies.data || []).map((x) => x.date_id))].filter((id) => !byId.has(id));
  for (let i = 0; i < missing.length; i += 60) {
    const more = await query().in('id', missing.slice(i, i + 60));
    if (more.error) return fail(more.error);
    (more.data || []).forEach((d) => byId.set(d.id, d));
  }
  const dates = [...byId.values()]
    .filter((d) => new Date(new Date(d.starts_at).getTime() + d.duration_min * 60000).toISOString() >= since)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const ids = dates.map((d) => d.id);
  if (!ids.length) return { data: { dates: [], rsvps: [], counts: {}, invites: [] }, error: '' };
  // Ids go into the request URL: ask in chunks, or a long list is refused (HTTP 414).
  const chunks = [];
  for (let i = 0; i < ids.length; i += 60) chunks.push(ids.slice(i, i + 60));
  const inChunks = async (make) => {
    const parts = await Promise.all(chunks.map(make));
    const bad = parts.find((p) => p.error);
    return bad || { data: parts.flatMap((p) => p.data || []), error: null };
  };
  const [rsvps, counts, invites] = await Promise.all([
    inChunks((c) => supabase.from('gym_date_rsvps').select('date_id,user_id,status,checked_in_at,user:profiles!gym_date_rsvps_user_id_fkey(username)').in('date_id', c)),
    supabase.rpc('gym_date_counts', { ids }),
    inChunks((c) => supabase.from('gym_date_invites').select('date_id,user_id').in('date_id', c)),
  ]);
  const err = rsvps.error || counts.error || invites.error;
  if (err) return fail(err);
  const countMap = {};
  (counts.data || []).forEach((c) => { countMap[c.date_id] = c; });
  return { data: { dates, rsvps: rsvps.data || [], counts: countMap, invites: invites.data || [] }, error: '' };
}

export async function createDate({ startsAt, duration, gym, workout, note, inviteIds }) {
  const invite = Array.isArray(inviteIds) && inviteIds.length > 0;
  const r = await supabase.from('gym_dates').insert({
    host_id: account.user.id,
    starts_at: startsAt.toISOString(),
    duration_min: duration,
    gym: gym.trim(),
    workout: workout || null,
    note: note ? note.trim() : null,
    invite_only: invite,
  }).select('id').single();
  if (r.error) return fail(r.error);
  if (invite) {
    const inv = await supabase.from('gym_date_invites').insert(inviteIds.map((user_id) => ({ date_id: r.data.id, user_id })));
    if (inv.error) {
      // Don't leave an invite-only date nobody can see (dates are cancelled, never deleted).
      await supabase.from('gym_dates').update({ cancelled_at: new Date().toISOString() }).eq('id', r.data.id);
      return fail(inv.error);
    }
  }
  return { data: r.data, error: '' };
}

export async function reply(dateId, status) {
  const r = await supabase.from('gym_date_rsvps').upsert({ date_id: dateId, user_id: account.user.id, status }, { onConflict: 'date_id,user_id' });
  return r.error ? fail(r.error) : { data: true, error: '' };
}

export async function checkIn(dateId) {
  const r = await supabase.from('gym_date_rsvps').upsert({ date_id: dateId, user_id: account.user.id, status: 'going', checked_in_at: new Date().toISOString() }, { onConflict: 'date_id,user_id' });
  return r.error ? fail(r.error) : { data: true, error: '' };
}

export async function cancelDate(dateId) {
  const r = await supabase.from('gym_dates').update({ cancelled_at: new Date().toISOString() }).eq('id', dateId).eq('host_id', account.user.id);
  return r.error ? fail(r.error) : { data: true, error: '' };
}

let channel = null;
/**
 * Calls onChange(payload) when a visible gym date changes. Replies and invites
 * touch their date (activity_at), so they arrive here too. onReconnect runs when
 * the connection comes back, to catch up on anything missed.
 */
export function subscribe(onChange, onReconnect) {
  unsubscribe();
  let dropped = false;
  channel = supabase.channel('gym-dates')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'gym_dates' }, onChange)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED' && dropped) { dropped = false; onReconnect?.(); }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') dropped = true;
    });
}

export function unsubscribe() {
  if (channel) { supabase.removeChannel(channel); channel = null; }
}
