'use strict';

/**
 * Zero-dependency static server for the dashboard, with a sign-in gate and roles.
 *
 *   npm start            http://localhost:4000, and on the LAN for phones
 *   PORT=5000 npm start
 *
 * Only the dashboard's public files are served, never server.js, users.json or tools/.
 * Until a request carries a valid session cookie, the only things served are the login
 * page and what it needs; the dashboard, the app list and the scripts are refused.
 *
 * Roles (auth.js): superadmin, admin, reader, viewer, with per-person exceptions on top. The app
 * list is not a static file to the outside world — apps.js is read here, filtered against who is
 * asking, and only then sent, so an app somebody may not see never reaches their browser. The console at
 * /admin is superadmin only, and so is every api/admin call behind it.
 *
 *   node tools/user.js super krish     the first superadmin
 */

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const auth = require('./auth.js');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 4000;

const PUBLIC = new Set(['index.html', 'app.js', 'apps.js', 'sw.js', 'manifest.webmanifest', 'login.html', 'admin.html']);
// Served before signing in: the login page, and the icons a browser asks for early.
const OPEN = new Set(['login.html', 'manifest.webmanifest']);
// Superadmins only.
const CONSOLE = new Set(['admin.html']);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const isIcon = (rel) => /^icons\/[\w.-]+\.(png|svg)$/.test(rel);
const secureLink = (req) => (req.headers['x-forwarded-proto'] || '').includes('https');
const from = (req) => req.socket.remoteAddress || 'unknown';

// A slow brake on guessing: ten tries per address every five minutes.
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
      if (body.length > 4096) req.destroy(); // a name and a word, nothing more
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

/* ------------------------------------------------------------- the app list */

// apps.js is written as a plain script that hands the array to the page. It is read here in a
// sandbox with nothing in it but a window object, so the file stays the one place apps are
// edited while the server still gets the list as data it can filter.
let cached = { at: 0, apps: [] };
function allApps() {
  const file = path.join(ROOT, 'apps.js');
  let stamp = 0;
  try {
    stamp = fs.statSync(file).mtimeMs;
  } catch {
    return [];
  }
  if (stamp === cached.at) return cached.apps;
  try {
    const box = { window: {} };
    vm.createContext(box);
    vm.runInContext(fs.readFileSync(file, 'utf8'), box, { timeout: 1000 });
    cached = { at: stamp, apps: Array.isArray(box.window.UNISIS_APPS) ? box.window.UNISIS_APPS : [] };
  } catch {
    cached = { at: stamp, apps: [] };
  }
  return cached.apps;
}

const appsFor = (who) => `window.UNISIS_APPS = ${JSON.stringify(auth.visibleFor(who, allApps()), null, 2)};\n`;

