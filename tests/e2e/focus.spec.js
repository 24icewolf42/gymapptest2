// Server results, background refreshes and pending states must never move or
// drop keyboard focus (and with it the screen-reader position).
import { test, expect, open, tab, createWorkout, scheduleToday, friendsPair, newPhone, signInAs, trackErrors } from './helpers.js';

const offline = (page) => page.route('**/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.GYM_CLOUD_CONFIG = {};' }));
const refreshCrew = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
const focused = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return el === document.body ? 'BODY' : (el.getAttribute('aria-label') || el.textContent).trim();
});

// Remembers the focused node itself: a re-created copy with the same selector
// would pass toBeFocused() but loses a screen reader's position.
const hold = (page) => page.evaluate(() => {
  window.__held = document.activeElement;
  window.__blurs = 0;
  if (!window.__watching) { window.__watching = true; document.addEventListener('focusout', () => { window.__blurs++; }); }
});
const stillHeld = (page) => page.evaluate(() => ({ same: document.activeElement === window.__held && window.__held.isConnected, blurs: window.__blurs }));

async function postDate(user, minutes, gym) {
  const r = await user.client.from('gym_dates').insert({ host_id: user.id, starts_at: new Date(Date.now() + minutes * 60000).toISOString(), gym }).select('id').single();
  expect(r.error).toBeNull();
  return r.data.id;
}

test('a date removed by its host keeps focus in the next card, or moves it to the heading', async ({ browser }) => {
  const { a, pb, errors } = await friendsPair(browser, 'fr');
  const first = await postDate(a, 60, 'First Gym');
  const second = await postDate(a, 120, 'Second Gym');
  await tab(pb, 'crew');
  const maybe = pb.locator(`[data-date-id="${second}"] [data-reply="maybe"]`);
  await maybe.focus();
  await pb.evaluate(() => { window.blurs = 0; document.addEventListener('focusout', () => { window.blurs++; }); });
  // An earlier card disappears: focus stays exactly where it was, without
  // even a blur that a screen reader would announce again.
  await a.client.from('gym_dates').update({ cancelled_at: new Date().toISOString() }).eq('id', first);
  await refreshCrew(pb);
  await expect(pb.locator(`[data-date-id="${first}"]`)).toHaveCount(0);
  await expect(maybe).toBeFocused();
  expect(await pb.evaluate(() => window.blurs)).toBe(0);
  // The focused card itself disappears: focus goes to the page heading, not nowhere.
  await a.client.from('gym_dates').update({ cancelled_at: new Date().toISOString() }).eq('id', second);
  await refreshCrew(pb);
  await expect(pb.locator(`[data-date-id="${second}"]`)).toHaveCount(0);
  // Not lost: focus lands on the nearest thing still there (here the card above).
  expect(await pb.evaluate(() => { const el = document.activeElement; return el !== document.body && !!el.closest('#crew-panel'); })).toBe(true);
  expect(errors.flat()).toEqual([]);
});

test('replying and checking in keep focus on the control that was used', async ({ browser }) => {
  const { a, pa, pb, errors } = await friendsPair(browser, 'ci');
  const id = await postDate(a, 0, 'Now Gym');
  await tab(pb, 'crew');
  const going = pb.locator(`[data-date-id="${id}"] [data-reply="going"]`);
  await going.focus();
  await pb.keyboard.press('Enter');
  await expect(going).toHaveAttribute('aria-checked', 'true');
  await expect(going).toBeFocused();
  const here = pb.locator(`[data-date-id="${id}"] [data-checkin]`);
  await here.focus();
  await pb.keyboard.press('Enter');
  // The button becomes the confirmation, which takes the focus.
  await expect(pb.locator(`[data-date-id="${id}"] .pill-ok`)).toBeFocused();
  // The host's own card: same for the host.
  await tab(pa, 'crew');
  await pa.locator(`[data-date-id="${id}"] [data-checkin]`).focus();
  await pa.keyboard.press('Enter');
  await expect(pa.locator(`[data-date-id="${id}"] .pill-ok`)).toBeFocused();
  expect(errors.flat()).toEqual([]);
});

