import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'playwright/test';

const basePath = '/life-balance/';
const previewUrl = `http://127.0.0.1:4173${basePath}`;
const dist = path.resolve('dist');
const assets = [
  'index.html',
  'styles.css',
  'app.js',
  'sheets-guard.js',
  'base-accordions.js',
  'manifest.webmanifest',
  'sw.js',
  'icons/icon.svg'
];
const offlineAssets = assets.filter((asset) => asset !== 'sw.js');
const versionedAssets = new Set(['styles.css', 'app.js', 'sheets-guard.js', 'base-accordions.js']);

function assetUrl(asset, version) {
  return `${basePath}${asset}${versionedAssets.has(asset) ? `?v=${version}` : ''}`;
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function cacheNameFor(directory) {
  const worker = await readFile(path.join(directory, 'dist', 'sw.js'), 'utf8');
  return worker.match(/const CACHE_NAME = '([^']+)'/)[1];
}

test('GitHub Pages build contains the expected files and uses its base path', async ({ page }) => {
  expect((await readdir(dist)).sort()).toEqual([
    'app.js',
    'base-accordions.js',
    'icons',
    'index.html',
    'manifest.webmanifest',
    'sheets-guard.js',
    'styles.css',
    'sw.js'
  ]);

  for (const asset of assets) {
    const content = await readFile(path.join(dist, asset), 'utf8');
    expect(content, asset).not.toContain('__BASE_PATH__');
    expect(content, asset).not.toContain('__APP_VERSION__');
    const response = await page.request.get(`${previewUrl}${asset}`);
    expect(response.ok(), asset).toBe(true);
    expect(await response.body(), asset).toEqual(Buffer.from(content));
  }

  const index = await readFile(path.join(dist, 'index.html'), 'utf8');
  const manifest = JSON.parse(await readFile(path.join(dist, 'manifest.webmanifest'), 'utf8'));
  const serviceWorker = await readFile(path.join(dist, 'sw.js'), 'utf8');
  const version = serviceWorker.match(/const CACHE_NAME = 'balance-quadrants-([^']+)'/)[1];
  expect(index).toContain(`src="${assetUrl('app.js', version)}"`);
  expect(index).toContain(`href="${assetUrl('styles.css', version)}"`);
  expect(manifest.start_url).toBe(basePath);
  expect(manifest.scope).toBe(basePath);
  expect(manifest.icons[0].src).toBe(`${basePath}icons/icon.svg`);
  expect(serviceWorker).toContain(`const BASE_PATH = '${basePath}'`);

  await page.goto(previewUrl);
  await expect(page.locator('#taskQuadrant option')).toHaveCount(4);
});

