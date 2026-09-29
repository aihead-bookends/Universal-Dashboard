/* Universal Dashboard service worker.
 *
 * Makes the launcher open instantly and when offline. Only the dashboard's own
 * files and its Google Fonts are handled; requests to the apps themselves are
 * never intercepted, so reachability checks and app pages always hit the network.
 *
 * Bump VERSION whenever SHELL changes.
 */
const VERSION = 'unisis-v31';
const SHELL = [
  './', 'index.html', 'app.js', 'apps.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-mask.svg', 'icons/icon-180.png', 'icons/icon-192.png',
  'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/bookends-hospitality.png',
];
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const store = (req, res) => {
  const copy = res.clone();
  caches.open(VERSION).then((c) => c.put(req, copy));
  return res;
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Sign-in calls, the login page and opening an app (a one-time pass) always go to the network.
  if (/\/(api|login|open)\b/.test(url.pathname)) return;
  if (url.origin === self.location.origin) {
    // Network first, so an edited apps.js shows on the next load; cache only as the offline fallback.
    e.respondWith(
      fetch(req)
        // A redirected answer is the sign-in gate, not the file asked for: never keep that.
        .then((res) => (res.ok && !res.redirected ? store(req, res) : res))
        .catch(() => caches.match(req, { ignoreSearch: true })
          .then((hit) => hit || (req.mode === 'navigate' ? caches.match('./') : Response.error()))),
    );
  } else if (FONT_HOSTS.has(url.hostname)) {
    // Font files are immutable per URL.
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => store(req, res))));
  }
});
