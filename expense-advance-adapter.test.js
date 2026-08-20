import assert from 'node:assert/strict';
import test from 'node:test';

import { SupabaseConnection, SupabaseLedgerAdapter } from './supabase-adapter.js';

const response = (body, ok = true) => ({ ok, status: ok ? 200 : 404, json: async () => body });

test('帳務內頁可讀取代墊與收回紀錄', async () => {
  const connection = new SupabaseConnection({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'public-key',
    accessToken: 'token',
    fetchImpl: async () => response([{
      id: 'advance-1', expense_entry_id: 'expense-1', debtor_name: '寶貝', amount: 4500,
      expected_on: null, created_at: '2026-08-20T00:00:00Z',
      expense_entries: { id: 'expense-1', item_name: '飯店', amount: 9000 },
      advance_repayments: [{
        id: 'repayment-1', amount: 2000, receipt_method: 'bank_transfer',
        received_at: '2026-08-21T00:00:00Z', created_at: '2026-08-21T00:00:00Z',
      }],
    }]),
  });

  const advances = await new SupabaseLedgerAdapter(connection).listExpenseAdvances('ledger-1');

  assert.equal(advances[0].expenseEntryId, 'expense-1');
  assert.equal(advances[0].debtorName, '寶貝');
  assert.equal(advances[0].repayments[0].receiptMethod, 'bank_transfer');
});

test('設定代墊與收回使用受驗證的雲端程序', async () => {
  const calls = [];
  const connection = new SupabaseConnection({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'public-key',
    accessToken: 'token',
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return response({ id: calls.length === 1 ? 'advance-1' : 'repayment-1' });
    },
  });
  const adapter = new SupabaseLedgerAdapter(connection);

  await adapter.createExpenseAdvance({
    ledgerId: 'ledger-1', expenseEntryId: 'expense-1', debtorName: '寶貝',
    amount: 4500, expectedOn: null,
  });
  await adapter.createAdvanceRepayment({
    ledgerId: 'ledger-1', advanceId: 'advance-1', amount: 2000,
    receiptMethod: 'bank_transfer', receivedAt: '2026-08-21T00:00:00Z',
  });

  assert.match(calls[0].url, /rpc\/save_expense_advance$/);
  assert.equal(calls[0].body.p_amount, 4500);
  assert.match(calls[1].url, /rpc\/record_advance_repayment$/);
  assert.equal(calls[1].body.p_amount, 2000);
});

test('可修改既有代墊的對象、金額與預計收回日期', async () => {
  const calls = [];
  const connection = new SupabaseConnection({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'public-key',
    accessToken: 'token',
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return response({ id: 'advance-1', amount: 4300 });
    },
  });
  const adapter = new SupabaseLedgerAdapter(connection);

  await adapter.updateExpenseAdvance({
    ledgerId: 'ledger-1', advanceId: 'advance-1', debtorName: '寶貝',
    amount: 4300, expectedOn: '2026-10-05',
  });

  assert.match(calls[0].url, /rpc\/update_expense_advance$/);
  assert.equal(calls[0].body.p_advance_id, 'advance-1');
  assert.equal(calls[0].body.p_amount, 4300);
  assert.equal(calls[0].body.p_expected_on, '2026-10-05');
});
