// Account and cloud sync. This phone stays the working copy; each upload first
// reads the cloud copy and merges, so two devices can't silently wipe each other.
import { supabase, SITE_URL, errorText, isMissingSchema } from './client.js';
import {
  state, localPlan, applyPlan, planBase, setPlanBase, setPlanTombstones, saveLogs, saveLastUsed, saveWeights, saveSync, saveBypass, saveTombstones,
  hasLocalData, clearLocalData,
} from '../state.js';
import { mergePlans, planHashes, stableStringify } from '../domain/plan.js';
import { mergeLogs, mergeProgress, mergeBypass, dailySummaries, sessionKey, newSessionId } from '../domain/logs.js';
import { mergeWeights } from '../domain/weights.js';
import { emit, listen, writeText, read, write, remove, KEYS } from '../core/store.js';
import { makeBackup } from '../domain/backup.js';

export const account = {
  user: null,
  // False until this phone's data is known to belong to the signed-in account
  // (the "someone else used this phone" question is answered). Nothing syncs before.
  ready: false,
  profile: null,
  status: '',
  statusTone: 'default',
  lastSync: 0,
};

let accountSwitchHandler = async () => 'merge';
/** UI hook: decides what happens when a different account signs in on this phone. Returns 'replace' | 'merge' | 'cancel'. */
export function onAccountSwitch(handler) { accountSwitchHandler = handler; }

function setStatus(text, tone = 'default') {
  account.status = text;
  account.statusTone = tone;
  emit('gym:account');
}

export function initAccount() {
  if (!supabase) { emit('gym:account'); return; }
  supabase.auth.onAuthStateChange((event, session) => {
    // supabase-js advises against awaiting other client calls inside this callback.
    setTimeout(() => handleAuth(event, session), 0);
  });
  listen('gym:plan-changed', () => queue('plan'));
  listen('gym:logs-changed', () => queue('data'));
  // Last-used values change on every keystroke during a workout: upload them calmly.
  listen('gym:progress-changed', () => queue('data', 10000));
  listen('gym:weight-changed', () => queue('weights'));
  window.addEventListener('online', () => { if (account.user && account.ready) syncAll(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && account.user && account.ready && Date.now() - account.lastSync > 5 * 60 * 1000) syncAll();
  });
}

// Bumped whenever the phone's data stops belonging to the signed-in account
// (sign-out, account deletion, another user). A sync started before then must
// not write what it read back onto the phone.
let generation = 0;
function retire() {
  generation++;
  Object.keys(timers).forEach((k) => { clearTimeout(timers[k]?.id); timers[k] = null; });
}

let starting = null;
async function handleAuth(event, session) {
  if (event === 'PASSWORD_RECOVERY') emit('gym:password-recovery');
  const user = session?.user || null;
  if (!user) {
    if (account.user) retire();
    account.user = null;
    account.profile = null;
    account.ready = false;
    setStatus('');
    return;
  }
  const changed = !account.user || account.user.id !== user.id;
  account.user = user;
  // Only a new sign-in (or app start with a saved session) triggers a full sync;
  // hourly token refreshes do not.
  if (changed && !starting) {
    retire();
    account.ready = false;
    starting = startSession(user).finally(() => { starting = null; });
  } else {
    emit('gym:account');
  }
}

/** Forgets bookkeeping that belonged to the previous account on this phone. */
function resetAccountBookkeeping() {
  state.deletedSessions = [];
  state.deletedDates = {};
  saveTombstones();
  remove(KEYS.legacyStats);
  setPlanBase(null);
  state.sync = { ...state.sync, syncedWeightDates: [], pendingWeightDeletes: {} };
}

