import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const stylesSource = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const indexSource = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const baseStyles = stylesSource.split('@media (max-width: 899px)')[0];

test('桌面近期紀錄的每一天維持完整內容高度，不會因資料筆數增加而被壓扁', () => {
  assert.match(
    baseStyles,
    /\.history-panel\s*\{[^}]*grid-auto-rows:\s*max-content;[^}]*align-content:\s*start;/s,
  );
});

test('手機日期時間欄位會縮入卡片寬度內', () => {
  assert.match(
    stylesSource,
    /input\[type=['"]datetime-local['"]\]\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s,
  );
});

test('手機版停用雙指縮放', () => {
  assert.match(indexSource, /maximum-scale=1/);
  assert.match(indexSource, /user-scalable=no/);
  assert.match(appSource, /gesturestart/);
  assert.match(appSource, /event\.preventDefault\(\)/);
});

test('桌面快速記帳的日期時間欄位獨占整列，完整保留日期、時間與行事曆按鈕', () => {
  assert.match(
    appSource,
    /<label class="expense-datetime-field">日期與時間[\s\S]*id="expense-occurred-at"/,
  );
  assert.match(
    stylesSource,
    /@media \(min-width: 900px\)[\s\S]*\.expense-form \.expense-datetime-field\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/,
  );
});

test('手機快速記帳的日期時間與金額欄位共用同一個受限單欄寬度', () => {
  assert.match(
    baseStyles,
    /\.expense-form\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*width:\s*100%;[^}]*min-width:\s*0;/s,
  );
});
