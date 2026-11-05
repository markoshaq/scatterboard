// Scatterboard service worker. Navigations go network-first so deploys
// propagate immediately; every same-origin GET then gets a runtime
// cache entry so the app keeps working fully offline. CACHE tracks the
// build version passed on the registration URL, so each deploy busts
// old entries.
const CACHE = 'scatterboard-' + (self.location.search.match(/v=([^&]+)/)?.[1] || 'v3');

// Precached at install: the document shell (both spellings, since cache
// keys match on URL), the manifest/icons, and the vendored sqlite
// worker+wasm the doc store needs.
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './jswasm/sqlite3-worker1.mjs',
  './jswasm/sqlite3.wasm',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

// Hashed Vite assets are too volatile to name in PRECACHE, so activate
// walks them: index.html names the entry chunks, and every fetched js
// names its lazy siblings as "./name-hash.js" strings. A fully cached
// bundle means even a first-visit-then-offline launch works.
const CHUNK = /[\w.-]+-[A-Za-z0-9_-]{8}\.(?:js|css)/g;

async function warmAll(cache) {
  const seen = new Set();
  const warm = async (rel) => {
    const url = new URL(rel, self.registration.scope).href;
    if (seen.has(url)) return;
    seen.add(url);
    const res = await fetch(url).catch(() => null);
    if (!res?.ok) return;
    await cache.put(url, res.clone());
    if (!/\.(?:html|js)$/.test(new URL(url).pathname)) return;
    const text = await res.text();
    const names = text.match(CHUNK) ?? [];
    await Promise.all([...new Set(names)].map((n) => warm(`./assets/${n}`)));
  };
  await Promise.all(PRECACHE.map(warm));
}

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => warmAll(c))
      .catch(() => {})
      .then(() =>
        caches
          .keys()
          .then((keys) => Promise.all(keys.filter((k) => k.startsWith('scatterboard-') && k !== CACHE).map((k) => caches.delete(k))))
          .then(() => self.clients.claim()),
      ),
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
