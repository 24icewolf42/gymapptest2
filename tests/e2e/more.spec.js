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
  // Once the email is sent (a code made earlier would be replaced by it), read the code it would contain.
  await expect(page.locator('.sheet-backdrop.open h2')).toHaveText('Check your email');
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
  await expect(pa.locator('[data-accept]')).toHaveAttribute('aria-label', `Accept request from ${b.username}`);
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
  await expect(pa.locator('#toast')).toContainText('is blocked.'); // saved in the background
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
  await expect(page.locator('#session .ex-card h3')).toHaveText(['Bench', 'Dips']);
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
  await expect(page.locator('#authForm')).toBeVisible({ timeout: 8000 });
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
  await expect(pa.locator('.sheet-backdrop.open .form-status')).toHaveText('Posting…');
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
  // "Reload now" applies it (without a service worker: a plain reload).
  await Promise.all([page.waitForEvent('load'), page.locator('[data-apply-update]').click()]);
});

test('an update found while Settings is open appears there, and a second check says so', async ({ page }) => {
  await offline(page);
  await page.route('**/Version*', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: '9.9.9' }) }));
  await open(page);
  await page.locator('.page.active [data-open-settings]').click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('gym:check-update', { detail: { manual: false } })));
  await expect(page.locator('[data-apply-update]')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('just above');
  await expect(page.locator('#toast.show')).toHaveCount(0, { timeout: 10000 });
  await page.locator('[data-check-update]').click();
  await expect(page.locator('#toast.show')).toContainText('just above');
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
  // Every request that lists date ids stays short (no "URI too long" with hundreds of dates).
  const sizes = [];
  page.on('request', (r) => { const m = /date_id=in\.\(([^)]*)\)/.exec(decodeURIComponent(r.url())); if (m) sizes.push(m[1].split(',').length); });
  await open(page); await signInAs(page, viewer);
  await tab(page, 'crew');
  await expect(page.locator('.date-card')).toHaveCount(80, { timeout: 20000 });
  expect(sizes.length).toBeGreaterThan(0);
  expect(Math.max(...sizes)).toBeLessThanOrEqual(60);
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

test('a wrong password in one window does not make it ask when another window signs in', async ({ browser }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const x = await makeUser(uniqueName('wpx'));
  const y = await makeUser(uniqueName('wpy'));
  const ctx = await newPhone(browser);
  const one = await ctx.newPage();
  await open(one); await signInAs(one, x);
  await createWorkout(one, 'Push', ['Dips']);
  await one.locator('.page.active [data-open-settings]').click();
  await one.locator('[data-signout]').click();
  await sheetAction(one, 'Sign out, keep data here');
  await expect(one.locator('#authForm')).toBeVisible({ timeout: 15000 });
  // A mistyped password here...
  await one.locator('#authForm [name=email]').fill(y.email);
  await one.locator('#authForm [name=password]').fill('wrong-password-1');
  await one.locator('#authForm [type=submit]').click();
  await expect(one.locator('#authForm .form-error')).not.toBeEmpty();
  // ...then the sign-in happens in another window, which asks.
  const two = await ctx.newPage();
  await open(two);
  await two.locator('.page.active [data-open-settings]').click();
  await two.locator('#authForm [name=email]').fill(y.email);
  await two.locator('#authForm [name=password]').fill(y.password);
  await two.locator('#authForm [type=submit]').click();
  await expect(two.getByText('Someone else used this phone')).toBeVisible({ timeout: 15000 });
  await expect.poll(() => one.evaluate(async () => (await import('/js/cloud/sync.js')).account.status)).toBe('Finish signing in in the other window.');
  await expect(one.locator('.sheet-backdrop.open')).toHaveCount(0);
});

test('the signing window keeps saying it is asking for as long as its question is open', async ({ browser }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const x = await makeUser(uniqueName('hbx'));
  const y = await makeUser(uniqueName('hby'));
  const page = await (await newPhone(browser)).newPage();
  await page.clock.install();
  await open(page); await signInAs(page, x);
  await createWorkout(page, 'Push', ['Dips']);
  await page.locator('.page.active [data-open-settings]').click();
  await page.locator('[data-signout]').click();
  await sheetAction(page, 'Sign out, keep data here');
  await expect(page.locator('#authForm')).toBeVisible({ timeout: 15000 });
  await page.locator('#authForm [name=email]').fill(y.email);
  await page.locator('#authForm [name=password]').fill(y.password);
  await page.locator('#authForm [type=submit]').click();
  await expect(page.getByText('Someone else used this phone')).toBeVisible({ timeout: 15000 });
  await page.clock.runFor(180000); // three minutes with the question open
  const age = await page.evaluate(() => Date.now() - Number(localStorage.getItem('trackerAccountQuestionAt')));
  expect(age).toBeLessThan(4000);
});

test('the calendar keeps the visited day as tab stop when a refresh lands while focus is elsewhere', async ({ browser }) => {
  const ctx = await newPhone(browser);
  await ctx.route('**/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.GYM_CLOUD_CONFIG = {};' }));
  const page = await ctx.newPage();
  await open(page);
  await tab(page, 'calendar');
  await page.locator('[data-jump-today]').click();
  await page.keyboard.press('ArrowLeft');
  const chosen = await page.evaluate(() => document.activeElement.dataset.day);
  // Focus moves elsewhere (here: the Today button), then a refresh lands.
  await page.locator('[data-jump-today]').focus();
  const other = await ctx.newPage();
  await open(other);
  await other.evaluate(() => localStorage.setItem('gymSettings', JSON.stringify({ weightStep: 1 })));
  await page.waitForTimeout(300);
  expect(await page.evaluate((d) => document.querySelector(`[data-day="${d}"]`).getAttribute('tabindex'), chosen)).toBe('0');
});

test('a taken username keeps its prompt open with the reason', async ({ page }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const a = await makeUser(uniqueName('tk_a'));
  const b = await makeUser(uniqueName('tk_b'));
  await open(page); await signInAs(page, a);
  await page.locator('.page.active [data-open-settings]').click();
  await page.locator('[data-change-username]').click();
  await page.locator('.sheet-backdrop.open input[name=value]').fill(b.username);
  await sheetAction(page, 'Save');
  await expect(page.locator('.sheet-backdrop.open .form-error')).toHaveText('That username is taken.');
  await expect(page.locator('.sheet-backdrop.open input[name=value]')).toHaveValue(b.username);
});

test('a Crew retry reports only what it loaded, not another tab\'s old error', async ({ browser }) => {
  const { pa, errors } = await friendsPair(browser, 'cse');
  let failShared = true, failDates = true;
  await pa.route('**/rest/v1/shared_workouts*', (r) => (failShared ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"down"}' }) : r.continue()));
  await pa.route('**/rest/v1/gym_dates*', (r) => (failDates && r.request().method() === 'GET' ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"down"}' }) : r.continue()));
  await tab(pa, 'crew');
  await pa.locator('[data-crew-tab="friends"]').click();
  await expect(pa.locator('[data-retry]').first()).toBeVisible();
  await pa.locator('[data-crew-tab="dates"]').click();
  failDates = false;
  await pa.locator('[data-retry]').first().click();
  await expect(pa.locator('#toast')).toContainText('Loaded');
  errors[0].length = 0;
  expect(errors.flat()).toEqual([]);
});

test('a changed note on a known exercise is defused, and a backup cannot clear days', async ({ page }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('s10'));
  const ex = { name: 'Bench', cat: 'chest', sets: 2, target: '8', rest: 60, note: '' };
  await u.client.from('workout_plans').insert({ user_id: u.id, plan: { workouts: { Push: [ex] }, schedule: {} } });
  await u.client.from('workout_data').insert({ user_id: u.id, logs: { '2026-10-01': [{ id: 'k1', day: 'Push', time: '2026-10-01T10:00:00.000Z', exercises: [{ name: 'Bench', target: '8', sets: [{ w: '60', r: '8', done: true }] }] }] }, progress: {} });
  await open(page);
  await signInAs(page, u);
  const backup = await page.evaluate(async (e) => {
    const { makeBackup } = await import('/js/domain/backup.js');
    const data = {
      gymLogs: JSON.stringify({}),
      gymCustomWorkouts: JSON.stringify({ Push: [{ ...e, note: '<img src=x onerror=alert(1)>' }] }),
      gymDeletedLogDates: JSON.stringify({ '2026-10-01': Date.parse('2099-01-01') }),
    };
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
  expect(plan.workouts.Push[0].note).toBe('‹img src=x onerror=alert(1)>');
  const data = (await u.client.from('workout_data').select('logs,deleted_dates').eq('user_id', u.id).single()).data;
  expect(data.logs['2026-10-01']).toHaveLength(1);
});

test('a routine with a long name keeps its finished workout after syncing and can be used for a gym date', async ({ browser }) => {
  const { pa, errors } = await friendsPair(browser, 'lng');
  const name = 'Upper body strength day with extra arm work 01';
  await pa.evaluate((n) => {
    const w = JSON.parse(localStorage.getItem('gymCustomWorkouts') || '{}');
    w[n] = [{ name: 'Dips', cat: 'chest', sets: 1, target: '8', rest: 60, note: '' }];
    localStorage.setItem('gymCustomWorkouts', JSON.stringify(w));
    const dow = (new Date().getDay() + 6) % 7;
    localStorage.setItem('gymPlanSchedule', JSON.stringify({ [dow]: n }));
  }, name);
  await pa.reload();
  await expect(pa.locator('#page-today .hero-title')).toHaveText(name, { timeout: 15000 });
  await pa.locator('#startToday').click();
  await pa.locator('#sessionMain').click();
  await pa.locator('#session .w').first().fill('10');
  await pa.locator('#session .r').first().fill('8');
  await pa.locator('#session .check').first().click();
  await pa.locator('#session').getByRole('button', { name: 'Finish workout' }).click();
  await sheetAction(pa, 'Save workout');
  await expect(pa.locator('.hero-card.done')).toBeVisible();
  // After a sync it is still done (the name was not cut).
  await pa.evaluate(async () => (await import('/js/cloud/sync.js')).syncAll());
  await expect(pa.locator('.hero-card.done')).toBeVisible();
  await tab(pa, 'crew');
  await pa.locator('[data-quick="60"]').click();
  await pa.locator('.sheet-backdrop.open .date-sheet [name=gym]').fill('Long Gym');
  await pa.locator('.sheet-backdrop.open .date-sheet [type=submit]').click();
  await expect(pa.locator('.date-card', { hasText: 'Long Gym' })).toBeVisible({ timeout: 15000 });
  expect(errors.flat()).toEqual([]);
});

test('a saving prompt is sent once, can\'t be closed while saving, says so, and unlocks after a refusal', async ({ page }) => {
  await offline(page);
  await open(page);
  await page.evaluate(async () => {
    window.__calls = 0;
    window.__answers = ['That name is taken.', ''];
    (await import('/js/ui/sheet.js')).promptDialog({ title: 'Name', label: 'Name', submit: () => { window.__calls++; const a = window.__answers.shift(); return new Promise((r) => setTimeout(() => r(a), 1500)); } }).then((v) => { window.__result = v; });
  });
  const sheet = page.locator('.sheet-backdrop.open');
  const field = sheet.locator('input[name=value]');
  await field.fill('anna');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  const save = sheet.locator('[type=submit]');
  await expect(save).toHaveText('Saving…');
  await expect(sheet.locator('.form-status')).toHaveText('Saving…');
  expect(await field.evaluate((f) => f.readOnly)).toBe(true);
  await expect(sheet.getByRole('button', { name: 'Cancel' })).toHaveAttribute('aria-disabled', 'true');
  await expect(sheet.locator('[data-sheet-close]')).toHaveAttribute('aria-disabled', 'true');
  // None of the ways to close works while saving.
  await page.keyboard.press('Escape');
  await sheet.getByRole('button', { name: 'Cancel' }).dispatchEvent('click');
  await sheet.locator('[data-sheet-close]').dispatchEvent('click');
  await page.mouse.click(5, 5);
  await page.goBack();
  await expect(sheet).toBeVisible();
  // The refusal: back to normal, with the reason, and it can be closed again.
  await expect(sheet.locator('.form-error')).toHaveText('That name is taken.');
  await expect(save).toHaveText('Save');
  expect(await field.evaluate((f) => f.readOnly)).toBe(false);
  expect(await page.evaluate(() => window.__calls)).toBe(1);
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.sheet-backdrop.open')).toHaveCount(0);
});

test('background messages are not lost behind an error or each other', async ({ page }) => {
  await offline(page);
  await open(page);
  const seen = [];
  await page.exposeFunction('seen', (t) => seen.push(t));
  await page.evaluate(() => { const t = document.getElementById('toast'); new MutationObserver(() => window.seen(t.textContent)).observe(t, { childList: true, subtree: true }); });
  await page.evaluate(async () => {
    const { toast } = await import('/js/core/dom.js');
    toast('Sync failed.', { tone: 'error' });
    toast('An update is ready.', { background: true });
    toast('A friend is going to the gym.', { background: true });
  });
  await expect.poll(() => seen.includes('A friend is going to the gym.'), { timeout: 20000 }).toBe(true);
  expect(seen).toContain('An update is ready.');
});

test('a slow friend request does not erase the next name being typed', async ({ browser }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const { pa, errors } = await friendsPair(browser, 'fq');
  const c = await makeUser(uniqueName('fqc'));
  await pa.route('**/rest/v1/friend_requests*', async (r) => { if (r.request().method() === 'POST') await new Promise((res) => setTimeout(res, 1500)); return r.continue(); });
  await tab(pa, 'crew');
  await pa.locator('[data-crew-tab="friends"]').click();
  await pa.locator('#friendName').fill(c.username);
  await pa.keyboard.press('Enter');
  await pa.locator('#friendName').fill('next_frie');
  await expect(pa.locator('[data-cancel-request]')).toHaveCount(1, { timeout: 15000 });
  await expect(pa.locator('#friendName')).toHaveValue('next_frie');
  // A name sent while a request is on its way is sent next, not dropped.
  const d = await makeUser(uniqueName('fqd')), e2 = await makeUser(uniqueName('fqe'));
  await pa.locator('#friendName').fill(d.username);
  await pa.keyboard.press('Enter');
  await pa.locator('#friendName').fill(e2.username);
  await pa.keyboard.press('Enter');
  await expect(pa.locator('#toast')).toContainText('is sent next');
  await expect(pa.locator('[data-cancel-request]')).toHaveCount(3, { timeout: 20000 });
  expect(errors.flat()).toEqual([]);
});

test('the update button is busy while it works, and a later check reports the waiting update', async ({ page }) => {
  await offline(page);
  let version = '9.9.9';
  await page.route('**/Version*', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ version }) }));
  await open(page);
  await page.locator('.page.active [data-open-settings]').click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('gym:check-update', { detail: { manual: false } })));
  await expect(page.locator('[data-apply-update]')).toBeVisible();
  await page.evaluate(async () => {
    window.__applied = 0;
    (await import('/js/native.js')).updateOffer().apply = () => { window.__applied++; return new Promise((r) => setTimeout(r, 1500)); };
  });
  await page.locator('[data-apply-update]').click();
  await expect(page.locator('[data-apply-update]')).toHaveAttribute('aria-disabled', 'true');
  await page.locator('[data-apply-update]').click({ force: true }); // a second tap while busy
  await expect(page.locator('[data-apply-update]')).not.toHaveAttribute('aria-disabled', 'true', { timeout: 5000 });
  expect(await page.evaluate(() => window.__applied)).toBe(1);
  // The server now reports no newer version, but the found update still waits: a check says so.
  version = '0.0.1';
  await expect(page.locator('#toast.show')).toHaveCount(0, { timeout: 10000 });
  await page.locator('[data-check-update]').click();
  await expect(page.locator('#toast.show')).toContainText('just above');
});

