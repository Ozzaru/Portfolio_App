-- supabase/migrations/0008_portfolios_cierre.sql
-- Proyecto 3, rebanada 4 — cierre. FASE 2 DE 2 de la 0006.
-- Ejecutar COMPLETO en el SQL Editor de Supabase.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ORDEN DE APLICACIÓN: JUNTO CON EL CÓDIGO DE LA REBANADA 4
--
-- Esta migración y el código de su rebanada se necesitan mutuamente:
--
--   · La 0008 exige `portfolio_id` en cada activo. El código que lo envía
--     (`POST /api/assets`) ya está desplegado desde la rebanada 2, así que por
--     ese lado no hay problema.
--
--   · PERO cambia la unicidad de `snapshots` a (user_id, portfolio_id,
--     snapshot_date). El código ANTERIOR escribe snapshots sin `portfolio_id` y
--     fallaría contra el NOT NULL; el código NUEVO usa el conflict target nuevo
--     y fallaría si la migración no está aplicada.
--
-- O sea que hay una ventana en la que uno de los dos lados está roto, se haga en
-- el orden que se haga. Lo único que se rompe ahí es "Actualizar precios", que
-- se dispara a mano: aplicar la migración y desplegar seguido deja la ventana en
-- minutos y sin consecuencias.
--
-- ATOMICIDAD: DDL transaccional. Si una guarda falla, revierte todo.
-- ─────────────────────────────────────────────────────────────────────────────


-- 1. El afordance de compatibilidad se retira ---------------------------------
--
-- El trigger de la 0006 asignaba portafolio por moneda cuando venía NULL, para
-- que las rutas sin actualizar siguieran funcionando. Ya no hay rutas sin
-- actualizar: `POST /api/assets` asigna el portafolio en el que estás.
--
-- Se BORRA, y no sólo por limpieza. Mientras exista, un insert sin portafolio se
-- completa solo en vez de fallar — o sea que el `NOT NULL` de abajo nunca podría
-- dispararse. Un default silencioso que anula la garantía que viene después es
-- exactamente el patrón que originó este proyecto.

drop trigger if exists assets_assign_portfolio on assets;
drop function if exists assign_portfolio_by_currency();


-- 2. Todo activo pertenece a un portafolio ------------------------------------

alter table assets alter column portfolio_id set not null;

-- Y la política deja de admitir NULL: ya no es un estado posible.
drop policy "own assets" on assets;

create policy "own assets" on assets for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from portfolios p where p.id = assets.portfolio_id and p.user_id = auth.uid())
  );


-- 3. El bug original, imposible por construcción ------------------------------
--
-- Esta es la razón de ser de todo el Proyecto 3.
--
-- El formulario autocalculaba 19% de IVA sobre la comisión SIEMPRE. Su
-- comprobación de moneda sólo decidía el REDONDEO, no si el impuesto aplicaba —
-- peor que no mirarla, porque parecía que el caso internacional estaba cubierto.
-- Ese IVA entra al cost basis vía `fees`, así que el costo promedio y el P&L de
-- los activos en USD quedaban inflados por un impuesto que no existe en esas
-- operaciones.
--
-- Arreglar el formulario no basta: dejaría el error a un `git revert` de
-- distancia. Con este trigger, una transacción internacional con IVA > 0 no se
-- puede guardar, la escriba quien la escriba — la app, un script, o alguien
-- pegando SQL a mano en este mismo editor.
--
-- Un CHECK no sirve acá: no puede atravesar de `transactions` a `portfolios`
-- pasando por `assets`. De ahí el trigger.
--
-- `security invoker` (el default): lee bajo la RLS del llamante, que sólo ve sus
-- propias filas. No hace falta escalar privilegios.

create function assert_fee_structure() returns trigger
language plpgsql
set search_path = public
as $$
declare
  structure text;
begin
  select p.fee_structure_type into structure
  from assets a
  join portfolios p on p.id = a.portfolio_id
  where a.id = new.asset_id;

  if structure = 'intl_usd' and new.iva > 0 then
    raise exception
      'El IVA no aplica a operaciones internacionales (portafolio intl_usd). '
      'Usa regulatory_fees para CAT, REG y TAF.';
  end if;

  return new;
