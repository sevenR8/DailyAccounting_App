const CACHE_NAME = 'daily-ledger-shell-v47';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=47',
  './app.js',
  './amount-expression.js',
  './expense-analysis.js',
  './expense-advance.js',
  './ledger-module.js',
  './financial-summary.js',
  './daily-history.js',
  './accounting-period.js',
  './supabase-adapter.js',
  './config.js',
  './manifest.webmanifest',
  './icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith('daily-ledger-shell-') && cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName)),
      )),
      self.clients.claim(),
    ]),
  );
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) return cachedResponse;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const pathname = new URL(event.request.url).pathname;
  if (pathname === '/' || [
    '/index.html',
    '/styles.css',
    '/app.js',
    '/expense-analysis.js',
    '/expense-advance.js',
    '/ledger-module.js',
    '/financial-summary.js',
    '/daily-history.js',
    '/accounting-period.js',
    '/supabase-adapter.js',
    '/config.js',
  ].some((path) => pathname.endsWith(path))) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => cachedResponse || fetch(event.request)),
  );
});
