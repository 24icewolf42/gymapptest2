// Accounts, sync, friends and gym dates against the local Supabase stack.
import { test, expect } from '@playwright/test';
import { trackErrors, open, tab, createWorkout, scheduleToday, newUser, signUp, signIn, closeSettings, sheetAction } from './helpers.js';

test('workouts sync between two devices, including deletions', async ({ browser }) => {
  const user = newUser('sync');
  const a = await (await browser.newContext()).newPage();
  const errors = trackErrors(a);
  await open(a);
  await createWorkout(a, 'Push', ['Push-up']);
  await scheduleToday(a, 'Push');
  await tab(a, 'today');
  await a.locator('#startToday').click();
  await a.locator('#session .r').first().fill('20');
  // Ticking the first set starts the timer, so the main button now finishes.
  await a.locator('#session .check').first().click();
  await expect(a.locator('#sessionMain')).toHaveText('Finish workout');
  await a.locator('#sessionMain').click();
  await sheetAction(a, 'Save workout');
  await signUp(a, user);

  const b = await (await browser.newContext()).newPage();
  const errorsB = trackErrors(b);
  await open(b);
  await signIn(b, user);
  await closeSettings(b);
  await expect(b.locator('.hero-title')).toHaveText('Push');
  await expect(b.locator('.hero-card.done')).toBeVisible();

  // Delete on device A, then B drops it on its next sync.
  await closeSettings(a);
  await tab(a, 'calendar');
  const today = await a.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('gymLogs')))[0]);
  await a.locator(`[data-day="${today}"]`).click();
  await a.locator('.sheet-backdrop.open [data-del]').click();
  await sheetAction(a, 'Delete');
  await expect(a.locator(`[data-day="${today}"]`)).not.toHaveClass(/logged/);
  const { adminClient } = await import('../integration/helpers.js');
  await expect.poll(async () => {
    const r = await adminClient().from('workout_data').select('logs,profiles!inner(username)').eq('profiles.username', user.username).maybeSingle();
    return r.data && Object.keys(r.data.logs).length;
  }, { timeout: 10000 }).toBe(0);
  await b.locator('.page.active [data-open-settings]').first().click();
  await b.locator('[data-sync]').click();
  await expect(b.locator('#page-settings .status')).toHaveText(/Synced/);
  await closeSettings(b);
  await expect(b.locator('.hero-card.done')).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(errorsB).toEqual([]);
});

