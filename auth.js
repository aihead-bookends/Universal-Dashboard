'use strict';

/**
 * Accounts and sessions for the local server (server.js).
 *
 * Passwords are never stored: each account keeps a random salt and a PBKDF2-SHA256
 * hash of the password, in users.json (git-ignored, readable only by you). The same
 * numbers are used by the Cloudflare functions in functions/, so one users.json works
 * both locally and hosted.
 *
 * A session is a cookie holding "name|expiry" plus an HMAC of it, signed with a secret
 * from UNISIS_SECRET, or one generated into .session-secret on first run. Nothing is
 * kept in memory, so restarting the server does not sign anyone out.
 *
 * Google sign-in lives here too: an ID token from Google is checked against Google's own
 * signing keys, then against the allow list in auth.config.json, and turns into the same
 * session cookie. Accounts and Google can both be on; either one gets you in.
 *
 *   node tools/user.js add krish            add or replace an account (asks for the password)
 *   node tools/user.js list                 who has an account
 *   node tools/user.js remove krish         take an account away
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

function secret() {
  if (process.env.UNISIS_SECRET) return Buffer.from(process.env.UNISIS_SECRET, 'utf8');
  if (!fs.existsSync(SECRET_FILE)) {
    fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
  }
  return Buffer.from(fs.readFileSync(SECRET_FILE, 'utf8').trim(), 'base64');
}

function readUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, `${JSON.stringify(users, null, 2)}\n`, { mode: 0o600 });
}

const hash = (password, salt) =>
  crypto.pbkdf2Sync(password, Buffer.from(salt, 'base64'), ITERATIONS, KEY_BYTES, 'sha256').toString('base64');

function addUser(name, password) {
  const users = readUsers();
  const salt = crypto.randomBytes(16).toString('base64');
  users[name.trim().toLowerCase()] = { salt, hash: hash(password, salt), added: new Date().toISOString().slice(0, 10) };
  writeUsers(users);
}

function removeUser(name) {
  const users = readUsers();
  const key = name.trim().toLowerCase();
  if (!(key in users)) return false;
  delete users[key];
  writeUsers(users);
  return true;
}

const listUsers = () => Object.entries(readUsers()).map(([name, rec]) => ({ name, added: rec.added || '' }));

// A wrong name costs the same time as a wrong password: both hash once, then compare fixed-length digests.
function checkUser(name, password) {
  const rec = readUsers()[String(name || '').trim().toLowerCase()];
  const salt = rec ? rec.salt : 'c2FsdGluZ2Zvcm5vYm9keQ==';
  const got = Buffer.from(hash(String(password || ''), salt), 'base64');
  const want = Buffer.from(rec ? rec.hash : hash('no such account', salt), 'base64');
  return Boolean(rec) && got.length === want.length && crypto.timingSafeEqual(got, want);
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function newSession(name) {
  const body = `${name.trim().toLowerCase()}|${Date.now() + SESSION_DAYS * 864e5}`;
  const mac = crypto.createHmac('sha256', secret()).update(body).digest();
  return `${b64url(body)}.${b64url(mac)}`;
}

// Returns the signed-in name, or '' for anything missing, altered or expired.
function readSession(token) {
  const [bodyPart, macPart] = String(token || '').split('.');
  if (!bodyPart || !macPart) return '';
  const body = Buffer.from(bodyPart, 'base64url').toString('utf8');
  const mac = Buffer.from(macPart, 'base64url');
  const want = crypto.createHmac('sha256', secret()).update(body).digest();
  if (mac.length !== want.length || !crypto.timingSafeEqual(mac, want)) return '';
  const [name, expiry] = body.split('|');
  if (!name || !(Number(expiry) > Date.now())) return '';
  return readUsers()[name] || isAllowed(name) ? name : '';
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
  ITERATIONS, KEY_BYTES, SESSION_DAYS, cookieName,
  addUser, removeUser, listUsers, checkUser, readUsers,
  config, writeConfig, isAllowed, verifyGoogle,
  newSession, readSession, sessionCookie, clearedCookie, cookieValue,
};
