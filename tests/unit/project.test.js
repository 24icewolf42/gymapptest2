// Repository consistency: version, offline file list, CSP-safe HTML, generated schema.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { APP_VERSION } from '../../js/version.js';

const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));

describe('project', () => {
  it('uses one version everywhere', () => {
    expect(JSON.parse(readFileSync('Version', 'utf8')).version).toBe(APP_VERSION);
    expect(readFileSync('sw.js', 'utf8')).toContain(`const VERSION = '${APP_VERSION}';`);
  });

  it('caches every app file for offline use, and only files that exist', () => {
    const sw = readFileSync('sw.js', 'utf8');
    const listed = [...sw.matchAll(/^\s+'([^']+)',$/gm)].map((m) => m[1]).filter((f) => f !== './');
    listed.forEach((f) => expect(existsSync(f), f).toBe(true));
    [...walk('js'), ...walk('css')].forEach((f) => expect(listed, f).toContain(f.replace(/\\/g, '/')));
  });

  it('has no inline scripts or handlers, so the Content-Security-Policy can forbid them', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toMatch(/Content-Security-Policy/);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(html).not.toMatch(/https?:\/\/cdn\./);
  });

  it('keeps supabase/schema.sql generated from the migrations', () => {
    expect(() => execFileSync('node', ['tools/build-schema.mjs', '--check'], { stdio: 'pipe' })).not.toThrow();
  });
});
