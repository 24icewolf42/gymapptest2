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
  await b.client.from('friend_requests').insert({ requester_id: b.id, target_id: a.id, status: 'pending' });
  expect((await b.client.from('friend_requests').select('id').eq('target_id', a.id)).data).toEqual([]);
  await pa.locator('.page.active [data-open-settings]').click();
  await pa.locator('[data-unblock]').click();
  await expect(pa.locator('[data-unblock]')).toHaveCount(0);
  await b.client.from('friend_requests').insert({ requester_id: b.id, target_id: a.id, status: 'pending' });
  expect((await b.client.from('friend_requests').select('id').eq('target_id', a.id)).data).toHaveLength(1);
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

test('a long weigh-in history syncs in batches and pages, and a weigh-in deleted elsewhere stays deleted', async ({ page }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('w450'));
  const day = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const now = new Date();
  const dates = Array.from({ length: 1100 }, (_, i) => day(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1099 + i)));
  const first = dates[0];
  // Deleted on another phone: this phone still has an old copy of it.
  await u.client.rpc('save_my_weights', { entries: [{ log_date: first, weight_kg: 180, fresh: true }] });
  await u.client.from('body_weight_logs').delete().eq('user_id', u.id).eq('log_date', first);
  await page.addInitScript((list) => {
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    localStorage.setItem('bodyWeightLogs', JSON.stringify(list.map((date, i) => ({ date, weight: i === 0 ? 180 : 70 + (i % 10) / 10 }))));
  }, dates);
  await open(page);
  await signInAs(page, u);
  expect((await u.client.from('body_weight_logs').select('log_date', { count: 'exact', head: true }).eq('user_id', u.id)).count).toBe(1099);
  expect((await u.client.from('body_weight_logs').select('log_date').eq('user_id', u.id).eq('log_date', first)).data).toEqual([]);
  // A second sync reads more rows than one server page: nothing may look deleted.
  await page.locator('.page.active [data-open-settings]').click();
  await page.locator('[data-sync]').click();
  await expect(page.locator('#page-settings .status')).toHaveText(/Synced/, { timeout: 15000 });
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bodyWeightLogs')).length)).toBe(1099);
});

test('a sync still running when the data is removed at sign-out does not bring it back', async ({ page }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('race'));
  await u.client.from('workout_data').insert({ user_id: u.id, logs: { '2026-10-01': [{ id: 'x1', day: 'Push', time: '2026-10-01T10:00:00Z', exercises: [{ name: 'Bench', target: '5', sets: [{ w: '100', r: '5', done: true }] }] }] }, progress: {} });
  await open(page);
  await signInAs(page, u);
  expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('gymLogs') || '{}')))).toEqual(['2026-10-01']);
  // A slow network from here on: reads take a while to come back.
  await page.route('**/rest/v1/{body_weight_logs,workout_data}*', async (r) => {
    if (r.request().method() === 'GET') await new Promise((res) => setTimeout(res, 1500));
    return r.continue();
  });
  await page.evaluate(async () => {
    const sync = await import('/js/cloud/sync.js');
    const store = await import('/js/core/store.js');
    const out = sync.signOut({ removeLocalData: true });
    // A workout change during the final sync queues another upload.
    setTimeout(() => store.emit('gym:logs-changed'), 1700);
    window.signOutResult = await out;
  });
  expect(await page.evaluate(() => window.signOutResult)).toBe('');
  await page.waitForTimeout(4000);
  expect(await page.evaluate(() => localStorage.getItem('gymLogs'))).toBeNull();
});

