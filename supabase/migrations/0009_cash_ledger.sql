-- supabase/migrations/0009_cash_ledger.sql
-- Proyecto 3.1, rebanada 1 — contabilidad de caja.
-- Ejecutar COMPLETO en el SQL Editor de Supabase.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ORDEN DE APLICACIÓN: LIBRE. Esta migración es PURAMENTE ADITIVA.
--
-- No toca ninguna tabla, columna, política ni trigger existente, y nada del
-- código desplegado lee las tablas nuevas. A diferencia de la 0006 → 0008 —donde
-- había una ventana con un lado roto se hiciera en el orden que se hiciera— acá
-- no hay ventana que minimizar: se aplica cuando sea, sin desplegar código, y la
-- app sigue funcionando igual sin enterarse.
--
-- Esa propiedad no es suerte, es la consecuencia de haber dejado la caja
-- estructuralmente aislada de los instrumentos en vez de meterla en `assets`.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ
--
-- Hoy una venta reduce la cantidad del activo y ajusta su costo, y el dinero
-- producto de esa venta DESAPARECE del modelo. Las compras se financian contra
-- un fondo infinito imaginario.
--
-- El síntoma está enmascarado en `analytics/engine.ts:44`:
--
--     flows += t.side === 'buy' ? t.quantity * t.price + t.fees : -(t.quantity * t.price)
--
-- Cuenta cada compra como flujo externo POSITIVO. Es coherente consigo mismo y
-- produce un número plausible, y sólo es correcto porque la plata viene de fuera
-- del modelo. Contablemente, comprar un activo es un canje de liquidez por
-- patrimonio: el valor total no cambia en el instante de la orden. Al no existir
-- la caja, cada compra "crea" patrimonio de la nada y el TWR pierde validez.
--
-- Mismo patrón que el IVA autocalculado que originó el Proyecto 3: un cálculo
-- que se ve bien y miente.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LA IDEA CENTRAL: EL LIBRO SE PROYECTA, NO SE SINCRONIZA
--
-- El instinto sería una tabla `cash_ledger` y un trigger sobre `transactions`
-- que inserte la contrapartida de cada trade. Funciona, y crea el problema de
-- siempre: dos representaciones del mismo hecho que hay que mantener
-- sincronizadas en insert, update y delete.
--
-- Pero una compra YA CONTIENE su efecto en caja: −(quantity × price + fees). No
-- hay que almacenarlo, hay que leerlo. Así que las tablas guardan sólo lo que
-- ninguna transacción registra —capital que entra o sale, y conversiones de
-- divisa— y una VISTA une las tres cosas.
--
-- Editar una transacción mueve su pata de caja sola. Borrarla la elimina sola.
-- No pueden divergir porque la pata no existe por separado.
--
-- ATOMICIDAD: DDL transaccional. Si una guarda falla, revierte todo.
-- ─────────────────────────────────────────────────────────────────────────────


-- 1. Capital externo ----------------------------------------------------------
--
-- Lo único que se escribe a mano: abonos y retiros. Todo lo demás se deriva.
--
-- `currency` es libre y NO se ata a `portfolios.base_currency`. Un bróker
-- chileno que guarde dólares no es imposible; es el mismo criterio con que la
-- 0006 separó `base_currency` de `fee_structure_type` en vez de derivar una de
-- la otra. En la práctica habrá una moneda por portafolio.
--
-- NO existe un tipo `opening_balance`: el histórico se reconstruye completo
-- desde junio con los abonos reales. Un saldo de apertura calculado hacia atrás
-- para que el presente cuadre sería un número sintético que miente sobre el
-- pasado — el mismo default silencioso que la 0008 vino a borrar.

