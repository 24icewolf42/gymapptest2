// Tabs, the back gesture/button, and swipe navigation between tabs.
// Every overlay (workout screen, sheet, non-home tab) pushes a "layer" onto the
// browser history, so the phone's back gesture closes it instead of leaving the app.
import { dismissUndo } from './dom.js';

export const TABS = ['today', 'plan', 'calendar', 'stats', 'crew'];
const pages = {};
let current = 'today';

const layers = [];
let skipPops = 0;
let pendingPushes = [];

// history.back() is asynchronous. A layer opened while a back() is still in
// flight would have its entry popped instead, so its push waits for that popstate.
function pushEntry(layer) {
  layer.pushed = true;
  try { history.pushState({ gymLayer: true }, ''); } catch { /* sandboxed */ }
}

export function pushLayer(onBack) {
  const layer = { onBack, pushed: false };
  layers.push(layer);
  if (skipPops > 0) pendingPushes.push(layer);
  else pushEntry(layer);
  return () => closeLayer(layer);
}

function closeLayer(layer) {
  const i = layers.indexOf(layer);
  if (i < 0) return;
  layers.splice(i, 1);
  if (!layer.pushed) { pendingPushes = pendingPushes.filter((l) => l !== layer); return; }
  skipPops++;
  try { history.back(); } catch { skipPops--; }
}

window.addEventListener('popstate', () => {
  if (skipPops > 0) {
    skipPops--;
    if (!skipPops) { const queued = pendingPushes; pendingPushes = []; queued.forEach(pushEntry); }
    return;
  }
  const layer = layers.pop();
  if (layer) layer.onBack();
});

/** Hardware back button inside the Android app. */
export function handleNativeBack(exitApp) {
  if (layers.length) history.back();
  else if (current !== 'today') go('today');
  else exitApp();
}

export function registerPage(name, hooks) {
  pages[name] = hooks;
}

export function currentPage() {
  return current;
}

let tabLayerClose = null;

export function go(name, { fromBack = false } = {}) {
  if (!pages[name]) return;
  const changed = name !== current;
  // Let the page we leave close its own history layers (e.g. the plan editor).
  if (changed) { pages[current]?.leave?.(); dismissUndo(); }
  // Focus inside the page being hidden would be lost: it moves to the new page's heading.
  const leaving = document.getElementById('page-' + current);
  const focusWasInPage = changed && !!leaving && leaving.contains(document.activeElement);
  current = name;
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + name));
  document.querySelectorAll('.nav-btn').forEach((b) => {
    const active = b.dataset.page === name;
    b.classList.toggle('active', active);
    if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  document.body.dataset.page = name;
  pages[name].render?.();
  if (changed) pages[name].shown?.();
  if (changed) window.scrollTo(0, 0);
  if (focusWasInPage) {
    const h = document.querySelector(`#page-${name} h1`);
    if (h) { if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }
  // Any tab other than Today sits on one history layer, so "back" returns home.
  if (name === 'today') {
    if (tabLayerClose && !fromBack) tabLayerClose();
    tabLayerClose = null;
  } else if (TABS.includes(name) && !tabLayerClose) {
    tabLayerClose = pushLayer(() => { tabLayerClose = null; go('today', { fromBack: true }); });
  }
}

/** Re-renders the visible page (e.g. after cloud data arrived). */
export function refresh(name) {
  if (!name || name === current) pages[current]?.render?.();
}

export function initNav() {
  document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => go(b.dataset.page)));
  setupSwipe();
}

function setupSwipe() {
  let startX = 0, startY = 0, tracking = false, horizontal = false;
  const ignore = 'input, textarea, select, .no-swipe, .sheet-backdrop, .session, .graph, [data-drag]';
  // Anything that scrolls sideways (e.g. chip rows) keeps its own swipe.
  const inSideScroller = (el) => {
    for (; el && el !== document.body; el = el.parentElement) {
      if (el.scrollWidth > el.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true;
    }
    return false;
  };
  document.addEventListener('touchstart', (e) => {
    tracking = !e.target.closest(ignore) && !inSideScroller(e.target) && TABS.includes(current);
    if (!tracking) return;
    startX = e.touches[0].clientX; startY = e.touches[0].clientY; horizontal = false;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    const dx = e.touches[0].clientX - startX, dy = e.touches[0].clientY - startY;
    if (!horizontal && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.4) horizontal = true;
    if (horizontal) {
      const page = document.querySelector('.page.active');
      if (page) page.style.transform = 'translateX(' + dx * 0.6 + 'px)';
    }
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (!tracking || !horizontal) { tracking = false; return; }
    tracking = false;
    const dx = e.changedTouches[0].clientX - startX;
    const page = document.querySelector('.page.active');
    if (page) page.style.transform = '';
    const i = TABS.indexOf(current);
    if (Math.abs(dx) > 80) go(TABS[Math.max(0, Math.min(TABS.length - 1, i + (dx < 0 ? 1 : -1)))]);
  }, { passive: true });
}
