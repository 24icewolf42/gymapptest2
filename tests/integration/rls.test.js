// Row-level security and database rules, exercised as real users against the
// local Supabase stack. Run with `npm run test:db` after `npx supabase start`.
import { describe, it, expect, beforeAll } from 'vitest';
import { makeUser, uniqueName, befriend, adminClient } from './helpers.js';

describe('profiles', () => {
  it('creates a profile with the requested username on sign-up', async () => {
    const name = uniqueName('alex');
    const u = await makeUser(name);
    expect(u.username).toBe(name);
  });

  it('gives a random username when the requested one is taken', async () => {
    const name = uniqueName('sam');
    await makeUser(name);
    const second = await makeUser(name);
    expect(second.username).toMatch(/^user_[0-9a-f]{8}$/);
  });

  it('does not let strangers list usernames, but allows an exact lookup', async () => {
    const a = await makeUser(uniqueName('a'));
    const b = await makeUser(uniqueName('b'));
    const list = await a.client.from('profiles').select('id,username');
    expect(list.error).toBeNull();
    expect(list.data.map((p) => p.id)).toEqual([a.id]);
    const found = await a.client.rpc('find_profile', { name: b.username.toUpperCase() });
    expect(found.data).toEqual([{ id: b.id, username: b.username }]);
    const missing = await a.client.rpc('find_profile', { name: 'nobody_here_x' });
    expect(missing.data).toEqual([]);
  });
});

describe('friend requests', () => {
  it('blocks the forged-friendship attack (recipient rewriting requester_id)', async () => {
    const attacker = await makeUser(uniqueName('att'));
    const alt = await makeUser(uniqueName('alt'));
    const victim = await makeUser(uniqueName('vic'));
    const req = await alt.client.from('friend_requests').insert({ requester_id: alt.id, target_id: attacker.id, status: 'pending' }).select('id').single();
    expect(req.error).toBeNull();
    const forged = await attacker.client.from('friend_requests').update({ requester_id: victim.id, status: 'accepted' }).eq('id', req.data.id);
    expect(forged.error).not.toBeNull();
    const row = await adminClient().from('friend_requests').select('requester_id,status').eq('id', req.data.id).single();
    expect(row.data).toEqual({ requester_id: alt.id, status: 'pending' });
  });

  it('only lets the recipient accept', async () => {
    const a = await makeUser(uniqueName('a'));
    const b = await makeUser(uniqueName('b'));
    const req = await a.client.from('friend_requests').insert({ requester_id: a.id, target_id: b.id, status: 'pending' }).select('id').single();
    const self = await a.client.from('friend_requests').update({ status: 'accepted' }).eq('id', req.data.id).select();
    expect(self.data).toEqual([]);
    const ok = await b.client.from('friend_requests').update({ status: 'accepted' }).eq('id', req.data.id).select('status');
    expect(ok.data).toEqual([{ status: 'accepted' }]);
  });

  it('allows one request per pair and lets either side remove it', async () => {
    const a = await makeUser(uniqueName('a'));
    const b = await makeUser(uniqueName('b'));
    const id = await befriend(a, b);
    const dup = await b.client.from('friend_requests').insert({ requester_id: b.id, target_id: a.id, status: 'pending' });
    expect(dup.error && dup.error.code).toBe('23505');
    const removed = await b.client.from('friend_requests').delete().eq('id', id).select('id');
    expect(removed.data).toEqual([{ id }]);
    const stranger = await makeUser(uniqueName('c'));
    const req = await stranger.client.from('friend_requests').insert({ requester_id: stranger.id, target_id: a.id, status: 'pending' }).select('id').single();
    const notMine = await b.client.from('friend_requests').delete().eq('id', req.data.id).select('id');
    expect(notMine.data).toEqual([]);
  });

  it('shows the profile of someone who sent you a request', async () => {
    const a = await makeUser(uniqueName('a'));
    const b = await makeUser(uniqueName('b'));
    await a.client.from('friend_requests').insert({ requester_id: a.id, target_id: b.id, status: 'pending' });
    const seen = await b.client.from('profiles').select('username').eq('id', a.id);
    expect(seen.data).toEqual([{ username: a.username }]);
  });
});

