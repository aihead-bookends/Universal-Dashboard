/** Checks a name and password, and hands back a session cookie. */

import { checkUser, json, newSession, sessionCookie } from '../_auth.js';

export async function onRequestPost({ request, env }) {
  let body = {};
  try {
    body = await request.json();
  } catch { /* an empty body simply fails the check below */ }

  const name = await checkUser(env, body.name, body.password);
  if (!name) return json({ error: 'That name and password do not match.' }, 401);
  return json({ name }, 200, { 'Set-Cookie': sessionCookie(await newSession(env, name)) });
}

export const onRequest = () => json({ error: 'Post a name and password here.' }, 405);