test('a slow retry that succeeds leaves focus where the user moved to', async ({ browser }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('rsm'));
  const page = await (await newPhone(browser)).newPage(); // the refused request is the point here
  let fail = true;
  await page.route('**/rest/v1/rpc/my_blocks*', async (r) => {
    if (fail) return r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"down"}' });
    await new Promise((res) => setTimeout(res, 1200));
    return r.continue();
  });
  await open(page); await signInAs(page, u);
  await page.locator('.page.active [data-open-settings]').click();
  await expect(page.locator('[data-retry-blocks]')).toBeVisible();
  fail = false;
  await page.locator('[data-retry-blocks]').click();
  const chip = page.locator('[data-step]').first();
  await chip.focus();
  await expect(page.locator('#toast')).toContainText('Loaded');
  await expect(chip).toBeFocused();
});

test('the calendar remembers a visited day in each month', async ({ browser }) => {
  const ctx = await newPhone(browser);
  await ctx.route('**/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.GYM_CLOUD_CONFIG = {};' }));
  const page = await ctx.newPage();
  await open(page);
  await tab(page, 'calendar');
  const days = await page.evaluate(() => {
    const d = new Date();
    const f = (x) => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
    return [f(new Date(d.getFullYear(), d.getMonth(), 2)), f(new Date(d.getFullYear(), d.getMonth() + 1, 3))];
  });
  await page.locator(`[data-day="${days[0]}"]`).focus();
  await page.locator(`[data-day="${days[1]}"]`).focus();
  const other = await ctx.newPage();
  await open(other);
  await other.evaluate(() => localStorage.setItem('gymSettings', JSON.stringify({ weightStep: 0.5 })));
  await page.waitForTimeout(300);
  expect(await page.evaluate((ds) => ds.map((d) => document.querySelector(`[data-day="${d}"]`).getAttribute('tabindex')), days)).toEqual(['0', '0']);
});

test('an update found in the background does not replace an Undo', async ({ page }) => {
  await offline(page);
  await page.route('**/Version*', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: '9.9.9' }) }));
  await open(page);
  await createWorkout(page, 'Upper', ['Pull-up', 'Dips']);
  await page.locator('[data-edit="Upper"]').click();
  await page.locator('[data-ex="Dips"] [data-remove]').click();
  await expect(page.locator('#toast .toast-action')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('gym:check-update', { detail: { manual: false } })));
  await page.waitForTimeout(500);
  await expect(page.locator('#toast .toast-action')).toBeVisible();
});

test('a slow Crew retry that succeeds leaves focus where the user moved to', async ({ browser }) => {
  const { pa, errors } = await friendsPair(browser, 'csm');
  let fail = true;
  await pa.route('**/rest/v1/gym_dates*', async (r) => {
    if (r.request().method() !== 'GET') return r.continue();
    if (fail) return r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"down"}' });
    await new Promise((res) => setTimeout(res, 1200));
    return r.continue();
  });
  await tab(pa, 'crew');
  await pa.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(pa.locator('[data-retry]').first()).toBeVisible();
  fail = false;
  await pa.locator('[data-retry]').first().click();
  const chip = pa.locator('[data-quick="60"]');
  await chip.focus();
  await expect(pa.locator('#toast')).toContainText('Loaded');
  await expect(chip).toBeFocused();
  errors[0].length = 0;
  expect(errors.flat()).toEqual([]);
});

test('a defused name that is taken gets a number, and deletions alone on a phone never hit an account', async ({ page }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('s11'));
  const ex = [{ name: 'Dips', cat: 'chest', sets: 2, target: '8', rest: 60, note: '' }];
  await u.client.from('workout_plans').insert({ user_id: u.id, plan: { workouts: { Push: ex }, schedule: {} } });
  await page.addInitScript((e) => {
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    localStorage.setItem('gymCustomWorkouts', JSON.stringify({ 'Legs‹img src=x>': e, 'Legs<img src=x>': e }));
    localStorage.setItem('gymDeletedWorkouts', JSON.stringify(['Push']));
  }, ex);
  await open(page);
  await signInAs(page, u);
  const plan = (await u.client.from('workout_plans').select('plan').eq('user_id', u.id).single()).data.plan;
  expect(Object.keys(plan.workouts).sort()).toEqual(['Legs‹img src=x>', 'Legs‹img src=x> 2', 'Push']);
});

test('a session that ended while the app was closed makes the phone cautious', async ({ page }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('s112'));
  await open(page);
  await signInAs(page, u);
  // The session ends elsewhere (e.g. a password change) while the app is closed.
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k)));
  await page.reload();
  await expect(page.locator('#page-today h1')).toHaveText('Today');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('gymSyncState')).untrusted)).toEqual({ plan: true, data: true });
});

test('"Sign out on all devices" signs out the other devices too', async ({ browser }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('s113'));
  const phone = await (await newPhone(browser)).newPage();
  const tablet = await (await newPhone(browser)).newPage();
  await open(phone); await signInAs(phone, u);
  await open(tablet); await signInAs(tablet, u);
  await phone.locator('.page.active [data-open-settings]').click();
  await phone.locator('[data-signout]').click();
  await sheetAction(phone, 'Sign out on all devices');
  await expect(phone.locator('#authForm')).toBeVisible({ timeout: 15000 });
  // The tablet's session is no longer valid at the server.
  const ok = await tablet.evaluate(async () => {
    const { supabase } = await import('/js/cloud/client.js');
    const { data } = await supabase.auth.getSession();
    const r = await fetch(supabase.supabaseUrl + '/auth/v1/user', { headers: { apikey: supabase.supabaseKey, Authorization: 'Bearer ' + data.session?.access_token } });
    const refresh = await supabase.auth.refreshSession();
    return [r.status, !!refresh.error];
  });
  expect(ok[1]).toBe(true);
});

test('deletion records and ids seeded on a shared phone never make markup "known"', async ({ page }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('s12'));
  const evil = 'Legs<img src=x onerror=alert(1)>';
  const ex = [{ name: 'Dips', cat: 'chest', sets: 2, target: '8', rest: 60, note: '' }];
  // An earlier cycle left the raw name only as a deletion record in the account.
  await u.client.from('workout_plans').insert({ user_id: u.id, plan: { workouts: { Push: ex }, schedule: {}, deletedWorkouts: [evil] } });
  await page.addInitScript(({ e, x }) => {
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    localStorage.setItem('gymCustomWorkouts', JSON.stringify({ [e]: x, 'Arms<b>': x }));
    const d = new Date(), today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    localStorage.setItem('gymActive', JSON.stringify({ day: 'Arms<b>', date: today, key: 'new:x', startedAt: Date.now() }));
  }, { e: evil, x: ex });
  await open(page);
  await signInAs(page, u);
  const plan = (await u.client.from('workout_plans').select('plan').eq('user_id', u.id).single()).data.plan;
  expect(JSON.stringify(plan.workouts)).not.toContain('<img');
  expect(Object.keys(plan.workouts)).toContain('Arms‹b>');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('gymActive'))?.day)).toBe('Arms‹b>');
});

