'use strict';

/**
 * Who may open the dashboard, and which apps they see (server.js).
 *
 * Two kinds of account:
 *
 *   superadmin  runs the place: signs in with a name and a password, sees every app, and opens the
 *               console at /admin, where accounts and their apps are managed.
 *   user        signs in with an access word of their own — one word, no name to type — and sees
 *               only the apps a superadmin has given them: an app with its own sign-in as its
 *               reader or its writer account, an app without one simply yes or no.
 *
 * server.js filters the app list against that before sending it, so an app somebody may not see
 * never reaches their browser at all — not its name, not its address. A new app starts as a no for
 * every user, so it is invisible to them until it is given out on purpose.
 *
 * Nothing is stored in the clear. Passwords and access words each keep a random salt and a
 * PBKDF2-SHA256 hash, in users.json (git-ignored, readable only by you). A word also keeps a keyed
 * fingerprint of itself, so the one account it belongs to can be found without trying every
 * account's hash in turn, and a copy of itself sealed with AES-256-GCM under a key drawn from the
 * session secret, because a superadmin has to be able to tell someone what their word is. The
 * file alone opens none of them; a password is never kept in any form that can be read back. A session is a cookie holding "name|role|issued|expiry" plus an HMAC of it,
 * signed with a secret from UNISIS_SECRET or one generated into .session-secret on first run.
 *
 * A session is checked against the file on every request, so access taken away is taken away at
 * once: remove an account, or give a user a new word, and the old session stops working.
 *
 *   node tools/user.js super krish          add a superadmin (the only way in, the first time)
 *   node tools/user.js add asha             add a user (asks for their access word)
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

const ROLES = ['user', 'superadmin'];
const rank = (role) => ROLES.indexOf(String(role || ''));

function secret() {
  if (process.env.UNISIS_SECRET) return Buffer.from(process.env.UNISIS_SECRET, 'utf8');
  if (!fs.existsSync(SECRET_FILE)) {
    fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
  }
  return Buffer.from(fs.readFileSync(SECRET_FILE, 'utf8').trim(), 'base64');
}

const BLANK = { version: 3, users: {}, log: [] };

/**
 * The file as it stands, brought up to date if it is an older shape. Nothing is lost on the way:
 *
 *   version 1  a flat map of name to account; each becomes a user who signs in with their password.
 *   version 2  four roles, two shared words and a lowest-role rule per app. Superadmins stay as they
 *              are. Admins become users who keep their password and are given every app admins
 *              could see, with their own exceptions on top. The shared reader and viewer words go:
 *              there is no one behind a shared word to give apps to.
 *
 * The upgraded shape is written back the next time anything is saved.
 */
function readStore() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return { ...BLANK, users: {}, log: [] };
  }
  if (raw && raw.version === 3) return { ...BLANK, ...raw, users: raw.users || {}, log: raw.log || [] };
  if (raw && raw.version === 2) return upgrade(raw);
  const users = {};
  for (const [name, rec] of Object.entries(raw || {})) {
    if (rec && rec.salt && rec.hash) users[name] = { ...rec, role: 'user' };
  }
  return { ...BLANK, users, log: [] };
}

