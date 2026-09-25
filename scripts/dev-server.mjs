import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'src');
const port = Number(process.argv[3] || process.env.PORT || 5173);
const rawBase = process.env.BASE_PATH || '/';
const prefixedBase = rawBase.startsWith('/') ? rawBase : `/${rawBase}`;
const basePath = prefixedBase.endsWith('/') ? prefixedBase : `${prefixedBase}/`;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

createServer((req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${port}`);
  const pathname = decodeURIComponent(url.pathname);
  const relativePath = pathname.startsWith(basePath)
    ? pathname.slice(basePath.length)
    : pathname.replace(/^\/+/, '');
  let filePath = path.join(root, relativePath);
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = path.join(root, 'index.html');
  }
  res.setHeader('Content-Type', types[path.extname(filePath)] || 'application/octet-stream');
  if (['.html', '.js', '.css', '.webmanifest'].includes(path.extname(filePath))) {
    readFile(filePath, 'utf8')
      .then((content) => {
        const appVersion = root.endsWith('src') ? `dev-${statSync(filePath).mtimeMs}` : 'preview';
        res.end(content.replaceAll('__BASE_PATH__', basePath).replaceAll('__APP_VERSION__', appVersion));
      })
      .catch((error) => {
        res.statusCode = 500;
        res.end(error.message);
      });
    return;
  }
  createReadStream(filePath).pipe(res);
}).listen(port, () => {
  console.log(`Serving ${root} at http://localhost:${port}`);
});
