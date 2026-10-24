import { defineConfig, devices } from '@playwright/test';
import { supabaseStatus } from './tests/supabase-status.js';

// The web and Android tests create accounts and data, so they must only ever
// talk to the local Supabase stack (`npx supabase start`), never the live one.
function localSupabase() {
  const out = supabaseStatus(); // checked in tests/global-setup.js
  const get = (k) => (new RegExp('^' + k + '="?([^"\\n]*)', 'm').exec(out) || [])[1];
  const url = get('API_URL'), key = get('ANON_KEY');
  // Only ever a local address; anything else is treated as "not running".
  return url && /^http:\/\/(127\.0\.0\.1|localhost):/.test(url) && key ? { url, key } : { url: '', key: '' };
}
const db = localSupabase();
// Not 4173, so a running `npm run serve` (live config) is never reused. E2E_PORT lets
// a second run (e.g. a reviewer's worktree) use its own port.
const PORT = Number(process.env.E2E_PORT) || 4174;

export default defineConfig({
  testDir: 'tests',
  globalSetup: './tests/global-setup.js',
  timeout: 45000,
  expect: { timeout: 8000 },
  // Test files run side by side (each test uses its own users and browser context).
  fullyParallel: false,
  workers: process.env.CI ? 2 : 3,
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
      // iPhone in WebKit (Safari's engine): the iOS-specific checks plus the core offline flows.
      name: 'ios',
      testDir: 'tests',
      testMatch: ['ios/**/*.spec.js', 'e2e/offline.spec.js'],
      use: { ...devices['iPhone 14'], baseURL: `http://127.0.0.1:${PORT}`, serviceWorkers: 'block' },
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
