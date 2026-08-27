-- supabase/migrations/0007_portfolio_slug.sql
-- Proyecto 3, rebanada 1 — identificador de portafolio para la URL.
-- Ejecutar COMPLETO en el SQL Editor de Supabase.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ UNA COLUMNA PROPIA Y NO ALGO DERIVADO
--
-- Las vistas de portafolio pasan a ser segmentos de ruta (`/nacional/dashboard`)
-- en vez de un query param. La razón: los enlaces del sidebar son rutas
-- absolutas y descartarían un `?portfolio=` en silencio, aterrizando al usuario
-- en el otro portafolio sin avisar. Un segmento no se puede "olvidar".
--
-- Ese segmento necesita un identificador, y ninguna columna existente sirve:
--
--   · `id` (uuid)          → `/8f3a.../dashboard`: ilegible y filtra IDs al historial.
--   · `fee_structure_type` → acopla la URL a la estructura de fees, justo lo que
--                            la 0006 desacopló a propósito de `base_currency`.
--                            Dos portafolios con la misma estructura colisionan.
--   · `name`               → es editable. Renombrar rompería URLs guardadas.
--
-- De ahí una columna propia: estable frente a renombres, legible, y sin
-- significado de negocio que la ate a otra decisión.
--
-- ATOMICIDAD: DDL transaccional. Si una guarda falla, revierte todo. Esta
-- migración NO es re-ejecutable: un segundo intento falla en el `add column` y
-- revierte sin dejar estado parcial, que es el comportamiento deseado.
-- ─────────────────────────────────────────────────────────────────────────────


-- 1. La columna, primero nullable para poder rellenarla -----------------------

alter table portfolios add column slug text;


-- 2. Backfill determinista ---------------------------------------------------
--
-- Por `fee_structure_type` y no por `name`: es el mismo criterio con el que la
-- 0006 sembró las filas, así que el resultado no depende de que los nombres
-- sigan intactos.

update portfolios set slug = 'nacional'      where fee_structure_type = 'local_clp';
update portfolios set slug = 'internacional' where fee_structure_type = 'intl_usd';


-- 3. Restricciones -----------------------------------------------------------
--
-- FORMATO: minúsculas, dígitos y guiones; sin guión al inicio ni al final. Es
-- lo que sobrevive intacto a una URL sin escapes ni ambigüedad de mayúsculas.
--
-- RESERVADOS: acá está la trampa. En Next.js un segmento estático le gana a uno
-- dinámico, así que un portafolio con slug `settings` quedaría INALCANZABLE —
-- `/settings` seguiría resolviendo a la página global y su dashboard nunca
-- cargaría. No daría error: simplemente no funcionaría, que es peor.
--
-- La lista son las rutas que permanecen en el nivel superior tras mover
-- `/dashboard`, `/analytics` y `/portfolio` bajo `[portfolio]/`, más las
-- internas de Next. Si en el futuro se agrega otra ruta global, va acá también.

alter table portfolios
  add constraint portfolios_slug_format
  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

alter table portfolios
  add constraint portfolios_slug_not_reserved
  check (slug not in ('api', 'login', 'alerts', 'data-sources', 'settings', '_next'));

alter table portfolios alter column slug set not null;

-- Único por usuario, no global: dos usuarios distintos pueden tener cada uno su
-- `nacional`. Crea el índice que usarán las búsquedas por (user_id, slug).
alter table portfolios add constraint portfolios_user_slug_unique unique (user_id, slug);


-- 4. Guardas -----------------------------------------------------------------

do $$
declare
  sin_slug     int;
  fuera_de_par int;
begin
  -- Redundante con el NOT NULL de arriba, pero deja el mensaje claro si el
  -- backfill no cubrió alguna fila con un `fee_structure_type` inesperado.
  select count(*) into sin_slug from portfolios where slug is null or slug = '';
  if sin_slug > 0 then
    raise exception
      'Abortado: % portafolio(s) sin slug. Revisa si alguno tiene un '
      'fee_structure_type fuera de (local_clp, intl_usd).', sin_slug;
  end if;

  -- Cada portafolio debe haber quedado con el slug que le corresponde a su
  -- estructura. Detecta un backfill parcial o cruzado.
  select count(*) into fuera_de_par
  from portfolios
  where (fee_structure_type = 'local_clp' and slug <> 'nacional')
     or (fee_structure_type = 'intl_usd'  and slug <> 'internacional');
  if fuera_de_par > 0 then
    raise exception 'Abortado: % portafolio(s) con slug que no corresponde a su estructura.', fuera_de_par;
  end if;
end $$;


-- VERIFICACIÓN ---------------------------------------------------------------
--
-- Debe devolver exactamente dos filas por usuario, con los slugs que van a
-- aparecer en la URL:
--
--   select slug, name, base_currency, fee_structure_type
--   from portfolios order by slug;
--
-- Y estas dos deben FALLAR, confirmando que las restricciones muerden. Correr
-- cada una dentro de su propio begin/rollback:
--
--   begin;
--   update portfolios set slug = 'settings' where slug = 'nacional';   -- reservado
--   rollback;
--
--   begin;
--   update portfolios set slug = 'Nacional' where slug = 'nacional';   -- mayúsculas
--   rollback;
--
-- NOTA: cambiar un slug más adelante rompe cualquier URL guardada que lo use.
-- No se impide —puede ser legítimo—, pero conviene saberlo antes de hacerlo.
