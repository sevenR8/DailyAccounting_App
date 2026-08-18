import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const stylesSource = await readFile(new URL('./styles.css', import.meta.url), 'utf8');

test('本期總覽包含分類圓餅圖與各分類占比', () => {
  assert.match(appSource, /class="expense-pie"/);
  assert.match(appSource, /本期開銷分類占比/);
  assert.match(appSource, /category\.amount \/ generatedExpenseTotal/);
});

test('近期紀錄清楚顯示每筆開銷的日期與時間', () => {
  assert.match(appSource, /class="entry-date"/);
  assert.match(appSource, /<time datetime=/);
  assert.match(appSource, /formatEntryDate\(entry\.occurred_at\)/);
  assert.match(appSource, /formatEntryTime\(entry\.occurred_at\)/);
});

test('登入後頂部只保留使用者縮寫與可展開的帳號選單', () => {
  assert.match(appSource, /class="user-avatar"/);
  assert.match(appSource, /<details class="user-menu">/);
  assert.match(appSource, /class="user-menu-popover"/);
  assert.doesNotMatch(appSource, /<section class="welcome-panel">/);
  assert.doesNotMatch(appSource, /<section class="category-panel">/);
});

test('本期摘要顯示收入、非固定現金與信用卡、固定開銷及可存額', () => {
  assert.match(appSource, /本期收入/);
  assert.match(appSource, /非固定現金/);
  assert.match(appSource, /非固定信用卡/);
  assert.match(appSource, /本期固定開銷/);
  assert.match(appSource, /本期可存額/);
  assert.match(appSource, /待輸入帳單/);
});

test('桌面版使用多欄一頁式總覽，手機版仍維持單欄', () => {
  assert.match(stylesSource, /@media \(min-width: 900px\)[\s\S]*grid-template-areas/);
  assert.match(stylesSource, /@media \(min-width: 1240px\)[\s\S]*"chart quick finance"/);
  assert.match(stylesSource, /grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
});

