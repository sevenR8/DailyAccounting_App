const jsonHeaders = (accessToken, anonKey) => ({
  apikey: anonKey,
  Authorization: `Bearer ${accessToken}`,
  'Content-Type': 'application/json',
});

export class SupabaseLedgerAdapter {
  constructor({ supabaseUrl, supabaseAnonKey, accessToken }) {
    this.supabaseUrl = supabaseUrl.replace(/\/$/, '');
    this.supabaseAnonKey = supabaseAnonKey;
    this.accessToken = accessToken;
  }

  async findPersonalLedger() {
    return null;
  }

  async createPersonalLedger({ name }) {
    const response = await fetch(
      `${this.supabaseUrl}/rest/v1/rpc/provision_personal_ledger`,
      {
        method: 'POST',
        headers: jsonHeaders(this.accessToken, this.supabaseAnonKey),
        body: JSON.stringify({ p_display_name: name.replace(/的帳本$/, '') }),
      },
    );

    if (!response.ok) {
      throw new Error('無法建立帳本，請確認 Supabase 設定與登入狀態。');
    }

    return response.json();
  }
}

export async function fetchSupabaseUser({ supabaseUrl, supabaseAnonKey, accessToken }) {
  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
    headers: jsonHeaders(accessToken, supabaseAnonKey),
  });

  if (!response.ok) {
    throw new Error('登入已失效，請重新使用 Google 登入。');
  }

  return response.json();
}

export function startGoogleSignIn({ supabaseUrl, redirectTo }) {
  const url = new URL(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/authorize`);
  url.searchParams.set('provider', 'google');
  url.searchParams.set('redirect_to', redirectTo);
  window.location.assign(url.toString());
}

