import { readFile } from 'node:fs/promises';
import { expect, test } from 'playwright/test';

const SHEETS_URL = 'https://script.google.com/macros/s/test-deployment/exec';
const SHEETS_KEY = 'test-key-never-use-in-production';

test.use({ serviceWorkers: 'block' });

async function createTask(page, title) {
  await page.locator('[data-view="tasks"]').click();
  await page.locator('#taskTitle').fill(title);
  await page.locator('#taskForm button[type="submit"]').click();
  await expect(page.locator('#taskList .card').filter({ hasText: title })).toBeVisible();
}

async function setSheetsSettings(page, key = SHEETS_KEY) {
  await page.locator('[data-view="backup"]').click();
  await page.locator('#sheetsAppUrl').fill(SHEETS_URL);
  await page.locator('#sheetsApiKey').fill(key);
  await page.locator('#sheetsSettingsForm button[type="submit"]').click();
  await expect(page.locator('#backupStatus')).toContainText('збережено локально');
}

function replyToJsonp(route, payload) {
  const callback = new URL(route.request().url()).searchParams.get('callback');
  return route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: `${callback}(${JSON.stringify(payload)});`
  });
}

async function readLocalData(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('balance-quadrants-db');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stores = ['tasks', 'plans', 'logs'];
    const transaction = database.transaction(stores);
    const values = await Promise.all(stores.map((store) => new Promise((resolve, reject) => {
      const request = transaction.objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    })));
    database.close();
    return Object.fromEntries(stores.map((store, index) => [store, values[index]]));
  });
}

test('JSON backup restores tasks, plans, and logs without exporting local settings', async ({ page, browser }) => {
  await page.goto('/');
  await createTask(page, 'Restore me');
  await page.locator('[data-view="plan"]').click();
  const planDate = await page.locator('#planDate').inputValue();
  await page.locator('#planForm button[type="submit"]').click();
  await expect(page.locator('#planList .plan-card .title')).toHaveText('Restore me');
  await page.locator('[data-view="today"]').click();
  await page.locator('#todayDatePicker').fill(planDate);
  await page.locator('#todayList .today-card').getByRole('button', { name: 'Готово' }).click();
  await expect(page.locator('#todayList .done-accordion .title')).toHaveText('Restore me');

  await setSheetsSettings(page);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportJson').click();
  const download = await downloadPromise;
  const backup = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(backup).toMatchObject({ schemaVersion: 1 });
  expect(backup.tasks).toHaveLength(1);
  expect(backup.plans).toHaveLength(1);
  expect(backup.logs).toHaveLength(1);
  expect(backup).not.toHaveProperty('settings');
  expect(JSON.stringify(backup)).not.toContain(SHEETS_URL);
  expect(JSON.stringify(backup)).not.toContain(SHEETS_KEY);

  const restoredContext = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const restoredPage = await restoredContext.newPage();
    await restoredPage.goto('/');
    await restoredPage.locator('[data-view="backup"]').click();
    await restoredPage.locator('#importJson').setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup))
    });
    await expect(restoredPage.locator('#backupStatus')).toHaveText('JSON-бекап імпортовано.');
    await expect(restoredPage.locator('#sheetsAppUrl')).toHaveValue('');
    await expect(restoredPage.locator('#sheetsApiKey')).toHaveValue('');

    await restoredPage.locator('[data-view="plan"]').click();
    await restoredPage.locator('#planDate').fill(planDate);
    await expect(restoredPage.locator('#planList .plan-card .title')).toHaveText('Restore me');
    await restoredPage.locator('[data-view="today"]').click();
    await restoredPage.locator('#todayDatePicker').fill(planDate);
    await expect(restoredPage.locator('#todayList .done-accordion .title')).toHaveText('Restore me');

    await restoredPage.reload();
    await restoredPage.locator('#todayDatePicker').fill(planDate);
    await expect(restoredPage.locator('#todayList .done-accordion .title')).toHaveText('Restore me');
  } finally {
    await restoredContext.close();
  }
});

test('invalid JSON backup leaves existing data intact', async ({ page }) => {
  await page.goto('/');
  await createTask(page, 'Keep me');
  await page.locator('[data-view="backup"]').click();
  await page.locator('#importJson').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ tasks: [], plans: [] }))
  });
  await expect(page.locator('#backupStatus')).toContainText('Файл не схожий на бекап');
  await page.reload();
  await page.locator('[data-view="tasks"]').click();
  await expect(page.locator('#taskList .card').filter({ hasText: 'Keep me' })).toHaveCount(1);
});

test('a write failure rolls back the entire JSON restore', async ({ page }) => {
  await page.goto('/');
  await createTask(page, 'Keep all stores');
  await page.locator('[data-view="plan"]').click();
  const planDate = await page.locator('#planDate').inputValue();
  await page.locator('#planForm button[type="submit"]').click();
  await page.locator('[data-view="today"]').click();
  await page.locator('#todayDatePicker').fill(planDate);
  await page.locator('#todayList .today-card').getByRole('button', { name: 'Готово' }).click();
  await expect(page.locator('#todayList .done-accordion .title')).toHaveText('Keep all stores');
  const before = await readLocalData(page);
  expect(before.tasks).toHaveLength(1);
  expect(before.plans).toHaveLength(1);
  expect(before.logs).toHaveLength(1);

  await page.locator('[data-view="backup"]').click();
  await page.locator('#importJson').setInputFiles({
    name: 'broken-record.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      tasks: [{ id: 'replacement', title: 'Partial write' }, { title: 'Missing id' }],
      plans: [],
      logs: []
    }))
  });
  await expect(page.locator('#backupStatus')).not.toBeEmpty();
  await expect(page.locator('#backupStatus')).not.toHaveText('JSON-бекап імпортовано.');
  await page.reload();
  expect(await readLocalData(page)).toEqual(before);
});

