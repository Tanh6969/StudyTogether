'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const crypto = require('node:crypto');

// A private one-click link grants access only to the preview shell.
// Supabase Auth and all production data/LiveKit permissions remain unchanged.
// Keep this capability outside Git, private to the preview service account.
const ACCESS_FILE = '/srv/mcppro/workspaces/studytogether-session-env/preview-access.key';
const ACCESS_TOKEN = fs.readFileSync(ACCESS_FILE, 'utf8').trim();
if (!/^[a-f0-9]{64}$/.test(ACCESS_TOKEN)) {
  throw new Error('A securely generated 256-bit preview link key is required');
}
const ACCESS_PREFIX = '/__preview/open/';
const SESSION_COOKIE = '__Host-study-preview';
const MAX_AGE_SECONDS = 24 * 60 * 60;

function constantTimeSame(left, right) {
  if (typeof right !== 'string' || left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}
function sessionSignature(expiry, nonce) {
  return crypto.createHmac('sha256', ACCESS_TOKEN).update(`${expiry}.${nonce}`).digest('hex');
}
function makeAccessCookie() {
  const expiry = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  const nonce = crypto.randomBytes(12).toString('hex');
  const value = `${expiry}.${nonce}.${sessionSignature(expiry, nonce)}`;
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${MAX_AGE_SECONDS}; Secure; HttpOnly; SameSite=Lax`;
}
function hasAccessSession(req) {
  const raw = req.headers.cookie?.split(';').map(part => part.trim())
    .find(part => part.startsWith(SESSION_COOKIE + '='));
  if (!raw) return false;
  const value = raw.slice(SESSION_COOKIE.length + 1);
  const match = /^(\d{10})\.([a-f0-9]{24})\.([a-f0-9]{64})$/.exec(value);
  if (!match) return false;
  const expiry = Number(match[1]);
  const now = Math.floor(Date.now() / 1000);
  if (expiry < now || expiry > now + MAX_AGE_SECONDS) return false;
  return constantTimeSame(sessionSignature(match[1], match[2]), match[3]);
}
function denyAccess(res) {
  res.writeHead(403, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-robots-tag': 'noindex, nofollow',
  });
  res.end('Preview riêng tư. Hãy mở liên kết nghiệm thu được cấp.');
}

const DIST = '/srv/mcppro/workspaces/studytogether-room-lifecycle-20261118/frontend/dist';
// Preview must never forward writes to the production API.
const API = 'http://127.0.0.1:8181';
const PORT = 5179;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
};
function error(res, status, message) {
  res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  res.end(JSON.stringify({ detail: message }));
}
async function proxyAPI(req, res, url) {
  const target = new URL(API);
  target.pathname = url.pathname.slice('/api'.length);
  target.search = url.search;
  const headers = {};
  for (const key of ['authorization','accept','content-type','if-none-match','x-request-id']) {
    if (req.headers[key]) headers[key] = req.headers[key];
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 24 * 1024 * 1024) return error(res,413,'Preview request too large');
    chunks.push(chunk);
  }
  try {
    const upstream = await fetch(target, {
      method: req.method, headers,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
      signal: AbortSignal.timeout(30000),
      redirect: 'manual'
    });
    const out = {'cache-control':'no-store','x-content-type-options':'nosniff'};
    for (const key of ['content-type','content-disposition','location']) {
      const value = upstream.headers.get(key);
      if (value) out[key] = value;
    }
    res.writeHead(upstream.status, out);
    if (upstream.body) Readable.fromWeb(upstream.body).pipe(res);
    else res.end();
  } catch (err) {
    console.error('preview API proxy error:', err.message);
    error(res,502,'Preview API unavailable');
  }
}
const server = http.createServer(async (req,res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); }
  catch { return error(res,400,'Invalid URL'); }
  // Cloudflare's tunnel is transport only: every request (including API,
  // assets and SPA routes) requires the one-click link session.
  // Never expose a raw shared-production API over an unauthenticated tunnel.
  if (url.pathname === '/__preview/health' && req.socket.remoteAddress === '127.0.0.1') {
    res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
    return res.end('OK');
  }
  if (url.pathname.startsWith(ACCESS_PREFIX)) {
    const candidate = url.pathname.slice(ACCESS_PREFIX.length);
    if (req.method !== 'GET' || !constantTimeSame(ACCESS_TOKEN, candidate)) {
      return denyAccess(res);
    }
    res.writeHead(303, {
      'location': '/login',
      'set-cookie': makeAccessCookie(),
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex, nofollow',
    });
    return res.end();
  }
  if (!hasAccessSession(req)) return denyAccess(res);
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    return proxyAPI(req,res,url);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return error(res,405,'Method not allowed');
  }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { return error(res,400,'Invalid path'); }
  const requested = path.resolve(DIST, '.' + pathname);
  if (requested !== DIST && !requested.startsWith(DIST + '/')) return error(res,403,'Forbidden');
  let file = requested;
  try {
    if (!fs.statSync(file).isFile()) file=path.join(DIST,'index.html');
  } catch { file = path.join(DIST,'index.html'); }
  res.writeHead(200,{
    'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'cache-control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=120',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-robots-tag': 'noindex, nofollow'
  });
  if (req.method==='HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
});
server.listen(PORT,'127.0.0.1',()=>console.log('PREVIEW_HTTP_READY port='+PORT));
