-- supabase/migrations/0001_init.sql
-- Esquema completo Portfolio App. Ejecutar en Supabase SQL Editor.

create table assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  name text not null default '',
  asset_type text not null check (asset_type in ('stock','etf','crypto','cash','other')),
  currency text not null default 'USD' check (currency = upper(currency) and length(currency) = 3),
  created_at timestamptz not null default now(),
  unique (user_id, ticker)
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  side text not null check (side in ('buy','sell')),
  quantity numeric not null check (quantity > 0),
  price numeric not null check (price >= 0),
  fees numeric not null default 0 check (fees >= 0),
  executed_at date not null,
  created_at timestamptz not null default now()
);

create table snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_date date not null,
  total_value numeric not null,
  created_at timestamptz not null default now(),
  unique (user_id, snapshot_date)
);

create table strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  strategy_type text not null check (strategy_type in ('momentum','rebalance','dca','stop_loss')),
  params jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid references assets(id) on delete cascade,
  alert_type text not null check (alert_type in ('price_above','price_below','pct_change','rebalance_drift')),
  threshold numeric not null,
  status text not null default 'active' check (status in ('active','triggered','disabled')),
  created_at timestamptz not null default now(),
  triggered_at timestamptz
);

-- Caché de precios compartida entre usuarios (los precios de mercado no son privados)
create table price_cache (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  price_date date not null,
  price numeric not null check (price > 0),
  source text not null,
  created_at timestamptz not null default now(),
  unique (ticker, price_date, source)
);

create index idx_transactions_user_asset on transactions(user_id, asset_id);
create index idx_price_cache_ticker_date on price_cache(ticker, price_date desc);

-- RLS: cada usuario solo ve sus filas
-- Nota de diseño: los jobs de Fase 2 (market data, snapshots) se ejecutan en
-- Route Handlers bajo la sesión del usuario (rol authenticated), por lo que las
-- políticas siguientes los cubren; no se depende del bypass de service_role.
-- Se permite UPDATE retroactivo en price_cache: corregir un precio manual
-- histórico es un caso de uso legítimo en una app personal.
alter table assets enable row level security;
alter table transactions enable row level security;
alter table snapshots enable row level security;
alter table strategies enable row level security;
alter table alerts enable row level security;
alter table price_cache enable row level security;

create policy "own assets" on assets for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own transactions" on transactions for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from assets a where a.id = asset_id and a.user_id = auth.uid())
  );
create policy "own snapshots" on snapshots for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own strategies" on strategies for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own alerts" on alerts for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (asset_id is null
         or exists (select 1 from assets a where a.id = asset_id and a.user_id = auth.uid()))
  );

create policy "read prices" on price_cache for select to authenticated using (true);
create policy "write prices" on price_cache for insert to authenticated with check (true);
create policy "update prices" on price_cache for update to authenticated using (true);
