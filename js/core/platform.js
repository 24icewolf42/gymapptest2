// Which device and mode the web app runs in (iPhone/iPad, added to the home screen).

/** iPhone, iPod or iPad (iPadOS reports itself as a Mac, but has touch). */
export function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Opened from the home screen (or installed), not in a browser tab. */
export function isStandalone() {
  return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}
