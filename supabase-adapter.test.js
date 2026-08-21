import assert from 'node:assert/strict';
import test from 'node:test';

import { sendMagicLink, SupabaseConnection, SupabaseLedgerAdapter } from './supabase-adapter.js';

const response = (body, ok = true) => ({
  ok,
  json: async () => body,
});

test('帳本連線以 Window 作為瀏覽器 fetch 的呼叫端', async () => {
  const browserFetch = function browserFetch() {
    if (this !== globalThis) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    return response({ id: 'user-1' });
  };
  const connection = new SupabaseConnection({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'public-key',
    accessToken: 'access-token',
    fetchImpl: browserFetch,
  });

  assert.deepEqual(await connection.getUser(), { id: 'user-1' });
});

test('帳本財務設定可讀取與儲存各國生活費基準，尚未升級時安全回退', async () => {
  const calls = [];
  const connection = new SupabaseConnection({
    supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'public-key', accessToken: 'token',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (calls.length === 1) return { ok: false, json: async () => ({ message: 'column does not exist' }) };
      if (options.method === 'POST') return response([{
        ledger_id: 'ledger-1', cycle_start_day: 5, default_salary_amount: 45_000,
        country_living_cost_baselines: { TW: 37000, JP: 38370, KR: 41553, CN: 19000, US: 128000 },
      }]);
      return response([{
        ledger_id: 'ledger-1', cycle_start_day: 5, default_salary_amount: 45_000,
      }]);
    },
  });
  const adapter = new SupabaseLedgerAdapter(connection);

  const legacySettings = await adapter.getFinancialSettings('ledger-1');
  const savedSettings = await adapter.updateFinancialSettings({
    ledgerId: 'ledger-1', cycleStartDay: 5, defaultSalaryAmount: 45_000,
    countryLivingCostBaselines: { TW: 37000, JP: 38370, KR: 41553, CN: 19000, US: 128000 },
  });

  assert.equal(legacySettings.countryBaselinesSupported, false);
  assert.match(calls[0].url, /country_living_cost_baselines/);
  assert.doesNotMatch(calls[1].url, /country_living_cost_baselines/);
  assert.equal(calls[2].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[2].options.body).country_living_cost_baselines, {
    TW: 37000, JP: 38370, KR: 41553, CN: 19000, US: 128000,
  });
  assert.equal(savedSettings.country_living_cost_baselines.US, 128000);
});

test('閒置後憑證失效時會刷新登入憑證並安全重試原本的開銷寫入', async () => {
  const authorizationHeaders = [];
  const tokenRequests = [];
  const connection = new SupabaseConnection({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'public-key',
    accessToken: 'expired-token',
    accessTokenProvider: async ({ forceRefresh }) => {
      tokenRequests.push(forceRefresh);
      return forceRefresh ? 'fresh-token' : 'expired-token';
    },
    fetchImpl: async (_url, options) => {
      authorizationHeaders.push(options.headers.Authorization);
      if (options.headers.Authorization === 'Bearer expired-token') {
        return { ok: false, status: 401, json: async () => ({ message: 'JWT expired' }) };
      }
      return { ok: true, status: 201, json: async () => [{ id: 'expense-1' }] };
    },
  });

  const entry = await new SupabaseLedgerAdapter(connection).createExpenseEntry({
    ledgerId: 'ledger-1',
    categoryId: 'category-1',
    itemName: '早餐',
    amount: 39,
    paymentMethod: 'credit_card',
    occurredAt: '2026-08-19T00:00:00.000Z',
  });

  assert.deepEqual(entry, { id: 'expense-1' });
  assert.deepEqual(authorizationHeaders, ['Bearer expired-token', 'Bearer fresh-token']);
  assert.deepEqual(tokenRequests, [false, true]);
});

test('網路中斷與登入失效會顯示不同錯誤', async () => {
  const offlineConnection = new SupabaseConnection({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'public-key',
    accessToken: 'access-token',
    fetchImpl: async () => { throw new TypeError('Failed to fetch'); },
  });
  const expiredConnection = new SupabaseConnection({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'public-key',
    accessToken: 'expired-token',
    accessTokenProvider: async () => null,
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
  });

  await assert.rejects(
    offlineConnection.request('/rest/v1/expense_entries'),
    /目前無法連線，請確認網路後再試一次/,
  );
  await assert.rejects(
    expiredConnection.request('/rest/v1/expense_entries'),
    /登入已失效，請重新登入/,
  );
});