test('the user\'s own unsynced workout survives a sign-out and sign-in unchanged', async ({ page, context }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('own'));
  const ex = [{ name: 'Bench <B', cat: 'chest', sets: 1, target: '8', rest: 60, note: '' }];
  await u.client.from('workout_plans').insert({ user_id: u.id, plan: { workouts: { 'Push <A>': ex }, schedule: {} } });
  await open(page);
  await signInAs(page, u);
  // Logged offline, then signed out keeping the data.
  await context.setOffline(true);
  await page.evaluate(async () => {
    const st = await import('/js/state.js');
    st.state.logs['2026-10-20'] = [{ id: 'own1', day: 'Arms <C', time: '2026-10-20T10:00:00.000Z', exercises: [{ name: 'Curl <D', target: '8', sets: [{ w: '50', r: '8', done: true }] }] }];
    st.saveLogs();
  });
  await page.locator('.page.active [data-open-settings]').click();
  await page.locator('[data-signout]').click();
  await sheetAction(page, 'Sign out, keep data here');
  await expect(page.locator('#authForm')).toBeVisible({ timeout: 15000 });
  await context.setOffline(false);
  await page.locator('[data-close-settings]').click();
  await signInAs(page, u);
  const logs = (await u.client.from('workout_data').select('logs').eq('user_id', u.id).single()).data.logs;
  // Text the account never had, but logged by the user before signing out: unchanged.
  expect(logs['2026-10-20'][0]).toMatchObject({ day: 'Arms <C', exercises: [{ name: 'Curl <D' }] });
});

test('a saving prompt whose step fails unexpectedly is not left stuck', async ({ page }) => {
  await offline(page);
  await open(page);
  await page.evaluate(async () => { (await import('/js/ui/sheet.js')).promptDialog({ title: 'Name', label: 'Name', submit: async () => { throw new Error('Session ended'); } }); });
  await page.locator('.sheet-backdrop.open input[name=value]').fill('anna');
  await page.keyboard.press('Enter');
  await expect(page.locator('.sheet-backdrop.open .form-error')).toHaveText('Session ended');
  await expect(page.locator('.sheet-backdrop.open [type=submit]')).toHaveText('Save');
  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet-backdrop.open')).toHaveCount(0);
});

test('an exercise can be dragged by its grip to a new place (and the buttons still work)', async ({ page }) => {
  await offline(page);
  await open(page);
  await createWorkout(page, 'Upper', ['Pull-up', 'Dips', 'Plank']);
  await page.locator('[data-edit="Upper"]').click();
  const grip = page.locator('[data-ex="Plank"] [data-drag]');
  const target = page.locator('[data-ex="Pull-up"]');
  const g = await grip.boundingBox(), t = await target.boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, t.y + 5, { steps: 12 });
  await page.mouse.up();
  expect(await page.locator('[data-ex]').evaluateAll((els) => els.map((e) => e.dataset.ex))).toEqual(['Plank', 'Pull-up', 'Dips']);
  await expect(page.locator('#toast')).toContainText('Plank moved to position 1');
  await page.locator('[data-ex="Plank"] [data-move="1"]').click();
  expect(await page.locator('[data-ex]').evaluateAll((els) => els.map((e) => e.dataset.ex))).toEqual(['Pull-up', 'Plank', 'Dips']);
});

// ---- round 12: late answers, sheets that wait, the toast under dialogs ----

const removeDipsAndFocusUndo = async (page) => {
  await tab(page, 'plan');
  await page.locator('[data-edit="Upper"]').click();
  await page.locator('[data-ex="Dips"] [data-remove]').click();
  await page.locator('#toast .toast-action').focus();
};

test('late Crew answers wait behind an Undo the user got meanwhile', async ({ browser }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const { pa, errors } = await friendsPair(browser, 'lt');
  const c = await makeUser(uniqueName('ltc'));
  await createWorkout(pa, 'Upper', ['Pull-up', 'Dips', 'Plank']);
  const slow = (method) => async (r) => { if (r.request().method() === method) await new Promise((res) => setTimeout(res, 2500)); return r.continue(); };
  // The friend request's own message ("Request sent…").
  await pa.route('**/rest/v1/friend_requests*', slow('POST'));
  await tab(pa, 'crew');
  await pa.locator('[data-crew-tab="friends"]').click();
  let answer = pa.waitForResponse((r) => r.url().includes('/friend_requests') && r.request().method() === 'POST');
  await pa.locator('#friendName').fill(c.username);
  await pa.keyboard.press('Enter');
  await removeDipsAndFocusUndo(pa);
  await answer;
  await pa.waitForTimeout(300);
  await expect(pa.locator('#toast .toast-action')).toBeFocused();
  await pa.keyboard.press('Control+z');
  await expect(pa.locator('[data-ex="Dips"]')).toHaveCount(1);
  await expect(pa.locator('#toast')).toContainText('Request sent', { timeout: 5000 });
  // An act() answer ("Request cancelled.").
  await pa.unroute('**/rest/v1/friend_requests*');
  await pa.route('**/rest/v1/friend_requests*', slow('DELETE'));
  await tab(pa, 'crew');
  await pa.locator('[data-crew-tab="friends"]').click();
  answer = pa.waitForResponse((r) => r.url().includes('/friend_requests') && r.request().method() === 'DELETE');
  await pa.locator('[data-cancel-request]').click();
  await removeDipsAndFocusUndo(pa);
  await answer;
  await pa.waitForTimeout(300);
  await expect(pa.locator('#toast .toast-action')).toBeFocused();
  await expect(pa.locator('#toast')).toContainText('Dips removed');
  expect(errors.flat()).toEqual([]);
});

test('the answer to "Sync now" waits behind an Undo the user got meanwhile', async ({ page }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('sn'));
  await open(page); await signInAs(page, u);
  await createWorkout(page, 'Upper', ['Pull-up', 'Dips', 'Plank']);
  await page.locator('.page.active [data-open-settings]').click();
  let inFlight = 0;
  await page.route('**/rest/v1/**', async (r) => { inFlight++; await new Promise((res) => setTimeout(res, 800)); await r.continue(); inFlight--; });
  await page.locator('[data-sync]').click();
  await page.locator('[data-close-settings]').click();
  await removeDipsAndFocusUndo(page);
  await page.waitForTimeout(500);
  await expect.poll(() => inFlight, { timeout: 20000 }).toBe(0);
  await page.waitForTimeout(500);
  await expect(page.locator('#toast .toast-action')).toBeFocused();
  await expect(page.locator('#toast')).toContainText('Dips removed');
});

test('a late answer is shown at once when nothing newer came in between', async ({ page }) => {
  await offline(page);
  await open(page);
  const text = await page.evaluate(async () => {
    const { toast, toastLater } = await import('/js/core/dom.js');
    const later = toastLater();
    later('Done.');
    const now = document.getElementById('toast').textContent;
    const later2 = toastLater();
    toast('Plank removed.', { action: { label: 'Undo', onClick: () => {} } });
    later2('Synced.');
    return [now, document.getElementById('toast').textContent];
  });
  expect(text).toEqual(['Done.', 'Plank removed. Undo']);
});

test('signing out waits inside its sheet, and "Not synced yet" is asked from there', async ({ browser }) => {
  let page;
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('so'));
  page = await (await newPhone(browser)).newPage(); // the refused requests are the point here
  await open(page); await signInAs(page, u);
  await createWorkout(page, 'Offline', ['Plank']);
  await page.route('**/rest/v1/**', async (r) => { await new Promise((res) => setTimeout(res, 1500)); return r.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"down"}' }); });
  await page.locator('.page.active [data-open-settings]').click();
  await page.locator('[data-signout]').click();
  await sheetAction(page, 'Sign out and remove my data');
  const first = page.locator('.sheet-backdrop.open .sheet').first();
  await expect(first.locator('.form-status')).toHaveText('Syncing…');
  await expect(first.getByRole('button', { name: 'Cancel' })).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  await expect(first).toBeVisible();
  await expect(page.locator('.sheet-backdrop.open .sheet').last()).toContainText('Not synced yet', { timeout: 30000 });
  await expect(page.locator('.sheet-backdrop.open')).toHaveCount(2);
  await sheetAction(page, 'Stay signed in');
  await expect(page.locator('.sheet-backdrop.open')).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('still signed in');
  // The second step ("keep data here") waits in the sheet too.
  await page.locator('[data-signout]').click();
  await sheetAction(page, 'Sign out and remove my data');
  await expect(page.locator('.sheet-backdrop.open .sheet').last()).toContainText('Not synced yet', { timeout: 30000 });
  await page.route('**/auth/v1/logout*', async (r) => { await new Promise((res) => setTimeout(res, 1500)); return r.continue(); });
  await sheetAction(page, 'Sign out, keep data here');
  await expect(first.locator('.form-status')).toHaveText('Signing out…');
  await expect(first.getByRole('button', { name: 'Cancel' })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#toast')).toContainText('Your data stays on this phone', { timeout: 30000 });
});

test('a failed "Sign out on all devices" says so', async ({ page }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('se'));
  await open(page); await signInAs(page, u);
  await page.route('**/auth/v1/logout*', (r) => r.abort());
  await page.locator('.page.active [data-open-settings]').click();
  await page.locator('[data-signout]').click();
  await sheetAction(page, 'Sign out on all devices');
  await expect(page.locator('#toast')).toContainText('could not be signed out', { timeout: 20000 });
});

test('an APK that needs a reinstall shows the steps in Settings, not over the page', async ({ page }) => {
  await offline(page);
  await page.addInitScript(() => {
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        App: { getInfo: async () => ({ version: '3.0.0', build: '1' }), addListener: () => {} },
        ApkUpdater: { install: () => new Promise((res, rej) => setTimeout(() => rej(Object.assign(new Error('mismatch'), { code: 'SIGNATURE_MISMATCH' })), 1500)) },
      },
    };
    // The web page's CSP does not allow GitHub (the app's does): answer the release check here.
    const real = window.fetch;
    window.fetch = (url, opts) => (String(url).startsWith('https://api.github.com/')
      ? Promise.resolve(new Response(JSON.stringify({ name: 'Tracker v3.0.1 (build 2)' }), { headers: { 'Content-Type': 'application/json' } }))
      : real(url, opts));
  });
  await open(page);
  await page.locator('.page.active [data-open-settings]').click();
  await page.locator('[data-check-update]').click();
  await page.locator('[data-apply-update]').click();
  await page.locator('[data-close-settings]').click();
  await tab(page, 'plan');
  await page.locator('[data-new]').click();
  const field = page.locator('.sheet-backdrop.open input[name=value]');
  await field.pressSequentially('Push day A', { delay: 250 });
  await page.waitForTimeout(1500); // the install has failed by now
  await expect(page.locator('.sheet-backdrop.open')).toHaveCount(1);
  await expect(field).toHaveValue('Push day A');
  await expect(field).toBeFocused();
  await sheetAction(page, 'Cancel');
  // The message waited behind the dialog.
  await expect(page.locator('#toast')).toContainText('one-time reinstall', { timeout: 5000 });
  await page.locator('.page.active [data-open-settings]').click();
  await expect(page.locator('.update-notice')).toContainText('One-time reinstall needed');
  await expect(page.locator('.update-notice ol li')).toHaveCount(3);
});

