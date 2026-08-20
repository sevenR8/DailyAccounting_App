const jsonHeaders = (accessToken, anonKey) => ({
  apikey: anonKey,
  Authorization: `Bearer ${accessToken}`,
  'Content-Type': 'application/json',
});

const networkUnavailableError = (cause) => new Error(
  '目前無法連線，請確認網路後再試一次。',
  { cause },
);

const authenticationExpiredError = () => new Error('登入已失效，請重新登入。');

export class SupabaseConnection {
  constructor({
    supabaseUrl,
    supabaseAnonKey,
    accessToken,
    accessTokenProvider = null,
    fetchImpl = fetch,
  }) {
    this.supabaseUrl = supabaseUrl.replace(/\/$/, '');
    this.supabaseAnonKey = supabaseAnonKey;
    this.accessToken = accessToken;
    this.accessTokenProvider = accessTokenProvider;
    this.fetchImpl = fetchImpl;
  }

  async resolveAccessToken(forceRefresh = false) {
    if (!this.accessTokenProvider) return this.accessToken;

    let accessToken;
    try {
      accessToken = await this.accessTokenProvider({ forceRefresh });
    } catch (error) {
      throw networkUnavailableError(error);
    }

    if (accessToken) this.accessToken = accessToken;
    return accessToken;
  }

  async fetchWithAccessToken(path, options, accessToken) {
    try {
      return await this.fetchImpl.call(globalThis, `${this.supabaseUrl}${path}`, {
        ...options,
        headers: { ...jsonHeaders(accessToken, this.supabaseAnonKey), ...options.headers },
      });
    } catch (error) {
      throw networkUnavailableError(error);
    }
  }

  async request(path, options = {}) {
    const accessToken = await this.resolveAccessToken(false);
    if (!accessToken) throw authenticationExpiredError();

    const response = await this.fetchWithAccessToken(path, options, accessToken);
    if (response.status !== 401) return response;
    if (!this.accessTokenProvider) throw authenticationExpiredError();

    const refreshedAccessToken = await this.resolveAccessToken(true);
    if (!refreshedAccessToken) throw authenticationExpiredError();

    const retriedResponse = await this.fetchWithAccessToken(path, options, refreshedAccessToken);
    if (retriedResponse.status === 401) throw authenticationExpiredError();
    return retriedResponse;
  }

  async getUser() {
    const response = await this.request('/auth/v1/user');
    if (!response.ok) {
      throw new Error('登入已失效，請重新使用登入連結或 Google 登入。');
    }

    return response.json();
  }

  async provisionPersonalLedger(displayName) {
    const response = await this.request('/rest/v1/rpc/provision_personal_ledger', {
      method: 'POST',
      body: JSON.stringify({ p_display_name: displayName || null }),
    });

    if (!response.ok) {
      throw new Error('無法建立帳本，請確認 Supabase 設定與登入狀態。');
    }

    return response.json();
  }
}

export class SupabaseLedgerAdapter {
  constructor(connection) {
    this.connection = connection;
    this.fixedExpenseSchedulingSupported = null;
  }

  async findPersonalLedger(userId) {
    const parameters = new URLSearchParams({
      select: 'id,name,personal_owner_id,ledger_members(user_id,role),categories(id,name,is_default,retired_at,created_at)',
      personal_owner_id: `eq.${userId}`,
      limit: '1',
    });
    const response = await this.connection.request(`/rest/v1/ledgers?${parameters}`);

    if (!response.ok) {
      throw new Error('無法讀取既有帳本，請確認 Supabase 設定與登入狀態。');
    }

    const [ledger] = await response.json();
    if (!ledger) return null;

    return {
      id: ledger.id,
      ownerId: ledger.personal_owner_id,
      name: ledger.name,
      members: ledger.ledger_members.map((member) => ({
        userId: member.user_id,
        role: member.role,
      })),
      categories: ledger.categories
        .sort((left, right) => left.created_at.localeCompare(right.created_at))
        .map((category) => ({
          id: category.id,
          name: category.name,
          isDefault: category.is_default === true,
          retiredAt: category.retired_at,
        })),
    };
  }

  async createPersonalLedger({ displayName }) {
    const ledger = await this.connection.provisionPersonalLedger(displayName);
    return {
      ...ledger,
      categories: (ledger.categories ?? []).map((category) => ({
        ...category,
        isDefault: category.isDefault ?? true,
      })),
    };
  }