test('a workout open in one tab does not overwrite what another tab saved', async ({ browser }) => {
  const ctx = await newPhone(browser);
  await ctx.route('**/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.GYM_CLOUD_CONFIG = {};' }));
  const a = await ctx.newPage();
  await open(a);
  await createWorkout(a, 'Push', ['Dips']);
  await scheduleToday(a, 'Push');
  await tab(a, 'today');
  await a.locator('#startToday').click();
  await a.locator('#sessionMain').click();
  // Meanwhile a second tab adds a routine.
  const b = await ctx.newPage();
  await open(b);
  await createWorkout(b, 'Yoga', ['Plank']);
  await b.evaluate(() => {
    const logs = JSON.parse(localStorage.getItem('gymLogs') || '{}');
    logs['2026-01-05'] = [{ id: 'b1', day: 'Yoga', time: '2026-01-05T10:00:00.000Z', exercises: [{ name: 'Plank', target: '1', sets: [{ w: '', r: '60', done: true }] }] }];
    localStorage.setItem('gymLogs', JSON.stringify(logs));
  });
  await a.locator('#session .w').first().fill('10');
  await a.locator('#session .r').first().fill('8');
  await a.locator('#session .check').first().click();
  await a.locator('#session').getByRole('button', { name: 'Finish workout' }).click();
  await sheetAction(a, 'Save workout');
  await expect(a.locator('#session')).toBeHidden();
  const stored = await a.evaluate(() => ({ plan: Object.keys(JSON.parse(localStorage.getItem('gymCustomWorkouts'))), days: Object.keys(JSON.parse(localStorage.getItem('gymLogs'))) }));
  expect(stored.plan.sort()).toEqual(['Push', 'Yoga']);
  expect(stored.days).toHaveLength(2);
});

test('an unsaved extra workout of a day can be opened again', async ({ page }) => {
  await offline(page);
  await open(page);
  await createWorkout(page, 'Legs', ['Dips']);
  const yesterday = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
  // "Log another workout" opens a new session, not the logged one.
  const openFresh = () => page.evaluate(async (ds) => (await import('/js/ui/session.js')).openSession('Legs', ds, { fresh: true }), yesterday);
  await openFresh();
  await page.locator('#session .w').first().fill('120');
  await page.locator('#sessionBack').click();
  await expect(page.locator('#toast')).toContainText('Workout kept');
  await openFresh();
  await expect(page.locator('#session .w').first()).toHaveValue('120');
});

test('a link with someone else\'s session does not sign in or take this phone\'s data', async ({ page }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const other = await makeUser(uniqueName('csrf'));
  const { session } = (await other.client.auth.getSession()).data;
  await page.addInitScript(() => {
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    localStorage.setItem('bodyWeightLogs', JSON.stringify([{ date: '2026-10-20', weight: 48.3 }]));
  });
  await page.goto(`/#access_token=${session.access_token}&refresh_token=${session.refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`);
  await expect(page.locator('#page-today h1')).toHaveText('Today');
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('gymSyncState') || '{}').accountId ?? null)).toBeNull();
  expect((await other.client.from('body_weight_logs').select('log_date').eq('user_id', other.id)).data).toEqual([]);
});

test('removing the data at sign-out works offline with an expired session', async ({ page, context }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('offout'));
  await open(page);
  await signInAs(page, u);
  // An hour later, with no signal: the access token has expired.
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k));
    const s = JSON.parse(localStorage.getItem(key));
    s.expires_at = Math.floor(Date.now() / 1000) - 60;
    localStorage.setItem(key, JSON.stringify(s));
  });
  await context.setOffline(true);
  await page.locator('.page.active [data-open-settings]').click();
  await page.locator('[data-signout]').click();
  await sheetAction(page, 'Sign out and remove my data');
  await sheetAction(page, 'Remove anyway');
  await expect(page.locator('#authForm')).toBeVisible({ timeout: 15000 });
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('sb-')))).toEqual([]);
  await context.setOffline(false);
  await page.reload();
  await expect(page.locator('#page-today h1')).toHaveText('Today');
  await page.locator('.page.active [data-open-settings]').click();
  await expect(page.locator('#authForm')).toBeVisible();
});

test('restoring a backup brings back deleted workouts once, also after a day was cleared', async ({ page }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('rst'));
  const session = { id: 'x1', day: 'Push', time: '2026-10-01T10:00:00.000Z', exercises: [{ name: 'Dips', target: '8', sets: [{ w: '10', r: '8', done: true }] }] };
  // The original app cleared that day: the session's key and the date are both tombstoned.
  await u.client.from('workout_data').insert({ user_id: u.id, logs: {}, progress: {}, deleted_sessions: ['x1'], deleted_dates: { '2026-10-01': Date.parse('2026-10-02') } });
  await open(page);
  await signInAs(page, u);
  const backup = await page.evaluate(async (s) => {
    const { makeBackup } = await import('/js/domain/backup.js');
    const data = { gymLogs: JSON.stringify({ '2026-10-01': [s] }) };
    return makeBackup((k) => data[k] ?? null, 'test');
  }, session);
  const restore = async () => {
    await page.locator('.page.active [data-open-settings]').first().click();
    await page.locator('[data-restore]').click();
    await page.locator('.sheet textarea[name=paste]').fill(backup);
    await sheetAction(page, 'Restore pasted text');
    await sheetAction(page, 'Restore');
    await page.waitForEvent('load');
    await page.locator('.page.active [data-open-settings]').first().click();
    await expect(page.locator('#page-settings .status')).toHaveText(/Synced/, { timeout: 15000 });
    await page.locator('[data-close-settings]').click();
  };
  await restore();
  await restore();
  const cloud = (await u.client.from('workout_data').select('logs,deleted_dates').eq('user_id', u.id).single()).data;
  expect(cloud.logs['2026-10-01']).toHaveLength(1);
  expect(cloud.logs['2026-10-01'][0].exercises[0].name).toBe('Dips');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('gymLogs'))['2026-10-01'])).toHaveLength(1);
});

