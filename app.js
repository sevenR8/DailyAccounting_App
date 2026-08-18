import { LedgerModule } from './ledger-module.js?v=7';
import { calculateFinancialSummary } from './financial-summary.js?v=7';
import { groupExpenseEntriesByDay } from './daily-history.js?v=7';
import {
  sendMagicLink,
  startGoogleSignIn,
  SupabaseConnection,
  SupabaseLedgerAdapter,
} from './supabase-adapter.js?v=7';

const app = document.querySelector('#app');
const config = window.DAILY_LEDGER_CONFIG ?? {};

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
  app.innerHTML = `
    <main class="auth-card">
      <p class="eyebrow">每日帳本</p>
      <h1>先連結你的帳本</h1>
      <p>填入 Supabase 專案網址與公開匿名金鑰後，即可使用登入連結或 Google 登入，安全建立個人帳本。</p>
      <p class="notice">這兩項設定需在部署前填入 <code>config.js</code>；不要把服務角色金鑰放入前端。</p>
    </main>`;
}

function renderSignIn() {
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

async function renderLedger(ledger, user, expenseAdapter) {
  let financialOverview = null;
  try {
    const period = await expenseAdapter.ensureCurrentAccountingPeriod(ledger.id);
    const [settings, otherIncomeEntries, fixedExpenseRules] = await Promise.all([
      expenseAdapter.getFinancialSettings(ledger.id),
      expenseAdapter.listOtherIncomeEntries({
        ledgerId: ledger.id,
        startsOn: period.starts_on,
        endsOn: period.ends_on,
      }),
      expenseAdapter.listFixedExpenseRules(ledger.id),
    ]);
    financialOverview = { period, settings, otherIncomeEntries, fixedExpenseRules };
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
  const calculatedSummary = financialOverview ? calculateFinancialSummary({
    periodEntries,
    fixedExpenseRules: financialOverview.fixedExpenseRules,
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
  const categoryOptions = ledger.categories
    .filter((category) => !category.retiredAt)
    .map((category) => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`)
    .join('');
  const dailyHistory = groupExpenseEntriesByDay(suggestions);
  const suggestionButtons = dailyHistory.map((day) => `
    <details class="day-expense-group">
      <summary class="day-expense-summary">
        <span class="day-summary-date">
          <time datetime="${escapeHtml(day.key)}">${escapeHtml(formatEntryDate(day.occurredAt))}</time>
          <small>${day.entries.length} 筆</small>
        </span>
        <span class="day-payment-total"><small>現金</small><strong>$${formatAmount(day.cashTotal)}</strong></span>
        <span class="day-payment-total"><small>信用卡</small><strong>$${formatAmount(day.creditCardTotal)}</strong></span>
        <span class="day-summary-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div class="day-expense-list">
        ${day.entries.map((entry) => `
          <button class="day-expense-entry" type="button" data-suggestion-index="${suggestionIndexById.get(entry.id)}">
            <span class="entry-date"><time datetime="${escapeHtml(entry.occurred_at)}">${escapeHtml(formatEntryTime(entry.occurred_at))}</time></span>
            <span class="entry-detail">
              <strong>$${formatAmount(entry.amount)}・${escapeHtml(entry.item_name)}</strong>
              <small>${escapeHtml(categoryNames.get(entry.category_id) || '未分類')}・${entry.payment_method === 'cash' ? '現金' : '信用卡'}</small>
            </span>
          </button>`).join('')}
      </div>
    </details>`).join('');

  const periodLabel = `${formatEntryDate(periodStart)}－${formatEntryDate(new Date(periodEnd.getTime() - 1))}`;
  const periodMonthLabel = new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: 'long',
  }).format(periodStart);
  const salaryAmount = financialOverview?.period.salary_amount ?? 0;
  const otherIncomeTotal = calculatedSummary?.otherIncomeTotal ?? 0;
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
  const fixedExpenseDialogs = financialOverview?.fixedExpenseRules.map((rule) => `
    <dialog class="finance-dialog fixed-detail-dialog" id="fixed-rule-detail-${escapeHtml(rule.id)}">
      <div class="dialog-content">
        <div class="dialog-heading">
          <div><p class="eyebrow">固定開銷明細</p><h2>${escapeHtml(rule.item_name)}</h2></div>
          <button class="dialog-close" type="button" data-action="close-dialog" aria-label="關閉">×</button>
        </div>
        <dl class="fixed-detail-list">
          <div><dt>金額</dt><dd>$${formatAmount(rule.amount)}</dd></div>
          <div><dt>分類</dt><dd>${escapeHtml(categoryNames.get(rule.category_id) || '未分類')}</dd></div>
          <div><dt>付款方式</dt><dd>${rule.payment_method === 'cash' ? '現金' : '信用卡'}</dd></div>
          <div><dt>每月產生日</dt><dd>${rule.scheduled_day} 日</dd></div>
        </dl>
        <p class="dialog-note">刪除後未來不再自動產生，已經產生的歷史紀錄仍會保留。</p>
        <button
          class="fixed-rule-delete"
          type="button"
          data-action="delete-fixed-expense"
          data-rule-id="${escapeHtml(rule.id)}"
          data-rule-name="${escapeHtml(rule.item_name)}"
        >刪除這筆固定開銷</button>
      </div>
    </dialog>`).join('') || '';
  const financialPanel = financialOverview ? `
    <section class="finance-panel">
      <section class="income-overview-section">
        <div class="finance-overview-heading">
          <div>
            <h2>本期收入</h2>
            <p>${escapeHtml(periodMonthLabel)}・合計 NT$ ${formatAmount(totalIncome)}</p>
          </div>
          <button class="text-action" type="button" data-action="open-income-dialog">更新收入</button>
        </div>
        <div class="income-overview-card">
          <div class="income-total-row"><span>本期收入合計</span><strong>$ ${formatAmount(totalIncome)}</strong></div>
          <div class="income-breakdown">
            <div><span class="income-marker salary-marker">＋</span><span><small>薪資收入</small><strong>$ ${formatAmount(salaryAmount)}</strong></span></div>
            <div><span class="income-marker other-marker">＋</span><span><small>其他收入</small><strong>$ ${formatAmount(otherIncomeTotal)}</strong></span></div>
          </div>
        </div>
      </section>
      <section class="fixed-overview-section">
        <div class="finance-overview-heading">
          <div>
            <h2>每期固定開銷</h2>
            <p>${escapeHtml(periodMonthLabel)}・合計 NT$ ${formatAmount(fixedExpenseTotal)}／期</p>
          </div>
          <button class="text-action" type="button" data-action="open-fixed-rule-dialog">＋ 新增</button>
        </div>
        <ul class="fixed-overview-list">${fixedExpenseList || '<li class="fixed-empty-state">尚未設定固定開銷，點「＋新增」開始設定。</li>'}</ul>
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
            <button class="small-primary-button" type="submit">儲存本期資料</button>
            <p class="form-status" id="period-finance-status" aria-live="polite"></p>
          </form>
          <form class="compact-form default-salary-form" id="default-salary-form">
            <label>每期預設薪水
              <input name="defaultSalaryAmount" type="number" min="0" step="1" inputmode="numeric" value="${financialOverview.settings.default_salary_amount}" required />
            </label>
            <button class="secondary-button" type="submit">套用至未來週期</button>
            <p class="form-status" id="default-salary-status" aria-live="polite"></p>
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
    <section class="finance-panel migration-notice">
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
      <section class="chart-panel" aria-label="本期開銷分類占比">
        <div class="chart-heading">
          <div>
            <p class="eyebrow">本期總覽</p>
            <h2>分類占比</h2>
          </div>
          <span>${escapeHtml(periodLabel)}</span>
        </div>
        <div class="chart-body">
          <div class="expense-pie" role="img" aria-label="本期分類圓餅圖" style="background:${pieBackground}">
            <div><span>已產生開銷</span><strong>$${formatAmount(generatedExpenseTotal)}</strong></div>
          </div>
          <ul class="chart-legend">${chartLegend || '<li class="empty-chart">新增開銷後會顯示分類占比</li>'}</ul>
        </div>
      </section>
      <section class="summary-panel" aria-label="本期帳務摘要">
        <div><span>本期收入</span><strong>${totalIncome === null ? '—' : `$${formatAmount(totalIncome)}`}</strong></div>
        <div><span>非固定現金</span><strong>$${formatAmount(cashTotal)}</strong></div>
        <div><span>非固定信用卡</span><strong>$${formatAmount(creditCardTotal)}</strong></div>
        <div><span>非固定總開銷</span><strong>$${formatAmount(nonFixedExpenseTotal)}</strong></div>
        <div><span>本期固定開銷</span><strong>${fixedExpenseTotal === null ? '—' : `$${formatAmount(fixedExpenseTotal)}`}</strong></div>
        <div class="savings-summary"><span>本期可存額</span><strong>${financialOverview && !previousCardBillReady ? '待輸入帳單' : savingsAmount === null ? '—' : `$${formatAmount(savingsAmount)}`}</strong></div>
      </section>
      ${financialPanel}
      <section class="quick-entry-panel">
        <div>
          <p class="eyebrow">快速記帳</p>
          <h2>新增一筆開銷</h2>
        </div>
        <form class="expense-form" id="expense-form">
          <label>金額
            <input id="expense-amount" name="amount" type="number" min="1" step="1" inputmode="numeric" placeholder="例如 100" required autofocus />
          </label>
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
          <label>日期與時間
            <input id="expense-occurred-at" name="occurredAt" type="datetime-local" value="${toDateTimeLocalValue()}" required />
          </label>
          <button class="email-button" type="submit">儲存開銷</button>
          <p class="form-status" id="expense-status" aria-live="polite"></p>
        </form>
      </section>
      <section class="history-panel">
        <div>
          <p class="eyebrow">歷史建議</p>
          <h2>近期紀錄</h2>
        </div>
        ${suggestionButtons || '<p class="next-step">第一筆開銷會出現在這裡，之後可點選快速帶入。</p>'}
      </section>
    </main>`;

  document.querySelector('#sign-out').addEventListener('click', () => {
    window.localStorage.removeItem('daily-ledger-session');
    renderSignIn();
  });

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
      await renderLedger(ledger, user, expenseAdapter);
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
    }
  });

  if (financialOverview) {
    const openDialog = (dialogId) => {
      const dialog = document.getElementById(dialogId);
      if (dialog && !dialog.open) dialog.showModal();
    };

    document.querySelector('[data-action="open-income-dialog"]').addEventListener('click', () => {
      openDialog('income-dialog');
    });
    document.querySelector('[data-action="open-fixed-rule-dialog"]').addEventListener('click', () => {
      openDialog('fixed-rule-dialog');
    });
    document.querySelectorAll('[data-action="open-fixed-expense"]').forEach((button) => {
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
      button.disabled = true;
      status.textContent = '正在儲存…';
      try {
        await expenseAdapter.updateAccountingPeriod({
          ledgerId: ledger.id,
          startsOn: financialOverview.period.starts_on,
          salaryAmount: Number(formData.get('salaryAmount')),
          previousCardBillAmount: zeroConfirmed || billValue === '' ? null : Number(billValue),
          previousCardBillZeroConfirmed: zeroConfirmed,
        });
        await renderLedger(ledger, user, expenseAdapter);
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
      }
    });

    document.querySelector('#default-salary-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const formData = new FormData(form);
      const button = form.querySelector('button[type="submit"]');
      const status = document.querySelector('#default-salary-status');
      button.disabled = true;
      status.textContent = '正在儲存…';
      try {
        await expenseAdapter.updateFinancialSettings({
          ledgerId: ledger.id,
          cycleStartDay: financialOverview.settings.cycle_start_day,
          defaultSalaryAmount: Number(formData.get('defaultSalaryAmount')),
        });
        await renderLedger(ledger, user, expenseAdapter);
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
        await renderLedger(ledger, user, expenseAdapter);
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
        await renderLedger(ledger, user, expenseAdapter);
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
      }
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
          await renderLedger(ledger, user, expenseAdapter);
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
      document.querySelector('#expense-occurred-at').value = toDateTimeLocalValue();
      document.querySelector('#expense-amount').focus();
    });
  });
}

async function bootstrap() {
  if (!configured()) {
    renderSetup();
    return;
  }

  const accessToken = await getAccessToken();
  if (!accessToken) {
    renderSignIn();
    return;
  }

  app.innerHTML = '<main class="auth-card"><p>正在準備你的帳本…</p></main>';

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

