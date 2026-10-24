// Comparing app versions and release titles for the update checks. Pure functions.

/** True when version a is newer than b ("3.0.1" > "3.0.0"). */
export function isNewer(a, b) {
  const x = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const y = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
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