test('a slow APK install answers behind an Undo; in Settings the steps take focus before the button', async ({ page }) => {
  await offline(page);
  await page.addInitScript(() => {
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        App: { getInfo: async () => ({ version: '3.0.0', build: '1' }), addListener: () => {} },
        ApkUpdater: { install: () => new Promise((res, rej) => setTimeout(() => rej(Object.assign(new Error('mismatch'), { code: 'SIGNATURE_MISMATCH' })), 1500)) },
      },
    };
    const real = window.fetch;
    window.fetch = (url, opts) => (String(url).startsWith('https://api.github.com/')
      ? Promise.resolve(new Response(JSON.stringify({ name: 'Tracker v3.0.1 (build 2)' }), { headers: { 'Content-Type': 'application/json' } }))
      : real(url, opts));
  });
  await open(page);
  await page.locator('.page.active [data-open-settings]').click();
  await page.locator('[data-check-update]').click();
  await page.locator('[data-apply-update]').click();
  await fakeUndo(page);
  await expect(page.locator('.update-notice ol li')).toHaveCount(3, { timeout: 5000 });
  await page.waitForTimeout(300);
  await expect(page.locator('#toast .toast-action')).toBeFocused();
  // Second run: the user stays on the button, so focus moves to the steps.
  await page.reload();
  await page.locator('.page.active [data-open-settings]').click();
  await page.locator('[data-check-update]').click();
  await page.locator('[data-apply-update]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.update-notice b')).toBeFocused({ timeout: 5000 });
  const order = await page.locator('.update-notice').evaluate((n) => [...n.children].map((c) => c.tagName));
  expect(order).toEqual(['B', 'P', 'OL', 'BUTTON']);
});

test('an Undo toast is hidden under a dialog and comes back after it, and a tap does not keep it forever', async ({ page }) => {
  await offline(page);
  await open(page);
  await createWorkout(page, 'Upper', ['Pull-up', 'Dips', 'Plank']);
  await page.locator('[data-edit="Upper"]').click();
  await page.locator('[data-ex="Dips"] [data-remove]').click();
  // A tap on the toast (not its button) does not hold it.
  const t = await page.locator('#toast').boundingBox();
  await page.touchscreen.tap(t.x + 8, t.y + t.height / 2);
  await expect(page.locator('#toast.show')).toHaveCount(0, { timeout: 14000 });
  // While a dialog is open the toast is not drawn over its buttons, and its time stands still.
  await page.locator('[data-ex="Plank"] [data-remove]').click();
  await page.locator('[data-delete]').click();
  const del = page.locator('.sheet-backdrop.open').getByRole('button', { name: 'Delete', exact: true });
  await expect(del).toBeVisible();
  await expect(page.locator('#toast')).toBeHidden();
  await page.waitForTimeout(11000);
  // Messages that arrive meanwhile wait (none overwrites another).
  const seen = [];
  await page.exposeFunction('seenToast', (t) => seen.push(t));
  await page.evaluate(() => { const t = document.getElementById('toast'); new MutationObserver(() => window.seenToast(t.textContent)).observe(t, { childList: true, subtree: true }); });
  await page.evaluate(async () => { const { toast } = await import('/js/core/dom.js'); toast('Request sent to @b.'); toast('Request sent to @c.'); });
  await sheetAction(page, 'Cancel');
  await expect(page.locator('#toast .toast-action')).toBeVisible();
  expect(seen).toContain('Plank removed. Undo'); // read again when it came back
  await page.locator('#toast .toast-action').click();
  await expect(page.locator('[data-ex="Plank"]')).toHaveCount(1);
  await expect.poll(() => seen.includes('Request sent to @b.') && seen.includes('Request sent to @c.'), { timeout: 15000 }).toBe(true);
  // After the dialog, an Undo has its time again: it goes by itself.
  await expect(page.locator('#toast.show')).toHaveCount(0, { timeout: 10000 });
  await page.locator('[data-ex="Plank"] [data-remove]').click();
  await page.locator('[data-delete]').click();
  await sheetAction(page, 'Cancel');
  await expect(page.locator('#toast .toast-action')).toBeVisible();
  await page.waitForTimeout(4500);
  await expect(page.locator('#toast .toast-action')).toBeVisible(); // 6 s after the dialog
  await expect(page.locator('#toast.show')).toHaveCount(0, { timeout: 4000 });
  // A plain message from before the dialog does not come back after it.
  await page.evaluate(async () => (await import('/js/core/dom.js')).toast('Dips added.'));
  await expect(page.locator('#toast.show')).toContainText('Dips added.');
  await page.locator('[data-delete]').click();
  await sheetAction(page, 'Cancel');
  await page.waitForTimeout(400);
  expect(await page.locator('#toast').evaluate((t) => t.classList.contains('show'))).toBe(false);
  // The dialog's own button takes a tap at its centre.
  await page.locator('[data-ex="Pull-up"] [data-remove]').click();
  await page.locator('[data-delete]').click();
  await page.waitForTimeout(300);
  const b = await del.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.locator('.sheet-backdrop.open')).toHaveCount(0);
  await expect(page.locator('[data-edit="Upper"]')).toHaveCount(0);
});

test('Share and the username wait inside their prompts and say what they do', async ({ page }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('sh'));
  await open(page); await signInAs(page, u);
  await createWorkout(page, 'Upper', ['Pull-up', 'Dips']);
  await page.locator('[data-edit="Upper"]').click();
  await page.route('**/rest/v1/shared_workouts*', async (r) => { if (r.request().method() === 'POST') await new Promise((res) => setTimeout(res, 1500)); return r.continue(); });
  await page.locator('[data-share]').click();
  await sheetAction(page, 'Share');
  const sheet = page.locator('.sheet-backdrop.open .sheet');
  await expect(sheet.locator('.form-status')).toHaveText('Sharing…');
  await expect(sheet.locator('[type=submit]')).toHaveText('Sharing…');
  await expect(sheet.locator('[data-sheet-close]')).toHaveAttribute('aria-disabled', 'true');
  await expect(sheet.locator('.form-status')).toHaveCSS('color', 'rgb(160, 168, 177)');
  await expect(sheet.locator('.form-status')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('.sheet-backdrop.open')).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator('#toast')).toContainText('Shared with your friends');
  await page.locator('[data-close-editor]').click();
  await page.locator('.page.active [data-open-settings]').click();
  await page.locator('[data-change-username]').click();
  const name = uniqueName('nn').slice(0, 20);
  await fillPrompt(page, name);
  await expect(page.locator('#toast')).toContainText(`Username changed to @${name.toLowerCase()}.`);
  // Change password: a refusal stays in the prompt; then it is saved, as typed.
  let refuse = true;
  await page.route('**/auth/v1/user*', (r) => {
    if (r.request().method() === 'PUT' && refuse) { refuse = false; return r.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ code: 422, error_code: 'weak_password', msg: 'Password is too weak.' }) }); }
    return r.continue();
  });
  await page.locator('[data-change-password]').click();
  const pw = page.locator('.sheet-backdrop.open .sheet');
  await pw.locator('input[name=value]').fill(' another pass 9 ');
  await sheetAction(page, 'Save password');
  await expect(pw.locator('.form-error')).toContainText('too weak');
  await sheetAction(page, 'Save password');
  await expect(page.locator('#toast')).toContainText('Password changed');
  const { anonClient } = await import('../integration/helpers.js');
  expect((await anonClient().auth.signInWithPassword({ email: u.email, password: ' another pass 9 ' })).error).toBeNull();
});

test('reset password: each step waits in its prompt, refusals stay there, and the new password is kept as typed', async ({ page }) => {
  const { makeUser, uniqueName, adminClient, anonClient } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('rp'));
  await open(page);
  await page.locator('.page.active [data-open-settings]').click();
  await page.locator('[data-forgot]').click();
  // A refused email step.
  let refuse = true;
  await page.route('**/auth/v1/recover*', async (r) => {
    await new Promise((res) => setTimeout(res, 1200));
    if (refuse) { refuse = false; return r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ code: 429, error_code: 'over_email_send_rate_limit', msg: 'Too many emails. Wait a minute.' }) }); }
    return r.continue();
  });
  const sheet = page.locator('.sheet-backdrop.open .sheet').last();
  await sheet.locator('input[name=value]').fill(u.email);
  await sheetAction(page, 'Send email');
  await expect(sheet.locator('.form-status')).toHaveText('Sending…');
  await expect(sheet.locator('.form-error')).not.toBeEmpty({ timeout: 10000 });
  await expect(sheet.locator('h2')).toHaveText('Reset password');
  await sheetAction(page, 'Send email');
  await expect(sheet.locator('h2')).toHaveText('Check your email', { timeout: 10000 });
  // A wrong code stays in its prompt.
  await page.route('**/auth/v1/verify*', async (r) => { await new Promise((res) => setTimeout(res, 800)); return r.continue(); });
  await sheet.locator('input[name=value]').fill('000000');
  await sheetAction(page, 'Continue');
  await expect(sheet.locator('.form-status')).toHaveText('Checking…');
  await expect(sheet.locator('.form-error')).not.toBeEmpty({ timeout: 10000 });
  await expect(sheet.locator('h2')).toHaveText('Check your email');
  const link = await adminClient().auth.admin.generateLink({ type: 'recovery', email: u.email });
  await sheet.locator('input[name=value]').fill(link.data.properties.email_otp);
  await sheetAction(page, 'Continue');
  await expect(sheet.locator('h2')).toHaveText('Choose a new password');
  // Required: a stray tap outside does not end it.
  await page.mouse.click(5, 5);
  await expect(sheet.locator('h2')).toHaveText('Choose a new password');
  // A refusal stays inside it.
  let refusePw = true;
  await page.route('**/auth/v1/user*', (r) => {
    if (r.request().method() === 'PUT' && refusePw) { refusePw = false; return r.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ code: 422, error_code: 'same_password', msg: 'New password should be different from the old password.' }) }); }
    return r.continue();
  });
  await sheet.locator('input[name=value]').fill('  gym rat pass  ');
  await sheetAction(page, 'Save password');
  await expect(sheet.locator('.form-error')).toContainText('different', { timeout: 10000 });
  await expect(sheet.locator('h2')).toHaveText('Choose a new password');
  await sheetAction(page, 'Save password');
  await expect(page.locator('#toast')).toContainText('Password changed', { timeout: 10000 });
  const r = await anonClient().auth.signInWithPassword({ email: u.email, password: '  gym rat pass  ' });
  expect(r.error).toBeNull();
});

test('a dragged exercise goes back to its place when the system cancels the drag', async ({ page }) => {
  await offline(page);
  await open(page);
  await createWorkout(page, 'Upper', ['Pull-up', 'Dips', 'Plank']);
  await page.locator('[data-edit="Upper"]').click();
  const grip = page.locator('[data-ex="Plank"] [data-drag]');
  const g = await grip.boundingBox(), t = await page.locator('[data-ex="Pull-up"]').boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, t.y + 5, { steps: 12 });
  await grip.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse' });
  await page.mouse.up();
  expect(await page.locator('[data-ex]').evaluateAll((els) => els.map((e) => e.dataset.ex))).toEqual(['Pull-up', 'Dips', 'Plank']);
  await expect(page.locator('#toast')).not.toContainText('moved to position');
});

