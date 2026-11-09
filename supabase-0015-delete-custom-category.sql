-- 刪除自訂分類時，先將既有開銷與固定開銷規則移到使用者指定的分類。
-- 整個流程在同一個資料庫交易內完成，絕不連帶刪除記帳紀錄。
create or replace function public.delete_custom_category(
  p_ledger_id uuid,
  p_category_id uuid,
  p_replacement_category_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_category public.categories%rowtype;
  moved_expense_count integer := 0;
  moved_rule_count integer := 0;
begin
  if auth.uid() is null or not public.is_ledger_owner(p_ledger_id) then
    raise exception 'not_authorized';
  end if;

  select * into target_category
    from public.categories
   where ledger_id = p_ledger_id
     and id = p_category_id
   for update;
  if not found or target_category.is_default then
    raise exception 'category_not_deletable';
  end if;

  if p_replacement_category_id is not null then
    if p_replacement_category_id = p_category_id then
      raise exception 'invalid_replacement_category';
    end if;
    perform 1
      from public.categories
     where ledger_id = p_ledger_id
       and id = p_replacement_category_id
       and retired_at is null
     for key share;
    if not found then
      raise exception 'invalid_replacement_category';
    end if;
  elsif exists (
    select 1 from public.expense_entries
     where ledger_id = p_ledger_id and category_id = p_category_id
  ) or exists (
    select 1 from public.fixed_expense_rules
     where ledger_id = p_ledger_id and category_id = p_category_id
  ) then
    raise exception 'category_replacement_required';
  end if;

  if p_replacement_category_id is not null then
    update public.expense_entries
       set category_id = p_replacement_category_id
     where ledger_id = p_ledger_id
       and category_id = p_category_id;
    get diagnostics moved_expense_count = row_count;

    update public.fixed_expense_rules
       set category_id = p_replacement_category_id
     where ledger_id = p_ledger_id
       and category_id = p_category_id;
    get diagnostics moved_rule_count = row_count;
  end if;

  delete from public.categories
   where ledger_id = p_ledger_id
     and id = p_category_id;

  return jsonb_build_object(
    'deletedCategoryId', p_category_id,
    'movedExpenseCount', moved_expense_count,
    'movedFixedRuleCount', moved_rule_count
  );
end;
$$;

revoke all on function public.delete_custom_category(uuid, uuid, uuid) from public;
grant execute on function public.delete_custom_category(uuid, uuid, uuid) to authenticated;
