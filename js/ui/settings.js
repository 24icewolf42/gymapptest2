// Settings: account, privacy, training options, rest-day image, backup, about.
import { $, html, render, on, toast } from '../core/dom.js';
import { listen } from '../core/store.js';
import { pushLayer, go, currentPage } from '../core/router.js';
import { state, saveSettings, restImage, setRestImage, loadState } from '../state.js';
import { makeBackup, parseBackup } from '../domain/backup.js';
import { cloudConfigured } from '../cloud/client.js';
import {
  account, signIn, signUp, resetPassword, updatePassword, signOut, changeUsername, setShareWeight, deleteAccount, syncAll,
} from '../cloud/sync.js';
import { openSheet, confirmDialog, promptDialog } from './sheet.js';
import { icons } from './icons.js';
import { APP_VERSION } from '../version.js';

let authMode = 'signin';
let previousPage = 'today';
let closeLayer = null;
let busy = false;

export function openSettings() {
  if (currentPage() === 'settings') return;
  previousPage = currentPage();
  go('settings');
  closeLayer = pushLayer(() => { closeLayer = null; go(previousPage); });
}

function closeSettings() {
  if (closeLayer) { const c = closeLayer; closeLayer = null; c(); }
  go(previousPage);
}

function accountCard() {
  if (!cloudConfigured()) return html`<section class="card"><h2>Account</h2><p class="muted">Accounts are not available in this build.</p></section>`;
  if (!account.user) {
    const signup = authMode === 'signup';
    return html`<form class="card auth" id="authForm" novalidate>
      <div class="segmented small" role="tablist" aria-label="Account">
        <button type="button" role="tab" aria-selected="${!signup ? 'true' : 'false'}" data-auth-mode="signin">Sign in</button>
        <button type="button" role="tab" aria-selected="${signup ? 'true' : 'false'}" data-auth-mode="signup">Create account</button>
      </div>
      <p class="muted small">${signup ? 'Back up your workouts, use several devices, add friends and plan gym dates together.' : 'Welcome back. Your workouts on this phone stay here either way.'}</p>
      <label class="field"><span>Email</span><input class="input" name="email" type="email" autocomplete="email" required></label>
      <label class="field"><span>Password</span><input class="input" name="password" type="password" minlength="8" autocomplete="${signup ? 'new-password' : 'current-password'}" required placeholder="At least 8 characters"></label>
      ${signup ? html`<label class="field"><span>Username</span><div class="input-row"><span class="input-prefix">@</span><input class="input" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="20" placeholder="3–20 letters, numbers or _"></div></label>
        <p class="hint">Friends find you by your exact username. Don’t use your real full name.</p>` : ''}
      <p class="form-error" aria-live="polite"></p>
      <button class="btn btn-primary btn-block" type="submit"${busy ? ' disabled' : ''}>${signup ? 'Create account' : 'Sign in'}</button>
      ${signup ? '' : html`<button type="button" class="link-btn" data-forgot>Forgot password?</button>`}
    </form>`;
  }
  const p = account.profile;
  return html`<section class="card">
    <header class="card-head"><div><h2>@${p?.username || '…'}</h2><small class="muted">${account.user.email}</small></div>
      <button type="button" class="btn btn-soft btn-sm" data-change-username>Change</button></header>
    <p class="status ${account.statusTone}" role="status">${account.status}</p>
    <div class="btn-row">
      <button type="button" class="btn btn-soft" data-sync>Sync now</button>
      <button type="button" class="btn btn-ghost" data-signout>Sign out</button>
    </div>
  </section>
  <section class="card">
    <h2>Privacy</h2>
    <label class="toggle row-toggle"><input type="checkbox" data-share-weight${p?.share_weight ? ' checked' : ''}${p && 'share_weight' in p ? '' : ' disabled'}>
      <span><b>Show my weight to friends</b><small>Friends see only your latest weigh-in, never the full history.</small></span></label>
    <p class="muted small">Friends can see your username, gym dates you share with them, and stats or routines you choose to share. Your workout history syncs only to your own account.</p>
  </section>`;
}

