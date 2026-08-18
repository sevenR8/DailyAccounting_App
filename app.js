import { LedgerModule } from './ledger-module.js';
import {
  startGoogleSignIn,
  SupabaseConnection,
  SupabaseLedgerAdapter,
} from './supabase-adapter.js';

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
      <p>填入 Supabase 專案網址與公開匿名金鑰後，即可使用 Google 登入並安全建立個人帳本。</p>
      <p class="notice">這兩項設定需在部署前填入 <code>config.js</code>；不要把服務角色金鑰放入前端。</p>
    </main>`;
}

function renderSignIn() {
  app.innerHTML = `
    <main class="auth-card">
      <p class="eyebrow">每日帳本</p>
      <h1>把每一筆開銷記得簡單。</h1>
      <p>登入後會自動建立你的帳本與六個預設分類。</p>
      <button class="google-button" type="button" id="google-sign-in">使用 Google 繼續</button>
    </main>`;

  document.querySelector('#google-sign-in').addEventListener('click', () => {
    startGoogleSignIn({
      supabaseUrl: config.supabaseUrl,
      redirectTo: window.location.href,
    });
  });
}

function renderLedger(ledger, user) {
  const categories = ledger.categories
    .map((category) => `<li>${escapeHtml(category.name)}</li>`)
    .join('');

  app.innerHTML = `
    <main class="ledger-home">
      <header>
        <div>
          <p class="eyebrow">${escapeHtml(ledger.name)}</p>
          <h1>你好，${escapeHtml(user.user_metadata?.full_name || user.email)}</h1>
        </div>
        <button class="text-button" type="button" id="sign-out">登出</button>
      </header>
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
      <p class="next-step">下一步將加入快速記帳與本期總覽。</p>
    </main>`;

  document.querySelector('#sign-out').addEventListener('click', () => {
    window.localStorage.removeItem('daily-ledger-session');
    renderSignIn();
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
    const ledgerModule = new LedgerModule(
      new SupabaseLedgerAdapter(connection),
    );
    const ledger = await ledgerModule.provisionPersonalLedger({
      userId: user.id,
      displayName: user.user_metadata?.full_name || user.email?.split('@')[0],
    });
    renderLedger(ledger, user);
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

