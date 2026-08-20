alter table public.fixed_expense_rules
  add column if not exists recurrence_type text not null default 'monthly',
  add column if not exists scheduled_month smallint;

do $$
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'fixed_expense_rules'
       and column_name = 'sort_order'
  ) then
    alter table public.fixed_expense_rules add column sort_order integer;

    with ranked_rules as (
      select id,
             (row_number() over (
               partition by ledger_id
               order by scheduled_day, created_at, id
             ) - 1)::integer as position
        from public.fixed_expense_rules
    )
    update public.fixed_expense_rules as fixed_rule
       set sort_order = ranked_rules.position
      from ranked_rules
     where fixed_rule.id = ranked_rules.id;

    alter table public.fixed_expense_rules
      alter column sort_order set default 0,
      alter column sort_order set not null;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'fixed_expense_rules_recurrence_type_check'
       and conrelid = 'public.fixed_expense_rules'::regclass
  ) then
    alter table public.fixed_expense_rules
      add constraint fixed_expense_rules_recurrence_type_check
      check (recurrence_type in ('monthly', 'yearly'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'fixed_expense_rules_scheduled_month_check'
       and conrelid = 'public.fixed_expense_rules'::regclass
  ) then
    alter table public.fixed_expense_rules
      add constraint fixed_expense_rules_scheduled_month_check
      check (
        (recurrence_type = 'monthly' and scheduled_month is null)
        or
        (recurrence_type = 'yearly' and scheduled_month between 1 and 12)
      );
  end if;
end;
$$;

create index if not exists fixed_expense_rules_ledger_sort_order
  on public.fixed_expense_rules (ledger_id, sort_order, created_at)
  where retired_at is null;

create or replace function public.reorder_fixed_expense_rules(
  p_ledger_id uuid,
  p_rule_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  active_rule_count integer;
  distinct_rule_count integer;
begin
  if not public.is_ledger_owner(p_ledger_id) then
    raise exception 'ledger_owner_required';
  end if;

  select count(*) into active_rule_count
    from public.fixed_expense_rules
   where ledger_id = p_ledger_id
     and retired_at is null;

  select count(distinct requested.rule_id) into distinct_rule_count
    from unnest(coalesce(p_rule_ids, array[]::uuid[])) as requested(rule_id);

  if cardinality(coalesce(p_rule_ids, array[]::uuid[])) <> active_rule_count
     or distinct_rule_count <> active_rule_count
     or exists (
       select 1
         from unnest(coalesce(p_rule_ids, array[]::uuid[])) as requested(rule_id)
         left join public.fixed_expense_rules as fixed_rule
           on fixed_rule.id = requested.rule_id
          and fixed_rule.ledger_id = p_ledger_id
          and fixed_rule.retired_at is null
        where fixed_rule.id is null
     ) then
    raise exception 'invalid_fixed_expense_rule_order';
  end if;

  update public.fixed_expense_rules as fixed_rule
     set sort_order = (ordered.position - 1)::integer
    from unnest(p_rule_ids) with ordinality as ordered(rule_id, position)
   where fixed_rule.id = ordered.rule_id
     and fixed_rule.ledger_id = p_ledger_id
     and fixed_rule.retired_at is null;
end;
$$;

revoke all on function public.reorder_fixed_expense_rules(uuid, uuid[]) from public;
grant execute on function public.reorder_fixed_expense_rules(uuid, uuid[]) to authenticated;

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

  insert into public.accounting_periods (
    ledger_id,
    starts_on,
    ends_on,
    salary_amount
  ) values (
    p_ledger_id,
    period_start,
    period_end,
    settings_row.default_salary_amount
  ) on conflict (ledger_id, starts_on) do nothing;

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

    if scheduled_date <= taiwan_today then
      insert into public.expense_entries (
        ledger_id,
        category_id,
        item_name,
        amount,
        payment_method,
        occurred_at,
        recorder_member_id,
        is_fixed,
        fixed_expense_rule_id,
        accounting_period_start
      ) values (
        p_ledger_id,
        fixed_rule.category_id,
        fixed_rule.item_name,
        fixed_rule.amount,
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