test('an account the phone\'s data did not come from must be confirmed, by name, before anything uploads', async ({ page }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('ask'));
  const { session } = (await u.client.auth.getSession()).data;
  await page.addInitScript(() => {
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    localStorage.setItem('bodyWeightLogs', JSON.stringify([{ date: '2026-10-20', weight: 48.3 }]));
  });
  await open(page);
  // Signed in without the app's form (here: a session set directly).
  await page.evaluate(async (s) => (await import('/js/cloud/client.js')).supabase.auth.setSession(s), { access_token: session.access_token, refresh_token: session.refresh_token });
  const sheet = page.locator('.sheet-backdrop.open [role=alertdialog]');
  await expect(sheet).toContainText(u.email);
  // It can't be dismissed by accident.
  await page.keyboard.press('Escape');
  await expect(sheet).toBeVisible();
  expect((await u.client.from('body_weight_logs').select('log_date').eq('user_id', u.id)).data).toEqual([]);
  await sheetAction(page, 'Sign out');
  await expect(page.locator('#toast')).toContainText('Nothing from this phone was added');
  expect((await u.client.from('body_weight_logs').select('log_date').eq('user_id', u.id)).data).toEqual([]);
});

test('signing in on one tab does not ask the question in the others', async ({ browser }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('tabs'));
  const ctx = await newPhone(browser);
  const one = await ctx.newPage();
  await open(one);
  await createWorkout(one, 'Push', ['Dips']);
  const two = await ctx.newPage();
  await open(two);
  await signInAs(two, u);
  await one.waitForTimeout(2000);
  await expect(one.locator('.sheet-backdrop.open')).toHaveCount(0);
  await expect(two.locator('.sheet-backdrop.open')).toHaveCount(0);
});

test('a taken username is asked about once, not at every start', async ({ page }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const taken = await makeUser(uniqueName('tk'));
  const user = newUser('tk2');
  await open(page);
  await page.locator('.page.active [data-open-settings]').first().click();
  await page.locator('[data-auth-mode="signup"]').click();
  const form = page.locator('#authForm');
  await form.locator('[name=email]').fill(user.email);
  await form.locator('[name=password]').fill(user.password);
  await form.locator('[name=username]').fill(taken.username);
  await form.locator('[name=consent]').check();
  await form.locator('[type=submit]').click();
  await expect(page.locator('.sheet-backdrop.open h2')).toHaveText('Choose another username', { timeout: 15000 });
  await sheetAction(page, 'Cancel');
  await page.reload();
  await expect(page.locator('#page-today h1')).toHaveText('Today');
  // Wait until the profile (which used to trigger the question) has loaded.
  await page.locator('.page.active [data-open-settings]').first().click();
  await expect(page.locator('#page-settings h2').first()).toHaveText(/^@user_/, { timeout: 15000 });
  await expect(page.locator('#page-settings .status')).toHaveText(/Synced/, { timeout: 15000 });
  await expect(page.locator('.sheet-backdrop.open')).toHaveCount(0);
});

