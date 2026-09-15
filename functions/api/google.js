/**
 * Google sign-in for the hosted copy: checks the ID token against Google's own signing
 * keys, that it was minted for this dashboard, has not expired and carries a verified
 * address, then against the allow list. Only then does it hand back a session cookie.
 */

import { allowedEmail, json, newSession, sessionCookie, verifyGoogle } from '../_auth.js';

export async function onRequestPost({ request, env }) {
  let body = {};
  try {
    body = await request.json();
  } catch { /* an empty body simply fails below */ }

  const account = await verifyGoogle(env, body.credential).catch(() => null);
  if (!account) return json({ error: 'Google did not vouch for that sign-in.' }, 401);
  if (!allowedEmail(env, account.email)) {
    return json({ error: `${account.email} is not on the list. Ask Krish to add it.` }, 403);
  }
  return json({ name: account.email }, 200, { 'Set-Cookie': sessionCookie(await newSession(env, account.email)) });
}

export const onRequest = () => json({ error: 'Post a Google credential here.' }, 405);
