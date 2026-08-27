-- supabase/migrations/0006_portfolios.sql
-- Proyecto 3, fase 1 — portafolios como entidad real. COMPATIBLE HACIA ATRÁS.
-- Ejecutar COMPLETO en el SQL Editor de Supabase.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ
--
-- La app asume que toda operación es local chilena. El formulario de
-- transacciones autocalcula 19% de IVA sobre la comisión SIEMPRE
-- (portfolio/page.tsx). Mira lo que hace su comprobación de moneda:
--
--     const isClp = ...currency === 'CLP'
--     setIva(String(isClp ? Math.round(raw) : Math.round(raw * 100) / 100))
--
-- La moneda decide el REDONDEO, no si el IVA aplica. Peor que no mirarla:
-- parece que el caso internacional está cubierto.
--
-- Ese IVA entra al cost basis —`holdings.ts` suma `fees` al costo en compras y
-- lo capitaliza en ventas—, así que el costo promedio y el P&L de los activos
-- en USD quedan inflados por un impuesto que no existe en esas operaciones.
--
-- Además no hay dónde poner las fees regulatorias gringas (CAT, REG, TAF): el
-- esquema sólo conoce comisión + IVA, y hoy habría que amontonarlas dentro de
-- la comisión, perdiendo el desglose que el comprobante sí distingue.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 1 DE 2
--
-- Esta migración NO rompe la app actual. `assets.portfolio_id` queda NULLABLE y
-- un trigger lo asigna por moneda cuando viene NULL, así que las rutas sin
-- actualizar siguen insertando activos correctos.
--
-- La 0007 cerrará: `NOT NULL`, el trigger que rechaza IVA en portafolios
-- internacionales, y la unicidad de snapshots por portafolio. Va DESPUÉS de
-- actualizar rutas y UI.
--
-- ATOMICIDAD: PostgreSQL tiene DDL transaccional. Si una guarda falla, revierte
-- TODO —tablas, columnas, triggers y datos— y la base queda exactamente como
-- estaba. No hay estado intermedio posible.
-- ─────────────────────────────────────────────────────────────────────────────


-- 1. La tabla ----------------------------------------------------------------
--
-- `base_currency` y `fee_structure_type` son columnas SEPARADAS a propósito.
-- Hoy coinciden (CLP↔local, USD↔intl), pero son cosas distintas: un bróker
-- chileno que cobre en dólares no es imposible. Derivar una de la otra sería
-- codificar una coincidencia como si fuera una regla.

create table portfolios (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  name               text not null,
  base_currency      text not null check (base_currency = upper(base_currency) and length(base_currency) = 3),
  fee_structure_type text not null check (fee_structure_type in ('local_clp', 'intl_usd')),
  created_at         timestamptz not null default now(),
  unique (user_id, name)
);

alter table portfolios enable row level security;

create policy "own portfolios" on portfolios for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- 2. Un portafolio de cada tipo por usuario ----------------------------------
--
-- Los nombres son editables desde la UI más adelante; sólo tienen que ser
-- únicos por usuario. `on conflict do nothing` hace la migración re-ejecutable
-- sin duplicar.

insert into portfolios (user_id, name, base_currency, fee_structure_type)
select u.id, 'Nacional (CLP)', 'CLP', 'local_clp' from auth.users u
union all
select u.id, 'Internacional (USD)', 'USD', 'intl_usd' from auth.users u
on conflict (user_id, name) do nothing;


-- 3. Los activos pertenecen a un portafolio ----------------------------------
--
-- NULLABLE en esta fase: la 0007 lo cierra. La FK sólo va acá y NO en
-- `transactions`: una transacción pertenece al portafolio de su activo por
-- definición, y duplicar la referencia permitiría que diverjan hacia un estado
-- que no significa nada.

alter table assets add column portfolio_id uuid references portfolios(id) on delete cascade;
create index idx_assets_portfolio on assets(portfolio_id);

-- Reparto determinista por moneda: CLP al local, todo lo demás al internacional.
update assets a
set portfolio_id = p.id
from portfolios p
where p.user_id = a.user_id
  and p.fee_structure_type = case when a.currency = 'CLP' then 'local_clp' else 'intl_usd' end;


-- 4. Asignación automática mientras las rutas no estén actualizadas ----------
--
-- Es lo que hace esta migración compatible hacia atrás: la app actual inserta
-- activos sin `portfolio_id` y este trigger los coloca por moneda, con la misma
-- regla del backfill de arriba. Sin él, cada activo creado entre la 0006 y la
-- 0007 nacería huérfano.
--
-- `security invoker` (el default): lee `portfolios` bajo la RLS del llamante,
-- que sólo ve las suyas. No hace falta escalar privilegios.

create function assign_portfolio_by_currency() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.portfolio_id is null then
    select p.id into new.portfolio_id
    from portfolios p
    where p.user_id = new.user_id
      and p.fee_structure_type = case when new.currency = 'CLP' then 'local_clp' else 'intl_usd' end
    limit 1;
  end if;
  return new;
end $$;

create trigger assets_assign_portfolio
  before insert on assets
  for each row execute function assign_portfolio_by_currency();


-- 5. Un activo no puede apuntar al portafolio de otro usuario ----------------
--
-- Mismo patrón que ya usan las políticas de `transactions` y `alerts`, que
-- verifican que el activo referenciado sea del usuario. Se admite NULL porque
-- en esta fase la columna todavía lo es; la 0007 quita esa rama.

