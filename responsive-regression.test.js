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

test('iOS 日期時間欄位由受限外框提供寬度，原生控制不再以內距撐破卡片', () => {
  assert.match(
    appSource,
    /<span class="expense-datetime-control">[\s\S]*id="expense-occurred-at"[\s\S]*<\/span>/,
  );
  assert.match(
    stylesSource,
    /\.expense-datetime-control\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*overflow:\s*hidden;[^}]*padding:\s*13px;/s,
  );
  assert.match(
    stylesSource,
    /\.expense-datetime-control input\[type="datetime-local"\]\s*\{[^}]*width:\s*100%;[^}]*border:\s*0;[^}]*padding:\s*0;/s,
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

test('手機分類總覽的標題與日期保持完整單行，帳務期間不顯示星期', () => {
  assert.match(stylesSource, /\.chart-heading\s*\{[^}]*flex-wrap:\s*wrap;/s);
  assert.match(stylesSource, /\.chart-heading h2\s*\{[^}]*white-space:\s*nowrap;/s);
  assert.match(stylesSource, /\.chart-heading > span\s*\{[^}]*white-space:\s*nowrap;/s);
  assert.match(appSource, /function formatPeriodDate\(value\)/);
  assert.match(
    appSource,
    /const periodLabel = `\$\{formatPeriodDate\(periodStart\)\}－\$\{formatPeriodDate\(new Date\(periodEnd\.getTime\(\) - 1\)\)\}`;/,
  );
});

test('手機帳務摘要依左欄再右欄的順序排列六項金額', () => {
  assert.match(
    stylesSource,
    /@media \(max-width: 899px\)[\s\S]*\.summary-panel\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[^}]*grid-template-rows:\s*repeat\(3,\s*minmax\(0,\s*auto\)\);[^}]*grid-auto-flow:\s*column;/,
  );
  assert.match(
    appSource,
    /<section class="summary-panel"[\s\S]*本期收入[\s\S]*現金[\s\S]*信用卡[\s\S]*總開銷[\s\S]*本期固定開銷[\s\S]*本期可存額[\s\S]*<\/section>/,
  );
});
