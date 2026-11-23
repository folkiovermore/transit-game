/* Caches the game itself so it opens fast and can be installed. Map tiles always come from the network. */
const CACHE = 'transit-game-v51';
const FILES = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'js/storage.js', 'js/routing.js', 'js/sim.js', 'js/goals.js', 'js/osm.js', 'js/game.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req))
  );
});
