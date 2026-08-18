import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('./supabase-0001-personal-ledger.sql', import.meta.url),
  'utf8',
);
const financialMigration = await readFile(
  new URL('./supabase-0002-financial-overview.sql', import.meta.url),
  'utf8',
);

test('資料模型保留開銷的記錄者、可選付款者與同帳本外鍵', () => {
  assert.match(migration, /create table public\.expense_entries/i);
  assert.match(migration, /recorder_member_id uuid not null/i);
  assert.match(migration, /payer_member_id uuid,/i);
  assert.match(migration, /foreign key \(ledger_id, recorder_member_id\)/i);
  assert.match(migration, /foreign key \(ledger_id, payer_member_id\)/i);
});

test('資料列權限隔離帳本資料，並限制成員只能編修自己的開銷', () => {
  assert.match(migration, /enable row level security;[\s\S]*expense_entries enable row level security/i);
  assert.match(migration, /帳本成員可新增自己記錄的開銷/i);
  assert.match(migration, /recorder_member_id = auth\.uid\(\)/i);
  assert.match(migration, /記錄者或帳本擁有者可修改開銷/i);
  assert.match(migration, /帳本成員可讀取開銷/i);
});

test('個人帳本佈建以衝突安全方式處理同時登入', () => {
  assert.match(migration, /on conflict \(personal_owner_id\) do nothing/i);
  assert.match(migration, /if found then/i);
});

test('完整總覽保留本期收入、上期信用卡帳單與多筆其他收入', () => {
  assert.match(financialMigration, /create table if not exists public\.accounting_periods/i);
  assert.match(financialMigration, /salary_amount integer/i);
  assert.match(financialMigration, /previous_card_bill_amount integer/i);
  assert.match(financialMigration, /previous_card_bill_zero_confirmed boolean/i);
  assert.match(financialMigration, /create table if not exists public\.other_income_entries/i);
});

test('固定開銷規則依指定日期補建本期開銷且不重複', () => {
  assert.match(financialMigration, /create table if not exists public\.fixed_expense_rules/i);
  assert.match(financialMigration, /scheduled_day smallint/i);
  assert.match(financialMigration, /ensure_current_accounting_period/i);
  assert.match(financialMigration, /expense_entries_one_fixed_rule_per_period/i);
  assert.match(financialMigration, /on conflict \(fixed_expense_rule_id, accounting_period_start\)/i);
});

