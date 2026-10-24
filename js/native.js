// Platform glue: Android back button, APK self-update, the web update check,
// the "get the app" banner and the offline service worker.
import { $, html, render, toast, scriptURL } from './core/dom.js';
import { openSheet } from './ui/sheet.js';
import { handleNativeBack } from './core/router.js';
import { APP_VERSION } from './version.js';

const APK_REPO = 'roguelineageaccmanager/gymapptest2';
const APK_URL = `https://github.com/${APK_REPO}/releases/download/latest/rat-tracker.apk`;

function plugin(name) {
  const C = window.Capacitor;
  if (!C) return null;
  try { return (C.Plugins && C.Plugins[name]) || (C.registerPlugin ? C.registerPlugin(name) : null); } catch { return null; }
}

export function isNativeApp() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

/** True when version a is newer than b ("3.0.1" > "3.0.0"). */
export function isNewer(a, b) {
  const x = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const y = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

function showBanner(title, sub, onTap) {
  const el = $('updateBanner');
  render(el, html`<button type="button" class="update-btn"><b>${title}</b><small>${sub}</small></button>`);
  el.hidden = false;
  el.querySelector('button').onclick = onTap;
}

/** Parses "Tracker v3.0.1 (build 57)" into { version, build }. */
export function parseRelease(name) {
  const v = /v(\d+\.\d+\.\d+)/.exec(name || '');
  const b = /\(build (\d+)\)/.exec(name || '');
  return { version: v ? v[1] : null, build: b ? +b[1] : null };
}

/** Newer by build number when both are known (catches releases without a version bump). */
export function releaseIsNewer(release, installed) {
  if (release.build != null && installed.build != null) return release.build > installed.build;
  return !!release.version && isNewer(release.version, installed.version);
}

async function installedBuild() {
  try {
    const info = await plugin('App')?.getInfo?.();
    return { version: info?.version || APP_VERSION, build: info && /^\d+$/.test(String(info.build)) ? +info.build : null };
  } catch { return { version: APP_VERSION, build: null }; }
}

function installUpdate() {
  const P = plugin('ApkUpdater');
  if (!P) { toast('The updater is not available in this build.'); return; }
  toast('Downloading update…');
  P.install({ url: APK_URL })
    .then(() => toast('Tap Install when Android asks.'))
    .catch((e) => {
      if (e && e.code === 'SIGNATURE_MISMATCH') {
        // The installed app was not signed by the release key or its predecessor
        // (e.g. a test build): Android only allows the release as a fresh install.
        openSheet({
          title: 'One-time reinstall needed',
          body: html`<p class="sheet-text">This update is signed with a different key than the app on this phone (for example a test build), so Android can't install it over it.</p>
            <ol class="plain"><li>Settings → Backup → Save file (or sign in, so your data is in your account).</li><li>Uninstall Tracker.</li><li>Install the new version from the link below, then restore or sign in.</li></ol>`,
          actions: [{ label: 'Open download page', value: 'open', tone: 'primary' }, { label: 'Later', value: null, tone: 'ghost' }],
        }).then((v) => { if (v) window.open(APK_URL, '_blank'); });
        return;
      }
      toast('Update failed: ' + ((e && e.message) || e), { tone: 'error' });
    });
}

let lastApkCheck = 0;
async function checkApk(manual) {
  if (!manual && Date.now() - lastApkCheck < 10 * 60 * 1000) return;
  lastApkCheck = Date.now();
  try {
    const r = await fetch(`https://api.github.com/repos/${APK_REPO}/releases/tags/latest`, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json' } });
    const rel = r.ok ? parseRelease((await r.json()).name) : null;
    if (rel && releaseIsNewer(rel, await installedBuild())) {
      showBanner(`Update available${rel.version ? ': v' + rel.version : ''}`, 'Tap to download and install', installUpdate);
    } else if (manual) toast('You have the latest version.');
  } catch { if (manual) toast('Could not check for updates. Are you online?'); }
}

// Activates the new service worker (which reloads the page via controllerchange),
// or simply reloads when there is no service worker.
let updateRequested = false;
async function applyWebUpdate() {
  updateRequested = true;
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => null);
  if (!reg) { location.reload(); return; }
  await reg.update().catch(() => {});
  const sw = reg.waiting || reg.installing;
  if (!sw) { location.reload(); return; }
  const activate = () => sw.postMessage('skip-waiting');
  if (sw.state === 'installed') activate();
  else sw.addEventListener('statechange', () => { if (sw.state === 'installed') activate(); if (sw.state === 'redundant') location.reload(); });
}

async function checkWeb(manual) {
  try {
    const r = await fetch('./Version?t=' + Date.now(), { cache: 'no-store' });
    const data = r.ok ? await r.json() : null;
    // Only offer newer versions, so a stale cached file never prompts a downgrade.
    if (data && data.version && isNewer(data.version, APP_VERSION)) {
      showBanner('New version available', 'Tap to reload with the latest changes', applyWebUpdate);
    } else if (manual) toast('You have the latest version.');
  } catch { if (manual) toast('Could not check for updates. Are you online?'); }
}

export function initNative() {
  const native = isNativeApp();
  const App = plugin('App');
  if (App && App.addListener) App.addListener('backButton', () => handleNativeBack(() => App.exitApp && App.exitApp()));

  const check = (manual) => (native ? checkApk(manual) : checkWeb(manual));
  window.addEventListener('gym:check-update', (e) => check(!!(e.detail && e.detail.manual)));
  setTimeout(() => check(false), 3000);
  if (!native) setInterval(() => check(false), 30 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(false); });

  // Suggest the Android app to Android browser users (once per session).
  const banner = $('installBanner');
  if (!native && /Android/i.test(navigator.userAgent) && !matchMedia('(display-mode: standalone)').matches && sessionStorage.getItem('hideInstall') !== '1') {
    banner.hidden = false;
    $('installClose').onclick = () => { banner.hidden = true; sessionStorage.setItem('hideInstall', '1'); };
  }

  // Offline support for the web version. The Android app ships its files already.
  if (!native && 'serviceWorker' in navigator && location.protocol === 'https:') {
    // The first install takes control without a reload; only an update the user
    // asked for (applyWebUpdate) reloads the page.
    navigator.serviceWorker.register(scriptURL('sw.js')).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (updateRequested) location.reload(); });
  }
}
