/* ============================================================
   KHAAN NETRA - Service Worker
   Caches app shell + vendor libraries + model weights for full
   offline capability. Uses cache-first strategy for static
   assets, network-first for model weights (then cached).
   ============================================================ */
const CACHE_NAME = 'khaan-netra-v3';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/index.css',
  './css/dashboard.css',
  './css/cv-scanner.css',
  './js/app.js',
  './js/cv-scanner.js',
  './js/dashboard.js',
  './js/data-store.js',
  './js/compliance.js',
  './js/identification.js',
  './lib/tf.min.js',
  './lib/chart.umd.min.js',
  './lib/coco-ssd.min.js',
  './lib/chart.umd.min.js',
];

// Google Fonts URLs to cache on first load
const FONT_URLS = [
  'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
];

/* ---------- Install ---------- */

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Caching app shell');
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

/* ---------- Activate ---------- */

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

/* ---------- Fetch ---------- */

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Model weights from tfhub/Google Storage - cache on first load (network-first)
  if (url.hostname.includes('tfhub.dev') ||
      url.hostname.includes('storage.googleapis.com') ||
      url.hostname.includes('kaggle.com') ||
      url.pathname.includes('/model.json') ||
      url.pathname.endsWith('.bin')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        fetch(event.request)
          .then(response => {
            if (response.ok) {
              cache.put(event.request, response.clone());
            }
            return response;
          })
          .catch(() => cache.match(event.request))
      )
    );
    return;
  }

  // Google Fonts - cache-first after first load
  if (url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => new Response('', { status: 503 }));
      })
    );
    return;
  }

  // App shell and local assets - cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache any successful local requests
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Fallback to index.html for SPA routing
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});