async function startSession(user) {
  const owner = state.sync.accountId;
  if (owner && owner !== user.id && hasLocalData()) {
    const choice = await accountSwitchHandler();
    if (account.user?.id !== user.id) return;
    if (choice === 'cancel') { await supabase.auth.signOut(); return; }
    if (choice === 'replace') {
      // Keep a copy in case the other person had changes that never reached their account.
      const backup = makeBackup((k) => localStorage.getItem(k), 'switch');
      clearLocalData();
      writeText(KEYS.switchBackup, backup);
    }
    resetAccountBookkeeping();
    if (choice === 'merge') {
      // The other account's deletions and edit times must not act on this account's plan.
      setPlanTombstones([], []);
      write(KEYS.planTimes, {});
    }
  } else if (owner && owner !== user.id) {
    resetAccountBookkeeping();
  }
  state.sync.accountId = user.id;
  saveSync();
  account.ready = true;
  await loadProfile();
  emit('gym:account');
  await syncAll();
}

async function loadProfile() {
  const uid = account.user.id;
  let r = await supabase.from('profiles').select('id,username,share_weight').eq('id', uid).maybeSingle();
  if (isMissingSchema(r.error)) r = await supabase.from('profiles').select('id,username').eq('id', uid).maybeSingle();
  if (!r.error && !r.data) {
    // Accounts created before profiles were made on sign-up may have none.
    const wanted = String(account.user.user_metadata?.username || '').toLowerCase();
    const name = /^[a-z0-9_]{3,20}$/.test(wanted) ? wanted : 'user_' + uid.replace(/-/g, '').slice(0, 8);
    let ins = await supabase.from('profiles').insert({ id: uid, username: name }).select('id,username').single();
    if (ins.error && ins.error.code === '23505') ins = await supabase.from('profiles').insert({ id: uid, username: 'user_' + uid.replace(/-/g, '').slice(0, 8) }).select('id,username').single();
    r = ins;
  }
  account.profile = r.data || null;
  if (r.error) setStatus('Could not load your profile: ' + errorText(r.error), 'error');
  // The requested username was taken at sign-up, so the account got a random one.
  const wanted = String(account.user.user_metadata?.username || '').toLowerCase();
  if (account.profile && wanted && account.profile.username !== wanted && /^user_[0-9a-f]{8}$/.test(account.profile.username)) {
    emit('gym:username-taken', { wanted, given: account.profile.username });
  }
}

// ---------- per-area sync with read-merge-write ----------
const running = {}, again = {}, timers = {};

function run(area) {
  if (!account.user || !account.ready) return Promise.resolve(false);
  if (running[area]) { again[area] = true; return running[area]; }
  const started = generation;
  const stale = () => started !== generation;
  running[area] = (async () => {
    let ok;
    try {
      do {
        again[area] = false;
        ok = await SYNC[area](stale);
      } while (again[area] && account.user && account.ready && !stale());
    } catch (error) {
      ok = false;
      if (!stale()) setStatus('Saved on this phone. Cloud sync failed: ' + errorText(error), 'error');
    } finally {
      running[area] = null;
    }
    return ok;
  })();
  return running[area];
}

function queue(area, delay = 800) {
  if (!account.user || !account.ready) return;
  const due = Date.now() + delay;
  // A sooner request (e.g. a saved workout) wins over a later one.
  if (timers[area] && timers[area].due <= due) return;
  clearTimeout(timers[area]?.id);
  timers[area] = { due, id: setTimeout(() => { timers[area] = null; run(area); }, delay) };
}

// Postgres reorders JSON keys, so compare with sorted keys.
const same = (a, b) => stableStringify(a) === stableStringify(b);
const MAX_ATTEMPTS = 3;
const WEIGHT_BATCH = 200; // the server takes up to 400 weigh-ins per call

/**
 * Writes a row only if nobody else wrote it since we read it (compare-and-set
 * on updated_at). Returns false when another device got there first; the
 * caller then reads, merges and tries again.
 */
async function casWrite(table, uid, readUpdatedAt, row) {
  if (readUpdatedAt == null) {
    const r = await supabase.from(table).insert(row);
    if (r.error && r.error.code === '23505') return false;
    if (r.error) throw r.error;
    return true;
  }
  const r = await supabase.from(table).update(row).eq('user_id', uid).eq('updated_at', readUpdatedAt).select('user_id');
  if (r.error) throw r.error;
  return r.data.length === 1;
}

