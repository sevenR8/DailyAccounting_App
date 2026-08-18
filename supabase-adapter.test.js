import assert from 'node:assert/strict';
import test from 'node:test';

import { SupabaseConnection, SupabaseLedgerAdapter } from './supabase-adapter.js';

const response = (body, ok = true) => ({
  ok,
  json: async () => body,
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
          { id: 'category-2', name: '娛樂', retired_at: null, created_at: '2026-08-18T00:01:00Z' },
          { id: 'category-1', name: '飲食', retired_at: null, created_at: '2026-08-18T00:00:00Z' },
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
      { id: 'category-1', name: '飲食', retiredAt: null },
      { id: 'category-2', name: '娛樂', retiredAt: null },
    ],
  });
});