drop policy "own assets" on assets;

create policy "own assets" on assets for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (
      assets.portfolio_id is null
      or exists (select 1 from portfolios p where p.id = assets.portfolio_id and p.user_id = auth.uid())
    )
  );


-- 6. Fees regulatorias -------------------------------------------------------
--
-- CAT, REG y TAF agregadas en una sola columna. NO una por cada una: son
-- específicas de un bróker y de un momento, y el esquema no debería versionar
-- la tabla de tarifas de nadie. Si algún día hace falta el detalle, la
-- respuesta es un `jsonb`, no cinco columnas más.
--
-- `fees` sigue siendo COLUMNA GENERADA, ahora con tres sumandos. Se recrea con
-- el mismo nombre y la misma semántica, así que todo el código que la lee sigue
-- funcionando sin cambios. Misma maniobra que la 0003.

alter table transactions add column regulatory_fees numeric not null default 0 check (regulatory_fees >= 0);

alter table transactions drop column fees;
alter table transactions add column fees numeric
  generated always as (commission + iva + regulatory_fees) stored;


-- 7. Snapshots ---------------------------------------------------------------
--
-- El histórico existente va COMPLETO al portafolio local (decisión del usuario).
--
-- CONSECUENCIA, explícita para que nadie la descubra leyendo un gráfico: esos
-- snapshots son un consolidado — su `total_value` incluye los activos en USD ya
-- convertidos a pesos. Al quedar bajo el portafolio local, su serie histórica
-- ANTES del corte no es la del portafolio local puro, sino la de toda la
-- cartera. Los retornos de período largo del portafolio CLP mezclan ambas cosas
-- hasta la fecha de esta migración. Es un "consolidado legacy" asumido a
-- propósito, no un error.
--
-- La unicidad sigue siendo (user_id, snapshot_date) en esta fase. Los snapshots
-- que la app genere entre la 0006 y la 0007 quedarán con `portfolio_id` NULL y
-- siguen siendo consolidados: la 0007 los asignará con la misma regla y recién
-- ahí la unicidad pasa a incluir el portafolio.

alter table snapshots add column portfolio_id uuid references portfolios(id) on delete cascade;
create index idx_snapshots_portfolio on snapshots(portfolio_id, snapshot_date desc);

update snapshots s
set portfolio_id = p.id
from portfolios p
where p.user_id = s.user_id
  and p.fee_structure_type = 'local_clp';


-- 8. Guardas -----------------------------------------------------------------
--
-- Si algo de lo anterior dejó datos inconsistentes, abortar revierte la
-- migración entera. Preferible a descubrirlo con la app ya corriendo encima.

do $$
declare
  usuarios          int;
  portafolios       int;
  activos_huerfanos int;
  activos_cruzados  int;
  snaps_huerfanos   int;
begin
  select count(*) into usuarios from auth.users;

  -- Dos portafolios por usuario, ni más ni menos.
  select count(*) into portafolios from portfolios;
  if portafolios <> usuarios * 2 then
    raise exception
      'Abortado: se esperaban % portafolios (2 por usuario) y hay %. '
      'Revisa si ya existían filas con esos nombres.', usuarios * 2, portafolios;
  end if;

  -- Ningún activo quedó sin portafolio.
  select count(*) into activos_huerfanos from assets where portfolio_id is null;
  if activos_huerfanos > 0 then
    raise exception
      'Abortado: % activo(s) sin portafolio tras el reparto. '
      'Probablemente pertenecen a un usuario sin portafolios creados.', activos_huerfanos;
  end if;

  -- Ningún activo apunta al portafolio de otro usuario.
  select count(*) into activos_cruzados
  from assets a join portfolios p on p.id = a.portfolio_id
  where p.user_id <> a.user_id;
  if activos_cruzados > 0 then
    raise exception 'Abortado: % activo(s) apuntan al portafolio de otro usuario.', activos_cruzados;
  end if;

  -- Ningún snapshot histórico quedó sin asignar.
  select count(*) into snaps_huerfanos from snapshots where portfolio_id is null;
  if snaps_huerfanos > 0 then
    raise exception
      'Abortado: % snapshot(s) sin portafolio. Todos los existentes debían ir al local.',
      snaps_huerfanos;
  end if;
end $$;


-- VERIFICACIÓN ---------------------------------------------------------------
--
-- Correr después de aplicar. Debe devolver una fila por portafolio, con el
-- reparto de activos por moneda:
--
--   select p.name, p.base_currency, p.fee_structure_type,
--          count(a.id) as activos,
--          string_agg(a.ticker, ', ' order by a.ticker) as tickers
--   from portfolios p
--   left join assets a on a.portfolio_id = p.id
--   group by p.id, p.name, p.base_currency, p.fee_structure_type
--   order by p.name;
--
-- Y que `fees` siga cuadrando con sus tres sumandos:
--
--   select count(*) as descuadres
--   from transactions
--   where fees <> commission + iva + regulatory_fees;
--
-- El trigger de asignación automática, sin insertar nada de verdad:
--
--   begin;
--   insert into assets (user_id, ticker, asset_type, currency)
--   values ((select id from auth.users limit 1), 'ZZTEST', 'stock', 'USD');
--   select ticker, portfolio_id is not null as tiene_portafolio from assets where ticker = 'ZZTEST';
--   rollback;
