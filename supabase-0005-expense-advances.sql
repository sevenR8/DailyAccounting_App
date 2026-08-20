create table if not exists public.expense_advances (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.ledgers(id) on delete cascade,
  expense_entry_id uuid not null references public.expense_entries(id) on delete cascade,
  debtor_name text not null check (char_length(trim(debtor_name)) > 0),
  amount integer not null check (amount > 0),
  expected_on date,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (ledger_id, created_by)
    references public.ledger_members (ledger_id, user_id),
  unique (id, ledger_id)
);

create table if not exists public.advance_repayments (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.ledgers(id) on delete cascade,
  advance_id uuid not null,
  amount integer not null check (amount > 0),
  receipt_method text not null default 'bank_transfer'
    check (receipt_method in ('cash', 'bank_transfer')),
  received_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (ledger_id, advance_id)
    references public.expense_advances (ledger_id, id) on delete cascade,
  foreign key (ledger_id, created_by)
    references public.ledger_members (ledger_id, user_id)
);

create index if not exists expense_advances_ledger_created_idx
  on public.expense_advances (ledger_id, created_at desc);
create index if not exists expense_advances_expense_idx
  on public.expense_advances (expense_entry_id);
create index if not exists advance_repayments_advance_received_idx
  on public.advance_repayments (advance_id, received_at desc);

drop trigger if exists expense_advances_set_updated_at on public.expense_advances;
create trigger expense_advances_set_updated_at
  before update on public.expense_advances
  for each row execute function public.set_financial_record_updated_at();

alter table public.expense_advances enable row level security;
alter table public.advance_repayments enable row level security;

drop policy if exists "ledger members read advances" on public.expense_advances;
create policy "ledger members read advances"
  on public.expense_advances for select
  using (public.is_ledger_member(ledger_id));

drop policy if exists "ledger members read advance repayments" on public.advance_repayments;
create policy "ledger members read advance repayments"
  on public.advance_repayments for select
  using (public.is_ledger_member(ledger_id));

create or replace function public.save_expense_advance(
  p_ledger_id uuid,
  p_expense_entry_id uuid,
  p_debtor_name text,
  p_amount integer,
  p_expected_on date default null
)
returns public.expense_advances
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  expense_amount integer;
  existing_advance_amount integer;
  saved_advance public.expense_advances;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;
  if char_length(trim(coalesce(p_debtor_name, ''))) = 0 or p_amount <= 0 then
    raise exception 'invalid_advance';
  end if;

  select amount into expense_amount
    from public.expense_entries
   where id = p_expense_entry_id
     and ledger_id = p_ledger_id
     and (recorder_member_id = current_user_id or public.is_ledger_owner(p_ledger_id));
  if expense_amount is null then
    raise exception 'expense_not_found';
  end if;

  select coalesce(sum(amount), 0) into existing_advance_amount
    from public.expense_advances
   where expense_entry_id = p_expense_entry_id;
  if existing_advance_amount + p_amount > expense_amount then
    raise exception 'advance_exceeds_expense';
  end if;

  insert into public.expense_advances (
    ledger_id, expense_entry_id, debtor_name, amount, expected_on, created_by
  ) values (
    p_ledger_id, p_expense_entry_id, trim(p_debtor_name), p_amount, p_expected_on, current_user_id
  ) returning * into saved_advance;
  return saved_advance;
end;
$$;

create or replace function public.record_advance_repayment(
  p_ledger_id uuid,
  p_advance_id uuid,
  p_amount integer,
  p_receipt_method text,
  p_received_at timestamptz
)
returns public.advance_repayments
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  advance_amount integer;
  repaid_amount integer;
  saved_repayment public.advance_repayments;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;
  if p_amount <= 0 or p_receipt_method not in ('cash', 'bank_transfer') then
    raise exception 'invalid_repayment';
  end if;

  select amount into advance_amount
    from public.expense_advances
   where id = p_advance_id
     and ledger_id = p_ledger_id
     and (created_by = current_user_id or public.is_ledger_owner(p_ledger_id));
  if advance_amount is null then
    raise exception 'advance_not_found';
  end if;

  select coalesce(sum(amount), 0) into repaid_amount
    from public.advance_repayments
   where advance_id = p_advance_id;
  if repaid_amount + p_amount > advance_amount then
    raise exception 'repayment_exceeds_outstanding';
  end if;

  insert into public.advance_repayments (
    ledger_id, advance_id, amount, receipt_method, received_at, created_by
  ) values (
    p_ledger_id, p_advance_id, p_amount, p_receipt_method, p_received_at, current_user_id
  ) returning * into saved_repayment;
  return saved_repayment;
end;
$$;

revoke all on table public.expense_advances from public;
revoke all on table public.advance_repayments from public;
grant select on public.expense_advances to authenticated;
grant select on public.advance_repayments to authenticated;
revoke all on function public.save_expense_advance(uuid, uuid, text, integer, date) from public;
grant execute on function public.save_expense_advance(uuid, uuid, text, integer, date) to authenticated;
revoke all on function public.record_advance_repayment(uuid, uuid, integer, text, timestamptz) from public;
grant execute on function public.record_advance_repayment(uuid, uuid, integer, text, timestamptz) to authenticated;
