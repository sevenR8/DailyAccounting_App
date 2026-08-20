import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const stylesSource = await readFile(new URL('./styles.css', import.meta.url), 'utf8');

test('本期總覽包含分類圓餅圖與各分類占比', () => {
  assert.match(appSource, /class="expense-pie"/);
  assert.match(appSource, /本期開銷分類占比/);
  assert.match(appSource, /category\.amount \/ personalGeneratedExpenseTotal/);
  assert.match(
    appSource,
    /\.filter\(\(category\) => category\.amount > 0\)\s*\.sort\(\(left, right\) => right\.amount - left\.amount\)/,
  );
});

test('新增自訂分類後前十六個分類仍使用不重複的圓餅圖顏色', () => {
  const paletteSource = appSource.match(/const chartColors = \[([^\]]+)\]/)?.[1] ?? '';
  const chartColors = Array.from(
    paletteSource.matchAll(/'([^']+)'/g),
    (match) => match[1],
  );

  assert.ok(chartColors.length >= 16, '圓餅圖至少需要十六個分類色');
  assert.equal(new Set(chartColors.slice(0, 16)).size, 16, '前十六個分類色不可重複');
});

test('開銷紀錄清楚顯示每筆開銷的日期與時間', () => {
  assert.match(appSource, /class="entry-date"/);
  assert.match(appSource, /<time datetime=/);
  assert.match(appSource, /day\.key\.replaceAll\('-', '\/'\)/);
  assert.match(appSource, /formatEntryTime\(entry\.occurred_at\)/);
});

test('開銷紀錄移除大型標題，並可記住顯示最近 5、10、15 天或全部', () => {
  assert.match(appSource, /<p class="eyebrow">開銷紀錄<\/p>/);
  assert.doesNotMatch(appSource, /<h2>近期紀錄<\/h2>/);
  assert.match(appSource, /HISTORY_DISPLAY_LIMIT_OPTIONS = \['5', '10', '15', 'all'\]/);
  assert.match(appSource, /daily-ledger-history-display-limit/);
  assert.match(appSource, /id="history-display-limit"/);
  assert.match(appSource, /最近 5 天/);
  assert.match(appSource, /最近 10 天/);
  assert.match(appSource, /最近 15 天/);
  assert.match(appSource, />全部</);
  assert.match(appSource, /row\.hidden = limit !== 'all' && index >= Number\(limit\)/);
  assert.match(stylesSource, /\.history-heading/);
  assert.match(stylesSource, /\.history-list/);
});

test('登入後頂部只保留使用者縮寫與可展開的帳號選單', () => {
  assert.match(appSource, /class="user-avatar"/);
  assert.match(appSource, /<details class="user-menu">/);
  assert.match(appSource, /class="user-menu-popover"/);
  assert.doesNotMatch(appSource, /<section class="welcome-panel">/);
  assert.doesNotMatch(appSource, /<section class="category-panel">/);
});

test('右上角選單可開啟帳本設定並管理自訂分類與週期起始日', () => {
  assert.match(appSource, /data-action="open-ledger-settings"/);
  assert.match(appSource, /id="ledger-settings-dialog"/);
  assert.match(appSource, /id="category-create-form"/);
  assert.match(appSource, /class="category-settings-form"/);
  assert.match(appSource, /createCategory/);
  assert.match(appSource, /updateCategory/);
  assert.match(appSource, /name="cycleStartDay"[^>]*min="1"[^>]*max="28"/);
  assert.match(appSource, /id="cycle-settings-form"/);
  assert.match(stylesSource, /\.settings-dialog/);
  assert.match(stylesSource, /\.category-settings-list/);
});

test('已保存登入狀態時直接顯示帳本啟動畫面，不會先閃過登入頁', () => {
  assert.match(appSource, /async function getAccessToken\(session = readSession\(\), \{ forceRefresh = false \} = \{\}\)/);
  assert.match(
    appSource,
    /async function bootstrap\(\)[\s\S]*const storedSession = readSession\(\);[\s\S]*if \(!storedSession\) \{[\s\S]*renderSignIn\(\);[\s\S]*return;[\s\S]*\}[\s\S]*renderLedgerResume\(\);[\s\S]*const accessToken = await getAccessToken\(storedSession\);/,
  );
  assert.doesNotMatch(appSource, /if \(!app\.firstElementChild\) renderSignIn\(\);/);
  assert.match(appSource, /class="ledger-resume"/);
  assert.doesNotMatch(appSource, />正在準備你的帳本</);
});

