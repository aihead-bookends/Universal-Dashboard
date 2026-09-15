/** Drops the session cookie. */

import { clearedCookie, json } from '../_auth.js';

export const onRequestPost = () => json({ ok: true }, 200, { 'Set-Cookie': clearedCookie() });
export const onRequest = () => json({ error: 'Post here to sign out.' }, 405);
