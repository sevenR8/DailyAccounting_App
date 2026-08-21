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
const fixedSchedulingMigration = await readFile(
  new URL('./supabase-0003-fixed-expense-scheduling.sql', import.meta.url),
  'utf8',
);
const expenseAnalysisMigration = await readFile(
  new URL('./supabase-0004-expense-analysis.sql', import.meta.url),
  'utf8',
);
const expenseAdvancesMigration = await readFile(
  new URL('./supabase-0005-expense-advances.sql', import.meta.url),
  'utf8',
);
const editExpenseAdvancesMigration = await readFile(
  new URL('./supabase-0006-edit-expense-advances.sql', import.meta.url),
  'utf8',
);
const countryLivingCostMigration = await readFile(
  new URL('./supabase-0007-country-living-cost-baselines.sql', import.meta.url),
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

test('固定開銷支援年度月份、雲端排序與只在適用週期自動產生', () => {
  assert.match(fixedSchedulingMigration, /recurrence_type text/i);
  assert.match(fixedSchedulingMigration, /scheduled_month smallint/i);
  assert.match(fixedSchedulingMigration, /sort_order integer/i);
  assert.match(fixedSchedulingMigration, /reorder_fixed_expense_rules/i);
  assert.match(fixedSchedulingMigration, /fixed_rule\.recurrence_type = 'yearly'/i);
  assert.match(fixedSchedulingMigration, /continue;/i);
});

test('消費分析保存分類性質、帳本店家群組與歷史別名規則', () => {
  assert.match(expenseAnalysisMigration, /analysis_nature text/i);
  assert.match(expenseAnalysisMigration, /maintenance.*pleasure/is);
  assert.match(expenseAnalysisMigration, /create table if not exists public\.merchant_groups/i);
  assert.match(expenseAnalysisMigration, /create table if not exists public\.merchant_aliases/i);
  assert.match(expenseAnalysisMigration, /seed_default_merchant_groups/i);
  assert.match(expenseAnalysisMigration, /save_merchant_group/i);
});

test('消費分析設定由帳本成員讀取且只有帳本建立者能管理', () => {
  assert.match(expenseAnalysisMigration, /帳本成員可讀取店家群組/i);
  assert.match(expenseAnalysisMigration, /帳本擁有者可管理店家群組/i);
  assert.match(expenseAnalysisMigration, /public\.is_ledger_owner\(p_ledger_id\)/i);
  assert.match(expenseAnalysisMigration, /grant execute on function public\.save_merchant_group/i);
});

test('代墊獨立保存待收金額與分次收回紀錄', () => {
  assert.match(expenseAdvancesMigration, /create table if not exists public\.expense_advances/i);
  assert.match(expenseAdvancesMigration, /create table if not exists public\.advance_repayments/i);
  assert.match(expenseAdvancesMigration, /save_expense_advance/i);
  assert.match(expenseAdvancesMigration, /record_advance_repayment/i);
  assert.match(expenseAdvancesMigration, /repayment_exceeds_outstanding/i);
  assert.match(expenseAdvancesMigration, /ledger members read advances/i);
});

test('修改代墊時不得低於已收回金額或超過原開銷', () => {
  assert.match(editExpenseAdvancesMigration, /update_expense_advance/i);
  assert.match(editExpenseAdvancesMigration, /advance_below_repaid/i);
  assert.match(editExpenseAdvancesMigration, /advance_exceeds_expense/i);
  assert.match(editExpenseAdvancesMigration, /grant execute on function public\.update_expense_advance/i);
});

test('各國生活費基準保存於帳本財務設定並預填使用者指定的五國數值', () => {
  assert.match(countryLivingCostMigration, /country_living_cost_baselines jsonb not null/i);
  assert.match(countryLivingCostMigration, /'TW', 37000/i);
  assert.match(countryLivingCostMigration, /'JP', 38370/i);
  assert.match(countryLivingCostMigration, /'KR', 41553/i);
  assert.match(countryLivingCostMigration, /'CN', 19000/i);
  assert.match(countryLivingCostMigration, /'US', 128000/i);
});
