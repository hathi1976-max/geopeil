/* GeoPeil Service Worker
   Strategie: network-first für die eigene App (damit Updates sofort ankommen),
   Cache dient nur als Offline-Fallback. Externe Daten (Overpass/OSM) nie cachen. */
const CACHE = 'geopeil-v3';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-maskable.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Overpass & Karten immer live aus dem Netz
  if (url.hostname.includes('overpass') || url.hostname.includes('openstreetmap')) return;

  // Eigene App: network-first, bei Offline aus dem Cache
  if (url.origin === self.location.origin){
    e.respondWith(
      fetch(e.request)
        .then(resp => {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(()=>{});
          return resp;
        })
        .catch(() => caches.match(e.request).then(hit => hit || caches.match('./index.html')))
    );
  }
});
