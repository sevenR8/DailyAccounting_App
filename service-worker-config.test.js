import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const serviceWorker = await readFile(new URL('./service-worker.js', import.meta.url), 'utf8');
const indexHtml = await readFile(new URL('./index.html', import.meta.url), 'utf8');

test('首頁與設定檔使用同一份完整版本快取', () => {
  assert.match(serviceWorker, /daily-ledger-shell-v\d+/);
  assert.match(serviceWorker, /daily-ledger-shell-v154/);
  assert.match(serviceWorker, /\.\/amount-expression\.js/);
  assert.match(serviceWorker, /\.\/expense-analysis\.js/);
  assert.match(serviceWorker, /\.\/expense-advance\.js/);
  assert.match(serviceWorker, /\/app\.js/);
  assert.match(serviceWorker, /\/daily-history\.js/);
  assert.match(serviceWorker, /\/accounting-period\.js/);
  assert.match(serviceWorker, /caches\.keys\(\)[\s\S]*caches\.delete\(cacheName\)/);
  assert.match(serviceWorker, /\.\/config\.js\?v=1/);
  assert.match(indexHtml, /config\.js\?v=1/);
});

test('冷啟動的首頁和程式檔優先回傳快取，不等待網路', async () => {
  const listeners = new Map();
  const cachedResponse = { source: 'cache' };
  let fetchCount = 0;
  const cache = { match: async () => cachedResponse };
  runInNewContext(serviceWorker, {
    URL,
    caches: { open: async () => cache },
    fetch: async () => { fetchCount += 1; throw new Error('network should not be needed'); },
    self: {
      location: { origin: 'https://example.test' },
      addEventListener: (name, handler) => listeners.set(name, handler),
    },
  });

  for (const path of ['/', '/app.js?v=147', '/config.js?v=1']) {
    let result;
    listeners.get('fetch')({
      request: { method: 'GET', mode: path === '/' ? 'navigate' : 'same-origin', url: `https://example.test${path}` },
      respondWith: (promise) => { result = promise; },
    });
    assert.equal(await result, cachedResponse);
  }
  assert.equal(fetchCount, 0);
});

test('新版 PWA 會先完成快取再接管，且不強制重新導向既有頁面', () => {
  assert.match(
    serviceWorker,
    /event\.waitUntil\(\s*caches\.open\(CACHE_NAME\)[\s\S]*cache\.addAll\(APP_SHELL\)[\s\S]*self\.skipWaiting\(\)/,
  );
  assert.doesNotMatch(serviceWorker, /client\.navigate\(client\.url\)/);
});

test('新版在背景更新，下次開啟生效，不中斷當前記帳', () => {
  assert.doesNotMatch(indexHtml, /window\.location\.reload\(\)/);
  assert.match(indexHtml, /updateViaCache:\s*'none'/);
  assert.match(indexHtml, /service-worker\.js\?v=154/);
  assert.match(indexHtml, /<main class="ledger-resume"/);
});
