create extension if not exists pgcrypto;

create type public.ledger_member_role as enum ('owner', 'member');
create type public.ledger_kind as enum ('personal', 'household');
create type public.payment_method as enum ('cash', 'credit_card');

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

alter table public.categories
  add unique (ledger_id, id);

create table public.expense_entries (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.ledgers(id) on delete cascade,
  category_id uuid not null,
  item_name text not null check (char_length(trim(item_name)) > 0),
  amount integer not null check (amount > 0),
  payment_method public.payment_method not null,
  occurred_at timestamptz not null default now(),
  recorder_member_id uuid not null default auth.uid(),
  payer_member_id uuid,
  is_fixed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (ledger_id, category_id)
    references public.categories (ledger_id, id),
  foreign key (ledger_id, recorder_member_id)
    references public.ledger_members (ledger_id, user_id),
  foreign key (ledger_id, payer_member_id)
    references public.ledger_members (ledger_id, user_id)
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

create or replace function public.is_ledger_owner(p_ledger_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.ledger_members
    where ledger_id = p_ledger_id
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;

revoke all on function public.is_ledger_owner(uuid) from public;
grant execute on function public.is_ledger_owner(uuid) to authenticated;

create or replace function public.set_expense_entry_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger expense_entries_set_updated_at
  before update on public.expense_entries
  for each row execute function public.set_expense_entry_updated_at();

create or replace function public.prevent_category_delete_with_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.expense_entries
    where ledger_id = old.ledger_id and category_id = old.id
  ) then
    raise exception 'category_has_expense_history';
  end if;
  return old;
end;
$$;

create trigger categories_preserve_history
  before delete on public.categories
  for each row execute function public.prevent_category_delete_with_history();

alter table public.ledgers enable row level security;
alter table public.ledger_members enable row level security;
alter table public.categories enable row level security;
alter table public.expense_entries enable row level security;

create policy "帳本成員可讀取帳本"
  on public.ledgers for select
  using (public.is_ledger_member(id));

create policy "帳本成員可讀取成員"
  on public.ledger_members for select
  using (public.is_ledger_member(ledger_id));

create policy "帳本成員可讀取分類"
  on public.categories for select
  using (public.is_ledger_member(ledger_id));

create policy "帳本成員可讀取開銷"
  on public.expense_entries for select
  using (public.is_ledger_member(ledger_id));

create policy "帳本擁有者可管理成員"
  on public.ledger_members for all
  using (public.is_ledger_owner(ledger_id))
  with check (public.is_ledger_owner(ledger_id));

create policy "帳本擁有者可管理分類"
  on public.categories for all
  using (public.is_ledger_owner(ledger_id))
  with check (public.is_ledger_owner(ledger_id));

create policy "帳本成員可新增自己記錄的開銷"
  on public.expense_entries for insert
  with check (
    public.is_ledger_member(ledger_id)
    and recorder_member_id = auth.uid()
  );

create policy "記錄者或帳本擁有者可修改開銷"
  on public.expense_entries for update
  using (
    recorder_member_id = auth.uid()
    or public.is_ledger_owner(ledger_id)
  )
  with check (
    public.is_ledger_member(ledger_id)
    and (
      recorder_member_id = auth.uid()
      or public.is_ledger_owner(ledger_id)
    )
  );

create policy "記錄者或帳本擁有者可刪除開銷"
  on public.expense_entries for delete
  using (
    recorder_member_id = auth.uid()
    or public.is_ledger_owner(ledger_id)
  );

grant select on public.ledgers to authenticated;
grant select, insert, update, delete on public.ledger_members to authenticated;
grant select, insert, update, delete on public.categories to authenticated;
grant select, insert, update, delete on public.expense_entries to authenticated;

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
      on conflict (personal_owner_id) do nothing
      returning id into personal_ledger_id;

    if found then
      insert into public.ledger_members (ledger_id, user_id, role)
        values (personal_ledger_id, current_user_id, 'owner');

      insert into public.categories (ledger_id, name, is_default)
        select personal_ledger_id, category_name, true
        from unnest(array['飲食', '娛樂', '醫療', '交通', '生活', '訂閱']) as category_name;
    else
      select l.id, l.name
        into personal_ledger_id, personal_ledger_name
        from public.ledgers l
       where l.personal_owner_id = current_user_id;
    end if;
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

