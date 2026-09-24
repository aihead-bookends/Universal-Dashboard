'use strict';

/**
 * Who may open the dashboard, and how much of it they see (server.js).
 *
 * Four roles, in order of power:
 *
 *   superadmin  runs the place: everything an admin can do, plus the console at /admin,
 *               where people, access words and per-app access are managed.
 *   admin       an individual account: a name and a password of their own.
 *   reader      one shared access word, handed to the people who may look at the systems.
 *   viewer      one shared access word, the least they can be given.
 *
 * Every app in apps.js is given the lowest role that may see it (default: admin, so a new app is
 * invisible to everyone else until it is opened up on purpose), and any one person can be given an
 * exception to that: an app their role would not reach, or one taken away from them alone.
 *
 * server.js filters the app list against all of that before sending it, so an app somebody may not
 * see never reaches their browser at all — not its name, not its address.
 *
 * Nothing is stored in the clear. Passwords and access words each keep a random salt and a
 * PBKDF2-SHA256 hash, in users.json (git-ignored, readable only by you). A session is a cookie
 * holding "name|role|issued|expiry" plus an HMAC of it, signed with a secret from UNISIS_SECRET
 * or one generated into .session-secret on first run.
 *
 * A session is checked against the file on every request, so power taken away is taken away at
 * once: demote an admin and their open session becomes a reader's; rotate a shared word and
 * everyone holding the old one is signed out.
 *
 *   node tools/user.js super krish          make the first superadmin (the only way in)
 *   node tools/user.js add asha             add an admin (asks for the password)
 *   node tools/user.js word reader          set the shared reader word
 *   node tools/user.js list                 who has what
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const USERS_FILE = path.join(ROOT, 'users.json');
const SECRET_FILE = path.join(ROOT, '.session-secret');
const ITERATIONS = 120_000; // matches functions/_auth.js
const KEY_BYTES = 32;
const SESSION_DAYS = 30;
const LOG_KEEP = 200;
const MIN_SECRET = 6; // the shortest password or access word that will be accepted

/* The order that decides everything: a role may see whatever its own rank, or a lower one, allows. */
const ROLES = ['viewer', 'reader', 'admin', 'superadmin'];
const SHARED = ['reader', 'viewer']; // the two roles that share one word between them
const rank = (role) => ROLES.indexOf(String(role || ''));
const may = (role, need) => rank(role) >= rank(need) && rank(role) >= 0;

function secret() {
  if (process.env.UNISIS_SECRET) return Buffer.from(process.env.UNISIS_SECRET, 'utf8');
  if (!fs.existsSync(SECRET_FILE)) {
    fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
  }
  return Buffer.from(fs.readFileSync(SECRET_FILE, 'utf8').trim(), 'base64');
}

const BLANK = { version: 2, users: {}, shared: {}, apps: {}, log: [] };

/**
 * The file as it stands, brought up to date if it is still the old shape. Before roles existed
 * users.json was a flat map of name to account; those accounts become admins, and one of them
 * has to be made superadmin from the command line before the console can be opened.
 */
function readStore() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return { ...BLANK, users: {}, shared: {}, apps: {}, log: [] };
  }
  if (raw && raw.version === 2) {
    return { ...BLANK, ...raw, users: raw.users || {}, shared: raw.shared || {}, apps: raw.apps || {}, log: raw.log || [] };
  }
  const users = {};
  for (const [name, rec] of Object.entries(raw || {})) {
    if (rec && rec.salt && rec.hash) users[name] = { ...rec, role: 'admin' };
  }
  return { ...BLANK, users };
}

