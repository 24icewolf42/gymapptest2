// Server results, background refreshes and pending states must never move or
// drop keyboard focus (and with it the screen-reader position).
import { test, expect, open, tab, createWorkout, scheduleToday, friendsPair, newPhone, signInAs, trackErrors } from './helpers.js';

const offline = (page) => page.route('**/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.GYM_CLOUD_CONFIG = {};' }));
const refreshCrew = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
const focused = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return el === document.body ? 'BODY' : (el.getAttribute('aria-label') || el.textContent).trim();
});

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
  await expect(pb.locator('#page-crew h1')).toBeFocused();
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

test('an Undo toast stays while it has focus, then focus goes back', async ({ page }) => {
  await offline(page);
  await open(page);
  await createWorkout(page, 'Upper', ['Pull-up', 'Dips']);
  await page.locator('[data-edit="Upper"]').click();
  await page.locator('[data-ex="Dips"] [data-remove]').click();
  const undo = page.locator('#toast .toast-action');
  await undo.focus();
  await page.waitForTimeout(11000);
  await expect(undo).toBeVisible();
  await expect(undo).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-ex="Dips"]')).toHaveCount(1);
  expect(await focused(page)).not.toBe('BODY');
});