test('after an error, the result of the next action is shown, and Ctrl+Z undoes', async ({ page }) => {
  await offline(page);
  await open(page);
  await tab(page, 'stats');
  await page.getByRole('button', { name: 'Log', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Enter a weight');
  await page.locator('#weightInput').fill('80.5');
  await page.getByRole('button', { name: 'Log', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Weight logged');
  await page.locator('[data-toggle-entries]').click();
  await page.locator('[data-del-weight]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-del-weight]')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-del-weight]')).toHaveCount(1);
});

test('a routine deleted in another tab while it is open is announced and can be kept', async ({ browser }) => {
  const ctx = await newPhone(browser);
  await ctx.route('**/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.GYM_CLOUD_CONFIG = {};' }));
  const a = await ctx.newPage();
  await open(a);
  await createWorkout(a, 'Legs', ['Plank']);
  await a.locator('[data-edit="Legs"]').click();
  await a.locator('[data-ex="Plank"] input[data-field=note]').fill('seat 4');
  const b = await ctx.newPage();
  await open(b);
  await b.evaluate(() => {
    const w = JSON.parse(localStorage.getItem('gymCustomWorkouts'));
    delete w.Legs;
    localStorage.setItem('gymCustomWorkouts', JSON.stringify(w));
  });
  await expect(a.locator('#toast')).toContainText('Legs was deleted or renamed');
  await expect(a.locator('#page-plan [data-key="mine"]')).toBeFocused();
  await a.locator('#toast .toast-action').click();
  // Back, with the editor open again.
  await expect(a.locator('#page-plan h1')).toHaveText('Legs');
  expect(await a.evaluate(() => JSON.parse(localStorage.getItem('gymCustomWorkouts')).Legs[0].note)).toBe('seat 4');
});

test('dialogs are described, toasts stay clear of the rest timer, and stacked sheets stay modal', async ({ page }) => {
  await offline(page);
  await open(page);
  // A confirm dialog is described by its message.
  await page.evaluate(async () => { (await import('/js/ui/sheet.js')).confirmDialog('Really?'); });
  const dlg = page.locator('.sheet-backdrop.open [role=dialog]');
  const descId = await dlg.getAttribute('aria-describedby');
  await expect(page.locator(`[id="${descId}"]`)).toHaveText('Really?');
  // A second sheet on top; the lower one closes by itself: the page must stay inert.
  await page.evaluate(async () => {
    const { openSheet } = await import('/js/ui/sheet.js');
    window.__lower = null;
    openSheet({ title: 'Lower', onMount: (s, finish) => { window.__lower = finish; } });
    await new Promise((r) => setTimeout(r, 50));
    openSheet({ title: 'Upper', dismissible: false, actions: [{ label: 'OK', value: 1 }] });
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => window.__lower(null));
  expect(await page.evaluate(() => [document.getElementById('app').inert, document.getElementById('bottomNav').inert])).toEqual([true, true]);
  await expect(page.locator('.sheet-backdrop.open [role=alertdialog]')).toBeVisible();
});

test('show more days, the Undo shortcut and the rest-timer toast behave', async ({ page }) => {
  await offline(page);
  await open(page);
  await createWorkout(page, 'Legs', ['Dips', 'Plank']);
  await page.evaluate(() => localStorage.setItem('gymPlanSchedule', JSON.stringify({ 0: 'Legs', 1: 'Legs', 2: 'Legs', 3: 'Legs', 4: 'Legs', 5: 'Legs', 6: 'Legs' })));
  await page.reload();
  await expect(page.locator('#page-today h1')).toHaveText('Today');
  for (let i = 0; i < 3; i++) { await page.locator('[data-more]').focus(); await page.keyboard.press('Enter'); }
  await expect(page.locator('[data-more]')).toHaveCount(0);
  const rows = await page.locator('#page-today [data-preview]').evaluateAll((els) => els.map((e) => e.dataset.preview));
  expect(await page.evaluate(() => document.activeElement.dataset.preview)).toBe(rows[42]);
  // Workout: the Undo toast for a removed set sits above the rest countdown.
  await page.locator('#startToday').click();
  await page.locator('#sessionMain').click();
  const card = page.locator('#session .ex-card').first();
  await card.locator('.w').first().fill('10');
  await card.locator('.r').first().fill('5');
  await card.locator('.check').first().click();
  await expect(page.locator('#restBar')).toBeVisible();
  await card.locator('.w').nth(1).fill('10');
  await card.locator('[data-remove]').click();
  await expect(page.locator('#toast .toast-action')).toBeVisible();
  const toast = await page.locator('#toast').boundingBox();
  const bar = await page.locator('#restBar').boundingBox();
  expect(toast.y + toast.height <= bar.y || toast.y >= bar.y + bar.height).toBe(true);
});

test('Undo: Ctrl+Z is ignored under a dialog, Escape dismisses it, and it goes away with its page', async ({ page }) => {
  await offline(page);
  await open(page);
  await createWorkout(page, 'Upper', ['Pull-up', 'Dips']);
  await page.locator('[data-edit="Upper"]').click();
  await page.locator('[data-ex="Dips"] [data-remove]').click();
  await expect(page.locator('#toast .toast-action')).toBeVisible();
  await page.evaluate(async () => { (await import('/js/ui/sheet.js')).confirmDialog('Open dialog'); });
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-ex="Dips"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet-backdrop.open')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#toast .toast-action')).toHaveCount(0);
  // A new Undo, then a page change: it goes.
  await page.locator('[data-ex="Pull-up"] [data-remove]').click();
  await expect(page.locator('#toast .toast-action')).toBeVisible();
  await tab(page, 'stats');
  await expect(page.locator('#toast.show')).toHaveCount(0);
});