test('friends plan a gym date and reply to it', async ({ browser }) => {
  const alex = newUser('alex'), sam = newUser('sam');
  const a = await (await browser.newContext()).newPage();
  const s = await (await browser.newContext()).newPage();
  const errors = [...[a, s].map(trackErrors)];
  await open(a); await signUp(a, alex); await closeSettings(a);
  await open(s); await signUp(s, sam); await closeSettings(s);

  // Alex adds Sam; Sam accepts.
  await tab(a, 'crew');
  await a.locator('[data-crew-tab="friends"]').click();
  await a.locator('#friendName').fill(sam.username);
  await a.locator('#addFriendForm [type=submit]').click();
  await expect(a.locator('#toast')).toContainText('Request sent');
  await tab(s, 'crew');
  await s.locator('[data-crew-tab="friends"]').click();
  await s.locator('[data-accept]').click();
  await expect(s.locator(`[data-key^="friend-"]`).filter({ hasText: '@' + alex.username })).toBeVisible();
  await expect(s.locator('[data-accept]')).toHaveCount(0);

  // Alex is heading to the gym in 30 minutes.
  await a.locator('[data-crew-tab="dates"]').click();
  await a.locator('[data-quick="30"]').click();
  await a.locator('.date-sheet [name=gym]').fill('McFit Mitte');
  await a.locator('.date-sheet [type=submit]').click();
  await expect(a.locator('.date-card.mine')).toContainText('McFit Mitte');

  // Sam sees it (badge + card) and says Going.
  await s.locator('[data-crew-tab="dates"]').click();
  await expect(s.locator('.date-card')).toContainText('McFit Mitte', { timeout: 10000 });
  await expect(s.locator('.nav-btn[data-page="crew"] .badge')).toHaveText('1');
  await s.locator('.date-card [data-reply="going"]').click();
  await expect(s.locator('.date-card [data-reply="going"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(s.locator('.nav-btn[data-page="crew"] .badge')).toBeHidden();
  await tab(s, 'today');
  await expect(s.locator('.teaser')).toContainText('McFit Mitte');

  // Alex sees Sam is going (via realtime or the next refresh).
  await expect(a.locator('.date-card.mine')).toContainText('2 going', { timeout: 15000 });

  // Alex cancels; it disappears for Sam.
  await a.locator('[data-cancel-date]').click();
  await sheetAction(a, 'Cancel date');
  await tab(s, 'crew');
  await expect(s.locator('.date-card')).toHaveCount(0, { timeout: 10000 });

  // Unfriend: Sam no longer sees Alex.
  await s.locator('[data-crew-tab="friends"]').click();
  await s.locator('[data-unfriend]').click();
  await sheetAction(s, 'Remove friend');
  await expect(s.getByText('No friends yet.')).toBeVisible();
  expect(errors.flat()).toEqual([]);
});

test('a different account signing in does not absorb the previous data', async ({ browser }) => {
  const first = newUser('one'), second = newUser('two');
  const p = await (await browser.newContext()).newPage();
  await open(p);
  await createWorkout(p, 'Secret routine', ['Plank']);
  await signUp(p, first);
  await p.locator('[data-signout]').click();
  await sheetAction(p, 'Sign out, keep data here');
  await expect(p.locator('#authForm')).toBeVisible();
  const form = p.locator('#authForm');
  await p.locator('[data-auth-mode="signup"]').click();
  await form.locator('[name=email]').fill(second.email);
  await form.locator('[name=password]').fill(second.password);
  await form.locator('[name=username]').fill(second.username);
  await form.locator('[name=consent]').check();
  await form.locator('[type=submit]').click();
  await expect(p.getByText('Someone else used this phone')).toBeVisible({ timeout: 15000 });
  await sheetAction(p, 'Replace with my account’s data');
  await expect(p.locator('#page-settings .status')).toHaveText(/Synced/, { timeout: 15000 });
  const workouts = await p.evaluate(() => JSON.parse(localStorage.getItem('gymCustomWorkouts') || '{}'));
  expect(Object.keys(workouts)).toEqual([]);
  expect(await p.evaluate(() => !!localStorage.getItem('gymBackupBeforeSwitch'))).toBe(true);
});

test('reads and writes the sync format of the original app version', async ({ page }) => {
  const { adminClient } = await import('../integration/helpers.js');
  const user = newUser('interop');
  await open(page);
  await signUp(page, user);
  const admin = adminClient();
  const uid = (await admin.from('profiles').select('id').eq('username', user.username).single()).data.id;
  const day = (o) => { const d = new Date(); d.setDate(d.getDate() + o); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const old = { day: 'Legs', time: new Date(Date.now() - 3 * 86400e3).toISOString(), duration: 1800, exercises: [{ name: 'Leg Press', target: '10', sets: [{ w: '100', r: '10', done: true }] }] };
  const gone = { id: 'deleted-elsewhere', day: 'Pull', time: new Date(Date.now() - 2 * 86400e3).toISOString(), exercises: [] };
  await admin.from('workout_data').upsert({
    user_id: uid,
    logs: { [day(-3)]: [old], [day(-2)]: [gone] },
    progress: { 'Leg Press': { sets: [{ w: '100', r: '10' }], updatedAt: Date.now() } },
    deleted_sessions: ['deleted-elsewhere'],
    bypass_days: { [day(-1)]: { value: true, updatedAt: Date.now() } },
  });
  await page.locator('[data-sync]').click();
  await expect(page.locator('#page-settings .status')).toHaveText(/Synced/);
  const local = await page.evaluate(() => ({ logs: JSON.parse(localStorage.getItem('gymLogs')), bypass: JSON.parse(localStorage.getItem('gymBypass')) }));
  expect(Object.keys(local.logs)).toEqual([day(-3)]);
  expect(local.bypass[day(-1)]).toBe(true);

  // Deleting here is recorded in the shared format so the original app drops it too.
  await closeSettings(page);
  await tab(page, 'calendar');
  await page.locator(`[data-day="${day(-3)}"]`).click();
  await page.locator('.sheet-backdrop.open [data-del]').click();
  await sheetAction(page, 'Delete');
  const key = `${day(-3)}|Legs|${old.time}`;
  await expect.poll(async () => (await admin.from('workout_data').select('deleted_sessions,daily_summaries,logs').eq('user_id', uid).single()).data.deleted_sessions, { timeout: 10000 }).toContain(key);
  const row = (await admin.from('workout_data').select('logs,daily_summaries').eq('user_id', uid).single()).data;
  expect(row.logs).toEqual({});
  expect(row.daily_summaries).toEqual({});
});
