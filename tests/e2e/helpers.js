import { expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/** Collects uncaught page errors so each test can assert there were none. */
export function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(m.text())) errors.push(m.text()); });
  return errors;
}

export async function open(page, path = '/') {
  await page.goto(path);
  await expect(page.locator('#page-today h1')).toHaveText('Today');
  await page.locator('#loadingScreen').waitFor({ state: 'detached' });
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
  await page.locator(`.sheet [data-choose="${name}"]`).click();
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