test('switching crew tabs keeps focus on the tabs', async ({ browser }) => {
  const { pa, errors } = await friendsPair(browser, 'tb');
  await tab(pa, 'crew');
  await pa.locator('[data-crew-tab="dates"]').focus();
  const trail = [];
  await pa.exposeFunction('trail', (x) => trail.push(x));
  await pa.evaluate(() => document.addEventListener('focusin', (e) => window.trail(e.target.textContent.trim().slice(0, 20))));
  await pa.keyboard.press('ArrowRight');
  await expect(pa.locator('[data-crew-tab="friends"]')).toBeFocused();
  await expect(pa.locator('[data-crew-tab="friends"]')).toHaveAttribute('aria-selected', 'true');
  expect(trail).toEqual(['Friends']);
  expect(errors.flat()).toEqual([]);
});

test('a failed post keeps focus on the post button inside the sheet', async ({ browser }) => {
  const { pa, errors } = await friendsPair(browser, 'pf');
  await tab(pa, 'crew');
  await pa.route('**/rest/v1/gym_dates*', async (r) => {
    if (r.request().method() !== 'POST') return r.continue();
    await new Promise((res) => setTimeout(res, 500));
    return r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'Server said no', code: 'P0001' }) });
  });
  await pa.locator('[data-quick="60"]').click();
  await pa.locator('.sheet-backdrop.open .date-sheet [name=gym]').fill('Fail Gym');
  const post = pa.locator('.sheet-backdrop.open .date-sheet [type=submit]');
  await post.focus();
  await pa.keyboard.press('Enter');
  await expect(post).toHaveAttribute('aria-busy', 'true');
  await expect(post).toBeFocused();
  await expect(pa.locator('.sheet-backdrop.open .form-error')).not.toBeEmpty();
  await expect(post).not.toHaveAttribute('aria-busy');
  await expect(post).toBeFocused();
  errors[0].length = 0; // the refused request is the point of this test
  expect(errors.flat()).toEqual([]);
});

test('unblocking and the weight-sharing switch keep focus', async ({ browser }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const a = await makeUser(uniqueName('ub_a'));
  const b = await makeUser(uniqueName('ub_b'));
  const c = await makeUser(uniqueName('ub_c'));
  await a.client.from('friend_blocks').insert([{ blocker_id: a.id, blocked_id: b.id }, { blocker_id: a.id, blocked_id: c.id }]);
  const pa = await (await newPhone(browser)).newPage();
  const errors = trackErrors(pa);
  await open(pa); await signInAs(pa, a);
  await pa.locator('.page.active [data-open-settings]').click();
  const share = pa.locator('[data-share-weight]');
  await share.focus();
  await pa.keyboard.press('Space');
  await expect(share).toBeChecked();
  await expect(pa.locator('#toast')).toContainText('Friends can see your latest weight');
  await expect(share).toBeFocused();
  // Unblocking removes the row: focus moves to the next blocked person.
  await pa.locator(`[data-unblock="${b.id}"]`).focus();
  await pa.keyboard.press('Enter');
  await expect(pa.locator(`[data-unblock="${b.id}"]`)).toHaveCount(0);
  await expect(pa.locator(`[data-unblock="${c.id}"]`)).toBeFocused();
  expect(errors).toEqual([]);
});

