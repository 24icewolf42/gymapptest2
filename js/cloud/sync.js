// Account and cloud sync. This phone stays the working copy; each upload first
// reads the cloud copy and merges, so two devices can't silently wipe each other.
import { supabase, SITE_URL, errorText, isMissingSchema } from './client.js';
import {
  state, localPlan, applyPlan, planBase, setPlanBase, setPlanTombstones, saveLogs, saveLastUsed, saveWeights, saveSync, saveBypass, saveTombstones,
  hasLocalData, clearLocalData, defangNewRoutines, markUntrusted, trustedSnapshot,
} from '../state.js';
import { mergePlans, planHashes, stableStringify, hashOf, defang, stringsOf, defangUnknown } from '../domain/plan.js';
import { mergeLogs, mergeProgress, mergeBypass, dailySummaries, sessionKey, sanitizeLogs } from '../domain/logs.js';
import { mergeWeights } from '../domain/weights.js';
import { emit, listen, writeText, readText, read, write, remove, KEYS } from '../core/store.js';
import { makeBackup } from '../domain/backup.js';
import { ymd, addDays } from '../core/dates.js';

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

let accountSwitchHandler = async () => 'cancel';
/**
 * UI hook: decides what happens to this phone's data when an account signs in
 * that it did not come from. Gets { email, first } (first: the phone never had
 * an account). Returns 'replace' | 'merge' | 'cancel' ('replace' only if not first).
 */
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

/** Stops the syncs on their way (e.g. before a restore), so none marks the new data as checked. */
export function stopSyncs() {
  retire();
}

let starting = null;
function beginSession(user) {
  retire();
  account.ready = false;
  starting = startSession(user).finally(() => {
    starting = null;
    // Another account signed in while this one was starting (e.g. during its question): start that one now.
    if (account.user && !account.ready && account.user.id !== user.id) beginSession(account.user);
  });
}