function writeStore(store) {
  fs.writeFileSync(USERS_FILE, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}

const today = () => new Date().toISOString().slice(0, 10);
const hash = (secretText, salt) =>
  crypto.pbkdf2Sync(secretText, Buffer.from(salt, 'base64'), ITERATIONS, KEY_BYTES, 'sha256').toString('base64');
const fresh = (secretText) => {
  const salt = crypto.randomBytes(16).toString('base64');
  return { salt, hash: hash(secretText, salt) };
};
// Same cost whether or not the thing exists, so a wrong name gives nothing away.
const matches = (rec, attempt) => {
  const salt = rec ? rec.salt : 'c2FsdGluZ2Zvcm5vYm9keQ==';
  const got = Buffer.from(hash(String(attempt || ''), salt), 'base64');
  const want = Buffer.from(rec ? rec.hash : hash('no such secret', salt), 'base64');
  return Boolean(rec) && got.length === want.length && crypto.timingSafeEqual(got, want);
};

/* ------------------------------------------------------------------ people */

const clean = (name) => String(name || '').trim().toLowerCase();

function addUser(name, password, role = 'admin') {
  if (String(password || '').length < MIN_SECRET) throw new Error(`the password must be at least ${MIN_SECRET} characters`);
  if (!['admin', 'superadmin'].includes(role)) throw new Error('an account is either an admin or a superadmin');
  const store = readStore();
  const key = clean(name);
  if (!key) throw new Error('that name is empty');
  store.users[key] = { role, ...fresh(password), added: store.users[key]?.added || today() };
  writeStore(store);
}

const superadmins = (users) => Object.values(users).filter((u) => u.role === 'superadmin').length;

function setRole(name, role) {
  if (!['admin', 'superadmin'].includes(role)) throw new Error('an account is either an admin or a superadmin');
  const store = readStore();
  const key = clean(name);
  const rec = store.users[key];
  if (!rec) return false;
  // The place can never be left without someone who can manage it.
  if (rec.role === 'superadmin' && role !== 'superadmin' && superadmins(store.users) < 2) {
    throw new Error('this is the only superadmin: make someone else one first');
  }
  rec.role = role;
  writeStore(store);
  return true;
}

function removeUser(name) {
  const store = readStore();
  const key = clean(name);
  const rec = store.users[key];
  if (!rec) return false;
  if (rec.role === 'superadmin' && superadmins(store.users) < 2) {
    throw new Error('this is the only superadmin: make someone else one first');
  }
  delete store.users[key];
  writeStore(store);
  return true;
}

const listUsers = () => Object.entries(readStore().users)
  .map(([name, rec]) => ({ name, role: rec.role || 'admin', added: rec.added || '', apps: { ...(rec.apps || {}) } }))
  .sort((a, b) => rank(b.role) - rank(a.role) || a.name.localeCompare(b.name));

// The role this name and password belong to, or '' if they belong to nobody.
function checkUser(name, password) {
  const rec = readStore().users[clean(name)];
  return matches(rec, password) ? rec.role || 'admin' : '';
}

/* ------------------------------------------------- the two shared words */

function setWord(kind, word) {
  if (!SHARED.includes(kind)) throw new Error('the shared words are reader and viewer');
  const store = readStore();
  if (word === null) {
    delete store.shared[kind];
  } else {
    if (String(word || '').length < MIN_SECRET) throw new Error(`the access word must be at least ${MIN_SECRET} characters`);
    store.shared[kind] = { ...fresh(word), set: new Date().toISOString() };
  }
  writeStore(store);
}

/**
 * The role an access word opens, or '' for none. Both words are always checked, so the time
 * taken says nothing about which one was close.
 */
function checkWord(word) {
  const { shared } = readStore();
  let found = '';
  for (const kind of SHARED) {
    if (matches(shared[kind], word) && !found) found = kind;
  }
  return found;
}

// What the console shows about them: when each was last set, never the words themselves.
const wordsSet = () => Object.fromEntries(SHARED.map((kind) => [kind, readStore().shared[kind]?.set || '']));

/* ------------------------------------------------------- per-app access */

// The lowest role that may see an app. Unknown apps are admin-only until someone says otherwise.
const appRole = (id) => readStore().apps[String(id)] || 'admin';
const policy = () => ({ ...readStore().apps });

function setPolicy(id, role) {
  if (!ROLES.includes(role)) throw new Error('an app is opened to viewer, reader, admin or superadmin');
  const store = readStore();
  store.apps[String(id)] = role;
  writeStore(store);
}

/**
 * One person may be given exceptions to the role rule: an app their role would not reach, or
 * one taken away from them alone. A shared word has no person behind it, so it follows its role.
 *   allow  this person sees it whatever their role says
 *   deny   this person does not, whatever their role says
 *   (none) their role decides, as before
 */
function setUserApp(name, id, rule) {
  const store = readStore();
  const rec = store.users[clean(name)];
  if (!rec) return false;
  const apps = { ...(rec.apps || {}) };
  if (rule === 'allow' || rule === 'deny') apps[String(id)] = rule;
  else delete apps[String(id)];
  if (Object.keys(apps).length) rec.apps = apps;
  else delete rec.apps;
  writeStore(store);
  return true;
}

// What this person is served: their own exceptions first, then what their role reaches.
function visibleFor(who, apps) {
  const store = readStore();
  const mine = (store.users[clean(who && who.name)] || {}).apps || {};
  return apps.filter((app) => {
    const rule = mine[app.id];
    if (rule === 'allow') return true;
    if (rule === 'deny') return false;
    return may(who && who.role, store.apps[app.id] || 'admin');
  });
}

/* --------------------------------------------------------- the sign-in log */

function note(entry) {
  const store = readStore();
  store.log = [{ at: new Date().toISOString(), ...entry }, ...(store.log || [])].slice(0, LOG_KEEP);
  writeStore(store);
}

const log = () => readStore().log || [];

/* ------------------------------------------------------------- sessions */

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function newSession(name, role) {
  const now = Date.now();
  const body = `${clean(name)}|${role}|${now}|${now + SESSION_DAYS * 864e5}`;
  const mac = crypto.createHmac('sha256', secret()).update(body).digest();
  return `${b64url(body)}.${b64url(mac)}`;
}

/**
 * Who this cookie belongs to now — not who it belonged to when it was handed out. The role is
 * taken from the file every time, so a demotion takes hold at once; a shared session older than
 * the last rotation of its word is refused, which is what makes rotating a word sign people out.
 * Returns { name, role } or null.
 */
function readSession(token) {
  const [bodyPart, macPart] = String(token || '').split('.');
  if (!bodyPart || !macPart) return null;
  const body = Buffer.from(bodyPart, 'base64url').toString('utf8');
  const mac = Buffer.from(macPart, 'base64url');
  const want = crypto.createHmac('sha256', secret()).update(body).digest();
  if (mac.length !== want.length || !crypto.timingSafeEqual(mac, want)) return null;

  const [name, role, issued, expiry] = body.split('|');
  if (!name || !(Number(expiry) > Date.now())) return null;

  const store = readStore();
  if (SHARED.includes(name)) {
    const word = store.shared[name];
    if (!word) return null; // the word has been taken away
    if (Date.parse(word.set || 0) > Number(issued)) return null; // and rotating it ends old sessions
    return { name, role: name };
  }
  const rec = store.users[name];
  if (rec) return { name, role: rec.role || 'admin' };
  // Google sign-in, where it is set up: an allowed address is an admin.
  return isAllowed(name) ? { name, role: 'admin' } : null;
}

const cookieName = 'unisis_session';

const sessionCookie = (token, secure) =>
  `${cookieName}=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

const clearedCookie = (secure) => `${cookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return '';
}

/* ---------------------------------------------------------------- Google */

const CONFIG_FILE = path.join(ROOT, 'auth.config.json');
const CERTS = 'https://www.googleapis.com/oauth2/v3/certs';

function config() {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch { /* no config yet: Google sign-in simply stays off */ }
  const allowed = process.env.UNISIS_ALLOWED
    ? process.env.UNISIS_ALLOWED.split(',').map((s) => s.trim()).filter(Boolean)
    : file.allowed || [];
  return { googleClientId: process.env.UNISIS_GOOGLE_CLIENT_ID || file.googleClientId || '', allowed };
}

function writeConfig(next) {
  fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(next, null, 2)}
`);
}

// "someone@bookends.co.in" matches itself; "@bookends.co.in" matches everyone at that domain.
function isAllowed(email) {
  const who = String(email || '').toLowerCase();
  return config().allowed.some((rule) => {
    const r = String(rule).toLowerCase();
    return r.startsWith('@') ? who.endsWith(r) : who === r;
  });
}

let certs = { at: 0, keys: [] };
async function googleKeys(fetchImpl = fetch) {
  if (certs.keys.length && Date.now() - certs.at < 3600e3) return certs.keys;
  const res = await fetchImpl(CERTS);
  const { keys } = await res.json();
  certs = { at: Date.now(), keys };
  return keys;
}

const jwtPart = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

/**
 * Checks an ID token the way Google asks: its signature against Google's published keys,
 * then that it was minted for this dashboard, has not expired, and carries a verified
 * address. Returns { email, name } or null. Pass { keys } in tests to skip the fetch.
 */
async function verifyGoogle(idToken, opts = {}) {
  const clientId = opts.clientId || config().googleClientId;
  if (!clientId) return null;
  const [head, body, sig] = String(idToken || '').split('.');
  if (!head || !body || !sig) return null;

  let header;
  let claims;
  try {
    header = jwtPart(head);
    claims = jwtPart(body);
  } catch {
    return null;
  }
  if (header.alg !== 'RS256') return null;

  const keys = opts.keys || (await googleKeys(opts.fetch));
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;

  let signed = false;
  try {
    signed = crypto.verify('RSA-SHA256', Buffer.from(`${head}.${body}`),
      crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(sig, 'base64url'));
  } catch {
    return null;
  }
  if (!signed) return null;

  const issuers = ['accounts.google.com', 'https://accounts.google.com'];
  if (!issuers.includes(claims.iss)) return null;
  if (claims.aud !== clientId) return null;
  if (!(Number(claims.exp) * 1000 > Date.now())) return null;
  if (claims.email_verified !== true && claims.email_verified !== 'true') return null;
  const email = String(claims.email || '').toLowerCase();
  return email ? { email, name: claims.name || email } : null;
}

module.exports = {
  ITERATIONS, KEY_BYTES, SESSION_DAYS, MIN_SECRET, cookieName, ROLES, SHARED, rank, may,
  readStore, writeStore,
  addUser, removeUser, setRole, listUsers, checkUser,
  setWord, checkWord, wordsSet,
  appRole, policy, setPolicy, setUserApp, visibleFor,
  note, log,
  config, writeConfig, isAllowed, verifyGoogle,
  newSession, readSession, sessionCookie, clearedCookie, cookieValue,
};
