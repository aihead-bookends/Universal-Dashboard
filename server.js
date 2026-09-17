'use strict';

/**
 * Zero-dependency static server for the dashboard, with a sign-in gate.
 *
 *   npm start            http://localhost:4000, and on the LAN for phones
 *   PORT=5000 npm start
 *
 * Only the dashboard's public files are served, never server.js, users.json or tools/.
 * Until a request carries a valid session cookie, the only things served are the login
 * page and what it needs; the dashboard, the app list and the scripts are refused.
 * Accounts: node tools/user.js add <name>
 */

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const auth = require('./auth.js');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 4000;

const PUBLIC = new Set(['index.html', 'app.js', 'apps.js', 'sw.js', 'manifest.webmanifest', 'login.html']);
// Served before signing in: the login page, and the icons a browser asks for early.
const OPEN = new Set(['login.html', 'manifest.webmanifest']);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const isIcon = (rel) => /^icons\/[\w.-]+\.(png|svg)$/.test(rel);
const secureLink = (req) => (req.headers['x-forwarded-proto'] || '').includes('https');

// A slow brake on password guessing: ten tries per address every five minutes.
const tries = new Map();
function tooManyTries(ip) {
  const now = Date.now();
  const rec = tries.get(ip);
  if (!rec || now > rec.until) {
    tries.set(ip, { n: 1, until: now + 300_000 });
    return false;
  }
  rec.n += 1;
  return rec.n > 10;
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 4096) req.destroy(); // a name and a password, nothing more
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

const send = (res, code, type, body, headers = {}) => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
  res.end(body);
};
const sendJson = (res, code, data, headers) => send(res, code, 'application/json; charset=utf-8', JSON.stringify(data), headers);

const server = http.createServer(async (req, res) => {
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  } catch {
    return send(res, 400, 'text/plain', 'Bad request');
  }

  const who = auth.readSession(auth.cookieValue(req.headers.cookie, auth.cookieName));
  const secure = secureLink(req);

  /* ------------------------------------------------------------ sign in */
  if (rel === 'api/login' && req.method === 'POST') {
    const ip = req.socket.remoteAddress || 'unknown';
    if (tooManyTries(ip)) return sendJson(res, 429, { error: 'Too many tries. Wait five minutes.' });
    const { name, password } = await readBody(req);
    if (!auth.checkUser(name, password)) return sendJson(res, 401, { error: 'That name and password do not match.' });
    tries.delete(ip);
    const token = auth.newSession(name);
    return sendJson(res, 200, { name: String(name).trim().toLowerCase() }, { 'Set-Cookie': auth.sessionCookie(token, secure) });
  }
  if (rel === 'api/google' && req.method === 'POST') {
    const ip = req.socket.remoteAddress || 'unknown';
    if (tooManyTries(ip)) return sendJson(res, 429, { error: 'Too many tries. Wait five minutes.' });
    const { credential } = await readBody(req);
    const account = await auth.verifyGoogle(credential).catch(() => null);
    if (!account) return sendJson(res, 401, { error: 'Google did not vouch for that sign-in.' });
    if (!auth.isAllowed(account.email)) {
      return sendJson(res, 403, { error: `${account.email} is not on the list. Ask Krish to add it.` });
    }
    tries.delete(ip);
    const token = auth.newSession(account.email);
    return sendJson(res, 200, { name: account.email }, { 'Set-Cookie': auth.sessionCookie(token, secure) });
  }
  // What the login page should offer: Google, passwords, or both.
  if (rel === 'api/config') {
    return sendJson(res, 200, { google: auth.config().googleClientId || '', passwords: auth.listUsers().length > 0 });
  }
  if (rel === 'api/logout' && req.method === 'POST') {
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.clearedCookie(secure) });
  }
  if (rel === 'api/me') {
    return who ? sendJson(res, 200, { name: who }) : sendJson(res, 401, { error: 'Not signed in' });
  }

  if (rel === 'login') rel = 'login.html';
  if (!PUBLIC.has(rel) && !isIcon(rel)) return send(res, 404, 'text/plain', 'Not found');

  /* --------------------------------------------------------- the gate */
  if (!who && !OPEN.has(rel) && !isIcon(rel)) {
    // A page request goes to the login page; anything else is simply refused.
    const wantsPage = (req.headers.accept || '').includes('text/html');
    if (wantsPage) return send(res, 302, 'text/plain', 'Sign in first', { Location: '/login' });
    return send(res, 401, 'text/plain', 'Sign in first');
  }
  // Signed in already? Then the login page is just a detour back to the dashboard.
  if (who && rel === 'login.html') return send(res, 302, 'text/plain', 'Already signed in', { Location: '/' });

  fs.readFile(path.join(ROOT, rel), (err, body) => {
    if (err) return send(res, 404, 'text/plain', 'Not found');
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(rel)] || 'application/octet-stream',
      // Revalidate every load so an edited apps.js is picked up immediately.
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const accounts = auth.listUsers().length;
  console.log(`\nUniversal Dashboard running\n  on this PC   http://localhost:${PORT}`);
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  on a phone   http://${a.address}:${PORT}   (${name})`);
    }
  }
  const { googleClientId, allowed } = auth.config();
  const ways = [];
  if (googleClientId) ways.push(`Google, for ${allowed.length} allowed address${allowed.length === 1 ? '' : 'es'}`);
  if (accounts) ways.push(`${accounts} password account${accounts > 1 ? 's' : ''}`);
  console.log(ways.length
    ? `\n  Sign in with: ${ways.join(', and ')}\n`
    : '\n  Nobody can sign in yet.\n'
      + '  Google:   npm run user google <client-id>   then   npm run user allow <email>\n'
      + '  Password: npm run user add <name>\n');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`\nPort ${PORT} is already in use. Try PORT=${PORT + 1} npm start\n`);
  else console.error(err);
  process.exit(1);
});