function trainingCard() {
  const steps = [[0, 'Exact'], [0.5, '0.5 kg'], [1, '1 kg'], [2.5, '2.5 kg'], [5, '5 kg']];
  return html`<section class="card">
    <h2>Training</h2>
    <div class="field"><span id="stepLabel">Round weights to</span>
      <div class="chips" role="radiogroup" aria-labelledby="stepLabel">${steps.map(([v, l]) => html`<button type="button" class="chip${state.settings.weightStep === v ? ' on' : ''}" role="radio" aria-checked="${state.settings.weightStep === v ? 'true' : 'false'}" data-step="${v}">${l}</button>`)}</div>
      <p class="hint">Match the smallest plates or dumbbell steps at your gym.</p></div>
    <div class="field"><span>Rest-day picture</span>
      <div class="rest-pick"><img src="${restImage()}" alt="Current rest-day picture">
        <div class="btn-col"><button type="button" class="btn btn-soft btn-sm" data-pick-image>${icons.image} Choose</button>
        <button type="button" class="btn btn-ghost btn-sm" data-reset-image>Reset</button></div></div>
      <input type="file" id="restFile" accept="image/*" hidden></div>
  </section>`;
}

function backupCard() {
  return html`<section class="card">
    <h2>Backup</h2>
    <p class="muted small">Everything on this phone: workouts, plan, weigh-ins and settings.</p>
    <div class="btn-row">
      <button type="button" class="btn btn-soft" data-backup-file>${icons.download} Save file</button>
      <button type="button" class="btn btn-soft" data-backup-copy>${icons.copy} Copy</button>
      <button type="button" class="btn btn-soft" data-restore>${icons.upload} Restore</button>
    </div>
    <input type="file" id="restoreFile" accept="application/json,.json,.txt" hidden>
  </section>`;
}

function dangerCard() {
  if (!account.user) return '';
  return html`<section class="card danger-zone">
    <h2>Delete account</h2>
    <p class="muted small">Deletes your account, friends, gym dates and everything synced to the cloud. Workouts on this phone stay until you delete the app.</p>
    <button type="button" class="btn btn-danger" data-delete-account>Delete my account</button>
  </section>`;
}

export function renderSettings() {
  render($('page-settings'), html`
    <header class="top editor-top">
      <button type="button" class="icon-btn" data-close-settings aria-label="Back">${icons.back}</button>
      <div class="grow"><p class="eyebrow">Tracker v${APP_VERSION}</p><h1 class="h1-sm">Settings</h1></div></header>
    ${accountCard()}
    ${trainingCard()}
    ${backupCard()}
    ${dangerCard()}
    <p class="about muted small">Exercise list and app made for training with friends. <button type="button" class="link-btn" data-check-update>Check for updates</button></p>`);
}