// Newest schema first; daily_summaries/deleted_dates and bypass/tombstone/legacy columns
// arrive with the 2026-10-23 workout-sync migrations.
const DATA_COLUMNS = [
  ['logs', 'progress', 'bypass_days', 'deleted_sessions', 'legacy_stats', 'stats_snapshot', 'daily_summaries', 'deleted_dates'],
  ['logs', 'progress', 'bypass_days', 'deleted_sessions', 'legacy_stats', 'stats_snapshot'],
  ['logs', 'progress'],
];

/** Element-wise maximum of stat snapshots, so published totals never shrink. */
function maxMetrics(...sources) {
  const out = {};
  sources.forEach((src) => Object.keys(src || {}).forEach((k) => { out[k] = Math.max(Number(out[k]) || 0, Number(src[k]) || 0); }));
  return out;
}

const SYNC = {
  async plan(stale) {
    const uid = account.user.id;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const r = await supabase.from('workout_plans').select('plan,updated_at').eq('user_id', uid).maybeSingle();
      if (stale()) return false;
      if (r.error) throw r.error;
      // No cloud plan (first sync, or the row was removed): there is no common base.
      const merged = mergePlans(r.data?.plan, localPlan(), r.data ? planBase() : null);
      const local = localPlan();
      if (!same(merged.workouts, local.workouts) || !same(merged.schedule, local.schedule) || merged.restImage !== local.restImage) applyPlan(merged);
      const done = r.data && same(r.data.plan, merged);
      const wrote = done || await casWrite('workout_plans', uid, r.data?.updated_at ?? null, { user_id: uid, plan: merged, updated_at: new Date().toISOString() });
      if (stale()) return false;
      if (wrote) {
        setPlanBase(planHashes(merged));
        return true;
      }
    }
    throw new Error('Your plan changed on another device at the same time. It will sync again shortly.');
  },

  async data(stale) {
    const uid = account.user.id;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // Databases that have not applied every migration lack some columns; use what exists.
      let columns = null, r = null;
      for (const set of DATA_COLUMNS) {
        r = await supabase.from('workout_data').select([...set, 'updated_at'].join(',')).eq('user_id', uid).maybeSingle();
        if (!isMissingSchema(r.error)) { columns = set; break; }
      }
      if (stale()) return false;
      if (r.error) throw r.error;
      const remote = r.data || {};
      const has = (c) => columns.includes(c);
      // Sessions brought back from a backup that were deleted in the account
      // since: give them new ids, so the deletion doesn't remove them again.
      const restored = new Set(state.sync.restoredSessions || []);
      if (restored.size) {
        const gone = new Set(Array.isArray(remote.deleted_sessions) ? remote.deleted_sessions : []);
        let rekeyed = false;
        Object.keys(state.logs).forEach((d) => {
          state.logs[d] = state.logs[d].map((x) => {
            const k = sessionKey(d, x);
            if (!restored.has(k) || !gone.has(k)) return x;
            rekeyed = true;
            return { ...x, id: newSessionId() };
          });
        });
        if (rekeyed) saveLogs({ silent: true });
      }

      const deleted = [...new Set([...state.deletedSessions, ...(Array.isArray(remote.deleted_sessions) ? remote.deleted_sessions : [])])];
      const deletedDates = { ...(remote.deleted_dates || {}) };
      Object.keys(state.deletedDates).forEach((d) => { deletedDates[d] = Math.max(Number(deletedDates[d]) || Date.parse(deletedDates[d]) || 0, Number(state.deletedDates[d]) || 0); });
      const logs = mergeLogs(remote.logs || {}, state.logs, { deleted, deletedDates });
      const progress = mergeProgress(remote.progress, state.lastUsed);
      const bypass = mergeBypass(remote.bypass_days, state.bypassState);
      const legacy = maxMetrics(read(KEYS.legacyStats, {}), remote.legacy_stats, remote.stats_snapshot);

      state.deletedSessions = deleted;
      state.deletedDates = deletedDates;
      saveTombstones();
      write(KEYS.legacyStats, legacy);
      if (!same(logs, state.logs)) { state.logs = logs; saveLogs({ silent: true }); }
      if (!same(progress, state.lastUsed)) { state.lastUsed = progress; saveLastUsed({ silent: true }); }
      if (!same(bypass, state.bypassState)) { state.bypassState = bypass; saveBypass({ silent: true }); }

      const row = { user_id: uid, logs, progress, updated_at: new Date().toISOString() };
      if (has('bypass_days')) Object.assign(row, { bypass_days: bypass, deleted_sessions: deleted, legacy_stats: legacy });
      if (has('deleted_dates')) Object.assign(row, { deleted_dates: deletedDates, daily_summaries: dailySummaries(logs) });
      const changed = !r.data || Object.keys(row).some((k) => k !== 'updated_at' && k !== 'user_id' && !same(remote[k] ?? null, row[k]));
      if (!changed || await casWrite('workout_data', uid, r.data?.updated_at ?? null, row)) {
        if (restored.size && !stale()) { state.sync.restoredSessions = []; saveSync(); }
        return true;
      }
    }
    throw new Error('Your workouts changed on another device at the same time. They will sync again shortly.');
  },

  async weights(stale) {
    const uid = account.user.id;
    for (const date of Object.keys(state.sync.pendingWeightDeletes)) {
      const del = await supabase.from('body_weight_logs').delete().eq('user_id', uid).eq('log_date', date);
      if (stale()) return false;
      if (del.error) throw del.error;
      delete state.sync.pendingWeightDeletes[date];
      saveSync();
    }
    let withStamp = true;
    let r = await supabase.from('body_weight_logs').select('log_date,weight_kg,updated_at').eq('user_id', uid);
    if (isMissingSchema(r.error)) { withStamp = false; r = await supabase.from('body_weight_logs').select('log_date,weight_kg').eq('user_id', uid); }
    if (stale()) return false;
    if (r.error) throw r.error;
    const dirty = new Set(state.sync.dirtyWeightDates);
    const merged = mergeWeights(r.data, state.weights, state.sync.syncedWeightDates, [...dirty]);
    if (!same(merged, state.weights)) { state.weights = merged; saveWeights({ silent: true }); }
    const remote = new Map((r.data || []).map((x) => [x.log_date, Number(x.weight_kg)]));
    const changed = merged.filter((x) => dirty.has(x.date) || remote.get(x.date) !== x.weight);
    // Server stamps of what was written; an entry missing here was refused (deleted elsewhere).
    const saved = new Map();
    let rpc = true;
    for (let i = 0; i < changed.length; i += WEIGHT_BATCH) {
      const batch = changed.slice(i, i + WEIGHT_BATCH);
      if (rpc) {
        // Server time decides; only entries changed here may override a deletion made elsewhere.
        const up = await supabase.rpc('save_my_weights', { entries: batch.map((x) => ({ log_date: x.date, weight_kg: x.weight, fresh: dirty.has(x.date) })) });
        if (stale()) return false;
        if (!isMissingSchema(up.error)) {
          if (up.error) throw up.error;
          (up.data || []).forEach((row) => saved.set(row.log_date, Date.parse(row.updated_at) || 0));
          continue;
        }
        rpc = false; // older database: plain upsert
      }
      const rows = batch.map((x) => ({ user_id: uid, log_date: x.date, weight_kg: x.weight, ...(withStamp ? { updated_at: new Date(x.updatedAt || Date.now()).toISOString() } : {}) }));
      const up = await supabase.from('body_weight_logs').upsert(rows, { onConflict: 'user_id,log_date' });
      if (stale()) return false;
      if (up.error) throw up.error;
      batch.forEach((x) => saved.set(x.date, x.updatedAt || 0));
    }
    if (changed.length) {
      // Entries edited again during the upload stay as they are (and stay dirty).
      const sent = new Map(changed.map((x) => [x.date, x]));
      const untouched = (x) => sent.has(x.date) && sent.get(x.date).weight === x.weight && sent.get(x.date).updatedAt === x.updatedAt;
      const current = new Map(state.weights.map((x) => [x.date, x]));
      const settled = new Set(changed.filter((x) => !current.has(x.date) || untouched(current.get(x.date))).map((x) => x.date));
      state.weights = state.weights
        .filter((x) => !untouched(x) || saved.has(x.date))
        .map((x) => (untouched(x) && saved.get(x.date) ? { ...x, updatedAt: saved.get(x.date) } : x));
      state.sync.dirtyWeightDates = state.sync.dirtyWeightDates.filter((d) => !settled.has(d));
      saveWeights({ silent: true });
    }
    state.sync.syncedWeightDates = state.weights.filter((x) => !state.sync.dirtyWeightDates.includes(x.date)).map((x) => x.date);
    saveSync();
    return true;
  },
};

