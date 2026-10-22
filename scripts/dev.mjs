import { createServer } from 'node:http';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { database } from './database.mjs';
import { api, ApiError } from '../src/api.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
mkdirSync(resolve(root, '.data'), { recursive: true });
const db = database(process.env.DB_PATH || resolve(root, '.data/xiangqi.sqlite'));
const port = Number(process.env.PORT || 3100);
const host = process.env.HOST || '127.0.0.1';
const types = { html: 'text/html; charset=utf-8', css: 'text/css', js: 'text/javascript', svg: 'image/svg+xml', webmanifest: 'application/manifest+json' };
const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store');
  const origin = `http://${req.headers.host || `localhost:${port}`}`;
  const url = new URL(req.url, origin);
  try {
    if (url.pathname.startsWith('/api/')) {
      const request = new Request(url, { method: req.method, headers: req.headers, ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: req, duplex: 'half' } : {}) });
      const data = await api(request, { DB: db });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data));
    } else {
      if (url.pathname === '/rules.js') { res.writeHead(200, { 'Content-Type': types.js }); res.end(readFileSync(resolve(root, 'src/game.mjs'))); return; }
      const filename = resolve(root, 'public', `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
      if (!filename.startsWith(resolve(root, 'public') + sep) || !existsSync(filename)) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': types[filename.split('.').pop()] || 'application/octet-stream' }); res.end(readFileSync(filename));
    }
  } catch (e) {
    if (!(e instanceof ApiError)) console.error(e);
    res.writeHead(e instanceof ApiError ? e.status : 500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: e instanceof ApiError ? e.message : '服务暂时不可用，请稍后重试' }));
  }
});
server.listen(port, host, () => console.log(`棋友中国象棋 Local: http://${host}:${port}`));
function close() { server.close(() => { db.close(); process.exit(); }); }
process.on('SIGINT', close); process.on('SIGTERM', close);
