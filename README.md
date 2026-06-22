# Portfolio App

App web de portafolio personal: gestión de posiciones, analítica, backtesting de estrategias, simulación de escenarios y alertas.

> **Estado:** Fase 1 implementada (fundación + Portfolio Manager). Roadmap en [docs/superpowers/plans/ROADMAP.md](docs/superpowers/plans/ROADMAP.md).
> Reubicado desde `OneDrive\Personal\00_Proyectos\03_Bet_Martingala` el 2026-06-11 (OneDrive no es apto para proyectos Node/Next.js).

## Stack

- **UI:** Next.js (App Router)
- **Charts:** Recharts
- **Backend:** Next.js API Routes
- **Datos/Auth:** Supabase (PostgreSQL + Supabase Auth)

## Arquitectura — 6 módulos

| Módulo | Responsabilidad |
|--------|-----------------|
| Portfolio Manager | CRUD posiciones · transacciones · snapshots |
| Market Data Service | Yahoo Finance · CoinGecko · Alpha Vantage · entrada manual |
| Analytics Engine | P&L · retornos · alocación · benchmarks |
| Backtesting Engine | estrategias · históricos · métricas (Sharpe, Drawdown) |
| Scenario Simulator | **stress test** (shock de mercado × beta + overrides) · vs S&P estresado · what-if/rebalanceo = fast-follow |
| Alerts System | precio · % cambio · rebalanceo · email |

## Tablas (Supabase / PostgreSQL)

`assets` (ticker, tipo, moneda) · `transactions` (compra/venta, precio, fecha) · `snapshots` (valor diario) · `strategies` (reglas, parámetros) · `alerts` (condición, umbral, estado)

Los datos de mercado se cachean en Supabase para evitar llamadas repetidas a las APIs.

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

## Diseño

Mockups originales del brainstorming en [`docs/design/`](docs/design/): `architecture.html`, `backtest-design.html`, `ui-review.html`.
