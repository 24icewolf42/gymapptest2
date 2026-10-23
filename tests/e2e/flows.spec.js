// Account safety, workout sessions and navigation flows.
import { test, expect } from '@playwright/test';
import { trackErrors, open, tab, createWorkout, scheduleToday, newUser, signUp, closeSettings, sheetAction } from './helpers.js';

test('signing in with the keyboard shows the account, not a stuck form', async ({ page }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('kb'));
  await open(page);
  await page.locator('.page.active [data-open-settings]').click();
  await page.locator('#authForm [name=email]').fill(u.email);
  await page.locator('#authForm [name=password]').fill(u.password);
  await page.locator('#authForm [name=password]').press('Enter');
  await expect(page.locator('#page-settings h2').first()).toHaveText('@' + u.username, { timeout: 15000 });
  await expect(page.locator('#authForm')).toHaveCount(0);
});

test('sign-up requires the age confirmation', async ({ page }) => {
  const user = newUser('age');
  await open(page);
  await page.locator('.page.active [data-open-settings]').click();
  await page.locator('[data-auth-mode="signup"]').click();
  const form = page.locator('#authForm');
  await form.locator('[name=email]').fill(user.email);
  await form.locator('[name=password]').fill(user.password);
  await form.locator('[name=username]').fill(user.username);
  await form.locator('[type=submit]').click();
  await expect(form.locator('.form-error')).toContainText('14 or older');
  await form.locator('[data-privacy]').first().click();
  await expect(page.locator('.sheet-backdrop.open .sheet')).toContainText('What friends see');
});

test('upcoming days can be previewed but not logged in advance', async ({ page }) => {
  await page.route('**/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.GYM_CLOUD_CONFIG = {};' }));
  await open(page);
  await createWorkout(page, 'Daily', ['Plank']);
  for (let d = 0; d < 7; d++) {
    await page.locator(`[data-day="${d}"]`).click();
    await page.locator('.sheet-backdrop.open [data-choose="Daily"]').click();
  }
  await tab(page, 'today');
  await page.locator('[data-preview]').first().click();
  const sheet = page.locator('.sheet-backdrop.open .sheet');
  await expect(sheet).toContainText('Plank');
  await expect(sheet.getByRole('button', { name: /^Log / })).toHaveCount(0);
  await sheet.locator('[data-sheet-close]').click();
  const logs = await page.evaluate(() => localStorage.getItem('gymLogs'));
  expect(logs === null || logs === '{}').toBe(true);
});

test('editing an older workout leaves the running one untouched', async ({ page }) => {
  await page.route('**/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.GYM_CLOUD_CONFIG = {};' }));
  const errors = trackErrors(page);
  await page.addInitScript(() => {
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    const d = new Date(); d.setDate(d.getDate() - 7);
    const old = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    localStorage.setItem('gymLogs', JSON.stringify({ [old]: [{ id: 'old-1', day: 'Push', time: d.toISOString(), duration: 1200, exercises: [{ name: 'Push-up', target: '10', sets: [{ w: '0', r: '10', done: true }] }] }] }));
  });
  await open(page);
  await createWorkout(page, 'Push', ['Push-up']);
  await scheduleToday(page, 'Push');
  await tab(page, 'today');
  await page.locator('#startToday').click();
  await page.locator('#session .r').first().fill('25');
  await page.locator('#session .check').first().click();
  await page.locator('#sessionBack').click();
  // Edit last week's Push from the calendar.
  await tab(page, 'calendar');
  const oldDay = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('gymLogs')))[0]);
  await page.locator(`[data-day="${oldDay}"]`).click();
  await page.locator('.sheet-backdrop.open [data-edit]').click();
  await expect(page.locator('#sessionMain')).toHaveText('Save changes');
  await page.locator('#session .r').first().fill('12');
  await page.locator('#sessionMain').click();
  await sheetAction(page, 'Save workout');
  // Today's running workout still has its sets and timer.
  await expect(page.locator('#activeBar')).toBeVisible();
  await page.locator('#activeBar button').click();
  await expect(page.locator('#session .r').first()).toHaveValue('25');
  await expect(page.locator('#sessionMain')).toHaveText('Finish workout');
  expect(errors).toEqual([]);
});