// ---- round 13 ----

test('a routine the account deleted comes back (defused) when the user restores it from a backup', async ({ page }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('rdr'));
  const ex = [{ name: 'Dips', cat: 'chest', sets: 2, target: '8', rest: 60, note: '' }];
  await u.client.from('workout_plans').insert({ user_id: u.id, plan: { workouts: {}, schedule: {}, deletedWorkouts: ['Push <A>'] } });
  await open(page);
  await signInAs(page, u);
  const backup = await page.evaluate(async (e) => {
    const { makeBackup } = await import('/js/domain/backup.js');
    const data = { gymLogs: '{}', gymCustomWorkouts: JSON.stringify({ 'Push <A>': e }) };
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
  expect(Object.keys(plan.workouts)).toEqual(['Push ‹A>']);
  expect(Object.keys(await page.evaluate(() => JSON.parse(localStorage.getItem('gymCustomWorkouts'))))).toEqual(['Push ‹A>']);
});

test('a restore made while a sync is uploading is still checked at the next sync', async ({ page }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('rrc'));
  await open(page);
  await signInAs(page, u);
  let release, seen = false;
  const held = new Promise((r) => { release = r; });
  await page.route('**/rest/v1/workout_data*', async (r) => { if (r.request().method() !== 'GET' && !seen) { seen = true; await held; } return r.continue(); });
  await page.evaluate(async () => {
    const { state, saveLogs } = await import('/js/state.js');
    state.logs['2026-10-20'] = [{ id: 'mine-1', day: 'Push', time: '2026-10-20T10:00:00.000Z', exercises: [{ name: 'Dips', target: '8', sets: [{ w: '0', r: '8', done: true }] }] }];
    saveLogs();
  });
  await page.locator('.page.active [data-open-settings]').first().click();
  await page.locator('[data-sync]').click();
  await expect.poll(() => seen, { timeout: 10000 }).toBe(true);
  const backup = await page.evaluate(async () => {
    const { makeBackup } = await import('/js/domain/backup.js');
    const logs = { '2026-10-21': [{ id: 'foreign-1', day: 'Pull <img src=x>', time: '2026-10-21T10:00:00.000Z', exercises: [{ name: 'Row', target: '8', sets: [{ w: '40', r: '8', done: true }] }] }] };
    const data = { gymLogs: JSON.stringify(logs), gymCustomWorkouts: '{}' };
    return makeBackup((k) => data[k] ?? null, 'test');
  });
  await page.locator('[data-restore]').click();
  await page.locator('.sheet textarea[name=paste]').fill(backup);
  await sheetAction(page, 'Restore pasted text');
  const loaded = page.waitForEvent('load');
  await sheetAction(page, 'Restore');
  await page.waitForTimeout(100);
  release();
  await loaded;
  await page.locator('.page.active [data-open-settings]').first().click();
  await expect(page.locator('#page-settings .status')).toHaveText(/Synced/, { timeout: 15000 });
  await expect.poll(async () => {
    const logs = (await u.client.from('workout_data').select('logs').eq('user_id', u.id).single()).data?.logs || {};
    return (logs['2026-10-21'] || []).map((x) => x.day);
  }, { timeout: 15000 }).toEqual(['Pull ‹img src=x>']);
});

test('an open workout follows a rename of its routine and is saved under the new name', async ({ page }) => {
  await offline(page);
  await open(page);
  await createWorkout(page, 'Legs', ['Barbell Bench Press']);
  await scheduleToday(page, 'Legs');
  await tab(page, 'today');
  await page.locator('#startToday').click();
  const session = page.locator('#session');
  await session.getByRole('button', { name: 'Start workout' }).click();
  const card = session.locator('.ex-card').first();
  await card.locator('.w').first().fill('100');
  await card.locator('.r').first().fill('5');
  await card.locator('.check').first().click();
  await page.evaluate(async () => (await import('/js/core/store.js')).emit('gym:routines-renamed', { Legs: 'Legs 2' }));
  await expect(page.locator('#sessionTitle')).toHaveText('Legs 2');
  await card.locator('.r').nth(1).fill('5');
  await session.getByRole('button', { name: 'Finish workout' }).click();
  await sheetAction(page, 'Save workout');
  await expect(session).toBeHidden();
  const { logs, drafts } = await page.evaluate(() => ({ logs: JSON.parse(localStorage.getItem('gymLogs')), drafts: JSON.parse(localStorage.getItem('gymDrafts') || '{}') }));
  expect(Object.values(logs).flat().map((x) => x.day)).toEqual(['Legs 2']);
  expect(Object.keys(drafts)).toEqual([]);
});

test('a drag drops the exercise that was dragged, also when the routine changed meanwhile', async ({ page }) => {
  await page.context().route('**/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.GYM_CLOUD_CONFIG = {};' }));
  await open(page);
  await createWorkout(page, 'Arms', ['Pull-up', 'Dips', 'Plank', 'Push-up']);
  await page.locator('[data-edit="Arms"]').click();
  const other = await page.context().newPage();
  await open(other);
  const grip = page.locator('[data-ex="Plank"] [data-drag]');
  const g = await grip.boundingBox(), t = await page.locator('[data-ex="Dips"]').boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, t.y + 5, { steps: 8 });
  // Another tab removes the first exercise during the drag.
  await other.evaluate(() => {
    const w = JSON.parse(localStorage.getItem('gymCustomWorkouts'));
    w.Arms = w.Arms.filter((e) => e.name !== 'Pull-up');
    localStorage.setItem('gymCustomWorkouts', JSON.stringify(w));
  });
  await expect(page.locator('[data-ex="Pull-up"]')).toHaveCount(0);
  await page.mouse.move(g.x + g.width / 2, t.y + 4, { steps: 2 });
  await page.mouse.up();
  const order = await page.evaluate(() => JSON.parse(localStorage.getItem('gymCustomWorkouts')).Arms.map((e) => e.name));
  expect(order[0]).toBe('Plank');
  expect(order.sort()).toEqual(['Dips', 'Plank', 'Push-up']);
});

test('a friend request is never sent from an account that signed in after it was asked for', async ({ browser }) => {
  const { makeUser, uniqueName, adminClient } = await import('../integration/helpers.js');
  const a = await makeUser(uniqueName('fra'));
  const b = await makeUser(uniqueName('frb'));
  const t1 = await makeUser(uniqueName('frt'));
  const t2 = await makeUser(uniqueName('frs'));
  const page = await (await newPhone(browser)).newPage();
  await open(page); await signInAs(page, a);
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route('**/rest/v1/rpc/find_profile*', async (r) => { await held; return r.continue(); });
  await tab(page, 'crew');
  await page.locator('[data-crew-tab="friends"]').click();
  await page.locator('#friendName').fill(t1.username);
  await page.keyboard.press('Enter');
  await page.locator('#friendName').fill(t2.username);
  await page.keyboard.press('Enter');
  await page.locator('.page.active [data-open-settings]').first().click();
  await page.locator('[data-signout]').click();
  await sheetAction(page, 'Sign out, keep data here');
  await expect(page.locator('#authForm')).toBeVisible({ timeout: 15000 });
  const form = page.locator('#authForm');
  await form.locator('[name=email]').fill(b.email);
  await form.locator('[name=password]').fill(b.password);
  await form.locator('[type=submit]').click();
  const replace = page.locator('.sheet-backdrop.open .sheet').last().getByRole('button', { name: /Replace with my account|Start fresh/ }).first();
  // Asked only if the phone holds data; A's account here has none.
  if (await replace.isVisible({ timeout: 3000 }).catch(() => false)) await replace.click();
  await expect.poll(() => page.evaluate(async () => (await import('/js/cloud/sync.js')).account.user?.email), { timeout: 15000 }).toBe(b.email);
  release();
  await page.waitForTimeout(3000);
  const rows = (await adminClient().from('friend_requests').select('requester_id,target_id').in('target_id', [t1.id, t2.id])).data;
  expect(rows).toEqual([]);
});

// ---- round 13, usability ----

const fakeUndo = (page) => page.evaluate(async () => {
  window.__undone = 0;
  (await import('/js/core/dom.js')).toast('Plank removed.', { action: { label: 'Undo', onClick: () => { window.__undone++; } } });
  document.querySelector('#toast .toast-action').focus();
});

test('late answers to sign-in and a manual update check wait behind an Undo', async ({ browser }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  // Sign-in.
  const u = await makeUser(uniqueName('lsi'));
  let page = await (await newPhone(browser)).newPage();
  await open(page);
  await page.route('**/auth/v1/token*', async (r) => { await new Promise((res) => setTimeout(res, 1500)); return r.continue(); });
  await page.locator('.page.active [data-open-settings]').click();
  const form = page.locator('#authForm');
  await form.locator('[name=email]').fill(u.email);
  await form.locator('[name=password]').fill(u.password);
  await form.locator('[type=submit]').click();
  await fakeUndo(page);
  await expect(page.locator('#page-settings .status')).toHaveText(/Synced/, { timeout: 15000 });
  await expect(page.locator('#toast .toast-action')).toBeFocused();
  // Manual web update check.
  page = await (await newPhone(browser)).newPage();
  await page.route('**/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.GYM_CLOUD_CONFIG = {};' }));
  let asked = false;
  await page.route('**/Version*', async (r) => { if (asked) await new Promise((res) => setTimeout(res, 1500)); return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: asked ? '9.9.9' : '0.0.1' }) }); });
  await open(page);
  await page.locator('.page.active [data-open-settings]').click();
  asked = true;
  await page.locator('[data-check-update]').click();
  await fakeUndo(page);
  await expect(page.locator('[data-apply-update]')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(300);
  await expect(page.locator('#toast .toast-action')).toBeFocused();
  await expect(page.locator('#toast')).toContainText('Plank removed');
});

test('a queued friend request waits behind an Undo, and a double tap asks only once', async ({ browser }) => {
  const { makeUser, uniqueName, adminClient } = await import('../integration/helpers.js');
  const { pa, a, errors } = await friendsPair(browser, 'qf');
  const b = await makeUser(uniqueName('qfb')), c = await makeUser(uniqueName('qfc'));
  await createWorkout(pa, 'Upper', ['Pull-up', 'Dips', 'Plank']);
  await pa.route('**/rest/v1/friend_requests*', async (r) => { if (r.request().method() === 'POST') await new Promise((res) => setTimeout(res, 2000)); return r.continue(); });
  await tab(pa, 'crew');
  await pa.locator('[data-crew-tab="friends"]').click();
  await pa.locator('#friendName').fill(b.username);
  await pa.locator('#addFriendForm [type=submit]').click();
  await pa.locator('#addFriendForm [type=submit]').click({ force: true }); // a double tap
  await expect(pa.locator('#toast')).toContainText('already on its way');
  await pa.locator('#friendName').fill(c.username);
  await pa.keyboard.press('Enter');
  await removeDipsAndFocusUndo(pa);
  await pa.waitForTimeout(5500); // both answers are in
  await expect(pa.locator('#toast .toast-action')).toBeFocused();
  await pa.keyboard.press('Control+z');
  await expect(pa.locator('[data-ex="Dips"]')).toHaveCount(1);
  const rows = (await adminClient().from('friend_requests').select('target_id').eq('requester_id', a.id).in('target_id', [b.id, c.id])).data;
  expect(rows.length).toBe(2);
  expect(errors.flat()).toEqual([]);
});