test('a write failure rolls back Sheets restore', async ({ page }) => {
  await page.route('https://script.google.com/macros/s/**', (route) =>
    replyToJsonp(route, {
      ok: true,
      savedAt: '2026-03-20T12:00:00.000Z',
      data: { tasks: [{ id: 'replacement', title: 'Partial write' }, { title: 'Missing id' }], plans: [], logs: [] }
    }));

  await page.goto('/');
  await createTask(page, 'Keep after Sheets failure');
  const before = await readLocalData(page);
  await setSheetsSettings(page);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#restoreFromSheets').click();
  await expect(page.locator('#backupStatus')).toContainText('Google Sheets:');
  await page.reload();
  expect(await readLocalData(page)).toEqual(before);
});

test('Sheets backup verifies the write and restore replaces local data', async ({ page }) => {
  let savedBackup;
  await page.route('https://script.google.com/macros/s/**', async (route) => {
    if (route.request().method() === 'POST') {
      savedBackup = JSON.parse(route.request().postData());
      await route.fulfill({ status: 200, body: 'ok' });
      return;
    }
    await replyToJsonp(route, { ok: true, savedAt: savedBackup.savedAt, data: savedBackup.data });
  });

  await page.goto('/');
  await createTask(page, 'Sheets restore');
  await setSheetsSettings(page);
  await page.locator('#backupToSheets').click();
  await expect(page.locator('#backupStatus')).toContainText('Backup збережено в Google Sheets');
  expect(savedBackup.key).toBe(SHEETS_KEY);
  expect(savedBackup.data.tasks).toHaveLength(1);
  expect(savedBackup.data).not.toHaveProperty('settings');

  await page.locator('[data-view="tasks"]').click();
  await page.locator('#taskList .card').filter({ hasText: 'Sheets restore' }).locator('[data-delete-task]').click();
  await expect(page.locator('#taskList .card').filter({ hasText: 'Sheets restore' })).toHaveCount(0);

  await page.locator('[data-view="backup"]').click();
  page.once('dialog', (dialog) => dialog.accept());
  const reloadPromise = page.waitForEvent('load');
  await page.locator('#restoreFromSheets').click();
  await reloadPromise;
  await page.locator('[data-view="tasks"]').click();
  await expect(page.locator('#taskList .card').filter({ hasText: 'Sheets restore' })).toHaveCount(1);
});

test('Sheets backup retries with a form when the first write is missing', async ({ page }) => {
  let savedBackup;
  let posts = 0;
  await page.route('https://script.google.com/macros/s/**', async (route) => {
    if (route.request().method() === 'POST') {
      posts += 1;
      if (posts === 2) savedBackup = JSON.parse(new URLSearchParams(route.request().postData()).get('payload'));
      await route.fulfill({ status: 200, body: 'ok' });
      return;
    }
    await replyToJsonp(route, savedBackup
      ? { ok: true, savedAt: savedBackup.savedAt, data: savedBackup.data }
      : { ok: false, error: 'Backup not found' });
  });

  await page.goto('/');
  await createTask(page, 'Form fallback');
  await setSheetsSettings(page);
  await page.locator('#backupToSheets').click();
  await expect(page.locator('#backupStatus')).toContainText('Backup збережено в Google Sheets');
  expect(posts).toBe(2);
  expect(savedBackup.data.tasks).toHaveLength(1);
});

test('Sheets rejects an invalid key without changing local data', async ({ page }) => {
  await page.route('https://script.google.com/macros/s/**', (route) =>
    replyToJsonp(route, { ok: false, error: 'Invalid key' }));

  await page.goto('/');
  await createTask(page, 'Stay local');
  await setSheetsSettings(page, 'wrong-key');
  await page.locator('#testSheetsConnection').click();
  await expect(page.locator('#backupStatus')).toContainText('Invalid key');
  await page.reload();
  await page.locator('[data-view="tasks"]').click();
  await expect(page.locator('#taskList .card').filter({ hasText: 'Stay local' })).toHaveCount(1);
});

test('Sheets reports a write that cannot be confirmed', async ({ page }) => {
  await page.route('https://script.google.com/macros/s/**', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 200, body: 'ok' });
      return;
    }
    await replyToJsonp(route, { ok: false, error: 'Backup not found' });
  });

  await page.goto('/');
  await createTask(page, 'Unconfirmed backup');
  await setSheetsSettings(page);
  await page.locator('#backupToSheets').click();
  await expect(page.locator('#backupStatus')).toContainText('Backup not found');
  await expect(page.locator('#backupStatus')).not.toContainText('Backup збережено в Google Sheets');
});
