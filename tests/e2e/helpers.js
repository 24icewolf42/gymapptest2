import { test as base, expect, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * Collects uncaught page errors, console errors and server errors (5xx) so
 * each test can assert there were none.
 */
export function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // WebKit's test tooling injects a "body {}" style that the CSP refuses; that is not the app
  // (the Chromium runs still catch any inline style of the app's own).
  const webkit = page.context().browser()?.browserType().name() === 'webkit';
  page.on('console', (m) => {
    if (m.type() !== 'error' || /Failed to load resource|ERR_|net::/.test(m.text())) return;
    if (webkit && /^Refused to apply a stylesheet because/.test(m.text())) return;
    errors.push(m.text());
  });
  page.on('response', (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
  return errors;
}

const contexts = [];
/** A fresh browser context (a second "phone"), closed automatically after the test. */
export async function newPhone(browser) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' });
  contexts.push(ctx);
  return ctx;
}

/**
 * Test with built-in checks: the default page fails the test on any page or
 * server error, and extra phones are closed afterwards.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const errors = trackErrors(page);
    await use(page);
    expect(errors, 'errors on the page').toEqual([]);
  },
});
test.afterEach(async () => { while (contexts.length) await contexts.pop().close(); });
export { expect };

export async function open(page, path = '/') {
  await page.goto(path);
  await expect(page.locator('#page-today h1')).toHaveText('Today', { timeout: 15000 });
  await page.locator('#loadingScreen').waitFor({ state: 'detached' });
  // Never run against a real project: the config must be empty (offline tests) or local.
  const url = await page.evaluate(() => window.GYM_CLOUD_CONFIG && window.GYM_CLOUD_CONFIG.url);
  if (url) expect(url).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):/);
  const close = page.locator('#installClose');
  if (await close.isVisible()) await close.click();
}

export async function tab(page, name) {
  await page.locator(`.nav-btn[data-page="${name}"]`).click();
  await expect(page.locator(`#page-${name}`)).toHaveClass(/active/);
}

/** Answers the open prompt sheet. */
export async function fillPrompt(page, value) {
  const sheet = page.locator('.sheet-backdrop.open .sheet').last();
  await sheet.locator('input[name=value]').fill(value);
  await sheet.locator('[type=submit]').click();
}

export async function sheetAction(page, label) {
  await page.locator('.sheet-backdrop.open .sheet').last().getByRole('button', { name: label, exact: true }).click();
}

export async function createWorkout(page, name, exercises) {
  await tab(page, 'plan');
  await page.getByRole('button', { name: 'New workout' }).click();
  await fillPrompt(page, name);
  for (const ex of exercises) {
    await page.locator('#exSearch').fill(ex);
    await page.locator(`[data-add="${ex}"]`).click();
  }
  await page.locator('[data-close-editor]').click();
}

export async function scheduleToday(page, name) {
  await tab(page, 'plan');
  const dow = (new Date().getDay() + 6) % 7;
  await page.locator(`[data-day="${dow}"]`).click();
  await page.locator(`.sheet-backdrop.open [data-choose="${name}"]`).click();
}

export function newUser(prefix = 'u') {
  const tag = randomUUID().replace(/-/g, '').slice(0, 8);
  return { email: `${prefix}-${tag}@example.test`, password: 'test-password-123', username: `${prefix}_${tag}`.slice(0, 20) };
}

export async function signUp(page, user) {
  await page.locator('.page.active [data-open-settings]').first().click();
  await page.locator('[data-auth-mode="signup"]').click();
  const form = page.locator('#authForm');
  await form.locator('[name=email]').fill(user.email);
  await form.locator('[name=password]').fill(user.password);
  await form.locator('[name=username]').fill(user.username);
  await form.locator('[name=consent]').check();
  await form.locator('[type=submit]').click();
  await expect(page.locator('#page-settings h2').first()).toHaveText('@' + user.username, { timeout: 15000 });
  await expect(page.locator('#page-settings .status')).toHaveText(/Synced/, { timeout: 15000 });
}

export async function signIn(page, user) {
  await page.locator('.page.active [data-open-settings]').first().click();
  const form = page.locator('#authForm');
  await form.locator('[name=email]').fill(user.email);
  await form.locator('[name=password]').fill(user.password);
  await form.locator('[type=submit]').click();
  await expect(page.locator('#page-settings .status')).toHaveText(/Synced/, { timeout: 15000 });
}

export async function closeSettings(page) {
  await page.locator('[data-close-settings]').click();
}

/** Signs in through the UI as a user created with tests/integration/helpers.js makeUser. */
export async function signInAs(page, u) {
  await signIn(page, { email: u.email, password: u.password });
  await closeSettings(page);
}

/** Two signed-in browser pages for users who are already friends. */
export async function friendsPair(browser, prefix = 'p') {
  const { makeUser, uniqueName, befriend } = await import('../integration/helpers.js');
  const a = await makeUser(uniqueName(prefix + 'a'));
  const b = await makeUser(uniqueName(prefix + 'b'));
  await befriend(a, b);
  const pa = await (await newPhone(browser)).newPage();
  const pb = await (await newPhone(browser)).newPage();
  const errors = [trackErrors(pa), trackErrors(pb)];
  await open(pa); await signInAs(pa, a);
  await open(pb); await signInAs(pb, b);
  return { a, b, pa, pb, errors };
}
