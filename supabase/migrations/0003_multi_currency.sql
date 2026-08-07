-- supabase/migrations/0003_multi_currency.sql
-- Fase 7 — Soporte multi-moneda con base CLP.
-- Ejecutar COMPLETO en el SQL Editor de Supabase. PostgreSQL tiene DDL
-- transaccional: si una guarda falla, revierte TODO (columnas incluidas) y la
-- base queda exactamente como estaba. No hay estado intermedio posible.
--
-- PRERREQUISITO: `USDCLP=X` backfilleado en price_cache cubriendo el rango de
-- snapshot_date. La Guarda B lo verifica.

-- 1. Costos de transacción desglosados (comisión + IVA del comprobante Zesty).
alter table transactions add column commission numeric not null default 0 check (commission >= 0);
alter table transactions add column iva        numeric not null default 0 check (iva >= 0);

-- Histórico: antes de esta fase no había IVA, todo el `fees` era comisión.
update transactions set commission = fees, iva = 0;

-- `fees` pasa a ser COLUMNA GENERADA por Postgres. Un CHECK `fees = commission + iva`
-- sería frágil: el cliente enviaría la suma calculada en coma flotante de JS
-- (1.13 + 0.21 = 1.3399999999999999) y Postgres la compararía contra `numeric`
-- exacto (1.34), rechazando el insert. Generándola en la BD el desajuste es
-- imposible por construcción, y el valor histórico se preserva porque ya se
-- copió a `commission` arriba.
alter table transactions drop column fees;
alter table transactions add column fees numeric generated always as (commission + iva) stored;

-- 2. Moneda del snapshot: nullable primero, el bloque de abajo la rellena.
alter table snapshots add column currency text;

-- 3. Guardas + conversión del histórico, atómico.
do $$
declare
  mixed_assets int;
  missing_fx   int;
begin
  -- Guarda A: el histórico debe ser USD puro. Si ya hubiera un activo en otra
  -- moneda dentro del rango, multiplicar el total en bloque falsearía el
  -- patrimonio histórico.
  select count(*) into mixed_assets
  from assets a
  where a.currency <> 'USD'
    and exists (select 1 from transactions t
                where t.asset_id = a.id
                  and t.executed_at <= (select max(snapshot_date) from snapshots));

  if mixed_assets > 0 then
    raise exception
      'Abortado: % activo(s) no-USD con transacciones dentro del rango de snapshots. '
      'El histórico no es USD puro; convertirlo en bloque falsearía el patrimonio.', mixed_assets;
  end if;

  -- Guarda B: debe existir FX para cada snapshot a convertir.
  select count(*) into missing_fx
  from snapshots s
  where s.currency is null
    and not exists (select 1 from price_cache pc
                    where pc.ticker = 'USDCLP=X' and pc.price_date <= s.snapshot_date);

  if missing_fx > 0 then
    raise exception
      'Abortado: % snapshot(s) sin USDCLP=X disponible a su fecha. '
      'Ejecuta primero el backfill de precios en /data-sources.', missing_fx;
  end if;

  -- Conversión idempotente: solo filas sin moneda, marcadas al convertirlas.
  -- Correrlo dos veces no puede doble-convertir. Forward-fill del FX vía
  -- `order by price_date desc limit 1` (cubre snapshots de fin de semana).
  update snapshots s
  set total_value = s.total_value * (
        select pc.price from price_cache pc
        where pc.ticker = 'USDCLP=X' and pc.price_date <= s.snapshot_date
        order by pc.price_date desc limit 1),
      currency = 'CLP'
  where s.currency is null;
end $$;

-- 4. Cierre: a partir de aquí todo snapshot nace autodescriptivo.
alter table snapshots alter column currency set default 'CLP';
alter table snapshots alter column currency set not null;
