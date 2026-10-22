import { api, ApiError } from './api.mjs';
import { assets } from './generated-assets.mjs';

const security = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
};
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let response;
    if (url.pathname.startsWith('/api/')) {
      try { response = Response.json(await api(request, env), { headers: { 'Cache-Control': 'no-store' } }); }
      catch (e) {
        const expected = e instanceof ApiError;
        if (!expected) console.error('API failure:', e.message);
        response = Response.json({ error: expected ? e.message : '服务暂时不可用，请稍后重试' }, { status: expected ? e.status : 500, headers: { 'Cache-Control': 'no-store' } });
      }
    } else {
      const asset = assets[url.pathname === '/' ? '/index.html' : url.pathname];
      if (!asset) response = new Response('Not found', { status: 404 });
      else response = new Response(request.method === 'HEAD' ? null : asset.body, { headers: { 'Content-Type': asset.type, 'Cache-Control': 'no-cache' } });
    }
    for (const [key, value] of Object.entries(security)) response.headers.set(key, value);
    return response;
  }
};