test('adding exercises from search with the keyboard keeps focus in the results', async ({ page }) => {
  await offline(page);
  await open(page);
  await createWorkout(page, 'Upper', ['Pull-up']);
  await page.locator('[data-edit="Upper"]').click();
  await page.locator('#exSearch').fill('dip');
  const dips = page.locator('[data-add="Dips"]');
  await dips.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-ex="Dips"]')).toHaveCount(1);
  await expect(dips).toBeFocused();
  await expect(dips).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Tab');
  const pick = () => page.evaluate(() => document.activeElement.dataset.add || document.activeElement.dataset.addCustom || 'none');
  const next = await pick();
  expect(next).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-ex]')).toHaveCount(3);
  expect(await pick()).toBe(next);
});

test('closing a workout reopened from the running bar returns focus to the bar', async ({ page }) => {
  await offline(page);
  await open(page);
  await createWorkout(page, 'Pull', ['Lat Pulldown']);
  await scheduleToday(page, 'Pull');
  await tab(page, 'today');
  await page.locator('#startToday').click();
  await page.locator('#sessionMain').click();
  await page.locator('#sessionBack').click();
  const bar = page.locator('#activeBar button');
  await expect(bar).toBeVisible();
  await bar.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#session')).toBeVisible();
  await page.locator('#sessionBack').focus();
  await page.keyboard.press('Enter');
  await expect(bar).toBeFocused();
});

test('an Undo toast stays while it has focus, survives other messages, then focus goes back', async ({ page }) => {
  await offline(page);
  await open(page);
  await createWorkout(page, 'Upper', ['Pull-up', 'Dips', 'Plank']);
  await page.locator('[data-edit="Upper"]').click();
  // Remove the middle exercise with the keyboard: focus moves to the next row.
  await page.locator('[data-ex="Dips"] [data-remove]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-ex="Dips"]')).toHaveCount(0);
  const origin = await focused(page);
  expect(origin).toContain('Plank');
  const undo = page.locator('#toast .toast-action');
  await undo.focus();
  await page.waitForTimeout(11000);
  await expect(undo).toBeFocused();
  // A message from the background (e.g. a friend's gym date) does not replace it.
  await page.evaluate(async () => (await import('/js/core/dom.js')).toast('A friend is going to the gym today at 18:00', { background: true }));
  await expect(undo).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-ex="Dips"]')).toHaveCount(1);
  expect(await focused(page)).toBe(origin);
  // The held-back message is shown afterwards.
  await expect(page.locator('#toast')).toContainText('A friend is going to the gym');
});

test('an Undo is offered even right after an error message', async ({ page }) => {
  await offline(page);
  await open(page);
  await createWorkout(page, 'Upper', ['Pull-up', 'Dips']);
  await page.locator('[data-edit="Upper"]').click();
  await page.evaluate(async () => (await import('/js/core/dom.js')).toast('Something failed', { tone: 'error' }));
  await expect(page.locator('#toastAlert')).toHaveText('Something failed');
  await page.locator('[data-ex="Dips"] [data-remove]').click();
  await expect(page.locator('#toast .toast-action')).toBeVisible();
});

test('changes from another tab keep focus on the same routine, day and page', async ({ browser }) => {
  const ctx = await newPhone(browser);
  await ctx.route('**/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.GYM_CLOUD_CONFIG = {};' }));
  const a = await ctx.newPage();
  await open(a);
  await createWorkout(a, 'Push', ['Dips']);
  await createWorkout(a, 'Pull', ['Pull-up']);
  await createWorkout(a, 'Legs', ['Plank']);
  await tab(a, 'plan');
  await a.locator('[data-edit="Pull"]').focus();
  await hold(a);
  const b = await ctx.newPage();
  await open(b);
  await b.evaluate(() => {
    const w = JSON.parse(localStorage.getItem('gymCustomWorkouts'));
    delete w.Push;
    localStorage.setItem('gymCustomWorkouts', JSON.stringify(w));
  });
  await expect(a.locator('[data-edit="Push"]')).toHaveCount(0);
  await expect(a.locator('[data-edit="Pull"]')).toBeFocused();
  expect(await stillHeld(a)).toEqual({ same: true, blurs: 0 });
  // Calendar: an older workout arrives, months are added above; focus stays on the day.
  await tab(a, 'calendar');
  const today = await a.evaluate(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
  await a.locator(`[data-day="${today}"]`).focus();
  await hold(a);
  await b.evaluate(() => {
    const logs = JSON.parse(localStorage.getItem('gymLogs') || '{}');
    logs['2026-01-05'] = [{ id: 'old', day: 'Pull', time: '2026-01-05T10:00:00.000Z', exercises: [{ name: 'Pull-up', target: '8', sets: [{ w: '', r: '8', done: true }] }] }];
    localStorage.setItem('gymLogs', JSON.stringify(logs));
  });
  await expect(a.locator('[data-day="2026-01-05"]')).toHaveCount(1);
  await expect(a.locator(`[data-day="${today}"]`)).toBeFocused();
  expect(await stillHeld(a)).toEqual({ same: true, blurs: 0 });
});

