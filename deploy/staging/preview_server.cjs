'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

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
    'referrer-policy': 'strict-origin-when-cross-origin'
  });
  if (req.method==='HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
});
server.listen(PORT,'127.0.0.1',()=>console.log('PREVIEW_HTTP_READY port='+PORT));