create table cash_movements (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  portfolio_id  uuid not null references portfolios(id) on delete cascade,
  currency      text not null check (currency = upper(currency) and length(currency) = 3),
  movement_type text not null check (movement_type in ('deposit', 'withdrawal')),
  amount        numeric not null,
  occurred_at   date not null,
  note          text not null default '',
  created_at    timestamptz not null default now(),

  -- El signo lo fija el tipo. Sin esto, un 'withdrawal' con monto positivo
  -- SUMARÍA plata al saldo — un retiro que deposita, y el libro cuadraría con
  -- un total que nadie tiene. Nótese que este CHECK también excluye el cero:
  -- un movimiento de monto cero es una fila que no significa nada.
  constraint cash_movements_signo check (
    (movement_type = 'deposit'    and amount > 0) or
    (movement_type = 'withdrawal' and amount < 0)
  )
);

create index idx_cash_movements_portfolio on cash_movements(portfolio_id, occurred_at);

alter table cash_movements enable row level security;

-- Mismo patrón que la política de `assets` tras la 0008: además de que la fila
-- sea tuya, el portafolio al que apunta tiene que serlo.
create policy "own cash movements" on cash_movements for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from portfolios p where p.id = cash_movements.portfolio_id and p.user_id = auth.uid())
  );


-- 2. Conversión de divisa -----------------------------------------------------
--
-- POR QUÉ UNA TABLA PROPIA Y NO DOS FILAS DE `cash_movements` ENLAZADAS
--
-- Un `linked_transfer_id` entre dos filas falla en cuatro puntos:
--
--   · Huevo y gallina al insertar. A referencia a B y B a A: no se puede
--     insertar ninguna primero sin dejar la FK nullable y hacer un UPDATE
--     después. Entre las dos sentencias hay una pata huérfana.
--   · Nada obliga a la simetría. A puede apuntar a B mientras B apunta a C.
--     Detectarlo exige leer otra fila — o sea un CHECK que no puede serlo, y
--     vuelve el trigger que este diseño evita.
--   · Nada obliga a que los montos se correspondan.
--   · Una tasa almacenada puede contradecir a los montos.
--
-- Una conversión NO son dos movimientos que se referencian: es UN HECHO CON DOS
-- EFECTOS. Como entidad propia, la pata huérfana deja de ser improbable por
-- vigilancia y pasa a ser imposible por construcción — no hay ninguna fila que
-- borrar por separado.
--
-- NO HAY COLUMNA DE TASA. `from_amount / to_amount` la da exacta, y una tercera
-- columna sería un número capaz de contradecir a los otros dos. Mismo motivo por
-- el que `fees` es columna generada desde la 0003. El spread del bróker (8 pesos
-- por dólar en horario de mercado, 10 fuera) tampoco va acá: es su tarifa en un
-- momento dado, y la 0006 ya fijó que el esquema no versiona la tabla de tarifas
-- de nadie. Se calcula en `fx_transfers_audit`.

create table fx_transfers (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,

  from_portfolio_id uuid not null references portfolios(id) on delete cascade,
  from_currency     text not null check (from_currency = upper(from_currency) and length(from_currency) = 3),
  from_amount       numeric not null check (from_amount > 0),

  to_portfolio_id   uuid not null references portfolios(id) on delete cascade,
  to_currency       text not null check (to_currency = upper(to_currency) and length(to_currency) = 3),
  to_amount         numeric not null check (to_amount > 0),

  occurred_at       date not null,
  note              text not null default '',
  created_at        timestamptz not null default now(),

  -- Ambos montos POSITIVOS: el signo lo pone la dirección al proyectarse en el
  -- libro. Guardar uno negativo sería codificar la dirección dos veces.

  -- Mover plata de una cuenta a sí misma no es un traspaso: es ruido que
  -- aparecería como actividad en el libro sin cambiar ningún saldo.
  constraint fx_transfers_no_es_no_op check (
    from_portfolio_id <> to_portfolio_id or from_currency <> to_currency
  )
);

create index idx_fx_transfers_from on fx_transfers(from_portfolio_id, occurred_at);
create index idx_fx_transfers_to   on fx_transfers(to_portfolio_id, occurred_at);

alter table fx_transfers enable row level security;

