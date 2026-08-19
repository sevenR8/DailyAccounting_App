import { LedgerModule } from './ledger-module.js?v=30';
import { calculateFinancialSummary } from './financial-summary.js?v=30';
import {
  buildExpenseTemplates,
  dailyExpenseTotalTone,
  findExpenseTemplates,
  groupExpenseEntriesByDay,
} from './daily-history.js?v=30';
import {
  accountingPeriodFromStart,
  compareExpenseTotals,
  scheduledDateInAccountingPeriod,
  shiftAccountingPeriodStart,
} from './accounting-period.js?v=30';
import {
  sendMagicLink,
  startGoogleSignIn,
  SupabaseConnection,
  SupabaseLedgerAdapter,
} from './supabase-adapter.js?v=30';

const app = document.querySelector('#app');
const config = window.DAILY_LEDGER_CONFIG ?? {};
const EXPENSE_TIME_REFRESH_INTERVAL = 5 * 60 * 1000;
const HISTORY_DISPLAY_LIMIT_STORAGE_KEY = 'daily-ledger-history-display-limit';
const HISTORY_DISPLAY_LIMIT_OPTIONS = ['5', '10', '15', 'all'];
let cleanupLedgerView = () => {};

const preventZoomGesture = (event) => {
  if (event.cancelable) event.preventDefault();
};
document.addEventListener('gesturestart', preventZoomGesture, { passive: false });
document.addEventListener('gesturechange', preventZoomGesture, { passive: false });
document.addEventListener('gestureend', preventZoomGesture, { passive: false });
document.addEventListener('touchmove', (event) => {
  if (event.touches.length > 1) preventZoomGesture(event);
}, { passive: false });

function configured() {
  return Boolean(config.supabaseUrl && config.supabaseAnonKey);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character]);
}

function saveSession(session) {
  window.localStorage.setItem('daily-ledger-session', JSON.stringify(session));
}

