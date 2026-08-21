const CACHE_NAME = 'daily-ledger-shell-v68';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=68',
  './app.js?v=68',
  './amount-expression.js',
  './expense-analysis.js?v=59',
  './expense-advance.js?v=56',
  './ledger-module.js',
  './financial-summary.js',
  './daily-history.js',
  './accounting-period.js',
  './supabase-adapter.js?v=68',
  './config.js',
  './manifest.webmanifest',
  './icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    const hadPreviousShell = cacheNames.some(
      (cacheName) => cacheName.startsWith('daily-ledger-shell-') && cacheName !== CACHE_NAME,
    );
    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith('daily-ledger-shell-') && cacheName !== CACHE_NAME)
        .map((cacheName) => caches.delete(cacheName)),
    );
    await self.clients.claim();
    if (!hadPreviousShell) return;
    const openClients = await self.clients.matchAll({ type: 'window' });
    await Promise.all(openClients.map((client) => client.navigate(client.url).catch(() => null)));
  })());
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
