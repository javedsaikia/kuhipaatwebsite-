/* ==========================================================================
   Local dev server for Moina.

     node tools/moina-dev-proxy.js          → http://127.0.0.1:8000

   Serves the static site AND runs api/chat.js behind /api/chat, so what you
   test locally is the same handler Vercel runs in production — same guardrails,
   same provider call, same key handling. Reads the key from .env at the repo
   root (never commit that file; .gitignore already covers it).

   Requires Node 18+ for global fetch.
   ========================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8000);

/* -------- .env, minimally: KEY=value lines, # comments, no interpolation --- */
(function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
})();

const chat = require(path.join(ROOT, 'api', 'chat.js'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon'
};

/* Vercel hands the handler a req with .body already parsed and a res with
   .status().json(). Node's raw objects have neither, so we add them. */
function shim(req, res, body) {
  req.body = body;
  res.status = function (code) { res.statusCode = code; return res; };
  res.json = function (payload) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
    return res;
  };
  return { req, res };
}

function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';

  const full = path.join(ROOT, path.normalize(rel));
  // never let a crafted path climb out of the project
  if (!full.startsWith(ROOT)) {
    res.statusCode = 403;
    return res.end('forbidden');
  }

  /* Dotfiles are never web content, and one of them is .env. A static server
     that will hand out the API key to anyone who guesses the filename is a
     hole worth closing even on a loopback-only listener. */
  if (path.relative(ROOT, full).split(path.sep).some(part => part.startsWith('.'))) {
    res.statusCode = 404;
    return res.end('not found');
  }

  fs.stat(full, (err, stat) => {
    if (err || !stat.isFile()) {
      res.statusCode = 404;
      return res.end('not found');
    }
    res.setHeader('Content-Type', TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(full).pipe(res);
  });
}

http.createServer((req, res) => {
  if (req.url.split('?')[0] === '/api/chat') {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1e6) req.destroy();          // nobody needs a 1MB question
    });
    req.on('end', () => {
      let parsed = null;
      try { parsed = JSON.parse(raw || '{}'); } catch (err) { parsed = null; }
      const s = shim(req, res, parsed);
      Promise.resolve(chat(s.req, s.res)).catch(err => {
        console.error('[moina-dev]', err);
        if (!res.writableEnded) s.res.status(500).json({ error: 'handler threw' });
      });
    });
    return;
  }
  serveStatic(req, res);
}).listen(PORT, '127.0.0.1', () => {
  const provider = (process.env.MOINA_PROVIDER || 'groq').toLowerCase();
  const keyEnv = { groq: 'GROQ_API_KEY', gemini: 'GEMINI_API_KEY', xai: 'XAI_API_KEY' }[provider];
  const hasKey = Boolean(keyEnv && process.env[keyEnv]);
  console.log('Moina dev server  → http://127.0.0.1:' + PORT);
  console.log('  provider: ' + provider + (keyEnv ? '' : '  (unknown — check MOINA_PROVIDER)'));
  console.log('  model   : ' + (process.env.MOINA_MODEL || 'adapter default'));
  console.log('  api key : ' + (hasKey ? keyEnv + ' loaded from .env' : 'MISSING — chat will 500'));
});