-- El `exists` va DUPLICADO a propósito: son dos portafolios distintos y ambos
-- tienen que ser tuyos. Sin la segunda comprobación se podría empujar plata
-- hacia el portafolio de otro usuario.
create policy "own fx transfers" on fx_transfers for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from portfolios p where p.id = fx_transfers.from_portfolio_id and p.user_id = auth.uid())
    and exists (select 1 from portfolios p where p.id = fx_transfers.to_portfolio_id   and p.user_id = auth.uid())
  );


-- 3. El libro -----------------------------------------------------------------
--
-- ⚠ `security_invoker = true` NO ES OPCIONAL.
--
-- En PostgreSQL una vista corre con los permisos de su DUEÑO y saltea el RLS de
-- las tablas de abajo. Sin esta opción, `cash_ledger` le devolvería a cualquier
-- usuario autenticado el libro de TODOS los usuarios. Y no fallaría: la vista
-- funcionaría perfecto, sólo que devolviendo de más. Es un fallo silencioso
-- hacia el lado inseguro, y no es descubrible mirando el resultado de una
-- consulta propia. La guarda de la sección 6 aborta si falta.
--
-- Requiere PG15+; Supabase lo cumple.
--
-- NO SE EXPONE UNA COLUMNA `id`: un `fx_transfer` emite DOS filas y ambas
-- tendrían la misma. PostgREST publicaría una columna que parece clave y no lo
-- es. La identidad de una fila del libro es (source, source_id, movement_type).

create view cash_ledger with (security_invoker = true) as
  -- 3.1 Capital externo, tal como se escribió.
  select
    m.user_id,
    m.portfolio_id,
    m.currency,
    m.movement_type,
    m.amount,
    m.occurred_at,
    'movement'::text as source,
    m.id             as source_id
  from cash_movements m

union all

  -- 3.2 La pata de caja del trade, PROYECTADA desde la transacción.
  --
  -- `transactions` no tiene `portfolio_id` a propósito (0006: duplicar la
  -- referencia permitiría que divergiera). Se llega por el activo, igual que
  -- hacen /api/positions y los snapshots.
  --
  -- Las fees SIEMPRE reducen la caja: se suman al costo en la compra y se
  -- restan del ingreso en la venta. Eso corrige de paso la asimetría de
  -- engine.ts:47, donde la compra suma `fees` y la venta no los resta.
  select
    t.user_id,
    a.portfolio_id,
    a.currency,
    (case t.side when 'buy' then 'trade_buy' else 'trade_sell' end)::text,
    (case t.side
       when 'buy' then -(t.quantity * t.price + t.fees)
       else             (t.quantity * t.price - t.fees)
     end)::numeric,
    t.executed_at,
    'transaction'::text,
    t.id
  from transactions t
  join assets a on a.id = t.asset_id

union all

  -- 3.3 y 3.4 Las dos patas del cambio, de la MISMA fila.
  --
  -- Acá está el pago del diseño: no hay forma de que exista una sin la otra, ni
  -- de que tengan montos o fechas desalineados, ni de borrar sólo una. Y nadie
  -- puede escribir un 'fx_out' a mano: no es un valor admitido en ninguna tabla.
  select
    f.user_id,
    f.from_portfolio_id,
    f.from_currency,
    'fx_out'::text,
    (-f.from_amount)::numeric,
    f.occurred_at,
    'fx_transfer'::text,
    f.id
  from fx_transfers f

union all

  select
    f.user_id,
    f.to_portfolio_id,
    f.to_currency,
    'fx_in'::text,
    f.to_amount::numeric,
    f.occurred_at,
    'fx_transfer'::text,
    f.id
  from fx_transfers f;


-- 4. Saldos -------------------------------------------------------------------
--
-- VISTA, NO TABLA. Un saldo materializado es una caché del libro, y una caché
-- que puede desviarse de su fuente es el error de este proyecto a menor escala.
-- Con cientos de filas `sum()` es gratis; si algún día no lo es, la respuesta es
-- un índice, y sólo después una tabla — nunca al revés.
--
-- OJO al consumirla: un portafolio SIN movimientos no aparece acá (no hay filas
-- que agrupar). "Sin fila" significa saldo cero, y el código que la lea tiene
-- que tratarlo así en vez de asumir que siempre hay una fila por portafolio.