const server = http.createServer(async (req, res) => {
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  } catch {
    return send(res, 400, 'text/plain', 'Bad request');
  }

  const who = auth.readSession(auth.cookieValue(req.headers.cookie, auth.cookieName));
  const secure = secureLink(req);
  const boss = who && who.role === 'superadmin';

  /* ------------------------------------------------------------ sign in */
  if (rel === 'api/login' && req.method === 'POST') {
    const ip = from(req);
    if (tooManyTries(ip)) return sendJson(res, 429, { error: 'Too many tries. Wait five minutes.' });
    const { name, password } = await readBody(req);
    const role = auth.checkUser(name, password);
    if (!role) {
      auth.note({ who: String(name || '').slice(0, 40), role: '', ip, ok: false, how: 'password' });
      return sendJson(res, 401, { error: 'That name and password do not match.' });
    }
    tries.delete(ip);
    auth.note({ who: String(name).trim().toLowerCase(), role, ip, ok: true, how: 'password' });
    const token = auth.newSession(name, role);
    return sendJson(res, 200, { name: String(name).trim().toLowerCase(), role }, { 'Set-Cookie': auth.sessionCookie(token, secure) });
  }
  // The shared words: one short word, and the role it opens decides what the dashboard shows.
  if (rel === 'api/word' && req.method === 'POST') {
    const ip = from(req);
    if (tooManyTries(ip)) return sendJson(res, 429, { error: 'Too many tries. Wait five minutes.' });
    const { word } = await readBody(req);
    const role = auth.checkWord(word);
    if (!role) {
      auth.note({ who: '', role: '', ip, ok: false, how: 'word' });
      return sendJson(res, 401, { error: 'That access word is not in use.' });
    }
    tries.delete(ip);
    auth.note({ who: role, role, ip, ok: true, how: 'word' });
    const token = auth.newSession(role, role);
    return sendJson(res, 200, { name: role, role }, { 'Set-Cookie': auth.sessionCookie(token, secure) });
  }
  if (rel === 'api/google' && req.method === 'POST') {
    const ip = from(req);
    if (tooManyTries(ip)) return sendJson(res, 429, { error: 'Too many tries. Wait five minutes.' });
    const { credential } = await readBody(req);
    const account = await auth.verifyGoogle(credential).catch(() => null);
    if (!account) return sendJson(res, 401, { error: 'Google did not vouch for that sign-in.' });
    if (!auth.isAllowed(account.email)) {
      return sendJson(res, 403, { error: `${account.email} is not on the list. Ask Krish to add it.` });
    }
    tries.delete(ip);
    auth.note({ who: account.email, role: 'admin', ip, ok: true, how: 'google' });
    const token = auth.newSession(account.email, 'admin');
    return sendJson(res, 200, { name: account.email, role: 'admin' }, { 'Set-Cookie': auth.sessionCookie(token, secure) });
  }
  // What the login page should offer.
  if (rel === 'api/config') {
    const set = auth.wordsSet();
    return sendJson(res, 200, {
      google: auth.config().googleClientId || '',
      passwords: auth.listUsers().length > 0,
      words: Boolean(set.reader || set.viewer),
    });
  }
  if (rel === 'api/logout' && req.method === 'POST') {
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.clearedCookie(secure) });
  }
  if (rel === 'api/me') {
    return who ? sendJson(res, 200, who) : sendJson(res, 401, { error: 'Not signed in' });
  }

  /* ------------------------------------------------ the console, superadmin only */
  if (rel.startsWith('api/admin/')) {
    if (!boss) return sendJson(res, 403, { error: 'Superadmins only.' });
    try {
      if (rel === 'api/admin/state') {
        return sendJson(res, 200, {
          me: who.name,
          users: auth.listUsers(),
          words: auth.wordsSet(),
          apps: allApps().map(({ id, name }) => ({ id, name, role: auth.appRole(id) })),
          log: auth.log().slice(0, 40),
          minSecret: auth.MIN_SECRET,
        });
      }
      const body = await readBody(req);
      if (rel === 'api/admin/user' && req.method === 'POST') {
        const name = String(body.name || '').trim().toLowerCase();
        if (body.action === 'remove') {
          if (name === who.name) return sendJson(res, 400, { error: 'You cannot remove your own account here.' });
          return sendJson(res, 200, { removed: auth.removeUser(name) });
        }
        if (body.action === 'role') {
          auth.setRole(name, body.role);
          return sendJson(res, 200, { ok: true });
        }
        auth.addUser(name, body.password, body.role || 'admin'); // add, or set a new password
        return sendJson(res, 200, { ok: true });
      }
      if (rel === 'api/admin/word' && req.method === 'POST') {
        auth.setWord(body.kind, body.clear ? null : body.word);
        return sendJson(res, 200, { ok: true });
      }
      if (rel === 'api/admin/policy' && req.method === 'POST') {
        auth.setPolicy(body.id, body.role);
        return sendJson(res, 200, { ok: true });
      }
      // One person's exception to the role rule: allow, deny, or back to whatever their role says.
      if (rel === 'api/admin/userapp' && req.method === 'POST') {
        const done = auth.setUserApp(body.name, body.id, body.rule);
        return done ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'No such account.' });
      }
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
    return sendJson(res, 404, { error: 'No such thing' });
  }

  if (rel === 'login') rel = 'login.html';
  if (rel === 'admin') rel = 'admin.html';
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
  if (CONSOLE.has(rel) && !boss) return send(res, 403, 'text/plain', 'Superadmins only');

  // The app list is cut to the role before it leaves here.
  if (rel === 'apps.js') {
    return send(res, 200, TYPES['.js'], appsFor(who), { 'Cache-Control': 'no-store' });
  }

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
  const people = auth.listUsers();
  const boss = people.filter((u) => u.role === 'superadmin').length;
  const words = auth.wordsSet();
  console.log(`\nUniversal Dashboard running\n  on this PC   http://localhost:${PORT}`);
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  on a phone   http://${a.address}:${PORT}   (${name})`);
    }
  }
  const ways = [];
  if (people.length) ways.push(`${people.length} account${people.length > 1 ? 's' : ''} (${boss} superadmin)`);
  if (words.reader) ways.push('a reader word');
  if (words.viewer) ways.push('a viewer word');
  if (auth.config().googleClientId) ways.push('Google');
  console.log(ways.length ? `\n  Sign in with: ${ways.join(', ')}` : '\n  Nobody can sign in yet.');
  if (!boss) {
    console.log('  No superadmin yet, so /admin cannot be opened:\n'
      + '    npm run user super <name>     make an existing account a superadmin\n'
      + '    npm run user add <name>       add an account first, if there is none');
  } else {
    console.log(`  Manage access at http://localhost:${PORT}/admin\n`);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`\nPort ${PORT} is already in use. Try PORT=${PORT + 1} npm start\n`);
  else console.error(err);
  process.exit(1);
});
