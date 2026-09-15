/**
 * The gate for the hosted copy. Everything is refused until the request carries a
 * valid session cookie, apart from the login page, the backdrop it draws and the
 * icons a browser asks for early. Page requests are sent to /login; anything else
 * is simply refused, so the app list never leaves the server unsigned-in.
 */

import { COOKIE, cookieValue, readSession } from './_auth.js';

const OPEN = new Set(['/login', '/login.html', '/galaxy.js', '/manifest.webmanifest', '/favicon.ico']);
const isIcon = (p) => /^\/icons\/[\w.-]+\.(png|svg)$/.test(p);

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/index\.html$/, '/');

  if (path.startsWith('/api/')) return next(); // the sign-in routes check for themselves

  const who = await readSession(env, cookieValue(request.headers.get('Cookie'), COOKIE));
  if (who) {
    // Already signed in? The login page is just a detour back to the dashboard.
    if (path === '/login' || path === '/login.html') return Response.redirect(new URL('/', url), 302);
    return next();
  }
  if (OPEN.has(path) || isIcon(path)) return next();

  const wantsPage = (request.headers.get('Accept') || '').includes('text/html');
  if (wantsPage) return Response.redirect(new URL('/login', url), 302);
  return new Response('Sign in first', { status: 401, headers: { 'Cache-Control': 'no-store' } });
}
