import { expect, test } from 'playwright/test';

async function createTask(page, title) {
  await page.locator('#taskTitle').fill(title);
  await page.locator('#taskForm button[type="submit"]').click();
  await expect(page.locator('#taskList .quadrant-accordion .card').filter({ hasText: title })).toBeVisible();
}

async function planTask(page, title) {
  await page.locator('#planTaskSelect').selectOption({ label: `${title} · маленька` });
  await page.locator('#planForm button[type="submit"]').click();
  await expect(page.locator('#planList .plan-card').filter({ hasText: title })).toBeVisible();
}

test('a new task appears in the quadrant library and survives a reload', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-view="tasks"]').click();

  await createTask(page, 'Morning walk');
  await expect(page.locator('#taskList .quadrant-accordion.self-care')).toContainText('Morning walk');

  await page.reload();
  await page.locator('[data-view="tasks"]').click();
  await expect(page.locator('#taskList .quadrant-accordion .card').filter({ hasText: 'Morning walk' })).toHaveCount(1);
});

test('planned order and completion persist after a reload', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-view="tasks"]').click();
  await createTask(page, 'First task');
  await createTask(page, 'Second task');

  await page.locator('[data-view="plan"]').click();
  const planDate = await page.locator('#planDate').inputValue();
  await planTask(page, 'First task');
  await planTask(page, 'Second task');
  await expect(page.locator('#planList .plan-card .title')).toHaveText(['First task', 'Second task']);

  await page.locator('#planList .plan-card').filter({ hasText: 'Second task' }).locator('[data-direction="up"]').click();
  await expect(page.locator('#planList .plan-card .title')).toHaveText(['Second task', 'First task']);

  await page.reload();
  await page.locator('[data-view="plan"]').click();
  await page.locator('#planDate').fill(planDate);
  await expect(page.locator('#planList .plan-card .title')).toHaveText(['Second task', 'First task']);

  await page.locator('[data-view="today"]').click();
  await page.locator('#todayDatePicker').fill(planDate);
  await expect(page.locator('#todayList .today-card .title')).toHaveText(['Second task', 'First task']);
  await page.locator('#todayList .today-card').filter({ hasText: 'Second task' }).getByRole('button', { name: 'Готово' }).click();
  await expect(page.locator('#todayList .done-accordion .title')).toHaveText('Second task');

  await page.reload();
  await page.locator('#todayDatePicker').fill(planDate);
  await expect(page.locator('#todayList .done-accordion .title')).toHaveText('Second task');
  await expect(page.locator('#todayList .today-card:not(.is-done) .title')).toHaveText('First task');
});
