create or replace function public.update_expense_advance(
  p_ledger_id uuid,
  p_advance_id uuid,
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
  target_expense_entry_id uuid;
  expense_amount integer;
  other_advance_amount integer;
  repaid_amount integer;
  saved_advance public.expense_advances;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;
  if char_length(trim(coalesce(p_debtor_name, ''))) = 0 or p_amount <= 0 then
    raise exception 'invalid_advance';
  end if;

  select expense_entry_id into target_expense_entry_id
    from public.expense_advances
   where id = p_advance_id
     and ledger_id = p_ledger_id
     and (created_by = current_user_id or public.is_ledger_owner(p_ledger_id));
  if target_expense_entry_id is null then
    raise exception 'advance_not_found';
  end if;

  select amount into expense_amount
    from public.expense_entries
   where id = target_expense_entry_id
     and ledger_id = p_ledger_id;
  if expense_amount is null then
    raise exception 'expense_not_found';
  end if;

  select coalesce(sum(amount), 0) into other_advance_amount
    from public.expense_advances
   where expense_entry_id = target_expense_entry_id
     and id <> p_advance_id;
  if other_advance_amount + p_amount > expense_amount then
    raise exception 'advance_exceeds_expense';
  end if;

  select coalesce(sum(amount), 0) into repaid_amount
    from public.advance_repayments
   where advance_id = p_advance_id;
  if p_amount < repaid_amount then
    raise exception 'advance_below_repaid';
  end if;

  update public.expense_advances
     set debtor_name = trim(p_debtor_name),
         amount = p_amount,
         expected_on = p_expected_on,
         updated_at = now()
   where id = p_advance_id
     and ledger_id = p_ledger_id
  returning * into saved_advance;

  return saved_advance;
end;
$$;

revoke all on function public.update_expense_advance(uuid, uuid, text, integer, date) from public;
grant execute on function public.update_expense_advance(uuid, uuid, text, integer, date) to authenticated;
