// Minimal static server for local testing: `npm run serve` -> http://127.0.0.1:4173
// With GYM_CLOUD_URL and GYM_CLOUD_KEY set, /cloud-config.js points the app at
// that Supabase project instead, and the page's CSP allows exactly that address
// (used by the end-to-end tests against the local database).
// Serves only the files the app ships, and only to localhost (no DNS rebinding).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, posix, resolve } from 'node:path';

const root = resolve('.');
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.gif': 'image/gif', '.woff': 'font/woff', '.svg': 'image/svg+xml', '': 'application/json' };
const shipped = /^(index\.html|sw\.js|manifest\.json|Version|cloud-config\.js|[\w-]+\.(png|gif)|(css|js|vendor|fonts)\/[\w./-]+)$/;
const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

createServer(async (req, res) => {
  if (!hosts.has(req.headers.host)) { res.writeHead(421).end(); return; }
  let path;
  try {
    path = posix.normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '');
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (path === '' || path === '.') path = 'index.html';
  if (path.split('/').includes('..') || !shipped.test(path)) { res.writeHead(404).end('Not found'); return; }
  if (path === 'cloud-config.js' && process.env.GYM_CLOUD_URL) {
    res.writeHead(200, { 'content-type': types['.js'], 'cache-control': 'no-store' });
    res.end(`window.GYM_CLOUD_CONFIG = ${JSON.stringify({ url: process.env.GYM_CLOUD_URL, anonKey: process.env.GYM_CLOUD_KEY })};\n`);
    return;
  }
  try {
    let body = await readFile(join(root, path));
    if (path === 'index.html' && process.env.GYM_CLOUD_URL) {
      const url = process.env.GYM_CLOUD_URL, ws = url.replace(/^http/, 'ws');
      body = Buffer.from(body.toString('utf8').replace("connect-src 'self'", `connect-src 'self' ${url} ${ws}`));
    }
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Serving on http://127.0.0.1:${port}`));
