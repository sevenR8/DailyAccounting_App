-- 讓使用者用一筆記錄收回他人返還的款項，不必逐筆建立代墊明細。
alter table public.expense_entries
  add column if not exists is_reimbursement boolean not null default false;

comment on column public.expense_entries.is_reimbursement is
  'true 表示收到的收回款；false 表示一般開銷。金額維持正數，計算時由應用程式反轉為收入方向。';
