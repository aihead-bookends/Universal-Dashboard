/** Who is signed in, for the footer on the dashboard. */

import { COOKIE, cookieValue, json, readSession } from '../_auth.js';

export async function onRequestGet({ request, env }) {
  const name = await readSession(env, cookieValue(request.headers.get('Cookie'), COOKIE));
  return name ? json({ name }) : json({ error: 'Not signed in' }, 401);
}
