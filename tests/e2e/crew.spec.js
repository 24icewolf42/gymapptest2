// Gym dates, friends, ranking and shared routines, end to end with two users.
import { test, expect, tab, sheetAction, friendsPair, createWorkout, fillPrompt } from './helpers.js';

async function postDate(page, { quick = '30', gym = 'McFit Mitte', start = null, pick = null } = {}) {
  await tab(page, 'crew');
  await page.locator('[data-crew-tab="dates"]').click();
  await page.locator(`[data-quick="${quick}"]`).click();
  const sheet = page.locator('.date-sheet');
  await sheet.locator('[name=gym]').fill(gym);
  if (start) await sheet.locator('[name=start]').fill(start);
  if (pick) {
    await sheet.locator('input[name=who][value=some]').check();
    await sheet.locator(`input[name=invite][value="${pick}"]`).check();
  }
  await sheet.locator('[type=submit]').click();
}

test('replies Maybe and Can’t, checks in at a live date, and validates the form', async ({ browser }) => {
  const { pa, pb, errors } = await friendsPair(browser, 'g');
  // Validation: an empty gym is refused with a message.
  await tab(pa, 'crew');
  await pa.locator('[data-quick="0"]').click();
  await pa.locator('.sheet-backdrop.open .date-sheet [name=gym]').fill('');
  await pa.locator('.sheet-backdrop.open .date-sheet [type=submit]').click();
  await expect(pa.locator('.sheet-backdrop.open .date-sheet .form-error')).toContainText('gym');
  await pa.locator('.sheet-backdrop.open .date-sheet [name=gym]').fill('Live Gym');
  await pa.locator('.sheet-backdrop.open .date-sheet [type=submit]').click();
  await expect(pa.locator('.date-card.live')).toContainText('Live Gym');

  await tab(pb, 'crew');
  const card = pb.locator('.date-card', { hasText: 'Live Gym' });
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.locator('[data-reply="maybe"]').click();
  await expect(card.locator('[data-reply="maybe"]')).toHaveAttribute('aria-checked', 'true');
  await card.locator('[data-reply="no"]').click();
  await expect(card.locator('[data-reply="no"]')).toHaveAttribute('aria-checked', 'true');
  await expect(card.locator('[data-checkin]')).toHaveCount(0);
  await card.locator('[data-reply="going"]').click();
  await card.locator('[data-checkin]').click();
  await expect(card).toContainText('You are at the gym');
  await expect(pa.locator('.date-card.live')).toContainText('1 there now', { timeout: 15000 });
  expect(errors.flat()).toEqual([]);
});

test('invite-only dates and "Plan later" reach only the picked friend', async ({ browser }) => {
  const { a, pa, pb, errors } = await friendsPair(browser, 'i');
  const { makeUser, uniqueName, befriend } = await import('../integration/helpers.js');
  const third = await makeUser(uniqueName('third'));
  await befriend(a, third);
  const b = { id: (await pb.evaluate(() => JSON.parse(localStorage.getItem('gymSyncState')).accountId)) };
  const later = new Date(Date.now() + 3 * 86400e3);
  later.setHours(18, 30, 0, 0);
  const local = later.getFullYear() + '-' + String(later.getMonth() + 1).padStart(2, '0') + '-' + String(later.getDate()).padStart(2, '0') + 'T18:30';
  await tab(pa, 'crew');
  await expect(pa.locator('.quick-card')).toBeVisible();
  await postDate(pa, { quick: 'later', gym: 'Secret Gym', start: local, pick: b.id });
  await expect(pa.locator('.date-card.mine')).toContainText('1 invited');
  await expect(pa.locator('.date-card.mine')).toContainText('18:30');
  await tab(pb, 'crew');
  await expect(pb.locator('.date-card', { hasText: 'Secret Gym' })).toContainText('Invite only', { timeout: 10000 });
  // The third friend does not see it.
  const r = await third.client.from('gym_dates').select('gym');
  expect(r.data.map((x) => x.gym)).not.toContain('Secret Gym');
  expect(errors.flat()).toEqual([]);
});

test('shares stats to the ranking and stops sharing', async ({ browser }) => {
  const { pa, pb, errors } = await friendsPair(browser, 'r');
  await tab(pa, 'crew');
  await pa.locator('[data-crew-tab="ranking"]').click();
  await pa.locator('[data-publish]').click();
  await expect(pa.locator('#toast')).toContainText('shared');
  await tab(pb, 'crew');
  await pb.locator('[data-crew-tab="ranking"]').click();
  const row = pb.locator('.ranking [data-key^="rank-"]').filter({ hasText: '0 workouts' });
  await expect(row).toBeVisible();
  await pa.locator('[data-unpublish]').click();
  await expect(pa.locator('[data-publish]')).toHaveText('Share my stats');
  await pb.locator('[data-crew-tab="dates"]').click();
  await pb.locator('[data-crew-tab="ranking"]').click();
  await expect(pb.locator('.ranking')).not.toContainText('0 workouts');
  expect(errors.flat()).toEqual([]);
});

test('a shared routine can be copied by a friend', async ({ browser }) => {
  const { pa, pb, errors } = await friendsPair(browser, 's');
  await createWorkout(pa, 'Arms day', ['Hammer Curl']);
  await pa.locator('[data-edit="Arms day"]').click();
  await pa.locator('[data-share]').click();
  await fillPrompt(pa, 'Arms by A');
  await expect(pa.locator('#toast')).toContainText('Shared');
  await tab(pb, 'crew');
  await pb.locator('[data-crew-tab="friends"]').click();
  await pb.locator('[data-copy-shared]').click();
  await fillPrompt(pb, 'Arms copy');
  await tab(pb, 'plan');
  await expect(pb.locator('[data-edit="Arms copy"]')).toContainText('1 exercise');
  expect(errors.flat()).toEqual([]);
});

test('blocking removes the friend and stops new requests', async ({ browser }) => {
  const { b, pa, pb, errors } = await friendsPair(browser, 'b');
  await tab(pb, 'crew');
  await pb.locator('[data-crew-tab="friends"]').click();
  await pb.locator('[data-unfriend]').click();
  await sheetAction(pb, 'Remove and block');
  await expect(pb.locator('#toast')).toContainText('blocked');
  await tab(pa, 'crew');
  await pa.locator('[data-crew-tab="friends"]').click();
  await pa.locator('#friendName').fill(b.username);
  await pa.locator('#addFriendForm [type=submit]').click();
  await expect(pa.locator('#toast')).toContainText('No one is called');
  // Settings lists the block and can undo it.
  await pb.locator('.page.active [data-open-settings]').click();
  await expect(pb.locator('[data-unblock]')).toHaveCount(1);
  expect(errors.flat()).toEqual([]);
});

test('a background refresh keeps keyboard focus and half-typed text', async ({ browser }) => {
  const { pa, pb, errors } = await friendsPair(browser, 'f');
  await tab(pa, 'crew');
  await pa.locator('[data-crew-tab="friends"]').click();
  const input = pa.locator('#friendName');
  await input.click();
  await input.pressSequentially('half_typ');
  // Friend B posts a gym date: A gets a live update and refreshes in the background.
  await postDate(pb, { quick: '60', gym: 'Background Gym' });
  await pa.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => pa.evaluate(() => document.querySelectorAll('.nav-btn .badge:not([hidden])').length), { timeout: 15000 }).toBe(1);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('half_typ');
  await input.pressSequentially('ed');
  await expect(input).toHaveValue('half_typed');
  expect(errors.flat()).toEqual([]);
});
