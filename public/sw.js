// Scatterboard service worker. Navigations go network-first so deploys
// propagate immediately; every same-origin GET then gets a runtime
// cache entry so the app keeps working fully offline. Hashed Vite
// assets are safe to cache forever. CACHE tracks the build version
// passed on the registration URL, so each deploy busts old entries.
const CACHE = 'scatterboard-' + (self.location.search.match(/v=([^&]+)/)?.[1] || 'v3');

self.addEventListener('install', (e) => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const put = (res) => {
    if (res.ok) {
      const copy = res.clone();
      void caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  };
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(put).catch(() => caches.match(req, { ignoreSearch: true }).then((h) => h || caches.match('./index.html'))));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then(put)));
});
