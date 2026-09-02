-- supabase/migrations/0010_fx_audit_created_at.sql
-- Proyecto 3.1, rebanada 2 — desempate de traspasos por created_at.
-- Ejecutar COMPLETO en el SQL Editor de Supabase.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ
--
-- `occurred_at` en `fx_transfers` es un `date`. Dos traspasos del mismo día
-- empatan en esa columna, y Postgres puede devolverlos en cualquier orden,
-- reordenando la lista entre renders. Este no es un caso raro: la
-- reconstrucción histórica desde junio carga varias conversiones con la misma
-- fecha, así que el empate es el caso NORMAL, no la excepción.
--
-- `src/app/api/cash/movements/route.ts` ya resolvió exactamente este problema
-- para `cash_movements` desempatando con `.order('created_at')`. La ruta de
-- traspasos necesita el mismo desempate, pero `fx_transfers_audit` no proyecta
-- `created_at` —aunque la tabla de abajo sí la tiene—, así que la vista tiene
-- que cambiar antes de que la ruta pueda pedirla.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ORDEN DE APLICACIÓN: LIBRE. Esta migración es PURAMENTE ADITIVA.
--
-- `create or replace view` sólo permite AGREGAR columnas al final de la lista
-- —reordenar o insertar en el medio falla—, así que `created_at` se agrega
-- como última columna y el resto de la vista queda intacto. Ningún código
-- desplegado hoy pide esa columna, así que aplicar esto no rompe nada; lo que
-- se rompe es lo contrario: desplegar la ruta que SÍ la pide (Tarea 3, con
-- este fix) contra una base donde esta migración no se aplicó todavía. Ver el
-- mensaje del commit de la ruta.
-- ─────────────────────────────────────────────────────────────────────────────


-- 1. La vista, con created_at agregado al final -------------------------------
--
-- Cuerpo idéntico al de la 0009, sección 5 — mismos `case`, mismo forward-fill
-- por `left join lateral`. Sólo se agrega la columna final.

create or replace view fx_transfers_audit with (security_invoker = true) as
  select
    f.id,
    f.user_id,
    f.from_portfolio_id,
    f.from_currency,
    f.from_amount,
    f.to_portfolio_id,
    f.to_currency,
    f.to_amount,
    f.occurred_at,
    f.note,

    case
      when f.from_currency = 'CLP' and f.to_currency = 'USD' then f.from_amount / f.to_amount
      when f.from_currency = 'USD' and f.to_currency = 'CLP' then f.to_amount / f.from_amount
    end as clp_por_usd,

    m.price as clp_por_usd_mercado,

    case
      when f.from_currency = 'CLP' and f.to_currency = 'USD' then f.from_amount - f.to_amount * m.price
      when f.from_currency = 'USD' and f.to_currency = 'CLP' then f.from_amount * m.price - f.to_amount
    end as costo_spread_clp,

    f.created_at

  from fx_transfers f
  -- Forward-fill del FX: el `order by desc limit 1` toma el último precio a la
  -- fecha o antes, así que un traspaso de fin de semana o feriado usa el cierre
  -- hábil previo en vez de quedarse sin tasa. Mismo patrón que la 0003.
  left join lateral (
    select pc.price
    from price_cache pc
    where pc.ticker = 'USDCLP=X' and pc.price_date <= f.occurred_at
    order by pc.price_date desc
    limit 1
  ) m on true;


-- 2. Guarda --------------------------------------------------------------------
--
-- Mismo motivo que la guarda de la 0009, sección 6: `security_invoker` es la
-- única línea de defensa entre esta vista y exponer el libro de todos los
-- usuarios, y su ausencia no se nota mirando el resultado de una consulta
-- propia. `create or replace view` reescribe la vista entera, así que un
-- futuro editor que copie el cuerpo sin la opción la dejaría corriendo con los
-- permisos del dueño en silencio. Esta guarda scoped a `fx_transfers_audit`
-- para que ese error aborte la migración en vez de desplegarse.

do $$
declare
  insegura int;
begin
  select count(*) into insegura
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'v'
    and c.relname = 'fx_transfers_audit'
    and coalesce(
          (select o from unnest(coalesce(c.reloptions, '{}')) o where o like 'security_invoker=%'),
          ''
        ) not in ('security_invoker=true', 'security_invoker=on', 'security_invoker=1');

  if insegura > 0 then
    raise exception
      'Abortado: fx_transfers_audit quedo sin security_invoker=true. Correria '
      'con los permisos del dueno y saltearia el RLS, exponiendo el libro de '
      'TODOS los usuarios a cualquier usuario autenticado.';
  end if;
end $$;


-- VERIFICACIÓN ---------------------------------------------------------------
--
-- Correr DESPUÉS de aplicar. Todo va dentro de begin/rollback: nada de esto
-- debe quedar guardado.
--
-- ── La vista sigue devolviendo lo mismo de antes, más created_at ────────────
--
--   select clp_por_usd, clp_por_usd_mercado, costo_spread_clp, created_at
--   from fx_transfers_audit limit 1;
--
-- ── Dos traspasos del mismo día quedan en orden de inserción, no al azar ────
--
--   begin;
--   insert into fx_transfers
--     (user_id, from_portfolio_id, from_currency, from_amount,
--                 to_portfolio_id,   to_currency,   to_amount, occurred_at)
--   select u.id, loc.id, 'CLP', 100000, intl.id, 'USD', 100, current_date
--   from auth.users u
--   join portfolios loc  on loc.user_id  = u.id and loc.fee_structure_type  = 'local_clp'
--   join portfolios intl on intl.user_id = u.id and intl.fee_structure_type = 'intl_usd'
--   limit 1;
--
--   insert into fx_transfers
--     (user_id, from_portfolio_id, from_currency, from_amount,
--                 to_portfolio_id,   to_currency,   to_amount, occurred_at)
--   select u.id, loc.id, 'CLP', 200000, intl.id, 'USD', 200, current_date
--   from auth.users u
--   join portfolios loc  on loc.user_id  = u.id and loc.fee_structure_type  = 'local_clp'
--   join portfolios intl on intl.user_id = u.id and intl.fee_structure_type = 'intl_usd'
--   limit 1;
--
--   -- Esperado: el de 200000 primero, ordenado por created_at desc.
--   select from_amount, created_at from fx_transfers_audit order by created_at desc;
--   rollback;