describe('friend data', () => {
  let a, b, stranger;
  beforeAll(async () => {
    a = await makeUser(uniqueName('a'));
    b = await makeUser(uniqueName('b'));
    stranger = await makeUser(uniqueName('s'));
    await befriend(a, b);
    await b.client.from('body_weight_logs').insert([{ user_id: b.id, log_date: '2026-01-01', weight_kg: 70 }, { user_id: b.id, log_date: '2026-02-01', weight_kg: 71.5 }]);
    await b.client.from('workout_plans').insert({ user_id: b.id, plan: { workouts: { Push: [{ name: 'Bench' }, { name: 'Dips' }], Pull: [{ name: 'Row' }] } } });
    await b.client.from('leaderboard_stats').insert({ user_id: b.id, workouts_count: 12, volume_kg_reps: 3400 });
  });

  it('keeps raw weigh-ins and plans private to the owner', async () => {
    expect((await a.client.from('body_weight_logs').select('*').eq('user_id', b.id)).data).toEqual([]);
    expect((await a.client.from('workout_plans').select('*').eq('user_id', b.id)).data).toEqual([]);
  });

  it('shows friends a summary, with weight only when shared', async () => {
    let rows = (await a.client.rpc('friend_summaries')).data;
    let friend = rows.find((r) => r.user_id === b.id);
    expect(friend).toMatchObject({ username: b.username, workouts_count: 12, routines: 2, exercises: 3, weight_kg: null });
    await b.client.from('profiles').update({ share_weight: true }).eq('id', b.id);
    rows = (await a.client.rpc('friend_summaries')).data;
    friend = rows.find((r) => r.user_id === b.id);
    expect(Number(friend.weight_kg)).toBe(71.5);
    expect(friend.weight_date).toBe('2026-02-01');
    const strangerRows = (await stranger.client.rpc('friend_summaries')).data;
    expect(strangerRows.map((r) => r.user_id)).toEqual([stranger.id]);
  });

  it('keeps workout history private', async () => {
    await b.client.from('workout_data').upsert({ user_id: b.id, logs: { '2026-01-01': [] }, progress: {} });
    expect((await a.client.from('workout_data').select('*').eq('user_id', b.id)).data).toEqual([]);
  });
});