test('a background message waits behind an Undo; the user\'s own next result replaces it', async ({ page }) => {
  await offline(page);
  await open(page);
  await createWorkout(page, 'Upper', ['Pull-up', 'Dips']);
  await page.locator('[data-edit="Upper"]').click();
  await page.locator('[data-ex="Dips"] [data-remove]').click();
  await page.evaluate(async () => (await import('/js/core/dom.js')).toast('A friend is going', { background: true }));
  await expect(page.locator('#toast .toast-action')).toBeVisible();
  await page.locator('[data-ex="Pull-up"] [data-sets="1"]').click();
  await expect(page.locator('#planStatus')).toHaveText(/Pull-up: \d+ sets/);
  await page.evaluate(async () => (await import('/js/core/dom.js')).toast('Saved by you'));
  await expect(page.locator('#toast')).toContainText('Saved by you');
});

test('the "someone else used this phone" question is asked only in the tab that signed in', async ({ browser }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const x = await makeUser(uniqueName('swx'));
  const y = await makeUser(uniqueName('swy'));
  const ctx = await newPhone(browser);
  const one = await ctx.newPage();
  await open(one);
  await signInAs(one, x);
  await createWorkout(one, 'Push', ['Dips']);
  await one.locator('.page.active [data-open-settings]').click();
  await one.locator('[data-signout]').click();
  await sheetAction(one, 'Sign out, keep data here');
  await expect(one.locator('#authForm')).toBeVisible({ timeout: 15000 });
  const two = await ctx.newPage();
  await open(two);
  await tab(two, 'stats');
  await two.locator('#weightInput').focus();
  await one.locator('#authForm [name=email]').fill(y.email);
  await one.locator('#authForm [name=password]').fill(y.password);
  await one.locator('#authForm [type=submit]').click();
  await expect(one.getByText('Someone else used this phone')).toBeVisible({ timeout: 15000 });
  // Positive signal: tab two knows another window handles the sign-in.
  await expect.poll(() => two.evaluate(async () => (await import('/js/cloud/sync.js')).account.status)).toBe('Finish signing in in the other window.');
  await expect(two.locator('.sheet-backdrop.open')).toHaveCount(0);
  await expect(two.locator('#weightInput')).toBeFocused();
  await sheetAction(one, 'Add them to my account');
  await expect(one.locator('#page-settings .status')).toHaveText(/Synced/, { timeout: 15000 });
});

test('the Undo goes when the workout closes, and is out of reach under a dialog', async ({ page }) => {
  await offline(page);
  await open(page);
  await createWorkout(page, 'Pull', ['Lat Pulldown']);
  await scheduleToday(page, 'Pull');
  await tab(page, 'today');
  await page.locator('#startToday').click();
  await page.locator('#sessionMain').click();
  const card = page.locator('#session .ex-card').first();
  await card.locator('.w').last().fill('10');
  await card.locator('[data-remove]').click();
  await expect(page.locator('#toast .toast-action')).toBeVisible();
  // A dialog opens: Tab can't reach the Undo behind it.
  await page.evaluate(async () => { (await import('/js/ui/sheet.js')).confirmDialog('Finish?'); });
  await expect.poll(() => page.evaluate(() => document.querySelector('#toast .toast-action')?.inert)).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => document.querySelector('#toast .toast-action')?.inert)).toBe(false);
  await page.locator('#sessionBack').click();
  await expect(page.locator('#toast .toast-action')).toHaveCount(0);
});

