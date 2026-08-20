# Portfolio App

App web de portafolio personal: gestión de posiciones, analítica de cartera, benchmarks y alertas.

> **Estado:** MVP completo (6 fases) + **Fase 7 multi-moneda (base CLP)**. Backtest y Escenarios **eliminados** el 2026-08-19 (ver [spec de limpieza](docs/superpowers/specs/2026-08-19-limpieza-backtest-escenarios-design.md)). Tests, lint y build en verde. Roadmap, specs y planes de implementación en [docs/superpowers/](docs/superpowers/).

## Stack

- **UI:** Next.js (App Router)
- **Charts:** Recharts
- **Backend:** Next.js API Routes
- **Datos/Auth:** Supabase (PostgreSQL + Supabase Auth)
- **Tests:** Vitest (dominio puro) · **Validación:** Zod

## Cómo correr

**Requisitos:** Node.js ≥ 18.18 y una cuenta gratuita en [Supabase](https://supabase.com).

1. **Clonar e instalar:**
   ```bash
   git clone https://github.com/Ozzaru/Portfolio_App.git
   cd Portfolio_App
   npm install
   ```

2. **Crear el proyecto en Supabase** y aplicar el esquema:
   - En el [dashboard de Supabase](https://supabase.com/dashboard), crea un proyecto (plan gratuito).
   - En **SQL Editor**, ejecuta en orden el contenido de [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql), [`0002_price_cache_adj_close.sql`](supabase/migrations/0002_price_cache_adj_close.sql) y [`0003_multi_currency.sql`](supabase/migrations/0003_multi_currency.sql). La migración 0003 exige que `USDCLP=X` ya esté en `price_cache`: corre el **Backfill** en `/data-sources` antes (aborta sola si falta).
   - En **Authentication → Email**, desactiva *"Confirm email"* (app personal de un solo usuario).

3. **Configurar el entorno:**
   ```bash
   cp .env.example .env.local
   ```
   Rellena `.env.local` con la URL y la *anon key* de tu proyecto (Supabase → **Settings → API**).

4. **Arrancar el servidor de desarrollo:**
   ```bash
   npm run dev
   ```
   Abre [http://localhost:3000](http://localhost:3000). El script usa `--webpack` a propósito (Turbopack rompe el proxy de Next 16 en este proyecto).

**Otros scripts:** `npm test` (Vitest) · `npm run lint` (ESLint) · `npm run build` (build de producción).

## Arquitectura — 4 módulos

| Módulo | Responsabilidad |
|--------|-----------------|
| Portfolio Manager | CRUD posiciones · transacciones (comisión + IVA) · snapshots · **multi-moneda base CLP** |
| Market Data Service | Yahoo Finance · CoinGecko · Alpha Vantage · entrada manual |
| Analytics Engine | P&L · retornos · alocación · benchmarks |
| Alerts System | **in-app** · precio (above/below) · % cambio del día · auto al refrescar · email/drift = fast-follow |

## Tablas (Supabase / PostgreSQL)

`assets` (ticker, tipo, moneda) · `transactions` (compra/venta, precio, fecha) · `snapshots` (valor diario) · `alerts` (condición, umbral, estado)

La tabla `strategies` existe en el esquema pero **ningún código la usa** desde la limpieza del 2026-08-19. Se dejó a propósito: dropear una tabla es lo único que git no puede deshacer (Decisión 5 del spec de limpieza).

Los datos de mercado se cachean en Supabase para evitar llamadas repetidas a las APIs.

## Multi-moneda (base CLP)

La cartera se consolida en **pesos chilenos**. Cada posición muestra su precio en su moneda nativa
(`ENELCHILE.SN` en CLP, `AAPL` en USD), pero el valor total, la distribución y toda la analítica
operan en CLP.

- **Valor de mercado** al tipo de cambio de hoy; **cost basis al tipo de cambio de la fecha de cada
  compra**, de modo que el P&L incluye el retorno cambiario real.
- El tipo de cambio `USDCLP=X` se cachea en `price_cache` como un ticker más (CLP por 1 USD).
- La conversión ocurre en la **frontera de datos**: el motor de analítica recibe una sola
  moneda y es agnóstico a ella.
- **Calendarios:** el NAV y el Sharpe del portafolio usan la unión de días hábiles con forward-fill;
  la correlación usa intersección estricta, para que un feriado chileno no inyecte retornos 0.

Ver [spec de Fase 7](docs/superpowers/specs/2026-08-06-fase-7-multi-moneda-clp-design.md).

## Páginas

`/dashboard` · `/portfolio` · `/analytics` · `/alerts` · `/data-sources` · `/settings`

- **Dashboard:** KPI cards (Valor Total, P&L Hoy, Retorno Total, # activos) + gráfica de rendimiento + distribución de activos + tabla de posiciones, con selector de período global (1S · 1M · 3M · 1A · Todo).

## Código rescatado, todavía sin consumidor

Dos piezas sobreviven a la limpieza porque el dashboard las va a necesitar. Ninguna se
muestra en pantalla todavía: están exportadas, testeadas y esperando.

- **`src/lib/analytics/synthetic/`** — simula carteras hipotéticas sobre los mismos activos
  (pesos fijos, con o sin rebalanceo periódico). Es el motor del benchmark **equiponderado**
  con el que se va a comparar la cartera real. Viene de la Fase 4, cuya página de backtest
  se eliminó.
- **`src/lib/analytics/beta.ts`** — beta histórica contra un benchmark: cuánto amplifica la
  cartera los movimientos del índice. Devuelve `null` en vez de inventar un valor cuando no
  hay observaciones suficientes. Viene de la Fase 5, cuyo stress test se eliminó.

## Diseño y documentación

Cada fase siguió un flujo **spec → plan de implementación → TDD**: los specs de diseño viven en
[`docs/superpowers/specs/`](docs/superpowers/specs/) y los planes tarea-por-tarea en
[`docs/superpowers/plans/`](docs/superpowers/plans/). Mockups del brainstorming inicial en
[`docs/design/`](docs/design/) (`architecture.html`, `backtest-design.html` —histórico, la
funcionalidad se eliminó—, `ui-review.html`).
