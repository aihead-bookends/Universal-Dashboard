/**
 * Accounts and sessions for the hosted copy (Cloudflare Pages Functions).
 *
 * Same numbers as auth.js, so one users.json works in both places:
 *   PBKDF2-SHA256, 120,000 rounds, 32-byte key, salt and hash base64.
 *   Session cookie: base64url("name|expiry") + "." + base64url(HMAC-SHA256 of it).
 *
 * Settings on the Pages project (Settings -> Environment variables):
 *   UNISIS_SECRET             a long random string; changing it signs everyone out
 *   UNISIS_USERS              password accounts: the one line from npm run user export
 *   UNISIS_GOOGLE_CLIENT_ID   Google sign-in: the client id from Google Cloud
 *   UNISIS_ALLOWED            who may sign in with Google: a@b.com,@a-domain.com
 */

const ITERATIONS = 120_000;
const SESSION_DAYS = 30;
export const COOKIE = 'unisis_session';

const enc = new TextEncoder();
const bytesFromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64FromBytes = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
const b64url = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

async function hash(password, saltB64) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: bytesFromB64(saltB64), iterations: ITERATIONS, hash: 'SHA-256' }, key, 256);
  return b64FromBytes(bits);
}

// Compares in constant time, so a near-miss password is no quicker to reject.
function same(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const users = (env) => {
  try {
    return JSON.parse(env.UNISIS_USERS || '{}');
  } catch {
    return {};
  }
};

export async function checkUser(env, name, password) {
  const key = String(name || '').trim().toLowerCase();
  const rec = users(env)[key];
  // A wrong name costs the same as a wrong password: both hash once.
  const salt = rec ? rec.salt : 'c2FsdGluZ2Zvcm5vYm9keQ==';
  const got = await hash(String(password || ''), salt);
  const want = rec ? rec.hash : await hash('no such account', salt);
  return Boolean(rec) && same(got, want) ? key : '';
}

const macKey = (env) =>
  crypto.subtle.importKey('raw', enc.encode(env.UNISIS_SECRET || ''), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

export async function newSession(env, name) {
  const body = `${name}|${Date.now() + SESSION_DAYS * 864e5}`;
  const mac = await crypto.subtle.sign('HMAC', await macKey(env), enc.encode(body));
  return `${b64url(body)}.${b64url(String.fromCharCode(...new Uint8Array(mac)))}`;
}

export async function readSession(env, token) {
  const [bodyPart, macPart] = String(token || '').split('.');
  if (!bodyPart || !macPart) return '';
  let body;
  let mac;
  try {
    body = unb64url(bodyPart);
    mac = Uint8Array.from(unb64url(macPart), (c) => c.charCodeAt(0));
  } catch {
    return '';
  }
  if (!(await crypto.subtle.verify('HMAC', await macKey(env), mac, enc.encode(body)))) return '';
  const [name, expiry] = body.split('|');
  if (!name || !(Number(expiry) > Date.now())) return '';
  return users(env)[name] || allowedEmail(env, name) ? name : '';
}

export const sessionCookie = (token) =>
  `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax; Secure`;
export const clearedCookie = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`;

export function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return '';
}


/* ---------------------------------------------------------------- Google */

const CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
let certs = { at: 0, keys: [] };

async function googleKeys() {
  if (certs.keys.length && Date.now() - certs.at < 3600e3) return certs.keys;
  const { keys } = await (await fetch(CERTS)).json();
  certs = { at: Date.now(), keys };
  return keys;
}

const jwtPart = (part) => JSON.parse(unb64url(part));

// "someone@bookends.co.in" matches itself; "@bookends.co.in" matches everyone at that domain.
export function allowedEmail(env, email) {
  const who = String(email || '').toLowerCase();
  return String(env.UNISIS_ALLOWED || '')
    .split(',')
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean)
    .some((r) => (r.startsWith('@') ? who.endsWith(r) : who === r));
}

export async function verifyGoogle(env, idToken, opts = {}) {
  const clientId = opts.clientId || env.UNISIS_GOOGLE_CLIENT_ID || '';
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

  const keys = opts.keys || (await googleKeys());
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey('jwk', { ...jwk, ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const signature = Uint8Array.from(unb64url(sig), (c) => c.charCodeAt(0));
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, enc.encode(`${head}.${body}`)))) return null;

  const issuers = ['accounts.google.com', 'https://accounts.google.com'];
  if (!issuers.includes(claims.iss)) return null;
  if (claims.aud !== clientId) return null;
  if (!(Number(claims.exp) * 1000 > Date.now())) return null;
  if (claims.email_verified !== true && claims.email_verified !== 'true') return null;
  const email = String(claims.email || '').toLowerCase();
  return email ? { email, name: claims.name || email } : null;
}

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
