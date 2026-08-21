import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const serviceWorker = await readFile(new URL('./service-worker.js', import.meta.url), 'utf8');

test('已部署的設定檔優先從網路讀取，避免舊快取卡住連線設定', () => {
  assert.match(serviceWorker, /daily-ledger-shell-v\d+/);
  assert.match(serviceWorker, /\.\/amount-expression\.js/);
  assert.match(serviceWorker, /\.\/expense-analysis\.js/);
  assert.match(serviceWorker, /\.\/expense-advance\.js/);
  assert.match(serviceWorker, /\/app\.js/);
  assert.match(serviceWorker, /\/daily-history\.js/);
  assert.match(serviceWorker, /\/accounting-period\.js/);
  assert.match(serviceWorker, /caches\.keys\(\)[\s\S]*caches\.delete\(cacheName\)/);
  assert.match(serviceWorker, /fetch\(request\)[\s\S]*caches\.open\(CACHE_NAME\)/);
});

test('新版 PWA 會先完成快取再接管，且不強制重新導向既有頁面', () => {
  assert.match(
    serviceWorker,
    /event\.waitUntil\(\s*caches\.open\(CACHE_NAME\)[\s\S]*cache\.addAll\(APP_SHELL\)[\s\S]*self\.skipWaiting\(\)/,
  );
  assert.doesNotMatch(serviceWorker, /client\.navigate\(client\.url\)/);
});
