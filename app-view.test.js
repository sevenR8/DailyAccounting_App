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
  assert.match(appSource, /day\.key\.replaceAll\('-', '\/'\)/);
  assert.match(appSource, /formatEntryTime\(entry\.occurred_at\)/);
});

test('登入後頂部只保留使用者縮寫與可展開的帳號選單', () => {
  assert.match(appSource, /class="user-avatar"/);
  assert.match(appSource, /<details class="user-menu">/);
  assert.match(appSource, /class="user-menu-popover"/);
  assert.doesNotMatch(appSource, /<section class="welcome-panel">/);
  assert.doesNotMatch(appSource, /<section class="category-panel">/);
});

test('本期摘要以乾淨文字顯示收入、現金、信用卡、總開銷、固定開銷及可存額', () => {
  assert.match(appSource, /本期收入/);
  assert.match(appSource, /<span>現金<\/span>/);
  assert.match(appSource, /<span>信用卡<\/span>/);
  assert.match(appSource, /<span>總開銷<\/span>/);
  assert.doesNotMatch(appSource, /非固定/);
  assert.match(appSource, /本期固定開銷/);
  assert.match(appSource, /本期可存額/);
  assert.match(appSource, /待輸入帳單/);
});

test('桌面版使用多欄一頁式總覽，手機版仍維持單欄', () => {
  assert.match(stylesSource, /@media \(min-width: 900px\)[\s\S]*grid-template-areas/);
  assert.match(stylesSource, /@media \(min-width: 1240px\)[\s\S]*"chart quick finance"/);
  assert.match(stylesSource, /grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
});

test('手機版打開先顯示快速記帳與近期紀錄，並移除佔空間的大標題', () => {
  assert.doesNotMatch(appSource, /<h2>新增一筆開銷<\/h2>/);
  assert.match(stylesSource, /@media \(max-width: 899px\)/);
  assert.match(stylesSource, /\.quick-entry-panel \{ order: -20;/);
  assert.match(stylesSource, /\.history-panel \{ order: -10;/);
});

test('手機版底部提供記帳、總覽與帳務三個快速跳轉入口', () => {
  assert.match(appSource, /class="mobile-bottom-nav"/);
  assert.match(appSource, /data-mobile-nav="record"/);
  assert.match(appSource, /data-mobile-nav="overview"/);
  assert.match(appSource, /data-mobile-nav="finance"/);
  assert.match(appSource, /scrollIntoView/);
  assert.match(stylesSource, /\.mobile-bottom-nav/);
  assert.match(stylesSource, /env\(safe-area-inset-bottom\)/);
});

test('手機版在頁面頂端下拉可重新取得最新頁面與帳務資料', () => {
  assert.match(appSource, /class="mobile-pull-refresh"/);
  assert.match(appSource, /下拉更新/);
  assert.match(appSource, /touchstart/);
  assert.match(appSource, /touchmove/);
  assert.match(appSource, /touchend/);
  assert.match(appSource, /window\.location\.reload\(\)/);
  assert.match(stylesSource, /\.mobile-pull-refresh/);
});

test('快速記帳會依金額顯示常用歷史範本並一鍵帶入所有欄位', () => {
  assert.match(appSource, /buildExpenseTemplates/);
  assert.match(appSource, /findExpenseTemplates/);
  assert.match(appSource, /class="smart-suggestions"/);
  assert.match(appSource, /data-quick-template-index/);
  assert.match(appSource, /點一下自動帶入/);
  assert.match(stylesSource, /\.smart-suggestions/);
});

test('快速記帳時間每五分鐘更新，手動修改後不會被覆蓋', () => {
  assert.match(appSource, /const EXPENSE_TIME_REFRESH_INTERVAL = 5 \* 60 \* 1000;/);
  assert.match(appSource, /expenseOccurredAtInput\.addEventListener\('input',[\s\S]*expenseOccurredAtManuallyEdited = true;/);
  assert.match(
    appSource,
    /window\.setInterval\(\s*syncExpenseOccurredAt,\s*EXPENSE_TIME_REFRESH_INTERVAL,?\s*\)/,
  );
  assert.match(appSource, /if \(expenseOccurredAtManuallyEdited\) return;/);
  assert.match(appSource, /window\.clearInterval\(expenseTimeRefreshTimer\)/);
});

test('上方可切換帳務月份並顯示與前一個月的開銷比較', () => {
  assert.match(appSource, /class="period-navigation"/);
  assert.match(appSource, /data-period-direction="previous"/);
  assert.match(appSource, /data-period-direction="next"/);
  assert.match(appSource, /class="period-comparison/);
  assert.match(appSource, /compareExpenseTotals/);
  assert.match(appSource, /較上月/);
  assert.match(stylesSource, /\.period-switcher/);
  assert.match(stylesSource, /\.period-comparison/);
});

test('每筆固定開銷都能安全刪除且不移除既有歷史', () => {
  assert.match(appSource, /class="fixed-rule-row"/);
  assert.match(appSource, /data-action="delete-fixed-expense"/);
  assert.match(appSource, /刪除這筆固定開銷/);
  assert.match(appSource, /已產生的歷史紀錄會保留/);
  assert.match(appSource, /deleteFixedExpenseRule/);
});

test('固定開銷點開後可編輯所有欄位並儲存本期與未來設定', () => {
  assert.match(appSource, /class="fixed-edit-form"/);
  assert.match(appSource, /name="itemName"/);
  assert.match(appSource, /name="amount"/);
  assert.match(appSource, /name="scheduledDay"/);
  assert.match(appSource, /name="categoryId"/);
  assert.match(appSource, /name="paymentMethod"/);
  assert.match(appSource, /updateFixedExpenseRule/);
  assert.match(appSource, /syncFixedExpenseEntry/);
  assert.match(stylesSource, /\.fixed-edit-form/);
});

test('每日一般開銷可開啟編輯視窗修改、刪除或複製', () => {
  assert.match(appSource, /data-action="open-expense-edit"/);
  assert.match(appSource, /class="expense-edit-form"/);
  assert.match(appSource, /data-action="duplicate-expense"/);
  assert.match(appSource, /updateExpenseEntry/);
  assert.match(stylesSource, /\.expense-edit-form/);
});

test('收入與固定開銷平時只顯示摘要，點擊後才開啟輸入或刪除視窗', () => {
  assert.match(appSource, /class="income-overview-card"/);
  assert.match(appSource, /本期收入合計/);
  assert.match(appSource, /薪資收入/);
  assert.match(appSource, /其他收入/);
  assert.match(appSource, /data-action="open-income-dialog"/);
  assert.match(appSource, /<dialog class="finance-dialog" id="income-dialog">/);
  assert.match(appSource, /data-action="open-fixed-rule-dialog"/);
  assert.match(appSource, /data-action="open-fixed-expense"/);
  assert.match(appSource, /<dialog class="finance-dialog fixed-detail-dialog"/);
  assert.match(stylesSource, /\.finance-dialog::backdrop/);
});

test('儲存本期薪水時直接沿用為未來週期預設，不再顯示第二組薪水設定', () => {
  assert.doesNotMatch(appSource, /id="default-salary-form"/);
  assert.doesNotMatch(appSource, /name="defaultSalaryAmount"/);
  assert.match(appSource, /const updatedSalaryAmount = Number\(formData\.get\('salaryAmount'\)\)/);
  assert.match(appSource, /updateFinancialSettings\(\{[\s\S]*defaultSalaryAmount: updatedSalaryAmount/);
});

test('本月信用卡繳納顯示在收入與固定開銷之間，並使用上期實際帳單', () => {
  const incomeIndex = appSource.indexOf('class="income-overview-section"');
  const cardBillIndex = appSource.indexOf('class="card-bill-overview-section"');
  const fixedIndex = appSource.indexOf('class="fixed-overview-section"');

  assert.ok(incomeIndex >= 0 && incomeIndex < cardBillIndex && cardBillIndex < fixedIndex);
  assert.match(appSource, /本月信用卡繳納/);
  assert.match(appSource, /previous_card_bill_amount/);
  assert.match(appSource, /上期實際帳單/);
  assert.match(appSource, /待輸入上期實際帳單/);
  assert.match(stylesSource, /\.credit-card-payment-card/);
});

test('近期紀錄按日折疊，關閉時顯示當日現金與信用卡合計', () => {
  assert.match(appSource, /groupExpenseEntriesByDay/);
  assert.match(appSource, /class="day-expense-group"/);
  assert.match(appSource, /class="day-expense-summary"/);
  assert.match(appSource, /day\.cashTotal/);
  assert.match(appSource, /day\.creditCardTotal/);
  assert.match(appSource, /day\.total/);
  assert.match(appSource, /<small>總開銷<\/small>/);
  assert.match(appSource, /day\.entries\.map/);
  assert.match(stylesSource, /\.day-expense-summary/);
});

test('手機近期紀錄完整顯示日期且總開銷依門檻套用顏色', () => {
  assert.match(appSource, /dailyExpenseTotalTone/);
  assert.match(appSource, /total-\$\{dailyExpenseTotalTone\(day\.total\)\}/);
  assert.match(appSource, /day\.key\.replaceAll\('-', '\/'\)/);
  assert.match(stylesSource, /\.day-total\.total-white/);
  assert.match(stylesSource, /\.day-total\.total-green/);
  assert.match(stylesSource, /\.day-total\.total-blue/);
  assert.match(stylesSource, /\.day-total\.total-red/);
  assert.match(stylesSource, /grid-auto-rows: max-content/);
});

test('展開每日紀錄後，每筆開銷右側提供垃圾桶刪除按鈕', () => {
  assert.match(appSource, /class="expense-entry-delete"/);
  assert.match(appSource, /data-action="delete-expense"/);
  assert.match(appSource, /aria-label="刪除開銷/);
  assert.match(appSource, /deleteExpenseEntry/);
  assert.match(stylesSource, /\.expense-entry-delete/);
});
