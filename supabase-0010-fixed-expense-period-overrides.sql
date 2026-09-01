-- 固定開銷可依帳務週期保存不同金額，避免修改本期時連帶改動其他月份。
create table if not exists public.fixed_expense_period_overrides (
  ledger_id uuid not null references public.ledgers(id) on delete cascade,
  fixed_expense_rule_id uuid not null references public.fixed_expense_rules(id) on delete cascade,
  accounting_period_start date not null,
  amount integer not null check (amount > 0),
  created_at timestamptz not null default now(),
  primary key (fixed_expense_rule_id, accounting_period_start)
);

create index if not exists fixed_expense_period_overrides_ledger_period
  on public.fixed_expense_period_overrides (ledger_id, accounting_period_start);

alter table public.fixed_expense_period_overrides enable row level security;

drop policy if exists "members can read fixed expense overrides" on public.fixed_expense_period_overrides;
create policy "members can read fixed expense overrides"
  on public.fixed_expense_period_overrides for select
  using (public.is_ledger_member(ledger_id));

drop policy if exists "owners can manage fixed expense overrides" on public.fixed_expense_period_overrides;
create policy "owners can manage fixed expense overrides"
  on public.fixed_expense_period_overrides for all
  using (public.is_ledger_owner(ledger_id))
  with check (public.is_ledger_owner(ledger_id));

grant select, insert, update, delete on public.fixed_expense_period_overrides to authenticated;

create or replace function public.ensure_current_accounting_period(p_ledger_id uuid)
returns public.accounting_periods
language plpgsql
security definer
set search_path = public
as $$
declare
  taiwan_today date := (now() at time zone 'Asia/Taipei')::date;
  settings_row public.ledger_financial_settings;
  period_start date;
  period_end date;
  period_row public.accounting_periods;
  fixed_rule public.fixed_expense_rules;
  candidate_month date;
  candidate_last_day integer;
  scheduled_date date;
  effective_amount integer;
begin
  if not public.is_ledger_member(p_ledger_id) then
    raise exception 'ledger_access_denied';
  end if;

  insert into public.ledger_financial_settings (ledger_id)
    values (p_ledger_id)
    on conflict (ledger_id) do nothing;

  select * into settings_row
    from public.ledger_financial_settings
   where ledger_id = p_ledger_id;

  period_start := make_date(
    extract(year from taiwan_today)::integer,
    extract(month from taiwan_today)::integer,
    settings_row.cycle_start_day
  );
  if taiwan_today < period_start then
    period_start := (period_start - interval '1 month')::date;
  end if;
  period_end := (period_start + interval '1 month - 1 day')::date;

  insert into public.accounting_periods (ledger_id, starts_on, ends_on, salary_amount)
    values (p_ledger_id, period_start, period_end, settings_row.default_salary_amount)
    on conflict (ledger_id, starts_on) do nothing;

  for fixed_rule in
    select * from public.fixed_expense_rules
     where ledger_id = p_ledger_id
       and retired_at is null
       and active_from <= period_end
     order by sort_order, created_at
  loop
    if fixed_rule.recurrence_type = 'yearly' then
      candidate_month := make_date(
        extract(year from period_start)::integer,
        fixed_rule.scheduled_month,
        1
      );
      candidate_last_day := extract(day from (candidate_month + interval '1 month - 1 day'))::integer;
      scheduled_date := make_date(
        extract(year from candidate_month)::integer,
        extract(month from candidate_month)::integer,
        least(fixed_rule.scheduled_day, candidate_last_day)
      );
      if scheduled_date < period_start then
        candidate_month := (candidate_month + interval '1 year')::date;
        candidate_last_day := extract(day from (candidate_month + interval '1 month - 1 day'))::integer;
        scheduled_date := make_date(
          extract(year from candidate_month)::integer,
          extract(month from candidate_month)::integer,
          least(fixed_rule.scheduled_day, candidate_last_day)
        );
      end if;
      if scheduled_date > period_end then
        continue;
      end if;
    else
      candidate_month := date_trunc('month', period_start)::date;
      candidate_last_day := extract(day from (candidate_month + interval '1 month - 1 day'))::integer;
      scheduled_date := make_date(
        extract(year from candidate_month)::integer,
        extract(month from candidate_month)::integer,
        least(fixed_rule.scheduled_day, candidate_last_day)
      );
      if scheduled_date < period_start then
        candidate_month := (candidate_month + interval '1 month')::date;
        candidate_last_day := extract(day from (candidate_month + interval '1 month - 1 day'))::integer;
        scheduled_date := make_date(
          extract(year from candidate_month)::integer,
          extract(month from candidate_month)::integer,
          least(fixed_rule.scheduled_day, candidate_last_day)
        );
      end if;
    end if;

    select coalesce(
      (
        select override.amount
          from public.fixed_expense_period_overrides as override
         where override.fixed_expense_rule_id = fixed_rule.id
           and override.ledger_id = p_ledger_id
           and override.accounting_period_start = period_start
      ),
      fixed_rule.amount
    ) into effective_amount;

    if scheduled_date <= taiwan_today then
      insert into public.expense_entries (
        ledger_id, category_id, item_name, amount, payment_method, occurred_at,
        recorder_member_id, is_fixed, fixed_expense_rule_id, accounting_period_start
      ) values (
        p_ledger_id,
        fixed_rule.category_id,
        fixed_rule.item_name,
        effective_amount,
        fixed_rule.payment_method,
        (scheduled_date::timestamp at time zone 'Asia/Taipei'),
        fixed_rule.recorder_member_id,
        true,
        fixed_rule.id,
        period_start
      ) on conflict (fixed_expense_rule_id, accounting_period_start)
        where fixed_expense_rule_id is not null
        do nothing;
    end if;
  end loop;

  select * into period_row
    from public.accounting_periods
   where ledger_id = p_ledger_id and starts_on = period_start;
  return period_row;
end;
$$;

revoke all on function public.ensure_current_accounting_period(uuid) from public;
grant execute on function public.ensure_current_accounting_period(uuid) to authenticated;
