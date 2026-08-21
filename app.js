import { LedgerModule } from './ledger-module.js?v=44';
import { calculateFinancialSummary } from './financial-summary.js?v=44';
import { parseAmountExpression } from './amount-expression.js?v=44';
import {
  buildExpenseTemplates,
  dailyExpenseTotalTone,
  findExpenseTemplates,
  groupExpenseEntriesByDay,
  inferFrequentPaymentMethod,
} from './daily-history.js?v=44';
import {
  accountingPeriodFromStart,
  compareExpenseTotals,
  scheduledDateInAccountingPeriod,
  shiftAccountingPeriodStart,
} from './accounting-period.js?v=44';
import {
  buildExpenseAnalysis,
  countryBaselinesFromSettings,
  DEFAULT_MERCHANT_GROUPS,
  identifyMerchant,
} from './expense-analysis.js?v=60';
import {
  advanceRepaymentsInPeriod,
  advancesVisibleInPeriod,
  applyPersonalExpenseAmounts,
  decorateExpenseAdvances,
} from './expense-advance.js?v=56';
import {
  sendMagicLink,
  startGoogleSignIn,
  SupabaseConnection,
  SupabaseLedgerAdapter,
} from './supabase-adapter.js?v=69';

const app = document.querySelector('#app');
const config = window.DAILY_LEDGER_CONFIG ?? {};
const EXPENSE_TIME_REFRESH_INTERVAL = 5 * 60 * 1000;
const HISTORY_DISPLAY_LIMIT_STORAGE_KEY = 'daily-ledger-history-display-limit';
const HISTORY_DISPLAY_LIMIT_OPTIONS = ['5', '10', '15', 'all'];
const LEDGER_VIEW_CACHE_STORAGE_KEY = 'daily-ledger-view-cache-v1';
let cleanupLedgerView = () => {};
let accessTokenRefreshPromise = null;
let ledgerViewInteractionVersion = 0;
let ledgerViewSyncBaseline = 0;

