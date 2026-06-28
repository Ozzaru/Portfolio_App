# Fase 1 — Fundación y Portfolio Manager · Diseño

**Fecha (fase):** 2026-06-11 · **Spec retroactivo escrito:** 2026-06-28
**Estado:** implementada y verificada e2e (2026-06-15)
**Depende de:** —
**Roadmap:** Fase 1 de 6. Ver [ROADMAP.md](../plans/ROADMAP.md) · [plan](../plans/2026-06-11-fase-1-fundacion-y-portfolio-manager.md).

> **Nota:** este spec se escribió **a posteriori** para uniformar la documentación. La Fase 1
> fue la fase fundacional, hecha antes de adoptar el flujo spec-por-fase; su diseño original
> vivía en `README.md` y los mockups de [docs/design/](../../design/) (`architecture.html`,
> `ui-review.html`, `backtest-design.html`). Describe lo que **realmente se construyó**.

## 1. Propósito y alcance

Sentar la fundación de la app y entregar un **Portfolio Manager** funcional: autenticación,
el esquema de datos completo, el shell de navegación, CRUD de activos y transacciones, entrada
manual de precios, y un dashboard v1 (KPIs + distribución + posiciones). Es la base sobre la
que se montan las fases 2-6.

### Dentro de la Fase 1
- Scaffolding Next.js (App Router, TypeScript, Tailwind) + Vitest.
- **Esquema Supabase completo** (6 tablas + RLS) desde el inicio, para fijar el contrato de datos.
- Auth email/password (Supabase) + middleware que protege las rutas.
- Shell con tema oscuro, sidebar de 8 módulos y las 8 páginas (3 reales + 5 stub).
- CRUD de **activos** y **transacciones**; **precios manuales**.
- **Dominio puro** (cálculo de posiciones por costo promedio, valoración, totales) testeado con Vitest.
- **Dashboard v1:** KPI cards (Valor Total, P&L Hoy, Retorno Total, # activos), distribución de
  activos (pie) y tabla de posiciones.

### Fuera de la Fase 1 (fases posteriores)
- Datos de mercado automáticos, caché poblada por API, snapshots (Fase 2).
- Gráfica de rendimiento y selector de período global (Fase 3 — requieren históricos/snapshots).
- Backtesting (4), escenarios (5), alertas (6): sus páginas quedan como **stub**.

## 2. Decisiones de diseño

### Decisión 1 — Posiciones derivadas, sin tabla `positions`
Las posiciones **no se almacenan**: se derivan de `transactions` por **método de costo
promedio** (`computeHoldings`). Una sola fuente de verdad (las transacciones) evita
inconsistencias entre transacciones y un estado de posición duplicado.

### Decisión 2 — Esquema completo desde el inicio
Las **6 tablas** (`assets`, `transactions`, `snapshots`, `strategies`, `alerts`, `price_cache`)
y su RLS se crean ya en la Fase 1, aunque `snapshots`/`strategies`/`alerts` no se usen hasta
fases posteriores. Fijar el contrato de datos temprano evita migraciones disruptivas después.
(La única migración posterior fue `0002` en la Fase 3, que añadió `adj_price` a `price_cache`.)

### Decisión 3 — Backend con Route Handlers finos + dominio puro
Los `Route Handlers` (`/api/*`) son capas finas: **auth → validación zod → acceso a datos**.
La lógica de negocio (holdings, valoración, totales) vive en **funciones puras** en
`src/lib/portfolio/`, testeadas con Vitest sin tocar la red ni la DB. Esto mantiene el dominio
verificable y los handlers triviales.

### Decisión 4 — Auth personal: email/password, sin confirmación
Supabase Auth con email/password. **"Confirm email" desactivado** (app personal de un usuario):
con confirmación activa el `signUp` no devolvería sesión y el redirect fallaría. El middleware
refresca la sesión y **redirige a `/login`** cualquier ruta sin sesión.

### Decisión 5 — RLS por usuario; `price_cache` compartida
RLS en todas las tablas: cada usuario solo ve sus filas (`auth.uid() = user_id`). **Excepción:**
`price_cache` es **legible/escribible por cualquier `authenticated`** — los precios de mercado
no son privados y se comparten entre usuarios (la caché es un bien común). Se permite `UPDATE`
retroactivo en `price_cache` (corregir un precio manual histórico es legítimo). Los jobs de
fases posteriores corren bajo la sesión del usuario (rol `authenticated`), cubiertos por estas
políticas — no se depende del bypass de `service_role`.

### Decisión 6 — Dashboard v1 sin gráfica de rendimiento
El dashboard incluye KPIs, distribución y tabla de posiciones, pero **no** la gráfica de
rendimiento ni el selector de período: ambos requieren históricos/snapshots que solo existen
desde la Fase 2/3.

### Decisión 7 — Deuda conocida aceptada: sobreventa
La API **no impide vender más cantidad de la que se posee**; `computeHoldings` **recorta** la
venta al saldo disponible (`Math.min(sellQty, quantity)`). Aceptado en la Fase 1, a endurecer
después.

## 3. Modelo de datos (migración `0001_init.sql`)

Seis tablas en Supabase/PostgreSQL, todas con `user_id` (salvo `price_cache`) y RLS:

- **`assets`** — `ticker`, `name`, `asset_type` ∈ {stock, etf, crypto, cash, other}, `currency`
  (3 letras, mayúsculas); único `(user_id, ticker)`.
- **`transactions`** — `asset_id` (FK), `side` ∈ {buy, sell}, `quantity` (>0), `price` (≥0),
  `fees` (≥0), `executed_at` (date).
- **`snapshots`** — `snapshot_date`, `total_value`; único `(user_id, snapshot_date)`. (Se llena en Fase 2.)
- **`strategies`** — `name`, `strategy_type` ∈ {momentum, rebalance, dca, stop_loss}, `params` jsonb. (Reservada.)
- **`alerts`** — `asset_id` (FK, nullable), `alert_type` ∈ {price_above, price_below, pct_change, rebalance_drift}, `threshold`, `status` ∈ {active, triggered, disabled}, `triggered_at`. (Se usa en Fase 6.)
- **`price_cache`** — `ticker`, `price_date` (date), `price` (>0), `source`; único `(ticker, price_date, source)`. Compartida.

Índices: `transactions(user_id, asset_id)` y `price_cache(ticker, price_date desc)`. RLS: políticas
`own *` por tabla; `price_cache` con `read/write/update` para `authenticated`.

## 4. Arquitectura

### Auth y sesión (`src/lib/supabase/`, `src/middleware.ts`)
- `client.ts` (browser) y `server.ts` (server, cookies async de Next).
- `middleware.ts` (`updateSession`) refresca la sesión y protege rutas; registrado en
  `src/middleware.ts` con un `matcher` que excluye estáticos.
- `login/page.tsx`: email/password (sign in + sign up), redirige a `/dashboard`.

### Dominio puro (`src/lib/portfolio/`, TDD)
- **`holdings.ts`** — `computeHoldings(transactions)`: ordena por fecha, aplica costo promedio
  (compra suma `qty·price + fees`; venta resta `sellQty·avgCost`, recortada al saldo), elimina
  posiciones cerradas.
- **`valuation.ts`** — `valuePositions(holdings, quotes)` (marketValue, P&L no realizado y %;
  `null` si falta precio) y `portfolioTotals(positions)` (valor/coste/P&L/%, contando solo las
  posiciones con precio para el valor).
- **`validation/schemas.ts`** — zod para `asset`, `transaction`, `price` (normaliza ticker a
  mayúsculas, coacciona números de formulario).

### API (`src/app/api/`)
`assets` (GET/POST + `[id]` DELETE), `transactions` (GET con join al ticker + POST que verifica
propiedad del asset + `[id]` DELETE), `prices` (GET caché reciente, POST manual con upsert
`source='manual'`), `positions` (GET: compone dominio puro + datos; calcula **P&L del día** como
`latest − previous` precio del `price_cache`).

### UI / shell (`src/app/(app)/`, `src/components/sidebar.tsx`)
Tema oscuro; `(app)/layout.tsx` con sidebar (8 módulos) + `<main>`. Páginas reales:
`/portfolio` (CRUD assets + transactions), `/data-sources` (precios manuales + caché),
`/dashboard` (KPIs + pie + posiciones). Stub: `/analytics`, `/backtest`, `/scenarios`,
`/alerts`, `/settings`.

> **Nota de evolución:** la Fase 1 se construyó sobre **Next.js 15**. El proyecto migró después
> a **Next 16**, donde `middleware.ts` pasó a la convención `src/proxy.ts` y el dev server debe
> correr con `--webpack` (Turbopack rompe el proxy Node-runtime).

## 5. Testing

Dominio puro con Vitest (TDD): `computeHoldings` (acumulación, venta parcial a costo promedio,
cierre, sobreventa recortada, activos independientes, orden por fecha), `valuePositions` /
`portfolioTotals` (con y sin precio, portafolio vacío), y los esquemas zod. La UI y los route
handlers se validan con `tsc --noEmit` + `npm run build` + verificación e2e en navegador.

**Verificación e2e (2026-06-15):** flujo completo en navegador — crear cuenta → activo AAPL →
compra 10@150 → precio manual 175 → dashboard muestra Valor $1,750, Retorno 16.6%, posición con
P&L correcto.

## 6. Decisiones clave (resumen)
1. Posiciones **derivadas** de `transactions` por costo promedio; sin tabla `positions`.
2. **Esquema completo** (6 tablas + RLS) desde el inicio para fijar el contrato de datos.
3. Route Handlers finos (auth + zod + datos) sobre **dominio puro** testeado con Vitest.
4. Auth email/password con **"Confirm email" desactivado**; middleware redirige a `/login`.
5. RLS por usuario; **`price_cache` compartida** (los precios no son privados).
6. Dashboard v1 **sin** gráfica de rendimiento ni selector de período (diferidos a Fase 2/3).
7. Deuda aceptada: la API no bloquea la sobreventa (se recorta en `computeHoldings`).
