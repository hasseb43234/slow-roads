/* Calm Road service worker: instant repeat visits and offline start.
   - HTML: network first (so a new deploy shows up immediately), cache as the offline fallback.
   - Versioned files (css/js/img ?v=N): cache first, they never change for a given version.
   - three.js from the CDN: cache first.
   Bump V together with the ?v= numbers in index.html (run: node bump.cjs 4). */
const V = '4';
const CACHE = 'calm-road-v' + V;
const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const FILES = ['css/style.css', 'js/util.js', 'js/scenes.js', 'js/cars.js', 'js/world.js', 'js/airport.js', 'js/audio.js', 'js/game.js', 'img/logo.png'];
const CORE = ['./', 'index.html'].concat(FILES.map((f) => f + '?v=' + V));

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(CORE.map((u) => c.add(u)).concat(c.add(new Request(THREE_URL, { mode: 'no-cors' }))))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const ours = url.origin === self.location.origin;
  if (!ours && req.url !== THREE_URL) return;
  const isPage = ours && (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html'));
  if (isPage) {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })
      .catch(() => caches.match(req).then((r) => r || caches.match('index.html'))));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
