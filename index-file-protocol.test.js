import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const indexHtml = await readFile(new URL('./index.html', import.meta.url), 'utf8');

test('直接以檔案方式開啟時會顯示啟動說明，而不是留下空白畫面', () => {
  assert.match(indexHtml, /window\.location\.protocol === 'file:'/);
  assert.match(indexHtml, /請改用網站網址開啟/);

  const script = indexHtml.match(
    /<script>\s*(if \(window\.location\.protocol === 'file:'\)[\s\S]*?)<\/script>/,
  )?.[1];
  assert.ok(script, '應有能在 file:// 環境執行的啟動說明');

  const app = { innerHTML: '' };
  new Function('window', 'document', script)(
    { location: { protocol: 'file:' } },
    { querySelector: () => app },
  );

  assert.match(app.innerHTML, /請改用網站網址開啟/);
});

test('啟動時使用版本化資源，讓舊離線快取能取得新版登入畫面', () => {
  assert.match(indexHtml, /src="\.\/app\.js\?v=6"/);
  assert.match(indexHtml, /register\('\.\/service-worker\.js\?v=6'\)/);
});

