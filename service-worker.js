const CACHE_NAME = 'daily-ledger-shell-v153';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=141',
  './app.js?v=146',
  './amount-expression.js?v=45',
  './expense-analysis.js?v=61',
  './annual-forecast.js?v=9',
  './expense-advance.js?v=58',
  './ledger-module.js',
  './financial-summary.js?v=48',
  './daily-history.js?v=46',
  './accounting-period.js?v=46',
  './supabase-adapter.js?v=83',
  './config.js?v=1',
  './manifest.webmanifest',
  './icon.svg',
];

self.addEventListener('install', (event) => {
  // Do not activate until the complete shell is cached. Activating while the
  // app is still installing can leave the first page load with half the shell.
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith('daily-ledger-shell-') && cacheName !== CACHE_NAME)
        .map((cacheName) => caches.delete(cacheName)),
    );
    await self.clients.claim();
  })());
});

async function shellCacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) return cachedResponse;

  // A missing shell asset still loads normally; only a complete install is
  // allowed to replace the current versioned cache on the next launch.
  return fetch(request);
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const pathname = url.pathname;
  if (url.origin === self.location.origin && (event.request.mode === 'navigate' || pathname === '/' || [
    '/index.html',
    '/styles.css',
    '/app.js',
    '/expense-analysis.js',
    '/annual-forecast.js',
    '/expense-advance.js',
    '/ledger-module.js',
    '/financial-summary.js',
    '/daily-history.js',
    '/accounting-period.js',
    '/supabase-adapter.js',
    '/config.js',
  ].some((path) => pathname.endsWith(path)))) {
    event.respondWith(shellCacheFirst(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => cachedResponse || fetch(event.request)),
  );
});
