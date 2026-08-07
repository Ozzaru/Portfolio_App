# Portfolio App

App web de portafolio personal: gestión de posiciones, analítica, backtesting de estrategias, simulación de escenarios y alertas.

> **Estado:** MVP completo (6 fases) + **Fase 7 multi-moneda (base CLP)**. Tests, lint y build en verde. Roadmap, specs y planes de implementación en [docs/superpowers/](docs/superpowers/).

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

## Arquitectura — 6 módulos

| Módulo | Responsabilidad |
|--------|-----------------|
| Portfolio Manager | CRUD posiciones · transacciones (comisión + IVA) · snapshots · **multi-moneda base CLP** |
| Market Data Service | Yahoo Finance · CoinGecko · Alpha Vantage · entrada manual |
| Analytics Engine | P&L · retornos · alocación · benchmarks |
| Backtesting Engine | estrategias · históricos · métricas (Sharpe, Drawdown) |
| Scenario Simulator | **stress test** (shock de mercado × beta + overrides) · vs S&P estresado · what-if/rebalanceo = fast-follow |
| Alerts System | **in-app** · precio (above/below) · % cambio del día · auto al refrescar · email/drift = fast-follow |

## Tablas (Supabase / PostgreSQL)

`assets` (ticker, tipo, moneda) · `transactions` (compra/venta, precio, fecha) · `snapshots` (valor diario) · `strategies` (reglas, parámetros) · `alerts` (condición, umbral, estado)

Los datos de mercado se cachean en Supabase para evitar llamadas repetidas a las APIs.

## Multi-moneda (base CLP)

La cartera se consolida en **pesos chilenos**. Cada posición muestra su precio en su moneda nativa
(`ENELCHILE.SN` en CLP, `AAPL` en USD), pero el valor total, la distribución y toda la analítica
operan en CLP.

- **Valor de mercado** al tipo de cambio de hoy; **cost basis al tipo de cambio de la fecha de cada
  compra**, de modo que el P&L incluye el retorno cambiario real.
- El tipo de cambio `USDCLP=X` se cachea en `price_cache` como un ticker más (CLP por 1 USD).
- La conversión ocurre en la **frontera de datos**: los motores de analítica, backtest y escenarios
  reciben una sola moneda y son agnósticos a ella.
- **Calendarios:** el NAV y el Sharpe del portafolio usan la unión de días hábiles con forward-fill;
  la correlación usa intersección estricta, para que un feriado chileno no inyecte retornos 0.

Ver [spec de Fase 7](docs/superpowers/specs/2026-08-06-fase-7-multi-moneda-clp-design.md).

## Páginas

`/dashboard` · `/portfolio` · `/analytics` · `/backtest` · `/scenarios` · `/alerts` · `/data-sources` · `/settings`

- **Dashboard:** KPI cards (Valor Total, P&L Hoy, Retorno Total, # activos) + gráfica de rendimiento + distribución de activos + tabla de posiciones, con selector de período global (1S · 1M · 3M · 1A · Todo).
- **Backtest y Scenarios:** páginas propias (son herramientas de análisis profundo, no widgets).

## Backtesting Engine — estrategias

**MVP implementado (Fase 4):** enfoque **portfolio-céntrico** (estilo PORT/PRTU de Bloomberg) — el caso de uso es gestionar la cartera personal, no hacer trading de activos sueltos. Una sola estrategia:

2. **Rebalanceo Periódico** — sobre la cartera real, pesos objetivo editables (default 1/N), mensual/trimestral. Compara **rebalanceado vs buy & hold vs S&P 500**.

Las demás estrategias del diseño original quedan **fuera del MVP** (son de *trader*, no de gestor de cartera): Momentum/SMA Crossover/RSI/ruptura, Buy & Hold con Stop-Loss/Take-Profit. **DCA** es un fast-follow del mismo motor de cartera. Ver [spec de Fase 4](docs/superpowers/specs/2026-06-17-fase-4-backtesting-rebalanceo-design.md).

**Flujo:** Definir pesos/frecuencia/período → Ejecutar (históricos vía API, auto-backfill) → Ver Resultados.
**Métricas:** Retorno Total · CAGR · Sharpe Ratio · Max Drawdown · vs S&P 500 (exceso geométrico) · Turnover.

## Diseño y documentación

Cada fase siguió un flujo **spec → plan de implementación → TDD**: los specs de diseño viven en
[`docs/superpowers/specs/`](docs/superpowers/specs/) y los planes tarea-por-tarea en
[`docs/superpowers/plans/`](docs/superpowers/plans/). Mockups del brainstorming inicial en
[`docs/design/`](docs/design/) (`architecture.html`, `backtest-design.html`, `ui-review.html`).
