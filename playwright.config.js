import { defineConfig, devices } from '@playwright/test';
import { execFileSync } from 'node:child_process';

// The web tests run against the local Supabase stack (`npx supabase start`).
function localSupabase() {
  try {
    const out = execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const get = (k) => (new RegExp('^' + k + '="?([^"\\n]*)', 'm').exec(out) || [])[1];
    return { url: get('API_URL'), key: get('ANON_KEY') };
  } catch {
    return {};
  }
}
const db = localSupabase();

export default defineConfig({
  testDir: 'tests',
  timeout: 45000,
  expect: { timeout: 8000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    {
      name: 'web',
      testDir: 'tests/e2e',
      use: { ...devices['Pixel 7'], baseURL: 'http://127.0.0.1:4173', serviceWorkers: 'block' },
    },
    {
      name: 'android',
      testDir: 'tests/android',
      timeout: 120000,
    },
  ],
  webServer: {
    command: 'node tools/serve.mjs',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    env: { GYM_CLOUD_URL: db.url || '', GYM_CLOUD_KEY: db.key || '' },
  },
});
