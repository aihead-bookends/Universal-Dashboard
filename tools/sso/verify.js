'use strict';

/**
 * Checks a sign-in pass from the Bookends Universal Dashboard. Copy this one file into an app's
 * server (it needs nothing but Node's crypto) and call it from the app's own sign-in endpoint.
 *
 *   const { verifyPass } = require('./unisis-verify');
 *   const { user, as } = verifyPass(pass, { key: process.env.UNISIS_SSO_KEY, app: 'ordergenie' });
 *   // as is 'reader' or 'writer': sign the browser in as that account, and tell no one the password
 *
 * key  the app's sign-in key, from the dashboard's /admin page (Sign-in keys → Show key). Keep it
 *      in the app's environment, never in its code or its browser bundle.
 * app  the app's id in the dashboard's apps.js, so a pass made for another app is refused here.
 *
 * A pass is "<payload>.<signature>", both base64url: the payload is JSON
 *   { app, sub: the dashboard user's name, as: 'reader' | 'writer', iat, exp, jti }
 * signed with HMAC-SHA256 under the key. It lives for sixty seconds and works once.
 *
 * Throws an Error with a short reason if the pass is forged, for another app, expired or used.
 */

const crypto = require('node:crypto');

// Passes already used, until they would have expired anyway. In memory: an app running on more
// than one server at once should keep these in its database instead, so a pass works only once
// across all of them.
const used = new Map();

function verifyPass(pass, { key, app, now = Date.now() } = {}) {
  if (!key) throw new Error('no sign-in key set');
  const [body, sig] = String(pass || '').split('.');
  if (!body || !sig) throw new Error('not a pass');
  const want = crypto.createHmac('sha256', Buffer.from(key, 'base64')).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) throw new Error('pass not signed by the dashboard');

  let claims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new Error('pass unreadable');
  }
  if (claims.app !== app) throw new Error('pass is for another app');
  if (!(claims.exp * 1000 > now)) throw new Error('pass expired');
  if (claims.as !== 'reader' && claims.as !== 'writer') throw new Error('pass names no account');

  for (const [id, until] of used) if (until <= now) used.delete(id);
  if (used.has(claims.jti)) throw new Error('pass already used');
  used.set(claims.jti, claims.exp * 1000);

  return { user: String(claims.sub || ''), as: claims.as };
}

module.exports = { verifyPass };