const OLD_ROLES = ['viewer', 'reader', 'admin', 'superadmin'];
function upgrade(raw) {
  const policy = raw.apps || {};
  // What an admin could see under the old rule: an app open to admins or below. An app the old file
  // named with a role it no longer knows is left closed.
  const openToAdmins = (id) => OLD_ROLES.indexOf(policy[id] || 'admin') <= OLD_ROLES.indexOf('admin')
    && OLD_ROLES.includes(policy[id] || 'admin');
  const users = {};
  for (const [name, rec] of Object.entries(raw.users || {})) {
    const { apps: rules = {}, ...rest } = rec;
    if (rec.role === 'superadmin') { users[name] = rest; continue; }
    const apps = {};
    for (const id of Object.keys(policy)) if (openToAdmins(id)) apps[id] = true;
    for (const [id, rule] of Object.entries(rules)) {
      if (rule === 'allow') apps[id] = true;
      if (rule === 'deny') delete apps[id];
    }
    users[name] = { ...rest, role: 'user', apps };
  }
  return { ...BLANK, users, log: raw.log || [] };
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

/* ------------------------------------------------------------ sealed words */

// A key for sealing words, drawn from the session secret but never the same bytes as it.
const sealKey = () => crypto.createHmac('sha256', secret()).update('unisis access word seal').digest();

function seal(text) {
  const iv = crypto.randomBytes(12);
  const box = crypto.createCipheriv('aes-256-gcm', sealKey(), iv);
  const data = Buffer.concat([box.update(String(text), 'utf8'), box.final()]);
  return { iv: iv.toString('base64'), tag: box.getAuthTag().toString('base64'), data: data.toString('base64') };
}

// The word back out, or '' if it cannot be: sealed under a different secret, or tampered with.
function unseal(sealed) {
  if (!sealed || !sealed.iv || !sealed.tag || !sealed.data) return '';
  try {
    const box = crypto.createDecipheriv('aes-256-gcm', sealKey(), Buffer.from(sealed.iv, 'base64'));
    box.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    return Buffer.concat([box.update(Buffer.from(sealed.data, 'base64')), box.final()]).toString('utf8');
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------ people */

const clean = (name) => String(name || '').trim().toLowerCase();
const superadmins = (users) => Object.values(users).filter((u) => u.role === 'superadmin').length;

// A word's fingerprint: an HMAC under a random key kept in users.json itself, so a word leads
// straight to the one account it opens, and the file keeps working if the session secret changes.
function wordKey(store, word) {
  if (!store.pepper) store.pepper = crypto.randomBytes(32).toString('base64');
  return crypto.createHmac('sha256', Buffer.from(store.pepper, 'base64')).update(String(word)).digest('base64');
}

/**
 * Add an account, or give an existing one a new secret (and, with it, possibly a new kind):
 *   superadmin  secret is a password
 *   user        secret is their access word; no two users may share one
 * A user given a new word is signed out wherever they were signed in with the old one. Typing a
 * user's current word again changes nothing for them: it only keeps a readable copy of it, which
 * is how a word saved before words could be shown is made showable.
 */
function addUser(name, secretText, role = 'user') {
  if (!ROLES.includes(role)) throw new Error('an account is either a user or a superadmin');
  const what = role === 'superadmin' ? 'password' : 'access word';
  if (String(secretText || '').length < MIN_SECRET) throw new Error(`the ${what} must be at least ${MIN_SECRET} characters`);
  const store = readStore();
  const key = clean(name);
  if (!key) throw new Error('that name is empty');
  const old = store.users[key];
  if (old && old.role === 'superadmin' && role !== 'superadmin' && superadmins(store.users) < 2) {
    throw new Error('this is the only superadmin: add another one first');
  }
  const added = old?.added || today();
  if (role === 'superadmin') {
    store.users[key] = { role, ...fresh(secretText), added };
  } else {
    const fingerprint = wordKey(store, secretText);
    const taken = Object.entries(store.users).find(([n, u]) => n !== key && u.key === fingerprint);
    if (taken) throw new Error(`that access word is already ${taken[0]}'s: pick another`);
    const same = old && old.role !== 'superadmin' && old.word && matches(old.word, secretText);
    store.users[key] = { role, word: same ? old.word : fresh(secretText), key: fingerprint, sealed: seal(secretText),
      set: same && old.set ? old.set : new Date().toISOString(),
      added, apps: { ...(old?.apps || {}) } };
  }
  writeStore(store);
}

/**
 * A user changing their own word, from the dashboard. They must give the word they sign in with now
 * (or, for a user from before words, their password), so an unattended screen is not enough to take
 * the account over. The errors say nothing about anyone else: a word already in use is only "taken",
 * never whose. The new word is kept like any other, readable by a superadmin, and every session from
 * before it stops working; server.js hands the one making the change a fresh session.
 */
function changeOwnWord(name, current, next) {
  const store = readStore();
  const key = clean(name);
  const rec = store.users[key];
  if (!rec || rec.role === 'superadmin') throw new Error('Only a user can change an access word here.');
  const proof = rec.word || (rec.hash ? rec : null);
  if (!matches(proof, current)) throw new Error(rec.word ? 'That is not your current word.' : 'That is not your current password.');
  if (String(next || '').length < MIN_SECRET) throw new Error(`The new word must be at least ${MIN_SECRET} characters.`);
  if (rec.word && matches(rec.word, next)) throw new Error('That is already your word. Pick a new one.');
  const fingerprint = wordKey(store, next);
  if (Object.entries(store.users).some(([n, u]) => n !== key && u.key === fingerprint)) {
    throw new Error('That word is taken. Pick another.');
  }
  const { salt, hash: pw, ...rest } = rec; // a password gives way to the word
  store.users[key] = { ...rest, word: fresh(next), key: fingerprint, sealed: seal(next), set: new Date().toISOString() };
  writeStore(store);
}

function removeUser(name) {
  const store = readStore();
  const key = clean(name);
  const rec = store.users[key];
  if (!rec) return false;
  if (rec.role === 'superadmin' && superadmins(store.users) < 2) {
    throw new Error('this is the only superadmin: add another one first');
  }
  delete store.users[key];
  writeStore(store);
  return true;
}

const listUsers = () => Object.entries(readStore().users)
  .map(([name, rec]) => ({
    name,
    role: rec.role === 'superadmin' ? 'superadmin' : 'user',
    added: rec.added || '',
    apps: levels(rec),             // { id: 'reader' | 'writer' | 'yes' }
    word: Boolean(rec.key),        // signs in with an access word
    shown: Boolean(rec.sealed),    // and that word can be looked up (set since words could be)
    password: Boolean(rec.hash),   // signs in with a password (every superadmin; users from before words)
  }))
  .sort((a, b) => rank(b.role) - rank(a.role) || a.name.localeCompare(b.name));

// The role this name and password belong to, or '' if they belong to nobody.
function checkUser(name, password) {
  const rec = readStore().users[clean(name)];
  const account = rec && rec.hash ? rec : null;
  return matches(account, password) ? account.role || 'user' : '';
}

/**
 * The name of the user this access word belongs to, or '' for none. The fingerprint finds the one
 * account it could be; the hash is then checked in full, and a word that fits nobody costs the
 * same single hash, so the time taken gives nothing away.
 */
function checkWord(word) {
  const store = readStore();
  if (!store.pepper || !word) return '';
  const fingerprint = wordKey(store, word);
  const found = Object.entries(store.users).find(([, u]) => u.role !== 'superadmin' && u.key === fingerprint);
  return matches(found ? found[1].word : null, word) ? found[0] : '';
}

// Whether anyone can sign in with a word at all, which is what decides if the login page offers one.
const anyWords = () => Object.values(readStore().users).some((u) => u.key);

// A user's current access word, for a superadmin to pass on; '' if it was set before words were
// kept this way, or the session secret has changed since, and so it cannot be read back.
function peekWord(name) {
  const rec = readStore().users[clean(name)];
  return rec && rec.role !== 'superadmin' ? unseal(rec.sealed) : '';
}

/* ------------------------------------------------------- per-app access */

/**
 * What a user has been given, app by app, kept on the user as apps: { id: level }:
 *   'reader' / 'writer'  an app with its own sign-in, opened as its reader or its writer account
 *   true                 an app with no sign-in (login: 'none' in apps.js), simply given
 * Anything else, or nothing, is no. A plain true on an app that does have a sign-in, from before
 * there were two levels, counts as reader: the lesser of the two.
 */
const LEVELS = ['reader', 'writer'];
const levels = (rec) => Object.fromEntries(Object.entries((rec && rec.apps) || {})
  .map(([id, v]) => [id, LEVELS.includes(v) ? v : v === true ? 'yes' : ''])
  .filter(([, v]) => v));

// This user's level for this app: 'reader', 'writer', 'yes' for an app without a sign-in, or '' for none.
function levelOf(rec, app) {
  const v = levels(rec)[app.id];
  if (!v) return '';
  if (app.login === 'none') return 'yes';
  return v === 'writer' ? 'writer' : 'reader';
}

// Give one app to one user, or take it away: level is 'no', 'yes', 'reader' or 'writer'. server.js
// has already checked the level suits the app.
function setUserApp(name, id, level) {
  const store = readStore();
  const rec = store.users[clean(name)];
  if (!rec || rec.role === 'superadmin') return false;
  const apps = { ...(rec.apps || {}) };
  if (LEVELS.includes(level)) apps[String(id)] = level;
  else if (level === 'yes') apps[String(id)] = true;
  else delete apps[String(id)];
  rec.apps = apps;
  writeStore(store);
  return true;
}

// A user's level for one app, by name: what server.js checks before opening it for them.
const levelFor = (name, app) => levelOf(readStore().users[clean(name)], app);

// What this person is served. A user's apps each carry `as`, the account the app opens them as.
function visibleFor(who, apps) {
  if (!who) return [];
  if (who.role === 'superadmin') return apps;
  const rec = readStore().users[clean(who.name)];
  return apps.flatMap((app) => {
    const as = levelOf(rec, app);
    if (!as) return [];
    return [as === 'yes' ? app : { ...app, as }];
  });
}

/* ------------------------------------------------------ sign-in passes */

/**
 * Each app that takes sign-in passes has its own key, made here on first use and kept in
 * users.json; the app keeps a copy in its own environment (tools/sso/verify.js checks passes with
 * it). A pass says which user, which app and which account — reader or writer — and lives for sixty
 * seconds. One app's key cannot make or check a pass for another.
 */
function ssoKey(appId) {
  const store = readStore();
  store.sso = store.sso || {};
  if (!store.sso[appId]) {
    store.sso[appId] = crypto.randomBytes(32).toString('base64');
    writeStore(store);
  }
  return store.sso[appId];
}

const hasSsoKey = (appId) => Boolean((readStore().sso || {})[appId]);

function ssoPass(appId, name, as) {
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(JSON.stringify({ app: appId, sub: clean(name), as, iat: now, exp: now + 60,
    jti: crypto.randomBytes(12).toString('base64url') }));
  const sig = crypto.createHmac('sha256', Buffer.from(ssoKey(appId), 'base64')).update(body).digest();
  return `${body}.${b64url(sig)}`;
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
 * Who this cookie belongs to now — not who it belonged to when it was handed out. The account is
 * looked up in the file every time, so a removed account is signed out at once, and so is a user
 * whose word has been changed since the session began. Returns { name, role } or null.
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

  const rec = readStore().users[name];
  if (rec) {
    const role = rec.role === 'superadmin' ? 'superadmin' : 'user';
    // A user given a new word since this session began is signed out.
    if (role === 'user' && rec.set && Date.parse(rec.set) > Number(issued)) return null;
    return { name, role };
  }
  // Google sign-in, where it is set up: an allowed address is a user, and sees no app until a
  // superadmin adds them as a user by that address and gives them some.
  return isAllowed(name) ? { name, role: 'user' } : null;
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
  ITERATIONS, KEY_BYTES, SESSION_DAYS, MIN_SECRET, cookieName, ROLES, rank,
  readStore, writeStore,
  addUser, changeOwnWord, removeUser, listUsers, checkUser, checkWord, anyWords, peekWord,
  LEVELS, levelOf, levelFor, setUserApp, visibleFor, ssoKey, hasSsoKey, ssoPass,
  note, log,
  config, writeConfig, isAllowed, verifyGoogle,
  newSession, readSession, sessionCookie, clearedCookie, cookieValue,
};