create view cash_balances with (security_invoker = true) as
  select
    user_id,
    portfolio_id,
    currency,
    sum(amount)      as balance,
    max(occurred_at) as last_movement_at
  from cash_ledger
  group by user_id, portfolio_id, currency;


-- 5. Auditoría del spread cambiario -------------------------------------------
--
-- El costo de convertir es real y hoy no se registra en ninguna parte. Esta
-- vista lo calcula contra el FX de mercado que ya vive en `price_cache`.
--
-- La tasa se normaliza a CLP POR USD en ambas direcciones, para que dos
-- conversiones opuestas sean comparables. Un par que no sea CLP/USD devuelve
-- NULL en vez de un número inventado.
--
-- `costo_spread_clp` es POSITIVO cuando el bróker te cobró, en las dos
-- direcciones: comprando dólares pagas por encima del mercado, vendiéndolos
-- recibes por debajo. Una resta cruda de tasas tendría el signo invertido en un
-- caso y el número no significaría lo mismo según la dirección.

create view fx_transfers_audit with (security_invoker = true) as
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
    end as costo_spread_clp

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


-- 6. Guardas ------------------------------------------------------------------
--
-- Las tablas nacen vacías, así que no hay datos que validar. Lo que sí hay que
-- validar es la CONFIGURACIÓN DE SEGURIDAD, porque su fallo es silencioso: una
-- vista sin `security_invoker` funciona igual, sólo que filtrando datos entre
-- usuarios, y una tabla sin RLS acepta lecturas ajenas sin quejarse. Ninguna de
-- las dos cosas se nota mirando el resultado de una consulta propia.

do $$
declare
  vistas            int;
  vistas_inseguras  int;
  tablas_sin_rls    int;
begin
  -- Las tres vistas existen.
  select count(*) into vistas
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'v'
    and c.relname in ('cash_ledger', 'cash_balances', 'fx_transfers_audit');

  if vistas <> 3 then
    raise exception 'Abortado: se esperaban 3 vistas y hay %.', vistas;
  end if;

  -- Y las tres corren bajo el RLS del llamante.
  --
  -- Se extrae la opción y se compara contra los tres literales que Postgres
  -- acepta como verdadero, en vez de buscar 'security_invoker=true' como
  -- substring: `with (security_invoker = on)` es igual de válido y se guarda
  -- literal, así que un LIKE lo daría por inseguro y abortaría una migración
  -- correcta.
  select count(*) into vistas_inseguras
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'v'
    and c.relname in ('cash_ledger', 'cash_balances', 'fx_transfers_audit')
    and coalesce(
          (select o from unnest(coalesce(c.reloptions, '{}')) o where o like 'security_invoker=%'),
          ''
        ) not in ('security_invoker=true', 'security_invoker=on', 'security_invoker=1');

  if vistas_inseguras > 0 then
    raise exception
      'Abortado: % vista(s) sin security_invoker=true. Correrían con los '
      'permisos del dueño y saltearían el RLS, exponiendo el libro de TODOS '
      'los usuarios a cualquier usuario autenticado.', vistas_inseguras;
  end if;

  -- RLS activo en las dos tablas nuevas.
  select count(*) into tablas_sin_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('cash_movements', 'fx_transfers')
    and c.relrowsecurity = false;

  if tablas_sin_rls > 0 then
    raise exception 'Abortado: % tabla(s) nueva(s) sin RLS habilitado.', tablas_sin_rls;
  end if;
end $$;


