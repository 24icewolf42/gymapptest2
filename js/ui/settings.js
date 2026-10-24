// Settings: account, privacy, training options, rest-day image, backup, about.
import { $, html, raw, render, on, toast, toastLater, busyAttr } from '../core/dom.js';
import { listen, readText, write, KEYS } from '../core/store.js';
import { pushLayer, go, currentPage } from '../core/router.js';
import { state, saveSettings, restImage, setRestImage, loadState, planTombstones, setPlanTombstones } from '../state.js';
import { makeBackup, parseBackup, BACKUP_KEYS } from '../domain/backup.js';
import { sessionKey } from '../domain/logs.js';
import { cloudConfigured } from '../cloud/client.js';
import {
  account, signIn, signUp, resetPassword, verifyRecoveryCode, updatePassword, signOut, changeUsername, setShareWeight,
  deleteAccount, syncAll, stopSyncs,
} from '../cloud/sync.js';
import { loadBlocks, unblock } from '../cloud/social.js';
import { openSheet, confirmDialog, promptDialog, markBusy } from './sheet.js';
import { icons } from './icons.js';
import { APP_VERSION } from '../version.js';
import { updateOffer } from '../native.js';

const MIN_AGE = 14;

let authMode = 'signin';
let previousPage = 'today';
let closeLayer = null;
let busy = false;
let blocks = null; // [{ blocked_id, username }] once loaded, or { error }
let blocksFor = null;
let signingOut = false;
let authError = ''; // kept in state so a background re-render does not wipe it
let deleting = false;
let savingWeight = false;
let retryingBlocks = false;
let applyingUpdate = false;
const unblocking = new Set(); // blocked ids with a request in flight

export function openSettings() {
  if (currentPage() === 'settings') return;
  previousPage = currentPage();
  go('settings');
  closeLayer = pushLayer(() => { closeLayer = null; leaveSettings(); });
}

function closeSettings() {
  if (closeLayer) { const c = closeLayer; closeLayer = null; c(); }
  leaveSettings();
}

// Back where the user came from, on the settings button they used.
function leaveSettings() {
  const wasHere = $('page-settings').contains(document.activeElement);
  go(previousPage);
  if (wasHere) document.querySelector('.page.active [data-open-settings]')?.focus({ preventScroll: true });
}

const PRIVACY = html`
  <p class="sheet-text">Tracker works without an account: everything then stays on this phone.</p>
  <h3>With an account</h3>
  <ul class="plain">
    <li>We store your email address (to sign in) and your username.</li>
    <li>Your plan, workouts (with each set), last-used weights, bypass days and weigh-ins sync to your account so you can use several devices. Only you can read them.</li>
  </ul>
  <h3>What friends see</h3>
  <ul class="plain">
    <li>Only people whose friend request you accepted. Nobody can browse the list of users.</li>
    <li>Your username.</li>
    <li>Gym dates you post for them.</li>
    <li>When you reply to a gym date or check in there: the host and every friend of yours who can see that date see your answer and check-in by name. People who are not your friends only see a count.</li>
    <li>Stats, only if you share them: number of workouts, total kg × reps, training time, current and best streak, and how many routines and exercises your plan has. The totals update after each synced workout, so friends can tell when you trained and for how long.</li>
    <li>Routines you choose to share (they can copy them).</li>
    <li>Your latest weight, only if you turn that on. Never your weight history.</li>
  </ul>
  <h3>Your choices</h3>
  <ul class="plain">
    <li>Remove or block friends at any time.</li>
    <li>Delete your account in Settings: your account, everything stored for it and the sign-in records with your email address are deleted.</li>
  </ul>
  <p class="sheet-text">You need to be ${MIN_AGE} or older to create an account, or have a parent's or guardian's permission.</p>`;

function showPrivacy() {
  return openSheet({ title: 'Privacy', body: PRIVACY, actions: [{ label: 'Close', value: true, tone: 'secondary' }] });
}