test('"Not now" on the new password says where to set it later', async ({ page }) => {
  await offline(page);
  await open(page);
  await page.evaluate(async () => (await import('/js/core/store.js')).emit('gym:password-recovery'));
  const sheet = page.locator('.sheet-backdrop.open .sheet');
  await expect(sheet.locator('h2')).toHaveText('Choose a new password');
  await page.mouse.click(5, 5);
  await expect(sheet).toBeFocused();
  await sheetAction(page, 'Not now');
  await expect(page.locator('#toast')).toContainText('“Change password” in Settings');
});

test('dragging near the edge scrolls the page; holding a grip still does not', async ({ page }) => {
  await offline(page);
  await open(page);
  await createWorkout(page, 'Long', ['Pull-up', 'Dips', 'Plank', 'Push-up', 'Leg Press', 'Seated Cable Row', 'Bulgarian Split Squat', 'Concentration Curl', 'Barbell Bench Press']);
  await page.locator('[data-edit="Long"]').click();
  await page.evaluate(() => window.scrollTo(0, 0));
  const vh = page.viewportSize().height;
  // Still: a press near the bottom edge, held, moves nothing.
  const rows = page.locator('[data-ex] [data-drag]');
  // Put a grip inside the auto-scroll band at the bottom, just above the tab bar.
  const at = await rows.nth(4).evaluate((el, h) => { const y = el.getBoundingClientRect().top + window.scrollY; window.scrollTo(0, y - (h - 118)); return window.scrollY; }, vh);
  const grip = await rows.nth(4).boundingBox();
  expect(grip.y + grip.height / 2).toBeGreaterThan(vh - 130);
  expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-drag]'), [grip.x + grip.width / 2, grip.y + grip.height / 2])).toBe(true);
  const order = () => page.evaluate(() => JSON.parse(localStorage.getItem('gymCustomWorkouts')).Long.map((e) => e.name));
  const before = await order();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 3); // a shaky hand is not a drag
  await page.waitForTimeout(800);
  await page.mouse.up();
  expect(await page.evaluate(() => window.scrollY)).toBe(at);
  expect(await order()).toEqual(before);
  // A drag into the bottom band scrolls.
  await page.evaluate(() => window.scrollTo(0, 0));
  const first = await rows.first().boundingBox();
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + first.width / 2, vh - 40, { steps: 10 });
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await page.mouse.up();
});

test('Crew "Try again" during a running load reports the new load', async ({ browser }) => {
  const { pa } = await friendsPair(browser, 'cr2');
  let fail = true;
  await pa.route('**/rest/v1/gym_dates*', async (r) => {
    if (r.request().method() !== 'GET') return r.continue();
    if (fail) { await new Promise((res) => setTimeout(res, 1200)); return r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"down"}' }); }
    return r.continue();
  });
  await tab(pa, 'crew');
  await expect(pa.locator('[data-retry]').first()).toBeVisible({ timeout: 10000 });
  await pa.locator('[data-crew-tab="friends"]').click();
  await pa.locator('[data-crew-tab="dates"]').click(); // starts a load that will fail
  await pa.waitForTimeout(200);
  fail = false;
  await pa.locator('[data-retry]').first().click();
  await expect(pa.locator('#toast')).toContainText('Loaded', { timeout: 10000 });
  await expect(pa.locator('[data-retry]')).toHaveCount(0);
});

test('signing out on a hanging connection does not hold the user for long', async ({ browser }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('sh2'));
  const page = await (await newPhone(browser)).newPage();
  await open(page); await signInAs(page, u);
  await createWorkout(page, 'Offline', ['Plank']);
  await page.route('**/rest/v1/**', () => new Promise(() => {})); // never answers
  await page.locator('.page.active [data-open-settings]').click();
  await page.locator('[data-signout]').click();
  const t0 = Date.now();
  await sheetAction(page, 'Sign out, keep data here');
  await expect(page.locator('#authForm')).toBeVisible({ timeout: 15000 });
  expect(Date.now() - t0).toBeLessThan(12000);
  await expect(page.locator('#toast')).toContainText('had not reached your account');
  await page.waitForTimeout(5000);
  await expect(page.locator('#toast')).toContainText('had not reached your account'); // long enough to read
});

// ---- round 14 ----

test('a sign-out still finishing never ends the next session, and the next account syncs', async ({ browser }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const a = await makeUser(uniqueName('sfa')), b = await makeUser(uniqueName('sfb'));
  const page = await (await newPhone(browser)).newPage();
  await open(page); await signInAs(page, a);
  await createWorkout(page, 'Upper', ['Plank']);
  // A's last sync and sign-out hang; B's requests go through.
  let hold = true;
  await page.route('**/rest/v1/**', (r) => (hold ? new Promise(() => {}) : r.continue()));
  await page.route('**/auth/v1/logout*', async (r) => { await new Promise((res) => setTimeout(res, 7000)); return r.continue(); });
  await page.locator('.page.active [data-open-settings]').click();
  await page.locator('[data-signout]').click();
  await sheetAction(page, 'Sign out, keep data here');
  await expect(page.locator('#authForm')).toBeVisible({ timeout: 20000 });
  hold = false;
  const form = page.locator('#authForm');
  await form.locator('[name=email]').fill(b.email);
  await form.locator('[name=password]').fill(b.password);
  await form.locator('[type=submit]').click();
  await expect(form.locator('[type=submit]')).toHaveText('Finishing the last sign-out…');
  // A's workouts are on the phone, so B is asked first.
  await sheetAction(page, 'Replace with my account’s data').catch(async () => {
    await page.locator('.sheet-backdrop.open').getByRole('button', { name: 'Replace with my account’s data' }).click({ timeout: 15000 });
  });
  await expect(page.locator('#page-settings .status')).toHaveText(/Synced/, { timeout: 20000 });
  await page.waitForTimeout(4000); // past the moment A's sign-out finishes
  expect(await page.evaluate(async () => (await import('/js/cloud/sync.js')).account.user?.email)).toBe(b.email);
});

test('a slow but successful "Sign out on all devices" is reported as done', async ({ page }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('sgs'));
  await open(page); await signInAs(page, u);
  await page.route('**/auth/v1/logout*', async (r) => { await new Promise((res) => setTimeout(res, 5000)); return r.continue(); });
  await page.locator('.page.active [data-open-settings]').click();
  await page.locator('[data-signout]').click();
  await sheetAction(page, 'Sign out on all devices');
  await expect(page.locator('#toast')).toContainText('on all your other devices', { timeout: 20000 });
});

test('an open workout follows a sync that defuses its exercise names', async ({ page }) => {
  await offline(page);
  await open(page);
  await page.evaluate(async () => {
    const { state, savePlan } = await import('/js/state.js');
    state.workouts.Legs = [{ name: 'Press <b>', cat: 'legs', sets: 2, target: '8 <i>slow</i>', rest: 60, note: '' }];
    savePlan();
  });
  await scheduleToday(page, 'Legs');
  await tab(page, 'today');
  await page.locator('#startToday').click();
  const session = page.locator('#session');
  await session.getByRole('button', { name: 'Start workout' }).click();
  const card = session.locator('.ex-card').first();
  await card.locator('.w').first().fill('100');
  await card.locator('.r').first().fill('5');
  await page.evaluate(async () => {
    const { state, savePlan } = await import('/js/state.js');
    state.workouts.Legs = state.workouts.Legs.map((e) => ({ ...e, name: 'Press ‹b>', target: '8 ‹i>slow‹/i>' }));
    savePlan();
    (await import('/js/core/store.js')).emit('gym:plan-updated');
  });
  await expect(page.locator('#ex-title-0')).toHaveText('Press ‹b>');
  // Stored at once (the phone may close before Finish).
  const stored = await page.evaluate(() => ({ drafts: Object.values(JSON.parse(localStorage.getItem('gymDrafts') || '{}')).flatMap((d) => Object.keys(d.ex || {})), lastUsed: Object.keys(JSON.parse(localStorage.getItem('gymLastUsed') || '{}')) }));
  expect(stored.drafts).toEqual(['Press ‹b>']);
  expect(stored.lastUsed).toContain('Press ‹b>');
  await session.getByRole('button', { name: 'Finish workout' }).click();
  await sheetAction(page, 'Save workout');
  await expect(session).toBeHidden();
  const { logs, lastUsed } = await page.evaluate(() => ({ logs: JSON.parse(localStorage.getItem('gymLogs')), lastUsed: JSON.parse(localStorage.getItem('gymLastUsed') || '{}') }));
  expect(Object.values(logs).flat()[0].exercises.map((e) => [e.name, e.target])).toEqual([['Press ‹b>', '8 ‹i>slow‹/i>']]);
  expect(Object.keys(lastUsed)).not.toContain('Press <b>');
});

test('the next account\'s first sync does not wait for a sync left over from the last one', async ({ browser }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const a = await makeUser(uniqueName('lsa')), b = await makeUser(uniqueName('lsb'));
  const page = await (await newPhone(browser)).newPage();
  await open(page); await signInAs(page, a);
  await createWorkout(page, 'Upper', ['Plank']);
  let hold = true;
  await page.route('**/rest/v1/**', (r) => (hold ? new Promise(() => {}) : r.continue()));
  await page.locator('.page.active [data-open-settings]').click();
  await page.locator('[data-signout]').click();
  await sheetAction(page, 'Sign out and remove my data');
  await sheetAction(page, 'Remove anyway');
  await expect(page.locator('#authForm')).toBeVisible({ timeout: 10000 });
  hold = false; // A's sync is still hanging; B's requests go through
  const form = page.locator('#authForm');
  await form.locator('[name=email]').fill(b.email);
  await form.locator('[name=password]').fill(b.password);
  await form.locator('[type=submit]').click();
  await expect(page.locator('#page-settings .status')).toHaveText(/Synced/, { timeout: 4000 });
});

test('weigh-ins and username changes name the account they are meant for', async ({ page }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('eu'));
  const sent = [];
  page.on('request', (r) => { if (/rpc\/(save_my_weights|change_username)/.test(r.url())) sent.push(JSON.parse(r.postData() || '{}').expected_user); });
  await open(page); await signInAs(page, u);
  await page.evaluate(async () => {
    const { state, saveWeights } = await import('/js/state.js');
    state.weights.push({ date: '2026-04-02', weight: 70 });
    saveWeights();
  });
  await expect.poll(() => sent.length, { timeout: 15000 }).toBeGreaterThan(0);
  await page.locator('.page.active [data-open-settings]').click();
  await page.locator('[data-change-username]').click();
  await fillPrompt(page, uniqueName('ev').slice(0, 20));
  await expect(page.locator('#toast')).toContainText('Username changed');
  expect(sent.length).toBeGreaterThan(1);
  expect(new Set(sent)).toEqual(new Set([u.id]));
});

