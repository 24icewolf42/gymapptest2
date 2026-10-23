// Flows added after the second review: password reset by code, unblocking,
// declining and cancelling, the plan editor, undo, focus during background
// updates, editing old sessions, drafts and full storage.
import { test, expect, newPhone, open, tab, createWorkout, scheduleToday, sheetAction, fillPrompt, friendsPair, signInAs, trackErrors, newUser } from './helpers.js';

const offline = (page) => page.route('**/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.GYM_CLOUD_CONFIG = {};' }));

test('resets a forgotten password with the code from the email', async ({ page }) => {
  const { makeUser, uniqueName, adminClient, anonClient } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('reset'));
  await open(page);
  await page.locator('.page.active [data-open-settings]').click();
  await page.locator('[data-forgot]').click();
  await page.locator('.sheet-backdrop.open input[name=value]').fill(u.email);
  await sheetAction(page, 'Send email');
  // Read the code the email would contain.
  const link = await adminClient().auth.admin.generateLink({ type: 'recovery', email: u.email });
  const code = link.data.properties.email_otp;
  await page.locator('.sheet-backdrop.open input[name=value]').fill(code);
  await sheetAction(page, 'Continue');
  await expect(page.locator('.sheet-backdrop.open h2')).toHaveText('Choose a new password');
  await page.locator('.sheet-backdrop.open input[name=value]').fill('brand-new-password-1');
  await sheetAction(page, 'Save password');
  await expect(page.locator('#toast')).toContainText('Password changed');
  // Asked once only, and the new password works.
  await expect(page.locator('.sheet-backdrop.open')).toHaveCount(0);
  const r = await anonClient().auth.signInWithPassword({ email: u.email, password: 'brand-new-password-1' });
  expect(r.error).toBeNull();
});

test('declines, cancels and unblocks', async ({ browser }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const a = await makeUser(uniqueName('dc_a'));
  const b = await makeUser(uniqueName('dc_b'));
  const c = await makeUser(uniqueName('dc_c'));
  await b.client.from('friend_requests').insert({ requester_id: b.id, target_id: a.id, status: 'pending' });
  const pa = await (await newPhone(browser)).newPage();
  const errors = trackErrors(pa);
  await open(pa); await signInAs(pa, a);
  await tab(pa, 'crew');
  await pa.locator('[data-crew-tab="friends"]').click();
  // Decline B's request.
  await pa.locator('[data-decline]').click();
  await sheetAction(pa, 'Decline');
  await expect(pa.locator('[data-decline]')).toHaveCount(0);
  // Send C a request and cancel it.
  await pa.locator('#friendName').fill(c.username);
  await pa.locator('#addFriendForm [type=submit]').click();
  await expect(pa.locator('[data-cancel-request]')).toHaveCount(1);
  await pa.locator('[data-cancel-request]').click();
  await expect(pa.locator('[data-cancel-request]')).toHaveCount(0);
  // Block B from a new request, then unblock in Settings.
  await b.client.from('friend_requests').insert({ requester_id: b.id, target_id: a.id, status: 'pending' });
  await pa.locator('[data-crew-tab="ranking"]').click();
  await pa.locator('[data-crew-tab="friends"]').click();
  await pa.locator('[data-decline]').click();
  await sheetAction(pa, 'Decline and block');
  expect((await b.client.from('friend_requests').insert({ requester_id: b.id, target_id: a.id, status: 'pending' })).error).not.toBeNull();
  await pa.locator('.page.active [data-open-settings]').click();
  await pa.locator('[data-unblock]').click();
  await expect(pa.locator('[data-unblock]')).toHaveCount(0);
  expect((await b.client.from('friend_requests').insert({ requester_id: b.id, target_id: a.id, status: 'pending' })).error).toBeNull();
  expect(errors).toEqual([]);
});