function accountCard() {
  if (!cloudConfigured()) return html`<section class="card"><h2>Account</h2><p class="muted">Accounts are not available in this version of the app.</p></section>`;
  if (!account.user) {
    const signup = authMode === 'signup';
    return html`<form class="card auth" id="authForm" novalidate>
      <div class="segmented small" role="tablist" aria-label="Account">
        <button type="button" role="tab" id="auth-tab-signin" aria-controls="authPanel" aria-selected="${!signup ? 'true' : 'false'}" tabindex="${!signup ? '0' : '-1'}" data-auth-mode="signin">Sign in</button>
        <button type="button" role="tab" id="auth-tab-signup" aria-controls="authPanel" aria-selected="${signup ? 'true' : 'false'}" tabindex="${signup ? '0' : '-1'}" data-auth-mode="signup">Create account</button>
      </div>
      <div id="authPanel" role="tabpanel" aria-labelledby="auth-tab-${authMode}">
      <p class="muted small">${signup ? 'Back up your workouts, use several devices, add friends and plan gym dates together.' : 'Welcome back. Signing in syncs the workouts on this phone with your account.'}</p>
      <label class="field"><span>Email</span><input class="input" name="email" type="email" autocomplete="email" inputmode="email" required></label>
      <label class="field"><span>Password</span><input class="input" name="password" type="password" minlength="8" autocomplete="${signup ? 'new-password' : 'current-password'}" ${signup ? html` placeholder="At least 8 characters"` : ''} required></label>
      ${signup ? html`<div class="field"><label for="authUsername">Username</label><div class="input-row"><span class="input-prefix" aria-hidden="true">@</span><input class="input" id="authUsername" name="username" autocomplete="nickname" autocapitalize="none" spellcheck="false" maxlength="20" placeholder="3–20 letters, numbers or _"></div></div>
        <p class="hint">Friends find you by your exact username. Don’t use your real full name.</p>
        <label class="check-row consent"><input type="checkbox" name="consent"> <span>I am ${MIN_AGE} or older, or a parent or guardian agreed, and I have read the <button type="button" class="link-btn inline" data-privacy>privacy notice</button>.</span></label>` : ''}
      <p class="form-error" aria-live="polite">${authError}</p>
      <button class="btn btn-primary btn-block" type="submit"${busyAttr(busy)}>${busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}</button>
      ${signup ? '' : html`<button type="button" class="link-btn" data-forgot>Forgot password?</button>`}
      </div>
    </form>`;
  }
  const p = account.profile;
  return html`<section class="card">
    <header class="card-head"><div><h2>@${p?.username || '…'}</h2><small class="muted">${account.user.email}</small></div>
      <button type="button" class="btn btn-soft btn-sm" data-change-username aria-label="Change username">Change</button></header>
    <p class="status ${account.statusTone}">${account.status}</p>
    <div class="btn-row">
      <button type="button" class="btn btn-soft" data-sync>Sync now</button>
      <button type="button" class="btn btn-soft" data-change-password>Change password</button>
      <button type="button" class="btn btn-ghost" data-signout${busyAttr(signingOut)}>${signingOut ? 'Syncing…' : 'Sign out'}</button>
    </div>
  </section>
  <section class="card">
    <h2>Privacy</h2>
    <label class="toggle row-toggle"><input type="checkbox" data-share-weight${p?.share_weight ? ' checked' : ''}${busyAttr(savingWeight || !(p && 'share_weight' in p))}>
      <span><b>Show my weight to friends</b><small>Friends see only your latest weigh-in, never the full history.</small></span></label>
    <p class="muted small">Friends see your username, gym dates you share with them, your replies and check-ins at gym dates they can see, and stats or routines you choose to share. Your workout history syncs only to your own account. <button type="button" class="link-btn inline" data-privacy>Read the privacy notice</button></p>
    <h3 class="sub">Blocked people</h3>
    ${blocks == null ? html`<p class="muted small">Loading…</p>` : blocks.error || retryingBlocks ? html`<p class="notice error" data-key="blocks-error">${blocks.error || 'Loading…'} <button type="button" class="link-btn inline" data-retry-blocks${busyAttr(retryingBlocks)}>${retryingBlocks ? 'Trying…' : 'Try again'}</button></p>` : blocks.length ? html`<div class="list">${blocks.map((b) => html`
      <div class="row" data-key="block-${b.blocked_id}"><div class="row-main"><b>@${b.username}</b></div>
        <button type="button" class="btn btn-ghost btn-sm" data-unblock="${b.blocked_id}"${busyAttr(unblocking.has(b.blocked_id))} aria-label="Unblock ${b.username}">Unblock</button></div>`)}</div>`
      : html`<p class="muted small">Nobody. You can block someone from the Crew tab.</p>`}
  </section>`;
}