function refreshIfShown() {
  if (currentPage() === 'settings') {
    const f = document.activeElement;
    if (f && $('page-settings').contains(f) && f.matches('input')) return;
    renderSettings();
  }
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

async function restoreFrom(text) {
  let data;
  try { data = parseBackup(text); } catch (e) { toast(e.message, { tone: 'error' }); return; }
  const ok = await confirmDialog(account.user
    ? 'Your workouts on this phone are replaced by the backup. Workouts already in your account are merged back in at the next sync.'
    : 'Everything on this phone is replaced by the backup.', { title: 'Restore this backup?', ok: 'Restore', danger: true });
  if (!ok) return;
  Object.entries(data).forEach(([k, v]) => localStorage.setItem(k, v));
  state.sync.syncedWeightDates = [];
  localStorage.setItem('gymSyncState', JSON.stringify(state.sync));
  loadState();
  toast('Backup restored.');
  setTimeout(() => location.reload(), 600);
}

export function initSettings() {
  const page = $('page-settings');
  on(page, 'click', '[data-close-settings]', closeSettings);
  on(page, 'click', '[data-auth-mode]', (e, b) => { authMode = b.dataset.authMode; renderSettings(); });
  on(page, 'submit', '#authForm', async (e) => {
    e.preventDefault();
    const f = e.target, err = f.querySelector('.form-error');
    const email = f.email.value.trim(), password = f.password.value;
    const username = authMode === 'signup' ? f.username.value.trim().toLowerCase() : '';
    if (!/^\S+@\S+\.\S+$/.test(email)) { err.textContent = 'Enter a valid email address.'; return; }
    if (password.length < 8) { err.textContent = 'Use a password with at least 8 characters.'; return; }
    if (authMode === 'signup' && !/^[a-z0-9_]{3,20}$/.test(username)) { err.textContent = 'Usernames have 3–20 letters, numbers or _.'; return; }
    busy = true; f.querySelector('[type=submit]').disabled = true;
    const r = authMode === 'signup' ? await signUp(email, password, username) : await signIn(email, password);
    busy = false;
    if (r === 'confirm-email') { toast('Account created. Check your email to confirm it, then sign in.', { ms: 6000 }); authMode = 'signin'; renderSettings(); return; }
    if (r) { err.textContent = r; f.querySelector('[type=submit]').disabled = false; return; }
    toast(authMode === 'signup' ? 'Welcome! Your account is ready.' : 'Signed in. Syncing your workouts…');
  });
  on(page, 'click', '[data-forgot]', async () => {
    const email = await promptDialog({ title: 'Reset password', label: 'Your account email', type: 'email', value: $('authForm')?.email.value || '', ok: 'Send link', maxLength: 120 });
    if (!email) return;
    const r = await resetPassword(email);
    toast(r || 'Check your inbox for the reset link.', { tone: r ? 'error' : 'default' });
  });
  on(page, 'click', '[data-sync]', () => syncAll());
  on(page, 'click', '[data-signout]', async () => {
    const choice = await openSheet({
      title: 'Sign out?',
      body: html`<p class="sheet-text">If someone else uses this phone, remove your workouts from it. They stay safe in your account.</p>`,
      actions: [{ label: 'Sign out, keep data here', value: 'keep', tone: 'secondary' }, { label: 'Sign out and remove my data', value: 'remove', tone: 'danger' }],
    });
    if (!choice) return;
    await signOut({ removeLocalData: choice === 'remove' });
    toast('Signed out.');
  });
  on(page, 'click', '[data-change-username]', async () => {
    const name = await promptDialog({ title: 'Change username', label: 'Username', value: account.profile?.username || '', maxLength: 20, hint: 'Friends find you by this exact name.', validate: (v) => (/^[a-z0-9_]{3,20}$/.test(v.toLowerCase()) ? '' : 'Use 3–20 letters, numbers or _.') });
    if (!name) return;
    const r = await changeUsername(name);
    toast(r || 'Username changed.', { tone: r ? 'error' : 'default' });
  });
  on(page, 'change', '[data-share-weight]', async (e, input) => {
    const r = await setShareWeight(input.checked);
    if (r) { toast(r, { tone: 'error' }); input.checked = !input.checked; }
    else toast(input.checked ? 'Friends can see your latest weight.' : 'Your weight is hidden from friends.');
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
  });
  on(page, 'click', '[data-reset-image]', () => { setRestImage(null); renderSettings(); });
  on(page, 'click', '[data-backup-file]', () => {
    const blob = new Blob([backupText()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tracker-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  on(page, 'click', '[data-backup-copy]', async () => {
    try { await navigator.clipboard.writeText(backupText()); toast('Backup copied. Paste it somewhere safe.'); } catch { toast('Copying is blocked here. Use “Save file” instead.', { tone: 'error' }); }
  });
  on(page, 'click', '[data-restore]', async () => {
    const choice = await openSheet({
      title: 'Restore a backup',
      body: html`<label class="field"><span>Paste backup text</span><textarea class="input" name="paste" rows="4" placeholder="{&quot;app&quot;:&quot;tracker&quot;…"></textarea></label>`,
      actions: [{ label: 'Choose file', value: 'file', tone: 'ghost' }, { label: 'Restore pasted text', tone: 'primary', onClick: (finish) => finish({ text: document.querySelector('.sheet textarea[name=paste]').value }) }],
    });
    if (choice === 'file') $('restoreFile').click();
    else if (choice && choice.text) restoreFrom(choice.text);
  });
  on(page, 'change', '#restoreFile', async (e, input) => {
    const file = input.files && input.files[0];
    if (file) restoreFrom(await file.text());
    input.value = '';
  });
  on(page, 'click', '[data-delete-account]', async () => {
    const typed = await promptDialog({ title: 'Delete your account?', label: `Type DELETE to confirm`, ok: 'Delete forever', maxLength: 10, hint: 'This cannot be undone.', validate: (v) => (v === 'DELETE' ? '' : 'Type DELETE in capital letters.') });
    if (typed !== 'DELETE') return;
    const r = await deleteAccount();
    toast(r || 'Your account was deleted.', { tone: r ? 'error' : 'default' });
  });
  on(page, 'click', '[data-check-update]', () => window.dispatchEvent(new CustomEvent('gym:check-update', { detail: { manual: true } })));

  listen('gym:account', refreshIfShown);
  listen('gym:password-recovery', async () => {
    const pw = await promptDialog({ title: 'Choose a new password', label: 'New password', type: 'password', maxLength: 72, ok: 'Save password', validate: (v) => (v.length >= 8 ? '' : 'Use at least 8 characters.') });
    if (!pw) return;
    const r = await updatePassword(pw);
    toast(r || 'Password changed.', { tone: r ? 'error' : 'default' });
  });
}
