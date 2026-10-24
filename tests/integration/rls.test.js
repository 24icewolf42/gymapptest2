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
    // b published stats (leaderboard row) but has no synced history, so the row's numbers are used.
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

describe('hardening', () => {
  it('ignores a client-supplied created_at, so the daily request limit holds', async () => {
    const spammer = await makeUser(uniqueName('spam'));
    const targets = await Promise.all(Array.from({ length: 21 }, (_, i) => makeUser(uniqueName('t' + i))));
    const past = '2000-01-01T00:00:00Z';
    const first = await spammer.client.from('friend_requests')
      .insert(targets.slice(0, 20).map((t) => ({ requester_id: spammer.id, target_id: t.id, status: 'pending', created_at: past }))).select('created_at');
    expect(first.error).toBeNull();
    expect(first.data.every((r) => r.created_at > '2020')).toBe(true);
    const over = await spammer.client.from('friend_requests').insert({ requester_id: spammer.id, target_id: targets[20].id, status: 'pending', created_at: past });
    expect(over.error && over.error.code).toBe('54000');
  });

  it('lets people block: it ends the friendship, stops requests and hides the blocker', async () => {
    const a = await makeUser(uniqueName('a'));
    const b = await makeUser(uniqueName('b'));
    await befriend(a, b);
    const blk = await a.client.from('friend_blocks').insert({ blocker_id: a.id, blocked_id: b.id });
    expect(blk.error).toBeNull();
    expect((await adminClient().from('friend_requests').select('id').or(`requester_id.eq.${a.id},target_id.eq.${a.id}`)).data).toEqual([]);
    const again = await b.client.from('friend_requests').insert({ requester_id: b.id, target_id: a.id, status: 'pending' });
    expect(again.error).not.toBeNull();
    const back = await a.client.from('friend_requests').insert({ requester_id: a.id, target_id: b.id, status: 'pending' });
    expect(back.error).not.toBeNull();
    expect((await b.client.rpc('find_profile', { name: a.username })).data).toEqual([]);
    expect((await a.client.rpc('my_blocks')).data.map((x) => x.username)).toEqual([b.username]);
    expect((await b.client.from('friend_blocks').select('*')).data).toEqual([]);
    await a.client.from('friend_blocks').delete().eq('blocked_id', b.id);
    expect((await b.client.rpc('find_profile', { name: a.username })).data).toHaveLength(1);
  });

  it('rate-limits username lookups', async () => {
    const u = await makeUser(uniqueName('look'));
    for (let i = 0; i < 30; i++) {
      const r = await u.client.rpc('find_profile', { name: 'nobody_' + i });
      expect(r.error).toBeNull();
    }
    const over = await u.client.rpc('find_profile', { name: 'nobody_x' });
    expect(over.error && over.error.code).toBe('54000');
  });

  it('does not publish reply or invite rows to realtime, and gives anon nothing', async () => {
    const { execFileSync } = await import('node:child_process');
    const q = (sql) => execFileSync('docker', ['exec', '-i', 'supabase_db_gymapptest2', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', sql], { encoding: 'utf8' }).trim();
    expect(q("select string_agg(tablename, ',' order by tablename) from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'gym_%'")).toBe('gym_dates');
    expect(q("select count(*) from information_schema.role_table_grants where grantee = 'anon' and table_name in ('gym_dates','gym_date_rsvps','gym_date_invites','friend_blocks')")).toBe('0');
  });

  it('keeps visibility helpers out of the API', async () => {
    const u = await makeUser(uniqueName('rpc'));
    const r = await u.client.rpc('gym_date_open', { d: '00000000-0000-0000-0000-000000000000' });
    expect(r.error && r.error.code).toBe('PGRST202');
  });

  it('computes published totals from synced history instead of trusting the row', async () => {
    const a = await makeUser(uniqueName('a'));
    const b = await makeUser(uniqueName('b'));
    await befriend(a, b);
    await b.client.from('workout_plans').insert({ user_id: b.id, plan: { workouts: { Push: [{ name: 'Bench' }] } } });
    // Not published: no stats and no plan counts.
    let row = (await a.client.rpc('friend_summaries')).data.find((r) => r.user_id === b.id);
    expect(row).toMatchObject({ workouts_count: null, routines: null, exercises: null });
    await b.client.from('workout_data').upsert({ user_id: b.id, logs: { '2026-01-01': [{ day: 'Push', duration: 600, exercises: [{ name: 'Bench', sets: [{ w: '50', r: '10' }, { w: 'x', r: '5' }] }] }] }, progress: {} });
    await b.client.from('leaderboard_stats').insert({ user_id: b.id, workouts_count: 999999, volume_kg_reps: 999999999 });
    row = (await a.client.rpc('friend_summaries')).data.find((r) => r.user_id === b.id);
    expect(row).toMatchObject({ workouts_count: 1, volume_kg_reps: 500, total_seconds: 600, routines: 1, exercises: 1 });
  });

  it('keeps a deleted weigh-in deleted when an older copy is uploaded again', async () => {
    const u = await makeUser(uniqueName('w'));
    const old = '2026-01-01T10:00:00Z';
    await u.client.from('body_weight_logs').upsert({ user_id: u.id, log_date: '2026-01-02', weight_kg: 70, updated_at: old });
    await u.client.from('body_weight_logs').delete().eq('user_id', u.id).eq('log_date', '2026-01-02');
    await u.client.from('body_weight_logs').upsert({ user_id: u.id, log_date: '2026-01-02', weight_kg: 70, updated_at: old }, { onConflict: 'user_id,log_date' });
    expect((await u.client.from('body_weight_logs').select('weight_kg').eq('log_date', '2026-01-02')).data).toEqual([]);
    await u.client.from('body_weight_logs').upsert({ user_id: u.id, log_date: '2026-01-02', weight_kg: 71, updated_at: new Date(Date.now() + 1000).toISOString() }, { onConflict: 'user_id,log_date' });
    expect((await u.client.from('body_weight_logs').select('weight_kg').eq('log_date', '2026-01-02')).data).toEqual([{ weight_kg: 71 }]);
  });

  it('saves weigh-ins with server time, and only fresh ones override a deletion', async () => {
    const u = await makeUser(uniqueName('sw'));
    const r1 = await u.client.rpc('save_my_weights', { entries: [{ log_date: '2026-03-01', weight_kg: 70, fresh: true }] });
    expect(r1.error).toBeNull();
    expect(r1.data).toHaveLength(1);
    expect(r1.data[0].log_date).toBe('2026-03-01');
    expect(Math.abs(Date.parse(r1.data[0].updated_at) - Date.now())).toBeLessThan(60000);
    await u.client.from('body_weight_logs').delete().eq('user_id', u.id).eq('log_date', '2026-03-01');
    // A copy another phone still holds does not bring it back...
    const r2 = await u.client.rpc('save_my_weights', { entries: [{ log_date: '2026-03-01', weight_kg: 70, fresh: false }, { log_date: '2026-03-02', weight_kg: 71 }] });
    expect(r2.data.map((x) => x.log_date)).toEqual(['2026-03-02']);
    expect((await u.client.from('body_weight_logs').select('weight_kg').eq('log_date', '2026-03-01')).data).toEqual([]);
    // A copy changed after the deletion (an offline phone of the original app) survives.
    const later = new Date(Date.now() + 60000).toISOString();
    const r4 = await u.client.rpc('save_my_weights', { entries: [{ log_date: '2026-03-01', weight_kg: 69, updated_at: later }] });
    expect(r4.data).toHaveLength(1);
    await u.client.from('body_weight_logs').delete().eq('user_id', u.id).eq('log_date', '2026-03-01');
    // ...but an entry made again on a phone does.
    const r3 = await u.client.rpc('save_my_weights', { entries: [{ log_date: '2026-03-01', weight_kg: 72, fresh: true }] });
    expect(r3.data).toHaveLength(1);
    expect((await u.client.from('body_weight_logs').select('weight_kg').eq('log_date', '2026-03-01')).data).toEqual([{ weight_kg: 72 }]);
    const many = Array.from({ length: 401 }, (_, i) => ({ log_date: `2025-01-01`, weight_kg: 70 + (i % 10) }));
    expect((await u.client.rpc('save_my_weights', { entries: many })).error).not.toBeNull();
  });

  it('does not let a reply move to another date or a host delete a date', async () => {
    const host = await makeUser(uniqueName('h'));
    const fr = await makeUser(uniqueName('f'));
    await befriend(host, fr);
    const mk = (mins) => host.client.from('gym_dates').insert({ host_id: host.id, starts_at: new Date(Date.now() + mins * 60000).toISOString(), gym: 'G' }).select('id').single();
    const now = (await mk(0)).data, later = (await mk(3 * 24 * 60)).data;
    await fr.client.from('gym_date_rsvps').upsert({ date_id: now.id, user_id: fr.id, status: 'going', checked_in_at: new Date().toISOString() });
    const moved = await fr.client.from('gym_date_rsvps').update({ date_id: later.id }).eq('date_id', now.id).eq('user_id', fr.id);
    expect(moved.error).not.toBeNull();
    const del = await host.client.from('gym_dates').delete().eq('id', now.id).select('id');
    expect(del.error || del.data.length === 0).toBeTruthy();
  });

  it('lets a host only cancel a date, once, so replies keep their meaning', async () => {
    const host = await makeUser(uniqueName('hc'));
    const d = (await host.client.from('gym_dates').insert({ host_id: host.id, starts_at: new Date().toISOString(), gym: 'G' }).select('id').single()).data;
    for (const change of [{ starts_at: new Date(Date.now() + 5 * 86400000).toISOString() }, { gym: 'Other gym' }, { invite_only: true }]) {
      expect((await host.client.from('gym_dates').update(change).eq('id', d.id)).error).not.toBeNull();
    }
    expect((await host.client.from('gym_dates').update({ cancelled_at: new Date().toISOString() }).eq('id', d.id)).error).toBeNull();
    expect((await host.client.from('gym_dates').update({ cancelled_at: null }).eq('id', d.id)).error).not.toBeNull();
  });

  it('gives signed-in users no TRUNCATE or other table-level extras on the original tables', async () => {
    const { execFileSync } = await import('node:child_process');
    const q = (sql) => execFileSync('docker', ['exec', '-i', 'supabase_db_gymapptest2', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', sql], { encoding: 'utf8' }).trim();
    const tables = ['profiles', 'friend_requests', 'shared_workouts', 'leaderboard_stats', 'workout_plans', 'body_weight_logs', 'workout_data'];
    for (const t of tables) {
      for (const p of ['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) expect(q(`select has_table_privilege('authenticated', 'public.${t}', '${p}')`), `${t} ${p}`).toBe('f');
    }
  });
});

describe('hardening, round 2', () => {
  it('keeps counting cancelled requests and parallel requests toward the daily limit', async () => {
    const spammer = await makeUser(uniqueName('sp2'));
    const targets = await Promise.all(Array.from({ length: 26 }, (_, i) => makeUser(uniqueName('q' + i))));
    for (const t of targets.slice(0, 10)) {
      await spammer.client.from('friend_requests').insert({ requester_id: spammer.id, target_id: t.id, status: 'pending' });
    }
    await spammer.client.from('friend_requests').delete().eq('requester_id', spammer.id);
    const results = await Promise.all(targets.slice(10).map((t) => spammer.client.from('friend_requests').insert({ requester_id: spammer.id, target_id: t.id, status: 'pending' })));
    expect(results.filter((r) => !r.error).length).toBe(10);
  });

  it('holds the lookup limit under parallel calls', async () => {
    const u = await makeUser(uniqueName('pl'));
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => u.client.rpc('find_profile', { name: 'nobody_' + i })));
    expect(results.filter((r) => !r.error).length).toBe(30);
  });

  it('removes replies and invites between two people when one blocks or unfriends', async () => {
    const host = await makeUser(uniqueName('bh'));
    const fr = await makeUser(uniqueName('bf'));
    const fid = await befriend(host, fr);
    const d = (await host.client.from('gym_dates').insert({ host_id: host.id, starts_at: new Date(Date.now() + 3600e3).toISOString(), gym: 'G', invite_only: true }).select('id').single()).data;
    await host.client.from('gym_date_invites').insert({ date_id: d.id, user_id: fr.id });
    await fr.client.from('gym_date_rsvps').insert({ date_id: d.id, user_id: fr.id, status: 'going' });
    await fr.client.from('friend_blocks').insert({ blocker_id: fr.id, blocked_id: host.id });
    const admin = adminClient();
    expect((await admin.from('gym_date_rsvps').select('user_id').eq('date_id', d.id)).data.map((r) => r.user_id)).toEqual([host.id]);
    expect((await admin.from('gym_date_invites').select('user_id').eq('date_id', d.id)).data).toEqual([]);
    expect((await admin.from('friend_requests').select('id').eq('id', fid)).data).toEqual([]);
  });

  it('refuses sign-ups without the age confirmation', async () => {
    const { anonClient } = await import('./helpers.js');
    const r = await anonClient().auth.signUp({ email: uniqueName('noage') + '@example.test', password: 'test-password-123', options: { data: { username: uniqueName('noage') } } });
    expect(r.error).not.toBeNull();
  });

  it('leaves no sign-in records behind after deleting an account', async () => {
    const u = await makeUser(uniqueName('aud'));
    const { execFileSync } = await import('node:child_process');
    const q = (sql) => execFileSync('docker', ['exec', '-i', 'supabase_db_gymapptest2', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', sql], { encoding: 'utf8' }).trim();
    const count = () => Number(q(`select count(*) from auth.audit_log_entries where payload->>'actor_id' = '${u.id}' or payload->>'actor_username' = '${u.email}'`));
    expect(count()).toBeGreaterThan(0);
    await u.client.rpc('delete_my_account');
    expect(count()).toBe(0);
    expect(q("select count(*) from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'")).toBe('0');
  });
});