const installSwipeBackGesture = ({ gestureTarget, animatedSurface, onBack }) => {
  if (!gestureTarget || !animatedSurface) return;

  const ignoredStartSelector = [
    'input',
    'textarea',
    'select',
    'button',
    'a',
    '[contenteditable="true"]',
    '[data-action="drag-fixed-expense"]',
  ].join(',');
  let startX = null;
  let startY = null;
  let swipeDistance = 0;
  let tracking = false;
  let animationTimer = null;

  const clearSurfaceState = () => {
    if (animationTimer !== null) window.clearTimeout(animationTimer);
    animationTimer = null;
    animatedSurface.classList.remove(
      'is-swipe-backing',
      'is-swipe-resetting',
      'is-swipe-closing',
    );
    animatedSurface.style.removeProperty('--swipe-back-distance');
  };

  const resetTracking = () => {
    startX = null;
    startY = null;
    swipeDistance = 0;
    tracking = false;
  };

  const restoreSurface = () => {
    animatedSurface.classList.remove('is-swipe-backing');
    animatedSurface.classList.add('is-swipe-resetting');
    animatedSurface.style.setProperty('--swipe-back-distance', '0px');
    animationTimer = window.setTimeout(clearSurfaceState, 180);
    resetTracking();
  };

  const startSwipeBack = (event) => {
    const openDialog = event.target.closest('dialog[open]');
    if (
      window.innerWidth >= 900
      || event.touches.length !== 1
      || (openDialog && openDialog !== gestureTarget)
      || event.target.closest(ignoredStartSelector)
    ) return;
    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    swipeDistance = 0;
    tracking = true;
    clearSurfaceState();
  };

  const moveSwipeBack = (event) => {
    if (!tracking || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const horizontalDistance = touch.clientX - startX;
    const verticalDistance = touch.clientY - startY;
    if (
      Math.abs(verticalDistance) > 28
      && Math.abs(verticalDistance) > Math.abs(horizontalDistance)
    ) {
      clearSurfaceState();
      resetTracking();
      return;
    }
    if (horizontalDistance <= 0) return;

    swipeDistance = Math.min(horizontalDistance, window.innerWidth);
    if (swipeDistance > 6 && event.cancelable) event.preventDefault();
    animatedSurface.classList.add('is-swipe-backing');
    animatedSurface.style.setProperty('--swipe-back-distance', `${swipeDistance}px`);
  };

  const finishSwipeBack = () => {
    if (!tracking) return;
    const closeThreshold = Math.min(72, window.innerWidth * 0.22);
    if (swipeDistance < closeThreshold) {
      restoreSurface();
      return;
    }

    animatedSurface.classList.remove('is-swipe-backing');
    animatedSurface.classList.add('is-swipe-closing');
    animatedSurface.style.setProperty('--swipe-back-distance', '105vw');
    animationTimer = window.setTimeout(() => {
      clearSurfaceState();
      resetTracking();
      window.requestAnimationFrame(onBack);
    }, 180);
  };

  const cancelSwipeBack = () => {
    if (tracking) restoreSurface();
  };

  gestureTarget.addEventListener('touchstart', startSwipeBack, { passive: true });
  gestureTarget.addEventListener('touchmove', moveSwipeBack, { passive: false });
  gestureTarget.addEventListener('touchend', finishSwipeBack, { passive: true });
  gestureTarget.addEventListener('touchcancel', cancelSwipeBack, { passive: true });
};

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

function sessionUserId(session) {
  try {
    const payload = session?.accessToken?.split('.')[1];
    if (!payload) return null;
    const normalizedPayload = payload.replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = normalizedPayload.padEnd(
      normalizedPayload.length + ((4 - (normalizedPayload.length % 4)) % 4),
      '=',
    );
    return JSON.parse(window.atob(paddedPayload)).sub ?? null;
  } catch (error) {
    return null;
  }
}

function readCachedLedgerView(session) {
  try {
    const cachedValue = window.localStorage.getItem(LEDGER_VIEW_CACHE_STORAGE_KEY);
    if (!cachedValue) return null;
    const cachedLedgerView = JSON.parse(cachedValue);
    const userId = sessionUserId(session);
    if (!userId || cachedLedgerView.userId !== userId) return null;
    if (!cachedLedgerView.ledger || !cachedLedgerView.user || !cachedLedgerView.viewData) return null;
    return cachedLedgerView;
  } catch (error) {
    return null;
  }
}

function saveCachedLedgerView({ ledger, user, selectedStartsOn, viewData }) {
  if (!ledger?.id || !user?.id || !viewData?.cacheable) return;
  if (viewData.financialOverview && !viewData.financialOverview.isCurrentPeriod) return;
  try {
    window.localStorage.setItem(LEDGER_VIEW_CACHE_STORAGE_KEY, JSON.stringify({
      userId: user.id,
      cachedAt: Date.now(),
      ledger,
      user,
      selectedStartsOn,
      viewData,
    }));
  } catch (error) {
    // 快取空間不足不應影響正常記帳與同步。
  }
}

function clearCachedLedgerView() {
  window.localStorage.removeItem(LEDGER_VIEW_CACHE_STORAGE_KEY);
}

function ledgerViewHasActiveDraft() {
  const form = document.querySelector('#expense-form');
  if (!form) return false;
  return ledgerViewInteractionVersion !== ledgerViewSyncBaseline
    || Boolean(form.querySelector('[name="amount"]')?.value)
    || Boolean(form.querySelector('[name="itemName"]')?.value)
    || Boolean(form.querySelector('button[type="submit"]')?.disabled);
}

function readHistoryDisplayLimit() {
  const storedLimit = window.localStorage.getItem(HISTORY_DISPLAY_LIMIT_STORAGE_KEY);
  return HISTORY_DISPLAY_LIMIT_OPTIONS.includes(storedLimit) ? storedLimit : '5';
}

async function getAccessToken(session = readSession(), { forceRefresh = false } = {}) {
  if (!session) return null;

  if (!forceRefresh && session.expiresAt > Math.floor(Date.now() / 1000) + 60) {
    return session.accessToken;
  }
  if (!session.refreshToken) return forceRefresh ? null : session.accessToken;

  if (!accessTokenRefreshPromise) {
    accessTokenRefreshPromise = (async () => {
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
    })();
  }

  const activeRefreshPromise = accessTokenRefreshPromise;
  try {
    return await activeRefreshPromise;
  } finally {
    if (accessTokenRefreshPromise === activeRefreshPromise) accessTokenRefreshPromise = null;
  }
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

function renderLedgerResume() {
  cleanupLedgerView();
  app.innerHTML = `
    <main class="ledger-resume" aria-busy="true" aria-label="正在載入帳本">
      <div class="ledger-resume-top"><span class="ledger-resume-avatar" aria-hidden="true"></span></div>
      <section class="ledger-resume-card ledger-resume-summary" aria-hidden="true"></section>
      <section class="ledger-resume-card ledger-resume-primary" aria-hidden="true"></section>
      <section class="ledger-resume-card ledger-resume-secondary" aria-hidden="true"></section>
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

function showExpenseSavedToast({ itemName, amount }) {
  document.querySelector('.expense-saved-toast')?.remove();
  const toast = document.createElement('aside');
  toast.className = 'expense-saved-toast';
  const message = document.createElement('span');
  message.textContent = `已記錄 $${formatAmount(amount)}・${itemName}`;
  toast.append(message);
  document.body.append(toast);
  toast.dismissTimer = window.setTimeout(() => toast.remove(), 3200);
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

function formatAnalysisPercent(value, maximumFractionDigits = 0) {
  return `${new Intl.NumberFormat('zh-TW', { maximumFractionDigits }).format(value || 0)}%`;
}

function renderExpenseAnalysis({
  analysis,
  periodMonthLabel,
  periodLabel,
  canGoNext,
  chartColors,
}) {
  const maximumWeekdayAverage = Math.max(
    1,
    ...analysis.weekdayDistribution.map((weekday) => weekday.average),
  );
  const weekdayRows = analysis.weekdayDistribution.map((weekday) => `
    <li>
      <span>${escapeHtml(weekday.shortLabel)}</span>
      <span class="analysis-bar-track"><span style="width:${Math.max(2, (weekday.average / maximumWeekdayAverage) * 100)}%"></span></span>
      <strong>$${formatAmount(weekday.average)}</strong>
      <small>${weekday.occurrences} 週平均</small>
    </li>`).join('');
  const topItemRows = analysis.topItems.map((item, index) => `
    <tr>
      <td><span class="analysis-rank">${index + 1}</span></td>
      <th scope="row">${escapeHtml(item.name)}<small>${item.count} 筆</small></th>
      <td>$${formatAmount(item.amount)}</td>
    </tr>`).join('');
  const countryCards = analysis.countryComparisons.map((country, index) => `
    <li style="--country-accent:${chartColors[(index + 3) % chartColors.length]}">
      <span>${escapeHtml(country.name)}</span>
      <strong>${formatAnalysisPercent(country.ratio)}</strong>
      <small>我的比例</small>
      <em>${escapeHtml(country.sourceLabel)}・NT$${formatAmount(country.amount)}</em>
    </li>`).join('');
  const merchantBlock = (title, summary, emptyMessage) => `
    <section class="merchant-analysis-block">
      <div class="analysis-subheading">
        <div><p>${escapeHtml(title)}</p><strong>$${formatAmount(summary.total)}</strong></div>
        <div><span>${summary.count} 次</span><small>平均 $${formatAmount(summary.average)}</small></div>
      </div>
      <p class="analysis-share">占日常開銷 ${formatAnalysisPercent(summary.share, 1)}</p>
      <ul>${summary.items.map((item) => `
        <li><span>${escapeHtml(item.name)}<small>${item.count} 次・平均 $${formatAmount(item.average)}</small></span><strong>$${formatAmount(item.amount)}</strong></li>`).join('') || `<li class="analysis-empty">${escapeHtml(emptyMessage)}</li>`}</ul>
    </section>`;
  const nature = analysis.spendingNature;
  const natureTotal = Math.max(1, nature.maintenance.amount + nature.pleasure.amount);
  const pleasureItems = nature.pleasure.items.slice(0, 6).map((item) => `
    <li><span>${escapeHtml(item.name)}<small>${item.count} 筆</small></span><strong>$${formatAmount(item.amount)}</strong></li>`).join('');
  const comparisonValue = (row) => {
    if (row.status === 'new') return '新增';
    if (row.status === 'none') return '本期無開銷';
    if (row.status === 'same') return '0%';
    const arrow = row.status === 'up' ? '↑' : '↓';
    return `${arrow} ${formatAnalysisPercent(Math.abs(row.percentChange), 1)}`;
  };
  const comparisonRows = analysis.comparison.rows.map((row) => `
    <tr>
      <th scope="row">${escapeHtml(row.label)}</th>
      <td>$${formatAmount(row.currentAmount)}</td>
      <td>$${formatAmount(row.previousAmount)}</td>
      <td class="comparison-${row.status}">${escapeHtml(comparisonValue(row))}</td>
    </tr>`).join('');

  return `
    <section class="analysis-page" id="expense-analysis-page" aria-label="${escapeHtml(periodMonthLabel)}消費分析">
      <header class="analysis-page-header">
        <button class="analysis-back" type="button" data-action="close-analysis" aria-label="返回本期總覽">‹</button>
        <div><p class="eyebrow">生活消費誌</p><h1>${escapeHtml(periodMonthLabel)}分析</h1></div>
        <div class="analysis-period-switcher" aria-label="切換分析週期">
          <button type="button" data-analysis-period-direction="previous" aria-label="查看上一期分析">‹</button>
          <span><strong>${escapeHtml(periodMonthLabel)}</strong><small>${escapeHtml(periodLabel)}</small></span>
          <button type="button" data-analysis-period-direction="next" aria-label="查看下一期分析" ${canGoNext ? '' : 'disabled'}>›</button>
        </div>
      </header>

      <section class="analysis-section analysis-totals-section">
        <div class="analysis-section-heading"><p class="eyebrow">01・生活全貌</p><h2>本期生活成本</h2></div>
        <div class="analysis-total-grid">
          <article class="analysis-total-primary"><span>完整生活開銷</span><strong>NT$ ${formatAmount(analysis.totals.completeLivingSpend)}</strong><small>非固定開銷＋本期全部固定開銷</small></article>
          <article><span>日常開銷每日平均</span><strong>NT$ ${formatAmount(analysis.totals.dailyAverage)}</strong><small>非固定開銷・${analysis.period.elapsedDays} 天</small></article>
          <article><span>完整生活成本每日平均</span><strong>NT$ ${formatAmount(analysis.totals.completeDailyAverage)}</strong><small>包含固定成本</small></article>
        </div>
      </section>

      <section class="analysis-section analysis-weekday-section">
        <div class="analysis-section-heading"><p class="eyebrow">02・日常節奏</p><h2>星期消費分布</h2><span>不含固定開銷</span></div>
        <ul class="weekday-analysis">${weekdayRows}</ul>
      </section>

      <section class="analysis-section analysis-top-section">
        <div class="analysis-section-heading"><p class="eyebrow">03・主要去向</p><h2>非固定開銷 Top 10</h2><span>相同項目與店家別名已合併</span></div>
        <div class="analysis-table-scroll"><table class="analysis-top-table"><tbody>${topItemRows || '<tr><td class="analysis-empty">本期尚無非固定開銷</td></tr>'}</tbody></table></div>
      </section>

      <section class="analysis-section analysis-country-section">
        <div class="analysis-section-heading"><p class="eyebrow">04・生活尺度</p><h2>各國生活費比較</h2><span>帳本可設定・單身租房族每月平均</span></div>
        <p class="country-spending-level">你的消費水平為 <strong>${escapeHtml(analysis.spendingLevel)}</strong></p>
        <p class="country-projection">本期完整生活開銷 <strong>NT$ ${formatAmount(analysis.totals.completeLivingSpend)}</strong></p>
        <ul class="country-analysis-grid">${countryCards}</ul>
      </section>

      <section class="analysis-section analysis-merchants-section">
        <div class="analysis-section-heading"><p class="eyebrow">05・生活習慣</p><h2>速食與超商</h2><span>固定開銷不納入</span></div>
        <div class="merchant-analysis-grid">
          ${merchantBlock('速食店', analysis.merchantAnalysis.fastFood, '本期沒有速食店開銷')}
          ${merchantBlock('便利商店', analysis.merchantAnalysis.convenience, '本期沒有便利商店開銷')}
        </div>
      </section>

      <section class="analysis-section analysis-nature-section">
        <div class="analysis-section-heading"><p class="eyebrow">06・消費心情</p><h2>維持生活與快樂支出</h2><span>依分類設定・不含固定開銷</span></div>
        <div class="nature-analysis-grid">
          <div class="nature-balance" role="img" aria-label="維持生活 ${formatAnalysisPercent(nature.maintenance.share)}，快樂支出 ${formatAnalysisPercent(nature.pleasure.share)}">
            <span class="nature-maintenance" style="width:${(nature.maintenance.amount / natureTotal) * 100}%"></span>
            <span class="nature-pleasure" style="width:${(nature.pleasure.amount / natureTotal) * 100}%"></span>
          </div>
          <article><span>維持生活</span><strong>$${formatAmount(nature.maintenance.amount)}</strong><small>${formatAnalysisPercent(nature.maintenance.share)}</small></article>
          <article><span>快樂支出</span><strong>$${formatAmount(nature.pleasure.amount)}</strong><small>${formatAnalysisPercent(nature.pleasure.share)}</small></article>
          <ul class="pleasure-item-list">${pleasureItems || '<li class="analysis-empty">本期尚無快樂支出</li>'}</ul>
        </div>
      </section>

      <section class="analysis-section analysis-comparison-section">
        <div class="analysis-section-heading"><p class="eyebrow">07・前後變化</p><h2>${escapeHtml(analysis.comparison.label)}</h2><span>同期 ${analysis.comparison.elapsedDays} 天・不含固定開銷</span></div>
        <blockquote>${escapeHtml(analysis.comparison.summary)}</blockquote>
        <p class="previous-full-total">完整上期總額 <strong>NT$ ${formatAmount(analysis.comparison.previousFullTotal)}</strong></p>
        <div class="analysis-table-scroll"><table class="comparison-table"><thead><tr><th>項目</th><th>本期同期</th><th>上期同期</th><th>變化</th></tr></thead><tbody>${comparisonRows}</tbody></table></div>
      </section>
    </section>`;
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

async function loadLedgerViewData(ledger, expenseAdapter, selectedStartsOn = null) {
  let entriesLoaded = false;
  const entriesPromise = expenseAdapter.listExpenseEntries(ledger.id)
    .then((entries) => {
      entriesLoaded = true;
      return entries;
    })
    .catch(() => []);

  let financialOverview = null;
  let financialOverviewLoaded = false;
  try {
    const [currentPeriod, settings, fixedExpenseRules] = await Promise.all([
      expenseAdapter.ensureCurrentAccountingPeriod(ledger.id),
      expenseAdapter.getFinancialSettings(ledger.id),
      expenseAdapter.listFixedExpenseRules(ledger.id),
    ]);
    const targetStartsOn = selectedStartsOn ?? currentPeriod.starts_on;
    const isCurrentPeriod = targetStartsOn === currentPeriod.starts_on;
    const isFuturePeriod = targetStartsOn > currentPeriod.starts_on;
    const storedPeriod = isCurrentPeriod
      ? currentPeriod
      : await expenseAdapter.getAccountingPeriod({ ledgerId: ledger.id, startsOn: targetStartsOn });
    const targetBounds = accountingPeriodFromStart(targetStartsOn);
    const fallbackPreviousStartsOn = shiftAccountingPeriodStart(targetStartsOn, -1);
    const previousStoredPeriod = await expenseAdapter.getPreviousAccountingPeriod({
      ledgerId: ledger.id,
      startsOn: targetStartsOn,
    }).catch(() => null);
    const period = storedPeriod ?? {
      ledger_id: ledger.id,
      starts_on: targetBounds.startsOn,
      ends_on: targetBounds.endsOn,
      // 未來週期先沿用上一期作為預設，儲存或修改時才建立該期資料。
      salary_amount: isFuturePeriod
        ? (previousStoredPeriod?.salary_amount ?? settings?.default_salary_amount ?? 0)
        : 0,
      previous_card_bill_amount: isFuturePeriod
        ? (previousStoredPeriod?.previous_card_bill_amount ?? null)
        : null,
      previous_card_bill_zero_confirmed: isFuturePeriod
        ? Boolean(previousStoredPeriod?.previous_card_bill_zero_confirmed)
        : false,
    };
    const previousBounds = accountingPeriodFromStart(fallbackPreviousStartsOn);
    const previousPeriod = previousStoredPeriod ?? {
      starts_on: previousBounds.startsOn,
      ends_on: previousBounds.endsOn,
    };
    const [otherIncomeEntries, analysisEntries, merchantGroups, expenseAdvances] = await Promise.all([
      expenseAdapter.listOtherIncomeEntries({
        ledgerId: ledger.id,
        startsOn: period.starts_on,
        endsOn: period.ends_on,
      }),
      expenseAdapter.listExpenseEntriesForRange({
        ledgerId: ledger.id,
        startsOn: previousPeriod.starts_on,
        endsOn: period.ends_on,
      }),
      expenseAdapter.listMerchantGroups(ledger.id),
      expenseAdapter.listExpenseAdvances(ledger.id),
    ]);
    financialOverview = {
      period,
      previousPeriod,
      settings,
      otherIncomeEntries,
      fixedExpenseRules,
      fixedExpenseSchedulingSupported: expenseAdapter.fixedExpenseSchedulingSupported === true,
      expenseAdvances,
      expenseAdvancesSupported: expenseAdapter.expenseAdvancesSupported === true,
      currentStartsOn: currentPeriod.starts_on,
      isCurrentPeriod,
      isFuturePeriod,
      hasStoredPeriod: Boolean(storedPeriod),
    };
    financialOverview.analysisSettingsSupported = expenseAdapter.expenseAnalysisSettingsSupported === true;
    financialOverview.merchantGroups = merchantGroups;
    financialOverview.analysisEntries = analysisEntries;
    financialOverviewLoaded = true;
  } catch (error) {
    financialOverview = null;
  }

  const entries = await entriesPromise;
  return {
    financialOverview,
    entries,
    analysisEntries: financialOverview?.analysisEntries ?? entries,
    merchantGroups: financialOverview?.merchantGroups ?? [],
    analysisSettingsSupported: financialOverview?.analysisSettingsSupported ?? false,
    cacheable: financialOverviewLoaded || entriesLoaded,
  };
}

async function renderLedger(
  ledger,
  user,
  expenseAdapter,
  selectedStartsOn = null,
  { viewData = null, persistViewData = true } = {},
) {
  const existingLedgerView = app.querySelector('.ledger-home')?.dataset.mobileView;
  const preferredMobileView = ['finance', 'analysis'].includes(existingLedgerView)
    ? existingLedgerView
    : 'main';
  const resolvedViewData = viewData
    ?? await loadLedgerViewData(ledger, expenseAdapter, selectedStartsOn);
  const {
    financialOverview,
    entries,
    analysisEntries = entries,
    merchantGroups = [],
    analysisSettingsSupported = false,
  } = resolvedViewData;
  if (persistViewData) {
    saveCachedLedgerView({
      ledger,
      user,
      selectedStartsOn: financialOverview?.period?.starts_on ?? selectedStartsOn,
      viewData: resolvedViewData,
    });
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
  const periodEntries = analysisEntries.filter((entry) => {
    const occurredAt = new Date(entry.occurred_at);
    return occurredAt >= periodStart && occurredAt < periodEnd;
  });
  const expenseAdvances = decorateExpenseAdvances(financialOverview?.expenseAdvances ?? []);
  const personalAnalysisEntries = applyPersonalExpenseAmounts(analysisEntries, expenseAdvances);
  const personalPeriodEntries = personalAnalysisEntries.filter((entry) => {
    const occurredAt = new Date(entry.occurred_at);
    return occurredAt >= periodStart && occurredAt < periodEnd;
  });
  const periodAdvanceRepayments = financialOverview
    ? advanceRepaymentsInPeriod(
      expenseAdvances,
      financialOverview.period.starts_on,
      financialOverview.period.ends_on,
    )
    : [];
  const isCurrentPeriod = financialOverview?.isCurrentPeriod ?? true;
  const isFuturePeriod = financialOverview?.isFuturePeriod ?? false;
  const isHistoricalPeriod = Boolean(financialOverview && !isCurrentPeriod && !isFuturePeriod);
  const fixedExpensesForSummary = !isHistoricalPeriod
    ? (financialOverview?.fixedExpenseRules ?? []).filter((rule) => scheduledDateInAccountingPeriod(
      financialOverview.period.starts_on,
      financialOverview.period.ends_on,
      rule.scheduled_day,
      rule.recurrence_type === 'yearly' ? rule.scheduled_month : null,
    ))
    : periodEntries.filter((entry) => entry.is_fixed);
  const calculatedSummary = financialOverview ? calculateFinancialSummary({
    periodEntries,
    fixedExpenseRules: fixedExpensesForSummary,
    salaryAmount: financialOverview.period.salary_amount,
    otherIncomeEntries: financialOverview.otherIncomeEntries,
    advanceRepaymentEntries: periodAdvanceRepayments,
    previousCardBillAmount: financialOverview.period.previous_card_bill_amount,
    previousCardBillZeroConfirmed: financialOverview.period.previous_card_bill_zero_confirmed,
  }) : null;
  const cashTotal = calculatedSummary?.cashTotal ?? periodEntries
    .filter((entry) => !entry.is_fixed && entry.payment_method === 'cash')
    .reduce((total, entry) => total + entry.amount, 0);
  const creditCardTotal = calculatedSummary?.creditCardTotal ?? periodEntries
    .filter((entry) => !entry.is_fixed && entry.payment_method === 'credit_card')
    .reduce((total, entry) => total + entry.amount, 0);
  const advanceRepaymentTotal = calculatedSummary?.advanceRepaymentTotal ?? 0;
  const netCashOutflowTotal = calculatedSummary?.netCashOutflowTotal ?? cashTotal;
  const personalNonFixedExpenseTotal = personalPeriodEntries
    .filter((entry) => !entry.is_fixed)
    .reduce((total, entry) => total + entry.amount, 0);
  const generatedExpenseTotal = calculatedSummary?.generatedExpenseTotal
    ?? periodEntries.reduce((total, entry) => total + entry.amount, 0);
  const personalGeneratedExpenseTotal = personalPeriodEntries
    .reduce((total, entry) => total + entry.amount, 0);
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
  const previousPeriodForAnalysis = financialOverview?.previousPeriod
    ? {
      startsOn: financialOverview.previousPeriod.starts_on,
      endsOn: financialOverview.previousPeriod.ends_on,
    }
    : previousStartsOn
      ? accountingPeriodFromStart(previousStartsOn)
      : null;
  const previousPeriodStart = previousPeriodForAnalysis?.startsOn
    ? localDateFromISO(previousPeriodForAnalysis.startsOn)
    : periodStart;
  const previousPeriodEnd = previousPeriodForAnalysis?.endsOn
    ? new Date(localDateFromISO(previousPeriodForAnalysis.endsOn).getTime() + 86_400_000)
    : periodStart;
  const previousEntries = personalAnalysisEntries.filter((entry) => {
    const occurredAt = new Date(entry.occurred_at);
    return occurredAt >= previousPeriodStart && occurredAt < previousPeriodEnd;
  });
  const previousExpenseTotal = previousEntries.reduce((total, entry) => total + entry.amount, 0);
  const periodComparison = compareExpenseTotals(personalGeneratedExpenseTotal, previousExpenseTotal);
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
  const chartColors = [
    '#e07a45', '#3f9ee8', '#e94c64', '#79bf5a',
    '#a274d6', '#e6b83f', '#2db7a3', '#6c72e8',
    '#d86baa', '#9a7152', '#46b8d8', '#a7bf45',
    '#f08a72', '#497f73', '#c75b87', '#7f8fdf',
  ];
  const categoryBreakdown = ledger.categories
    .map((category, index) => ({
      id: category.id,
      name: category.name,
      color: chartColors[index % chartColors.length],
      amount: personalPeriodEntries
        .filter((entry) => entry.category_id === category.id)
        .reduce((total, entry) => total + entry.amount, 0),
    }))
    .filter((category) => category.amount > 0)
    .sort((left, right) => right.amount - left.amount);
  let chartCursor = 0;
  const chartSegments = categoryBreakdown.map((category) => {
    const startPercent = chartCursor;
    chartCursor += (category.amount / personalGeneratedExpenseTotal) * 100;
    return `${category.color} ${startPercent}% ${chartCursor}%`;
  });
  const pieBackground = chartSegments.length
    ? `conic-gradient(${chartSegments.join(', ')})`
    : 'conic-gradient(#dfe5dc 0 100%)';
  const chartLegend = categoryBreakdown.map((category) => `
    <li>
      <span class="legend-color" style="background:${category.color}"></span>
      <span>${escapeHtml(category.name)}</span>
      <strong>${Math.round((category.amount / personalGeneratedExpenseTotal) * 100)}%</strong>
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
  const isLedgerOwner = ledger.ownerId === user.id
    || ledger.members.some((member) => member.userId === user.id && member.role === 'owner');
  const merchantGroupsForAnalysis = merchantGroups.length
    ? merchantGroups
    : DEFAULT_MERCHANT_GROUPS;
  const countryBaselines = countryBaselinesFromSettings(
    financialOverview?.settings?.country_living_cost_baselines,
  );
  const countryBaselinesSupported = financialOverview?.settings?.countryBaselinesSupported !== false;
  const defaultCategoryTags = ledger.categories
    .filter((category) => category.isDefault !== false)
    .map((category) => `<span>${escapeHtml(category.name)}</span>`)
    .join('');
  const customCategoryRows = ledger.categories
    .filter((category) => category.isDefault === false)
    .map((category) => `
      <li class="category-settings-row ${category.retiredAt ? 'is-retired' : ''}">
        <form class="category-settings-form" data-category-id="${escapeHtml(category.id)}">
          <label>
            <span class="sr-only">分類名稱</span>
            <input name="categoryName" type="text" maxlength="50" value="${escapeHtml(category.name)}" required />
          </label>
          <button class="secondary-button" type="submit">儲存</button>
          <button
            class="category-toggle"
            type="button"
            data-action="toggle-category"
            data-category-id="${escapeHtml(category.id)}"
          >${category.retiredAt ? '啟用' : '停用'}</button>
          <p class="form-status" aria-live="polite"></p>
        </form>
      </li>`)
    .join('');
  const categoryAnalysisRows = ledger.categories.map((category) => `
    <li>
      <form class="category-analysis-form" data-category-id="${escapeHtml(category.id)}">
        <span>${escapeHtml(category.name)}</span>
        <select name="analysisNature" aria-label="${escapeHtml(category.name)}的分析性質">
          <option value="maintenance" ${category.analysisNature !== 'pleasure' ? 'selected' : ''}>維持生活</option>
          <option value="pleasure" ${category.analysisNature === 'pleasure' ? 'selected' : ''}>快樂支出</option>
        </select>
        <button class="secondary-button" type="submit">儲存</button>
        <p class="form-status" aria-live="polite"></p>
      </form>
    </li>`).join('');
  const merchantSettingsRows = merchantGroups.map((group) => `
    <li>
      <form class="merchant-settings-form" data-merchant-group-id="${escapeHtml(group.id)}">
        <input name="merchantName" type="text" maxlength="60" value="${escapeHtml(group.name)}" aria-label="店家名稱" required />
        <select name="merchantType" aria-label="店家類型">
          <option value="fast_food" ${group.groupType === 'fast_food' ? 'selected' : ''}>速食店</option>
          <option value="convenience" ${group.groupType === 'convenience' ? 'selected' : ''}>便利商店</option>
          <option value="other" ${group.groupType === 'other' ? 'selected' : ''}>其他分析店家</option>
        </select>
        <textarea name="aliases" rows="2" aria-label="店家別名，每行一個" placeholder="每行輸入一個別名">${escapeHtml(group.aliases.join('\n'))}</textarea>
        <div class="merchant-settings-actions">
          <button class="merchant-retire" type="button" data-action="retire-merchant-group">停用</button>
          <button class="secondary-button" type="submit">儲存規則</button>
        </div>
        <p class="form-status" aria-live="polite"></p>
      </form>
    </li>`).join('');
  const countryBaselineRows = countryBaselines.map((country) => `
    <label>
      <span>${escapeHtml(country.name)}<small>${escapeHtml(country.sourceLabel)}</small></span>
      <input
        name="country-${escapeHtml(country.code)}"
        type="number"
        min="1"
        max="10000000"
        step="1"
        inputmode="numeric"
        value="${country.amount}"
        aria-label="${escapeHtml(country.name)}每月生活費基準"
        required
      />
    </label>`).join('');
  const settingsDialog = `
    <dialog class="finance-dialog settings-dialog" id="ledger-settings-dialog">
      <div class="dialog-content">
        <div class="dialog-heading">
          <div><p class="eyebrow">帳本偏好</p><h2>設定</h2></div>
          <button class="dialog-close" type="button" data-action="close-dialog" aria-label="關閉">×</button>
        </div>
        ${isLedgerOwner ? `
          <section class="settings-section">
            <div>
              <h3>帳務週期</h3>
              <p>設定每期從每月幾日開始，可輸入 1–28。</p>
            </div>
            ${financialOverview ? `
              <form class="cycle-settings-form" id="cycle-settings-form">
                <label>每期從每月第
                  <input name="cycleStartDay" type="number" min="1" max="28" step="1" inputmode="numeric" value="${financialOverview.settings.cycle_start_day}" required />
                  日開始
                </label>
                <button class="small-primary-button" type="submit">儲存週期</button>
                <p class="form-status" aria-live="polite">既有帳務週期與歷史紀錄不會被修改。</p>
              </form>` : '<p class="settings-unavailable">目前無法讀取帳務週期設定。</p>'}
          </section>
          <section class="settings-section">
            <div>
              <h3>自訂分類</h3>
              <p>新增後會出現在快速記帳及固定開銷的分類選單。</p>
            </div>
            <div class="default-category-tags" aria-label="預設分類">${defaultCategoryTags}</div>
            <ul class="category-settings-list">${customCategoryRows || '<li class="empty-category-settings">尚未新增自訂分類</li>'}</ul>
            <form class="category-create-form" id="category-create-form">
              <input name="categoryName" type="text" maxlength="50" placeholder="例如：貸款" aria-label="新增分類名稱" required />
              <button class="small-primary-button" type="submit">新增分類</button>
              <p class="form-status" aria-live="polite"></p>
            </form>
            <p class="dialog-note">停用只會從新的記帳選單隱藏，既有歷史紀錄仍會保留原分類。</p>
          </section>
          <section class="settings-section">
            <div>
              <h3>消費分析分類</h3>
              <p>設定各分類屬於「維持生活」或「快樂支出」；重新命名後仍會保留。</p>
            </div>
            ${analysisSettingsSupported
              ? `<ul class="category-analysis-list">${categoryAnalysisRows}</ul>`
              : '<p class="settings-unavailable">執行 supabase-0004-expense-analysis.sql 後即可同步分析分類。</p>'}
          </section>
          <section class="settings-section">
            <div>
              <h3>速食店、超商與別名</h3>
              <p>每行一個別名。規則只改變分析分組，不會修改原始記帳名稱。</p>
            </div>
            ${analysisSettingsSupported ? `
              <ul class="merchant-settings-list">${merchantSettingsRows}</ul>
              <form class="merchant-create-form" id="merchant-create-form">
                <input name="merchantName" type="text" maxlength="60" placeholder="店家名稱，例如：美廉社" required />
                <select name="merchantType" aria-label="新店家類型">
                  <option value="convenience">便利商店</option>
                  <option value="fast_food">速食店</option>
                  <option value="other">其他分析店家</option>
                </select>
                <textarea name="aliases" rows="2" placeholder="別名，每行一個"></textarea>
                <button class="small-primary-button" type="submit">新增店家規則</button>
                <p class="form-status" aria-live="polite"></p>
              </form>` : '<p class="settings-unavailable">目前先使用內建店家規則；完成資料庫升級後即可自行管理。</p>'}
          </section>
          <section class="settings-section">
            <div>
              <h3>各國生活費基準</h3>
              <p>用於七項消費分析的「我的比例」。以新台幣填寫每月數字，所有帳本成員會共用此設定。</p>
            </div>
            ${financialOverview && countryBaselinesSupported ? `
              <form class="country-baseline-settings-form" id="country-baseline-settings-form">
                <div class="country-baseline-inputs">${countryBaselineRows}</div>
                <button class="small-primary-button" type="submit">儲存生活費基準</button>
                <p class="form-status" aria-live="polite"></p>
              </form>` : '<p class="settings-unavailable">執行 supabase-0007-country-living-cost-baselines.sql 後即可同步管理各國生活費基準。</p>'}
          </section>` : '<p class="settings-unavailable">只有帳本建立者可以修改分類、店家規則、週期與生活費基準。</p>'}
      </div>
    </dialog>`;
  const scheduledMonthOptionsFor = (selectedMonth = 1) => Array.from(
    { length: 12 },
    (_, index) => index + 1,
  ).map((month) => `<option value="${month}" ${month === Number(selectedMonth) ? 'selected' : ''}>${month} 月</option>`).join('');
  const fixedRuleScheduleLabel = (rule) => rule.recurrence_type === 'yearly'
    ? `每年 ${rule.scheduled_month} 月 ${rule.scheduled_day} 日`
    : `每月 ${rule.scheduled_day} 日`;
  const activeCategoryIds = new Set(
    ledger.categories.filter((category) => !category.retiredAt).map((category) => category.id),
  );
  const quickEntryTemplates = buildExpenseTemplates(
    entries.filter((entry) => activeCategoryIds.has(entry.category_id)),
  );
  const personalAmountsByEntryId = new Map(
    personalPeriodEntries.map((entry) => [entry.id, entry.amount]),
  );
  const dailyHistory = groupExpenseEntriesByDay(suggestions, personalAmountsByEntryId);
  const advancesByExpense = expenseAdvances.reduce((groups, advance) => {
    const existing = groups.get(advance.expenseEntryId) ?? [];
    existing.push(advance);
    groups.set(advance.expenseEntryId, existing);
    return groups;
  }, new Map());
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
                <small>${escapeHtml(categoryNames.get(entry.category_id) || '未分類')}・${entry.payment_method === 'cash' ? '現金' : '信用卡'}${advancesByExpense.has(entry.id) ? `・代墊 $${formatAmount(advancesByExpense.get(entry.id).reduce((total, advance) => total + advance.amount, 0))}` : ''}</small>
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
              ${financialOverview?.expenseAdvancesSupported ? `
                <button
                  class="secondary-button"
                  type="button"
                  data-action="open-advance-dialog"
                  data-dialog-id="advance-expense-${escapeHtml(entry.id)}"
                >${advancesByExpense.has(entry.id) ? '管理代墊' : '設為代墊'}</button>` : ''}
              <button class="small-primary-button" type="submit">儲存變更</button>
            </div>
          </form>
        </div>
      </dialog>`).join('');
  const advanceExpenseDialogs = suggestions
    .filter((entry) => !entry.is_fixed)
    .map((entry) => {
      const entryAdvances = advancesByExpense.get(entry.id) ?? [];
      const advancedAmount = entryAdvances.reduce((total, advance) => total + advance.amount, 0);
      const availableAmount = Math.max(0, entry.amount - advancedAmount);
      const existingRows = entryAdvances.map((advance) => `
        <li>
          <button type="button" class="advance-existing-open" data-action="open-advance-dialog" data-dialog-id="advance-detail-${escapeHtml(advance.id)}">
            <span><strong>${escapeHtml(advance.debtorName)}</strong><small>${advance.status === 'settled' ? '已全額收回' : `待收 $${formatAmount(advance.outstandingAmount)}`}</small></span>
            <strong>$${formatAmount(advance.amount)}</strong>
          </button>
        </li>`).join('');
      return `
        <dialog class="finance-dialog advance-expense-dialog" id="advance-expense-${escapeHtml(entry.id)}">
          <div class="dialog-content">
            <div class="dialog-heading">
              <div><p class="eyebrow">共同消費</p><h2>${escapeHtml(entry.item_name)}・$${formatAmount(entry.amount)}</h2></div>
              <button class="dialog-close" type="button" data-action="close-dialog" aria-label="關閉">×</button>
            </div>
            <p class="dialog-note">實際付款仍保留 $${formatAmount(entry.amount)} 供${entry.payment_method === 'cash' ? '現金' : '信用卡'}對帳；收到代墊款後，消費分析才會扣除實際收回金額。</p>
            <ul class="advance-existing-list">${existingRows || '<li class="empty-money-list">這筆開銷尚未設定代墊。</li>'}</ul>
            ${availableAmount > 0 ? `
              <form class="advance-create-form" data-entry-id="${escapeHtml(entry.id)}" data-available-amount="${availableAmount}">
                <label>代墊對象<input name="debtorName" type="text" maxlength="80" placeholder="例如寶貝" required /></label>
                <label>代墊金額<input name="amount" type="number" min="1" max="${availableAmount}" step="1" inputmode="numeric" value="${Math.floor(availableAmount / 2) || availableAmount}" required /></label>
                <label class="edit-form-wide">預計收回日期（選填）<span class="advance-date-control"><input name="expectedOn" type="date" /></span></label>
                <p class="form-status edit-form-wide" aria-live="polite"></p>
                <button class="small-primary-button edit-form-wide" type="submit">儲存代墊</button>
              </form>` : '<p class="dialog-note">這筆開銷的全部金額已分配為代墊。</p>'}
          </div>
        </dialog>`;
    }).join('');

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
  // 未來週期採預覽模式，可直接往下一期瀏覽；尚未儲存的週期會沿用上一期設定。
  const canGoNext = Boolean(financialOverview && nextStartsOn);
  const expenseAnalysis = financialOverview ? buildExpenseAnalysis({
    period: {
      startsOn: financialOverview.period.starts_on,
      endsOn: financialOverview.period.ends_on,
    },
    previousPeriod: previousPeriodForAnalysis,
    currentEntries: personalPeriodEntries,
    previousEntries,
    fixedExpenses: fixedExpensesForSummary,
    categories: ledger.categories,
    merchantGroups: merchantGroupsForAnalysis,
    countryBaselines,
  }) : null;
  const analysisPage = expenseAnalysis ? renderExpenseAnalysis({
    analysis: expenseAnalysis,
    periodMonthLabel,
    periodLabel,
    canGoNext,
    chartColors,
  }) : '';
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
  const supportsFixedExpenseScheduling = financialOverview?.fixedExpenseSchedulingSupported === true;
  const otherIncomeList = financialOverview?.otherIncomeEntries.map((income) => `
    <li><span>${escapeHtml(income.name)}</span><strong>+$${formatAmount(income.amount)}</strong></li>`).join('') || '';
  const outstandingAdvanceTotal = expenseAdvances
    .reduce((total, advance) => total + advance.outstandingAmount, 0);
  const visibleExpenseAdvances = advancesVisibleInPeriod(
    expenseAdvances,
    financialOverview?.period.starts_on,
    financialOverview?.period.ends_on,
  );
  const expenseForAdvance = (advance) => advance.expense
    ?? analysisEntries.find((entry) => entry.id === advance.expenseEntryId)
    ?? { item_name: '原始開銷', amount: advance.amount, occurred_at: advance.createdAt };
  const advanceOverviewRows = [...visibleExpenseAdvances]
    .sort((left, right) => {
      if (left.status === 'settled' && right.status !== 'settled') return 1;
      if (left.status !== 'settled' && right.status === 'settled') return -1;
      return right.createdAt.localeCompare(left.createdAt);
    })
    .map((advance) => {
      const expense = expenseForAdvance(advance);
      const statusLabel = advance.status === 'settled'
        ? '已收回'
        : advance.status === 'partial'
          ? '部分收回'
          : '待收';
      return `
        <li>
          <button type="button" data-action="open-advance-dialog" data-dialog-id="advance-detail-${escapeHtml(advance.id)}">
            <span class="advance-person-mark" aria-hidden="true">${escapeHtml(Array.from(advance.debtorName)[0] || '代')}</span>
            <span class="advance-row-copy">
              <strong>${escapeHtml(advance.debtorName)}・${escapeHtml(expense.item_name)}</strong>
              <small>${escapeHtml(formatEntryDate(expense.occurred_at))}・${statusLabel}</small>
            </span>
            <span class="advance-row-amount"><strong>$${formatAmount(advance.outstandingAmount)}</strong><small>原代墊 $${formatAmount(advance.amount)}</small></span>
          </button>
        </li>`;
    }).join('');
  const advanceDetailDialogs = expenseAdvances.map((advance) => {
    const expense = expenseForAdvance(advance);
    const otherAdvanceAmount = (advancesByExpense.get(advance.expenseEntryId) ?? [])
      .filter((candidate) => candidate.id !== advance.id)
      .reduce((total, candidate) => total + candidate.amount, 0);
    const maximumEditableAmount = Math.max(advance.amount, expense.amount - otherAdvanceAmount);
    const minimumEditableAmount = Math.max(1, advance.receivedAmount);
    const repaymentRows = advance.repayments.map((repayment) => `
      <li><span>${escapeHtml(formatEntryDate(repayment.receivedAt))}・${repayment.receiptMethod === 'cash' ? '現金' : '轉帳'}</span><strong>+$${formatAmount(repayment.amount)}</strong></li>`).join('');
    return `
      <dialog class="finance-dialog advance-detail-dialog" id="advance-detail-${escapeHtml(advance.id)}">
        <div class="dialog-content">
          <div class="dialog-heading">
            <div><p class="eyebrow">代墊紀錄</p><h2>${escapeHtml(advance.debtorName)}・${escapeHtml(expense.item_name)}</h2></div>
            <button class="dialog-close" type="button" data-action="close-dialog" aria-label="關閉">×</button>
          </div>
          <dl class="fixed-detail-list">
            <div><dt>實際支付</dt><dd>$${formatAmount(expense.amount)}</dd></div>
            <div><dt>代墊金額</dt><dd>$${formatAmount(advance.amount)}</dd></div>
            <div><dt>已收回</dt><dd>$${formatAmount(advance.receivedAmount)}</dd></div>
            <div><dt>尚待收回</dt><dd>$${formatAmount(advance.outstandingAmount)}</dd></div>
          </dl>
          <div class="dialog-subsection">
            <h3>編輯代墊</h3>
            <form class="advance-edit-form" data-advance-id="${escapeHtml(advance.id)}" data-minimum-amount="${minimumEditableAmount}" data-maximum-amount="${maximumEditableAmount}">
              <label>代墊對象<input name="debtorName" type="text" maxlength="80" value="${escapeHtml(advance.debtorName)}" required /></label>
              <label>代墊金額<input name="amount" type="number" min="${minimumEditableAmount}" max="${maximumEditableAmount}" step="1" inputmode="numeric" value="${advance.amount}" required /></label>
              <label class="edit-form-wide">預計收回日期（選填）<span class="advance-date-control"><input name="expectedOn" type="date" value="${escapeHtml(advance.expectedOn ?? '')}" /></span></label>
              <p class="form-status edit-form-wide" aria-live="polite"></p>
              <button class="small-primary-button edit-form-wide" type="submit">儲存代墊變更</button>
            </form>
          </div>
          <div class="dialog-subsection">
            <h3>收回紀錄</h3>
            <ul class="money-list">${repaymentRows || '<li class="empty-money-list">尚未收到代墊款</li>'}</ul>
          </div>
          ${advance.outstandingAmount > 0 ? `
            <form class="advance-repayment-form" data-advance-id="${escapeHtml(advance.id)}" data-outstanding-amount="${advance.outstandingAmount}">
              <label>本次收回金額<input name="amount" type="number" min="1" max="${advance.outstandingAmount}" step="1" inputmode="numeric" value="${advance.outstandingAmount}" required /></label>
              <label>收款方式<select name="receiptMethod"><option value="bank_transfer">轉帳</option><option value="cash">現金</option></select></label>
              <label class="edit-form-wide">收到日期與時間<input name="receivedAt" type="datetime-local" value="${toDateTimeLocalValue()}" required /></label>
              <p class="form-status edit-form-wide" aria-live="polite"></p>
              <button class="small-primary-button edit-form-wide" type="submit">記錄收回</button>
            </form>` : '<p class="advance-settled-note">✓ 這筆代墊已全額收回</p>'}
        </div>
      </dialog>`;
  }).join('');
  const fixedExpenseList = financialOverview?.fixedExpenseRules.map((rule) => `
    <li class="fixed-rule-row fixed-rule-sortable" data-rule-id="${escapeHtml(rule.id)}">
      <button
        class="fixed-rule-grip"
        type="button"
        data-action="drag-fixed-expense"
        aria-label="拖曳調整${escapeHtml(rule.item_name)}的位置"
        ${supportsFixedExpenseScheduling ? '' : 'disabled'}
      ><span aria-hidden="true">⠿</span></button>
      <button
        class="fixed-rule-open"
        type="button"
        data-action="open-fixed-expense"
        data-dialog-id="fixed-rule-detail-${escapeHtml(rule.id)}"
        aria-label="查看固定開銷：${escapeHtml(rule.item_name)}"
      >
        <span class="fixed-rule-icon" aria-hidden="true">${escapeHtml((categoryNames.get(rule.category_id) || '固').slice(0, 1))}</span>
        <span class="fixed-rule-name"><strong>${escapeHtml(rule.item_name)}</strong><small>${escapeHtml(fixedRuleScheduleLabel(rule))}・${rule.payment_method === 'cash' ? '現金' : '信用卡'}</small></span>
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
  const displayedFixedExpenseList = isHistoricalPeriod ? historicalFixedExpenseList : fixedExpenseList;
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
          <label>固定金額（TWD）
            <input name="amount" type="number" min="1" step="1" inputmode="numeric" value="${rule.amount}" required />
          </label>
          <label>產生頻率
            <select name="recurrenceType" required>
              <option value="monthly" ${rule.recurrence_type !== 'yearly' ? 'selected' : ''}>每月</option>
              <option value="yearly" ${rule.recurrence_type === 'yearly' ? 'selected' : ''} ${supportsFixedExpenseScheduling ? '' : 'disabled'}>每年</option>
            </select>
          </label>
          <label data-annual-month ${rule.recurrence_type === 'yearly' ? '' : 'hidden'}>扣款月份
            <select name="scheduledMonth" ${rule.recurrence_type === 'yearly' ? '' : 'disabled'}>${scheduledMonthOptionsFor(rule.scheduled_month ?? 1)}</select>
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
  const mobileFinanceHeading = `
    <header class="mobile-finance-heading">
      <button class="mobile-finance-back" type="button" data-action="close-mobile-finance" aria-label="返回本期總覽">‹</button>
      <div>
        <p class="eyebrow">帳務管理</p>
        <h2>收入、帳單與固定開銷</h2>
      </div>
    </header>`;
  const financialPanel = financialOverview ? `
    <section class="finance-panel" id="financial-management-section" data-mobile-section="finance">
      ${mobileFinanceHeading}
      <section class="advance-overview-section">
        <div class="finance-overview-heading">
          <div>
            <h2>待收代墊</h2>
            <p>全部待收 NT$ ${formatAmount(outstandingAdvanceTotal)}・本期已收 NT$ ${formatAmount(advanceRepaymentTotal)}</p>
          </div>
          ${financialOverview.expenseAdvancesSupported
            ? '<span class="period-read-only">從開銷紀錄設定</span>'
            : '<span class="period-read-only">需要資料庫升級</span>'}
        </div>
        ${financialOverview.expenseAdvancesSupported ? `
          <ul class="advance-overview-list">${advanceOverviewRows || '<li class="advance-empty-state">尚無代墊紀錄。需要時可從開銷紀錄打開該筆帳目並設為代墊。</li>'}</ul>`
          : '<p class="advance-migration-note">請在 Supabase SQL Editor 執行 <code>supabase-0005-expense-advances.sql</code>。</p>'}
      </section>
      <section class="income-overview-section">
        <div class="finance-overview-heading">
          <div>
            <h2>本期收入</h2>
            <p>${escapeHtml(periodMonthLabel)}・合計 NT$ ${formatAmount(totalIncome)}</p>
          </div>
          ${!isHistoricalPeriod
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
          ${!isHistoricalPeriod ? 'data-action="open-income-dialog"' : 'disabled'}
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
          ${!isHistoricalPeriod
            ? '<button class="text-action" type="button" data-action="open-fixed-rule-dialog">＋ 新增</button>'
            : '<span class="period-read-only">實際產生</span>'}
        </div>
        <ul class="fixed-overview-list" data-reorderable="${!isHistoricalPeriod && supportsFixedExpenseScheduling ? 'true' : 'false'}">${displayedFixedExpenseList || `<li class="fixed-empty-state">${isHistoricalPeriod ? '這個週期沒有已產生的固定開銷。' : '尚未設定固定開銷，點「＋新增」開始設定。'}</li>`}</ul>
        ${!isHistoricalPeriod && !supportsFixedExpenseScheduling
          ? '<p class="fixed-scheduling-note">執行資料庫升級後，即可拖曳排序並新增每年固定開銷。</p>'
          : '<p class="form-status fixed-order-status" id="fixed-order-status" aria-live="polite"></p>'}
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
            <label>頻率
              <select name="recurrenceType" aria-label="固定開銷產生頻率" required>
                <option value="monthly">每月</option>
                <option value="yearly" ${supportsFixedExpenseScheduling ? '' : 'disabled'}>每年</option>
              </select>
            </label>
            <label data-annual-month hidden>月份
              <select name="scheduledMonth" aria-label="年度固定開銷月份" disabled>${scheduledMonthOptionsFor(1)}</select>
            </label>
            <label>日期<input name="scheduledDay" type="number" min="1" max="28" step="1" inputmode="numeric" value="5" aria-label="固定開銷產生日" required />日</label>
            <button class="secondary-button" type="submit">新增固定開銷</button>
            <p class="form-status" id="fixed-rule-status" aria-live="polite"></p>
          </form>
        </div>
      </dialog>
      ${fixedExpenseDialogs}
      ${advanceDetailDialogs}
    </section>` : `
    <section class="finance-panel migration-notice" id="financial-management-section" data-mobile-section="finance">
      ${mobileFinanceHeading}
      <p class="eyebrow">需要資料庫升級</p>
      <h2>啟用完整本期總覽</h2>
      <p>請在 Supabase SQL Editor 執行 <code>supabase-0002-financial-overview.sql</code>，即可同步本期薪水、其他收入、上期信用卡帳單、固定開銷與可存額。</p>
    </section>`;

  app.innerHTML = `
    <main class="ledger-home" data-mobile-view="${preferredMobileView}">
      <header class="top-bar">
        <span class="user-avatar" title="${escapeHtml(userEmail)}" aria-label="目前使用者：${escapeHtml(userEmail)}">${escapeHtml(userInitial)}</span>
        <details class="user-menu">
          <summary aria-label="開啟帳號選單">…</summary>
          <div class="user-menu-popover">
            <p>${escapeHtml(userEmail)}</p>
            <button class="menu-action" type="button" data-action="open-ledger-settings">帳本設定</button>
            <button class="menu-sign-out" type="button" id="sign-out">登出</button>
          </div>
        </details>
      </header>
      ${settingsDialog}
      ${financialOverview ? `
        <section class="period-navigation" data-mobile-section="overview" aria-label="切換帳務月份">
          <div class="period-switcher">
            <button type="button" data-period-direction="previous" aria-label="查看上一個月">‹</button>
            <span><strong>${escapeHtml(periodMonthLabel)}</strong><small>${escapeHtml(periodShortLabel)}</small></span>
            <button type="button" data-period-direction="next" aria-label="查看下一個月" ${canGoNext ? '' : 'disabled'}>›</button>
          </div>
          <div class="period-comparison comparison-${periodComparison.direction}">${escapeHtml(comparisonText)}</div>
        </section>` : ''}
      <section class="chart-panel chart-panel-action" id="period-overview-section" data-mobile-section="overview" data-action="open-analysis" role="button" tabindex="0" aria-label="本期開銷分類占比，開啟七項消費分析">
        <div class="chart-heading">
          <p class="eyebrow">本期總覽</p>
          <span>${escapeHtml(periodLabel)}</span>
        </div>
        <div class="chart-body">
          <div class="expense-pie" role="img" aria-label="本期分類圓餅圖" style="background:${pieBackground}">
            <div><span>個人開銷</span><strong>$${formatAmount(personalGeneratedExpenseTotal)}</strong></div>
          </div>
          <ul class="chart-legend">${chartLegend || '<li class="empty-chart">新增開銷後會顯示分類占比</li>'}</ul>
        </div>
        <span class="chart-enter-hint">查看七項消費分析 <span aria-hidden="true">›</span></span>
      </section>
      <section class="summary-panel" data-mobile-section="overview" aria-label="本期帳務摘要">
        <button class="summary-mobile-open" type="button" data-action="open-mobile-finance" aria-label="開啟帳務管理，查看與編輯收入、信用卡繳納及固定開銷"></button>
        <div><span>本期收入</span><strong>${totalIncome === null ? '—' : `$${formatAmount(totalIncome)}`}</strong></div>
        <div><span>現金</span><strong>${netCashOutflowTotal < 0 ? '+' : ''}$${formatAmount(Math.abs(netCashOutflowTotal))}</strong></div>
        <div><span>信用卡</span><strong>$${formatAmount(creditCardTotal)}</strong></div>
        <div><span>總開銷</span><strong>$${formatAmount(personalNonFixedExpenseTotal)}</strong></div>
        <div><span>本期固定開銷</span><strong>${fixedExpenseTotal === null ? '—' : `$${formatAmount(fixedExpenseTotal)}`}</strong></div>
        <div class="savings-summary"><span>本期可存額</span><strong>${financialOverview && !previousCardBillReady ? '待輸入帳單' : savingsAmount === null ? '—' : `$${formatAmount(savingsAmount)}`}</strong></div>
      </section>
      ${analysisPage}
      ${advanceExpenseDialogs}
      ${financialPanel}
      <section class="quick-entry-panel" id="quick-entry-section" data-mobile-section="record">
        <div>
          <p class="eyebrow">快速記帳</p>
        </div>
        <form class="expense-form" id="expense-form">
          <label>金額
            <span class="expense-amount-control">
              <input id="expense-amount" name="amount" type="text" inputmode="numeric" pattern="[0-9+＋ ]+" placeholder="例如 39+100" aria-describedby="expense-amount-result" required autofocus />
              <button type="button" data-action="append-amount-plus" aria-label="再加一筆金額">＋</button>
            </span>
            <small class="expense-amount-result" id="expense-amount-result" aria-live="polite"></small>
          </label>
          <fieldset class="payment-method-fieldset" aria-label="付款方式">
            <label><input type="radio" name="paymentMethod" value="cash" checked /> 現金</label>
            <label><input type="radio" name="paymentMethod" value="credit_card" /> 信用卡</label>
          </fieldset>
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
  const expenseAmountResult = document.querySelector('#expense-amount-result');
  const appendAmountPlusButton = document.querySelector('[data-action="append-amount-plus"]');
  const expenseOccurredAtInput = document.querySelector('#expense-occurred-at');
  let expenseOccurredAtManuallyEdited = false;
  let paymentMethodManuallyEdited = false;
  let paymentMethodWasAutoSelected = false;
  const syncExpenseOccurredAt = () => {
    if (expenseOccurredAtManuallyEdited) return;
    expenseOccurredAtInput.value = toDateTimeLocalValue();
  };
  expenseOccurredAtInput.addEventListener('input', () => {
    expenseOccurredAtManuallyEdited = true;
  });
  const applyFrequentPaymentMethod = () => {
    if (paymentMethodManuallyEdited && !paymentMethodWasAutoSelected) return;
    const wasAutoSelected = paymentMethodWasAutoSelected;
    const inferredPaymentMethod = inferFrequentPaymentMethod(
      document.querySelector('#expense-item-name').value,
      quickEntryTemplates,
      (itemName) => identifyMerchant(itemName, merchantGroupsForAnalysis),
    );
    paymentMethodWasAutoSelected = false;
    if (!inferredPaymentMethod) {
      if (wasAutoSelected) {
        document.querySelector('input[name="paymentMethod"][value="cash"]').checked = true;
      }
      return;
    }
    const paymentMethodInput = document.querySelector(
      `input[name="paymentMethod"][value="${inferredPaymentMethod}"]`,
    );
    if (!paymentMethodInput || paymentMethodInput.checked) return;
    paymentMethodInput.checked = true;
    paymentMethodWasAutoSelected = true;
    document.querySelector('#expense-status').textContent = inferredPaymentMethod === 'credit_card'
      ? '已依過往習慣選擇信用卡，仍可手動修改。'
      : '已依過往習慣選擇現金，仍可手動修改。';
  };
  const expenseItemNameInput = document.querySelector('#expense-item-name');
  expenseItemNameInput.addEventListener('input', applyFrequentPaymentMethod);
  document.querySelectorAll('input[name="paymentMethod"]').forEach((input) => {
    input.addEventListener('change', () => {
      paymentMethodManuallyEdited = true;
      paymentMethodWasAutoSelected = false;
    });
  });
  const renderSmartSuggestions = () => {
    const calculatedAmount = parseAmountExpression(expenseAmountInput.value);
    const isAddition = /[+＋]/.test(expenseAmountInput.value);
    const matchingTemplates = findExpenseTemplates(
      quickEntryTemplates,
      calculatedAmount ?? '',
      5,
    );
    expenseAmountResult.textContent = isAddition && calculatedAmount !== null
      ? `= $${formatAmount(calculatedAmount)}`
      : isAddition
        ? '請繼續輸入下一筆金額'
        : '';
    smartSuggestions.hidden = matchingTemplates.length === 0;
    smartSuggestionsTitle.textContent = calculatedAmount !== null
      ? `符合 $${formatAmount(calculatedAmount)}`
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
  appendAmountPlusButton.addEventListener('click', () => {
    const currentValue = expenseAmountInput.value.trim();
    if (currentValue && !/[+＋]$/.test(currentValue)) {
      expenseAmountInput.value = `${currentValue}+`;
      expenseAmountInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    expenseAmountInput.focus();
    expenseAmountInput.setSelectionRange(
      expenseAmountInput.value.length,
      expenseAmountInput.value.length,
    );
  });
  smartSuggestionList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-quick-template-index]');
    if (!button) return;
    const template = quickEntryTemplates[Number(button.dataset.quickTemplateIndex)];
    document.querySelector('#expense-amount').value = template.amount;
    document.querySelector('#expense-item-name').value = template.itemName;
    document.querySelector('#expense-category').value = template.categoryId;
    document.querySelector(`input[name="paymentMethod"][value="${template.paymentMethod}"]`).checked = true;
    paymentMethodManuallyEdited = false;
    paymentMethodWasAutoSelected = true;
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
  const ledgerHome = document.querySelector('.ledger-home');
  const noteLedgerInteraction = () => {
    ledgerViewInteractionVersion += 1;
  };
  ledgerHome.addEventListener('pointerdown', noteLedgerInteraction, { once: true });
  ledgerHome.addEventListener('keydown', noteLedgerInteraction, { once: true });
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
  const showMobileMainSection = (sectionName, targetId) => {
    ledgerHome.dataset.mobileView = 'main';
    setActiveMobileNavigation(sectionName);
    window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };
  const showMobileFinance = () => {
    if (window.innerWidth >= 900) return;
    ledgerHome.dataset.mobileView = 'finance';
    setActiveMobileNavigation('finance');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const closeMobileFinance = () => {
    showMobileMainSection('overview', 'period-overview-section');
  };
  const showExpenseAnalysis = () => {
    ledgerHome.dataset.mobileView = 'analysis';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const closeExpenseAnalysis = () => {
    showMobileMainSection('overview', 'period-overview-section');
  };
  const chartPanelAction = document.querySelector('[data-action="open-analysis"]');
  chartPanelAction?.addEventListener('click', showExpenseAnalysis);
  chartPanelAction?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    showExpenseAnalysis();
  });
  document.querySelector('[data-action="close-analysis"]')?.addEventListener('click', closeExpenseAnalysis);
  document.querySelector('[data-action="open-mobile-finance"]')?.addEventListener('click', showMobileFinance);
  document.querySelector('[data-action="close-mobile-finance"]')?.addEventListener('click', closeMobileFinance);
  const financePanel = document.querySelector('.finance-panel');
  installSwipeBackGesture({
    gestureTarget: financePanel,
    animatedSurface: financePanel,
    onBack: () => showMobileMainSection('overview', 'period-overview-section'),
  });
  const analysisPanel = document.querySelector('.analysis-page');
  installSwipeBackGesture({
    gestureTarget: analysisPanel,
    animatedSurface: analysisPanel,
    onBack: closeExpenseAnalysis,
  });
  mobileNavigationButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.mobileNav === 'finance') {
        showMobileFinance();
        return;
      }
      showMobileMainSection(button.dataset.mobileNav, button.dataset.scrollTarget);
    });
  });
  if (ledgerHome.dataset.mobileView === 'finance') setActiveMobileNavigation('finance');

  let mobileNavigationFrame = null;
  const syncMobileNavigation = () => {
    if (window.innerWidth >= 900) return;
    if (ledgerHome.dataset.mobileView === 'finance') {
      setActiveMobileNavigation('finance');
      return;
    }
    if (ledgerHome.dataset.mobileView === 'analysis') {
      setActiveMobileNavigation('overview');
      return;
    }
    if (mobileNavigationFrame !== null) return;
    mobileNavigationFrame = window.requestAnimationFrame(() => {
      mobileNavigationFrame = null;
      const referenceY = Math.min(window.innerHeight * 0.38, 300);
      const sections = [...document.querySelectorAll('[data-mobile-section]')]
        .filter((section) => section.offsetParent !== null);
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
    try {
      await renderLedger(ledger, user, expenseAdapter, activeStartsOn);
    } catch (error) {
      window.alert(`更新失敗：${error.message}`);
    } finally {
      // renderLedger replaces the view (and its indicator), so clear the
      // gesture state explicitly for both the success and failure paths.
      pullRefreshStarted = false;
      pullRefreshIndicator.classList.remove('is-refreshing');
      resetPullRefresh();
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
    clearCachedLedgerView();
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
    document.querySelector('[data-analysis-period-direction="previous"]')?.addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      await renderLedger(ledger, user, expenseAdapter, previousStartsOn);
    });
    document.querySelector('[data-analysis-period-direction="next"]')?.addEventListener('click', async (event) => {
      if (!canGoNext) return;
      event.currentTarget.disabled = true;
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
    const amount = parseAmountExpression(formData.get('amount'));

    if (!itemName || !Number.isInteger(amount) || amount <= 0) {
      status.textContent = '請填寫正確的整數金額與項目名稱。';
      return;
    }

    button.disabled = true;
    status.textContent = '正在儲存…';
    try {
      const createdEntry = await expenseAdapter.createExpenseEntry({
        ledgerId: ledger.id,
        categoryId: formData.get('categoryId'),
        itemName,
        amount,
        paymentMethod: formData.get('paymentMethod'),
        occurredAt: new Date(formData.get('occurredAt')).toISOString(),
      });
      await renderLedger(ledger, user, expenseAdapter, activeStartsOn);
      showExpenseSavedToast({ itemName, amount });
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
    }
  });

  const openDialog = (dialogId) => {
    const dialog = document.getElementById(dialogId);
    if (dialog && !dialog.open) dialog.showModal();
  };

  const switchDialog = (parentDialog, dialogId) => {
    if (!parentDialog?.open) {
      openDialog(dialogId);
      return;
    }

    parentDialog.addEventListener('close', () => {
      window.requestAnimationFrame(() => openDialog(dialogId));
    }, { once: true });
    parentDialog.close();
  };

  document.querySelectorAll('[data-action="open-advance-dialog"]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const parentDialog = button.closest('dialog');
      switchDialog(parentDialog, button.dataset.dialogId);
    });
  });

  document.querySelectorAll('.advance-create-form').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const amount = Number(formData.get('amount'));
      const debtorName = formData.get('debtorName').trim();
      const availableAmount = Number(form.dataset.availableAmount);
      const button = form.querySelector('button[type="submit"]');
      const status = form.querySelector('.form-status');
      if (!debtorName || !Number.isInteger(amount) || amount <= 0 || amount > availableAmount) {
        status.textContent = `請輸入 1 至 ${formatAmount(availableAmount)} 元的代墊金額。`;
        return;
      }
      button.disabled = true;
      status.textContent = '正在儲存代墊…';
      try {
        await expenseAdapter.createExpenseAdvance({
          ledgerId: ledger.id,
          expenseEntryId: form.dataset.entryId,
          debtorName,
          amount,
          expectedOn: formData.get('expectedOn') || null,
        });
        await renderLedger(ledger, user, expenseAdapter, activeStartsOn);
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll('.advance-edit-form').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const amount = Number(formData.get('amount'));
      const debtorName = formData.get('debtorName').trim();
      const minimumAmount = Number(form.dataset.minimumAmount);
      const maximumAmount = Number(form.dataset.maximumAmount);
      const button = form.querySelector('button[type="submit"]');
      const status = form.querySelector('.form-status');
      if (!debtorName || !Number.isInteger(amount) || amount < minimumAmount || amount > maximumAmount) {
        status.textContent = `請輸入 ${formatAmount(minimumAmount)} 至 ${formatAmount(maximumAmount)} 元的代墊金額。`;
        return;
      }
      button.disabled = true;
      status.textContent = '正在儲存變更…';
      try {
        await expenseAdapter.updateExpenseAdvance({
          ledgerId: ledger.id,
          advanceId: form.dataset.advanceId,
          debtorName,
          amount,
          expectedOn: formData.get('expectedOn') || null,
        });
        await renderLedger(ledger, user, expenseAdapter, activeStartsOn);
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll('.advance-repayment-form').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const amount = Number(formData.get('amount'));
      const outstandingAmount = Number(form.dataset.outstandingAmount);
      const button = form.querySelector('button[type="submit"]');
      const status = form.querySelector('.form-status');
      if (!Number.isInteger(amount) || amount <= 0 || amount > outstandingAmount) {
        status.textContent = `請輸入 1 至 ${formatAmount(outstandingAmount)} 元的收回金額。`;
        return;
      }
      button.disabled = true;
      status.textContent = '正在儲存收回紀錄…';
      try {
        await expenseAdapter.createAdvanceRepayment({
          ledgerId: ledger.id,
          advanceId: form.dataset.advanceId,
          amount,
          receiptMethod: formData.get('receiptMethod'),
          receivedAt: new Date(formData.get('receivedAt')).toISOString(),
        });
        await renderLedger(ledger, user, expenseAdapter, activeStartsOn);
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
      }
    });
  });

  document.querySelector('[data-action="open-ledger-settings"]')?.addEventListener('click', () => {
    const userMenu = document.querySelector('.user-menu');
    if (userMenu) userMenu.open = false;
    openDialog('ledger-settings-dialog');
  });

  document.querySelector('#cycle-settings-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const cycleStartDay = Number(new FormData(form).get('cycleStartDay'));
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector('.form-status');
    if (!Number.isInteger(cycleStartDay) || cycleStartDay < 1 || cycleStartDay > 28) {
      status.textContent = '請輸入 1 到 28 之間的日期。';
      return;
    }
    button.disabled = true;
    status.textContent = '正在儲存…';
    try {
      const settings = await expenseAdapter.updateFinancialSettings({
        ledgerId: ledger.id,
        cycleStartDay,
        defaultSalaryAmount: financialOverview.settings.default_salary_amount,
      });
      financialOverview.settings = settings;
      saveCachedLedgerView({
        ledger,
        user,
        selectedStartsOn: activeStartsOn,
        viewData: resolvedViewData,
      });
      status.textContent = `已設定每月 ${cycleStartDay} 日開始；既有週期不變。`;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector('#country-baseline-settings-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const countryLivingCostBaselines = countryBaselines.reduce((values, country) => {
      values[country.code] = Number(formData.get(`country-${country.code}`));
      return values;
    }, {});
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector('.form-status');
    const invalidCountry = countryBaselines.find((country) => {
      const amount = countryLivingCostBaselines[country.code];
      return !Number.isInteger(amount) || amount < 1 || amount > 10_000_000;
    });
    if (invalidCountry) {
      status.textContent = `請為${invalidCountry.name}輸入 1 到 10,000,000 的整數金額。`;
      return;
    }
    button.disabled = true;
    status.textContent = '正在儲存…';
    try {
      const settings = await expenseAdapter.updateFinancialSettings({
        ledgerId: ledger.id,
        cycleStartDay: financialOverview.settings.cycle_start_day,
        defaultSalaryAmount: financialOverview.settings.default_salary_amount,
        countryLivingCostBaselines,
      });
      financialOverview.settings = { ...settings, countryBaselinesSupported: true };
      await renderLedger(ledger, user, expenseAdapter, activeStartsOn, {
        viewData: resolvedViewData,
      });
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
    }
  });

  document.querySelector('#category-create-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const categoryName = new FormData(form).get('categoryName').trim();
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector('.form-status');
    if (!categoryName) {
      status.textContent = '請輸入分類名稱。';
      return;
    }
    if (ledger.categories.some((category) => category.name.localeCompare(
      categoryName,
      'zh-TW',
      { sensitivity: 'base' },
    ) === 0)) {
      status.textContent = '這個分類名稱已經存在。';
      return;
    }
    button.disabled = true;
    status.textContent = '正在新增…';
    try {
      const category = await expenseAdapter.createCategory({
        ledgerId: ledger.id,
        name: categoryName,
      });
      ledger.categories.push(category);
      await renderLedger(ledger, user, expenseAdapter, activeStartsOn);
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
    }
  });

  document.querySelectorAll('.category-settings-form').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const category = ledger.categories.find((item) => item.id === form.dataset.categoryId);
      const categoryName = new FormData(form).get('categoryName').trim();
      const button = form.querySelector('button[type="submit"]');
      const status = form.querySelector('.form-status');
      if (!categoryName) {
        status.textContent = '請輸入分類名稱。';
        return;
      }
      if (ledger.categories.some((item) => item.id !== category.id && item.name.localeCompare(
        categoryName,
        'zh-TW',
        { sensitivity: 'base' },
      ) === 0)) {
        status.textContent = '這個分類名稱已經存在。';
        return;
      }
      button.disabled = true;
      status.textContent = '正在儲存…';
      try {
        const updatedCategory = await expenseAdapter.updateCategory({
          ledgerId: ledger.id,
          categoryId: category.id,
          name: categoryName,
          retiredAt: category.retiredAt,
        });
        Object.assign(category, updatedCategory);
        await renderLedger(ledger, user, expenseAdapter, activeStartsOn);
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll('[data-action="toggle-category"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const category = ledger.categories.find((item) => item.id === button.dataset.categoryId);
      const form = button.closest('.category-settings-form');
      const status = form.querySelector('.form-status');
      if (!category.retiredAt) {
        const activeCategories = ledger.categories.filter((item) => !item.retiredAt);
        if (activeCategories.length <= 1) {
          status.textContent = '至少需要保留一個啟用中的分類。';
          return;
        }
      }
      button.disabled = true;
      status.textContent = category.retiredAt ? '正在啟用…' : '正在停用…';
      try {
        const updatedCategory = await expenseAdapter.updateCategory({
          ledgerId: ledger.id,
          categoryId: category.id,
          name: category.name,
          retiredAt: category.retiredAt ? null : new Date().toISOString(),
        });
        Object.assign(category, updatedCategory);
        await renderLedger(ledger, user, expenseAdapter, activeStartsOn);
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll('.category-analysis-form').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const category = ledger.categories.find((item) => item.id === form.dataset.categoryId);
      const analysisNature = new FormData(form).get('analysisNature');
      const button = form.querySelector('button[type="submit"]');
      const status = form.querySelector('.form-status');
      button.disabled = true;
      status.textContent = '正在儲存…';
      try {
        const updatedCategory = await expenseAdapter.updateCategory({
          ledgerId: ledger.id,
          categoryId: category.id,
          name: category.name,
          retiredAt: category.retiredAt,
          analysisNature,
        });
        Object.assign(category, updatedCategory);
        await renderLedger(ledger, user, expenseAdapter, activeStartsOn);
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
      }
    });
  });

  const merchantAliasesFrom = (formData) => String(formData.get('aliases') ?? '')
    .split(/[\n,，]+/)
    .map((alias) => alias.trim())
    .filter(Boolean);
  const saveMerchantSettingsForm = async (form, groupId = null) => {
    const formData = new FormData(form);
    const name = formData.get('merchantName').trim();
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector('.form-status');
    if (!name) {
      status.textContent = '請輸入店家名稱。';
      return;
    }
    button.disabled = true;
    status.textContent = '正在儲存…';
    try {
      await expenseAdapter.saveMerchantGroup({
        ledgerId: ledger.id,
        groupId,
        name,
        groupType: formData.get('merchantType'),
        aliases: merchantAliasesFrom(formData),
      });
      await renderLedger(ledger, user, expenseAdapter, activeStartsOn);
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
    }
  };
  document.querySelectorAll('.merchant-settings-form').forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      saveMerchantSettingsForm(form, form.dataset.merchantGroupId);
    });
  });
  document.querySelector('#merchant-create-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveMerchantSettingsForm(event.currentTarget);
  });
  document.querySelectorAll('[data-action="retire-merchant-group"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const form = button.closest('.merchant-settings-form');
      const name = form.elements.merchantName.value;
      if (!window.confirm(`停用「${name}」的分析規則？原始記帳內容不會被修改。`)) return;
      button.disabled = true;
      try {
        await expenseAdapter.retireMerchantGroup({
          ledgerId: ledger.id,
          groupId: form.dataset.merchantGroupId,
          retiredAt: new Date().toISOString(),
        });
        await renderLedger(ledger, user, expenseAdapter, activeStartsOn);
      } catch (error) {
        form.querySelector('.form-status').textContent = error.message;
        button.disabled = false;
      }
    });
  });

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
    installSwipeBackGesture({
      gestureTarget: dialog,
      animatedSurface: dialog,
      onBack: () => dialog.close(),
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

  if (financialOverview && !isHistoricalPeriod) {
    document.querySelectorAll('[data-action="open-income-dialog"]').forEach((button) => {
      button.addEventListener('click', () => openDialog('income-dialog'));
    });
    document.querySelector('[data-action="open-fixed-rule-dialog"]').addEventListener('click', () => {
      openDialog('fixed-rule-dialog');
    });
    document.querySelectorAll('[data-action="open-fixed-expense"]').forEach((button) => {
      button.addEventListener('click', () => openDialog(button.dataset.dialogId));
    });

    const syncFixedRecurrenceFields = (form) => {
      const recurrenceType = form.elements.recurrenceType?.value ?? 'monthly';
      const annualMonthField = form.querySelector('[data-annual-month]');
      const scheduledMonth = form.elements.scheduledMonth;
      const isYearly = recurrenceType === 'yearly';
      if (annualMonthField) annualMonthField.hidden = !isYearly;
      if (scheduledMonth) scheduledMonth.disabled = !isYearly;
    };
    document.querySelectorAll('#fixed-rule-form, .fixed-edit-form').forEach((form) => {
      syncFixedRecurrenceFields(form);
      form.elements.recurrenceType?.addEventListener('change', () => {
        syncFixedRecurrenceFields(form);
      });
    });

    const fixedRuleList = document.querySelector('.fixed-overview-list[data-reorderable="true"]');
    if (fixedRuleList) {
      const fixedOrderStatus = document.querySelector('#fixed-order-status');
      const orderedRuleIds = () => Array.from(
        fixedRuleList.querySelectorAll('.fixed-rule-sortable[data-rule-id]'),
        (row) => row.dataset.ruleId,
      );
      fixedRuleList.addEventListener('selectstart', (event) => {
        if (event.target.closest('.fixed-rule-sortable')) event.preventDefault();
      });
      fixedRuleList.addEventListener('contextmenu', (event) => {
        if (event.target.closest('[data-action="drag-fixed-expense"]')) event.preventDefault();
      });
      fixedRuleList.addEventListener('dragstart', (event) => {
        if (event.target.closest('.fixed-rule-sortable')) event.preventDefault();
      });
      document.querySelectorAll('.fixed-rule-sortable[data-rule-id]').forEach((draggedRow) => {
        let startY = null;
        let isDragging = false;
        let suppressClick = false;
        let originalOrder = [];
        let activeInput = null;
        let longPressTimer = null;
        let touchDragArmed = false;

        const clearLongPressTimer = () => {
          if (longPressTimer !== null) window.clearTimeout(longPressTimer);
          longPressTimer = null;
          touchDragArmed = false;
        };

        const finishDraggingState = () => {
          draggedRow.classList.remove('is-dragging');
          document.documentElement.classList.remove('is-reordering-fixed-expense');
        };

        const restoreOriginalOrder = () => {
          originalOrder.forEach((ruleId) => {
            const row = fixedRuleList.querySelector(`[data-rule-id="${CSS.escape(ruleId)}"]`);
            if (row) fixedRuleList.append(row);
          });
        };

        const beginInteraction = (clientY, inputType) => {
          startY = clientY;
          isDragging = false;
          suppressClick = false;
          activeInput = inputType;
          originalOrder = orderedRuleIds();
        };

        const moveRow = (clientY, moveEvent) => {
          if (startY === null) return;
          const verticalDistance = clientY - startY;
          if (!isDragging && Math.abs(verticalDistance) < 8) return;
          if (!isDragging) {
            isDragging = true;
            suppressClick = true;
            document.getSelection()?.removeAllRanges();
            document.documentElement.classList.add('is-reordering-fixed-expense');
            draggedRow.classList.add('is-dragging');
          }
          const siblings = Array.from(
            fixedRuleList.querySelectorAll('.fixed-rule-sortable'),
          ).filter((row) => row !== draggedRow);
          const nextRow = siblings.find((row) => {
            const bounds = row.getBoundingClientRect();
            return clientY < bounds.top + (bounds.height / 2);
          });
          fixedRuleList.insertBefore(draggedRow, nextRow ?? null);
          if (moveEvent.cancelable) moveEvent.preventDefault();
        };

        const finishReorder = async () => {
          clearLongPressTimer();
          const didReorder = isDragging;
          startY = null;
          activeInput = null;
          isDragging = false;
          finishDraggingState();
          if (!didReorder) return;
          const updatedOrder = orderedRuleIds();
          if (updatedOrder.every((id, index) => id === originalOrder[index])) return;

          fixedOrderStatus.textContent = '正在儲存排列…';
          try {
            await expenseAdapter.reorderFixedExpenseRules({
              ledgerId: ledger.id,
              ruleIds: updatedOrder,
            });
            await renderLedger(ledger, user, expenseAdapter, activeStartsOn);
          } catch (error) {
            fixedOrderStatus.textContent = error.message;
            await renderLedger(ledger, user, expenseAdapter, activeStartsOn);
          }
        };

        const cancelReorder = () => {
          clearLongPressTimer();
          const didReorder = isDragging;
          startY = null;
          activeInput = null;
          isDragging = false;
          finishDraggingState();
          if (didReorder) restoreOriginalOrder();
        };

        draggedRow.addEventListener('pointerdown', (event) => {
          if (event.pointerType !== 'mouse' || event.button !== 0) return;
          beginInteraction(event.clientY, 'mouse');
          document.addEventListener('mousemove', onMouseMove, { passive: false });
          document.addEventListener('mouseup', onMouseUp, { once: true });
        });

        const onMouseMove = (event) => {
          if (activeInput !== 'mouse') return;
          moveRow(event.clientY, event);
        };
        const onMouseUp = () => {
          if (activeInput !== 'mouse') return;
          document.removeEventListener('mousemove', onMouseMove);
          finishReorder();
        };

        draggedRow.addEventListener('touchstart', (event) => {
          if (event.touches.length !== 1) return;
          beginInteraction(event.touches[0].clientY, 'touch');
          longPressTimer = window.setTimeout(() => {
            if (activeInput === 'touch' && startY !== null) touchDragArmed = true;
          }, 1000);
        }, { passive: true });
        draggedRow.addEventListener('touchmove', (event) => {
          if (activeInput !== 'touch' || event.touches.length !== 1) return;
          if (!touchDragArmed) {
            if (Math.abs(event.touches[0].clientY - startY) >= 8) cancelReorder();
            return;
          }
          moveRow(event.touches[0].clientY, event);
        }, { passive: false });
        draggedRow.addEventListener('touchend', () => {
          if (activeInput === 'touch') finishReorder();
        }, { passive: true });
        draggedRow.addEventListener('touchcancel', () => {
          if (activeInput === 'touch') cancelReorder();
        }, { passive: true });

        draggedRow.addEventListener('click', (event) => {
          if (!suppressClick) return;
          event.preventDefault();
          event.stopPropagation();
          suppressClick = false;
        }, true);
      });
    }

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
      const itemName = formData.get('itemName').trim();
      const amount = Number(formData.get('amount'));
      const scheduledDay = Number(formData.get('scheduledDay'));
      const recurrenceType = supportsFixedExpenseScheduling
        ? formData.get('recurrenceType')
        : 'monthly';
      const scheduledMonth = recurrenceType === 'yearly'
        ? Number(formData.get('scheduledMonth'))
        : null;
      if (
        !itemName
        || !Number.isInteger(amount)
        || amount <= 0
        || !Number.isInteger(scheduledDay)
        || scheduledDay < 1
        || scheduledDay > 28
        || (recurrenceType === 'yearly' && (
          !Number.isInteger(scheduledMonth) || scheduledMonth < 1 || scheduledMonth > 12
        ))
      ) {
        status.textContent = '請填寫正確的項目、整數金額與扣款月份／日期。';
        return;
      }
      button.disabled = true;
      status.textContent = '正在新增…';
      try {
        await expenseAdapter.createFixedExpenseRule({
          ledgerId: ledger.id,
          categoryId: formData.get('categoryId'),
          itemName,
          amount,
          paymentMethod: formData.get('paymentMethod'),
          scheduledDay,
          ...(supportsFixedExpenseScheduling ? {
            recurrenceType,
            scheduledMonth,
            sortOrder: Math.max(
              -1,
              ...financialOverview.fixedExpenseRules.map((rule) => Number(rule.sort_order) || 0),
            ) + 1,
          } : {}),
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
        const recurrenceType = supportsFixedExpenseScheduling
          ? formData.get('recurrenceType')
          : 'monthly';
        const scheduledMonth = recurrenceType === 'yearly'
          ? Number(formData.get('scheduledMonth'))
          : null;
        if (
          !itemName
          || !Number.isInteger(amount)
          || amount <= 0
          || !Number.isInteger(scheduledDay)
          || scheduledDay < 1
          || scheduledDay > 28
          || (recurrenceType === 'yearly' && (
            !Number.isInteger(scheduledMonth) || scheduledMonth < 1 || scheduledMonth > 12
          ))
        ) {
          status.textContent = '請填寫正確的項目、整數金額與扣款月份／日期。';
          return;
        }

        const categoryId = formData.get('categoryId');
        const paymentMethod = formData.get('paymentMethod');
        const scheduledOn = scheduledDateInAccountingPeriod(
          financialOverview.period.starts_on,
          financialOverview.period.ends_on,
          scheduledDay,
          recurrenceType === 'yearly' ? scheduledMonth : null,
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
            ...(supportsFixedExpenseScheduling ? {
              recurrenceType,
              scheduledMonth,
            } : {}),
          });
          await expenseAdapter.syncFixedExpenseEntry({
            ledgerId: ledger.id,
            ruleId: form.dataset.ruleId,
            accountingPeriodStart: financialOverview.period.starts_on,
            categoryId,
            itemName,
            amount,
            paymentMethod,
            occurredAt: `${scheduledOn ?? financialOverview.period.starts_on}T00:00:00+08:00`,
            shouldExist: Boolean(scheduledOn && scheduledOn <= taiwanDateISO()),
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

  const storedSession = readSession();
  if (!storedSession) {
    renderSignIn();
    return;
  }

  const cachedLedgerView = readCachedLedgerView(storedSession);
  const connection = new SupabaseConnection({
    supabaseUrl: config.supabaseUrl,
    supabaseAnonKey: config.supabaseAnonKey,
    accessToken: storedSession.accessToken,
    accessTokenProvider: ({ forceRefresh = false } = {}) => getAccessToken(
      readSession(),
      { forceRefresh },
    ),
  });
  const expenseAdapter = new SupabaseLedgerAdapter(connection);

  if (cachedLedgerView) {
    await renderLedger(
      cachedLedgerView.ledger,
      cachedLedgerView.user,
      expenseAdapter,
      cachedLedgerView.selectedStartsOn,
      { viewData: cachedLedgerView.viewData, persistViewData: false },
    );
    ledgerViewSyncBaseline = ledgerViewInteractionVersion;
  } else {
    renderLedgerResume();
  }

  try {
    const accessToken = await getAccessToken(storedSession);
    if (!accessToken) {
      window.localStorage.removeItem('daily-ledger-session');
      clearCachedLedgerView();
      renderSignIn();
      return;
    }
    connection.accessToken = accessToken;

    const user = await connection.getUser();
    const ledgerModule = new LedgerModule(expenseAdapter);
    const ledger = await ledgerModule.provisionPersonalLedger({
      userId: user.id,
      displayName: user.user_metadata?.full_name || user.email?.split('@')[0],
    });
    const freshViewData = await loadLedgerViewData(ledger, expenseAdapter);

    if (!cachedLedgerView) {
      await renderLedger(ledger, user, expenseAdapter, null, { viewData: freshViewData });
    } else if (!ledgerViewHasActiveDraft()) {
      await renderLedger(ledger, user, expenseAdapter, null, { viewData: freshViewData });
    } else {
      saveCachedLedgerView({
        ledger,
        user,
        selectedStartsOn: freshViewData.financialOverview?.period?.starts_on ?? null,
        viewData: freshViewData,
      });
    }
  } catch (error) {
    if (cachedLedgerView) {
      const status = document.querySelector('#expense-status');
      if (status) status.textContent = '目前顯示上次同步資料，恢復連線後即可繼續記帳。';
      return;
    }
    app.innerHTML = `
      <main class="auth-card">
        <p class="eyebrow">每日帳本</p>
        <h1>無法準備帳本</h1>
        <p>${error.message}</p>
        <button class="google-button" type="button" id="retry-sign-in">重新登入</button>
      </main>`;
    document.querySelector('#retry-sign-in').addEventListener('click', () => {
      window.localStorage.removeItem('daily-ledger-session');
      clearCachedLedgerView();
      renderSignIn();
    });
  }
}

bootstrap();
