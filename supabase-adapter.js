const jsonHeaders = (accessToken, anonKey) => ({
  apikey: anonKey,
  Authorization: `Bearer ${accessToken}`,
  'Content-Type': 'application/json',
});

export class SupabaseConnection {
  constructor({ supabaseUrl, supabaseAnonKey, accessToken, fetchImpl = fetch }) {
    this.supabaseUrl = supabaseUrl.replace(/\/$/, '');
    this.supabaseAnonKey = supabaseAnonKey;
    this.accessToken = accessToken;
    this.fetchImpl = fetchImpl;
  }

  async request(path, options = {}) {
    return this.fetchImpl(`${this.supabaseUrl}${path}`, {
      ...options,
      headers: { ...jsonHeaders(this.accessToken, this.supabaseAnonKey), ...options.headers },
    });
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
  }

  async findPersonalLedger(userId) {
    const parameters = new URLSearchParams({
      select: 'id,name,personal_owner_id,ledger_members(user_id,role),categories(id,name,retired_at,created_at)',
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
          retiredAt: category.retired_at,
        })),
    };
  }

  async createPersonalLedger({ displayName }) {
    return this.connection.provisionPersonalLedger(displayName);
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
  const response = await fetchImpl(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/otp`, {
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

