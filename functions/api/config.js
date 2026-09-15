/** What the login page should offer: Google, passwords, or both. */

import { json } from '../_auth.js';

export function onRequestGet({ env }) {
  let accounts = 0;
  try {
    accounts = Object.keys(JSON.parse(env.UNISIS_USERS || '{}')).length;
  } catch { /* no accounts configured */ }
  return json({ google: env.UNISIS_GOOGLE_CLIENT_ID || '', passwords: accounts > 0 });
}