test('個人帳本佈建保留原始顯示名稱給資料庫決定帳本名稱', async () => {
  const calls = [];
  const connection = new SupabaseConnection({
    supabaseUrl: 'https://example.supabase.co/',
    supabaseAnonKey: 'public-key',
    accessToken: 'access-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ id: 'ledger-1' });
    },
  });

  const adapter = new SupabaseLedgerAdapter(connection);
  await adapter.createPersonalLedger({ ownerId: 'user-1', displayName: '小明' });

  assert.equal(calls[0].url, 'https://example.supabase.co/rest/v1/rpc/provision_personal_ledger');
  assert.deepEqual(JSON.parse(calls[0].options.body), { p_display_name: '小明' });
});

test('帳本查詢只使用目前使用者的個人帳本，並轉成帳本模組契約', async () => {
  let requestUrl;
  const connection = new SupabaseConnection({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'public-key',
    accessToken: 'access-token',
    fetchImpl: async (url) => {
      requestUrl = url;
      return response([{
        id: 'ledger-1',
        name: '小明的帳本',
        personal_owner_id: 'user-1',
        ledger_members: [{ user_id: 'user-1', role: 'owner' }],
        categories: [
          { id: 'category-2', name: '娛樂', is_default: true, retired_at: null, created_at: '2026-08-18T00:01:00Z' },
          { id: 'category-1', name: '貸款', is_default: false, retired_at: null, created_at: '2026-08-18T00:00:00Z' },
        ],
      }]);
    },
  });

  const ledger = await new SupabaseLedgerAdapter(connection).findPersonalLedger('user-1');

  assert.match(requestUrl, /personal_owner_id=eq.user-1/);
  assert.deepEqual(ledger, {
    id: 'ledger-1',
    ownerId: 'user-1',
    name: '小明的帳本',
    members: [{ userId: 'user-1', role: 'owner' }],
    categories: [
      { id: 'category-1', name: '貸款', isDefault: false, analysisNature: 'maintenance', retiredAt: null },
      { id: 'category-2', name: '娛樂', isDefault: true, analysisNature: 'pleasure', retiredAt: null },
    ],
  });
});

test('帳本擁有者可新增、重新命名、停用及重新啟用自訂分類', async () => {
  const calls = [];
  const connection = new SupabaseConnection({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'public-key',
    accessToken: 'access-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const body = JSON.parse(options.body);
      return response([{
        id: 'category-7',
        name: body.name ?? '貸款',
        is_default: false,
        retired_at: body.retired_at ?? null,
      }]);
    },
  });
  const adapter = new SupabaseLedgerAdapter(connection);

  const created = await adapter.createCategory({ ledgerId: 'ledger-1', name: '貸款' });
  const updated = await adapter.updateCategory({
    ledgerId: 'ledger-1',
    categoryId: 'category-7',
    name: '房貸',
    retiredAt: '2026-08-20T00:00:00.000Z',
  });

  assert.equal(calls[0].url, 'https://example.supabase.co/rest/v1/categories');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    ledger_id: 'ledger-1', name: '貸款', is_default: false,
  });
  assert.match(calls[1].url, /categories\?id=eq\.category-7&ledger_id=eq\.ledger-1/);
  assert.equal(calls[1].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    name: '房貸', retired_at: '2026-08-20T00:00:00.000Z',
  });
  assert.deepEqual(created, {
    id: 'category-7', name: '貸款', isDefault: false, analysisNature: 'maintenance', retiredAt: null,
  });
  assert.deepEqual(updated, {
    id: 'category-7', name: '房貸', isDefault: false, analysisNature: 'maintenance',
    retiredAt: '2026-08-20T00:00:00.000Z',
  });
});

test('分析開銷依指定兩期日期範圍讀取且不套用全帳本筆數上限', async () => {
  let requestUrl;
  const connection = new SupabaseConnection({
    supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'public-key', accessToken: 'token',
    fetchImpl: async (url) => { requestUrl = url; return response([]); },
  });

  await new SupabaseLedgerAdapter(connection).listExpenseEntriesForRange({
    ledgerId: 'ledger-1', startsOn: '2026-07-05', endsOn: '2026-09-04',
  });

  assert.match(requestUrl, /occurred_at=gte\.2026-07-05/);
  assert.match(requestUrl, /occurred_at=lt\.2026-09-05/);
  assert.doesNotMatch(requestUrl, /limit=/);
});

