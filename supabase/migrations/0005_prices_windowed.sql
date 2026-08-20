-- supabase/migrations/0005_prices_windowed.sql
-- Proyecto 2 (Performance), rebanada 2 — ventana por período para /api/analytics.
-- Ejecutar COMPLETO en el SQL Editor de Supabase.
--
-- PROBLEMA QUE RESUELVE
-- `/api/analytics` pedía TODO el histórico de cada ticker en cada request, aunque
-- el usuario hubiera elegido "1 semana": ~8.200 filas en 9 páginas secuenciales
-- para graficar 5 días.
--
-- POR QUÉ NO BASTA CON `price_date >= inicio_del_período`
--
-- `periodStartDate` hace aritmética de calendario pura ("hoy menos 7 días"), así
-- que el inicio del período cae en fin de semana o feriado la mayor parte del
-- tiempo. Y hay dos cálculos que evalúan precios EXACTAMENTE en esa fecha:
--
--   * engine.ts  → portfolioRawValue(holdings, series, start)  [valor inicial del P&L]
--   * perAsset.ts → priceAsOf(serie, from)                     [retorno por activo]
--
-- Ambos dependen de `priceAsOf`, que hace forward-fill: devuelve el último punto
-- CON FECHA <= la pedida. Si la consulta arranca justo en el inicio del período,
-- ese punto no existe y ambos devuelven null. No es un caso borde: es el caso
-- común, porque la mayoría de los inicios de período no son días hábiles.
--
-- Lo mismo aplica a la línea del benchmark, que se normaliza contra
-- `priceAsOf(benchmarkSeries, dates[0])`.
--
-- Por eso la función devuelve la ventana MÁS una semilla anterior por ticker.
--
-- LA SEMILLA SON TODAS LAS FILAS DE SU FECHA, NO UNA
--
-- Decisión deliberada. Devolver una sola fila obligaría a elegir entre fuentes
-- cuando hay varias el mismo día, y esa precedencia es justo lo que se aisló
-- como Proyecto 2.1 (hoy `latest_prices` prefiere `manual`, mientras
-- `/api/analytics` y `alerts/run.ts` siguen con orden alfabético). Devolviendo
-- todas las filas de esa fecha, `priceAsOf` se comporta EXACTAMENTE igual que
-- con la tabla completa y esta migración no toca el tema. Son 1 o 2 filas extra
-- por ticker: el costo es cero y evita enredar dos problemas distintos.
--
-- El test `windowing.test.ts` fija ambas propiedades: que recortar no cambia
-- ningún resultado, y que sin la semilla el P&L absoluto y perAsset se rompen.
--
-- SEGURIDAD: `security invoker`, igual que las funciones de la migración 0004.
-- La RLS de `price_cache` sigue aplicando con el rol del llamante.
-- REVERSIBLE: `drop function` no toca datos.

create or replace function public.prices_windowed(p_tickers text[], p_from date)
returns table (
  ticker     text,
  price      numeric,
  adj_price  numeric,
  price_date date,
  source     text
)
language sql
stable
security invoker
set search_path = public
as $$
  -- Los alias de una sola letra no son estilo: evitan que las referencias
  -- choquen con los parámetros OUT de `returns table`, que están en alcance
  -- dentro del cuerpo y harían ambiguo un `order by ticker`.
  with win as (
    -- 1) Todo lo que cae dentro de la ventana.
    select pc.ticker as t, pc.price as p, pc.adj_price as ap,
           pc.price_date as d, pc.source as s
    from price_cache pc
    where pc.ticker = any(p_tickers)
      and pc.price_date >= p_from

    union all

    -- 2) La semilla: todas las filas de la última fecha ANTERIOR a la ventana,
    --    por ticker. Es lo que permite el forward-fill de `priceAsOf`.
    select pc.ticker as t, pc.price as p, pc.adj_price as ap,
           pc.price_date as d, pc.source as s
    from price_cache pc
    join (
      select pc2.ticker as t, max(pc2.price_date) as seed_date
      from price_cache pc2
      where pc2.ticker = any(p_tickers)
        and pc2.price_date < p_from
      group by pc2.ticker
    ) seed on seed.t = pc.ticker and seed.seed_date = pc.price_date
    where pc.ticker = any(p_tickers)   -- redundante por el join, pero deja
                                        -- que el planner use idx_price_cache_ticker_date
  )
  select w.t, w.p, w.ap, w.d, w.s
  from win w
  order by w.t, w.d asc, w.s asc;
$$;

comment on function public.prices_windowed(text[], date) is
  'Precios de los tickers pedidos desde p_from, más una semilla por ticker '
  '(todas las filas de la última fecha anterior) para que el forward-fill de '
  'priceAsOf funcione cuando p_from cae en fin de semana o feriado.';

-- Permisos: igual que en 0004. Los Route Handlers corren como `authenticated`;
-- `anon` no la necesita porque la ruta exige sesión.
revoke all on function public.prices_windowed(text[], date) from public;
grant execute on function public.prices_windowed(text[], date) to authenticated;

-- VERIFICACIÓN ---------------------------------------------------------------
--
-- 1) Devuelve filas y respeta permisos:
--
--      select * from prices_windowed(array['AAPL'], '2026-08-01');
--
-- 2) La semilla existe y es anterior a la ventana. Esta consulta debe devolver
--    UNA fecha por ticker, estrictamente menor que el p_from pedido:
--
--      select ticker, min(price_date) as primera
--      from prices_windowed(array['AAPL'], '2026-08-01')
--      group by ticker;
--
-- 3) Cuánto se ahorra frente a traer todo el histórico:
--
--      select (select count(*) from prices_windowed(array['AAPL'], '2026-08-01')) as con_ventana,
--             (select count(*) from price_cache where ticker = 'AAPL')            as sin_ventana;
--
-- 4) Que use el índice en vez de un seq scan:
--
--      explain analyze select * from prices_windowed(array['AAPL','ENELCHILE.SN'], '2026-08-01');
