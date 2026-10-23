// Minimal static server for local testing: `npm run serve` -> http://127.0.0.1:4173
// With GYM_CLOUD_URL and GYM_CLOUD_KEY set, /cloud-config.js points the app at
// that Supabase project instead (used by the end-to-end tests).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve('.');
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.gif': 'image/gif', '.woff': 'font/woff', '.svg': 'image/svg+xml', '': 'application/json' };
const blocked = /^\/(node_modules|tests|tools|supabase|android-signing|\.git)(\/|$)/;

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/cloud-config.js' && process.env.GYM_CLOUD_URL) {
    res.writeHead(200, { 'content-type': types['.js'], 'cache-control': 'no-store' });
    res.end(`window.GYM_CLOUD_CONFIG = ${JSON.stringify({ url: process.env.GYM_CLOUD_URL, anonKey: process.env.GYM_CLOUD_KEY })};\n`);
    return;
  }
  const file = normalize(join(root, path === '/' ? 'index.html' : path));
  if (!file.startsWith(root) || blocked.test(path)) { res.writeHead(404).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Serving on http://127.0.0.1:${port}`));