  async createCategory({ ledgerId, name }) {
    const response = await this.connection.request('/rest/v1/categories', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        ledger_id: ledgerId,
        name,
        is_default: false,
      }),
    });
    if (!response.ok) throw new Error('無法新增分類，請確認名稱沒有重複。');
    const [category] = await response.json();
    return {
      id: category.id,
      name: category.name,
      isDefault: category.is_default === true,
      retiredAt: category.retired_at,
    };
  }

  async updateCategory({ ledgerId, categoryId, name, retiredAt }) {
    const parameters = new URLSearchParams({
      id: `eq.${categoryId}`,
      ledger_id: `eq.${ledgerId}`,
    });
    const response = await this.connection.request(`/rest/v1/categories?${parameters}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ name, retired_at: retiredAt }),
    });
    if (!response.ok) throw new Error('無法更新分類，請確認名稱沒有重複。');
    const [category] = await response.json();
    return {
      id: category.id,
      name: category.name,
      isDefault: category.is_default === true,
      retiredAt: category.retired_at,
    };
  }

  async listExpenseEntries(ledgerId) {
    const parameters = new URLSearchParams({
      select: 'id,category_id,item_name,amount,payment_method,occurred_at,is_fixed,created_at',
      ledger_id: `eq.${ledgerId}`,
      order: 'occurred_at.desc',
      limit: '1000',
    });
    const response = await this.connection.request(`/rest/v1/expense_entries?${parameters}`);
    if (!response.ok) {
      throw new Error('無法讀取開銷紀錄，請稍後再試一次。');
    }
    return response.json();
  }

  async createExpenseEntry({
    ledgerId,
    categoryId,
    itemName,
    amount,
    paymentMethod,
    occurredAt,
  }) {
    const response = await this.connection.request('/rest/v1/expense_entries', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        ledger_id: ledgerId,
        category_id: categoryId,
        item_name: itemName,
        amount,
        payment_method: paymentMethod,
        occurred_at: occurredAt,
      }),
    });
    if (!response.ok) {
      throw new Error('無法儲存這筆開銷，請確認網路後再試一次。');
    }
    const [entry] = await response.json();
    return entry;
  }

  async updateExpenseEntry({
    ledgerId,
    entryId,
    categoryId,
    itemName,
    amount,
    paymentMethod,
    occurredAt,
  }) {
    const parameters = new URLSearchParams({
      id: `eq.${entryId}`,
      ledger_id: `eq.${ledgerId}`,
      is_fixed: 'eq.false',
    });
    const response = await this.connection.request(`/rest/v1/expense_entries?${parameters}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        category_id: categoryId,
        item_name: itemName,
        amount,
        payment_method: paymentMethod,
        occurred_at: occurredAt,
      }),
    });
    if (!response.ok) {
      throw new Error('無法更新這筆開銷，請確認網路後再試一次。');
    }
    const [entry] = await response.json();
    return entry;
  }

  async deleteExpenseEntry({ ledgerId, entryId }) {
    const parameters = new URLSearchParams({
      id: `eq.${entryId}`,
      ledger_id: `eq.${ledgerId}`,
    });
    const response = await this.connection.request(`/rest/v1/expense_entries?${parameters}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
    if (!response.ok) {
      throw new Error('無法刪除這筆開銷，請確認網路後再試一次。');
    }
  }

  async ensureCurrentAccountingPeriod(ledgerId) {
    const response = await this.connection.request('/rest/v1/rpc/ensure_current_accounting_period', {
      method: 'POST',
      body: JSON.stringify({ p_ledger_id: ledgerId }),
    });
    if (!response.ok) {
      throw new Error('financial_overview_migration_required');
    }
    return response.json();
  }

  async getAccountingPeriod({ ledgerId, startsOn }) {
    const parameters = new URLSearchParams({
      select: 'ledger_id,starts_on,ends_on,salary_amount,previous_card_bill_amount,previous_card_bill_zero_confirmed',
      ledger_id: `eq.${ledgerId}`,
      starts_on: `eq.${startsOn}`,
      limit: '1',
    });
    const response = await this.connection.request(`/rest/v1/accounting_periods?${parameters}`);
    if (!response.ok) throw new Error('無法讀取指定帳務週期。');
    const [period] = await response.json();
    return period ?? null;
  }

  async getFinancialSettings(ledgerId) {
    const parameters = new URLSearchParams({
      select: 'ledger_id,cycle_start_day,default_salary_amount,quick_entry_enabled',
      ledger_id: `eq.${ledgerId}`,
      limit: '1',
    });
    const response = await this.connection.request(`/rest/v1/ledger_financial_settings?${parameters}`);
    if (!response.ok) throw new Error('無法讀取帳務設定。');
    const [settings] = await response.json();
    return settings;
  }

  async updateFinancialSettings({ ledgerId, cycleStartDay, defaultSalaryAmount }) {
    const response = await this.connection.request('/rest/v1/ledger_financial_settings', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        ledger_id: ledgerId,
        cycle_start_day: cycleStartDay,
        default_salary_amount: defaultSalaryAmount,
      }),
    });
    if (!response.ok) throw new Error('無法儲存帳務設定。');
    const [settings] = await response.json();
    return settings;
  }

  async updateAccountingPeriod({
    ledgerId,
    startsOn,
    salaryAmount,
    previousCardBillAmount,
    previousCardBillZeroConfirmed,
  }) {
    const parameters = new URLSearchParams({
      ledger_id: `eq.${ledgerId}`,
      starts_on: `eq.${startsOn}`,
    });
    const response = await this.connection.request(`/rest/v1/accounting_periods?${parameters}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        salary_amount: salaryAmount,
        previous_card_bill_amount: previousCardBillAmount,
        previous_card_bill_zero_confirmed: previousCardBillZeroConfirmed,
      }),
    });
    if (!response.ok) throw new Error('無法儲存本期收入與信用卡帳單。');
    const [period] = await response.json();
    return period;
  }

  async listOtherIncomeEntries({ ledgerId, startsOn, endsOn }) {
    const endExclusive = new Date(`${endsOn}T00:00:00Z`);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    const parameters = new URLSearchParams({
      select: 'id,name,amount,received_at,created_at',
      ledger_id: `eq.${ledgerId}`,
      order: 'received_at.desc',
    });
    parameters.append('received_at', `gte.${startsOn}T00:00:00+08:00`);
    parameters.append('received_at', `lt.${endExclusive.toISOString().slice(0, 10)}T00:00:00+08:00`);
    const response = await this.connection.request(`/rest/v1/other_income_entries?${parameters}`);
    if (!response.ok) throw new Error('無法讀取其他收入。');
    return response.json();
  }

  async createOtherIncomeEntry({ ledgerId, name, amount, receivedAt }) {
    const response = await this.connection.request('/rest/v1/other_income_entries', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        ledger_id: ledgerId,
        name,
        amount,
        received_at: receivedAt,
      }),
    });
    if (!response.ok) throw new Error('無法儲存其他收入。');
    const [income] = await response.json();
    return income;
  }

  async listFixedExpenseRules(ledgerId) {
    const parameters = new URLSearchParams({
      select: 'id,category_id,item_name,amount,payment_method,scheduled_day,recurrence_type,scheduled_month,sort_order,active_from,retired_at,created_at',
      ledger_id: `eq.${ledgerId}`,
      retired_at: 'is.null',
      order: 'sort_order.asc,created_at.asc',
    });
    const response = await this.connection.request(`/rest/v1/fixed_expense_rules?${parameters}`);
    if (response.ok) {
      this.fixedExpenseSchedulingSupported = true;
      return response.json();
    }

    const legacyParameters = new URLSearchParams({
      select: 'id,category_id,item_name,amount,payment_method,scheduled_day,active_from,retired_at,created_at',
      ledger_id: `eq.${ledgerId}`,
      retired_at: 'is.null',
      order: 'scheduled_day.asc,created_at.asc',
    });
    const legacyResponse = await this.connection.request(
      `/rest/v1/fixed_expense_rules?${legacyParameters}`,
    );
    if (!legacyResponse.ok) throw new Error('無法讀取固定開銷。');
    this.fixedExpenseSchedulingSupported = false;
    const legacyRules = await legacyResponse.json();
    return legacyRules.map((rule, index) => ({
      ...rule,
      recurrence_type: 'monthly',
      scheduled_month: null,
      sort_order: index,
    }));
  }

  async createFixedExpenseRule({
    ledgerId,
    categoryId,
    itemName,
    amount,
    paymentMethod,
    scheduledDay,
    recurrenceType,
    scheduledMonth,
    sortOrder,
  }) {
    const body = {
      ledger_id: ledgerId,
      category_id: categoryId,
      item_name: itemName,
      amount,
      payment_method: paymentMethod,
      scheduled_day: scheduledDay,
    };
    if (recurrenceType !== undefined || this.fixedExpenseSchedulingSupported === true) {
      Object.assign(body, {
        recurrence_type: recurrenceType ?? 'monthly',
        scheduled_month: recurrenceType === 'yearly' ? scheduledMonth : null,
        sort_order: sortOrder ?? 0,
      });
    }
    const response = await this.connection.request('/rest/v1/fixed_expense_rules', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error('無法儲存固定開銷。');
    const [rule] = await response.json();
    return rule;
  }

  async updateFixedExpenseRule({
    ledgerId,
    ruleId,
    categoryId,
    itemName,
    amount,
    paymentMethod,
    scheduledDay,
    recurrenceType,
    scheduledMonth,
  }) {
    const parameters = new URLSearchParams({
      id: `eq.${ruleId}`,
      ledger_id: `eq.${ledgerId}`,
    });
    const body = {
      category_id: categoryId,
      item_name: itemName,
      amount,
      payment_method: paymentMethod,
      scheduled_day: scheduledDay,
    };
    if (recurrenceType !== undefined || this.fixedExpenseSchedulingSupported === true) {
      Object.assign(body, {
        recurrence_type: recurrenceType ?? 'monthly',
        scheduled_month: recurrenceType === 'yearly' ? scheduledMonth : null,
      });
    }
    const response = await this.connection.request(`/rest/v1/fixed_expense_rules?${parameters}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error('無法更新固定開銷，請稍後再試一次。');
    const [rule] = await response.json();
    return rule;
  }

  async reorderFixedExpenseRules({ ledgerId, ruleIds }) {
    const response = await this.connection.request(
      '/rest/v1/rpc/reorder_fixed_expense_rules',
      {
        method: 'POST',
        body: JSON.stringify({
          p_ledger_id: ledgerId,
          p_rule_ids: ruleIds,
        }),
      },
    );
    if (!response.ok) throw new Error('無法儲存固定開銷順序，請稍後再試一次。');
  }

  async syncFixedExpenseEntry({
    ledgerId,
    ruleId,
    accountingPeriodStart,
    categoryId,
    itemName,
    amount,
    paymentMethod,
    occurredAt,
    shouldExist,
  }) {
    const parameters = new URLSearchParams({
      ledger_id: `eq.${ledgerId}`,
      fixed_expense_rule_id: `eq.${ruleId}`,
      accounting_period_start: `eq.${accountingPeriodStart}`,
    });
    const response = await this.connection.request(`/rest/v1/expense_entries?${parameters}`, {
      method: shouldExist ? 'PATCH' : 'DELETE',
      headers: { Prefer: shouldExist ? 'return=representation' : 'return=minimal' },
      body: shouldExist ? JSON.stringify({
        category_id: categoryId,
        item_name: itemName,
        amount,
        payment_method: paymentMethod,
        occurred_at: occurredAt,
      }) : undefined,
    });
    if (!response.ok) throw new Error('固定開銷已更新，但本期紀錄同步失敗，請重新整理後再試。');
    return shouldExist ? response.json() : null;
  }

  async deleteFixedExpenseRule({ ledgerId, ruleId, retiredAt }) {
    const parameters = new URLSearchParams({
      id: `eq.${ruleId}`,
      ledger_id: `eq.${ledgerId}`,
    });
    const response = await this.connection.request(`/rest/v1/fixed_expense_rules?${parameters}`, {
      method: 'PATCH',
      body: JSON.stringify({ retired_at: retiredAt }),
    });
    if (!response.ok) throw new Error('無法刪除固定開銷，請稍後再試一次。');
  }
}

export function startGoogleSignIn({ supabaseUrl, redirectTo }) {
  const url = new URL(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/authorize`);
  url.searchParams.set('provider', 'google');
  url.searchParams.set('redirect_to', redirectTo);
  window.location.assign(url.toString());
}

export async function sendMagicLink({
  supabaseUrl,
  supabaseAnonKey,
  email,
  redirectTo,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl.call(globalThis, `${supabaseUrl.replace(/\/$/, '')}/auth/v1/otp`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      create_user: true,
      options: { emailRedirectTo: redirectTo },
    }),
  });

  if (!response.ok) {
    throw new Error('無法寄送登入連結。請確認 Supabase 的 Email 登入已啟用後再試一次。');
  }
}