export async function syncAll() {
  if (!account.user || !account.ready) return false;
  setStatus('Syncing…');
  const results = [await run('plan'), await run('data'), await run('weights')];
  if (results.every(Boolean)) {
    account.lastSync = Date.now();
    setStatus('Synced ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 'ok');
  }
  emit('gym:synced');
  return results.every(Boolean);
}

// ---------- account actions (return an error message, or '' on success) ----------
export async function signIn(email, password) {
  const r = await supabase.auth.signInWithPassword({ email, password });
  return r.error ? errorText(r.error) : '';
}

export async function signUp(email, password, username) {
  // The age/permission confirmation is recorded with the account.
  const data = { username, age_confirmed: 'true' };
  const r = await supabase.auth.signUp({ email, password, options: { data, emailRedirectTo: SITE_URL } });
  if (r.error) return errorText(r.error);
  return r.data.session ? '' : 'confirm-email';
}

export async function resetPassword(email) {
  const r = await supabase.auth.resetPasswordForEmail(email, { redirectTo: SITE_URL });
  return r.error ? errorText(r.error) : '';
}

/** Signs in with the code from a password-reset email; PASSWORD_RECOVERY then asks for a new password. */
export async function verifyRecoveryCode(email, token) {
  const r = await supabase.auth.verifyOtp({ email, token, type: 'recovery' });
  // Success fires PASSWORD_RECOVERY through onAuthStateChange, which asks for the new password.
  return r.error ? errorText(r.error, 'That code did not work. Request a new email and try again.') : '';
}

export async function updatePassword(password) {
  const r = await supabase.auth.updateUser({ password });
  return r.error ? errorText(r.error) : '';
}

/**
 * Signs out. With removeLocalData, the phone's data is removed only after a
 * successful final sync, unless `force` (the user accepted losing unsynced data).
 * Returns '' on success or a message explaining why nothing was removed.
 */
export async function signOut({ removeLocalData = false, force = false } = {}) {
  let synced = true;
  if (account.user && account.ready) synced = await syncAll();
  if (removeLocalData && !synced && !force) return 'not-synced';
  account.ready = false;
  retire(); // a sync still in flight must not write the account's data back
  await supabase.auth.signOut();
  if (removeLocalData) clearLocalData();
  return '';
}

export async function changeUsername(name) {
  const username = String(name || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return 'Use 3–20 letters, numbers or _.';
  const r = await supabase.from('profiles').update({ username }).eq('id', account.user.id).select('id,username').single();
  if (r.error) return r.error.code === '23505' ? 'That username is taken.' : errorText(r.error);
  account.profile = { ...account.profile, username };
  emit('gym:account');
  return '';
}

export async function setShareWeight(on) {
  const r = await supabase.from('profiles').update({ share_weight: !!on }).eq('id', account.user.id);
  if (r.error) return isMissingSchema(r.error) ? 'This needs the latest database update.' : errorText(r.error);
  account.profile = { ...account.profile, share_weight: !!on };
  emit('gym:account');
  return '';
}

/** Deletes the account and everything stored for it in the cloud. Data on this phone stays. */
export async function deleteAccount({ removeLocalData = false } = {}) {
  const r = await supabase.rpc('delete_my_account');
  if (r.error) return isMissingSchema(r.error) ? 'This needs the latest database update.' : errorText(r.error);
  // Whoever signs in next on this phone is asked before the remaining data joins their account.
  account.ready = false;
  retire();
  state.sync = { ...state.sync, accountId: 'deleted:' + account.user.id, syncedWeightDates: [], pendingWeightDeletes: {}, dirtyWeightDates: [] };
  saveSync();
  await supabase.auth.signOut();
  if (removeLocalData) clearLocalData();
  return '';
}