test('已登入重新開啟時先顯示可操作快取，再於背景同步雲端資料', () => {
  const bootstrapSource = appSource.slice(
    appSource.indexOf('async function bootstrap()'),
    appSource.indexOf('\nbootstrap();'),
  );
  const cachedViewReadIndex = bootstrapSource.indexOf(
    'const cachedLedgerView = readCachedLedgerView(storedSession);',
  );
  const tokenRefreshIndex = bootstrapSource.indexOf('await getAccessToken(storedSession)');

  assert.ok(cachedViewReadIndex >= 0, '應讀取前一次成功同步的帳本畫面');
  assert.ok(tokenRefreshIndex >= 0, '應保留登入憑證更新流程');
  assert.ok(
    cachedViewReadIndex < tokenRefreshIndex,
    '本機帳本畫面必須在等待網路前顯示',
  );
  assert.match(
    bootstrapSource,
    /if \(cachedLedgerView\)[\s\S]*viewData: cachedLedgerView\.viewData/,
  );
  assert.match(appSource, /function ledgerViewHasActiveDraft\(\)/);
  assert.match(
    bootstrapSource,
    /ledgerViewSyncBaseline = ledgerViewInteractionVersion/,
  );
  assert.match(
    bootstrapSource,
    /if \(!ledgerViewHasActiveDraft\(\)\)[\s\S]*viewData: freshViewData/,
  );
});