test('plan editor controls change the right exercise and keep focus on it', async ({ page }) => {
  await offline(page);
  await open(page);
  await createWorkout(page, 'Upper', ['Pull-up', 'Dips', 'Plank']);
  await page.locator('[data-edit="Upper"]').click();
  const row = (name) => page.locator(`[data-ex="${name}"]`);
  // Move Plank up twice with the keyboard; focus follows it.
  await row('Plank').locator('[data-move="-1"]').focus();
  await page.keyboard.press('Enter');
  await expect(row('Plank').locator('[data-move="-1"]')).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await page.locator('[data-ex]').evaluateAll((els) => els.map((e) => e.dataset.ex))).toEqual(['Plank', 'Pull-up', 'Dips']);
  // Sets, rest, left/right and note on Dips only.
  await row('Dips').locator('[data-sets="1"]').click();
  await expect(row('Dips').locator('output')).toHaveText('3');
  await row('Dips').locator('select[data-field=rest]').selectOption('120');
  await row('Dips').locator('input[data-field=note]').fill('Lean forward');
  await row('Dips').locator('input[data-field=note]').press('Tab');
  await row('Pull-up').locator('input[data-field=unilateral]').check();
  const w = await page.evaluate(() => JSON.parse(localStorage.getItem('gymCustomWorkouts')).Upper);
  expect(w.find((e) => e.name === 'Dips')).toMatchObject({ sets: 3, rest: 120, note: 'Lean forward' });
  expect(w.find((e) => e.name === 'Pull-up')).toMatchObject({ unilateral: true, sides: 'both', sets: 4 });
  // Remove with Undo.
  await row('Plank').locator('[data-remove]').click();
  await expect(row('Plank')).toHaveCount(0);
  await page.locator('#toast .toast-action').click();
  await expect(row('Plank')).toHaveCount(1);
});

test('weigh-in and workout deletions can be undone', async ({ page }) => {
  await offline(page);
  await page.addInitScript(() => {
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    const d = new Date(); d.setDate(d.getDate() - 2);
    const day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    localStorage.setItem('gymLogs', JSON.stringify({ [day]: [{ id: 's1', day: 'Push', time: d.toISOString(), exercises: [{ name: 'Dips', target: '8', sets: [{ w: '10', r: '8', done: true }] }] }] }));
    localStorage.setItem('bodyWeightLogs', JSON.stringify([{ date: day, weight: 70 }]));
  });
  await open(page);
  await tab(page, 'stats');
  await page.locator('[data-toggle-entries]').click();
  await page.locator('[data-del-weight]').click();
  await page.locator('#toast .toast-action').click();
  await expect(page.locator('#weightCard .big-num')).toContainText('70');
  await tab(page, 'calendar');
  const day = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('gymLogs')))[0]);
  await page.locator(`[data-day="${day}"]`).click();
  await page.locator('.sheet-backdrop.open [data-del]').click();
  await sheetAction(page, 'Delete');
  await expect(page.locator(`[data-day="${day}"]`)).not.toHaveClass(/logged/);
  await page.locator('#toast .toast-action').click();
  await expect(page.locator(`[data-day="${day}"]`)).toHaveClass(/logged/);
});

test('keyboard focus on a reply button survives a background refresh', async ({ browser }) => {
  const { pa, pb, errors } = await friendsPair(browser, 'kf');
  await tab(pa, 'crew');
  await pa.locator('[data-quick="60"]').click();
  await pa.locator('.sheet-backdrop.open .date-sheet [name=gym]').fill('Focus Gym');
  await pa.locator('.sheet-backdrop.open .date-sheet [type=submit]').click();
  await tab(pb, 'crew');
  const maybe = pb.locator('.date-card', { hasText: 'Focus Gym' }).locator('[data-reply="maybe"]');
  await maybe.focus();
  await pb.keyboard.press('Enter');
  await expect(maybe).toHaveAttribute('aria-checked', 'true');
  await expect(maybe).toBeFocused();
  // Another date arrives and the list refreshes in the background.
  await pa.locator('[data-quick="0"]').click();
  await pa.locator('.sheet-backdrop.open .date-sheet [name=gym]').fill('Second Gym');
  await pa.locator('.sheet-backdrop.open .date-sheet [type=submit]').click();
  await pb.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(pb.locator('.date-card', { hasText: 'Second Gym' })).toBeVisible({ timeout: 15000 });
  await expect(maybe).toBeFocused();
  expect(errors.flat()).toEqual([]);
});

