// Offline support. Network first (so updates show up on the next launch), with the
// cached copy used when offline or when the network is too slow.
// Bump VERSION whenever app files change; Settings shows it.
const VERSION = 'gymlog-v14';
const NETWORK_TIMEOUT_MS = 4000;
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/main.js',
  'js/db.js',
  'js/logic.js',
  'js/seed.js',
  'js/timer.js',
  'js/chart.js',
  'js/ui.js',
  'js/views/body.js',
  'js/views/routines.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' bypasses the HTTP cache so a new version never stores stale files.
  event.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function fetchWithTimeout(url) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS);
    // no-cache: always revalidate with the server (cheap 304 when unchanged).
    fetch(url, { cache: 'no-cache', credentials: 'same-origin' })
      .then((res) => { clearTimeout(timer); resolve(res); }, (err) => { clearTimeout(timer); reject(err); });
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await fetchWithTimeout(req.url);
      if (res.ok) await cache.put(req.url, res.clone());
      return res;
    } catch {
      const cached = await cache.match(req, { ignoreSearch: true })
        || (req.mode === 'navigate' ? await cache.match('index.html') : null);
      return cached || Response.error();
    }
  })());
});