test('back closes the innermost layer first, and a tab switch leaves no dead back step', async ({ page }) => {
  await page.route('**/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.GYM_CLOUD_CONFIG = {};' }));
  await open(page);
  await createWorkout(page, 'Legs', ['Leg Press']);
  await page.locator('[data-edit="Legs"]').click();
  await page.locator('[data-rename]').click();
  await expect(page.locator('.sheet-backdrop.open .sheet')).toBeVisible();
  await page.goBack();
  await expect(page.locator('.sheet-backdrop')).toHaveCount(0);
  await expect(page.locator('#page-plan h1')).toHaveText('Legs');
  await page.goBack();
  await expect(page.locator('#page-plan h1')).toHaveText('Plan');
  await page.goBack();
  await expect(page.locator('#page-today')).toHaveClass(/active/);
  // Leave the plan editor by switching tabs; one Back press then goes home.
  await tab(page, 'plan');
  await page.locator('[data-edit="Legs"]').click();
  await tab(page, 'stats');
  await page.goBack();
  await expect(page.locator('#page-today')).toHaveClass(/active/);
});

test('sign-out keeps unsynced data unless the user accepts losing it', async ({ browser }) => {
  const user = newUser('out');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await open(page);
  await signUp(page, user);
  await closeSettings(page);
  await createWorkout(page, 'Offline', ['Plank']);
  await ctx.setOffline(true);
  await page.locator('.page.active [data-open-settings]').click();
  await page.locator('[data-signout]').click();
  await sheetAction(page, 'Sign out and remove my data');
  await expect(page.locator('.sheet-backdrop.open .sheet')).toContainText('Not synced yet');
  await sheetAction(page, 'Keep my data');
  expect(Object.keys(await page.evaluate(() => JSON.parse(localStorage.getItem('gymCustomWorkouts'))))).toEqual(['Offline']);
  await ctx.setOffline(false);
  await page.locator('[data-signout]').click();
  await sheetAction(page, 'Sign out and remove my data');
  await expect(page.locator('#authForm')).toBeVisible({ timeout: 15000 });
  expect(await page.evaluate(() => localStorage.getItem('gymCustomWorkouts'))).toBeNull();
});

test('the account-switch question blocks syncing until it is answered', async ({ browser }) => {
  const { makeUser, uniqueName, adminClient } = await import('../integration/helpers.js');
  const first = newUser('sw1');
  const second = await makeUser(uniqueName('sw2'));
  const page = await (await browser.newContext()).newPage();
  await open(page);
  await createWorkout(page, 'Private routine', ['Plank']);
  await signUp(page, first);
  await page.locator('[data-signout]').click();
  await sheetAction(page, 'Sign out, keep data here');
  await page.locator('[data-auth-mode="signin"]').click();
  await page.locator('#authForm [name=email]').fill(second.email);
  await page.locator('#authForm [name=password]').fill(second.password);
  await page.locator('#authForm [type=submit]').click();
  await expect(page.getByText('Someone else used this phone')).toBeVisible({ timeout: 15000 });
  // Coming back to the app or going online must not upload anything meanwhile.
  await page.evaluate(() => { window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(1500);
  await sheetAction(page, 'Cancel and sign out');
  const plan = await adminClient().from('workout_plans').select('plan').eq('user_id', second.id).maybeSingle();
  expect(plan.data).toBeNull();
});

test('after deleting an account, the next account is asked before taking the data', async ({ browser }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const doomed = newUser('del');
  const next = await makeUser(uniqueName('next'));
  const page = await (await browser.newContext()).newPage();
  await open(page);
  await createWorkout(page, 'Keep me', ['Plank']);
  await signUp(page, doomed);
  await page.locator('[data-delete-account]').click();
  const sheet = page.locator('.sheet-backdrop.open .sheet');
  await sheet.locator('[name=confirm]').fill('DELETE');
  await sheet.locator('[name=wipe]').uncheck();
  await sheet.locator('[type=submit]').click();
  await expect(page.locator('#authForm')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-auth-mode="signin"]').click();
  await page.locator('#authForm [name=email]').fill(next.email);
  await page.locator('#authForm [name=password]').fill(next.password);
  await page.locator('#authForm [type=submit]').click();
  await expect(page.getByText('Someone else used this phone')).toBeVisible({ timeout: 15000 });
  await sheetAction(page, 'Replace with my account’s data');
  await expect(page.locator('#page-settings .status')).toHaveText(/Synced/, { timeout: 15000 });
  expect(await page.evaluate(() => localStorage.getItem('gymCustomWorkouts') || '{}')).not.toContain('Keep me');
});
