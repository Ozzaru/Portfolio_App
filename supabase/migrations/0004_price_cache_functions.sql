-- supabase/migrations/0004_price_cache_functions.sql
-- Proyecto 2 (Performance) — funciones de lectura sobre `price_cache`.
-- Ejecutar COMPLETO en el SQL Editor de Supabase.
--
-- PROBLEMA QUE RESUELVE
-- PostgREST no expresa `DISTINCT ON` ni agregaciones agrupadas, así que
-- `/api/positions` y `/api/prices/status` traían la tabla ENTERA y filtraban en
-- JavaScript: 11.817 filas en 12 viajes secuenciales de 1000, en cada carga.
-- Ambas necesitaban un puñado de filas.
--
-- LÍMITE DE DISEÑO: estas funciones hacen FORMA DE DATOS (qué filas devolver),
-- no dominio. El significado de esas filas (P&L, cierre anterior, valorización)
-- sigue en TypeScript y sigue cubierto por Vitest.
--
-- SEGURIDAD: ambas son `security invoker`, así que corren con el rol del
-- llamante y la RLS de `price_cache` sigue aplicando igual que antes. No hay
-- escalada de privilegios: la política `read prices` ya permite a cualquier
-- usuario `authenticated` leer la caché (los precios de mercado no son privados).
--
-- REVERSIBLE: `drop function` no toca datos. A diferencia de un `drop table`,
-- deshacer esta migración no puede perder nada.

-- 1. Últimos N precios por ticker -------------------------------------------
--
-- Devuelve los DOS precios más recientes de cada ticker pedido: el actual y el
-- cierre anterior, que es lo que necesita el P&L del día.
--
-- Dos pasos deliberados:
--
--   a) `distinct on (ticker, price_date)` colapsa a UNA fila por día. La tabla
--      admite varias fuentes para el mismo día (`unique (ticker, price_date,
--      source)`), y sin este paso "los 2 más recientes" podrían ser dos fuentes
--      del MISMO día en vez de dos días distintos — que es exactamente el bug
--      latente del código anterior. Ver nota de comportamiento abajo.
--
--   b) `row_number()` sobre los días ya colapsados toma los 2 más recientes.
--
-- El desempate entre fuentes del mismo día es `source asc`, idéntico al
-- `.order('source', { ascending: true })` que usaba el código anterior. Se
-- conserva a propósito para no cambiar dos cosas a la vez.
--
-- NOTA DE COMPORTAMIENTO: si un ticker tiene varias fuentes en un mismo día,
-- esta función devuelve dos días distintos donde el código anterior devolvía
-- dos filas del mismo día (y calculaba un P&L diario de cero o de disparate).
-- Es una corrección, no una regresión. Para saber si te afecta hoy:
--
--   select ticker, price_date, count(*) as fuentes
--   from price_cache group by ticker, price_date having count(*) > 1;
--
-- Usa el índice existente `idx_price_cache_ticker_date (ticker, price_date desc)`.

create or replace function public.latest_prices(p_tickers text[])
returns table (
  ticker     text,
  price      numeric,
  price_date date,
  source     text
)
language sql
stable
security invoker
set search_path = public
as $$
  with per_date as (
    select distinct on (pc.ticker, pc.price_date)
           pc.ticker, pc.price, pc.price_date, pc.source
    from price_cache pc
    where pc.ticker = any(p_tickers)
    order by pc.ticker, pc.price_date desc, pc.source asc
  ),
  ranked as (
    select pd.ticker, pd.price, pd.price_date, pd.source,
           row_number() over (partition by pd.ticker order by pd.price_date desc) as rn
    from per_date pd
  )
  select r.ticker, r.price, r.price_date, r.source
  from ranked r
  where r.rn <= 2
  order by r.ticker, r.price_date desc;
$$;

comment on function public.latest_prices(text[]) is
  'Los 2 precios más recientes de cada ticker pedido (actual + cierre anterior), '
  'colapsando a una fila por día. Reemplaza el scan completo de /api/positions.';

-- 2. Estado de la caché por fuente ------------------------------------------
--
-- `/api/prices/status` sólo muestra, por fuente, la última fecha cargada y
-- cuántos tickers distintos cubre. Eso son dos agregaciones que Postgres
-- resuelve leyendo la tabla localmente; traer 11.817 filas por la red para
-- calcularlas en JavaScript era el peor cambio de todos.
--
-- `count(distinct ...)` devuelve `bigint`; el llamante lo convierte con Number().

create or replace function public.price_cache_status()
returns table (
  source       text,
  last_date    date,
  ticker_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select pc.source,
         max(pc.price_date)       as last_date,
         count(distinct pc.ticker) as ticker_count
  from price_cache pc
  group by pc.source
  order by pc.source;
$$;

comment on function public.price_cache_status() is
  'Por fuente: última fecha cargada y nº de tickers distintos. '
  'Reemplaza el scan completo de /api/prices/status.';

-- 3. Permisos ----------------------------------------------------------------
--
-- Por defecto Postgres concede EXECUTE a PUBLIC en toda función nueva. Se
-- revoca y se concede sólo a `authenticated`, que es el rol bajo el que corren
-- los Route Handlers. `anon` no las necesita: ambas rutas exigen sesión.

revoke all on function public.latest_prices(text[]) from public;
revoke all on function public.price_cache_status()  from public;

grant execute on function public.latest_prices(text[]) to authenticated;
grant execute on function public.price_cache_status()  to authenticated;

-- 4. Verificación ------------------------------------------------------------
--
-- Correr después de aplicar. Deben devolver filas, no error de permisos:
--
--   select * from latest_prices(array['AAPL']);
--   select * from price_cache_status();
--
-- Y para confirmar que el índice se usa en vez de un seq scan:
--
--   explain analyze select * from latest_prices(array['AAPL','ENELCHILE.SN']);
