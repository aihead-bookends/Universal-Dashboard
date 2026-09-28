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
 * Accounts (auth.js): superadmins, who sign in with a password and see every app, and users, who
 * sign in with an access word of their own and see the apps a superadmin has said yes to for them.
 * The app list is not a static file to the outside world — apps.js is read here, filtered against
 * who is asking, and only then sent, so an app somebody may not see never reaches their browser. The
 * console at /admin is superadmin only, and so is every api/admin call behind it.
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

const PUBLIC = new Set(['index.html', 'app.js', 'apps.js', 'sw.js', 'manifest.webmanifest', 'login.html', 'admin.html', 'smoke.js']);
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
  // A user's own access word: one short word, and it says who they are.
  if (rel === 'api/word' && req.method === 'POST') {
    const ip = from(req);
    if (tooManyTries(ip)) return sendJson(res, 429, { error: 'Too many tries. Wait five minutes.' });
    const { word } = await readBody(req);
    const name = auth.checkWord(word);
    if (!name) {
      auth.note({ who: '', role: '', ip, ok: false, how: 'word' });
      return sendJson(res, 401, { error: 'That access word is not in use.' });
    }
    tries.delete(ip);
    auth.note({ who: name, role: 'user', ip, ok: true, how: 'word' });
    const token = auth.newSession(name, 'user');
    return sendJson(res, 200, { name, role: 'user' }, { 'Set-Cookie': auth.sessionCookie(token, secure) });
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
    const role = auth.listUsers().find((u) => u.name === account.email)?.role || 'user';
    auth.note({ who: account.email, role, ip, ok: true, how: 'google' });
    const token = auth.newSession(account.email, role);
    return sendJson(res, 200, { name: account.email, role }, { 'Set-Cookie': auth.sessionCookie(token, secure) });
  }
  // What the login page should offer.
  if (rel === 'api/config') {
    return sendJson(res, 200, {
      google: auth.config().googleClientId || '',
      passwords: auth.listUsers().some((u) => u.password),
      words: auth.anyWords(),
    });
  }
  if (rel === 'api/logout' && req.method === 'POST') {
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.clearedCookie(secure) });
  }
  if (rel === 'api/me') {
    if (!who) return sendJson(res, 401, { error: 'Not signed in' });
    // Whether they can change their own word here, and whether they have one yet or still a password.
    const mine = who.role === 'user' ? auth.listUsers().find((u) => u.name === who.name) : null;
    return sendJson(res, 200, { ...who, changeWord: Boolean(mine), hasWord: Boolean(mine && mine.word) });
  }
  // A user choosing their own word. The old one, and every session made with it, stops working; this
  // device is handed a fresh session so the one making the change stays signed in.
  if (rel === 'api/me/word' && req.method === 'POST') {
    if (!who || who.role !== 'user') return sendJson(res, 403, { error: 'Only a user can change an access word here.' });
    const ip = from(req);
    if (tooManyTries(ip)) return sendJson(res, 429, { error: 'Too many tries. Wait five minutes.' });
    const { current, next } = await readBody(req);
    try {
      auth.changeOwnWord(who.name, current, next);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
    tries.delete(ip);
    auth.note({ ok: true, who: who.name, role: 'user', how: 'changed their word', ip });
    const token = auth.newSession(who.name, 'user');
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie(token, secure) });
  }

  /* ------------------------------------------------ the console, superadmin only */
  if (rel.startsWith('api/admin/')) {
    if (!boss) return sendJson(res, 403, { error: 'Superadmins only.' });
    try {
      if (rel === 'api/admin/state') {
        return sendJson(res, 200, {
          me: who.name,
          users: auth.listUsers(),
          apps: allApps().map(({ id, name, login, sso }) => ({
            id, name, login: login === 'none' ? 'none' : 'accounts', sso: Boolean(sso), key: auth.hasSsoKey(id),
          })),
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
        auth.addUser(name, body.secret, body.role || 'user'); // add, or give a new word or password
        return sendJson(res, 200, { ok: true });
      }
      // Yes or no to one app for one user.
      // An app's sign-in key, made on first asking, for a superadmin to put in the app's settings.
      if (rel === 'api/admin/ssokey' && req.method === 'POST') {
        const app = allApps().find((a) => a.id === body.id && a.login !== 'none');
        if (!app) return sendJson(res, 404, { error: 'No such app with a sign-in.' });
        const key = auth.ssoKey(app.id);
        auth.note({ ok: true, who: who.name, role: who.role, how: `looked up ${app.name}'s sign-in key`, ip: from(req) });
        return sendJson(res, 200, { key });
      }
      // A user's access word, looked up when a superadmin presses Show, never sent with the page;
      // every look goes into the sign-in log.
      if (rel === 'api/admin/reveal' && req.method === 'POST') {
        const name = String(body.name || '').trim().toLowerCase();
        const word = auth.peekWord(name);
        auth.note({ ok: true, who: who.name, role: who.role, how: `looked up ${name}'s word`, ip: from(req) });
        return sendJson(res, 200, { word });
      }
      // One app for one user: no, or reader or writer for an app with its own sign-in, or yes for
      // an app without one.
      if (rel === 'api/admin/userapp' && req.method === 'POST') {
        const app = allApps().find((a) => a.id === body.id);
        if (!app) return sendJson(res, 404, { error: 'No such app.' });
        const allowed = app.login === 'none' ? ['no', 'yes'] : ['no', ...auth.LEVELS];
        if (!allowed.includes(body.level)) {
          return sendJson(res, 400, { error: `${app.name} is given as ${allowed.join(' or ')}.` });
        }
        const done = auth.setUserApp(body.name, body.id, body.level);
        return done ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'No such user.' });
      }
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
    return sendJson(res, 404, { error: 'No such thing' });
  }

  /* ------------------------------------------------------- opening an app */
  // A user's app cards point here, not at the app. The level is checked now, on the server; an app
  // that takes sign-in passes gets one naming the account they were given, and they land in it
  // already signed in. The pass rides after the #, so it never reaches a server log on the way.
  const opening = /^open\/([\w-]+)$/.exec(rel);
  if (opening) {
    if (!who) return send(res, 302, 'text/plain', 'Sign in first', { Location: '/login' });
    const app = allApps().find((a) => a.id === opening[1]);
    const host = String(req.headers.host || 'localhost').replace(/:\d+$/, '');
    let target = '';
    try { target = app && app.url ? new URL(String(app.url).replace(/\{host\}/g, host)).href : ''; } catch { /* no address */ }
    if (!target) return send(res, 404, 'text/plain', 'That app has no address yet.');
    if (who.role === 'superadmin') return send(res, 302, 'text/plain', 'Opening', { Location: target });
    const as = auth.levelFor(who.name, app);
    if (!as) return send(res, 403, 'text/plain', 'That app has not been given to you. Ask a superadmin.');
    if (app.sso && (as === 'reader' || as === 'writer')) {
      const page = new URL(app.sso, target);
      page.hash = `ticket=${auth.ssoPass(app.id, who.name, as)}`;
      return send(res, 302, 'text/plain', 'Opening', { Location: page.href });
    }
    return send(res, 302, 'text/plain', 'Opening', { Location: target });
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
  console.log(`\nUniversal Dashboard running\n  on this PC   http://localhost:${PORT}`);
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  on a phone   http://${a.address}:${PORT}   (${name})`);
    }
  }
  const ways = [];
  if (people.length) ways.push(`${people.length} account${people.length > 1 ? 's' : ''} (${boss} superadmin)`);
  if (auth.config().googleClientId) ways.push('Google');
  console.log(ways.length ? `\n  Sign in with: ${ways.join(', ')}` : '\n  Nobody can sign in yet.');
  if (!boss) {
    console.log('  No superadmin yet, so /admin cannot be opened:\n'
      + '    npm run user super <name>     add a superadmin (asks for a password)');
  } else {
    console.log(`  Manage access at http://localhost:${PORT}/admin\n`);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`\nPort ${PORT} is already in use. Try PORT=${PORT + 1} npm start\n`);
  else console.error(err);
  process.exit(1);
});
