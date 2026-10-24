// Friends, shared routines and the leaderboard. Functions return { data, error }
// where error is a readable message.
import { supabase, errorText, isMissingSchema } from './client.js';
import { account } from './sync.js';
import { sanitizeWorkout, plain, deepPlain } from '../domain/plan.js';
import { cut } from '../core/text.js';

const ok = (data) => ({ data, error: '' });
const fail = (error, fallback) => ({ data: null, error: errorText(error, fallback), missing: isMissingSchema(error) });

/**
 * Friendships of the signed-in user, split into friends, incoming and outgoing
 * requests. Each entry: { id (request id), userId, username, since }.
 */
export async function loadFriendships() {
  const me = account.user.id;
  const r = await supabase.from('friend_requests')
    .select('id,requester_id,target_id,status,created_at,requester:profiles!friend_requests_requester_id_fkey(username),target:profiles!friend_requests_target_id_fkey(username)')
    .or(`requester_id.eq.${me},target_id.eq.${me}`)
    .order('created_at', { ascending: false });
  if (r.error) return fail(r.error);
  const out = { friends: [], incoming: [], outgoing: [] };
  (r.data || []).forEach((x) => {
    const mine = x.requester_id === me;
    const entry = { id: x.id, userId: mine ? x.target_id : x.requester_id, username: (mine ? x.target : x.requester)?.username || 'unknown', since: x.created_at };
    if (x.status === 'accepted') out.friends.push(entry);
    else (mine ? out.outgoing : out.incoming).push(entry);
  });
  out.friends.sort((a, b) => a.username.localeCompare(b.username));
  return ok(out);
}

async function findProfile(name) {
  const r = await supabase.rpc('find_profile', { name });
  if (!isMissingSchema(r.error)) return r;
  // Database without the privacy update: fall back to the old open lookup.
  return supabase.from('profiles').select('id,username').eq('username', name);
}

export async function sendFriendRequest(rawName) {
  const name = String(rawName || '').trim().toLowerCase().replace(/^@/, '');
  if (!/^[a-z0-9_]{3,20}$/.test(name)) return { error: 'Usernames have 3–20 letters, numbers or _.' };
  const found = await findProfile(name);
  if (found.error) return fail(found.error);
  const target = (found.data || [])[0];
  if (!target) return { error: `No one is called @${name}. Check the spelling.` };
  if (target.id === account.user.id) return { error: 'That is you.' };
  const r = await supabase.from('friend_requests').insert({ requester_id: account.user.id, target_id: target.id, status: 'pending' });
  if (!r.error) return ok(`Request sent to @${name}.`);
  if (r.error.code === '23505') {
    // They already asked us (or we asked them): accept theirs if it is pending.
    const theirs = await supabase.from('friend_requests').update({ status: 'accepted' })
      .eq('requester_id', target.id).eq('target_id', account.user.id).eq('status', 'pending').select('id');
    if (!theirs.error && theirs.data && theirs.data.length) return ok(`You and @${name} are now friends.`);
    return { error: `You already have a request or friendship with @${name}.` };
  }
  return fail(r.error);
}

export async function acceptRequest(id) {
  const r = await supabase.from('friend_requests').update({ status: 'accepted' }).eq('id', id);
  return r.error ? fail(r.error) : ok(true);
}

/** Declines, cancels or unfriends. */
export async function removeFriendship(id) {
  const r = await supabase.from('friend_requests').delete().eq('id', id).select('id');
  if (r.error) return fail(r.error);
  if (!r.data || !r.data.length) return { error: 'This needs the latest database update before you can remove friends.' };
  return ok(true);
}

/** Friends' summaries plus your own row, for the leaderboard. */
export async function loadLeaderboard(friends) {
  const r = await supabase.rpc('friend_summaries');
  if (!r.error) return ok(r.data || []);
  if (!isMissingSchema(r.error)) return fail(r.error);
  // Older database: read the tables directly (no weights).
  const ids = [account.user.id, ...friends.map((f) => f.userId)];
  const stats = await supabase.from('leaderboard_stats').select('user_id,workouts_count,volume_kg_reps').in('user_id', ids);
  if (stats.error) return fail(stats.error);
  const names = new Map([[account.user.id, account.profile?.username || 'you'], ...friends.map((f) => [f.userId, f.username])]);
  return ok(ids.map((id) => ({ user_id: id, username: names.get(id), ...((stats.data || []).find((s) => s.user_id === id) || {}) })));
}

export async function publishStats(stats) {
  const row = { user_id: account.user.id, ...stats, updated_at: new Date().toISOString() };
  let r = await supabase.from('leaderboard_stats').upsert(row, { onConflict: 'user_id' });
  if (isMissingSchema(r.error)) {
    // Database without the streak/time columns.
    r = await supabase.from('leaderboard_stats').upsert({ user_id: row.user_id, workouts_count: row.workouts_count, volume_kg_reps: row.volume_kg_reps, updated_at: row.updated_at }, { onConflict: 'user_id' });
  }
  return r.error ? fail(r.error) : ok(true);
}

export async function unpublishStats() {
  const r = await supabase.from('leaderboard_stats').delete().eq('user_id', account.user.id);
  return r.error ? fail(r.error) : ok(true);
}

export async function loadSharedWorkouts() {
  // The newest shares, plus all of the user's own (so they can always be removed).
  const query = () => supabase.from('shared_workouts')
    .select('id,owner_id,title,workout,created_at,owner:profiles!shared_workouts_owner_id_fkey(username)')
    .order('created_at', { ascending: false });
  const [r, own] = await Promise.all([query().limit(50), query().eq('owner_id', account.user.id).limit(50)]);
  if (r.error) return fail(r.error);
  if (own.error) return fail(own.error);
  const byId = new Map([...(r.data || []), ...(own.data || [])].map((x) => [x.id, x]));
  const list = [...byId.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return ok(list.map((x) => ({ ...x, workout: sanitizeWorkout(x.workout), mine: x.owner_id === account.user.id })));
}

export async function shareWorkout(title, workout) {
  const r = await supabase.from('shared_workouts').insert({ owner_id: account.user.id, title: cut(plain(String(title)).trim(), 80) || 'Routine', workout: deepPlain(sanitizeWorkout(workout)) });
  return r.error ? fail(r.error) : ok(true);
}

export async function deleteSharedWorkout(id) {
  const r = await supabase.from('shared_workouts').delete().eq('id', id).eq('owner_id', account.user.id);
  return r.error ? fail(r.error) : ok(true);
}

/** Blocks someone: ends any friendship or request and stops new ones. */
export async function block(userId) {
  const r = await supabase.from('friend_blocks').insert({ blocker_id: account.user.id, blocked_id: userId });
  if (r.error && r.error.code === '23505') return ok(true);
  return r.error ? fail(r.error) : ok(true);
}

export async function unblock(userId) {
  const r = await supabase.from('friend_blocks').delete().eq('blocker_id', account.user.id).eq('blocked_id', userId);
  return r.error ? fail(r.error) : ok(true);
}

export async function loadBlocks() {
  const r = await supabase.rpc('my_blocks');
  if (isMissingSchema(r.error)) return ok([]);
  return r.error ? fail(r.error) : ok(r.data || []);
}
