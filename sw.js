const CACHE_NAME = 'qr-cdp-cache-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/crypto-drbg.js',
  '/cv-processor.js',
  '/manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Gunakan strategi Network-First untuk mempermudah pembaruan kode riset secara real-time
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        // Simpan salinan terbaru ke cache
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, clone);
        });
        return response;
      })
      .catch(() => {
        // Jika offline, ambil dari cache
        return caches.match(e.request);
      })
  );
});