test('editing an old session shows exactly what was logged', async ({ page }) => {
  await offline(page);
  await page.addInitScript(() => {
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    const d = new Date(); d.setDate(d.getDate() - 3);
    const day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    localStorage.setItem('gymCustomWorkouts', JSON.stringify({ Push: [{ name: 'Bench', cat: 'chest', sets: 2, target: '8', rest: 90, note: '' }, { name: 'Cable Fly', cat: 'chest', sets: 2, target: '12', rest: 60, note: '' }] }));
    localStorage.setItem('gymLastUsed', JSON.stringify({ 'Cable Fly': { sets: [{ w: '15', r: '12' }], updatedAt: 1 } }));
    localStorage.setItem('gymLogs', JSON.stringify({ [day]: [{ id: 'old', day: 'Push', time: d.toISOString(), exercises: [{ name: 'Bench', target: '8', sets: [{ w: '60', r: '8', done: true }] }, { name: 'Dips', target: '10', sets: [{ w: '0', r: '10', done: true }] }] }] }));
  });
  await open(page);
  await tab(page, 'calendar');
  const day = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('gymLogs')))[0]);
  await page.locator(`[data-day="${day}"]`).click();
  await page.locator('.sheet-backdrop.open [data-edit]').click();
  await expect(page.locator('#session h3')).toHaveText(['Bench', 'Dips']);
  await page.locator('#session .r').first().fill('9');
  await page.locator('#sessionMain').click();
  await sheetAction(page, 'Save workout');
  const saved = await page.evaluate((d) => JSON.parse(localStorage.getItem('gymLogs'))[d][0], day);
  expect(saved.exercises.map((e) => e.name)).toEqual(['Bench', 'Dips']);
  expect(saved.exercises[0].sets[0]).toMatchObject({ w: '60', r: '9' });
});

test('an unsaved workout for a past day can be reopened', async ({ page }) => {
  await offline(page);
  await open(page);
  await createWorkout(page, 'Legs', ['Leg Press']);
  await tab(page, 'calendar');
  const d = new Date(); d.setDate(d.getDate() - 1);
  const day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  await page.locator(`[data-day="${day}"]`).click();
  await page.locator('.sheet-backdrop.open [data-pick="Legs"]').click();
  await page.locator('#session .w').first().fill('100');
  await page.locator('#sessionBack').click();
  await expect(page.locator('#toast')).toContainText('Workout kept');
  await page.locator(`[data-day="${day}"]`).click();
  await page.locator('.sheet-backdrop.open [data-pick="Legs"]').click();
  await expect(page.locator('#session .w').first()).toHaveValue('100');
});

test('a workout is not lost when the phone storage is full', async ({ page }) => {
  await offline(page);
  await open(page);
  await createWorkout(page, 'Core', ['Plank']);
  await scheduleToday(page, 'Core');
  await tab(page, 'today');
  await page.locator('#startToday').click();
  await page.locator('#session .r').first().fill('60');
  await page.locator('#session .check').first().click();
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === 'gymLogs') throw new DOMException('full', 'QuotaExceededError'); return set.call(this, k, v); };
  });
  await page.locator('#sessionMain').click();
  await sheetAction(page, 'Save workout');
  await expect(page.locator('#toast')).toContainText('storage is full');
  await expect(page.locator('#session')).toBeVisible();
  const drafts = await page.evaluate(() => JSON.parse(localStorage.getItem('gymDrafts')));
  expect(Object.values(drafts)[0].ex.Plank[0]).toMatchObject({ r: '60', done: true });
});

test('a taken username at sign-up asks for another one', async ({ page }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const owner = await makeUser(uniqueName('taken'));
  const me = { ...newUser('tk'), username: owner.username };
  await open(page);
  await page.locator('.page.active [data-open-settings]').click();
  await page.locator('[data-auth-mode="signup"]').click();
  const form = page.locator('#authForm');
  await form.locator('[name=email]').fill(me.email);
  await form.locator('[name=password]').fill(me.password);
  await form.locator('[name=username]').fill(me.username);
  await form.locator('[name=consent]').check();
  await form.locator('[type=submit]').click();
  await expect(page.locator('.sheet-backdrop.open h2')).toHaveText('Choose another username', { timeout: 15000 });
  await fillPrompt(page, uniqueName('mine'));
  await expect(page.locator('#toast')).toContainText('Username saved');
});