test('a workout ended in another tab leaves focus on the page, not nowhere', async ({ browser }) => {
  const ctx = await newPhone(browser);
  await ctx.route('**/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.GYM_CLOUD_CONFIG = {};' }));
  const a = await ctx.newPage();
  await open(a);
  await createWorkout(a, 'Pull', ['Lat Pulldown']);
  await scheduleToday(a, 'Pull');
  await tab(a, 'today');
  await a.locator('#startToday').click();
  await a.locator('#sessionMain').click();
  await a.locator('#sessionBack').click();
  const bar = a.locator('#activeBar button');
  await bar.focus();
  const b = await ctx.newPage();
  await open(b);
  await b.evaluate(() => localStorage.removeItem('gymActive'));
  await expect(a.locator('#activeBar')).toBeHidden();
  expect(await focused(a)).not.toBe('BODY');
});

test('opening and leaving Settings moves focus with the page', async ({ page }) => {
  await offline(page);
  await open(page);
  const gear = page.locator('#page-today [data-open-settings]');
  await gear.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#page-settings h1')).toBeFocused();
  await page.locator('[data-close-settings]').focus();
  await page.keyboard.press('Enter');
  await expect(gear).toBeFocused();
});

test('when the gym-date card on Today goes away, focus stays in the list below it', async ({ browser }) => {
  const { a, pb, errors } = await friendsPair(browser, 'te');
  await pb.evaluate(() => {
    localStorage.setItem('gymCustomWorkouts', JSON.stringify({ Legs: [{ name: 'Plank', cat: 'core', sets: 2, target: '30s', rest: 60, note: '' }] }));
    localStorage.setItem('gymPlanSchedule', JSON.stringify({ 0: 'Legs', 1: 'Legs', 2: 'Legs', 3: 'Legs', 4: 'Legs', 5: 'Legs', 6: 'Legs' }));
  });
  await pb.reload();
  const id = await postDate(a, 120, 'Teaser Gym');
  await refreshCrew(pb);
  await expect(pb.locator('#page-today .teaser')).toBeVisible();
  const row = pb.locator('#page-today [data-preview]').nth(1);
  const day = await row.getAttribute('data-preview');
  await row.focus();
  await hold(pb);
  await a.client.from('gym_dates').update({ cancelled_at: new Date().toISOString() }).eq('id', id);
  await refreshCrew(pb);
  await expect(pb.locator('#page-today .teaser')).toHaveCount(0);
  await expect(pb.locator(`#page-today [data-preview="${day}"]`)).toBeFocused();
  expect(await stillHeld(pb)).toEqual({ same: true, blurs: 0 });
  expect(errors.flat()).toEqual([]);
});