describe('gym dates', () => {
  let host, friend, friend2, fof, stranger;
  const soon = () => new Date(Date.now() + 2 * 3600 * 1000).toISOString();

  beforeAll(async () => {
    host = await makeUser(uniqueName('host'));
    friend = await makeUser(uniqueName('fr'));
    friend2 = await makeUser(uniqueName('fr2'));
    fof = await makeUser(uniqueName('fof'));
    stranger = await makeUser(uniqueName('str'));
    await befriend(host, friend);
    await befriend(host, friend2);
    await befriend(host, fof);
    await befriend(friend, fof);
  });

  async function createDate(extra = {}) {
    const r = await host.client.from('gym_dates').insert({ host_id: host.id, starts_at: soon(), duration_min: 90, gym: '  McFit Mitte ', ...extra }).select('*').single();
    if (r.error) throw r.error;
    return r.data;
  }

  it('lets friends see a date and not strangers; the host is going automatically', async () => {
    const d = await createDate();
    expect(d.gym).toBe('McFit Mitte');
    expect((await friend.client.from('gym_dates').select('id').eq('id', d.id)).data).toEqual([{ id: d.id }]);
    expect((await stranger.client.from('gym_dates').select('id').eq('id', d.id)).data).toEqual([]);
    const hostReply = await friend.client.from('gym_date_rsvps').select('user_id,status').eq('date_id', d.id);
    expect(hostReply.data).toEqual([{ user_id: host.id, status: 'going' }]);
  });

  it('rejects dates in the past or too far ahead', async () => {
    const past = await host.client.from('gym_dates').insert({ host_id: host.id, starts_at: new Date(Date.now() - 3600e3).toISOString(), gym: 'X' });
    expect(past.error).not.toBeNull();
    const far = await host.client.from('gym_dates').insert({ host_id: host.id, starts_at: new Date(Date.now() + 90 * 86400e3).toISOString(), gym: 'X' });
    expect(far.error).not.toBeNull();
    const notMine = await friend.client.from('gym_dates').insert({ host_id: host.id, starts_at: soon(), gym: 'X' });
    expect(notMine.error).not.toBeNull();
  });

  it('limits invite-only dates to the invited friends', async () => {
    const d = await createDate({ invite_only: true });
    const inv = await host.client.from('gym_date_invites').insert({ date_id: d.id, user_id: friend.id });
    expect(inv.error).toBeNull();
    const notFriend = await host.client.from('gym_date_invites').insert({ date_id: d.id, user_id: stranger.id });
    expect(notFriend.error).not.toBeNull();
    expect((await friend.client.from('gym_dates').select('id').eq('id', d.id)).data).toHaveLength(1);
    expect((await friend2.client.from('gym_dates').select('id').eq('id', d.id)).data).toEqual([]);
    const sneaky = await friend2.client.from('gym_date_rsvps').insert({ date_id: d.id, user_id: friend2.id, status: 'going' });
    expect(sneaky.error).not.toBeNull();
  });

  it('lets friends reply, hides replies from friends-of-friends you do not know, and counts everyone', async () => {
    const d = await createDate();
    expect((await friend.client.from('gym_date_rsvps').insert({ date_id: d.id, user_id: friend.id, status: 'going' })).error).toBeNull();
    expect((await friend2.client.from('gym_date_rsvps').insert({ date_id: d.id, user_id: friend2.id, status: 'maybe' })).error).toBeNull();
    expect((await stranger.client.from('gym_date_rsvps').insert({ date_id: d.id, user_id: stranger.id, status: 'going' })).error).not.toBeNull();
    const forOther = await friend.client.from('gym_date_rsvps').insert({ date_id: d.id, user_id: friend2.id, status: 'no' });
    expect(forOther.error).not.toBeNull();
    // fof is friends with host and friend, not with friend2.
    const seen = (await fof.client.from('gym_date_rsvps').select('user_id').eq('date_id', d.id)).data.map((r) => r.user_id).sort();
    expect(seen).toEqual([host.id, friend.id].sort());
    const counts = (await fof.client.rpc('gym_date_counts', { ids: [d.id] })).data;
    expect(counts).toEqual([{ date_id: d.id, going: 2, maybe: 1, here: 0 }]);
    expect((await stranger.client.rpc('gym_date_counts', { ids: [d.id] })).data).toEqual([]);
  });

  it('allows check-in only around the start time and stamps server time', async () => {
    const later = await createDate();
    const early = await friend.client.from('gym_date_rsvps').upsert({ date_id: later.id, user_id: friend.id, status: 'going', checked_in_at: new Date().toISOString() });
    expect(early.error).not.toBeNull();
    const now = await createDate({ starts_at: new Date().toISOString() });
    const fake = '2000-01-01T00:00:00Z';
    const ok = await friend.client.from('gym_date_rsvps').upsert({ date_id: now.id, user_id: friend.id, status: 'maybe', checked_in_at: fake }).select('status,checked_in_at').single();
    expect(ok.error).toBeNull();
    expect(ok.data.status).toBe('going');
    expect(Math.abs(new Date(ok.data.checked_in_at) - Date.now())).toBeLessThan(60e3);
  });

  it('closes replies when the host cancels, and only the host can cancel', async () => {
    const d = await createDate();
    const notHost = await friend.client.from('gym_dates').update({ cancelled_at: new Date().toISOString() }).eq('id', d.id).select('id');
    expect(notHost.data).toEqual([]);
    await host.client.from('gym_dates').update({ cancelled_at: new Date().toISOString() }).eq('id', d.id);
    const late = await friend.client.from('gym_date_rsvps').insert({ date_id: d.id, user_id: friend.id, status: 'going' });
    expect(late.error).not.toBeNull();
  });

  it('hides a date again after unfriending', async () => {
    const extra = await makeUser(uniqueName('ex'));
    const fid = await befriend(host, extra);
    const d = await createDate();
    expect((await extra.client.from('gym_dates').select('id').eq('id', d.id)).data).toHaveLength(1);
    await extra.client.from('friend_requests').delete().eq('id', fid);
    expect((await extra.client.from('gym_dates').select('id').eq('id', d.id)).data).toEqual([]);
  });
});

describe('account deletion', () => {
  it('deletes the account and all of its data', async () => {
    const u = await makeUser(uniqueName('del'));
    await u.client.from('body_weight_logs').insert({ user_id: u.id, log_date: '2026-01-01', weight_kg: 60 });
    const r = await u.client.rpc('delete_my_account');
    expect(r.error).toBeNull();
    const admin = adminClient();
    expect((await admin.from('profiles').select('id').eq('id', u.id)).data).toEqual([]);
    expect((await admin.from('body_weight_logs').select('user_id').eq('user_id', u.id)).data).toEqual([]);
    expect((await admin.auth.admin.getUserById(u.id)).data.user).toBeNull();
  });
});