end $$;

create trigger transactions_assert_fee_structure
  before insert or update on transactions
  for each row execute function assert_fee_structure();


-- 4. Snapshots por portafolio -------------------------------------------------
--
-- Los que la app generó entre la 0006 y esta migración quedaron con
-- `portfolio_id` NULL y siguen siendo consolidados. Van al portafolio local con
-- la misma regla que usó la 0006 para el histórico.
--
-- RECORDATORIO de la consecuencia, ya asumida: esos snapshots incluyen los
-- activos en USD convertidos a pesos. La serie del portafolio local ANTES de
-- esta fecha es la de toda la cartera, no la del portafolio local puro. De acá
-- en adelante cada portafolio construye la suya.

update snapshots s
set portfolio_id = p.id
from portfolios p
where s.portfolio_id is null
  and p.user_id = s.user_id
  and p.fee_structure_type = 'local_clp';

alter table snapshots alter column portfolio_id set not null;

-- La unicidad pasa a ser por portafolio: cada uno guarda su propio valor diario.
alter table snapshots drop constraint snapshots_user_id_snapshot_date_key;
alter table snapshots add constraint snapshots_user_portfolio_date_unique
  unique (user_id, portfolio_id, snapshot_date);


-- 5. Guardas ------------------------------------------------------------------

do $$
declare
  activos_sin_portafolio int;
  snaps_sin_portafolio   int;
  iva_internacional      int;
begin
  select count(*) into activos_sin_portafolio from assets where portfolio_id is null;
  if activos_sin_portafolio > 0 then
    raise exception 'Abortado: % activo(s) sin portafolio.', activos_sin_portafolio;
  end if;

  select count(*) into snaps_sin_portafolio from snapshots where portfolio_id is null;
  if snaps_sin_portafolio > 0 then
    raise exception 'Abortado: % snapshot(s) sin portafolio.', snaps_sin_portafolio;
  end if;

  -- Datos que el trigger nuevo habría rechazado. Si existen, hay que corregirlos
  -- a mano ANTES de dejar la regla en pie: el trigger sólo mira filas nuevas, y
  -- dejar histórico corrupto conviviendo con una regla que lo prohíbe es peor
  -- que no tener la regla.
  select count(*) into iva_internacional
  from transactions t
  join assets a on a.id = t.asset_id
  join portfolios p on p.id = a.portfolio_id
  where p.fee_structure_type = 'intl_usd' and t.iva > 0;

  if iva_internacional > 0 then
    raise exception
      'Abortado: % transaccion(es) internacionales YA tienen IVA > 0. '
      'Son las que este proyecto vino a arreglar. Ponles iva = 0 (moviendo el '
      'monto a commission o regulatory_fees segun el comprobante) y reintenta.',
      iva_internacional;
  end if;
end $$;


-- VERIFICACIÓN ---------------------------------------------------------------
--
-- El trigger debe RECHAZAR esto (usa un asset_id real del portafolio
-- internacional). Correr dentro de begin/rollback:
--
--   begin;
--   insert into transactions (user_id, asset_id, side, quantity, price, commission, iva, executed_at)
--   select a.user_id, a.id, 'buy', 1, 100, 1, 0.19, current_date
--   from assets a join portfolios p on p.id = a.portfolio_id
--   where p.fee_structure_type = 'intl_usd' limit 1;
--   rollback;
--
-- Y debe ACEPTAR la misma con iva = 0 y el monto en regulatory_fees:
--
--   begin;
--   insert into transactions (user_id, asset_id, side, quantity, price, commission, regulatory_fees, iva, executed_at)
--   select a.user_id, a.id, 'buy', 1, 100, 1, 0.19, 0, current_date
--   from assets a join portfolios p on p.id = a.portfolio_id
--   where p.fee_structure_type = 'intl_usd' limit 1;
--   rollback;
--
-- Un activo sin portafolio debe fallar ahora que no hay trigger que lo complete:
--
--   begin;
--   insert into assets (user_id, ticker, asset_type, currency)
--   values ((select id from auth.users limit 1), 'ZZTEST', 'stock', 'USD');
--   rollback;   -- esperado: null value in column "portfolio_id"