test('calendar: Today moves keyboard focus, and the chosen day keeps the tab stop', async ({ browser }) => {
  const ctx = await newPhone(browser);
  await ctx.route('**/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.GYM_CLOUD_CONFIG = {};' }));
  const page = await ctx.newPage();
  await open(page);
  await tab(page, 'calendar');
  const today = await page.evaluate(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
  await page.locator('[data-jump-today]').click();
  await expect(page.locator(`[data-day="${today}"]`)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  const chosen = await page.evaluate(() => document.activeElement.dataset.day);
  // A change from another tab re-renders the calendar.
  const other = await ctx.newPage();
  await open(other);
  await other.evaluate(() => localStorage.setItem('gymSettings', JSON.stringify({ weightStep: 2.5 })));
  await page.waitForTimeout(500);
  expect(await page.evaluate((d) => document.querySelector(`[data-day="${d}"]`).getAttribute('tabindex'), chosen)).toBe('0');
  // The Undo focus ring is visible against the toast.
  await page.evaluate(async () => (await import('/js/core/dom.js')).toast('Removed.', { action: { label: 'Undo', onClick: () => {} } }));
  await page.locator('#toast .toast-action').focus();
  const [ring, bg] = await page.evaluate(() => [getComputedStyle(document.querySelector('#toast .toast-action')).outlineColor, getComputedStyle(document.getElementById('toast')).backgroundColor]);
  expect(ring).not.toBe(bg);
});

test('signing out elsewhere removes Share without putting focus on Delete', async ({ browser }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('shr'));
  const ctx = await newPhone(browser);
  const page = await ctx.newPage();
  await open(page); await signInAs(page, u);
  await createWorkout(page, 'Upper', ['Dips']);
  await page.locator('[data-edit="Upper"]').click();
  await page.locator('[data-share]').focus();
  const other = await ctx.newPage();
  await open(other);
  await other.evaluate(async () => (await import('/js/cloud/client.js')).supabase.auth.signOut());
  await expect(page.locator('[data-share]')).toHaveCount(0, { timeout: 15000 });
  expect(await page.evaluate(() => document.activeElement.matches('.danger'))).toBe(false);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
});

test('closing the sheet while a gym date is being posted takes it back', async ({ browser }) => {
  const { pa, a, errors } = await friendsPair(browser, 'tb');
  await tab(pa, 'crew');
  await pa.route('**/rest/v1/gym_dates*', async (r) => {
    if (r.request().method() === 'POST') await new Promise((res) => setTimeout(res, 800));
    return r.continue();
  });
  await pa.locator('[data-quick="60"]').click();
  await pa.locator('.sheet-backdrop.open .date-sheet [name=gym]').fill('Taken Back Gym');
  await pa.locator('.sheet-backdrop.open .date-sheet [type=submit]').click();
  await pa.keyboard.press('Escape');
  await expect(pa.locator('#toast')).toContainText('taken back', { timeout: 15000 });
  const rows = (await a.client.from('gym_dates').select('cancelled_at').eq('gym', 'Taken Back Gym')).data;
  expect(rows).toHaveLength(1);
  expect(rows[0].cancelled_at).not.toBeNull();
  expect(errors.flat()).toEqual([]);
});

test('Try again keeps its place and says how it went', async ({ browser }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('rty'));
  const page = await (await newPhone(browser)).newPage();
  let fail = true;
  await page.route('**/rest/v1/rpc/my_blocks*', (r) => (fail ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"down"}' }) : r.continue()));
  await open(page); await signInAs(page, u);
  await page.locator('.page.active [data-open-settings]').click();
  const retry = page.locator('[data-retry-blocks]');
  await retry.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#toastAlert')).not.toBeEmpty();
  await expect(retry).toBeFocused();
  fail = false;
  await page.keyboard.press('Enter');
  await expect(page.locator('#toast')).toContainText('Loaded');
});

test('workouts that belong to no account are defused when they join one', async ({ page }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('dfg'));
  await page.addInitScript(() => {
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    localStorage.setItem('gymCustomWorkouts', JSON.stringify({ 'Push<img src=x onerror=alert(1)>': [{ name: 'Dips', cat: 'chest', sets: 2, target: '8', rest: 60, note: '' }], 'Arms <3': [{ name: 'Curl', cat: 'arms', sets: 2, target: '10', rest: 60, note: '' }] }));
  });
  await open(page);
  await signInAs(page, u);
  const plan = (await u.client.from('workout_plans').select('plan').eq('user_id', u.id).single()).data.plan;
  expect(Object.keys(plan.workouts).sort()).toEqual(['Arms <3', 'Push‹img src=x onerror=alert(1)>']);
});