test('帳本分析設定可讀取並以雲端程序原子儲存店家別名', async () => {
  const calls = [];
  const connection = new SupabaseConnection({
    supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'public-key', accessToken: 'token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.includes('merchant_groups')) return response([{
        id: 'merchant-1', name: '7-11', group_type: 'convenience', retired_at: null,
        created_at: '2026-08-01T00:00:00Z',
        merchant_aliases: [
          { id: 'alias-2', alias: '711', created_at: '2026-08-02T00:00:00Z' },
          { id: 'alias-1', alias: '7-11', created_at: '2026-08-01T00:00:00Z' },
        ],
      }]);
      return response({ id: 'merchant-1' });
    },
  });
  const adapter = new SupabaseLedgerAdapter(connection);

  const groups = await adapter.listMerchantGroups('ledger-1');
  await adapter.saveMerchantGroup({
    ledgerId: 'ledger-1', groupId: 'merchant-1', name: '7-11',
    groupType: 'convenience', aliases: ['7-11', '711', '統一超商'],
  });

  assert.deepEqual(groups[0].aliases, ['7-11', '711']);
  assert.equal(calls[1].url, 'https://example.supabase.co/rest/v1/rpc/save_merchant_group');
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    p_ledger_id: 'ledger-1', p_group_id: 'merchant-1', p_name: '7-11',
    p_group_type: 'convenience', p_aliases: ['7-11', '711', '統一超商'],
  });
});

test('可讀取指定月份既有的帳務週期資料', async () => {
  let requestUrl;
  const connection = new SupabaseConnection({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'public-key',
    accessToken: 'access-token',
    fetchImpl: async (url) => {
      requestUrl = url;
      return response([{
        starts_on: '2026-07-05',
        ends_on: '2026-08-04',
        salary_amount: 45000,
        previous_card_bill_amount: 6000,
        previous_card_bill_zero_confirmed: false,
      }]);
    },
  });

  const period = await new SupabaseLedgerAdapter(connection).getAccountingPeriod({
    ledgerId: 'ledger-1',
    startsOn: '2026-07-05',
  });

  assert.match(requestUrl, /accounting_periods/);
  assert.match(requestUrl, /starts_on=eq\.2026-07-05/);
  assert.equal(period.salary_amount, 45000);
});

test('Email 登入連結會使用公開匿名金鑰並回到目前網站', async () => {
  const calls = [];
  await sendMagicLink({
    supabaseUrl: 'https://example.supabase.co/',
    supabaseAnonKey: 'public-key',
    email: 'me@example.com',
    redirectTo: 'https://daily-accounting-app.vercel.app/',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({});
    },
  });

  assert.equal(calls[0].url, 'https://example.supabase.co/auth/v1/otp');
  assert.deepEqual(calls[0].options.headers, {
    apikey: 'public-key',
    'Content-Type': 'application/json',
  });
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    email: 'me@example.com',
    create_user: true,
    options: { emailRedirectTo: 'https://daily-accounting-app.vercel.app/' },
  });
});

test('快速記帳會以目前帳本與分類新增一筆開銷', async () => {
  const calls = [];
  const connection = new SupabaseConnection({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'public-key',
    accessToken: 'access-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response([{ id: 'expense-1' }]);
    },
  });

  const entry = await new SupabaseLedgerAdapter(connection).createExpenseEntry({
    ledgerId: 'ledger-1',
    categoryId: 'category-1',
    itemName: '晚餐',
    amount: 100,
    paymentMethod: 'cash',
    occurredAt: '2026-08-18T12:00:00.000Z',
  });

  assert.deepEqual(entry, { id: 'expense-1' });
  assert.equal(calls[0].url, 'https://example.supabase.co/rest/v1/expense_entries');
  assert.equal(calls[0].options.headers.Prefer, 'return=representation');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    ledger_id: 'ledger-1',
    category_id: 'category-1',
    item_name: '晚餐',
    amount: 100,
    payment_method: 'cash',
    occurred_at: '2026-08-18T12:00:00.000Z',
  });
});

test('刪除開銷只會刪除目前帳本中指定的一筆紀錄', async () => {
  const calls = [];
  const connection = new SupabaseConnection({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'public-key',
    accessToken: 'access-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(null);
    },
  });

  await new SupabaseLedgerAdapter(connection).deleteExpenseEntry({
    ledgerId: 'ledger-1',
    entryId: 'expense-1',
  });

  assert.equal(
    calls[0].url,
    'https://example.supabase.co/rest/v1/expense_entries?id=eq.expense-1&ledger_id=eq.ledger-1',
  );
  assert.equal(calls[0].options.method, 'DELETE');
});

test('可修改指定的一筆每日開銷', async () => {
  const calls = [];
  const connection = new SupabaseConnection({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'public-key',
    accessToken: 'access-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response([{ id: 'expense-1' }]);
    },
  });

  await new SupabaseLedgerAdapter(connection).updateExpenseEntry({
    ledgerId: 'ledger-1',
    entryId: 'expense-1',
    categoryId: 'category-2',
    itemName: '午餐',
    amount: 150,
    paymentMethod: 'credit_card',
    occurredAt: '2026-08-19T04:00:00.000Z',
  });

  assert.equal(calls[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    category_id: 'category-2',
    item_name: '午餐',
    amount: 150,
    payment_method: 'credit_card',
    occurred_at: '2026-08-19T04:00:00.000Z',
  });
});

