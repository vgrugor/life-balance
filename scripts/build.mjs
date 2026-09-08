import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');
const rawBase = process.env.BASE_PATH || '/';
const basePath = rawBase.startsWith('/') ? rawBase : `/${rawBase}`;
const normalizedBase = basePath.endsWith('/') ? basePath : `${basePath}/`;
const version = new Date().toISOString();

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of ['index.html', 'styles.css', 'app.js', 'sheets-guard.js', 'base-accordions.js', 'manifest.webmanifest', 'sw.js']) {
  const input = await readFile(path.join(src, file), 'utf8');
  const output = input
    .replaceAll('__BASE_PATH__', normalizedBase)
    .replaceAll('__APP_VERSION__', version);
  await writeFile(path.join(dist, file), output);
}

await cp(path.join(src, 'icons'), path.join(dist, 'icons'), { recursive: true });
console.log(`Built dist with base path ${normalizedBase}`);
