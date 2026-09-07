-- Allow each variable expense to opt out of the daily-average forecast.
-- Existing expenses remain included by default.
alter table public.expense_entries
  add column if not exists include_in_daily_average boolean not null default true;

comment on column public.expense_entries.include_in_daily_average is
  'Whether this expense contributes to the daily living-expense average used by annual forecasts.';
