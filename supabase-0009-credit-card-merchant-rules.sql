-- 可由帳本建立者管理的店家自動付款方式規則。
alter table public.merchant_groups
  add column if not exists auto_credit_card boolean not null default false;

-- 保留既有快速記帳行為：麥當勞與 7-11 預設自動選信用卡。
update public.merchant_groups
   set auto_credit_card = true
 where retired_at is null
   and name in ('麥當勞', '7-11');

drop function if exists public.save_merchant_group(uuid, uuid, text, text, text[]);

create or replace function public.save_merchant_group(
  p_ledger_id uuid,
  p_group_id uuid,
  p_name text,
  p_group_type text,
  p_auto_credit_card boolean,
  p_aliases text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_group public.merchant_groups;
begin
  if not public.is_ledger_owner(p_ledger_id) then
    raise exception 'ledger_owner_required';
  end if;
  if nullif(trim(p_name), '') is null
     or p_group_type not in ('fast_food', 'convenience', 'other') then
    raise exception 'invalid_merchant_group';
  end if;

  if p_group_id is null then
    insert into public.merchant_groups (ledger_id, name, group_type, auto_credit_card)
      values (p_ledger_id, trim(p_name), p_group_type, coalesce(p_auto_credit_card, false))
      returning * into saved_group;
  else
    update public.merchant_groups
       set name = trim(p_name),
           group_type = p_group_type,
           auto_credit_card = coalesce(p_auto_credit_card, false),
           retired_at = null
     where id = p_group_id
       and ledger_id = p_ledger_id
     returning * into saved_group;
    if saved_group.id is null then
      raise exception 'merchant_group_not_found';
    end if;
    delete from public.merchant_aliases where merchant_group_id = saved_group.id;
  end if;

  insert into public.merchant_aliases (merchant_group_id, alias)
  select saved_group.id, normalized.alias
    from (
      select distinct trim(alias_value) as alias
        from unnest(array_append(coalesce(p_aliases, array[]::text[]), saved_group.name))
          as alias_value
       where nullif(trim(alias_value), '') is not null
    ) as normalized
  on conflict (merchant_group_id, alias) do nothing;

  return jsonb_build_object(
    'id', saved_group.id,
    'name', saved_group.name,
    'groupType', saved_group.group_type,
    'autoCreditCard', saved_group.auto_credit_card,
    'retiredAt', saved_group.retired_at,
    'aliases', coalesce((
      select jsonb_agg(alias.alias order by alias.created_at, alias.alias)
        from public.merchant_aliases as alias
       where alias.merchant_group_id = saved_group.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.save_merchant_group(uuid, uuid, text, text, boolean, text[]) from public;
grant execute on function public.save_merchant_group(uuid, uuid, text, text, boolean, text[]) to authenticated;
