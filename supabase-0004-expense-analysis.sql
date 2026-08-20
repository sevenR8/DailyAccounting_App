alter table public.categories
  add column if not exists analysis_nature text not null default 'maintenance';

update public.categories
   set analysis_nature = 'pleasure'
 where is_default = true
   and name = '娛樂'
   and analysis_nature = 'maintenance';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'categories_analysis_nature_check'
       and conrelid = 'public.categories'::regclass
  ) then
    alter table public.categories
      add constraint categories_analysis_nature_check
      check (analysis_nature in ('maintenance', 'pleasure'));
  end if;
end;
$$;

create table if not exists public.merchant_groups (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.ledgers(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  group_type text not null check (group_type in ('fast_food', 'convenience', 'other')),
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  unique (ledger_id, name)
);

create table if not exists public.merchant_aliases (
  id uuid primary key default gen_random_uuid(),
  merchant_group_id uuid not null references public.merchant_groups(id) on delete cascade,
  alias text not null check (char_length(trim(alias)) > 0),
  created_at timestamptz not null default now(),
  unique (merchant_group_id, alias)
);

create index if not exists merchant_groups_ledger_type
  on public.merchant_groups (ledger_id, group_type, created_at)
  where retired_at is null;

create or replace function public.seed_default_merchant_groups(p_ledger_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.merchant_groups (ledger_id, name, group_type)
  select p_ledger_id, defaults.name, defaults.group_type
    from (values
      ('麥當勞', 'fast_food'),
      ('肯德基', 'fast_food'),
      ('摩斯', 'fast_food'),
      ('漢堡王', 'fast_food'),
      ('7-11', 'convenience'),
      ('全家', 'convenience'),
      ('萊爾富', 'convenience'),
      ('OK', 'convenience')
    ) as defaults(name, group_type)
  on conflict (ledger_id, name) do nothing;

  insert into public.merchant_aliases (merchant_group_id, alias)
  select merchant_group.id, defaults.alias
    from (values
      ('麥當勞', '麥當勞'),
      ('肯德基', '肯德基'),
      ('肯德基', 'KFC'),
      ('摩斯', '摩斯'),
      ('摩斯', 'MOS'),
      ('漢堡王', '漢堡王'),
      ('漢堡王', 'Burger King'),
      ('7-11', '7-11'),
      ('7-11', '711'),
      ('7-11', '統一超商'),
      ('全家', '全家'),
      ('全家', 'FamilyMart'),
      ('萊爾富', '萊爾富'),
      ('萊爾富', 'Hi-Life'),
      ('OK', 'OK'),
      ('OK', 'OKmart')
    ) as defaults(group_name, alias)
    join public.merchant_groups as merchant_group
      on merchant_group.ledger_id = p_ledger_id
     and merchant_group.name = defaults.group_name
  on conflict (merchant_group_id, alias) do nothing;
end;
$$;

revoke all on function public.seed_default_merchant_groups(uuid) from public;

create or replace function public.seed_merchant_groups_for_new_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_default_merchant_groups(new.id);
  return new;
end;
$$;

drop trigger if exists ledgers_seed_merchant_groups on public.ledgers;
create trigger ledgers_seed_merchant_groups
  after insert on public.ledgers
  for each row execute function public.seed_merchant_groups_for_new_ledger();

do $$
declare
  ledger_row public.ledgers;
begin
  for ledger_row in select * from public.ledgers loop
    perform public.seed_default_merchant_groups(ledger_row.id);
  end loop;
end;
$$;

alter table public.merchant_groups enable row level security;
alter table public.merchant_aliases enable row level security;

create policy "帳本成員可讀取店家群組"
  on public.merchant_groups for select
  using (public.is_ledger_member(ledger_id));

create policy "帳本擁有者可管理店家群組"
  on public.merchant_groups for all
  using (public.is_ledger_owner(ledger_id))
  with check (public.is_ledger_owner(ledger_id));

create policy "帳本成員可讀取店家別名"
  on public.merchant_aliases for select
  using (exists (
    select 1 from public.merchant_groups as merchant_group
     where merchant_group.id = merchant_group_id
       and public.is_ledger_member(merchant_group.ledger_id)
  ));

create policy "帳本擁有者可管理店家別名"
  on public.merchant_aliases for all
  using (exists (
    select 1 from public.merchant_groups as merchant_group
     where merchant_group.id = merchant_group_id
       and public.is_ledger_owner(merchant_group.ledger_id)
  ))
  with check (exists (
    select 1 from public.merchant_groups as merchant_group
     where merchant_group.id = merchant_group_id
       and public.is_ledger_owner(merchant_group.ledger_id)
  ));

grant select, insert, update, delete on public.merchant_groups to authenticated;
grant select, insert, update, delete on public.merchant_aliases to authenticated;

create or replace function public.save_merchant_group(
  p_ledger_id uuid,
  p_group_id uuid,
  p_name text,
  p_group_type text,
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
    insert into public.merchant_groups (ledger_id, name, group_type)
      values (p_ledger_id, trim(p_name), p_group_type)
      returning * into saved_group;
  else
    update public.merchant_groups
       set name = trim(p_name),
           group_type = p_group_type,
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
    'retiredAt', saved_group.retired_at,
    'aliases', coalesce((
      select jsonb_agg(alias.alias order by alias.created_at, alias.alias)
        from public.merchant_aliases as alias
       where alias.merchant_group_id = saved_group.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.save_merchant_group(uuid, uuid, text, text, text[]) from public;
grant execute on function public.save_merchant_group(uuid, uuid, text, text, text[]) to authenticated;

create or replace function public.retire_merchant_group(
  p_ledger_id uuid,
  p_group_id uuid,
  p_retired_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_ledger_owner(p_ledger_id) then
    raise exception 'ledger_owner_required';
  end if;
  update public.merchant_groups
     set retired_at = p_retired_at
   where id = p_group_id
     and ledger_id = p_ledger_id;
end;
$$;

revoke all on function public.retire_merchant_group(uuid, uuid, timestamptz) from public;
grant execute on function public.retire_merchant_group(uuid, uuid, timestamptz) to authenticated;
