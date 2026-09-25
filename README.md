# Life Balance

A mobile-first PWA for seeing how your effort is distributed across four quadrants:

- Self / Support
- Self / Growth
- World / Support
- World / Growth

This is not a to-do list or a productivity scoring system. It shows how completed tasks are distributed across sizes S, M, and L. The app interface is in Ukrainian.

## Features

- A task library with creation dates, quadrants, sizes, and recurrence rules, including specific weekdays.
- An optional date when creating a task, so it is added to the plan as soon as the task is saved.
- Task library filtering by quadrant.
- Planning for a selected date, with tomorrow as the default.
- Recurring tasks appear as planning suggestions instead of being added automatically.
- Balance guidance while planning.
- A Today view with planned tasks.
- Manual task ordering within each day and quadrant.
- Completion history with timestamps and balance views for 3, 7, 14, and 30 days.
- A “remind me later” option that temporarily hides tasks that are not currently relevant.
- Full JSON import and export.
- CSV/TSV export for Google Sheets.
- Backup and restore through a Google Apps Script Web App.
- Local storage of the Google Sheets Web App URL and API key in the device's browser.
- Offline use after the first load.
- No application backend; compatible with GitHub Pages.

## Local development

Requires Node.js 20 or later.

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:5173
```

## Build

```bash
npm run build
```

The build output is written to `dist/`.

You can set the base path explicitly for GitHub Pages:

```bash
BASE_PATH=/repo-name/ npm run build
```

## Tests

The tests cover task creation, planning, ordering, completion, and persistence after a reload. They also cover recurrence, balance and history over 3/7/14/30 days, JSON backups, rollback after a failed restore, and Google Sheets flows. Separate checks cover the GitHub Pages base path, offline use, and cache updates. The `apps-script.gs` tests check large backups and invalid keys without a live spreadsheet; browser tests mock the Sheets endpoint.

```bash
npm install
npx playwright install chromium
npm test
```

Playwright starts the local test servers automatically. If Google Chrome is already installed, you can run the tests without downloading Chromium: `PW_CHANNEL=chrome npm test`. You can also run `npm run test:apps-script` and `npm run test:e2e` separately.

GitHub Actions runs `npm test` when a pull request is opened or updated, and after a push to `main` or `master`. If a browser test fails, the workflow saves a Playwright trace as an artifact.

## Deploy to GitHub Pages

Pages URL: https://vgrugor.github.io/life-balance/

1. Open `Settings -> Pages` in the repository.
2. Under `Build and deployment`, select `GitHub Actions`.
3. Push changes to `main` or `master`.

The `.github/workflows/pages.yml` workflow builds `dist/` and publishes it to Pages. It sets the base path to `/${repository-name}/` so the app works on a GitHub project page.

## Google Sheets backup

On GitHub Pages, a Google Apps Script Web App provides a separate endpoint connected to your Google Sheet.

Enter the Web App URL and API key on the `Бекап` (Backup) tab. They are stored only in that browser's IndexedDB and are not included in JSON backups.

Setup:

1. Create a dedicated Google Sheet for this app.
2. In the sheet, open `Extensions -> Apps Script`.
3. Paste the code from `apps-script.gs`.
4. Replace `BACKUP_KEY = "change-this-key"` with your own long, random key.
5. Select `Deploy -> New deployment -> Web app`.
6. Set `Execute as` to yourself. Set `Who has access` to `Anyone` or `Anyone with the link`, depending on the Google interface.
7. Copy the Web App URL. It must start with `https://script.google.com/macros/s/` and end with `/exec`.
8. On your phone, open the `Бекап` (Backup) tab. Enter the Web App URL in `URL application` and the key in `API ключ` (API key).

After changing `apps-script.gs`, open `Deploy -> Manage deployments -> Edit`, select `New version`, and click `Deploy`. Otherwise, your phone will continue to use the previous Apps Script version.

If the sheet remains empty after clicking `Зберегти backup у Sheets` (Save backup to Sheets), the Web App is not running `doPost`. Check the `/exec` URL, `Anyone` access, the Google account that owns the sheet, and whether you deployed a new version.

`Зберегти backup у Sheets` writes a full JSON backup to the `backup` sheet tab. `Відновити з Sheets` (Restore from Sheets) downloads the latest backup and replaces the local data.

CSV/TSV export remains a simple manual way to view the data in a spreadsheet.
