create table if not exists public.ledger_financial_settings (
  ledger_id uuid primary key references public.ledgers(id) on delete cascade,
  cycle_start_day smallint not null default 5 check (cycle_start_day between 1 and 28),
  default_salary_amount integer not null default 0 check (default_salary_amount >= 0),
  quick_entry_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.accounting_periods (
  ledger_id uuid not null references public.ledgers(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  salary_amount integer not null default 0 check (salary_amount >= 0),
  previous_card_bill_amount integer check (previous_card_bill_amount >= 0),
  previous_card_bill_zero_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (ledger_id, starts_on),
  check (ends_on >= starts_on),
  check (previous_card_bill_amount is null or not previous_card_bill_zero_confirmed)
);

create table if not exists public.other_income_entries (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.ledgers(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  amount integer not null check (amount > 0),
  received_at timestamptz not null default now(),
  recorder_member_id uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (ledger_id, recorder_member_id)
    references public.ledger_members (ledger_id, user_id)
);

create table if not exists public.fixed_expense_rules (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.ledgers(id) on delete cascade,
  category_id uuid not null,
  item_name text not null check (char_length(trim(item_name)) > 0),
  amount integer not null check (amount > 0),
  payment_method public.payment_method not null,
  scheduled_day smallint not null check (scheduled_day between 1 and 28),
  active_from date not null default ((now() at time zone 'Asia/Taipei')::date),
  retired_at timestamptz,
  recorder_member_id uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (ledger_id, category_id)
    references public.categories (ledger_id, id),
  foreign key (ledger_id, recorder_member_id)
    references public.ledger_members (ledger_id, user_id)
);

alter table public.expense_entries
  add column if not exists fixed_expense_rule_id uuid references public.fixed_expense_rules(id) on delete set null,
  add column if not exists accounting_period_start date;

create unique index if not exists expense_entries_one_fixed_rule_per_period
  on public.expense_entries (fixed_expense_rule_id, accounting_period_start)
  where fixed_expense_rule_id is not null;

create or replace function public.set_financial_record_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ledger_financial_settings_set_updated_at on public.ledger_financial_settings;
create trigger ledger_financial_settings_set_updated_at
  before update on public.ledger_financial_settings
  for each row execute function public.set_financial_record_updated_at();

drop trigger if exists accounting_periods_set_updated_at on public.accounting_periods;
create trigger accounting_periods_set_updated_at
  before update on public.accounting_periods
  for each row execute function public.set_financial_record_updated_at();

drop trigger if exists other_income_entries_set_updated_at on public.other_income_entries;
create trigger other_income_entries_set_updated_at
  before update on public.other_income_entries
  for each row execute function public.set_financial_record_updated_at();

drop trigger if exists fixed_expense_rules_set_updated_at on public.fixed_expense_rules;
create trigger fixed_expense_rules_set_updated_at
  before update on public.fixed_expense_rules
  for each row execute function public.set_financial_record_updated_at();

alter table public.ledger_financial_settings enable row level security;
alter table public.accounting_periods enable row level security;
alter table public.other_income_entries enable row level security;
alter table public.fixed_expense_rules enable row level security;

drop policy if exists "帳本成員可讀取財務設定" on public.ledger_financial_settings;
create policy "帳本成員可讀取財務設定"
  on public.ledger_financial_settings for select
  using (public.is_ledger_member(ledger_id));

drop policy if exists "帳本擁有者可管理財務設定" on public.ledger_financial_settings;
create policy "帳本擁有者可管理財務設定"
  on public.ledger_financial_settings for all
  using (public.is_ledger_owner(ledger_id))
  with check (public.is_ledger_owner(ledger_id));

drop policy if exists "帳本成員可讀取帳務週期" on public.accounting_periods;
create policy "帳本成員可讀取帳務週期"
  on public.accounting_periods for select
  using (public.is_ledger_member(ledger_id));

drop policy if exists "帳本擁有者可管理帳務週期" on public.accounting_periods;
create policy "帳本擁有者可管理帳務週期"
  on public.accounting_periods for all
  using (public.is_ledger_owner(ledger_id))
  with check (public.is_ledger_owner(ledger_id));

drop policy if exists "帳本成員可讀取其他收入" on public.other_income_entries;
create policy "帳本成員可讀取其他收入"
  on public.other_income_entries for select
  using (public.is_ledger_member(ledger_id));

drop policy if exists "帳本成員可新增自己的其他收入" on public.other_income_entries;
create policy "帳本成員可新增自己的其他收入"
  on public.other_income_entries for insert
  with check (public.is_ledger_member(ledger_id) and recorder_member_id = auth.uid());

drop policy if exists "記錄者或帳本擁有者可管理其他收入" on public.other_income_entries;
create policy "記錄者或帳本擁有者可管理其他收入"
  on public.other_income_entries for all
  using (recorder_member_id = auth.uid() or public.is_ledger_owner(ledger_id))
  with check (public.is_ledger_member(ledger_id) and (recorder_member_id = auth.uid() or public.is_ledger_owner(ledger_id)));

drop policy if exists "帳本成員可讀取固定開銷規則" on public.fixed_expense_rules;
create policy "帳本成員可讀取固定開銷規則"
  on public.fixed_expense_rules for select
  using (public.is_ledger_member(ledger_id));

drop policy if exists "帳本擁有者可管理固定開銷規則" on public.fixed_expense_rules;
create policy "帳本擁有者可管理固定開銷規則"
  on public.fixed_expense_rules for all
  using (public.is_ledger_owner(ledger_id))
  with check (public.is_ledger_owner(ledger_id));

grant select, insert, update, delete on public.ledger_financial_settings to authenticated;
grant select, insert, update, delete on public.accounting_periods to authenticated;
grant select, insert, update, delete on public.other_income_entries to authenticated;
grant select, insert, update, delete on public.fixed_expense_rules to authenticated;

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
  loop
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

    if scheduled_date <= taiwan_today and scheduled_date >= fixed_rule.active_from then
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