async function handleAuth(event, session) {
  if (event === 'PASSWORD_RECOVERY') emit('gym:password-recovery');
  const user = session?.user || null;
  if (!user) {
    if (account.user) retire();
    // However the session ended (here, elsewhere, expired, even while the app
    // was closed): what is on or added to this phone from now on may be
    // someone else's.
    if ((account.user || state.sync.accountId) && !(state.sync.untrusted?.plan && state.sync.untrusted?.data)) markUntrusted({ snapshot: true });
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
  if (changed && !starting) beginSession(user);
  else emit('gym:account');
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

// Set when the user signs in through the app's own form, which is their own
// decision to back up this phone's data in that account. Stored, so the app's
// other open tabs (which hear about the sign-in too) don't ask again.
const FORM_SIGN_IN_MS = 2 * 60 * 1000;
let signedInHere = 0; // this tab's own form sign-in
let beat = null;
// From the form sign-in until its session has started (or the question it
// asks is answered), this tab says every few seconds that it is handling the
// sign-in, so the other tabs wait for it instead of asking too.
const markFormSignIn = () => {
  signedInHere = Date.now();
  writeText(KEYS.formSignIn, String(signedInHere));
  clearInterval(beat);
  // Beats until the session has started or the sign-in failed (however long the question stays open).
  const pulse = () => writeText(KEYS.asking, String(Date.now()));
  pulse();
  beat = setInterval(pulse, ASK_BEAT_MS);
};
const stopBeat = () => { clearInterval(beat); beat = null; remove(KEYS.asking); };
const signInFailed = () => { signedInHere = 0; remove(KEYS.formSignIn); stopBeat(); };

async function startSession(user) {
  // Re-read: another tab may already have answered for this account.
  const owner = (read(KEYS.sync, {}) || {}).accountId ?? state.sync.accountId;
  const formAt = Number(readText(KEYS.formSignIn)) || 0;
  if (!owner && hasLocalData() && Date.now() - formAt > FORM_SIGN_IN_MS) {
    // Signed in some other way (e.g. a link): ask before the data goes to that account.
    const choice = await accountSwitchHandler({ email: user.email || '', first: true });
    if (account.user?.id !== user.id) return;
    if (answeredElsewhere(user)) return finishStart(user);
    if (choice !== 'merge') { await endSession(); return; }
  }
  if (!owner && hasLocalData()) {
    markUntrusted(); // data no account owned joins this one
    state.sync.joinedSessions = Object.entries(state.logs).flatMap(([d, list]) => list.map((x) => sessionKey(d, x)));
    // Deletions and edit times made before (maybe by someone else) must not act on the account's plan.
    setPlanTombstones([], []);
    write(KEYS.planTimes, {});
  } else if (owner && owner !== user.id && hasLocalData()) {
    // Another tab of the app is signing in through its form: that tab asks;
    // this one waits for its answer instead of opening the question too.
    if (Date.now() - formAt < FORM_SIGN_IN_MS && Date.now() - signedInHere > FORM_SIGN_IN_MS && otherTabAsking()) {
      setStatus('Finish signing in in the other window.');
      const answered = await waitForOtherTab(user);
      if (account.user?.id !== user.id) return;
      if (answered) return finishStart(user);
    }
    const choice = await accountSwitchHandler({ email: user.email || '', first: false, deleted: String(owner).startsWith('deleted:') });
    if (account.user?.id !== user.id) return;
    // Another tab answered the same question meanwhile: its answer stands.
    if (answeredElsewhere(user)) return finishStart(user);
    if (choice === 'cancel') { await endSession(); return; }
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
      markUntrusted(); // another account's data joins this one
      // These weigh-ins are new to this account: a weigh-in it once deleted on
      // the same day must not drop them (a weigh-in it has there still counts).
      state.sync.mergedWeightDates = state.weights.map((x) => x.date);
      state.sync.mergedSessions = Object.entries(state.logs).flatMap(([d, list]) => list.map((x) => sessionKey(d, x)));
    }
  } else if (owner && owner !== user.id) {
    resetAccountBookkeeping();
  }
  return finishStart(user);
}

// The tab showing the account question says so every few seconds, so other
// tabs wait only while it really is asking (not after it was reloaded or closed).
const ASK_BEAT_MS = 3000;
const otherTabAsking = () => Date.now() - (Number(readText(KEYS.asking)) || 0) < ASK_BEAT_MS * 3;

/** Resolves true once another tab answered for this account, false if it signed out or stopped asking. */
function waitForOtherTab(user) {
  return new Promise((resolve) => {
    const done = (v) => { window.removeEventListener('storage', check); clearInterval(timer); resolve(v); };
    const check = () => {
      if (answeredElsewhere(user)) done(true);
      else if (account.user?.id !== user.id || !otherTabAsking()) done(false);
    };
    window.addEventListener('storage', check);
    const timer = setInterval(check, ASK_BEAT_MS);
    check();
  });
}

/** True when another tab of the app already settled this phone's data for this account. */
export function answeredElsewhere(user) {
  return (read(KEYS.sync, {}) || {}).accountId === user?.id;
}

async function finishStart(user) {
  stopBeat();
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
  // The requested username was taken at sign-up, so the account got a random
  // one. Asked once, in the tab where the user just signed in, never on a
  // later start (the name can always be changed in Settings).
  const wanted = String(account.user.user_metadata?.username || '').toLowerCase();
  const justSignedIn = Date.now() - signedInHere < FORM_SIGN_IN_MS;
  if (justSignedIn && readText(KEYS.usernameAsked) !== uid && account.profile && wanted && account.profile.username !== wanted && /^user_[0-9a-f]{8}$/.test(account.profile.username)) {
    writeText(KEYS.usernameAsked, uid);
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

/**
 * Workouts and last-used values from another person's use of this phone that
 * the account does not have yet: markup in their names is defused (the
 * original app shows them unescaped). What the account already has stays.
 */
// Both areas synced after a distrusted phase: the snapshot is no longer needed.
function settleTrust() {
  if (!state.sync.untrusted?.plan && !state.sync.untrusted?.data) remove(KEYS.trustedSnapshot);
  saveSync();
}

let lastRemoteWorkouts = null; // the account's routines, from the plan sync that runs first

function defangNewSessions(remote) {
  // Only workouts exactly as the account has them are trusted; a changed copy is defused.
  const theirs = new Map();
  const remoteLogs = sanitizeLogs(remote.logs || {});
  Object.entries(remoteLogs).forEach(([d, list]) => list.forEach((x) => theirs.set(sessionKey(d, x), stableStringify(x))));
  // Text the account already shows (workout and exercise names, targets,
  // weights, lifts) is the user's own and stays; ids and times are not text
  // anyone sees, and can be seeded, so they never count as known.
  const snap = trustedSnapshot();
  const known = new Set();
  // The account's routines (names, exercises) are its text too.
  stringsOf(lastRemoteWorkouts || {}, known);
  Object.values(remoteLogs).forEach((list) => list.forEach((x) => {
    known.add(x.day);
    x.exercises.forEach((e) => { known.add(e.name); known.add(e.target); e.sets.forEach((st) => { known.add(st.w); known.add(st.r); }); });
  }));
  stringsOf(remote.progress || {}, known);
  // Workouts the account deleted are left alone: the merge removes them under their own key.
  const gone = new Set(Array.isArray(remote.deleted_sessions) ? remote.deleted_sessions : []);
  const fix = (s) => (known.has(s) ? s : defang(s));
  let changed = false;
  Object.keys(state.logs).forEach((d) => {
    state.logs[d] = state.logs[d].map((x) => {
      const k = sessionKey(d, x);
      if (gone.has(k) || theirs.get(k) === stableStringify(x) || snap.sessions?.[k] === hashOf(x)) return x;
      const clean = { ...x, day: fix(x.day), exercises: x.exercises.map((e) => ({ ...e, name: fix(e.name), target: fix(e.target || ''), sets: e.sets.map((s) => ({ ...s, w: fix(s.w), r: fix(s.r) })) })) };
      if (JSON.stringify(clean) !== JSON.stringify(x)) changed = true;
      return clean;
    });
  });
  if (changed) saveLogs({ silent: true });
  const theirLifts = remote.progress || {};
  const lifts = {};
  let liftsChanged = false;
  Object.entries(state.lastUsed).forEach(([k, v]) => {
    const same = (Object.hasOwn(theirLifts, k) && stableStringify(theirLifts[k]) === stableStringify(v)) || snap.lifts?.[k] === hashOf(v);
    const key = same || Object.hasOwn(theirLifts, k) || known.has(k) ? k : defang(k);
    const value = same ? v : defangUnknown(v, known);
    if (key !== k || stableStringify(value) !== stableStringify(v)) liftsChanged = true;
    lifts[key] = value;
  });
  if (liftsChanged) { state.lastUsed = lifts; saveLastUsed({ silent: true }); }
}

// Postgres reorders JSON keys, so compare with sorted keys.
const same = (a, b) => stableStringify(a) === stableStringify(b);
const MAX_ATTEMPTS = 3;
const WEIGHT_BATCH = 200; // the server takes up to 400 weigh-ins per call
const WEIGHT_PAGE = 1000; // PostgREST's default max_rows

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
      // Routines from another person's use of this phone, new to this account: defuse markup.
      lastRemoteWorkouts = r.data?.plan?.workouts || {};
      const renames = state.sync.untrusted?.plan ? defangNewRoutines(r.data?.plan) : null;
      if (renames) { emit('gym:routines-renamed', renames); emit('gym:plan-updated'); }
      // No cloud plan (first sync, or the row was removed): there is no common base.
      const merged = mergePlans(r.data?.plan, localPlan(), r.data ? planBase() : null);
      const local = localPlan();
      if (!same(merged.workouts, local.workouts) || !same(merged.schedule, local.schedule) || merged.restImage !== local.restImage) applyPlan(merged);
      const done = r.data && same(r.data.plan, merged);
      const wrote = done || await casWrite('workout_plans', uid, r.data?.updated_at ?? null, { user_id: uid, plan: merged, updated_at: new Date().toISOString() });
      if (stale()) return false;
      if (wrote) {
        setPlanBase(planHashes(merged));
        if (state.sync.untrusted?.plan) { state.sync.untrusted = { ...state.sync.untrusted, plan: false }; settleTrust(); }
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
      // Sessions brought back from a backup, or added from another account's
      // phone, must not be removed by this account's deletions: a deleted key
      // gets a new id (derived from the old one, so restoring twice gives one
      // copy), and a session on a day cleared after it (the original app's
      // delete) gets the current time, so both apps keep it.
      const restored = new Set([...(state.sync.restoredSessions || []), ...(state.sync.mergedSessions || [])]);
      // Sessions joining with data that belonged to no account: a day the
      // account cleared later must not delete what it never saw (a deleted
      // key, though, means the account saw it and deleted it).
      const joined = new Set(state.sync.joinedSessions || []);
      if (restored.size || joined.size) {
        const gone = new Set(Array.isArray(remote.deleted_sessions) ? remote.deleted_sessions : []);
        const cleared = remote.deleted_dates || {};
        let rekeyed = false;
        Object.keys(state.logs).forEach((d) => {
          state.logs[d] = state.logs[d].map((x) => {
            const k = sessionKey(d, x);
            if (!restored.has(k) && !joined.has(k)) return x;
            const clearedAt = Number(cleared[d]) || Date.parse(cleared[d]) || 0;
            const hidden = clearedAt && clearedAt >= (Date.parse(x.time) || 0);
            if (!restored.has(k) && (gone.has(k) || !hidden)) return x; // joined: only the cleared-day case
            if (!gone.has(k) && !hidden) return x;
            let id = k;
            do { id = 'r' + hashOf(id).replace(':', ''); } while (gone.has(id));
            rekeyed = true;
            return { ...x, id, ...(hidden ? { time: new Date().toISOString() } : {}) };
          });
        });
        if (rekeyed) saveLogs({ silent: true });
      }
      // After the step above (it matches sessions by their original keys).
      if (state.sync.untrusted?.data) defangNewSessions(remote);

      const deleted = [...new Set([...state.deletedSessions, ...(Array.isArray(remote.deleted_sessions) ? remote.deleted_sessions : [])])];
      // A day can only have been cleared in the past: a time in the future
      // (a bad clock or a crafted file) would delete everything logged there.
      const latest = Date.now() + 24 * 3600 * 1000;
      const when = (v) => Number(v) || Date.parse(v) || 0;
      const deletedDates = {};
      [remote.deleted_dates || {}, state.deletedDates].forEach((src) => Object.keys(src).forEach((d) => {
        const t = when(src[d]);
        if (t && t <= latest) deletedDates[d] = Math.max(deletedDates[d] || 0, t);
      }));
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
        if ((restored.size || joined.size) && !stale()) { state.sync.restoredSessions = []; state.sync.mergedSessions = []; state.sync.joinedSessions = []; saveSync(); }
        if (state.sync.untrusted?.data && !stale()) { state.sync.untrusted = { ...state.sync.untrusted, data: false }; settleTrust(); }
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
    // The server returns at most 1000 rows per request: read page by page, or
    // rows beyond the first page would look deleted.
    let withStamp = true;
    const r = { data: [], error: null };
    // Read until an empty page, so a server with a lower row limit can't cut the list short.
    for (let from = 0; ;) {
      const page = (cols) => supabase.from('body_weight_logs').select(cols).eq('user_id', uid).order('log_date').range(from, from + WEIGHT_PAGE - 1);
      let p = await page(withStamp ? 'log_date,weight_kg,updated_at' : 'log_date,weight_kg');
      if (withStamp && isMissingSchema(p.error)) { withStamp = false; p = await page('log_date,weight_kg'); }
      if (stale()) return false;
      if (p.error) throw p.error;
      if (!p.data?.length) break;
      r.data.push(...p.data);
      from += p.data.length;
    }
    const dirty = new Set(state.sync.dirtyWeightDates);
    const merged = mergeWeights(r.data, state.weights, state.sync.syncedWeightDates, [...dirty]);
    if (!same(merged, state.weights)) { state.weights = merged; saveWeights({ silent: true }); }
    const remote = new Map((r.data || []).map((x) => [x.log_date, Number(x.weight_kg)]));
    // Dates the server refuses (a phone clock far off) stay on the phone only.
    const latest = ymd(addDays(new Date(), 2));
    const changed = merged.filter((x) => x.date >= '1900-01-01' && x.date <= latest && (dirty.has(x.date) || remote.get(x.date) !== x.weight));
    const mergedIn = new Set(state.sync.mergedWeightDates || []);
    const fresh = (x) => dirty.has(x.date) || (mergedIn.has(x.date) && !remote.has(x.date));
    // Server stamps of what was written; entries the server refused because
    // they were deleted elsewhere go from the phone too; entries with a date
    // the server doesn't accept (phone clock off) stay here.
    const saved = new Map(), refused = new Set();
    let rpc = true;
    for (let i = 0; i < changed.length; i += WEIGHT_BATCH) {
      const batch = changed.slice(i, i + WEIGHT_BATCH);
      if (rpc) {
        // Server time decides; only entries changed here may override a deletion made elsewhere.
        const up = await supabase.rpc('save_my_weights', {
          entries: batch.map((x) => ({ log_date: x.date, weight_kg: x.weight, fresh: fresh(x), ...(x.updatedAt ? { updated_at: new Date(x.updatedAt).toISOString() } : {}) })),
        });
        if (stale()) return false;
        if (!isMissingSchema(up.error)) {
          if (up.error) throw up.error;
          (up.data || []).forEach((row) => {
            if (row.outcome === 'saved') saved.set(row.log_date, Date.parse(row.updated_at) || 0);
            else if (row.outcome === 'deleted') refused.add(row.log_date);
          });
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
      const answered = (d) => saved.has(d) || refused.has(d);
      const settled = new Set(changed.filter((x) => answered(x.date) && (!current.has(x.date) || untouched(current.get(x.date)))).map((x) => x.date));
      state.weights = state.weights
        .filter((x) => !untouched(x) || !refused.has(x.date))
        .map((x) => (untouched(x) && saved.get(x.date) ? { ...x, updatedAt: saved.get(x.date) } : x));
      state.sync.dirtyWeightDates = state.sync.dirtyWeightDates.filter((d) => !settled.has(d));
      saveWeights({ silent: true });
    }
    // Synced means: in the cloud now. Only those can later be "deleted elsewhere".
    const inCloud = new Set([...remote.keys(), ...saved.keys()]);
    state.sync.syncedWeightDates = state.weights.filter((x) => inCloud.has(x.date) && !state.sync.dirtyWeightDates.includes(x.date)).map((x) => x.date);
    state.sync.mergedWeightDates = [];
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
  markFormSignIn();
  const r = await supabase.auth.signInWithPassword({ email, password });
  if (r.error) signInFailed();
  return r.error ? errorText(r.error) : '';
}

export async function signUp(email, password, username) {
  // The age/permission confirmation is recorded with the account.
  const data = { username, age_confirmed: 'true' };
  markFormSignIn();
  const r = await supabase.auth.signUp({ email, password, options: { data, emailRedirectTo: SITE_URL } });
  if (r.error || !r.data.session) signInFailed(); // not signed in (yet)
  if (r.error) return errorText(r.error);
  return r.data.session ? '' : 'confirm-email';
}

export async function resetPassword(email) {
  const r = await supabase.auth.resetPasswordForEmail(email, { redirectTo: SITE_URL });
  return r.error ? errorText(r.error) : '';
}

/** Signs in with the code from a password-reset email; PASSWORD_RECOVERY then asks for a new password. */
export async function verifyRecoveryCode(email, token) {
  markFormSignIn();
  const r = await supabase.auth.verifyOtp({ email, token, type: 'recovery' });
  if (r.error) signInFailed();
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
export async function signOut({ removeLocalData = false, force = false, everywhere = false } = {}) {
  let synced = true;
  if (account.user && account.ready) synced = await syncAll();
  if (removeLocalData && !synced && !force) return 'not-synced';
  account.ready = false;
  retire(); // a sync still in flight must not write the account's data back
  const ended = await endSession(everywhere);
  if (everywhere && !ended) return 'everywhere-failed';
  if (removeLocalData) clearLocalData();
  else {
    // Whatever is added to this phone from now on may be someone else's:
    // at the next sign-in, what changed since now and is new to the account gets defused.
    markUntrusted({ snapshot: true });
  }
  return '';
}

/**
 * Signs out for sure. supabase-js keeps the stored session when the sign-out
 * fails (e.g. offline with an expired token), which would sign the account in
 * again at the next start; then the session is removed here instead.
 */
async function endSession(everywhere = false) {
  stopBeat();
  // This device only, unless the user asks to end every session (e.g. a lost phone).
  const r = await supabase.auth.signOut({ scope: everywhere ? 'global' : 'local' }).catch((error) => ({ error }));
  if (!r?.error) return true;
  const key = supabase.auth.storageKey;
  [key, key + '-code-verifier', key + '-user'].forEach((k) => localStorage.removeItem(k));
  await handleAuth('SIGNED_OUT', null);
  return false;
}

export async function changeUsername(name) {
  const username = String(name || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return 'Use 3–20 letters, numbers or _.';
  let r = await supabase.rpc('change_username', { name: username });
  if (isMissingSchema(r.error)) {
    // Older database: plain update.
    r = await supabase.from('profiles').update({ username }).eq('id', account.user.id).select('id').single();
    if (r.error) return r.error.code === '23505' ? 'That username is taken.' : errorText(r.error);
  } else if (r.error) return errorText(r.error);
  else if (r.data === 'taken') return 'That username is taken.';
  else if (r.data !== 'ok') return 'Use 3–20 letters, numbers or _.';
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
  await endSession();
  if (removeLocalData) clearLocalData();
  return '';
}
