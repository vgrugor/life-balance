import { expect, test } from 'playwright/test';

test.use({ timezoneId: 'UTC' });

const historyRows = [
  { id: 'today', title: 'Today S', date: '2026-03-31', quadrant: 'self-care', size: 'S' },
  { id: 'three-day-edge', title: '3-day edge M', date: '2026-03-29', quadrant: 'world-care', size: 'M' },
  { id: 'outside-three', title: 'Outside 3 days L', date: '2026-03-28', quadrant: 'self-growth', size: 'L' },
  { id: 'seven-day-edge', title: '7-day edge S', date: '2026-03-25', quadrant: 'world-growth', size: 'S' },
  { id: 'outside-seven', title: 'Outside 7 days M', date: '2026-03-24', quadrant: 'self-care', size: 'M' },
  { id: 'fourteen-day-edge', title: '14-day edge L', date: '2026-03-18', quadrant: 'world-care', size: 'L' },
  { id: 'outside-fourteen', title: 'Outside 14 days S', date: '2026-03-17', quadrant: 'self-growth', size: 'S' },
  { id: 'thirty-day-edge', title: '30-day edge M', date: '2026-03-02', quadrant: 'world-growth', size: 'M' },
  { id: 'outside-thirty', title: 'Outside 30 days L', date: '2026-03-01', quadrant: 'self-care', size: 'L' },
  { id: 'future', title: 'Future L', date: '2026-04-01', quadrant: 'self-care', size: 'L' }
];

const plannedTasks = [
  { id: 'planned-growth', title: 'Planned growth L', quadrant: 'self-growth', size: 'L' },
  { id: 'planned-world', title: 'Planned world M', quadrant: 'world-growth', size: 'M' }
];

async function loadBalanceFixture(page) {
  await page.clock.setFixedTime(new Date('2026-03-31T12:00:00Z'));
  await page.goto('/');

  const tasks = [...historyRows, ...plannedTasks].map((row) => ({
    id: `task-${row.id}`,
    title: row.title,
    quadrant: row.quadrant,
    size: row.size,
    repeat: 'none',
    repeatDays: [],
    note: '',
    createdAt: '2026-02-01T12:00:00.000Z',
    hiddenUntil: ''
  }));
  const logs = historyRows.map((row) => ({
    id: `log-${row.id}`,
    taskId: `task-${row.id}`,
    date: row.date,
    title: row.title,
    quadrant: row.quadrant,
    size: row.size,
    completedAt: `${row.date}T12:00:00.000Z`
  }));
  const plans = plannedTasks.map((row, order) => ({
    id: `plan-${row.id}`,
    taskId: `task-${row.id}`,
    date: '2026-04-01',
    order,
    createdAt: '2026-03-31T12:00:00.000Z'
  }));

  await page.locator('[data-view="backup"]').click();
  await page.locator('#importJson').setInputFiles({
    name: 'balance-fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, tasks, plans, logs }))
  });
  await expect(page.locator('#backupStatus')).toHaveText('JSON-бекап імпортовано.');
}

async function expectBalance(page, section, expected) {
  for (const [quadrant, { weight, percent }] of Object.entries(expected)) {
    const row = page.locator(`${section} [data-${section === '#balanceGrid' ? 'history' : 'plan'}-filter="${quadrant}"]`);
    await expect(row.locator('.muted')).toHaveText(
      section === '#balanceGrid' ? `${weight} ваги` : `${weight} ваги з урахуванням плану`
    );
    await expect(row.locator('.balance-top span').last()).toHaveText(`${percent}%`);
  }
}

test('history includes both range boundaries and uses S/M/L weights', async ({ page }) => {
  await loadBalanceFixture(page);
  await page.locator('[data-view="history"]').click();

  const cases = [
    {
      days: 3,
      titles: ['Today S', '3-day edge M'],
      balance: {
        'self-care': { weight: 1, percent: 33 },
        'self-growth': { weight: 0, percent: 0 },
        'world-care': { weight: 2, percent: 67 },
        'world-growth': { weight: 0, percent: 0 }
      }
    },
    {
      days: 7,
      titles: ['Today S', '3-day edge M', 'Outside 3 days L', '7-day edge S'],
      balance: {
        'self-care': { weight: 1, percent: 14 },
        'self-growth': { weight: 3, percent: 43 },
        'world-care': { weight: 2, percent: 29 },
        'world-growth': { weight: 1, percent: 14 }
      }
    },
    {
      days: 14,
      titles: ['Today S', '3-day edge M', 'Outside 3 days L', '7-day edge S', 'Outside 7 days M', '14-day edge L'],
      balance: {
        'self-care': { weight: 3, percent: 25 },
        'self-growth': { weight: 3, percent: 25 },
        'world-care': { weight: 5, percent: 42 },
        'world-growth': { weight: 1, percent: 8 }
      }
    },
    {
      days: 30,
      titles: ['Today S', '3-day edge M', 'Outside 3 days L', '7-day edge S', 'Outside 7 days M', '14-day edge L', 'Outside 14 days S', '30-day edge M'],
      balance: {
        'self-care': { weight: 3, percent: 20 },
        'self-growth': { weight: 4, percent: 27 },
        'world-care': { weight: 5, percent: 33 },
        'world-growth': { weight: 3, percent: 20 }
      }
    }
  ];

  for (const { days, titles, balance } of cases) {
    await page.locator(`#historyRanges [data-days="${days}"]`).click();
    await expect(page.locator('#historyLog .title')).toHaveText(titles);
    await expectBalance(page, '#balanceGrid', balance);
  }

  await page.locator('#balanceGrid [data-history-filter="world-care"]').click();
  await expect(page.locator('#historyLog .title')).toHaveText(['3-day edge M', '14-day edge L']);
  await page.locator('#balanceGrid [data-history-filter="world-care"]').click();
  await expect(page.locator('#historyLog .title')).toHaveCount(8);
});

test('planning balance adds selected plans to recent completion weights', async ({ page }) => {
  await loadBalanceFixture(page);
  await page.locator('[data-view="plan"]').click();
  await page.locator('#planDate').fill('2026-04-01');
  await expect(page.locator('#planList .plan-card .title')).toHaveText(['Planned world M', 'Planned growth L']);

  await page.locator('#planRanges [data-plan-days="3"]').click();
  await expectBalance(page, '#planBalance', {
    'self-care': { weight: 1, percent: 13 },
    'self-growth': { weight: 3, percent: 38 },
    'world-care': { weight: 2, percent: 25 },
    'world-growth': { weight: 2, percent: 25 }
  });

  await page.locator('#planRanges [data-plan-days="7"]').click();
  await expectBalance(page, '#planBalance', {
    'self-care': { weight: 1, percent: 8 },
    'self-growth': { weight: 6, percent: 50 },
    'world-care': { weight: 2, percent: 17 },
    'world-growth': { weight: 3, percent: 25 }
  });
});
