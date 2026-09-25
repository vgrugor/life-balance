import { expect, test } from 'playwright/test';

test.use({ timezoneId: 'UTC' });

async function createRecurringTask(page, { title, createdAt, repeat, weekdays = [], postponed = false }) {
  await page.locator('[data-view="tasks"]').click();
  await page.locator('#taskTitle').fill(title);
  await page.locator('#taskCreatedAt').fill(createdAt);
  await page.locator('#taskRepeat').selectOption(repeat);
  for (const day of weekdays) await page.locator(`[name="repeatDay"][value="${day}"]`).check();
  if (postponed) await page.locator('#taskPostponed').check();
  await page.locator('#taskForm button[type="submit"]').click();
  await expect(page.locator('#taskTitle')).toHaveValue('');
}

async function selectPlanDate(page, date) {
  await page.locator('[data-view="plan"]').click();
  await page.locator('#planDate').fill(date);
}

function suggestion(page, title) {
  return page.locator('#recurringSuggestions .suggestion-card').filter({ hasText: title });
}

test('daily and weekly suggestions respect the creation date and require manual planning', async ({ page }) => {
  await page.goto('/');
  await createRecurringTask(page, { title: 'Daily habit', createdAt: '2024-01-01T12:00', repeat: 'daily' });
  await createRecurringTask(page, { title: 'Weekly habit', createdAt: '2024-01-01T12:00', repeat: 'weekly' });

  await selectPlanDate(page, '2023-12-31');
  await expect(suggestion(page, 'Daily habit')).toHaveCount(0);
  await expect(suggestion(page, 'Weekly habit')).toHaveCount(0);

  await selectPlanDate(page, '2024-01-01');
  await expect(suggestion(page, 'Daily habit')).toHaveCount(1);
  await expect(suggestion(page, 'Weekly habit')).toHaveCount(1);

  await selectPlanDate(page, '2024-01-02');
  await expect(suggestion(page, 'Daily habit')).toHaveCount(1);
  await expect(suggestion(page, 'Weekly habit')).toHaveCount(0);

  await selectPlanDate(page, '2024-01-08');
  await expect(suggestion(page, 'Daily habit')).toHaveCount(1);
  await expect(suggestion(page, 'Weekly habit')).toHaveCount(1);
  await expect(page.locator('#planList .plan-card')).toHaveCount(0);

  await page.locator('.suggestions-accordion summary').click();
  await suggestion(page, 'Daily habit').getByRole('button', { name: 'Запланувати' }).click();
  await expect(suggestion(page, 'Daily habit')).toHaveCount(0);
  await expect(suggestion(page, 'Weekly habit')).toHaveCount(1);
  await expect(page.locator('#planList .plan-card .title')).toHaveText('Daily habit');

  await selectPlanDate(page, '2024-01-09');
  await expect(suggestion(page, 'Daily habit')).toHaveCount(1);
  await expect(suggestion(page, 'Weekly habit')).toHaveCount(0);
  await expect(page.locator('#planList .plan-card')).toHaveCount(0);
});

test('selected weekdays match only the chosen days after creation', async ({ page }) => {
  await page.goto('/');
  await createRecurringTask(page, {
    title: 'Monday and Wednesday',
    createdAt: '2024-01-01T12:00',
    repeat: 'weekdays',
    weekdays: [1, 3]
  });

  for (const [date, expectedCount] of [
    ['2023-12-27', 0],
    ['2024-01-02', 0],
    ['2024-01-03', 1],
    ['2024-01-08', 1],
    ['2024-01-09', 0]
  ]) {
    await selectPlanDate(page, date);
    await expect(suggestion(page, 'Monday and Wednesday')).toHaveCount(expectedCount);
  }
});

test('monthly recurrence on the 31st skips shorter months', async ({ page }) => {
  await page.goto('/');
  await createRecurringTask(page, { title: 'Month end', createdAt: '2024-01-31T12:00', repeat: 'monthly' });

  for (const [date, expectedCount] of [
    ['2024-01-30', 0],
    ['2024-01-31', 1],
    ['2024-02-29', 0],
    ['2024-03-31', 1],
    ['2024-04-30', 0],
    ['2024-05-31', 1]
  ]) {
    await selectPlanDate(page, date);
    await expect(suggestion(page, 'Month end')).toHaveCount(expectedCount);
  }
});

test('a postponed recurring task reappears on hiddenUntil', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-03-20T12:00:00Z'));
  await page.goto('/');
  await createRecurringTask(page, {
    title: 'Postponed habit',
    createdAt: '2026-03-01T12:00',
    repeat: 'daily',
    postponed: true
  });

  await selectPlanDate(page, '2026-04-18');
  await expect(suggestion(page, 'Postponed habit')).toHaveCount(0);
  await selectPlanDate(page, '2026-04-19');
  await expect(suggestion(page, 'Postponed habit')).toHaveCount(1);
});
