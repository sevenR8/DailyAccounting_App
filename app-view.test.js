import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('./app.js', import.meta.url), 'utf8');

test('本期總覽包含分類圓餅圖與各分類占比', () => {
  assert.match(appSource, /class="expense-pie"/);
  assert.match(appSource, /本期開銷分類占比/);
  assert.match(appSource, /category\.amount \/ expenseTotal/);
});

test('近期紀錄清楚顯示每筆開銷的日期與時間', () => {
  assert.match(appSource, /class="entry-date"/);
  assert.match(appSource, /<time datetime=/);
  assert.match(appSource, /formatEntryDate\(entry\.occurred_at\)/);
  assert.match(appSource, /formatEntryTime\(entry\.occurred_at\)/);
});

