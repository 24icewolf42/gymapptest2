import { defineConfig, devices } from '@playwright/test';
import { execFileSync } from 'node:child_process';

// The web and Android tests create accounts and data, so they must only ever
// talk to the local Supabase stack (`npx supabase start`), never the live one.
function localSupabase() {
  let out = '';
  try {
    out = execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { /* checked in tests/global-setup.js */ }
  const get = (k) => (new RegExp('^' + k + '="?([^"\\n]*)', 'm').exec(out) || [])[1];
  const url = get('API_URL'), key = get('ANON_KEY');
  // Only ever a local address; anything else is treated as "not running".
  return url && /^http:\/\/(127\.0\.0\.1|localhost):/.test(url) && key ? { url, key } : { url: '', key: '' };
}
const db = localSupabase();
const PORT = 4174; // not 4173, so a running `npm run serve` (live config) is never reused

export default defineConfig({
  testDir: 'tests',
  globalSetup: './tests/global-setup.js',
  timeout: 45000,
  expect: { timeout: 8000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    {
      name: 'web',
      testDir: 'tests/e2e',
      use: { ...devices['Pixel 7'], baseURL: `http://127.0.0.1:${PORT}`, serviceWorkers: 'block' },
    },
    {
      name: 'android',
      testDir: 'tests/android',
      timeout: 120000,
    },
  ],
  webServer: {
    command: 'node tools/serve.mjs',
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    env: { PORT: String(PORT), GYM_CLOUD_URL: db.url, GYM_CLOUD_KEY: db.key },
  },
});
