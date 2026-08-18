import { LedgerModule } from './ledger-module.js?v=4';
import {
  sendMagicLink,
  startGoogleSignIn,
  SupabaseConnection,
  SupabaseLedgerAdapter,
} from './supabase-adapter.js?v=4';

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
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatEntryDate(value) {
  return new Intl.DateTimeFormat('zh-TW', {
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

async function renderLedger(ledger, user, expenseAdapter) {
  const categories = ledger.categories
    .map((category) => `<li>${escapeHtml(category.name)}</li>`)
    .join('');

  let entries = [];
  try {
    entries = await expenseAdapter.listExpenseEntries(ledger.id);
  } catch (error) {
    entries = [];
  }

  const categoryNames = new Map(ledger.categories.map((category) => [category.id, category.name]));
  const { start: periodStart, end: periodEnd } = currentAccountingPeriod();
  const periodEntries = entries.filter((entry) => {
    const occurredAt = new Date(entry.occurred_at);
    return occurredAt >= periodStart && occurredAt < periodEnd;
  });
  const cashTotal = periodEntries
    .filter((entry) => entry.payment_method === 'cash')
    .reduce((total, entry) => total + entry.amount, 0);
  const creditCardTotal = periodEntries
    .filter((entry) => entry.payment_method === 'credit_card')
    .reduce((total, entry) => total + entry.amount, 0);
  const expenseTotal = cashTotal + creditCardTotal;
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
    chartCursor += (category.amount / expenseTotal) * 100;
    return `${category.color} ${startPercent}% ${chartCursor}%`;
  });
  const pieBackground = chartSegments.length
    ? `conic-gradient(${chartSegments.join(', ')})`
    : 'conic-gradient(#dfe5dc 0 100%)';
  const chartLegend = categoryBreakdown.map((category) => `
    <li>
      <span class="legend-color" style="background:${category.color}"></span>
      <span>${escapeHtml(category.name)}</span>
      <strong>${Math.round((category.amount / expenseTotal) * 100)}%</strong>
      <small>$${formatAmount(category.amount)}</small>
    </li>`).join('');
  const suggestions = entries.slice(0, 6);
  const categoryOptions = ledger.categories
    .filter((category) => !category.retiredAt)
    .map((category) => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`)
    .join('');
  const suggestionButtons = suggestions.map((entry, index) => `
    <button class="suggestion-button" type="button" data-suggestion-index="${index}">
      <span class="entry-date">
        <time datetime="${escapeHtml(entry.occurred_at)}">${escapeHtml(formatEntryDate(entry.occurred_at))}</time>
        <small>${escapeHtml(formatEntryTime(entry.occurred_at))}</small>
      </span>
      <span class="entry-detail">
        <strong>$${formatAmount(entry.amount)}・${escapeHtml(entry.item_name)}</strong>
        <small>${escapeHtml(categoryNames.get(entry.category_id) || '未分類')}・${entry.payment_method === 'cash' ? '現金' : '信用卡'}</small>
      </span>
    </button>`).join('');

  app.innerHTML = `
    <main class="ledger-home">
      <header>
        <div>
          <p class="eyebrow">${escapeHtml(ledger.name)}</p>
          <h1>你好，${escapeHtml(user.user_metadata?.full_name || user.email)}</h1>
        </div>
        <button class="text-button" type="button" id="sign-out">登出</button>
      </header>
      <section class="chart-panel" aria-label="本期開銷分類占比">
        <div class="chart-heading">
          <div>
            <p class="eyebrow">本期總覽</p>
            <h2>分類占比</h2>
          </div>
          <span>${escapeHtml(formatEntryDate(periodStart))}－${escapeHtml(formatEntryDate(new Date(periodEnd.getTime() - 1)))}</span>
        </div>
        <div class="chart-body">
          <div class="expense-pie" role="img" aria-label="本期分類圓餅圖" style="background:${pieBackground}">
            <div><span>本期開銷</span><strong>$${formatAmount(expenseTotal)}</strong></div>
          </div>
          <ul class="chart-legend">${chartLegend || '<li class="empty-chart">新增開銷後會顯示分類占比</li>'}</ul>
        </div>
      </section>
      <section class="welcome-panel">
        <span class="success-mark">✓</span>
        <div>
          <h2>帳本已準備好</h2>
          <p>你的個人帳本、擁有者身分與預設分類已安全建立。</p>
        </div>
      </section>
      <section class="category-panel">
        <h2>預設分類</h2>
        <ul>${categories}</ul>
      </section>
      <section class="summary-panel" aria-label="已記錄開銷摘要">
        <div><span>現金</span><strong>$${formatAmount(cashTotal)}</strong></div>
        <div><span>信用卡</span><strong>$${formatAmount(creditCardTotal)}</strong></div>
        <div><span>本期總額</span><strong>$${formatAmount(expenseTotal)}</strong></div>
      </section>
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

