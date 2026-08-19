import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const serviceWorker = await readFile(new URL('./service-worker.js', import.meta.url), 'utf8');

test('已部署的設定檔優先從網路讀取，避免舊快取卡住連線設定', () => {
  assert.match(serviceWorker, /daily-ledger-shell-v32/);
  assert.match(serviceWorker, /\/app\.js/);
  assert.match(serviceWorker, /\/daily-history\.js/);
  assert.match(serviceWorker, /\/accounting-period\.js/);
  assert.match(serviceWorker, /fetch\(request\)[\s\S]*caches\.open\(CACHE_NAME\)/);
});

