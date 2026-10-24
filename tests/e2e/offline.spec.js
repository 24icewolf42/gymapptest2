// Core tracking works without an account: plan, log, calendar, stats, backup.
import { test, expect, trackErrors, open, tab, createWorkout, scheduleToday, fillPrompt, sheetAction } from './helpers.js';

test.beforeEach(async ({ page }) => {
  // No cloud: these flows must work fully offline.
  await page.route('**/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.GYM_CLOUD_CONFIG = {};' }));
});

test('plan a workout, log it, and see it in calendar and stats', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page);
  await expect(page.getByText('Build your first workout')).toBeVisible();
  await createWorkout(page, 'Push', ['Barbell Bench Press', 'Single-Arm Cable Lateral Raises']);
  await scheduleToday(page, 'Push');

  await tab(page, 'today');
  await expect(page.locator('.hero-title')).toHaveText('Push');
  await page.locator('#startToday').click();
  const session = page.locator('#session');
  await expect(session).toBeVisible();
  // Unilateral exercise shows left/right rows.
  await expect(session.locator('.ex-card').nth(1).locator('.set-label').first()).toHaveText('L1');
  await session.getByRole('button', { name: 'Start workout' }).click();
  const bench = session.locator('.ex-card').first();
  await bench.locator('.w').first().fill('62.5');
  await bench.locator('.r').first().fill('8');
  await bench.locator('.check').first().click();
  await expect(page.locator('#restBar')).toBeVisible();
  await expect(bench.locator('.ex-count [aria-hidden]')).toHaveText('1/2');
  await session.getByRole('button', { name: 'Finish workout' }).click();
  await sheetAction(page, 'Save workout');
  await expect(session).toBeHidden();
  await expect(page.locator('#toast')).toContainText('Workout saved');
  await expect(page.locator('.hero-card.done')).toBeVisible();

  // Exact weight kept (older versions rounded to 5 kg).
  const logs = await page.evaluate(() => JSON.parse(localStorage.getItem('gymLogs')));
  const today = Object.keys(logs)[0];
  expect(logs[today][0].exercises[0].sets[0]).toEqual({ w: '62.5', r: '8', done: true });

  await tab(page, 'calendar');
  await expect(page.locator(`[data-day="${today}"]`)).toHaveClass(/logged/);
  await tab(page, 'stats');
  await expect(page.locator('.lift h3')).toHaveText('Barbell Bench Press');
  await expect(page.locator('.tiles .tile').first()).toContainText('1');

  await page.reload();
  await expect(page.locator('.hero-card.done')).toBeVisible();
  expect(errors).toEqual([]);
});

test('an unfinished workout survives closing and reopening', async ({ page }) => {
  await open(page);
  await createWorkout(page, 'Legs', ['Leg Press']);
  await scheduleToday(page, 'Legs');
  await tab(page, 'today');
  await page.locator('#startToday').click();
  await page.locator('#sessionMain').click();
  await page.locator('#session .w').first().fill('100');
  await page.locator('#session .check').first().click();
  await expect(page.locator('#session .d').first()).toBeChecked();
  await expect(page.locator('#session .ex-count [aria-hidden]').first()).toHaveText('1/2');
  await page.locator('#sessionBack').click();
  await expect(page.locator('#activeBar')).toBeVisible();
  await page.locator('#activeBar button').click();
  await expect(page.locator('#session .w').first()).toHaveValue('100');
  await expect(page.locator('#session .ex-count [aria-hidden]').first()).toHaveText('1/2');
  // The phone's back gesture closes the workout instead of leaving the app.
  await page.goBack();
  await expect(page.locator('#session')).toBeHidden();
});

test('workout names never run as code: markup is removed and the rest is shown as text', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => {
    window.__xss = false;
    const evil = '<img src=x onerror="window.__xss=true">';
    localStorage.setItem('gymCustomWorkouts', JSON.stringify({ [evil]: [{ name: evil, cat: 'chest', sets: 1, target: evil, rest: 60, note: evil }] }));
    const dow = (new Date().getDay() + 6) % 7;
    localStorage.setItem('gymPlanSchedule', JSON.stringify({ [dow]: evil }));
  });
  await open(page);
  await expect(page.locator('.hero-title')).toHaveText('img src=x onerror=window.__xss=true');
  await page.locator('#startToday').click();
  await expect(page.locator('#session h3')).toHaveText('img src=x onerror=window.__xss=true');
  await page.locator('#sessionBack').click();
  for (const t of ['plan', 'calendar', 'stats']) await tab(page, t);
  expect(await page.evaluate(() => window.__xss)).toBe(false);
  expect(errors).toEqual([]);
});

