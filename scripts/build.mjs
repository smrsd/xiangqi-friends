import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const types = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', svg: 'image/svg+xml', webmanifest: 'application/manifest+json' };
const assets = {};
for (const file of readdirSync('public')) {
  if (!types[file.split('.').pop()]) continue;
  assets[`/${file}`] = { body: readFileSync(`public/${file}`, 'utf8'), type: types[file.split('.').pop()] };
}
mkdirSync('dist/server', { recursive: true }); mkdirSync('dist/.openai', { recursive: true });
// Every source module is dependency-free. Strip only the explicit local imports
// and preserve exports; this produces a single Worker ESM for Sites/Cloudflare.
assets['/rules.js'] = { body: readFileSync('src/game.mjs', 'utf8'), type: types.js };
const game = readFileSync('src/game.mjs', 'utf8');
const api = readFileSync('src/api.mjs', 'utf8').replace(/^import .* from '\.\/game\.mjs';\r?\n/m, '');
const worker = readFileSync('src/worker.mjs', 'utf8').replace(/^import .*;\r?\n/gm, '');
writeFileSync('dist/server/index.js', `const assets=${JSON.stringify(assets)};\n${game}\n${api}\n${worker}`);
writeFileSync('dist/.openai/hosting.json', readFileSync('.openai/hosting.json'));
mkdirSync('dist/drizzle/meta', { recursive: true });
for (const file of readdirSync('drizzle')) if (file.endsWith('.sql')) writeFileSync('dist/drizzle/' + file, readFileSync('drizzle/' + file));
writeFileSync('dist/drizzle/meta/_journal.json', readFileSync('drizzle/meta/_journal.json'));
console.log(`Built ${Object.keys(assets).length} assets and Worker: ${resolve('dist/server/index.js')}`);