function readSession() {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const fromHash = hash.get('access_token');
  if (fromHash) {
    saveSession({
      accessToken: fromHash,
      refreshToken: hash.get('refresh_token'),
      expiresAt: Number(hash.get('expires_at') || 0),
    });
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  const storedSession = window.localStorage.getItem('daily-ledger-session');
  return storedSession ? JSON.parse(storedSession) : null;
}

function readHistoryDisplayLimit() {
  const storedLimit = window.localStorage.getItem(HISTORY_DISPLAY_LIMIT_STORAGE_KEY);
  return HISTORY_DISPLAY_LIMIT_OPTIONS.includes(storedLimit) ? storedLimit : '5';
}

async function getAccessToken() {
  const session = readSession();
  if (!session) return null;

  if (!session.refreshToken || session.expiresAt > Math.floor(Date.now() / 1000) + 60) {
    return session.accessToken;
  }

  const response = await fetch(
    `${config.supabaseUrl.replace(/\/$/, '')}/auth/v1/token?grant_type=refresh_token`,
    {
      method: 'POST',
      headers: { apikey: config.supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    },
  );

  if (!response.ok) return null;

  const refreshedSession = await response.json();
  saveSession({
    accessToken: refreshedSession.access_token,
    refreshToken: refreshedSession.refresh_token,
    expiresAt: refreshedSession.expires_at,
  });
  return refreshedSession.access_token;
}

function renderSetup() {
  cleanupLedgerView();
  app.innerHTML = `
    <main class="auth-card">
      <p class="eyebrow">每日帳本</p>
      <h1>先連結你的帳本</h1>
      <p>填入 Supabase 專案網址與公開匿名金鑰後，即可使用登入連結或 Google 登入，安全建立個人帳本。</p>
      <p class="notice">這兩項設定需在部署前填入 <code>config.js</code>；不要把服務角色金鑰放入前端。</p>
    </main>`;
}

function renderSignIn() {
  cleanupLedgerView();
  app.innerHTML = `
    <main class="auth-card">
      <p class="eyebrow">每日帳本</p>
      <h1>把每一筆開銷記得簡單。</h1>
      <p>登入後會自動建立你的帳本與六個預設分類。</p>
      <form class="email-sign-in" id="email-sign-in">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="email" inputmode="email" placeholder="name@example.com" required />
        <button class="email-button" type="submit">寄送登入連結</button>
        <p class="form-status" id="email-status" aria-live="polite"></p>
      </form>
      <div class="sign-in-divider" aria-hidden="true"><span>或</span></div>
      <button class="google-button" type="button" id="google-sign-in">使用 Google 繼續</button>
      <p class="sign-in-hint">Google 登入正在等待 Google Cloud 設定完成；現在可先使用 Email 登入連結。</p>
    </main>`;

  document.querySelector('#email-sign-in').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const email = new FormData(form).get('email').trim();
    const button = form.querySelector('button');
    const status = document.querySelector('#email-status');
    button.disabled = true;
    status.textContent = '正在寄送登入連結…';

    try {
      await sendMagicLink({
        supabaseUrl: config.supabaseUrl,
        supabaseAnonKey: config.supabaseAnonKey,
        email,
        redirectTo: window.location.href,
      });
      status.textContent = `登入連結已寄到 ${email}，請到信箱點開它。`;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector('#google-sign-in').addEventListener('click', () => {
    startGoogleSignIn({
      supabaseUrl: config.supabaseUrl,
      redirectTo: window.location.href,
    });
  });
}

function toDateTimeLocalValue(date = new Date()) {
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

function taiwanDateISO(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatAmount(amount) {
  return new Intl.NumberFormat('zh-TW').format(amount);
}

function formatEntryTime(value) {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatEntryDate(value) {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).format(new Date(value));
}

function formatPeriodDate(value) {
  const parts = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const dateParts = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${dateParts.year}/${dateParts.month}/${dateParts.day}`;
}

function currentAccountingPeriod(now = new Date(), startDay = 5) {
  let start = new Date(now.getFullYear(), now.getMonth(), startDay);
  if (now < start) {
    start = new Date(now.getFullYear(), now.getMonth() - 1, startDay);
  }
  const end = new Date(start.getFullYear(), start.getMonth() + 1, startDay);
  return { start, end };
}

function localDateFromISO(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

async function renderLedger(ledger, user, expenseAdapter, selectedStartsOn = null) {
  let financialOverview = null;
  try {
    const currentPeriod = await expenseAdapter.ensureCurrentAccountingPeriod(ledger.id);
    const settings = await expenseAdapter.getFinancialSettings(ledger.id);
    const targetStartsOn = selectedStartsOn ?? currentPeriod.starts_on;
    const isCurrentPeriod = targetStartsOn === currentPeriod.starts_on;
    const storedPeriod = isCurrentPeriod
      ? currentPeriod
      : await expenseAdapter.getAccountingPeriod({ ledgerId: ledger.id, startsOn: targetStartsOn });
    const targetBounds = accountingPeriodFromStart(targetStartsOn);
    const period = storedPeriod ?? {
      ledger_id: ledger.id,
      starts_on: targetBounds.startsOn,
      ends_on: targetBounds.endsOn,
      salary_amount: 0,
      previous_card_bill_amount: null,
      previous_card_bill_zero_confirmed: false,
    };
    const [otherIncomeEntries, fixedExpenseRules] = await Promise.all([
      expenseAdapter.listOtherIncomeEntries({
        ledgerId: ledger.id,
        startsOn: period.starts_on,
        endsOn: period.ends_on,
      }),
      expenseAdapter.listFixedExpenseRules(ledger.id),
    ]);
    financialOverview = {
      period,
      settings,
      otherIncomeEntries,
      fixedExpenseRules,
      currentStartsOn: currentPeriod.starts_on,
      isCurrentPeriod,
      hasStoredPeriod: Boolean(storedPeriod),
    };
  } catch (error) {
    financialOverview = null;
  }

  let entries = [];
  try {
    entries = await expenseAdapter.listExpenseEntries(ledger.id);
  } catch (error) {
    entries = [];
  }

  const categoryNames = new Map(ledger.categories.map((category) => [category.id, category.name]));
  const userEmail = user.email || '目前使用者';
  const userDisplayName = user.user_metadata?.full_name || userEmail.split('@')[0];
  const userInitial = Array.from(userDisplayName.trim())[0]?.toUpperCase() || '我';
  const fallbackPeriod = currentAccountingPeriod();
  const periodStart = financialOverview
    ? localDateFromISO(financialOverview.period.starts_on)
    : fallbackPeriod.start;
  const periodEnd = financialOverview
    ? new Date(localDateFromISO(financialOverview.period.ends_on).getTime() + 86_400_000)
    : fallbackPeriod.end;
  const periodEntries = entries.filter((entry) => {
    const occurredAt = new Date(entry.occurred_at);
    return occurredAt >= periodStart && occurredAt < periodEnd;
  });
  const isCurrentPeriod = financialOverview?.isCurrentPeriod ?? true;
  const fixedExpensesForSummary = isCurrentPeriod
    ? (financialOverview?.fixedExpenseRules ?? [])
    : periodEntries.filter((entry) => entry.is_fixed);
  const calculatedSummary = financialOverview ? calculateFinancialSummary({
    periodEntries,
    fixedExpenseRules: fixedExpensesForSummary,
    salaryAmount: financialOverview.period.salary_amount,
    otherIncomeEntries: financialOverview.otherIncomeEntries,
    previousCardBillAmount: financialOverview.period.previous_card_bill_amount,
    previousCardBillZeroConfirmed: financialOverview.period.previous_card_bill_zero_confirmed,
  }) : null;
  const cashTotal = calculatedSummary?.cashTotal ?? periodEntries
    .filter((entry) => !entry.is_fixed && entry.payment_method === 'cash')
    .reduce((total, entry) => total + entry.amount, 0);
  const creditCardTotal = calculatedSummary?.creditCardTotal ?? periodEntries
    .filter((entry) => !entry.is_fixed && entry.payment_method === 'credit_card')
    .reduce((total, entry) => total + entry.amount, 0);
  const nonFixedExpenseTotal = cashTotal + creditCardTotal;
  const generatedExpenseTotal = calculatedSummary?.generatedExpenseTotal
    ?? periodEntries.reduce((total, entry) => total + entry.amount, 0);
  const fixedExpenseTotal = calculatedSummary?.fixedExpenseTotal ?? null;
  const totalIncome = calculatedSummary?.totalIncome ?? null;
  const previousCardBillReady = calculatedSummary?.previousCardBillReady ?? false;
  const savingsAmount = calculatedSummary?.savingsAmount ?? null;
  const activeStartsOn = financialOverview?.period.starts_on;
  const previousStartsOn = activeStartsOn
    ? shiftAccountingPeriodStart(activeStartsOn, -1)
    : null;
  const nextStartsOn = activeStartsOn
    ? shiftAccountingPeriodStart(activeStartsOn, 1)
    : null;
  const previousPeriodStart = previousStartsOn ? localDateFromISO(previousStartsOn) : periodStart;
  const previousEntries = entries.filter((entry) => {
    const occurredAt = new Date(entry.occurred_at);
    return occurredAt >= previousPeriodStart && occurredAt < periodStart;
  });
  const previousExpenseTotal = previousEntries.reduce((total, entry) => total + entry.amount, 0);
  const periodComparison = compareExpenseTotals(generatedExpenseTotal, previousExpenseTotal);
  const comparisonPercent = periodComparison.percent === null
    ? null
    : new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 }).format(periodComparison.percent);
  const comparisonText = !periodComparison.hasBaseline
    ? '上月無開銷'
    : periodComparison.direction === 'same'
      ? '→ 0% 與上月相同'
      : periodComparison.direction === 'up'
        ? `↗ ${comparisonPercent}% 較上月`
        : `↘ ${comparisonPercent}% 較上月少`;
  const chartColors = ['#e07a45', '#3f9ee8', '#e94c64', '#79bf5a', '#a274d6', '#e6b83f'];
  const categoryBreakdown = ledger.categories
    .map((category, index) => ({
      id: category.id,
      name: category.name,
      color: chartColors[index % chartColors.length],
      amount: periodEntries
        .filter((entry) => entry.category_id === category.id)
        .reduce((total, entry) => total + entry.amount, 0),
    }))
    .filter((category) => category.amount > 0);
  let chartCursor = 0;
  const chartSegments = categoryBreakdown.map((category) => {
    const startPercent = chartCursor;
    chartCursor += (category.amount / generatedExpenseTotal) * 100;
    return `${category.color} ${startPercent}% ${chartCursor}%`;
  });
  const pieBackground = chartSegments.length
    ? `conic-gradient(${chartSegments.join(', ')})`
    : 'conic-gradient(#dfe5dc 0 100%)';
  const chartLegend = categoryBreakdown.map((category) => `
    <li>
      <span class="legend-color" style="background:${category.color}"></span>
      <span>${escapeHtml(category.name)}</span>
      <strong>${Math.round((category.amount / generatedExpenseTotal) * 100)}%</strong>
      <small>$${formatAmount(category.amount)}</small>
    </li>`).join('');
  const suggestions = periodEntries;
  const suggestionIndexById = new Map(
    suggestions.map((entry, index) => [entry.id, index]),
  );
  const categoryOptionsFor = (selectedId = null) => ledger.categories
    .filter((category) => !category.retiredAt || category.id === selectedId)
    .map((category) => `<option value="${escapeHtml(category.id)}" ${category.id === selectedId ? 'selected' : ''}>${escapeHtml(category.name)}</option>`)
    .join('');
  const categoryOptions = categoryOptionsFor();
  const activeCategoryIds = new Set(
    ledger.categories.filter((category) => !category.retiredAt).map((category) => category.id),
  );
  const quickEntryTemplates = buildExpenseTemplates(
    entries.filter((entry) => activeCategoryIds.has(entry.category_id)),
  );
  const dailyHistory = groupExpenseEntriesByDay(suggestions);
  const historyDisplayLimit = readHistoryDisplayLimit();
  const historyRows = dailyHistory.map((day, index) => `
    <details class="day-expense-group" data-history-index="${index}" ${historyDisplayLimit !== 'all' && index >= Number(historyDisplayLimit) ? 'hidden' : ''}>
      <summary class="day-expense-summary">
        <span class="day-summary-date">
          <time datetime="${escapeHtml(day.key)}">${escapeHtml(day.key.replaceAll('-', '/'))}</time>
          <small>${escapeHtml(new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', weekday: 'short' }).format(new Date(day.occurredAt)))}・${day.entries.length} 筆</small>
        </span>
        <span class="day-payment-total day-total total-${dailyExpenseTotalTone(day.total)}"><small>總開銷</small><strong>$${formatAmount(day.total)}</strong></span>
        <span class="day-payment-total"><small>現金</small><strong>$${formatAmount(day.cashTotal)}</strong></span>
        <span class="day-payment-total"><small>信用卡</small><strong>$${formatAmount(day.creditCardTotal)}</strong></span>
        <span class="day-summary-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div class="day-expense-list">
        ${day.entries.map((entry) => `
          <div class="day-expense-row">
            <button
              class="day-expense-entry"
              type="button"
              ${entry.is_fixed
                ? `data-suggestion-index="${suggestionIndexById.get(entry.id)}"`
                : `data-action="open-expense-edit" data-dialog-id="expense-edit-${escapeHtml(entry.id)}"`}
              aria-label="${entry.is_fixed ? '複製' : '編輯'}開銷：${escapeHtml(entry.item_name)}"
            >
              <span class="entry-date"><time datetime="${escapeHtml(entry.occurred_at)}">${escapeHtml(formatEntryTime(entry.occurred_at))}</time></span>
              <span class="entry-detail">
                <strong>$${formatAmount(entry.amount)}・${escapeHtml(entry.item_name)}</strong>
                <small>${escapeHtml(categoryNames.get(entry.category_id) || '未分類')}・${entry.payment_method === 'cash' ? '現金' : '信用卡'}</small>
              </span>
            </button>
            ${entry.is_fixed ? '<span class="fixed-entry-indicator" aria-label="固定開銷，請至固定開銷面板管理">固定</span>' : `
              <button
                class="expense-entry-delete"
                type="button"
                data-action="delete-expense"
                data-entry-id="${escapeHtml(entry.id)}"
                data-entry-name="${escapeHtml(entry.item_name)}"
                data-entry-amount="${entry.amount}"
                aria-label="刪除開銷：${escapeHtml(entry.item_name)}"
                title="刪除這筆開銷"
              ><span aria-hidden="true">🗑</span></button>`}
          </div>`).join('')}
      </div>
    </details>`).join('');
  const expenseEditDialogs = suggestions
    .filter((entry) => !entry.is_fixed)
    .map((entry) => `
      <dialog class="finance-dialog expense-edit-dialog" id="expense-edit-${escapeHtml(entry.id)}">
        <div class="dialog-content">
          <div class="dialog-heading">
            <div><p class="eyebrow">每日開銷</p><h2>編輯開銷</h2></div>
            <button class="dialog-close" type="button" data-action="close-dialog" aria-label="關閉">×</button>
          </div>
          <form class="expense-edit-form" data-entry-id="${escapeHtml(entry.id)}">
            <label>項目名稱
              <input name="itemName" type="text" maxlength="100" value="${escapeHtml(entry.item_name)}" required />
            </label>
            <label>金額（TWD）
              <input name="amount" type="number" min="1" step="1" inputmode="numeric" value="${entry.amount}" required />
            </label>
            <label>分類
              <select name="categoryId" required>${categoryOptionsFor(entry.category_id)}</select>
            </label>
            <label>付款方式
              <select name="paymentMethod" required>
                <option value="cash" ${entry.payment_method === 'cash' ? 'selected' : ''}>現金</option>
                <option value="credit_card" ${entry.payment_method === 'credit_card' ? 'selected' : ''}>信用卡</option>
              </select>
            </label>
            <label class="edit-form-wide">日期與時間
              <input name="occurredAt" type="datetime-local" value="${toDateTimeLocalValue(new Date(entry.occurred_at))}" required />
            </label>
            <p class="form-status edit-form-wide" aria-live="polite"></p>
            <div class="dialog-actions edit-form-wide">
              <button
                class="fixed-rule-delete"
                type="button"
                data-action="delete-expense"
                data-entry-id="${escapeHtml(entry.id)}"
                data-entry-name="${escapeHtml(entry.item_name)}"
                data-entry-amount="${entry.amount}"
              >刪除</button>
              <button
                class="secondary-button"
                type="button"
                data-action="duplicate-expense"
                data-suggestion-index="${suggestionIndexById.get(entry.id)}"
              >複製一筆</button>
              <button class="small-primary-button" type="submit">儲存變更</button>
            </div>
          </form>
        </div>
      </dialog>`).join('');

  const periodLabel = `${formatPeriodDate(periodStart)}－${formatPeriodDate(new Date(periodEnd.getTime() - 1))}`;
  const periodMonthLabel = new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: 'long',
  }).format(periodStart);
  const periodShortDate = new Intl.DateTimeFormat('zh-TW', {
    month: 'numeric',
    day: 'numeric',
  });
  const periodShortLabel = `${periodShortDate.format(periodStart)}－${periodShortDate.format(new Date(periodEnd.getTime() - 1))}`;
  const canGoNext = Boolean(
    financialOverview
      && nextStartsOn
      && nextStartsOn <= financialOverview.currentStartsOn,
  );
  const salaryAmount = financialOverview?.period.salary_amount ?? 0;
  const otherIncomeTotal = calculatedSummary?.otherIncomeTotal ?? 0;
  const previousCardBillAmount = financialOverview?.period.previous_card_bill_zero_confirmed
    ? 0
    : financialOverview?.period.previous_card_bill_amount;
  const previousCardBillNote = previousCardBillReady
    ? '上期實際帳單・已納入本期可存額'
    : isCurrentPeriod
      ? '待輸入上期實際帳單，點此更新'
      : '該期未記錄上期實際帳單';
  const otherIncomeList = financialOverview?.otherIncomeEntries.map((income) => `
    <li><span>${escapeHtml(income.name)}</span><strong>+$${formatAmount(income.amount)}</strong></li>`).join('') || '';
  const fixedExpenseList = financialOverview?.fixedExpenseRules.map((rule) => `
    <li class="fixed-rule-row">
      <button
        class="fixed-rule-open"
        type="button"
        data-action="open-fixed-expense"
        data-dialog-id="fixed-rule-detail-${escapeHtml(rule.id)}"
        aria-label="查看固定開銷：${escapeHtml(rule.item_name)}"
      >
        <span class="fixed-rule-grip" aria-hidden="true">⠿</span>
        <span class="fixed-rule-icon" aria-hidden="true">${escapeHtml((categoryNames.get(rule.category_id) || '固').slice(0, 1))}</span>
        <span class="fixed-rule-name"><strong>${escapeHtml(rule.item_name)}</strong><small>每月 ${rule.scheduled_day} 日・${rule.payment_method === 'cash' ? '現金' : '信用卡'}</small></span>
        <strong class="fixed-rule-amount">$${formatAmount(rule.amount)}</strong>
      </button>
    </li>`).join('') || '';
  const historicalFixedExpenseList = periodEntries
    .filter((entry) => entry.is_fixed)
    .map((entry) => `
      <li class="fixed-rule-row">
        <div class="historical-fixed-row">
          <span class="fixed-rule-icon" aria-hidden="true">${escapeHtml((categoryNames.get(entry.category_id) || '固').slice(0, 1))}</span>
          <span class="fixed-rule-name"><strong>${escapeHtml(entry.item_name)}</strong><small>${escapeHtml(formatEntryDate(entry.occurred_at))}・${entry.payment_method === 'cash' ? '現金' : '信用卡'}</small></span>
          <strong class="fixed-rule-amount">$${formatAmount(entry.amount)}</strong>
        </div>
      </li>`).join('');
  const displayedFixedExpenseList = isCurrentPeriod ? fixedExpenseList : historicalFixedExpenseList;
  const fixedExpenseDialogs = financialOverview?.fixedExpenseRules.map((rule) => `
    <dialog class="finance-dialog fixed-detail-dialog" id="fixed-rule-detail-${escapeHtml(rule.id)}">
      <div class="dialog-content">
        <div class="dialog-heading">
          <div><p class="eyebrow">${escapeHtml(periodMonthLabel)}固定開銷</p><h2>編輯固定開銷</h2></div>
          <button class="dialog-close" type="button" data-action="close-dialog" aria-label="關閉">×</button>
        </div>
        <form class="fixed-edit-form" data-rule-id="${escapeHtml(rule.id)}">
          <label class="edit-form-wide">項目名稱
            <input name="itemName" type="text" maxlength="100" value="${escapeHtml(rule.item_name)}" required />
          </label>
          <label>每月金額（TWD）
            <input name="amount" type="number" min="1" step="1" inputmode="numeric" value="${rule.amount}" required />
          </label>
          <label>扣款日
            <input name="scheduledDay" type="number" min="1" max="28" step="1" inputmode="numeric" value="${rule.scheduled_day}" required />
          </label>
          <label>分類
            <select name="categoryId" required>${categoryOptionsFor(rule.category_id)}</select>
          </label>
          <label>付款方式
            <select name="paymentMethod" required>
              <option value="cash" ${rule.payment_method === 'cash' ? 'selected' : ''}>現金</option>
              <option value="credit_card" ${rule.payment_method === 'credit_card' ? 'selected' : ''}>信用卡</option>
            </select>
          </label>
          <p class="dialog-note edit-form-wide">儲存後會同步本期與未來週期；已結束週期的歷史紀錄不會變動。</p>
          <p class="form-status edit-form-wide" aria-live="polite"></p>
          <div class="dialog-actions edit-form-wide">
            <button
              class="fixed-rule-delete"
              type="button"
              data-action="delete-fixed-expense"
              data-rule-id="${escapeHtml(rule.id)}"
              data-rule-name="${escapeHtml(rule.item_name)}"
            >刪除這筆固定開銷</button>
            <button class="secondary-button" type="button" data-action="close-dialog">取消</button>
            <button class="small-primary-button" type="submit">儲存變更</button>
          </div>
        </form>
      </div>
    </dialog>`).join('') || '';
  const financialPanel = financialOverview ? `
    <section class="finance-panel" id="financial-management-section" data-mobile-section="finance">
      <section class="income-overview-section">
        <div class="finance-overview-heading">
          <div>
            <h2>本期收入</h2>
            <p>${escapeHtml(periodMonthLabel)}・合計 NT$ ${formatAmount(totalIncome)}</p>
          </div>
          ${isCurrentPeriod
            ? '<button class="text-action" type="button" data-action="open-income-dialog">更新收入</button>'
            : '<span class="period-read-only">歷史紀錄</span>'}
        </div>
        <div class="income-overview-card">
          <div class="income-total-row"><span>本期收入合計</span><strong>$ ${formatAmount(totalIncome)}</strong></div>
          <div class="income-breakdown">
            <div><span class="income-marker salary-marker">＋</span><span><small>薪資收入</small><strong>$ ${formatAmount(salaryAmount)}</strong></span></div>
            <div><span class="income-marker other-marker">＋</span><span><small>其他收入</small><strong>$ ${formatAmount(otherIncomeTotal)}</strong></span></div>
          </div>
        </div>
      </section>
      <section class="card-bill-overview-section">
        <button
          class="credit-card-payment-card"
          type="button"
          ${isCurrentPeriod ? 'data-action="open-income-dialog"' : 'disabled'}
          aria-label="更新本月信用卡繳納"
        >
          <span class="credit-card-payment-copy">
            <strong>本月信用卡繳納</strong>
            <small>${escapeHtml(previousCardBillNote)}</small>
          </span>
          <strong class="credit-card-payment-amount">${previousCardBillReady ? `NT$ ${formatAmount(previousCardBillAmount ?? 0)}` : '待輸入'}</strong>
        </button>
      </section>
      <section class="fixed-overview-section">
        <div class="finance-overview-heading">
          <div>
            <h2>每期固定開銷</h2>
            <p>${escapeHtml(periodMonthLabel)}・合計 NT$ ${formatAmount(fixedExpenseTotal)}／期</p>
          </div>
          ${isCurrentPeriod
            ? '<button class="text-action" type="button" data-action="open-fixed-rule-dialog">＋ 新增</button>'
            : '<span class="period-read-only">實際產生</span>'}
        </div>
        <ul class="fixed-overview-list">${displayedFixedExpenseList || `<li class="fixed-empty-state">${isCurrentPeriod ? '尚未設定固定開銷，點「＋新增」開始設定。' : '這個週期沒有已產生的固定開銷。'}</li>`}</ul>
      </section>

      <dialog class="finance-dialog" id="income-dialog">
        <div class="dialog-content">
          <div class="dialog-heading">
            <div><p class="eyebrow">${escapeHtml(periodMonthLabel)}</p><h2>更新收入與帳單</h2></div>
            <button class="dialog-close" type="button" data-action="close-dialog" aria-label="關閉">×</button>
          </div>
          <form class="compact-form period-finance-form" id="period-finance-form">
            <label>本期薪水
              <input name="salaryAmount" type="number" min="0" step="1" inputmode="numeric" value="${financialOverview.period.salary_amount}" required />
            </label>
            <label>上期信用卡帳單
              <input id="previous-card-bill" name="previousCardBillAmount" type="number" min="0" step="1" inputmode="numeric" value="${financialOverview.period.previous_card_bill_amount ?? ''}" placeholder="尚未輸入" ${financialOverview.period.previous_card_bill_zero_confirmed ? 'disabled' : ''} />
            </label>
            <label class="inline-check"><input id="zero-card-bill" name="zeroCardBill" type="checkbox" ${financialOverview.period.previous_card_bill_zero_confirmed ? 'checked' : ''} /> 上期帳單確實為 0 元</label>
            <p class="form-helper">儲存後，本期薪水會自動作為後續週期的預設薪水。</p>
            <button class="small-primary-button" type="submit">儲存本期資料</button>
            <p class="form-status" id="period-finance-status" aria-live="polite"></p>
          </form>
          <div class="dialog-subsection">
            <h3>其他收入</h3>
            <ul class="money-list">${otherIncomeList || '<li class="empty-money-list">本期尚無其他收入</li>'}</ul>
            <form class="inline-money-form" id="other-income-form">
              <input name="name" type="text" maxlength="100" placeholder="收入名稱" aria-label="其他收入名稱" required />
              <input name="amount" type="number" min="1" step="1" inputmode="numeric" placeholder="金額" aria-label="其他收入金額" required />
              <button class="secondary-button" type="submit">新增</button>
              <p class="form-status" id="other-income-status" aria-live="polite"></p>
            </form>
          </div>
        </div>
      </dialog>

      <dialog class="finance-dialog" id="fixed-rule-dialog">
        <div class="dialog-content">
          <div class="dialog-heading">
            <div><p class="eyebrow">每期自動產生</p><h2>新增固定開銷</h2></div>
            <button class="dialog-close" type="button" data-action="close-dialog" aria-label="關閉">×</button>
          </div>
          <form class="fixed-rule-form" id="fixed-rule-form">
            <input name="itemName" type="text" maxlength="100" placeholder="項目，例如房租" aria-label="固定開銷項目" required />
            <input name="amount" type="number" min="1" step="1" inputmode="numeric" placeholder="金額" aria-label="固定開銷金額" required />
            <select name="categoryId" aria-label="固定開銷分類" required>${categoryOptions}</select>
            <select name="paymentMethod" aria-label="固定開銷付款方式" required>
              <option value="cash">現金</option>
              <option value="credit_card">信用卡</option>
            </select>
            <label>每月<input name="scheduledDay" type="number" min="1" max="28" step="1" inputmode="numeric" value="5" aria-label="固定開銷產生日" required />日</label>
            <button class="secondary-button" type="submit">新增固定開銷</button>
            <p class="form-status" id="fixed-rule-status" aria-live="polite"></p>
          </form>
        </div>
      </dialog>
      ${fixedExpenseDialogs}
    </section>` : `
    <section class="finance-panel migration-notice" id="financial-management-section" data-mobile-section="finance">
      <p class="eyebrow">需要資料庫升級</p>
      <h2>啟用完整本期總覽</h2>
      <p>請在 Supabase SQL Editor 執行 <code>supabase-0002-financial-overview.sql</code>，即可同步本期薪水、其他收入、上期信用卡帳單、固定開銷與可存額。</p>
    </section>`;

  app.innerHTML = `
    <main class="ledger-home">
      <header class="top-bar">
        <span class="user-avatar" title="${escapeHtml(userEmail)}" aria-label="目前使用者：${escapeHtml(userEmail)}">${escapeHtml(userInitial)}</span>
        <details class="user-menu">
          <summary aria-label="開啟帳號選單">…</summary>
          <div class="user-menu-popover">
            <p>${escapeHtml(userEmail)}</p>
            <button class="menu-sign-out" type="button" id="sign-out">登出</button>
          </div>
        </details>
      </header>
      ${financialOverview ? `
        <section class="period-navigation" data-mobile-section="overview" aria-label="切換帳務月份">
          <div class="period-switcher">
            <button type="button" data-period-direction="previous" aria-label="查看上一個月">‹</button>
            <span><strong>${escapeHtml(periodMonthLabel)}</strong><small>${escapeHtml(periodShortLabel)}</small></span>
            <button type="button" data-period-direction="next" aria-label="查看下一個月" ${canGoNext ? '' : 'disabled'}>›</button>
          </div>
          <div class="period-comparison comparison-${periodComparison.direction}">${escapeHtml(comparisonText)}</div>
        </section>` : ''}
      <section class="chart-panel" id="period-overview-section" data-mobile-section="overview" aria-label="本期開銷分類占比">
        <div class="chart-heading">
          <p class="eyebrow">本期總覽</p>
          <span>${escapeHtml(periodLabel)}</span>
        </div>
        <div class="chart-body">
          <div class="expense-pie" role="img" aria-label="本期分類圓餅圖" style="background:${pieBackground}">
            <div><span>已產生開銷</span><strong>$${formatAmount(generatedExpenseTotal)}</strong></div>
          </div>
          <ul class="chart-legend">${chartLegend || '<li class="empty-chart">新增開銷後會顯示分類占比</li>'}</ul>
        </div>
      </section>
      <section class="summary-panel" data-mobile-section="overview" aria-label="本期帳務摘要">
        <div><span>本期收入</span><strong>${totalIncome === null ? '—' : `$${formatAmount(totalIncome)}`}</strong></div>
        <div><span>現金</span><strong>$${formatAmount(cashTotal)}</strong></div>
        <div><span>信用卡</span><strong>$${formatAmount(creditCardTotal)}</strong></div>
        <div><span>總開銷</span><strong>$${formatAmount(nonFixedExpenseTotal)}</strong></div>
        <div><span>本期固定開銷</span><strong>${fixedExpenseTotal === null ? '—' : `$${formatAmount(fixedExpenseTotal)}`}</strong></div>
        <div class="savings-summary"><span>本期可存額</span><strong>${financialOverview && !previousCardBillReady ? '待輸入帳單' : savingsAmount === null ? '—' : `$${formatAmount(savingsAmount)}`}</strong></div>
      </section>
      ${financialPanel}
      <section class="quick-entry-panel" id="quick-entry-section" data-mobile-section="record">
        <div>
          <p class="eyebrow">快速記帳</p>
        </div>
        <form class="expense-form" id="expense-form">
          <label>金額
            <input id="expense-amount" name="amount" type="number" min="1" step="1" inputmode="numeric" placeholder="例如 100" required autofocus />
          </label>
          <section class="smart-suggestions" id="smart-suggestions" ${quickEntryTemplates.length ? '' : 'hidden'} aria-label="常用記帳紀錄">
            <div class="smart-suggestions-heading">
              <strong id="smart-suggestions-title">常用紀錄</strong>
              <small>點一下自動帶入</small>
            </div>
            <div class="smart-suggestion-list" id="smart-suggestion-list"></div>
          </section>
          <label>項目名稱
            <input id="expense-item-name" name="itemName" type="text" maxlength="100" placeholder="例如 晚餐" required />
          </label>
          <label>分類
            <select id="expense-category" name="categoryId" required>${categoryOptions}</select>
          </label>
          <fieldset>
            <legend>付款方式</legend>
            <label><input type="radio" name="paymentMethod" value="cash" checked /> 現金</label>
            <label><input type="radio" name="paymentMethod" value="credit_card" /> 信用卡</label>
          </fieldset>
          <label class="expense-datetime-field">日期與時間
            <span class="expense-datetime-control">
              <input id="expense-occurred-at" name="occurredAt" type="datetime-local" value="${toDateTimeLocalValue()}" required />
            </span>
          </label>
          <button class="email-button" type="submit">儲存開銷</button>
          <p class="form-status" id="expense-status" aria-live="polite"></p>
        </form>
      </section>
      <section class="history-panel" data-mobile-section="record">
        <div class="history-heading">
          <p class="eyebrow">開銷紀錄</p>
          <label class="history-limit-control">顯示
            <select id="history-display-limit" aria-label="顯示最近幾天的開銷紀錄">
              <option value="5" ${historyDisplayLimit === '5' ? 'selected' : ''}>最近 5 天</option>
              <option value="10" ${historyDisplayLimit === '10' ? 'selected' : ''}>最近 10 天</option>
              <option value="15" ${historyDisplayLimit === '15' ? 'selected' : ''}>最近 15 天</option>
              <option value="all" ${historyDisplayLimit === 'all' ? 'selected' : ''}>全部</option>
            </select>
          </label>
        </div>
        <div class="history-list">
          ${historyRows || '<p class="next-step">第一筆開銷會出現在這裡，之後可點選快速帶入。</p>'}
        </div>
      </section>
      ${expenseEditDialogs}
      <div class="mobile-pull-refresh" role="status" aria-live="polite">
        <span aria-hidden="true">↻</span>
        <strong>下拉更新</strong>
      </div>
      <nav class="mobile-bottom-nav" aria-label="手機版主要功能">
        <button type="button" data-mobile-nav="record" data-scroll-target="quick-entry-section" aria-current="page">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l3 3v15H6zM9 11h6M9 15h6M15 3v4h4" /></svg>
          <span>記帳</span>
        </button>
        <button type="button" data-mobile-nav="overview" data-scroll-target="period-overview-section">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9h-9zM15 3.5A8.5 8.5 0 0 1 20.5 9H15z" /></svg>
          <span>總覽</span>
        </button>
        <button type="button" data-mobile-nav="finance" data-scroll-target="financial-management-section">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h18v13H3zM3 7l3-4h12l3 4M16 13h3" /></svg>
          <span>帳務</span>
        </button>
      </nav>
    </main>`;

  const smartSuggestions = document.querySelector('#smart-suggestions');
  const smartSuggestionsTitle = document.querySelector('#smart-suggestions-title');
  const smartSuggestionList = document.querySelector('#smart-suggestion-list');
  const expenseAmountInput = document.querySelector('#expense-amount');
  const expenseOccurredAtInput = document.querySelector('#expense-occurred-at');
  let expenseOccurredAtManuallyEdited = false;
  const syncExpenseOccurredAt = () => {
    if (expenseOccurredAtManuallyEdited) return;
    expenseOccurredAtInput.value = toDateTimeLocalValue();
  };
  expenseOccurredAtInput.addEventListener('input', () => {
    expenseOccurredAtManuallyEdited = true;
  });
  const renderSmartSuggestions = () => {
    const matchingTemplates = findExpenseTemplates(
      quickEntryTemplates,
      expenseAmountInput.value,
      5,
    );
    smartSuggestions.hidden = matchingTemplates.length === 0;
    smartSuggestionsTitle.textContent = expenseAmountInput.value
      ? `符合 $${formatAmount(Number(expenseAmountInput.value))}`
      : '常用紀錄';
    smartSuggestionList.innerHTML = matchingTemplates.map((template) => {
      const templateIndex = quickEntryTemplates.indexOf(template);
      const paymentLabel = template.paymentMethod === 'cash' ? '現金' : '信用卡';
      const usageLabel = template.usageCount > 1 ? `${template.usageCount} 次` : '最近';
      return `
        <button type="button" data-quick-template-index="${templateIndex}">
          <span>
            <strong>$${formatAmount(template.amount)}・${escapeHtml(template.itemName)}</strong>
            <small>${escapeHtml(categoryNames.get(template.categoryId) || '未分類')}・${paymentLabel}</small>
          </span>
          <em>${usageLabel}</em>
        </button>`;
    }).join('');
  };
  expenseAmountInput.addEventListener('input', renderSmartSuggestions);
  smartSuggestionList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-quick-template-index]');
    if (!button) return;
    const template = quickEntryTemplates[Number(button.dataset.quickTemplateIndex)];
    document.querySelector('#expense-amount').value = template.amount;
    document.querySelector('#expense-item-name').value = template.itemName;
    document.querySelector('#expense-category').value = template.categoryId;
    document.querySelector(`input[name="paymentMethod"][value="${template.paymentMethod}"]`).checked = true;
    expenseOccurredAtManuallyEdited = false;
    syncExpenseOccurredAt();
    document.querySelector('#expense-status').textContent = `已帶入「${template.itemName}」，可直接儲存或修改。`;
    document.activeElement?.blur();
    renderSmartSuggestions();
  });
  renderSmartSuggestions();

  const historyDisplayLimitSelect = document.querySelector('#history-display-limit');
  const renderedHistoryRows = [...document.querySelectorAll('.day-expense-group')];
  const applyHistoryDisplayLimit = (limit) => {
    renderedHistoryRows.forEach((row, index) => {
      row.hidden = limit !== 'all' && index >= Number(limit);
    });
  };
  historyDisplayLimitSelect.addEventListener('change', () => {
    const limit = HISTORY_DISPLAY_LIMIT_OPTIONS.includes(historyDisplayLimitSelect.value)
      ? historyDisplayLimitSelect.value
      : '5';
    window.localStorage.setItem(HISTORY_DISPLAY_LIMIT_STORAGE_KEY, limit);
    applyHistoryDisplayLimit(limit);
  });

  cleanupLedgerView();
  const expenseTimeRefreshTimer = window.setInterval(
    syncExpenseOccurredAt,
    EXPENSE_TIME_REFRESH_INTERVAL,
  );
  const syncExpenseTimeWhenVisible = () => {
    if (document.visibilityState === 'visible') syncExpenseOccurredAt();
  };
  document.addEventListener('visibilitychange', syncExpenseTimeWhenVisible);
  const mobileNavigationButtons = [...document.querySelectorAll('[data-mobile-nav]')];
  const setActiveMobileNavigation = (sectionName) => {
    mobileNavigationButtons.forEach((button) => {
      if (button.dataset.mobileNav === sectionName) {
        button.setAttribute('aria-current', 'page');
      } else {
        button.removeAttribute('aria-current');
      }
    });
  };
  mobileNavigationButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const target = document.getElementById(button.dataset.scrollTarget);
      if (!target) return;
      setActiveMobileNavigation(button.dataset.mobileNav);
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  let mobileNavigationFrame = null;
  const syncMobileNavigation = () => {
    if (window.innerWidth >= 900) return;
    if (mobileNavigationFrame !== null) return;
    mobileNavigationFrame = window.requestAnimationFrame(() => {
      mobileNavigationFrame = null;
      const referenceY = Math.min(window.innerHeight * 0.38, 300);
      const sections = [...document.querySelectorAll('[data-mobile-section]')];
      const nearestSection = sections.reduce((nearest, section) => {
        const bounds = section.getBoundingClientRect();
        const distance = referenceY < bounds.top
          ? bounds.top - referenceY
          : referenceY > bounds.bottom
            ? referenceY - bounds.bottom
            : 0;
        return !nearest || distance < nearest.distance
          ? { name: section.dataset.mobileSection, distance }
          : nearest;
      }, null);
      if (nearestSection) setActiveMobileNavigation(nearestSection.name);
    });
  };
  window.addEventListener('scroll', syncMobileNavigation, { passive: true });
  window.addEventListener('resize', syncMobileNavigation);

  const pullRefreshIndicator = document.querySelector('.mobile-pull-refresh');
  const pullRefreshText = pullRefreshIndicator.querySelector('strong');
  const pullRefreshThreshold = 72;
  let pullRefreshStartY = null;
  let pullRefreshDistance = 0;
  let pullRefreshStarted = false;
  const resetPullRefresh = () => {
    pullRefreshStartY = null;
    pullRefreshDistance = 0;
    pullRefreshIndicator.classList.remove('is-pulling', 'is-ready');
    pullRefreshIndicator.style.removeProperty('--pull-distance');
    pullRefreshText.textContent = '下拉更新';
  };
  const startPullRefresh = (event) => {
    if (
      window.innerWidth >= 900
      || window.scrollY > 0
      || event.touches.length !== 1
      || document.querySelector('dialog[open]')
    ) return;
    pullRefreshStartY = event.touches[0].clientY;
    pullRefreshDistance = 0;
  };
  const movePullRefresh = (event) => {
    if (pullRefreshStartY === null || pullRefreshStarted || event.touches.length !== 1) return;
    const rawDistance = event.touches[0].clientY - pullRefreshStartY;
    if (rawDistance <= 0) {
      resetPullRefresh();
      return;
    }
    pullRefreshDistance = Math.min(rawDistance * 0.55, 104);
    if (pullRefreshDistance > 4 && event.cancelable) event.preventDefault();
    pullRefreshIndicator.classList.add('is-pulling');
    pullRefreshIndicator.classList.toggle('is-ready', pullRefreshDistance >= pullRefreshThreshold);
    pullRefreshIndicator.style.setProperty('--pull-distance', `${pullRefreshDistance}px`);
    pullRefreshText.textContent = pullRefreshDistance >= pullRefreshThreshold
      ? '放開更新'
      : '下拉更新';
  };
  const finishPullRefresh = async () => {
    if (pullRefreshStartY === null || pullRefreshStarted) return;
    if (pullRefreshDistance < pullRefreshThreshold) {
      resetPullRefresh();
      return;
    }
    pullRefreshStarted = true;
    pullRefreshIndicator.classList.remove('is-pulling', 'is-ready');
    pullRefreshIndicator.classList.add('is-refreshing');
    pullRefreshIndicator.style.removeProperty('--pull-distance');
    pullRefreshText.textContent = '正在更新最新資料…';
    const updatePromise = navigator.serviceWorker?.getRegistration
      ? navigator.serviceWorker.getRegistration().then((registration) => registration?.update())
      : Promise.resolve();
    updatePromise.catch(() => null);
    try {
      await renderLedger(ledger, user, expenseAdapter, activeStartsOn);
    } catch (error) {
      pullRefreshStarted = false;
      pullRefreshIndicator.classList.remove('is-refreshing');
      resetPullRefresh();
      window.alert(`更新失敗：${error.message}`);
    }
  };
  const cancelPullRefresh = () => {
    if (!pullRefreshStarted) resetPullRefresh();
  };
  document.addEventListener('touchstart', startPullRefresh, { passive: true });
  document.addEventListener('touchmove', movePullRefresh, { passive: false });
  document.addEventListener('touchend', finishPullRefresh, { passive: true });
  document.addEventListener('touchcancel', cancelPullRefresh, { passive: true });
  cleanupLedgerView = () => {
    window.removeEventListener('scroll', syncMobileNavigation);
    window.removeEventListener('resize', syncMobileNavigation);
    document.removeEventListener('touchstart', startPullRefresh);
    document.removeEventListener('touchmove', movePullRefresh);
    document.removeEventListener('touchend', finishPullRefresh);
    document.removeEventListener('touchcancel', cancelPullRefresh);
    document.removeEventListener('visibilitychange', syncExpenseTimeWhenVisible);
    window.clearInterval(expenseTimeRefreshTimer);
    if (mobileNavigationFrame !== null) window.cancelAnimationFrame(mobileNavigationFrame);
    mobileNavigationFrame = null;
  };
  syncMobileNavigation();

  document.querySelector('#sign-out').addEventListener('click', () => {
    window.localStorage.removeItem('daily-ledger-session');
    renderSignIn();
  });

  if (financialOverview) {
    const previousPeriodButton = document.querySelector('[data-period-direction="previous"]');
    const nextPeriodButton = document.querySelector('[data-period-direction="next"]');
    previousPeriodButton.addEventListener('click', async () => {
      previousPeriodButton.disabled = true;
      await renderLedger(ledger, user, expenseAdapter, previousStartsOn);
    });
    nextPeriodButton.addEventListener('click', async () => {
      if (!canGoNext) return;
      nextPeriodButton.disabled = true;
      await renderLedger(ledger, user, expenseAdapter, nextStartsOn);
    });
  }

  document.querySelector('#expense-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const button = form.querySelector('button[type="submit"]');
    const status = document.querySelector('#expense-status');
    const itemName = formData.get('itemName').trim();
    const amount = Number(formData.get('amount'));

    if (!itemName || !Number.isInteger(amount) || amount <= 0) {
      status.textContent = '請填寫正確的整數金額與項目名稱。';
      return;
    }

    button.disabled = true;
    status.textContent = '正在儲存…';
    try {
      await expenseAdapter.createExpenseEntry({
        ledgerId: ledger.id,
        categoryId: formData.get('categoryId'),
        itemName,
        amount,
        paymentMethod: formData.get('paymentMethod'),
        occurredAt: new Date(formData.get('occurredAt')).toISOString(),
      });
      await renderLedger(ledger, user, expenseAdapter, activeStartsOn);
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
    }
  });

  const openDialog = (dialogId) => {
    const dialog = document.getElementById(dialogId);
    if (dialog && !dialog.open) dialog.showModal();
  };

  document.querySelectorAll('[data-action="open-expense-edit"]').forEach((button) => {
    button.addEventListener('click', () => openDialog(button.dataset.dialogId));
  });
  document.querySelectorAll('[data-action="close-dialog"]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog').close());
  });
  document.querySelectorAll('.finance-dialog').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  });

  document.querySelectorAll('.expense-edit-form').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const button = form.querySelector('button[type="submit"]');
      const status = form.querySelector('.form-status');
      const itemName = formData.get('itemName').trim();
      const amount = Number(formData.get('amount'));
      if (!itemName || !Number.isInteger(amount) || amount <= 0) {
        status.textContent = '請填寫正確的整數金額與項目名稱。';
        return;
      }

      button.disabled = true;
      status.textContent = '正在儲存…';
      try {
        await expenseAdapter.updateExpenseEntry({
          ledgerId: ledger.id,
          entryId: form.dataset.entryId,
          categoryId: formData.get('categoryId'),
          itemName,
          amount,
          paymentMethod: formData.get('paymentMethod'),
          occurredAt: new Date(formData.get('occurredAt')).toISOString(),
        });
        await renderLedger(ledger, user, expenseAdapter, activeStartsOn);
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
      }
    });
  });

  if (financialOverview && isCurrentPeriod) {
    document.querySelectorAll('[data-action="open-income-dialog"]').forEach((button) => {
      button.addEventListener('click', () => openDialog('income-dialog'));
    });
    document.querySelector('[data-action="open-fixed-rule-dialog"]').addEventListener('click', () => {
      openDialog('fixed-rule-dialog');
    });
    document.querySelectorAll('[data-action="open-fixed-expense"]').forEach((button) => {
      button.addEventListener('click', () => openDialog(button.dataset.dialogId));
    });

    const zeroCardBill = document.querySelector('#zero-card-bill');
    const previousCardBill = document.querySelector('#previous-card-bill');
    zeroCardBill.addEventListener('change', () => {
      previousCardBill.disabled = zeroCardBill.checked;
      if (zeroCardBill.checked) previousCardBill.value = '';
    });

    document.querySelector('#period-finance-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const formData = new FormData(form);
      const button = form.querySelector('button[type="submit"]');
      const status = document.querySelector('#period-finance-status');
      const zeroConfirmed = formData.get('zeroCardBill') === 'on';
      const billValue = formData.get('previousCardBillAmount');
      const updatedSalaryAmount = Number(formData.get('salaryAmount'));
      button.disabled = true;
      status.textContent = '正在儲存…';
      try {
        await Promise.all([
          expenseAdapter.updateAccountingPeriod({
            ledgerId: ledger.id,
            startsOn: financialOverview.period.starts_on,
            salaryAmount: updatedSalaryAmount,
            previousCardBillAmount: zeroConfirmed || billValue === '' ? null : Number(billValue),
            previousCardBillZeroConfirmed: zeroConfirmed,
          }),
          expenseAdapter.updateFinancialSettings({
            ledgerId: ledger.id,
            cycleStartDay: financialOverview.settings.cycle_start_day,
            defaultSalaryAmount: updatedSalaryAmount,
          }),
        ]);
        await renderLedger(ledger, user, expenseAdapter, activeStartsOn);
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
      }
    });

    document.querySelector('#other-income-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const formData = new FormData(form);
      const button = form.querySelector('button[type="submit"]');
      const status = document.querySelector('#other-income-status');
      button.disabled = true;
      status.textContent = '正在新增…';
      try {
        await expenseAdapter.createOtherIncomeEntry({
          ledgerId: ledger.id,
          name: formData.get('name').trim(),
          amount: Number(formData.get('amount')),
          receivedAt: new Date().toISOString(),
        });
        await renderLedger(ledger, user, expenseAdapter, activeStartsOn);
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
      }
    });

    document.querySelector('#fixed-rule-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const formData = new FormData(form);
      const button = form.querySelector('button[type="submit"]');
      const status = document.querySelector('#fixed-rule-status');
      button.disabled = true;
      status.textContent = '正在新增…';
      try {
        await expenseAdapter.createFixedExpenseRule({
          ledgerId: ledger.id,
          categoryId: formData.get('categoryId'),
          itemName: formData.get('itemName').trim(),
          amount: Number(formData.get('amount')),
          paymentMethod: formData.get('paymentMethod'),
          scheduledDay: Number(formData.get('scheduledDay')),
        });
        await renderLedger(ledger, user, expenseAdapter, activeStartsOn);
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
      }
    });

    document.querySelectorAll('.fixed-edit-form').forEach((form) => {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const button = form.querySelector('button[type="submit"]');
        const status = form.querySelector('.form-status');
        const itemName = formData.get('itemName').trim();
        const amount = Number(formData.get('amount'));
        const scheduledDay = Number(formData.get('scheduledDay'));
        if (
          !itemName
          || !Number.isInteger(amount)
          || amount <= 0
          || !Number.isInteger(scheduledDay)
          || scheduledDay < 1
          || scheduledDay > 28
        ) {
          status.textContent = '請填寫正確的項目、整數金額與 1～28 日扣款日。';
          return;
        }

        const categoryId = formData.get('categoryId');
        const paymentMethod = formData.get('paymentMethod');
        const scheduledOn = scheduledDateInAccountingPeriod(
          financialOverview.period.starts_on,
          financialOverview.period.ends_on,
          scheduledDay,
        );
        button.disabled = true;
        status.textContent = '正在儲存…';
        try {
          await expenseAdapter.updateFixedExpenseRule({
            ledgerId: ledger.id,
            ruleId: form.dataset.ruleId,
            categoryId,
            itemName,
            amount,
            paymentMethod,
            scheduledDay,
          });
          await expenseAdapter.syncFixedExpenseEntry({
            ledgerId: ledger.id,
            ruleId: form.dataset.ruleId,
            accountingPeriodStart: financialOverview.period.starts_on,
            categoryId,
            itemName,
            amount,
            paymentMethod,
            occurredAt: `${scheduledOn}T00:00:00+08:00`,
            shouldExist: scheduledOn <= taiwanDateISO(),
          });
          await renderLedger(ledger, user, expenseAdapter, activeStartsOn);
        } catch (error) {
          status.textContent = error.message;
          button.disabled = false;
        }
      });
    });

    document.querySelectorAll('[data-action="delete-fixed-expense"]').forEach((button) => {
      button.addEventListener('click', async () => {
        const confirmed = window.confirm(
          `確定刪除「${button.dataset.ruleName}」？\n已產生的歷史紀錄會保留，未來不會再自動新增。`,
        );
        if (!confirmed) return;

        const originalLabel = button.textContent;
        button.disabled = true;
        button.textContent = '刪除中…';
        try {
          await expenseAdapter.deleteFixedExpenseRule({
            ledgerId: ledger.id,
            ruleId: button.dataset.ruleId,
            retiredAt: new Date().toISOString(),
          });
          await expenseAdapter.syncFixedExpenseEntry({
            ledgerId: ledger.id,
            ruleId: button.dataset.ruleId,
            accountingPeriodStart: financialOverview.period.starts_on,
            shouldExist: false,
          });
          await renderLedger(ledger, user, expenseAdapter, activeStartsOn);
        } catch (error) {
          button.disabled = false;
          button.textContent = originalLabel;
          window.alert(error.message);
        }
      });
    });
  }

  document.querySelectorAll('[data-suggestion-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const entry = suggestions[Number(button.dataset.suggestionIndex)];
      document.querySelector('#expense-amount').value = entry.amount;
      document.querySelector('#expense-item-name').value = entry.item_name;
      document.querySelector('#expense-category').value = entry.category_id;
      document.querySelector(`input[name="paymentMethod"][value="${entry.payment_method}"]`).checked = true;
      expenseOccurredAtManuallyEdited = false;
      syncExpenseOccurredAt();
      if (button.dataset.action === 'duplicate-expense') {
        const dialog = button.closest('dialog');
        if (dialog?.open) dialog.close();
      }
      document.querySelector('#expense-amount').focus();
    });
  });

  document.querySelectorAll('[data-action="delete-expense"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const confirmed = window.confirm(
        `確定刪除「$${formatAmount(Number(button.dataset.entryAmount))}・${button.dataset.entryName}」？`,
      );
      if (!confirmed) return;

      button.disabled = true;
      try {
        await expenseAdapter.deleteExpenseEntry({
          ledgerId: ledger.id,
          entryId: button.dataset.entryId,
        });
        await renderLedger(ledger, user, expenseAdapter, activeStartsOn);
      } catch (error) {
        button.disabled = false;
        window.alert(error.message);
      }
    });
  });
}

async function bootstrap() {
  if (!configured()) {
    renderSetup();
    return;
  }

  if (!app.firstElementChild) renderSignIn();
  const accessToken = await getAccessToken();
  if (!accessToken) {
    return;
  }

  const retainedAuthView = app.querySelector('.auth-card');
  if (retainedAuthView) {
    retainedAuthView.setAttribute('aria-busy', 'true');
    retainedAuthView.inert = true;
  }

  try {
    const connection = new SupabaseConnection({
      supabaseUrl: config.supabaseUrl,
      supabaseAnonKey: config.supabaseAnonKey,
      accessToken,
    });
    const user = await connection.getUser();
    const expenseAdapter = new SupabaseLedgerAdapter(connection);
    const ledgerModule = new LedgerModule(expenseAdapter);
    const ledger = await ledgerModule.provisionPersonalLedger({
      userId: user.id,
      displayName: user.user_metadata?.full_name || user.email?.split('@')[0],
    });
    await renderLedger(ledger, user, expenseAdapter);
  } catch (error) {
    app.innerHTML = `
      <main class="auth-card">
        <p class="eyebrow">每日帳本</p>
        <h1>無法準備帳本</h1>
        <p>${error.message}</p>
        <button class="google-button" type="button" id="retry-sign-in">重新登入</button>
      </main>`;
    document.querySelector('#retry-sign-in').addEventListener('click', () => {
      window.localStorage.removeItem('daily-ledger-session');
      renderSignIn();
    });
  }
}

bootstrap();

