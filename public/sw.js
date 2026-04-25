/* Advottic service worker.
 *
 * Conservative on purpose: this is an authenticated, server-driven app, so
 * we do NOT cache HTML pages, /api routes, /auth flows, or anything tied to
 * a user session. Caching the wrong response would surface another user's
 * data on a shared device.
 *
 * What we DO cache (cache-first):
 *  - Brand assets in /fonts/, /icon*, /apple-icon, /advottic-*
 *  - Next.js immutable build assets under /_next/static/
 *
 * Everything else is plain network fetch. Having a registered fetch handler
 * is what unlocks "installable" on Android Chrome - we don't need to do
 * anything fancy beyond that.
 */
const VERSION = 'v1';
const STATIC_CACHE = `advottic-static-${VERSION}`;

const PRECACHE_URLS = [
  '/icon-192.png',
  '/icon-512.png',
  '/apple-icon.png',
  '/advottic-mark.png',
  '/advottic-logo.png',
  '/fonts/conquera.ttf',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      // Don't fail install if a single asset is missing.
      Promise.all(
        PRECACHE_URLS.map((u) =>
          cache.add(u).catch(() => {
            /* ignore */
          }),
        ),
      ),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('advottic-static-') && k !== STATIC_CACHE)
          .map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isStatic =
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/fonts/') ||
    url.pathname.startsWith('/icon-') ||
    url.pathname === '/apple-icon.png' ||
    url.pathname === '/icon.png' ||
    url.pathname === '/advottic-mark.png' ||
    url.pathname === '/advottic-logo.png' ||
    url.pathname === '/manifest.webmanifest';

  if (!isStatic) return; // network handles it

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // Only cache successful basic responses.
          if (!res || res.status !== 200 || res.type !== 'basic') return res;
          const copy = res.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => cached);
    }),
  );
});
