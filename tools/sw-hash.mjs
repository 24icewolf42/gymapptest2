// Writes a hash of every file the service worker caches into sw.js, so any
// change to the app gives installed copies a new cache (and a new service
// worker) even without a version bump. `--check` only verifies it is current.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const sw = readFileSync('sw.js', 'utf8');
const files = [...sw.matchAll(/^\s+'([^']+)',$/gm)].map((m) => m[1]).filter((f) => f !== './');
const hash = createHash('sha256');
files.forEach((f) => { hash.update(f + '\0'); hash.update(readFileSync(f)); });
const build = hash.digest('hex').slice(0, 12);
const line = `const BUILD = '${build}';`;
const current = /^const BUILD = '[0-9a-f]*';$/m.exec(sw)?.[0];
if (process.argv.includes('--check')) {
  if (current !== line) { console.error(`sw.js BUILD is out of date: run npm run sw-hash (want ${build})`); process.exit(1); }
} else {
  writeFileSync('sw.js', sw.replace(/^const BUILD = '[0-9a-f]*';$/m, line));
  console.log('sw.js BUILD', build);
}