test('固定開銷規則會保存日期、分類與付款方式', async () => {
  const calls = [];
  const connection = new SupabaseConnection({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'public-key',
    accessToken: 'access-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response([{ id: 'fixed-1' }]);
    },
  });

  await new SupabaseLedgerAdapter(connection).createFixedExpenseRule({
    ledgerId: 'ledger-1',
    categoryId: 'category-1',
    itemName: '房租',
    amount: 12000,
    paymentMethod: 'cash',
    scheduledDay: 5,
  });

  assert.equal(calls[0].url, 'https://example.supabase.co/rest/v1/fixed_expense_rules');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    ledger_id: 'ledger-1',
    category_id: 'category-1',
    item_name: '房租',
    amount: 12000,
    payment_method: 'cash',
    scheduled_day: 5,
  });
});

test('年度固定開銷會保存指定月份，並可一次同步拖曳後的順序', async () => {
  const calls = [];
  const connection = new SupabaseConnection({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'public-key',
    accessToken: 'access-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response([{ id: 'fixed-1' }]);
    },
  });
  const adapter = new SupabaseLedgerAdapter(connection);
  adapter.fixedExpenseSchedulingSupported = true;

  await adapter.createFixedExpenseRule({
    ledgerId: 'ledger-1', categoryId: 'category-1', itemName: '年度保費',
    amount: 12000, paymentMethod: 'credit_card', scheduledDay: 20,
    recurrenceType: 'yearly', scheduledMonth: 12, sortOrder: 3,
  });
  await adapter.reorderFixedExpenseRules({
    ledgerId: 'ledger-1',
    ruleIds: ['fixed-3', 'fixed-1', 'fixed-2'],
  });

  assert.deepEqual(JSON.parse(calls[0].options.body), {
    ledger_id: 'ledger-1', category_id: 'category-1', item_name: '年度保費',
    amount: 12000, payment_method: 'credit_card', scheduled_day: 20,
    recurrence_type: 'yearly', scheduled_month: 12, sort_order: 3,
  });
  assert.equal(
    calls[1].url,
    'https://example.supabase.co/rest/v1/rpc/reorder_fixed_expense_rules',
  );
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    p_ledger_id: 'ledger-1',
    p_rule_ids: ['fixed-3', 'fixed-1', 'fixed-2'],
  });
});

test('可修改固定開銷規則並同步本期已產生的固定開銷', async () => {
  const calls = [];
  const connection = new SupabaseConnection({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'public-key',
    accessToken: 'access-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response([{ id: 'fixed-1' }]);
    },
  });
  const adapter = new SupabaseLedgerAdapter(connection);

  await adapter.updateFixedExpenseRule({
    ledgerId: 'ledger-1', ruleId: 'fixed-1', categoryId: 'category-2',
    itemName: '新房租', amount: 10000, paymentMethod: 'cash', scheduledDay: 1,
  });
  await adapter.syncFixedExpenseEntry({
    ledgerId: 'ledger-1', ruleId: 'fixed-1', accountingPeriodStart: '2026-08-05',
    categoryId: 'category-2', itemName: '新房租', amount: 10000,
    paymentMethod: 'cash', occurredAt: '2026-09-01T00:00:00+08:00', shouldExist: true,
  });

  assert.equal(calls[0].options.method, 'PATCH');
  assert.match(calls[0].url, /fixed_expense_rules/);
  assert.equal(calls[1].options.method, 'PATCH');
  assert.match(calls[1].url, /fixed_expense_rule_id=eq\.fixed-1/);
});

test('刪除固定開銷會停用規則並保留既有支出紀錄', async () => {
  const calls = [];
  const connection = new SupabaseConnection({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'public-key',
    accessToken: 'access-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(null);
    },
  });

  await new SupabaseLedgerAdapter(connection).deleteFixedExpenseRule({
    ledgerId: 'ledger-1',
    ruleId: 'fixed-1',
    retiredAt: '2026-08-19T04:30:00.000Z',
  });

  assert.equal(
    calls[0].url,
    'https://example.supabase.co/rest/v1/fixed_expense_rules?id=eq.fixed-1&ledger_id=eq.ledger-1',
  );
  assert.equal(calls[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    retired_at: '2026-08-19T04:30:00.000Z',
  });
});
