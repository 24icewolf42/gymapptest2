// The web app on iPhone (WebKit): added to the Home Screen instead of an App Store app.
import { test, expect, open, createWorkout, sheetAction } from '../e2e/helpers.js';

const offline = (page) => page.route('**/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.GYM_CLOUD_CONFIG = {};' }));
const standalone = (page) => page.addInitScript(() => Object.defineProperty(window.navigator, 'standalone', { get: () => true }));

test('in Safari it explains how to add Tracker to the Home Screen', async ({ page }) => {
  await offline(page);
  await page.goto('/'); // not open(): that closes the banner
  await expect(page.locator('#page-today h1')).toHaveText('Today');
  const banner = page.locator('#installBanner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Add Tracker to your Home Screen');
  await expect(page.locator('#installLink')).toBeHidden(); // no Android download on iPhone
  await page.locator('#installHelp').click();
  const sheet = page.locator('.sheet-backdrop.open .sheet');
  await expect(sheet).toContainText('Add to Home Screen');
  await expect(sheet.locator('ol li')).toHaveCount(3);
  await sheetAction(page, 'Got it');
  await expect(page.locator('#installHelp')).toBeFocused();
  await page.locator('#installClose').click();
  await expect(banner).toBeHidden();
});

test('from the Home Screen: no install banner, the icon and title are set, the light theme keeps the status bar readable', async ({ page, request }) => {
  await offline(page);
  await standalone(page);
  await page.addInitScript(() => localStorage.setItem('gymSettings', JSON.stringify({ weightStep: 0, theme: { base: 'light', preset: 'ocean' } })));
  await open(page);
  await expect(page.locator('#installBanner')).toBeHidden();
  await expect(page.locator('html')).toHaveClass(/ios-standalone/);
  expect(await page.evaluate(() => getComputedStyle(document.body, '::before').backgroundColor)).toBe('rgb(20, 23, 26)');
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Tracker');
  const href = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  const icon = await request.get(href);
  expect(icon.ok()).toBe(true);
  const png = await icon.body();
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([180, 180]); // PNG width and height
});

test('backups are saved through the share sheet ("Save to Files")', async ({ page }) => {
  await offline(page);
  await page.addInitScript(() => {
    window.__shared = [];
    navigator.canShare = (d) => !!d?.files?.length;
    navigator.share = async (d) => { window.__shared.push(d.files.map((f) => [f.name, f.type, f.size])); };
  });
  await open(page);
  await createWorkout(page, 'Push', ['Dips']);
  await page.locator('.page.active [data-open-settings]').click();
  await page.locator('[data-backup-file]').click();
  await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
  const [[name, type, size]] = await page.evaluate(() => window.__shared[0]);
  expect(name).toMatch(/^tracker-backup-\d{4}-\d{2}-\d{2}\.json$/);
  expect(type).toBe('application/json');
  expect(size).toBeGreaterThan(50);
});

test('no text field is small enough to make the iPhone zoom in', async ({ page }) => {
  await offline(page);
  await open(page);
  await createWorkout(page, 'Push', ['Dips']);
  const small = async () => page.evaluate(() => [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=color]):not([type=file]), textarea, select')]
    .filter((el) => el.offsetParent && parseFloat(getComputedStyle(el).fontSize) < 16).map((el) => el.name || el.id || el.className));
  await page.locator('[data-edit="Push"]').click();
  expect(await small()).toEqual([]);
  await page.locator('[data-close-editor]').click();
  await page.locator('.page.active [data-open-settings]').click();
  expect(await small()).toEqual([]);
});