function trainingCard() {
  const steps = [[0, 'Exact'], [0.5, '0.5 kg'], [1, '1 kg'], [2.5, '2.5 kg'], [5, '5 kg']];
  return html`<section class="card" data-key="training">
    <h2>Training</h2>
    <div class="field"><span id="stepLabel">Round weights to</span>
      <div class="chips wrap" role="radiogroup" aria-labelledby="stepLabel">${steps.map(([v, l]) => html`<button type="button" class="chip${state.settings.weightStep === v ? ' on' : ''}" role="radio" aria-checked="${state.settings.weightStep === v ? 'true' : 'false'}" tabindex="${state.settings.weightStep === v ? '0' : '-1'}" data-step="${v}">${l}</button>`)}</div>
      <p class="hint">Match the smallest plates or dumbbell steps at your gym.</p></div>
    <div class="field"><span>Rest-day picture</span>
      <div class="rest-pick"><img src="${restImage()}" alt="Current rest-day picture">
        <div class="btn-col"><button type="button" class="btn btn-soft btn-sm" data-pick-image>${icons.image} Choose</button>
        <button type="button" class="btn btn-ghost btn-sm" data-reset-image>Reset</button></div></div>
      <input type="file" id="restFile" accept="image/*" hidden></div>
  </section>`;
}

function backupCard() {
  const switched = !!readText(KEYS.switchBackup);
  return html`<section class="card" data-key="backup">
    <h2>Backup</h2>
    <p class="muted small">Everything on this phone: workouts, plan, weigh-ins and settings.</p>
    <div class="btn-row">
      <button type="button" class="btn btn-soft" data-backup-file>${icons.download} Save file</button>
      <button type="button" class="btn btn-soft" data-backup-copy>${icons.copy} Copy</button>
      <button type="button" class="btn btn-soft" data-restore>${icons.upload} Restore</button>
    </div>
    ${switched ? html`<p class="hint">This phone kept a copy of the data from before another account signed in. <button type="button" class="link-btn inline" data-switch-backup>Save it as a file</button></p>` : ''}
    <input type="file" id="restoreFile" accept="application/json,.json,.txt" hidden>
  </section>`;
}

function dangerCard() {
  if (!account.user) return '';
  return html`<section class="card danger-zone" data-key="danger">
    <h2>Delete account</h2>
    <p class="muted small">Deletes your account, friends, gym dates, everything synced to the cloud and the sign-in records with your email address.</p>
    <button type="button" class="btn btn-danger" data-delete-account${busyAttr(deleting)}>${deleting ? 'Deleting…' : 'Delete my account'}</button>
  </section>`;
}

function setAuthError(message) {
  authError = message;
  renderSettings();
}

