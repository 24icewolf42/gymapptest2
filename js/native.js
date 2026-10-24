// Platform glue: Android back button, APK self-update, the web update check,
// the "get the app" banner and the offline service worker.
import { $, toast, toastLater, scriptURL } from './core/dom.js';
import { emit } from './core/store.js';
import { handleNativeBack, currentPage } from './core/router.js';
import { APP_VERSION } from './version.js';
import { isNewer, parseRelease, releaseIsNewer } from './domain/release.js';

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

// An available update is offered in Settings (nothing appears over or above
// the page while the user is using it), and announced once.
let offer = null;
/** The update on offer: { title, action, apply, reinstall }, or null. */
export const updateOffer = () => offer;
// Found in the background it waits behind an Undo or an error; asked for, it answers at once.
const announceOffer = (manual, show = toast) => show(currentPage() === 'settings'
  ? `${offer.title}. “${offer.action}” is just above “Check for updates”.`
  : `${offer.title}. Open Settings to ${offer.action.toLowerCase()}.`, { background: !manual });
function offerUpdate(title, action, onTap, manual = false, show = toast) {
  const first = !offer;
  offer = { title, action, apply: onTap };
  if (first || manual) announceOffer(manual, show);
  emit('gym:update-ready');
}

async function installedBuild() {
  try {
    const info = await plugin('App')?.getInfo?.();
    return { version: info?.version || APP_VERSION, build: info && /^\d+$/.test(String(info.build)) ? +info.build : null };
  } catch { return { version: APP_VERSION, build: null }; }
}

function installUpdate() {
  const P = plugin('ApkUpdater');
  if (!P) { toast('The updater is not available in this build.'); return Promise.resolve(); }
  toast('Downloading update…');
  const later = toastLater(); // the download takes a while; the user may be elsewhere by then
  return P.install({ url: APK_URL })
    .then(() => later('Tap Install when Android asks.'))
    .catch((e) => {
      if (e && e.code === 'SIGNATURE_MISMATCH') {
        // The installed app was not signed by the release key or its predecessor
        // (e.g. a test build): Android only allows the release as a fresh install.
        // The steps replace the offer in Settings; nothing opens over the page.
        offer = { title: 'One-time reinstall needed', action: 'Open download page', apply: () => { window.open(APK_URL, '_blank'); }, reinstall: true };
        emit('gym:update-ready');
        later(currentPage() === 'settings' ? 'This update needs a one-time reinstall. The steps are under “One-time reinstall needed”.' : 'This update needs a one-time reinstall. Open Settings for the steps.', { tone: 'error' });
        return;
      }
      later('Update failed: ' + ((e && e.message) || e), { tone: 'error' });
    });
}

let lastApkCheck = 0;
async function checkApk(manual) {
  if (!manual && Date.now() - lastApkCheck < 10 * 60 * 1000) return;
  if (offer?.reinstall) { if (manual) announceOffer(true); return; } // keep the steps on screen
  const toast = toastLater();
  lastApkCheck = Date.now();
  try {
    const r = await fetch(`https://api.github.com/repos/${APK_REPO}/releases/tags/latest`, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json' } });
    const rel = r.ok ? parseRelease((await r.json()).name) : null;
    if (rel && releaseIsNewer(rel, await installedBuild())) {
      offerUpdate(`Update available${rel.version ? ': v' + rel.version : ''}`, 'Download and install', installUpdate, manual, toast);
    } else if (manual) { if (offer) announceOffer(true, toast); else toast('You have the latest version.'); }
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
  const toast = toastLater();
  try {
    const r = await fetch('./Version?t=' + Date.now(), { cache: 'no-store' });
    const data = r.ok ? await r.json() : null;
    // Only offer newer versions, so a stale cached file never prompts a downgrade.
    if (data && data.version && isNewer(data.version, APP_VERSION)) {
      offerUpdate('New version available', 'Reload now', applyWebUpdate, manual, toast);
    } else if (manual) { if (offer) announceOffer(true, toast); else toast('You have the latest version.'); }
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

  // Suggest the Android app, or explain how to add the web app on iPhone/iPad.
  const banner = $('installBanner');
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (!native && !standalone && sessionStorage.getItem('hideInstall') !== '1') {
    if (/Android/i.test(navigator.userAgent)) {
      banner.hidden = false;
    } else if (ios) {
      banner.setAttribute('aria-label', 'Add Tracker to your Home Screen');
      $('installTitle').textContent = 'Add Tracker to your Home Screen';
      $('installHint').textContent = 'Use Safari to install it for quick, offline access.';
      $('installLink').hidden = true;
      $('installHelp').hidden = false;
      $('installHelp').onclick = () => toast('In Safari, tap Share, then Add to Home Screen.');
      banner.hidden = false;
    }
    $('installClose').onclick = () => { banner.hidden = true; sessionStorage.setItem('hideInstall', '1'); };
  }

  // Offline support for the web version. The Android app ships its files already.
  if (!native && 'serviceWorker' in navigator && location.protocol === 'https:') {
    // The first install takes control without a reload; only an update the user
    // asked for (applyWebUpdate) reloads the page.
    // A change without a version bump still installs a new worker (sw.js
    // carries a content hash); offer it instead of waiting for every window to close.
    const offerReady = () => offerUpdate('Update ready', 'Reload now', applyWebUpdate);
    navigator.serviceWorker.register(scriptURL('sw.js')).then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) offerReady();
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => { if (sw.state === 'installed' && navigator.serviceWorker.controller) offerReady(); });
      });
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (updateRequested) location.reload(); });
  }
}