test('首次啟動時帳務週期、設定、固定開銷與歷史資料會並行讀取', () => {
  const loaderSource = appSource.slice(
    appSource.indexOf('async function loadLedgerViewData'),
    appSource.indexOf('async function renderLedger'),
  );

  assert.match(loaderSource, /const entriesPromise = expenseAdapter\.listExpenseEntries/);
  assert.match(
    loaderSource,
    /await Promise\.all\(\[[\s\S]*ensureCurrentAccountingPeriod[\s\S]*getFinancialSettings[\s\S]*listFixedExpenseRules/,
  );
});

test('所有帳務請求都能取得最新登入憑證且共用同一個刷新作業', () => {
  assert.match(appSource, /let accessTokenRefreshPromise = null;/);
  assert.match(appSource, /if \(!accessTokenRefreshPromise\)/);
  assert.match(appSource, /accessTokenProvider: \(\{ forceRefresh = false \} = \{\}\) => getAccessToken/);
  assert.match(appSource, /readSession\(\),\s*\{ forceRefresh \}/);
});

test('本期摘要以乾淨文字顯示收入、現金、信用卡、總開銷、固定開銷及可存額', () => {
  const summarySource = appSource.slice(
    appSource.indexOf('<section class="summary-panel"'),
    appSource.indexOf('${analysisPage}'),
  );
  assert.match(summarySource, /本期收入/);
  assert.match(summarySource, /<span>現金<\/span>/);
  assert.match(summarySource, /<span>信用卡<\/span>/);
  assert.match(summarySource, /<span>總開銷<\/span>/);
  assert.doesNotMatch(summarySource, /非固定/);
  assert.match(summarySource, /本期固定開銷/);
  assert.match(summarySource, /本期可存額/);
  assert.match(summarySource, /待輸入帳單/);
});

test('本期摘要保留代墊淨額計算但不加入註解小字或特殊金額顏色', () => {
  const summarySource = appSource.slice(
    appSource.indexOf('<section class="summary-panel"'),
    appSource.indexOf('${analysisPage}'),
  );
  assert.match(summarySource, /netCashOutflowTotal/);
  assert.match(summarySource, /personalNonFixedExpenseTotal/);
  assert.doesNotMatch(summarySource, /<small>/);
  assert.doesNotMatch(stylesSource, /\.net-cash-summary/);
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

test('手機摘要卡可開啟獨立帳務管理頁並保留桌面完整資訊', () => {
  assert.match(appSource, /data-action="open-mobile-finance"/);
  assert.match(appSource, /class="mobile-finance-heading"/);
  assert.match(appSource, /data-action="close-mobile-finance"/);
  assert.match(appSource, /data-mobile-view="\$\{preferredMobileView\}"/);
  assert.match(appSource, /const existingLedgerView = app\.querySelector\('\.ledger-home'\)\?\.dataset\.mobileView;/);
  assert.match(appSource, /\['finance', 'analysis'\]\.includes\(existingLedgerView\)/);
  assert.match(appSource, /ledgerHome\.dataset\.mobileView = 'finance'/);
  assert.match(appSource, /ledgerHome\.dataset\.mobileView = 'main'/);
  assert.match(
    stylesSource,
    /@media \(max-width: 899px\)[\s\S]*\.finance-panel\s*\{[^}]*display:\s*none;/,
  );
  assert.match(
    stylesSource,
    /\.ledger-home\[data-mobile-view="finance"\] > \.finance-panel\s*\{[^}]*display:\s*grid;/,
  );
  assert.match(stylesSource, /@media \(min-width: 900px\)[\s\S]*\.finance-panel \{ grid-area: finance; \}/);
});

test('整張圓餅圖卡片可開啟含七項分析的單一長頁', () => {
  assert.match(appSource, /data-action="open-analysis" role="button" tabindex="0"/);
  assert.match(appSource, /buildExpenseAnalysis\(\{/);
  assert.match(appSource, /class="analysis-page"/);
  assert.match(appSource, /01・生活全貌/);
  assert.match(appSource, /02・日常節奏/);
  assert.match(appSource, /03・主要去向/);
  assert.match(appSource, /04・生活尺度/);
  assert.match(appSource, /05・生活習慣/);
  assert.match(appSource, /06・消費心情/);
  assert.match(appSource, /07・前後變化/);
  assert.match(appSource, /ledgerHome\.dataset\.mobileView = 'analysis'/);
  assert.match(appSource, /data-action="close-analysis"/);
  assert.match(appSource, /animatedSurface: analysisPanel/);
});

test('分析內頁可切換帳務週期並使用文青風響應式卡片', () => {
  assert.match(appSource, /data-analysis-period-direction="previous"/);
  assert.match(appSource, /data-analysis-period-direction="next"/);
  assert.match(stylesSource, /\.ledger-home\[data-mobile-view="analysis"\] > \.analysis-page/);
  assert.match(stylesSource, /background:\s*#f4f0e5/);
  assert.match(stylesSource, /font-family:\s*"Noto Serif TC"/);
  assert.match(stylesSource, /@media \(min-width: 1000px\)[\s\S]*grid-template-columns:\s*repeat\(2/);
  assert.match(stylesSource, /@media \(max-width: 899px\)[\s\S]*\.analysis-total-grid,[\s\S]*grid-template-columns:\s*1fr/);
});

test('七項消費分析入口位於圓餅圖卡片左下方並避開右側百分比', () => {
  assert.match(stylesSource, /\.chart-enter-hint\s*\{[^}]*justify-self:\s*start;[^}]*justify-content:\s*flex-start;/);
});

test('帳本建立者可設定分類分析性質與店家別名', () => {
  assert.match(appSource, /class="category-analysis-form"/);
  assert.match(appSource, /name="analysisNature"/);
  assert.match(appSource, /class="merchant-settings-form"/);
  assert.match(appSource, /id="merchant-create-form"/);
  assert.match(appSource, /saveMerchantGroup/);
  assert.match(appSource, /retireMerchantGroup/);
  assert.match(appSource, /規則只改變分析分組，不會修改原始記帳名稱/);
});

test('手機所有內頁可向右滑動關閉或返回上一頁', () => {
  assert.match(appSource, /const installSwipeBackGesture = \(\{/);
  assert.match(appSource, /gestureTarget\.addEventListener\('touchstart'/);
  assert.match(appSource, /gestureTarget\.addEventListener\('touchmove'/);
  assert.match(appSource, /animatedSurface\.classList\.add\('is-swipe-closing'\)/);
  assert.match(appSource, /onBack\(\)/);
  assert.match(
    appSource,
    /installSwipeBackGesture\(\{[\s\S]*animatedSurface: financePanel[\s\S]*showMobileMainSection/,
  );
  assert.match(
    appSource,
    /document\.querySelectorAll\('\.finance-dialog'\)[\s\S]*installSwipeBackGesture/,
  );
  assert.match(stylesSource, /\.finance-dialog\.is-swipe-backing/);
  assert.match(stylesSource, /\.finance-panel\.is-swipe-closing/);
});

test('手機版在頁面頂端下拉可重新取得最新頁面與帳務資料', () => {
  assert.match(appSource, /class="mobile-pull-refresh"/);
  assert.match(appSource, /下拉更新/);
  assert.match(appSource, /touchstart/);
  assert.match(appSource, /touchmove/);
  assert.match(appSource, /touchend/);
  assert.match(appSource, /const finishPullRefresh = async \(\) => \{/);
  assert.match(
    appSource,
    /await renderLedger\(ledger, user, expenseAdapter, activeStartsOn\);/,
  );
  assert.doesNotMatch(appSource, /window\.location\.reload\(\)/);
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

test('快速記帳金額可用加號連續加總並儲存計算結果', () => {
  assert.match(appSource, /class="expense-amount-control"/);
  assert.match(appSource, /data-action="append-amount-plus"/);
  assert.match(appSource, /id="expense-amount-result"/);
  assert.match(appSource, /parseAmountExpression\(expenseAmountInput\.value\)/);
  assert.match(appSource, /const amount = parseAmountExpression\(formData\.get\('amount'\)\)/);
  assert.match(stylesSource, /\.expense-amount-control/);
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

test('帳本畫面清理函式名稱涵蓋導覽與時間更新責任', () => {
  assert.match(appSource, /let cleanupLedgerView = \(\) => \{\};/);
  assert.match(appSource, /cleanupLedgerView = \(\) => \{/);
  assert.doesNotMatch(appSource, /mobileNavigationCleanup/);
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

test('固定開銷可拖曳排序並選擇每月或每年指定月份產生', () => {
  assert.match(appSource, /data-action="drag-fixed-expense"/);
  assert.match(appSource, /reorderFixedExpenseRules/);
  assert.match(appSource, /name="recurrenceType"/);
  assert.match(appSource, /name="scheduledMonth"/);
  assert.match(appSource, /每年 \$\{rule\.scheduled_month\} 月/);
  assert.match(stylesSource, /\.fixed-rule-row\.is-dragging/);
  assert.match(stylesSource, /touch-action:\s*none/);
});

test('固定開銷拖曳會封鎖文字選取與 iOS 長按選單', () => {
  assert.match(
    appSource,
    /fixedRuleList\.addEventListener\('selectstart',[\s\S]*preventDefault\(\)/,
  );
  assert.match(
    appSource,
    /fixedRuleList\.addEventListener\('contextmenu',[\s\S]*preventDefault\(\)/,
  );
  assert.match(appSource, /document\.documentElement\.classList\.add\('is-reordering-fixed-expense'\)/);
  assert.match(appSource, /document\.getSelection\(\)\?\.removeAllRanges\(\)/);
  assert.match(
    stylesSource,
    /\.fixed-rule-sortable\s*\{[^}]*-webkit-user-select:\s*none;[^}]*user-select:\s*none;/,
  );
  assert.match(
    stylesSource,
    /\.fixed-rule-grip\s*\{[^}]*min-width:\s*40px;[^}]*touch-action:\s*none;/,
  );
  assert.match(stylesSource, /html\.is-reordering-fixed-expense[\s\S]*user-select:\s*none/);
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
  assert.match(appSource, /groupExpenseEntriesByDay\(suggestions, personalAmountsByEntryId\)/);
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

test('代墊只從開銷內頁設定，不在每次快速記帳後提示', () => {
  assert.match(appSource, /showExpenseSavedToast/);
  assert.match(appSource, /設為代墊/);
  assert.match(appSource, /class="advance-create-form"/);
  assert.doesNotMatch(appSource, /advanceButton\.textContent = '設為代墊'/);
  assert.match(appSource, /需要時可從開銷紀錄打開該筆帳目並設為代墊/);
  assert.doesNotMatch(appSource, /id="expense-form"[\s\S]{0,1600}name="debtorName"/);
});

test('待收代墊顯示在本期收入上方，並可記錄部分收回', () => {
  const advanceIndex = appSource.indexOf('class="advance-overview-section"');
  const incomeIndex = appSource.indexOf('class="income-overview-section"');
  assert.ok(advanceIndex >= 0 && advanceIndex < incomeIndex);
  assert.match(appSource, /全部待收/);
  assert.match(appSource, /class="advance-repayment-form"/);
  assert.match(appSource, /createAdvanceRepayment/);
  assert.match(stylesSource, /\.advance-overview-list/);
});

test('既有代墊可修改對象、金額與預計收回日期', () => {
  assert.match(appSource, /class="advance-edit-form"/);
  assert.match(appSource, /updateExpenseAdvance/);
  assert.match(appSource, /儲存代墊變更/);
  assert.match(appSource, /data-minimum-amount/);
  assert.match(stylesSource, /\.advance-edit-form/);
});
