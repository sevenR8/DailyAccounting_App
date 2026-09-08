-- 每期生活開銷上限；空值代表該期尚未設定，由前一期設定沿用。
alter table public.accounting_periods
  add column if not exists living_expense_limit_amount integer
    check (living_expense_limit_amount is null or living_expense_limit_amount >= 0);
