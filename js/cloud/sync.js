// Account and cloud sync. This phone stays the working copy; each upload first
// reads the cloud copy and merges, so two devices can't silently wipe each other.
import { supabase, SITE_URL, errorText, isMissingSchema } from './client.js';
import {
  state, localPlan, applyPlan, saveLogs, saveLastUsed, saveWeights, saveSync, hasLocalData, clearLocalData,
} from '../state.js';
import { mergePlans } from '../domain/plan.js';
import { mergeLogs, mergeProgress, allKeys } from '../domain/logs.js';
import { mergeWeights } from '../domain/weights.js';
import { emit, listen, writeText } from '../core/store.js';
import { makeBackup } from '../domain/backup.js';

export const account = {
  user: null,
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
  listen('gym:progress-changed', () => queue('data'));
  listen('gym:weight-changed', () => queue('weights'));
  window.addEventListener('online', () => { if (account.user) syncAll(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && account.user && Date.now() - account.lastSync > 5 * 60 * 1000) syncAll();
  });
}

let starting = null;
async function handleAuth(event, session) {
  if (event === 'PASSWORD_RECOVERY') emit('gym:password-recovery');
  const user = session?.user || null;
  if (!user) {
    account.user = null;
    account.profile = null;
    setStatus('');
    return;
  }
  const changed = !account.user || account.user.id !== user.id;
  account.user = user;
  // Only a new sign-in (or app start with a saved session) triggers a full sync;
  // hourly token refreshes do not.
  if (changed && !starting) {
    starting = startSession(user).finally(() => { starting = null; });
  } else {
    emit('gym:account');
  }
}

async function startSession(user) {
  if (state.sync.accountId && state.sync.accountId !== user.id && hasLocalData()) {
    const choice = await accountSwitchHandler();
    if (choice === 'cancel') { await supabase.auth.signOut(); return; }
    if (choice === 'replace') {
      // Keep a copy in case the other person had changes that never reached their account.
      writeText('gymBackupBeforeSwitch', makeBackup((k) => localStorage.getItem(k), 'switch'));
      clearLocalData();
    }
  }
  state.sync.accountId = user.id;
  saveSync();
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
}

// ---------- per-area sync with read-merge-write ----------
const running = {}, again = {}, timers = {};

function run(area) {
  if (!account.user) return Promise.resolve(false);
  if (running[area]) { again[area] = true; return running[area]; }
  running[area] = (async () => {
    let ok;
    try {
      do {
        again[area] = false;
        ok = await SYNC[area]();
      } while (again[area] && account.user);
    } catch (error) {
      ok = false;
      setStatus('Saved on this phone. Cloud sync failed: ' + errorText(error), 'error');
    } finally {
      running[area] = null;
    }
    return ok;
  })();
  return running[area];
}

function queue(area) {
  if (!account.user) return;
  clearTimeout(timers[area]);
  timers[area] = setTimeout(() => run(area), 800);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const SYNC = {
  async plan() {
    const uid = account.user.id;
    const r = await supabase.from('workout_plans').select('plan').eq('user_id', uid).maybeSingle();
    if (r.error) throw r.error;
    const merged = mergePlans(r.data?.plan, localPlan());
    if (!same(merged.workouts, state.workouts) || !same(merged.schedule, state.schedule)) applyPlan(merged);
    if (r.data && same(r.data.plan, merged)) return true;
    const up = await supabase.from('workout_plans').upsert({ user_id: uid, plan: merged, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (up.error) throw up.error;
    return true;
  },

  async data() {
    const uid = account.user.id;
    const r = await supabase.from('workout_data').select('logs,progress').eq('user_id', uid).maybeSingle();
    if (r.error) throw r.error;
    const pending = { ...state.sync.pendingDeletes };
    const logs = mergeLogs(r.data?.logs || {}, state.logs, { pendingDeletes: pending, syncedKeys: state.sync.syncedKeys });
    const progress = mergeProgress(r.data?.progress, state.lastUsed);
    if (!same(logs, state.logs)) { state.logs = logs; saveLogs({ silent: true }); }
    if (!same(progress, state.lastUsed)) { state.lastUsed = progress; saveLastUsed({ silent: true }); }
    if (!r.data || !same(r.data.logs, logs) || !same(r.data.progress, progress)) {
      const up = await supabase.from('workout_data').upsert({ user_id: uid, logs, progress, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (up.error) throw up.error;
    }
    state.sync.syncedKeys = allKeys(logs);
    Object.keys(pending).forEach((k) => { if (state.sync.pendingDeletes[k] === pending[k]) delete state.sync.pendingDeletes[k]; });
    saveSync();
    return true;
  },

  async weights() {
    const uid = account.user.id;
    for (const date of Object.keys(state.sync.pendingWeightDeletes)) {
      const del = await supabase.from('body_weight_logs').delete().eq('user_id', uid).eq('log_date', date);
      if (del.error) throw del.error;
      delete state.sync.pendingWeightDeletes[date];
      saveSync();
    }
    const r = await supabase.from('body_weight_logs').select('log_date,weight_kg').eq('user_id', uid);
    if (r.error) throw r.error;
    const merged = mergeWeights(r.data, state.weights, state.sync.syncedWeightDates);
    if (!same(merged, state.weights)) { state.weights = merged; saveWeights({ silent: true }); }
    const remote = new Map((r.data || []).map((x) => [x.log_date, Number(x.weight_kg)]));
    const changed = merged.filter((x) => remote.get(x.date) !== x.weight).map((x) => ({ user_id: uid, log_date: x.date, weight_kg: x.weight }));
    if (changed.length) {
      const up = await supabase.from('body_weight_logs').upsert(changed, { onConflict: 'user_id,log_date' });
      if (up.error) throw up.error;
    }
    state.sync.syncedWeightDates = merged.map((x) => x.date);
    saveSync();
    return true;
  },
};

export async function syncAll() {
  if (!account.user) return false;
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
  const r = await supabase.auth.signUp({ email, password, options: { data: { username }, emailRedirectTo: SITE_URL } });
  if (r.error) return errorText(r.error);
  return r.data.session ? '' : 'confirm-email';
}

export async function resetPassword(email) {
  const r = await supabase.auth.resetPasswordForEmail(email, { redirectTo: SITE_URL });
  return r.error ? errorText(r.error) : '';
}

export async function updatePassword(password) {
  const r = await supabase.auth.updateUser({ password });
  return r.error ? errorText(r.error) : '';
}

export async function signOut({ removeLocalData = false } = {}) {
  // Push pending changes first so nothing is lost when the data is removed.
  if (account.user) await syncAll();
  await supabase.auth.signOut();
  if (removeLocalData) clearLocalData();
  else { state.sync.syncedKeys = []; state.sync.syncedWeightDates = []; saveSync(); }
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
export async function deleteAccount() {
  const r = await supabase.rpc('delete_my_account');
  if (r.error) return isMissingSchema(r.error) ? 'This needs the latest database update.' : errorText(r.error);
  state.sync = { ...state.sync, accountId: null, syncedKeys: [], syncedWeightDates: [], pendingDeletes: {}, pendingWeightDeletes: {} };
  saveSync();
  await supabase.auth.signOut();
  return '';
}