test('prompts describe their field, the Undo ring is solid, and Escape in a workout only dismisses the Undo', async ({ page }) => {
  await offline(page);
  await open(page);
  await page.evaluate(async () => { (await import('/js/ui/sheet.js')).promptDialog({ title: 'Choose another username', label: 'Username', hint: '@anna was already taken, so you got @user_1 for now.' }); });
  const input = page.locator('.sheet-backdrop.open input[name=value]');
  const ids = (await input.getAttribute('aria-describedby')).split(' ');
  await expect(page.locator(`[id="${ids[0]}"]`)).toContainText('was already taken');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => [...document.styleSheets].flatMap((s) => [...s.cssRules]).some((r) => r.selectorText === '.toast-action:focus-visible' && r.style.outlineStyle === 'solid' && parseFloat(r.style.outlineWidth) >= 2))).toBe(true);
  await createWorkout(page, 'Pull', ['Lat Pulldown']);
  await scheduleToday(page, 'Pull');
  await tab(page, 'today');
  await page.locator('#startToday').click();
  await page.locator('#sessionMain').click();
  const card = page.locator('#session .ex-card').first();
  await card.locator('.w').last().fill('10');
  await card.locator('[data-remove]').click();
  await expect(page.locator('#toast .toast-action')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#toast .toast-action')).toHaveCount(0);
  await expect(page.locator('#session')).toBeVisible();
});

test('an Undo shown while a dialog is open waits behind it', async ({ page }) => {
  await offline(page);
  await open(page);
  await page.evaluate(async () => {
    (await import('/js/ui/sheet.js')).confirmDialog('Busy');
    await new Promise((r) => setTimeout(r, 50));
    (await import('/js/core/dom.js')).toast('Removed.', { action: { label: 'Undo', onClick: () => {} } });
  });
  expect(await page.evaluate(() => document.querySelector('#toast .toast-action').inert)).toBe(true);
});

test('an available update is offered in Settings and announced, not laid over the page', async ({ page }) => {
  await offline(page);
  await page.route('**/Version*', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: '9.9.9' }) }));
  await open(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('gym:check-update', { detail: { manual: false } })));
  await expect(page.locator('#toast')).toContainText('Open Settings');
  await page.locator('.page.active [data-open-settings]').click();
  await expect(page.locator('[data-apply-update]')).toBeVisible();
});

test('Crew "Try again" stays in place, then reports success', async ({ browser }) => {
  const { pa, errors } = await friendsPair(browser, 'crt');
  let fail = true;
  await pa.route('**/rest/v1/gym_dates*', (r) => (fail && r.request().method() === 'GET' ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"down"}' }) : r.continue()));
  await tab(pa, 'crew');
  await pa.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const retry = pa.locator('[data-retry]').first();
  await expect(retry).toBeVisible();
  await retry.focus();
  await pa.keyboard.press('Enter');
  await expect(pa.locator('#toastAlert')).not.toBeEmpty();
  await expect(retry).toBeFocused();
  fail = false;
  await pa.keyboard.press('Enter');
  await expect(pa.locator('#toast')).toContainText('Loaded');
  await expect(pa.locator('#crew-tab-dates')).toBeFocused();
  errors[0].length = 0;
  expect(errors.flat()).toEqual([]);
});

test('an upgrading phone keeps names the account already has, and "|" stays in a routine name', async ({ page }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('upg'));
  const routine = [{ name: 'Dips', cat: 'chest', sets: 2, target: '8', rest: 60, note: '' }];
  // The original app already synced these names to the account.
  await u.client.from('workout_plans').insert({ user_id: u.id, plan: { workouts: { 'Push <A>': routine, 'Legs | heavy': routine }, schedule: {} } });
  await page.addInitScript((r) => {
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    localStorage.setItem('gymCustomWorkouts', JSON.stringify({ 'Push <A>': r, 'Legs | heavy': r }));
  }, routine);
  await open(page);
  await signInAs(page, u);
  const plan = (await u.client.from('workout_plans').select('plan').eq('user_id', u.id).single()).data.plan;
  expect(Object.keys(plan.workouts).sort()).toEqual(['Legs | heavy', 'Push <A>']);
});

