-- 各國生活費比較：帳本可同步的每月生活費基準。
-- 預設值採使用者定期整理的單身租房族每月平均花費；金額皆為新台幣整數。

alter table public.ledger_financial_settings
  add column if not exists country_living_cost_baselines jsonb not null default jsonb_build_object(
    'TW', 37000,
    'JP', 38370,
    'KR', 41553,
    'CN', 19000,
    'US', 128000
  );

update public.ledger_financial_settings
   set country_living_cost_baselines = jsonb_build_object(
     'TW', 37000,
     'JP', 38370,
     'KR', 41553,
     'CN', 19000,
     'US', 128000
   )
 where country_living_cost_baselines is null
    or jsonb_typeof(country_living_cost_baselines) <> 'object';