test('data from the previous app version loads and is upgraded', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    localStorage.setItem('gymCustomWorkouts', JSON.stringify({
      Arms: [{ name: 'Single-Arm Tricep Pushdowns', cat: 'triceps', sets: 4, target: '12', rest: 90, note: '' }, { name: 'Preacher Curls', cat: 'biceps', sets: 3, target: '10', note: '' }],
    }));
    localStorage.setItem('gymPlanSchedule', JSON.stringify({ 0: 'Arms', 1: 'Gone' }));
    localStorage.setItem('gymLastUsed', JSON.stringify({ 'Arms||Preacher Curls': { sets: [{ w: '20', r: '10' }] } }));
    localStorage.setItem('gymLogs', JSON.stringify({ '2026-01-05': [{ day: 'Arms', time: '2026-01-05T18:00:00Z', duration: 2400, exercises: [{ name: 'Preacher Curls', target: '10', sets: [{ w: '25', r: '8', done: true }] }] }] }));
    localStorage.setItem('bodyWeightLogs', JSON.stringify([{ date: '2026-01-05', weight: 70 }]));
  });
  await open(page);
  const s = await page.evaluate(() => ({
    w: JSON.parse(localStorage.getItem('gymCustomWorkouts')),
    sch: JSON.parse(localStorage.getItem('gymPlanSchedule')),
    lu: JSON.parse(localStorage.getItem('gymLastUsed')),
  }));
  expect(s.w.Arms[0]).toMatchObject({ unilateral: true, sets: 4 });
  expect(s.w.Arms[1].rest).toBe(90);
  expect(s.sch[1]).toBeNull();
  expect(s.lu['Preacher Curls'].sets[0].w).toBe('25');
  await tab(page, 'stats');
  await expect(page.locator('.lift h3')).toHaveText('Preacher Curls');
  await expect(page.locator('#weightCard .big-num')).toContainText('70');
});

test('backup restores workouts, plan and weigh-ins', async ({ page }) => {
  await open(page);
  await createWorkout(page, 'Pull', ['Lat Pulldown']);
  await scheduleToday(page, 'Pull');
  await tab(page, 'stats');
  await page.locator('#weightInput').fill('71.4');
  await page.getByRole('button', { name: 'Log', exact: true }).click();
  const backup = await page.evaluate(async () => {
    const { makeBackup } = await import('/js/domain/backup.js');
    return makeBackup((k) => localStorage.getItem(k), 'test');
  });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByText('Build your first workout')).toBeVisible();
  await page.locator('.page.active [data-open-settings]').first().click();
  await page.locator('[data-restore]').click();
  await page.locator('.sheet textarea[name=paste]').fill(backup);
  await sheetAction(page, 'Restore pasted text');
  await sheetAction(page, 'Restore');
  await expect(page.locator('#page-today .hero-title')).toHaveText('Pull', { timeout: 10000 });
  await tab(page, 'stats');
  await expect(page.locator('#weightCard .big-num')).toContainText('71.4');
});

test('rename and delete a workout keep the schedule consistent', async ({ page }) => {
  await open(page);
  await createWorkout(page, 'Upper', ['Pull-up']);
  await scheduleToday(page, 'Upper');
  await page.locator('[data-edit="Upper"]').click();
  await page.locator('[data-rename]').click();
  await fillPrompt(page, 'Upper A');
  await expect(page.locator('#page-plan h1')).toHaveText('Upper A');
  await page.locator('[data-close-editor]').click();
  const dow = (new Date().getDay() + 6) % 7;
  await expect(page.locator(`[data-day="${dow}"] b`)).toHaveText('Upper A');
  await page.locator('[data-edit="Upper A"]').click();
  await page.locator('[data-delete]').click();
  await sheetAction(page, 'Delete');
  await expect(page.locator(`[data-day="${dow}"] b`)).toHaveText('Rest');
});
