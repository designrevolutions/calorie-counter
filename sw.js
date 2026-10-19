// Offline cache for the app shell. Bump VERSION (and the ?v= in index.html) when shipping changes.
const VERSION = 'tally-v3';
const ASSETS = ['./', 'index.html', 'styles.css?v=3', 'app.js?v=3', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-maskable.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first, revalidating with the server (bypassing a stale HTTP cache) so updates show up
// immediately; fall back to the offline cache when there's no connection.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  const fresh = e.request.mode === 'navigate'
    ? fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })
    : fetch(new Request(e.request, { cache: 'no-cache' }));
  e.respondWith(
    fresh
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});