test('a logged workout defused by a sync while it is being edited stays defused', async ({ page }) => {
  await offline(page);
  await page.addInitScript(() => {
    const d = new Date(), today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    if (!localStorage.getItem('gymLogs')) localStorage.setItem('gymLogs', JSON.stringify({ [today]: [{ id: 'e1', day: 'Push', time: d.toISOString(), exercises: [{ name: 'Press <b>', target: '8', sets: [{ w: '50', r: '8', done: true }] }] }] }));
  });
  await open(page);
  await page.evaluate(async () => {
    const d = new Date(), today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const { openSession } = await import('/js/ui/session.js');
    const { sessionKey } = await import('/js/domain/logs.js');
    const { state } = await import('/js/state.js');
    openSession('Push', today, { key: sessionKey(today, state.logs[today][0]) });
  });
  const session = page.locator('#session');
  await expect(session).toBeVisible();
  // The sync defuses the stored copy while the edit is open.
  await page.evaluate(async () => {
    const { state, saveLogs } = await import('/js/state.js');
    Object.values(state.logs).flat().forEach((x) => { x.exercises.forEach((e) => { e.name = e.name.replace('<b', '‹b'); }); });
    saveLogs();
  });
  await session.locator('.ex-card').first().locator('.r').first().fill('9');
  await session.getByRole('button', { name: /Save/ }).first().click();
  await sheetAction(page, 'Save workout');
  await expect(session).toBeHidden();
  const names = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('gymLogs'))).flat().flatMap((x) => x.exercises.map((e) => e.name)));
  expect(names).toEqual(['Press ‹b>']);
});

test('another tab stops syncing when this one signs out and removes the data', async ({ browser }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('rt'));
  await u.client.from('workout_data').insert({ user_id: u.id, logs: { '2026-10-01': [{ id: 'r1', day: 'Push', time: '2026-10-01T10:00:00.000Z', exercises: [{ name: 'Bench', target: '8', sets: [{ w: '60', r: '8', done: true }] }] }] }, progress: {} });
  const ctx = await newPhone(browser);
  const one = await ctx.newPage();
  await open(one); await signInAs(one, u);
  const two = await ctx.newPage();
  await open(two);
  await expect.poll(() => two.evaluate(async () => (await import('/js/cloud/sync.js')).account.ready), { timeout: 15000 }).toBe(true);
  // Tab 2's data read is slow; tab 1's sign-out takes longer than it waits.
  let holdRead = true;
  await two.route('**/rest/v1/workout_data*', async (r) => { if (holdRead && r.request().method() === 'GET') { holdRead = false; await new Promise((res) => setTimeout(res, 6000)); } return r.continue(); });
  await one.route('**/auth/v1/logout*', async (r) => { await new Promise((res) => setTimeout(res, 9000)); return r.continue(); });
  two.evaluate(async () => (await import('/js/cloud/sync.js')).syncAll()).catch(() => {});
  await two.waitForTimeout(300);
  await one.evaluate(async () => (await import('/js/cloud/sync.js')).signOut({ removeLocalData: true }));
  await two.waitForTimeout(8000); // tab 2's read has come back
  expect(await one.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('gymLogs') || '{}')))).toEqual([]);
});

test('a message that waited behind a dialog is not lost when the dialog shows its own result', async ({ page }) => {
  await offline(page);
  await open(page);
  await createWorkout(page, 'Upper', ['Pull-up', 'Dips']);
  await page.locator('[data-edit="Upper"]').click();
  const seen = [];
  await page.exposeFunction('seenToast', (t) => seen.push(t));
  await page.evaluate(() => { const t = document.getElementById('toast'); new MutationObserver(() => window.seenToast(t.textContent)).observe(t, { childList: true, subtree: true }); });
  await page.locator('[data-rename]').click();
  await page.evaluate(async () => { const { toast } = await import('/js/core/dom.js'); toast('No one is called @zed.', { tone: 'error' }); toast('Request sent to @b.'); });
  const mark = seen.length;
  await fillPrompt(page, 'Upper body');
  await expect(page.locator('#toast')).toContainText('Renamed', { timeout: 3000 });
  // The dialog's own result comes first.
  expect(seen.slice(mark).findIndex((t) => t.startsWith('Renamed'))).toBeLessThan(Math.max(0, seen.slice(mark).findIndex((t) => t.startsWith('No one'))) || 1e9);
  // Both waited messages are shown afterwards, each for long enough to read.
  await expect(page.locator('#toast')).toContainText('No one is called @zed.', { timeout: 8000 });
  await expect(page.locator('#toastAlert')).toHaveText('No one is called @zed.');
  await page.waitForTimeout(1500);
  await expect(page.locator('#toast')).toContainText('No one is called @zed.');
  await expect(page.locator('#toast')).toContainText('Request sent to @b.', { timeout: 12000 });
  // A result that comes a little later does not hide a message that just got its turn.
  await page.evaluate(async () => {
    const { toast } = await import('/js/core/dom.js');
    const { confirmDialog } = await import('/js/ui/sheet.js');
    const closed = confirmDialog('Sure?');
    await new Promise((res) => { setTimeout(res, 100); });
    toast('Friend request accepted.');
    document.querySelector('.sheet-backdrop.open [data-sheet-action="0"]').click();
    await closed;
    await new Promise((res) => { setTimeout(res, 600); });
    toast('Done later.');
  });
  await expect(page.locator('#toast')).toContainText('Friend request accepted.', { timeout: 8000 });
});

test('waiting messages keep their order when a dialog opens over an error', async ({ page }) => {
  await offline(page);
  await open(page);
  await createWorkout(page, 'Upper', ['Pull-up']);
  await page.locator('[data-edit="Upper"]').click();
  const seen = [];
  let last = '';
  await page.exposeFunction('seenToast2', (t) => { if (t && t !== last) seen.push(t); last = t; });
  await page.evaluate(() => { const t = document.getElementById('toast'); new MutationObserver(() => window.seenToast2(t.textContent)).observe(t, { childList: true, subtree: true }); });
  await page.evaluate(async () => { const { toast } = await import('/js/core/dom.js'); toast('Sync failed.', { tone: 'error' }); toast('First.', { background: true }); toast('Second.', { background: true }); });
  await page.locator('[data-delete]').click();
  const mark = seen.length;
  await sheetAction(page, 'Cancel');
  await expect.poll(() => seen.slice(mark).includes('Second.'), { timeout: 25000 }).toBe(true);
  // After the dialog: the error again (still to be read), then the others in order.
  expect(seen.slice(mark).filter((t) => ['Sync failed.', 'First.', 'Second.'].includes(t))).toEqual(['Sync failed.', 'First.', 'Second.']);
});

test('a custom rest-day picture shows on rest days and in "Coming up"', async ({ page }) => {
  await offline(page);
  await open(page);
  await createWorkout(page, 'Push', ['Dips']); // nothing on the week: every day is a rest day
  await page.locator('.page.active [data-open-settings]').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-pick-image]').click();
  await (await chooser).setFiles('icon-512.png');
  await expect(page.locator('#toast')).toContainText('Rest-day picture updated');
  await expect(page.locator('.rest-pick img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  await page.locator('[data-close-settings]').click();
  await tab(page, 'today');
  await expect(page.locator('.hero-card.rest .rest-img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  await expect(page.locator('.up-row.rest .up-thumb').first()).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  // A file that is not a picture the browser can read says why.
  await page.locator('.page.active [data-open-settings]').click();
  const chooser2 = page.waitForEvent('filechooser');
  await page.locator('[data-pick-image]').click();
  await (await chooser2).setFiles({ name: 'photo.heic', mimeType: 'image/heic', buffer: Buffer.from('not really a picture') });
  await expect(page.locator('#toast')).toContainText('format can’t be used');
});

// ---- features: theming ----

test('appearance: light or dark, a preset or own color, kept readable and remembered', async ({ page }) => {
  await offline(page);
  await open(page);
  await page.locator('.page.active [data-open-settings]').click();
  const root = page.locator('html');
  const accent = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  await page.locator('[data-base="light"]').click();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('[data-base="light"]')).toHaveAttribute('aria-checked', 'true');
  // Lime on white would be unreadable: it is shown darker, and the user is told.
  expect(await accent()).not.toBe('#c8f53d');
  await expect(page.locator('[data-key="color-adjusted"]')).toContainText('darker');
  // The light base itself, and the phone's status bar color.
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim())).toBe('#f5f6f8');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f5f6f8');
  // The color dots show the colors as used in this theme.
  const dot = await page.locator('[data-swatch="lime"]').evaluate(async (el) => {
    const { themeColors } = await import('/js/domain/theme.js');
    const want = themeColors({ preset: 'lime' }, 'light').accent;
    const rgb = [1, 3, 5].map((i) => parseInt(want.slice(i, i + 2), 16)).join(', ');
    return [getComputedStyle(el).backgroundColor, `rgb(${rgb})`];
  });
  expect(dot[0]).toBe(dot[1]);
  expect(dot[0]).not.toBe('rgb(200, 245, 61)');
  // Arrow keys move through the colors (a radio group), and choosing one applies it.
  await page.locator('[data-preset="lime"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-preset="ocean"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-preset="ocean"]')).toHaveAttribute('aria-checked', 'true');
  const ratio = await page.evaluate(async () => {
    const { contrast } = await import('/js/domain/theme.js');
    const s = getComputedStyle(document.documentElement);
    return contrast(s.getPropertyValue('--accent').trim(), '#ffffff');
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
  // Own color.
  await page.locator('[data-custom-color]').evaluate((el) => { el.value = '#ffe066'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect(page.locator('.color-pick')).toContainText('(chosen)');
  // With an own color the presets stay reachable with Tab.
  await expect(page.locator('[data-preset="lime"]')).toHaveAttribute('tabindex', '0');
  await page.locator('[data-base="dark"]').click();
  await expect(root).not.toHaveAttribute('data-theme', 'light');
  expect(await accent()).toBe('#ffe066');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0d0e10');
  // Remembered after a reload.
  await page.reload();
  await expect(page.locator('#page-today h1')).toHaveText('Today');
  expect(await accent()).toBe('#ffe066');
  // "Match phone" follows the phone.
  await page.emulateMedia({ colorScheme: 'light' });
  await page.locator('.page.active [data-open-settings]').click();
  await page.locator('[data-base="system"]').click();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).not.toHaveAttribute('data-theme', 'light');
});

test('a theme from a backup file cannot inject CSS', async ({ page }) => {
  await offline(page);
  await page.addInitScript(() => localStorage.setItem('gymSettings', JSON.stringify({ weightStep: 0, theme: { base: 'light', preset: 'custom', color: 'red; background: url(https://evil.example/x)' } })));
  await open(page);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())).not.toContain('url');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

// ---- features: food & drink ----

test('food and drink before and after a workout are saved with it, synced and shown in the calendar', async ({ page }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('fd'));
  await open(page); await signInAs(page, u);
  await createWorkout(page, 'Push', ['Barbell Bench Press']);
  await scheduleToday(page, 'Push');
  await tab(page, 'today');
  await page.locator('#startToday').click();
  const session = page.locator('#session');
  await session.locator('[data-food="pre"]').click();
  const sheet = page.locator('.sheet-backdrop.open .food-sheet');
  await sheet.locator('[data-item="shake"]').click();
  await expect(sheet.locator('[data-item="shake"]')).toHaveAttribute('aria-pressed', 'true');
  await sheet.locator('[name=note]').fill('banana');
  await sheet.locator('[data-when="30-60"]').click();
  await sheet.locator('[name=water]').fill('500');
  await sheetAction(page, 'Save');
  await expect(session.locator('[data-food-summary="pre"]')).toHaveText('Shake: banana · 30–60 min before · 500 ml water');
  await expect(session.locator('[data-food="pre"]')).toBeFocused();
  // A value out of range is refused in the sheet.
  await session.locator('[data-food="post"]').click();
  await sheet.locator('[name=protein]').fill('900');
  await sheetAction(page, 'Save');
  await expect(sheet.locator('.form-error')).toContainText('Protein');
  await sheet.locator('[name=protein]').fill('25');
  await sheetAction(page, 'Save');
  await expect(session.locator('[data-food-summary="post"]')).toHaveText('25 g protein');
  await session.getByRole('button', { name: 'Start workout' }).click();
  const card = session.locator('.ex-card').first();
  await card.locator('.w').first().fill('60');
  await card.locator('.r').first().fill('8');
  await card.locator('.check').first().click();
  await session.getByRole('button', { name: 'Finish workout' }).click();
  await sheetAction(page, 'Save workout');
  await expect(session).toBeHidden();
  const saved = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('gymLogs'))).flat()[0].nutrition);
  expect(saved).toEqual({ pre: { items: ['shake'], note: 'banana', when: '30-60', water: 500 }, post: { items: [], note: '', when: '', protein: 25 } });
  // In the account (never visible to friends: it is in the owner's workout data only).
  await expect.poll(async () => {
    const r = await u.client.from('workout_data').select('logs').eq('user_id', u.id).maybeSingle();
    return Object.values(r.data?.logs || {}).flat()[0]?.nutrition?.pre?.note;
  }, { timeout: 15000 }).toBe('banana');
  // In the calendar.
  await tab(page, 'calendar');
  const today = await page.evaluate(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
  await page.locator(`[data-day="${today}"]`).click();
  await expect(page.locator('.sheet-backdrop.open .log-food')).toContainText('Before');
  await expect(page.locator('.sheet-backdrop.open .log-food')).toContainText('25 g protein');
});

