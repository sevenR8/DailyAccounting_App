create extension if not exists pgcrypto;

create type public.ledger_member_role as enum ('owner', 'member');
create type public.ledger_kind as enum ('personal', 'household');

create table public.ledgers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) > 0),
  kind public.ledger_kind not null default 'personal',
  personal_owner_id uuid unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.ledger_members (
  ledger_id uuid not null references public.ledgers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.ledger_member_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (ledger_id, user_id)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.ledgers(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  is_default boolean not null default false,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  unique (ledger_id, name)
);

create or replace function public.is_ledger_member(p_ledger_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.ledger_members
    where ledger_id = p_ledger_id and user_id = auth.uid()
  );
$$;

revoke all on function public.is_ledger_member(uuid) from public;
grant execute on function public.is_ledger_member(uuid) to authenticated;

alter table public.ledgers enable row level security;
alter table public.ledger_members enable row level security;
alter table public.categories enable row level security;

create policy "帳本成員可讀取帳本"
  on public.ledgers for select
  using (public.is_ledger_member(id));

create policy "帳本成員可讀取成員"
  on public.ledger_members for select
  using (public.is_ledger_member(ledger_id));

create policy "帳本成員可讀取分類"
  on public.categories for select
  using (public.is_ledger_member(ledger_id));

create or replace function public.provision_personal_ledger(p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  personal_ledger_id uuid;
  personal_ledger_name text;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;

  select l.id, l.name
    into personal_ledger_id, personal_ledger_name
    from public.ledgers l
   where l.personal_owner_id = current_user_id
   limit 1;

  if personal_ledger_id is null then
    personal_ledger_name := case
      when nullif(trim(p_display_name), '') is null then '我的帳本'
      else trim(p_display_name) || '的帳本'
    end;
    insert into public.ledgers (name, kind, personal_owner_id)
      values (personal_ledger_name, 'personal', current_user_id)
      returning id into personal_ledger_id;

    insert into public.ledger_members (ledger_id, user_id, role)
      values (personal_ledger_id, current_user_id, 'owner');

    insert into public.categories (ledger_id, name, is_default)
      select personal_ledger_id, category_name, true
      from unnest(array['飲食', '娛樂', '醫療', '交通', '生活', '訂閱']) as category_name;
  end if;

  return jsonb_build_object(
    'id', personal_ledger_id,
    'ownerId', current_user_id,
    'name', personal_ledger_name,
    'members', jsonb_build_array(jsonb_build_object('userId', current_user_id, 'role', 'owner')),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'retiredAt', c.retired_at) order by c.created_at)
      from public.categories c
      where c.ledger_id = personal_ledger_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.provision_personal_ledger(text) from public;
grant execute on function public.provision_personal_ledger(text) to authenticated;

