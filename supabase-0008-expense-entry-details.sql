-- Add an optional detail line to each expense without changing existing entries.
alter table public.expense_entries
  add column if not exists item_detail text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.expense_entries'::regclass
      and conname = 'expense_entries_item_detail_length'
  ) then
    alter table public.expense_entries
      add constraint expense_entries_item_detail_length
      check (item_detail is null or char_length(item_detail) <= 200);
  end if;
end;
$$;