test('more than a URL\'s worth of gym dates still load', async ({ browser }) => {
  const { makeUser, uniqueName, befriend } = await import('../integration/helpers.js');
  const viewer = await makeUser(uniqueName('many'));
  for (let h = 0; h < 4; h++) {
    const host = await makeUser(uniqueName('mh' + h));
    await befriend(viewer, host);
    const rows = Array.from({ length: 20 }, (_, i) => ({ host_id: host.id, starts_at: new Date(Date.now() + (i + 1 + h * 0.1) * 3600000).toISOString(), gym: 'G' + h }));
    expect((await host.client.from('gym_dates').insert(rows)).error).toBeNull();
  }
  const page = await (await newPhone(browser)).newPage();
  await open(page); await signInAs(page, viewer);
  await tab(page, 'crew');
  await expect(page.locator('.date-card')).toHaveCount(80, { timeout: 20000 });
});

test('data left on a shared phone neither carries markup into a known routine nor deletes the account\'s routines', async ({ page }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('s9'));
  const ex = (name) => ({ name, cat: 'chest', sets: 2, target: '8', rest: 60, note: '' });
  await u.client.from('workout_plans').insert({ user_id: u.id, plan: { workouts: { Push: [ex('Bench')], Legs: [ex('Squat')] }, schedule: {} } });
  await page.addInitScript((routine) => {
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    // Someone else used the phone without an account: edited Push and deleted Legs.
    localStorage.setItem('gymCustomWorkouts', JSON.stringify({ Push: [routine[0], { ...routine[0], name: '<b>x</b>' }] }));
    localStorage.setItem('gymDeletedWorkouts', JSON.stringify(['Legs']));
  }, [ex('Bench')]);
  await open(page);
  await signInAs(page, u);
  const plan = (await u.client.from('workout_plans').select('plan').eq('user_id', u.id).single()).data.plan;
  expect(Object.keys(plan.workouts).sort()).toEqual(['Legs', 'Push']);
  expect(plan.workouts.Push.map((e) => e.name)).toEqual(['Bench', '‹b>x‹/b>']);
});

test('what is added after a sign-out that kept the data is defused at the next sign-in', async ({ page }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('s92'));
  await open(page);
  await signInAs(page, u);
  await page.locator('.page.active [data-open-settings]').click();
  await page.locator('[data-signout]').click();
  await sheetAction(page, 'Sign out, keep data here');
  await expect(page.locator('#authForm')).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => {
    const w = JSON.parse(localStorage.getItem('gymCustomWorkouts') || '{}');
    w['<i>Evil</i>'] = [{ name: 'Dips', cat: 'chest', sets: 2, target: '8', rest: 60, note: '' }];
    localStorage.setItem('gymCustomWorkouts', JSON.stringify(w));
  });
  await page.reload();
  await expect(page.locator('#page-today h1')).toHaveText('Today');
  await signInAs(page, u);
  const plan = (await u.client.from('workout_plans').select('plan').eq('user_id', u.id).single()).data.plan;
  expect(Object.keys(plan.workouts)).toEqual(['‹i>Evil‹/i>']);
});

test('restoring your own backup keeps names the account has and defuses only what is new', async ({ page }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('rsn'));
  const ex = [{ name: 'Dips', cat: 'chest', sets: 2, target: '8', rest: 60, note: '' }];
  await u.client.from('workout_plans').insert({ user_id: u.id, plan: { workouts: { 'Push <A>': ex }, schedule: {} } });
  await open(page);
  await signInAs(page, u);
  const backup = await page.evaluate(async (e) => {
    const { makeBackup } = await import('/js/domain/backup.js');
    const data = { gymLogs: '{}', gymCustomWorkouts: JSON.stringify({ 'Push <A>': e, '<i>New</i>': e }) };
    return makeBackup((k) => data[k] ?? null, 'test');
  }, ex);
  await page.locator('.page.active [data-open-settings]').first().click();
  await page.locator('[data-restore]').click();
  await page.locator('.sheet textarea[name=paste]').fill(backup);
  await sheetAction(page, 'Restore pasted text');
  await sheetAction(page, 'Restore');
  await page.waitForEvent('load');
  await page.locator('.page.active [data-open-settings]').first().click();
  await expect(page.locator('#page-settings .status')).toHaveText(/Synced/, { timeout: 15000 });
  const plan = (await u.client.from('workout_plans').select('plan').eq('user_id', u.id).single()).data.plan;
  expect(Object.keys(plan.workouts).sort()).toEqual(['Push <A>', '‹i>New‹/i>']);
});
