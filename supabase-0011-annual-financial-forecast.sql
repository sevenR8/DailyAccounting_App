-- 年度生活消費誌預估：年度起始月份、預估年終與預估分紅。
-- 這些欄位只影響年度預估，不會更動既有帳務週期或任何歷史帳目。

alter table public.ledger_financial_settings
  add column if not exists annual_cycle_start_month smallint not null default 1
    check (annual_cycle_start_month between 1 and 12),
  add column if not exists annual_expected_bonus_amount integer not null default 0
    check (annual_expected_bonus_amount >= 0),
  add column if not exists annual_expected_dividend_amount integer not null default 0
    check (annual_expected_dividend_amount >= 0);
