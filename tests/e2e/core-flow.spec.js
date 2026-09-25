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

test('a new task is planned for the optional date when saved', async ({ page }) => {
  const date = '2030-05-17';
  await page.goto('/');
  await page.locator('[data-view="tasks"]').click();
  await expect(page.locator('#taskPlanDateField')).toBeVisible();
  await page.locator('#taskTitle').fill('Plan on save');
  await page.locator('#taskPlanDate').fill(date);
  await page.locator('#taskForm button[type="submit"]').click();
  await expect(page.locator('#taskPlanDate')).toHaveValue('');
  await expect(page.locator('#taskList .card').filter({ hasText: 'Plan on save' })).toBeVisible();

  await page.locator('[data-view="plan"]').click();
  await page.locator('#planDate').fill(date);
  await expect(page.locator('#planList .plan-card .title')).toHaveText('Plan on save');

  await page.locator('[data-view="today"]').click();
  await page.locator('#todayDatePicker').fill(date);
  await expect(page.locator('#todayList .today-card .title')).toHaveText('Plan on save');

  await page.reload();
  await page.locator('[data-view="plan"]').click();
  await page.locator('#planDate').fill(date);
  await expect(page.locator('#planList .plan-card .title')).toHaveText('Plan on save');
});

test('leaving the optional date blank saves only the task', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-view="tasks"]').click();
  await expect(page.locator('#taskPlanDate')).toHaveValue('');
  await createTask(page, 'Keep unplanned');

  await page.locator('[data-view="plan"]').click();
  await expect(page.locator('#planList .plan-card')).toHaveCount(0);
  await expect(page.locator('#planTaskSelect')).toContainText('Keep unplanned');
});

test('editing a task does not add another plan', async ({ page }) => {
  const date = '2030-05-17';
  await page.goto('/');
  await page.locator('[data-view="tasks"]').click();
  await page.locator('#taskTitle').fill('Original task');
  await page.locator('#taskPlanDate').fill(date);
  await page.locator('#taskForm button[type="submit"]').click();
  const card = page.locator('#taskList .card').filter({ hasText: 'Original task' });
  await expect(card).toBeVisible();

  await card.locator('[data-edit-task]').click();
  await expect(page.locator('#taskPlanDateField')).toBeHidden();
  await page.locator('#taskTitle').fill('Edited task');
  await page.locator('#taskForm button[type="submit"]').click();
  await expect(page.locator('#taskPlanDateField')).toBeVisible();
  await page.locator('[data-view="plan"]').click();
  await page.locator('#planDate').fill(date);
  await expect(page.locator('#planList .plan-card .title')).toHaveText('Edited task');
});

test('editing a task scrolls back to the form', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 667 });
  await page.goto('/');
  await page.locator('[data-view="tasks"]').click();
  await createTask(page, 'Task to edit');
  await createTask(page, 'Another task');

  await page.locator('#taskList .card').filter({ hasText: 'Task to edit' }).locator('[data-edit-task]').click();

  await expect(page.locator('#taskTitle')).toHaveValue('Task to edit');
  const formTop = await page.locator('#taskForm').evaluate((form) => form.getBoundingClientRect().top);
  const tabsBottom = await page.locator('.tabs').evaluate((tabs) => tabs.getBoundingClientRect().bottom);
  expect(formTop).toBeGreaterThanOrEqual(tabsBottom);
  expect(formTop).toBeLessThan(tabsBottom + 30);
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