-- VERIFICACIÓN ---------------------------------------------------------------
--
-- Correr DESPUÉS de aplicar. Todo va dentro de begin/rollback: nada de esto
-- debe quedar guardado.
--
-- ── A. Un traspaso emite DOS patas, y borrarlo se lleva las dos ──────────────
--
--   begin;
--   insert into fx_transfers
--     (user_id, from_portfolio_id, from_currency, from_amount,
--                 to_portfolio_id,   to_currency,   to_amount, occurred_at)
--   select u.id, loc.id, 'CLP', 950000, intl.id, 'USD', 1000, current_date
--   from auth.users u
--   join portfolios loc  on loc.user_id  = u.id and loc.fee_structure_type  = 'local_clp'
--   join portfolios intl on intl.user_id = u.id and intl.fee_structure_type = 'intl_usd'
--   limit 1;
--
--   -- Esperado: 2 filas, fx_out −950000 CLP y fx_in +1000 USD, misma fecha.
--   select movement_type, currency, amount, occurred_at
--   from cash_ledger where source = 'fx_transfer' order by movement_type;
--
--   -- Esperado: 950 (pesos por dólar) y el costo del spread contra el mercado.
--   select clp_por_usd, clp_por_usd_mercado, costo_spread_clp from fx_transfers_audit;
--
--   delete from fx_transfers;
--   -- Esperado: 0 filas. No hay pata que sobreviva sola.
--   select count(*) from cash_ledger where source = 'fx_transfer';
--   rollback;
--
-- ── B. Los CHECK muerden. Cada uno debe FALLAR ──────────────────────────────
--
--   -- Un retiro con monto positivo (sumaría plata en vez de restarla):
--   begin;
--   insert into cash_movements (user_id, portfolio_id, currency, movement_type, amount, occurred_at)
--   select p.user_id, p.id, 'CLP', 'withdrawal', 50000, current_date from portfolios p limit 1;
--   rollback;   -- esperado: viola cash_movements_signo
--
--   -- Un traspaso de un portafolio a sí mismo en la misma moneda:
--   begin;
--   insert into fx_transfers
--     (user_id, from_portfolio_id, from_currency, from_amount,
--                 to_portfolio_id,   to_currency,   to_amount, occurred_at)
--   select p.user_id, p.id, 'CLP', 1000, p.id, 'CLP', 1000, current_date from portfolios p limit 1;
--   rollback;   -- esperado: viola fx_transfers_no_es_no_op
--
-- ── C. La pata de caja del trade sigue a su transacción ─────────────────────
--
--   -- Esperado: una fila por transacción, con signo negativo en las compras.
--   select movement_type, currency, round(amount, 2), occurred_at
--   from cash_ledger where source = 'transaction'
--   order by occurred_at desc limit 5;
--
--   -- Editar la transacción mueve su pata sola, sin tocar nada más:
--   begin;
--   update transactions set quantity = quantity * 2
--   where id = (select id from transactions order by executed_at desc limit 1);
--   select amount from cash_ledger
--   where source_id = (select id from transactions order by executed_at desc limit 1);
--   rollback;
--
-- ── D. El aislamiento entre usuarios (verifica security_invoker) ────────────
--
-- Esto NO se puede comprobar desde el SQL Editor, que corre como `postgres` y
-- ve todo. Hay que hacerlo desde la app, autenticado, o simulando el rol:
--
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<UUID-DE-OTRO-USUARIO>"}';
--   -- Esperado: 0 filas. Si devuelve el libro completo, falta security_invoker.
--   select count(*) from cash_ledger;
--   rollback;
--
-- ── E. Saldos ───────────────────────────────────────────────────────────────
--
-- Con el libro todavía sin abonos cargados, los saldos van a salir NEGATIVOS:
-- las compras ya están registradas y el capital que las financió no. Es lo
-- esperado, y es exactamente lo que la rebanada 3 va a corregir digitando las
-- cartolas. El saldo negativo NO está prohibido a propósito: es información
-- ("falta registrar un abono"), no corrupción.
--
--   select p.slug, b.currency, b.balance, b.last_movement_at
--   from cash_balances b join portfolios p on p.id = b.portfolio_id
--   order by p.slug, b.currency;
