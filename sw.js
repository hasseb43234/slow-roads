/* Calm Road service worker: makes repeat visits instant and lets the game start offline.
   Strategy: stale-while-revalidate for the game files and the three.js CDN script.
   Bump CACHE when you want every visitor to drop old files immediately. */
const CACHE = 'calm-road-v1';
const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const CORE = ['./', 'index.html', 'css/style.css', 'js/util.js', 'js/scenes.js', 'js/cars.js', 'js/world.js', 'js/airport.js', 'js/audio.js', 'js/game.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled([...CORE.map((u) => c.add(u)), c.add(new Request(THREE_URL, { mode: 'no-cors' }))])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const ours = url.origin === self.location.origin, three = req.url === THREE_URL;
  if (!ours && !three) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(req, { ignoreSearch: false });
    const net = fetch(req).then((res) => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