export function renderSettings() {
  const accountKey = document.activeElement?.closest?.('#page-settings [data-key^="account-"], #page-settings [data-key="danger"]')?.dataset.key;
  render($('page-settings'), html`
    <header class="top editor-top" data-view="settings">
      <button type="button" class="icon-btn" data-close-settings aria-label="Back">${icons.back}</button>
      <div class="grow"><p class="eyebrow">Tracker v${APP_VERSION}</p><h1 class="h1-sm">Settings</h1></div></header>
    <div data-key="account-${account.user ? 'in' : 'out'}">${accountCard()}</div>
    ${trainingCard()}
    ${backupCard()}
    ${dangerCard()}
    ${updateOffer() ? html`<div class="notice update-notice" data-key="update"><b${updateOffer().reinstall ? raw(' tabindex="-1"') : ''}>${updateOffer().title}</b>
      ${updateOffer().reinstall ? html`<p class="small">This update is signed with a different key than the app on this phone (for example a test build), so Android can't install it over it.</p>
        <ol class="plain small"><li>Settings → Backup → Save file (or, if you are signed in, check that your account says “Synced”).</li><li>Uninstall Tracker.</li><li>Install the new version from the download page, then restore or sign in.</li></ol>` : ''}
      <button type="button" class="btn btn-primary btn-sm" data-apply-update${busyAttr(applyingUpdate)}>${applyingUpdate ? 'Working…' : updateOffer().action}</button></div>` : ''}
    <p class="about muted small" data-key="about"><button type="button" class="link-btn inline" data-privacy>Privacy</button> · <button type="button" class="link-btn inline" data-check-update>Check for updates</button></p>`);
  // Signed in or out from within the account card: focus its new heading.
  const card = $('page-settings').querySelector('[data-key^="account-"]');
  if (accountKey && card && card.dataset.key !== accountKey) {
    const h = card.querySelector('h2') || card.querySelector('[role=tab][tabindex="0"]');
    if (h) { if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }
}

async function refreshBlocks() {
  if (!account.user || !account.ready) { blocks = null; return; }
  const forUser = account.user.id;
  const r = await loadBlocks();
  if (account.user?.id !== forUser) return; // signed out or switched meanwhile
  blocks = r.error ? { error: r.error } : r.data;
  blocksFor = forUser;
  if (currentPage() === 'settings') renderSettings();
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, 1000 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function backupText() {
  return makeBackup((k) => localStorage.getItem(k), APP_VERSION);
}

function download(text, name) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function restoreFrom(text) {
  if (!String(text || '').trim()) { toast('Paste the backup text first.', { tone: 'error' }); return; }
  let data;
  try { data = parseBackup(text); } catch (e) { toast(e.message, { tone: 'error' }); return; }
  const ok = await confirmDialog(account.user
    ? 'Everything on this phone is replaced by the backup. At the next sync, your routines and week return to how they are in the backup (also if they were changed or deleted since), and workouts already in your account are merged back in.'
    : 'Everything on this phone is replaced by the backup.', { title: 'Restore this backup?', ok: 'Restore', danger: true });
  if (!ok) return;
  // A sync on its way would mark the restored data as checked when it lands.
  stopSyncs();
  // Replace everything: keys the backup does not have are removed, not kept.
  BACKUP_KEYS.forEach((k) => { if (!(k in data)) localStorage.removeItem(k); });
  Object.entries(data).forEach(([k, v]) => localStorage.setItem(k, v));
  // This phone's copy changed wholesale: forget what it last saw in the cloud.
  // Deletion records are not taken from a backup file (anyone could have
  // written it, and the account keeps its own).
  [KEYS.planBase, KEYS.drafts, KEYS.draft, KEYS.active, KEYS.deletedSessions, KEYS.deletedDates].forEach((k) => localStorage.removeItem(k));
  state.sync.syncedWeightDates = [];
  state.sync.pendingWeightDeletes = {};
  localStorage.setItem(KEYS.sync, JSON.stringify(state.sync));
  loadState();
  // What the backup holds comes back, also if it was deleted in the account since.
  state.sync.restoredSessions = Object.entries(state.logs).flatMap(([d, list]) => list.map((x) => sessionKey(d, x)));
  state.sync.dirtyWeightDates = state.weights.map((x) => x.date);
  // A backup file can come from anyone: what it adds to the account is defused at the next sync
  // (all of it: nothing restored counts as unchanged since a sign-out).
  state.sync.untrusted = { plan: true, data: true };
  localStorage.removeItem(KEYS.trustedSnapshot);
  localStorage.setItem(KEYS.sync, JSON.stringify(state.sync));
  // The backup's routines and week count as changed now, so they win over
  // deletions and edits made in the account since.
  const now = Date.now(), names = Object.keys(state.workouts);
  write(KEYS.planTimes, { workouts: Object.fromEntries(names.map((n) => [n, now])), schedule: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, now])), restImage: now });
  // Deletion records are not taken from a backup file either (the account keeps its own).
  const { restored } = planTombstones();
  setPlanTombstones([], [...new Set([...restored, ...names])]);
  toast('Backup restored.');
  setTimeout(() => location.reload(), 600);
}