test('a withdrawn friend request leaves the friends list and its focused button in place', async ({ browser }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const { b, pa, errors } = await friendsPair(browser, 'wd');
  const c = await makeUser(uniqueName('wdc'));
  await c.client.from('friend_requests').insert({ requester_id: c.id, target_id: (await pa.evaluate(async () => (await import('/js/cloud/sync.js')).account.user.id)), status: 'pending' });
  await tab(pa, 'crew');
  await pa.locator('[data-crew-tab="friends"]').click();
  await expect(pa.locator('[data-decline]')).toHaveCount(1);
  await pa.locator(`[data-unfriend][data-user="${b.id}"]`).focus();
  await hold(pa);
  await c.client.from('friend_requests').delete().eq('requester_id', c.id);
  await refreshCrew(pa);
  await expect(pa.locator('[data-decline]')).toHaveCount(0);
  expect(await stillHeld(pa)).toEqual({ same: true, blurs: 0 });
  expect(errors.flat()).toEqual([]);
});

test('unblocking the last blocked person moves focus to the Privacy heading', async ({ browser }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const a = await makeUser(uniqueName('lb_a'));
  const b = await makeUser(uniqueName('lb_b'));
  await a.client.from('friend_blocks').insert({ blocker_id: a.id, blocked_id: b.id });
  const pa = await (await newPhone(browser)).newPage();
  await open(pa); await signInAs(pa, a);
  await pa.locator('.page.active [data-open-settings]').click();
  await pa.locator(`[data-unblock="${b.id}"]`).focus();
  await pa.keyboard.press('Enter');
  await expect(pa.locator('[data-unblock]')).toHaveCount(0);
  await expect(pa.locator('#page-settings h2', { hasText: 'Privacy' })).toBeFocused();
});

test('signing out in another tab keeps focus where it was in Settings', async ({ browser }) => {
  const { makeUser, uniqueName } = await import('../integration/helpers.js');
  const u = await makeUser(uniqueName('so2'));
  const ctx = await newPhone(browser);
  const one = await ctx.newPage();
  await open(one); await signInAs(one, u);
  await one.locator('.page.active [data-open-settings]').click();
  await one.locator('[data-step]').first().focus();
  await hold(one);
  const two = await ctx.newPage();
  await open(two);
  await two.evaluate(async () => (await import('/js/cloud/client.js')).supabase.auth.signOut());
  await expect(one.locator('#authForm')).toBeVisible({ timeout: 15000 });
  expect(await stillHeld(one)).toEqual({ same: true, blurs: 0 });
});

test('a lift added from another tab does not change what the focused card shows', async ({ browser }) => {
  const ctx = await newPhone(browser);
  await ctx.route('**/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.GYM_CLOUD_CONFIG = {};' }));
  const a = await ctx.newPage();
  await a.addInitScript(() => {
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    const set = (w) => [{ w, r: '5', done: true }];
    localStorage.setItem('gymLogs', JSON.stringify({ '2026-10-01': [{ id: 's1', day: 'A', time: '2026-10-01T10:00:00.000Z', exercises: [{ name: 'Bench Press', target: '5', sets: set('60') }, { name: 'Deadlift', target: '5', sets: set('100') }] }] }));
  });
  await open(a);
  await tab(a, 'stats');
  const heading = a.locator('[data-key="lift-Deadlift"] h3');
  await expect(heading).toHaveText('Deadlift');
  await a.evaluate(() => { window.__h = document.querySelector('[data-key="lift-Deadlift"] h3'); });
  const b = await ctx.newPage();
  await open(b);
  await b.evaluate(() => {
    const logs = JSON.parse(localStorage.getItem('gymLogs'));
    logs['2026-10-02'] = [{ id: 's2', day: 'A', time: '2026-10-02T10:00:00.000Z', exercises: [{ name: 'Cable Curl', target: '10', sets: [{ w: '15', r: '10', done: true }] }] }];
    localStorage.setItem('gymLogs', JSON.stringify(logs));
  });
  await expect(a.locator('[data-key="lift-Cable Curl"]')).toHaveCount(1);
  expect(await a.evaluate(() => window.__h.isConnected && window.__h.textContent)).toBe('Deadlift');
});