test('food: a removed entry stays removed, usual amounts are accepted, typos are explained', async ({ page }) => {
  await offline(page);
  await open(page);
  await createWorkout(page, 'Push', ['Dips']);
  await scheduleToday(page, 'Push');
  await tab(page, 'today');
  await page.locator('#startToday').click();
  const session = page.locator('#session');
  const sheet = page.locator('.sheet-backdrop.open .food-sheet');
  await session.locator('[data-food="pre"]').click();
  await sheet.locator('[data-item="meal"]').click();
  await sheet.locator('[data-item="nothing"]').click();
  await expect(sheet.locator('[data-item="meal"]')).toHaveAttribute('aria-pressed', 'false');
  await sheet.locator('[name=water]').fill('330');
  await sheet.locator('[name=protein]').fill('22.5');
  await sheetAction(page, 'Save');
  await expect(session.locator('[data-food-summary="pre"]')).toHaveText('Nothing · 330 ml water · 22.5 g protein');
  // Save the workout, then open it again to edit, remove the food, close and reopen: it stays removed.
  await session.getByRole('button', { name: 'Start workout' }).click();
  await session.locator('.ex-card').first().locator('.r').first().fill('8');
  await session.locator('.ex-card').first().locator('.check').first().click();
  await session.getByRole('button', { name: 'Finish workout' }).click();
  await sheetAction(page, 'Save workout');
  await expect(session).toBeHidden();
  await page.locator('[data-start="Push"]').click();
  await expect(session.locator('[data-food-summary="pre"]')).toContainText('330 ml');
  await session.locator('[data-food="pre"]').click();
  await sheetAction(page, 'Remove');
  await expect(session.locator('[data-food-summary="pre"]')).toHaveText('Not logged');
  await page.locator('#sessionBack').click();
  await expect(session).toBeHidden();
  await page.locator('[data-start="Push"]').click();
  await expect(session.locator('[data-food-summary="pre"]')).toHaveText('Not logged');
  // Something that is not a number, or too much, is explained, not dropped.
  await session.locator('[data-food="post"]').click();
  await sheet.locator('[name=water]').pressSequentially('5e');
  await sheetAction(page, 'Save');
  await expect(sheet.locator('.form-error')).toContainText('Water');
  await sheet.locator('[name=water]').fill('6000');
  await sheetAction(page, 'Save');
  await expect(sheet.locator('.form-error')).toContainText('5000');
  // "When" is optional: a second tap clears it.
  await sheet.locator('[name=water]').fill('300');
  await sheet.locator('[data-when="lt30"]').click();
  await sheet.locator('[data-when="lt30"]').click();
  await expect(sheet.locator('[data-when="lt30"]')).toHaveAttribute('aria-checked', 'false');
  await expect(sheet.locator('[data-when="lt30"]')).toHaveAttribute('tabindex', '0');
  await sheetAction(page, 'Save');
  await expect(session.locator('[data-food-summary="post"]')).toHaveText('300 ml water');
  await expect(session.locator('[data-food="post"]')).toHaveAttribute('aria-label', 'Food and drink after: 300 ml water. Edit');
  // Kept with the draft: closing and reopening without saving keeps it.
  await page.locator('#sessionBack').click();
  await page.locator('[data-start="Push"]').click();
  await expect(session.locator('[data-food-summary="post"]')).toHaveText('300 ml water');
});

test('theme: no dark flash for a light theme, and it follows the settings after sign-out removes them', async ({ page }) => {
  await offline(page);
  await page.addInitScript(() => { if (!sessionStorage.getItem('x')) { localStorage.setItem('gymSettings', JSON.stringify({ weightStep: 0, theme: { base: 'light', preset: 'mint' } })); sessionStorage.setItem('x', '1'); } });
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route('**/js/main.js', async (r) => { await held; return r.continue(); });
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light'); // before the app has loaded
  release();
  await expect(page.locator('#page-today h1')).toHaveText('Today');
  // The settings are gone (as after "Sign out and remove my data"): the default theme comes back.
  await page.evaluate(async () => {
    localStorage.removeItem('gymSettings');
    const { loadState } = await import('/js/state.js');
    loadState();
    (await import('/js/core/store.js')).emit('gym:account');
  });
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'light');
});

test('food after a workout can be added later from the calendar, straight to the saved workout', async ({ page }) => {
  await offline(page);
  await page.addInitScript(() => {
    if (localStorage.getItem('gymLogs')) return;
    const d = new Date(), today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    localStorage.setItem('gymLogs', JSON.stringify({ [today]: [{ id: 'c1', day: 'Push', time: new Date(Date.now() - 3600000).toISOString(), exercises: [{ name: 'Dips', target: '8', sets: [{ w: '0', r: '8', done: true }] }] }] }));
  });
  await open(page);
  await tab(page, 'calendar');
  const today = await page.evaluate(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
  await page.locator(`[data-day="${today}"]`).click();
  const day = page.locator('.sheet-backdrop.open').first();
  const add = day.locator('[data-food-log][data-side="post"]');
  await expect(add).toHaveText('Add');
  await add.click();
  const food = page.locator('.sheet-backdrop.open .food-sheet');
  await food.locator('[data-item="meal"]').click();
  await sheetAction(page, 'Save');
  await expect(day.locator('[data-food-text="post"]')).toHaveText('Meal');
  await expect(add).toBeFocused();
  await expect(add).toHaveText('Edit');
  const saved = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('gymLogs'))).flat()[0]);
  expect(saved.nutrition).toEqual({ post: { items: ['meal'], note: '', when: '' } });
  expect(Date.now() - Date.parse(saved.time)).toBeLessThan(60000); // saved now, so this copy wins the sync
});

test('light theme: small status texts reach AA contrast (running bar, calendar tags, live and check-in pills)', async ({ page }) => {
  await offline(page);
  await page.addInitScript(() => {
    if (localStorage.getItem('seeded')) return;
    const d = new Date(), today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    localStorage.setItem('gymSettings', JSON.stringify({ weightStep: 0, theme: { base: 'light', preset: 'ocean' } }));
    localStorage.setItem('gymLogs', JSON.stringify({ [today]: [{ id: 'k1', day: 'Push', time: d.toISOString(), duration: 2700, exercises: [{ name: 'Dips', target: '8', sets: [{ w: '0', r: '8', done: true }] }] }] }));
    localStorage.setItem('seeded', '1');
  });
  await open(page);
  await createWorkout(page, 'Legs', ['Plank']);
  await scheduleToday(page, 'Legs');
  await tab(page, 'today');
  await page.locator('#startToday').click();
  await page.locator('#session').getByRole('button', { name: 'Start workout' }).click();
  await page.locator('#sessionBack').click();
  // Live and check-in pills as Crew draws them.
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.className = 'date-card live card';
    for (const [id, cls, text] of [['t-live', 'pill pill-live', 'Live now'], ['t-ok', 'pill pill-ok', 'You are at the gym']]) {
      const span = document.createElement('span'); span.id = id; span.className = cls; span.textContent = text; host.append(span);
    }
    document.querySelector('.page.active').append(host);
  });
  const ratios = await page.evaluate(async () => {
    const { contrast } = await import('/js/domain/theme.js');
    const hex = (c) => '#' + c.match(/\d+/g).slice(0, 3).map((n) => (+n).toString(16).padStart(2, '0')).join('');
    const bgOf = (el) => {
      // The pill's own tint over its card's tint over the page (ignoring gradients' lighter ends).
      for (let e = el; e; e = e.parentElement) {
        const b = getComputedStyle(e).backgroundColor;
        if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b) && !/, 0\)$/.test(b)) {
          const a = b.match(/[\d.]+/g); if (a.length < 4 || +a[3] === 1) return hex(b);
          const under = bgOf(e.parentElement); const u = [1, 3, 5].map((i) => parseInt(under.slice(i, i + 2), 16));
          return '#' + [0, 1, 2].map((i) => Math.round(+a[i] * +a[3] + u[i] * (1 - +a[3])).toString(16).padStart(2, '0')).join('');
        }
      }
      return '#f5f6f8';
    };
    const of = (sel) => { const el = document.querySelector(sel); return el ? contrast(hex(getComputedStyle(el).color), bgOf(el)) : -1; };
    return { bar: of('.active-btn small'), tag: of('.cal-cell.logged .cal-tag'), live: of('#t-live'), ok: of('#t-ok') };
  });
  await tab(page, 'calendar');
  const tag = await page.evaluate(async () => {
    const { contrast } = await import('/js/domain/theme.js');
    const hex = (c) => '#' + c.match(/\d+/g).slice(0, 3).map((n) => (+n).toString(16).padStart(2, '0')).join('');
    const el = document.querySelector('.cal-cell.logged .cal-tag');
    return contrast(hex(getComputedStyle(el).color), hex(getComputedStyle(el.closest('.cal-cell')).backgroundColor)) * (getComputedStyle(el).opacity === '1' ? 1 : 0);
  });
  expect(ratios.bar).toBeGreaterThanOrEqual(4.5);
  expect(ratios.live).toBeGreaterThanOrEqual(4.5);
  expect(ratios.ok).toBeGreaterThanOrEqual(4.5);
  expect(tag).toBeGreaterThanOrEqual(4.5);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.active-btn small')).opacity)).toBe('1');
});