async function forgotPassword() {
  // Each step waits for the server inside its own prompt ("Saving…"), so no
  // answer arrives later and opens something while the user is elsewhere.
  const email = await promptDialog({ title: 'Reset password', label: 'Your account email', type: 'email', value: $('authForm')?.email.value || '', ok: 'Send email', busy: 'Sending…', maxLength: 120, submit: resetPassword });
  if (!email) return;
  // The email has a link (opens the web app) and, if the project's email
  // template includes it, a code that works right here, e.g. in the Android app.
  const code = await promptDialog({
    title: 'Check your email',
    label: 'Code from the email',
    hint: 'Or tap the link in the email instead. It opens Tracker in your browser.',
    ok: 'Continue', busy: 'Checking…', maxLength: 10, type: 'text', input: { inputmode: 'numeric', autocomplete: 'one-time-code' },
    validate: (v) => (/^\d{6,10}$/.test(v) ? '' : 'Enter the code from the email.'),
    submit: (v) => verifyRecoveryCode(email, v),
  });
  if (!code) return;
  // On success the PASSWORD_RECOVERY event asks for the new password.
}

export function initSettings() {
  const page = $('page-settings');
  on(page, 'click', '[data-close-settings]', closeSettings);
  on(page, 'click', '[data-privacy]', (e) => { e.preventDefault(); showPrivacy(); });
  on(page, 'click', '[data-auth-mode]', (e, b) => { authMode = b.dataset.authMode; authError = ''; renderSettings(); $('auth-tab-' + authMode)?.focus({ preventScroll: true }); });
  on(page, 'click', '[data-retry-blocks]', async () => {
    const toast = toastLater();
    retryingBlocks = true;
    renderSettings();
    await refreshBlocks();
    // The notice stayed while retrying; move focus only if the user is still on it.
    const stayed = !!document.activeElement?.closest?.('[data-key="blocks-error"]');
    retryingBlocks = false;
    renderSettings();
    toast(blocks?.error || 'Loaded.', { tone: blocks?.error ? 'error' : 'default' });
    if (!blocks?.error && stayed) {
      const h = $('page-settings').querySelector('h3.sub');
      if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    }
  });
  on(page, 'submit', '#authForm', async (e) => {
    e.preventDefault();
    const f = e.target;
    authError = '';
    const email = f.email.value.trim(), password = f.password.value;
    const signup = authMode === 'signup';
    const username = signup ? f.username.value.trim().toLowerCase() : '';
    if (!/^\S+@\S+\.\S+$/.test(email)) { setAuthError('Enter a valid email address.'); return; }
    if (password.length < 8) { setAuthError('Use a password with at least 8 characters.'); return; }
    if (signup && !/^[a-z0-9_]{3,20}$/.test(username)) { setAuthError('Usernames have 3–20 letters, numbers or _.'); return; }
    if (signup && !f.consent.checked) { setAuthError(`Please confirm you are ${MIN_AGE} or older, or have a parent's permission.`); f.consent.focus(); return; }
    if (busy) return;
    const toast = toastLater();
    busy = true; renderSettings();
    const r = signup ? await signUp(email, password, username) : await signIn(email, password);
    busy = false;
    if (r === 'confirm-email') { toast('Account created. Check your email to confirm it, then sign in.', { ms: 6000 }); authMode = 'signin'; renderSettings(); return; }
    if (r) { setAuthError(r); return; }
    toast(signup ? 'Welcome! Your account is ready.' : 'Signed in. Syncing your workouts…');
    renderSettings();
  });
  on(page, 'click', '[data-forgot]', forgotPassword);
  // Background syncs update the status quietly; a sync the user asked for reports its result.
  on(page, 'click', '[data-sync]', async () => {
    const toast = toastLater();
    const ok = await syncAll();
    toast(ok ? 'Synced.' : account.status || 'Sync failed.', { tone: ok ? 'default' : 'error' });
  });
  // Each choice signs out inside the sheet ("Syncing…"), so its result and the
  // "Not synced yet" question come while the user is still in it, never later.
  const signOutStep = (choice) => async (finish, sheet, button) => {
    if (signingOut) return;
    signingOut = true; renderSettings();
    let done = markBusy(sheet, button, 'Syncing…');
    try {
      const r = await signOut({ removeLocalData: choice === 'remove', everywhere: choice === 'everywhere' });
      if (r !== 'not-synced') { finish(r === 'everywhere-failed' ? r : r === 'unsynced' ? 'out-unsynced' : 'out'); return; }
      done(); done = null;
      const next = await openSheet({
        title: 'Not synced yet',
        body: html`<p class="sheet-text">Some workouts on this phone have not reached your account yet (no connection?). If you remove the data now, they are lost.</p>`,
        actions: [
          { label: 'Sign out, keep data here', value: 'keep', tone: 'primary' },
          { label: 'Remove anyway', value: 'remove', tone: 'danger' },
          { label: 'Stay signed in', value: null, tone: 'ghost' },
        ],
      });
      if (!next) { finish('stayed'); return; }
      done = markBusy(sheet, button, 'Signing out…');
      await signOut({ removeLocalData: next === 'remove', force: true });
      finish(next === 'remove' ? 'removed' : 'kept');
    } finally {
      done?.();
      signingOut = false; renderSettings();
    }
  };
  on(page, 'click', '[data-signout]', async () => {
    if (signingOut) return;
    const result = await openSheet({
      title: 'Sign out?',
      body: html`<p class="sheet-text">If someone else uses this phone, remove your workouts from it. They stay in your account. Signing out here keeps your other devices signed in; if one was lost or shared, sign out everywhere.</p>`,
      actions: [
        { label: 'Sign out, keep data here', tone: 'secondary', onClick: signOutStep('keep') },
        { label: 'Sign out and remove my data', tone: 'danger', onClick: signOutStep('remove') },
        { label: 'Sign out on all devices', tone: 'secondary', onClick: signOutStep('everywhere') },
        { label: 'Cancel', value: null, tone: 'ghost' },
      ],
    });
    const messages = {
      out: 'Signed out.',
      'out-unsynced': 'Signed out. Your latest changes had not reached your account yet (no connection?); they stay on this phone.',
      removed: 'Signed out and removed from this phone.',
      kept: 'Signed out. Your data stays on this phone.',
      stayed: 'You are still signed in. Nothing was removed.',
    };
    if (result === 'everywhere-failed') toast('Signed out here, but your other devices could not be signed out (no connection?). Try again online, or change your password.', { tone: 'error' });
    else if (messages[result]) toast(messages[result]);
  });
  on(page, 'click', '[data-change-password]', async () => {
    const pw = await promptDialog({ title: 'Change password', label: 'New password', type: 'password', maxLength: 72, ok: 'Save password', input: { autocomplete: 'new-password' }, trim: false, validate: (v) => (v.length >= 8 ? '' : 'Use at least 8 characters.'), submit: updatePassword });
    if (pw) toast('Password changed.');
  });
  on(page, 'click', '[data-change-username]', async () => {
    const name = await promptDialog({ title: 'Change username', label: 'Username', value: account.profile?.username || '', maxLength: 20, hint: 'Friends find you by this exact name.', validate: (v) => (/^[a-z0-9_]{3,20}$/.test(v.toLowerCase()) ? '' : 'Use 3–20 letters, numbers or _.'), submit: changeUsername });
    if (name) toast(`Username changed to @${name.toLowerCase()}.`);
  });
  // Busy controls stay focusable (aria-disabled); on() cancels the click that would toggle one.
  on(page, 'click', '[data-share-weight]', () => {});
  on(page, 'change', '[data-share-weight]', async (e, input) => {
    const toast = toastLater();
    const want = input.checked;
    savingWeight = true;
    renderSettings();
    const r = await setShareWeight(want);
    savingWeight = false;
    if (r) { input.checked = !want; toast(r, { tone: 'error' }); }
    else toast(want ? 'Friends can see your latest weight.' : 'Your weight is hidden from friends.');
    renderSettings();
  });
  on(page, 'click', '[data-unblock]', async (e, b) => {
    const id = b.dataset.unblock;
    const toast = toastLater();
    unblocking.add(id);
    renderSettings();
    const r = await unblock(id);
    if (r.error) { unblocking.delete(id); renderSettings(); toast(r.error, { tone: 'error' }); return; }
    toast('Unblocked.');
    await refreshBlocks();
    unblocking.delete(id);
  });
  on(page, 'click', '[data-step]', (e, b) => { state.settings.weightStep = +b.dataset.step; saveSettings(); renderSettings(); });
  on(page, 'click', '[data-pick-image]', () => $('restFile').click());
  on(page, 'change', '#restFile', async (e, input) => {
    const file = input.files && input.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    try {
      if (!setRestImage(await resizeImage(file))) throw new Error('full');
      toast('Rest-day picture updated.');
      renderSettings();
    } catch { toast('That picture could not be saved. Try a smaller one.', { tone: 'error' }); }
    input.value = '';
  });
  on(page, 'click', '[data-reset-image]', () => { setRestImage(null); renderSettings(); });
  on(page, 'click', '[data-backup-file]', () => download(backupText(), 'tracker-backup-' + new Date().toISOString().slice(0, 10) + '.json'));
  on(page, 'click', '[data-switch-backup]', () => download(readText(KEYS.switchBackup), 'tracker-backup-before-switch.json'));
  on(page, 'click', '[data-backup-copy]', async () => {
    try { await navigator.clipboard.writeText(backupText()); toast('Backup copied. Paste it somewhere safe.'); } catch { toast('Copying is blocked here. Use “Save file” instead.', { tone: 'error' }); }
  });
  on(page, 'click', '[data-restore]', async () => {
    const choice = await openSheet({
      title: 'Restore a backup',
      body: html`<label class="field"><span>Paste backup text</span><textarea class="input" name="paste" rows="4" placeholder="{&quot;app&quot;:&quot;tracker&quot;…"></textarea></label>`,
      actions: [{ label: 'Restore pasted text', tone: 'primary', onClick: (finish, sheet) => finish({ text: sheet.querySelector('textarea[name=paste]').value }) }, { label: 'Choose file', value: 'file', tone: 'ghost' }],
    });
    if (choice === 'file') $('restoreFile').click();
    else if (choice && 'text' in choice) restoreFrom(choice.text);
  });
  on(page, 'change', '#restoreFile', async (e, input) => {
    const file = input.files && input.files[0];
    if (file) restoreFrom(await file.text());
    input.value = '';
  });
  on(page, 'click', '[data-delete-account]', async () => {
    const result = await openSheet({
      title: 'Delete your account?',
      body: html`<p class="sheet-text">Your account, friends, gym dates and everything synced to the cloud are deleted. This cannot be undone.</p>
        <label class="field"><span>Type DELETE to confirm</span><input class="input" name="confirm" autocomplete="off" autocapitalize="characters" maxlength="10"></label>
        <label class="check-row"><input type="checkbox" name="wipe" checked> <span>Also remove my workouts from this phone</span></label>
        <p class="form-error" aria-live="polite"></p>`,
      actions: [
        {
          label: 'Delete forever', tone: 'danger', submit: true,
          onClick: (finish, sheet) => {
            if (sheet.querySelector('[name=confirm]').value !== 'DELETE') { sheet.querySelector('.form-error').textContent = 'Type DELETE in capital letters.'; return; }
            finish({ wipe: sheet.querySelector('[name=wipe]').checked });
          },
        },
        { label: 'Cancel', value: null, tone: 'ghost' },
      ],
    });
    if (!result || deleting) return;
    const toast = toastLater();
    deleting = true; renderSettings();
    const r = await deleteAccount({ removeLocalData: result.wipe });
    deleting = false; renderSettings();
    toast(r || 'Your account was deleted.', { tone: r ? 'error' : 'default' });
  });
  // Busy while it works (a second tap must not start a second download).
  on(page, 'click', '[data-apply-update]', async () => {
    applyingUpdate = true;
    renderSettings();
    try { await updateOffer()?.apply(); } finally { applyingUpdate = false; renderSettings(); }
  });
  listen('gym:update-ready', () => {
    if (currentPage() !== 'settings') return;
    renderSettings();
    // The reinstall steps replaced the offer: read them before the button can be pressed again.
    if (updateOffer()?.reinstall && document.activeElement?.matches?.('[data-apply-update]')) {
      page.querySelector('.update-notice b')?.focus({ preventScroll: true });
    }
  });
  on(page, 'click', '[data-check-update]', () => window.dispatchEvent(new CustomEvent('gym:check-update', { detail: { manual: true } })));

  listen('gym:account', () => {
    if (!account.user || (blocksFor && blocksFor !== account.user.id)) { blocks = null; blocksFor = null; }
    if (account.user && account.ready && blocks == null) refreshBlocks();
    if (currentPage() === 'settings') renderSettings();
  });
  listen('gym:username-taken', async (e) => {
    const name = await promptDialog({
      title: 'Choose another username',
      label: 'Username',
      hint: `@${e.detail.wanted} was already taken, so your account got @${e.detail.given} for now. Friends find you by this exact name.`,
      maxLength: 20, ok: 'Save', input: { autocomplete: 'nickname', autocapitalize: 'none' },
      validate: (v) => (/^[a-z0-9_]{3,20}$/.test(v.toLowerCase()) ? '' : 'Use 3–20 letters, numbers or _.'),
      submit: changeUsername, // a taken name keeps the prompt open with the reason
    });
    if (name) toast(`Username saved: @${name.toLowerCase()}.`);
  });
  let askingPassword = false;
  listen('gym:password-recovery', async () => {
    if (askingPassword) return;
    askingPassword = true;
    // Kept exactly as typed (the sign-in form does not trim either); a refusal keeps the prompt open.
    // A stray tap must not end the reset: only "Not now" or a saved password closes it.
    const pw = await promptDialog({ title: 'Choose a new password', label: 'New password', type: 'password', maxLength: 72, ok: 'Save password', cancel: 'Not now', required: true, input: { autocomplete: 'new-password' }, trim: false, validate: (v) => (v.length >= 8 ? '' : 'Use at least 8 characters.'), submit: updatePassword });
    askingPassword = false;
    toast(pw ? 'Password changed.' : 'You can set a password later with “Change password” in Settings.');
  });
}

export function onSettingsShown() {
  if (account.user && account.ready) refreshBlocks();
}