test('built app and saved tasks remain available offline', async ({ page, context }) => {
  const version = (await cacheNameFor(path.resolve('.'))).replace('balance-quadrants-', '');
  await page.goto(previewUrl);
  await expect(page.locator('#taskQuadrant option')).toHaveCount(4);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  const cached = await page.evaluate(async (paths) => Promise.all(paths.map(async (asset) =>
    Boolean(await caches.match(new URL(asset, location.origin).href))
  )), offlineAssets.map((asset) => assetUrl(asset, version)));
  expect(cached).toEqual(offlineAssets.map(() => true));

  await page.locator('[data-view="tasks"]').click();
  await page.locator('#taskTitle').fill('Available offline');
  await page.locator('#taskForm button[type="submit"]').click();
  await expect(page.locator('#taskList .card').filter({ hasText: 'Available offline' })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#taskQuadrant option')).toHaveCount(4);
  await page.locator('[data-view="tasks"]').click();
  await expect(page.locator('#taskList .card').filter({ hasText: 'Available offline' })).toHaveCount(1);
});

test('an updated service worker replaces the old cache and serves new assets offline', async ({ page, context }) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'life-balance-pwa-'));
  let server;
  try {
    await cp(path.resolve('src'), path.join(temporaryRoot, 'src'), { recursive: true });
    const build = () => execFileSync(process.execPath, [path.resolve('scripts/build.mjs')], {
      cwd: temporaryRoot,
      env: { ...process.env, BASE_PATH: basePath }
    });
    build();
    const oldCache = await cacheNameFor(temporaryRoot);
    const port = await availablePort();
    const url = `http://127.0.0.1:${port}${basePath}`;
    server = spawn(process.execPath, [path.resolve('scripts/dev-server.mjs'), path.join(temporaryRoot, 'dist'), String(port)], {
      env: { ...process.env, BASE_PATH: basePath },
      stdio: 'ignore'
    });
    await expect.poll(async () => {
      try { return (await fetch(url)).status; } catch { return 0; }
    }).toBe(200);

    await page.goto(url);
    await expect(page.locator('#taskQuadrant option')).toHaveCount(4);
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await expect.poll(() => page.evaluate(() => caches.keys())).toEqual([oldCache]);

    const stylesPath = path.join(temporaryRoot, 'src', 'styles.css');
    await writeFile(stylesPath, `${await readFile(stylesPath, 'utf8')}\n/* updated-pwa-asset */\n`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    build();
    const newCache = await cacheNameFor(temporaryRoot);
    expect(newCache).not.toBe(oldCache);

    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await expect.poll(() => page.evaluate(() => caches.keys())).toEqual([newCache]);
    const newVersion = newCache.replace('balance-quadrants-', '');
    await expect.poll(() => page.evaluate(async (version) => {
      const response = await caches.match(`${location.origin}/life-balance/styles.css?v=${version}`);
      return response && (await response.text()).includes('updated-pwa-asset');
    }, newVersion)).toBe(true);

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#taskQuadrant option')).toHaveCount(4);
  } finally {
    if (server?.exitCode === null) {
      const exited = once(server, 'exit');
      server.kill();
      await exited;
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('new HTML loads current task logic while an older worker controls the page', async ({ page }) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'life-balance-mixed-pwa-'));
  let server;
  try {
    await cp(path.resolve('src'), path.join(temporaryRoot, 'src'), { recursive: true });
    const appPath = path.join(temporaryRoot, 'src', 'app.js');
    const currentApp = await readFile(appPath, 'utf8');
    const oldApp = currentApp.replace("const planDate = existingId ? '' : $('#taskPlanDate').value;", "const planDate = '';");
    expect(oldApp).not.toBe(currentApp);
    await writeFile(appPath, oldApp);
    const build = () => execFileSync(process.execPath, [path.resolve('scripts/build.mjs')], {
      cwd: temporaryRoot,
      env: { ...process.env, BASE_PATH: basePath }
    });
    build();
    const oldWorker = await readFile(path.join(temporaryRoot, 'dist', 'sw.js'), 'utf8');
    const port = await availablePort();
    const url = `http://127.0.0.1:${port}${basePath}`;
    server = spawn(process.execPath, [path.resolve('scripts/dev-server.mjs'), path.join(temporaryRoot, 'dist'), String(port)], {
      env: { ...process.env, BASE_PATH: basePath },
      stdio: 'ignore'
    });
    await expect.poll(async () => {
      try { return (await fetch(url)).status; } catch { return 0; }
    }).toBe(200);

    await page.goto(url);
    await expect(page.locator('#taskQuadrant option')).toHaveCount(4);
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    const date = await page.locator('#planDate').inputValue();

    await writeFile(appPath, currentApp);
    await new Promise((resolve) => setTimeout(resolve, 20));
    build();
    await writeFile(path.join(temporaryRoot, 'dist', 'sw.js'), oldWorker);

    await page.reload();
    await page.locator('[data-view="tasks"]').click();
    await page.locator('#taskTitle').fill('Planned after update');
    await page.locator('#taskPlanDate').fill(date);
    await page.locator('#taskForm button[type="submit"]').click();
    await page.locator('[data-view="plan"]').click();
    await expect(page.locator('#planList .plan-card .title')).toHaveText('Planned after update');
  } finally {
    if (server?.exitCode === null) {
      const exited = once(server, 'exit');
      server.kill();
      await exited;
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
