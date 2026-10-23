// End-to-end tests of the installed Android app in an emulator. The debug build's
// WebView is debuggable, so Playwright drives the real app UI through it.
// Run with `npm run test:android` (see tools/android-e2e.sh).
import { test, expect, _android as android } from '@playwright/test';
import { adminClient } from '../integration/helpers.js';
import { newUser } from '../e2e/helpers.js';

const PKG = 'com.roguelineage.rattracker';
let device;

async function launch({ clear = false } = {}) {
  await device.shell(`am force-stop ${PKG}`);
  if (clear) await device.shell(`pm clear ${PKG}`);
  await device.shell(`am start -W -n ${PKG}/.MainActivity`);
  const webview = await device.webView({ pkg: PKG }, { timeout: 60000 });
  const page = await webview.page();
  await expect(page.locator('#page-today h1')).toHaveText('Today', { timeout: 30000 });
  await page.locator('#loadingScreen').waitFor({ state: 'detached' });
  return page;
}

const back = () => device.shell('input keyevent KEYCODE_BACK');

test.beforeAll(async () => {
  [device] = await android.devices();
  test.skip(!device, 'No Android device or emulator connected');
});

test.afterAll(async () => { await device?.close(); });

test('logs a workout offline and keeps it after the app restarts', async () => {
  let page = await launch({ clear: true });
  expect(await page.evaluate(() => window.Capacitor?.isNativePlatform?.())).toBe(true);
  // The Android-app install banner is only for browsers.
  await expect(page.locator('#installBanner')).toBeHidden();

  await page.locator('.nav-btn[data-page="plan"]').click();
  await page.getByRole('button', { name: 'New workout' }).click();
  await page.locator('.sheet input[name=value]').fill('Push');
  await page.locator('.sheet [type=submit]').click();
  await page.locator('#exSearch').fill('Bench');
  await page.locator('[data-add="Barbell Bench Press"]').click();
  await page.locator('[data-close-editor]').click();
  const dow = (new Date().getDay() + 6) % 7;
  await page.locator(`[data-day="${dow}"]`).click();
  await page.locator('.sheet [data-choose="Push"]').click();

  await page.locator('.nav-btn[data-page="today"]').click();
  await page.locator('#startToday').click();
  await page.locator('#sessionMain').click();
  await page.locator('#session .w').first().fill('60');
  await page.locator('#session .r').first().fill('8');
  await page.locator('#session .check').first().click();

  // Hardware back closes the workout but keeps it running.
  await back();
  await expect(page.locator('#session')).toBeHidden();
  await expect(page.locator('#activeBar')).toBeVisible();
  await page.locator('#activeBar button').click();
  await expect(page.locator('#session .w').first()).toHaveValue('60');
  await page.locator('#sessionMain').click();
  await page.locator('.sheet').getByRole('button', { name: 'Save workout' }).click();
  await expect(page.locator('.hero-card.done')).toBeVisible();

  page = await launch();
  await expect(page.locator('.hero-card.done')).toBeVisible();
  await expect(page.locator('.hero-title')).toHaveText('Push');
});

test('signs up and posts a gym date to the cloud', async () => {
  const user = newUser('droid');
  const page = await launch({ clear: true });
  await page.locator('.page.active [data-open-settings]').click();
  await page.locator('[data-auth-mode="signup"]').click();
  await page.locator('#authForm [name=email]').fill(user.email);
  await page.locator('#authForm [name=password]').fill(user.password);
  await page.locator('#authForm [name=username]').fill(user.username);
  await page.locator('#authForm [type=submit]').click();
  await expect(page.locator('#page-settings .status')).toHaveText(/Synced/, { timeout: 30000 });

  // Hardware back leaves Settings.
  await back();
  await expect(page.locator('#page-today')).toHaveClass(/active/);

  await page.locator('.nav-btn[data-page="crew"]').click();
  await page.locator('[data-quick="0"]').click();
  await page.locator('.date-sheet [name=gym]').fill('Emulator Gym');
  await page.locator('.date-sheet [type=submit]').click();
  await expect(page.locator('.date-card.mine')).toContainText('Emulator Gym');

  const admin = adminClient();
  const profile = await admin.from('profiles').select('id').eq('username', user.username).single();
  const dates = await admin.from('gym_dates').select('gym').eq('host_id', profile.data.id);
  expect(dates.data).toEqual([{ gym: 'Emulator Gym' }]);
});
