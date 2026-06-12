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
| Scenario Simulator | what-if · estrés · rebalanceo |
| Alerts System | precio · % cambio · rebalanceo · email |

## Tablas (Supabase / PostgreSQL)

`assets` (ticker, tipo, moneda) · `transactions` (compra/venta, precio, fecha) · `snapshots` (valor diario) · `strategies` (reglas, parámetros) · `alerts` (condición, umbral, estado)

Los datos de mercado se cachean en Supabase para evitar llamadas repetidas a las APIs.

## Páginas

`/dashboard` · `/portfolio` · `/analytics` · `/backtest` · `/scenarios` · `/alerts` · `/data-sources` · `/settings`

- **Dashboard:** KPI cards (Valor Total, P&L Hoy, Retorno Total, # activos) + gráfica de rendimiento + distribución de activos + tabla de posiciones, con selector de período global (1S · 1M · 3M · 1A · Todo).
- **Backtest y Scenarios:** páginas propias (son herramientas de análisis profundo, no widgets).

## Backtesting Engine — estrategias

1. **Momentum / Tendencia** — SMA Crossover (50/200), RSI, ruptura de máximos
2. **Rebalanceo Periódico** — mensual/trimestral, por threshold, peso objetivo
3. **Dollar Cost Averaging (DCA)** — inversión fija periódica, vs lump sum
4. **Buy & Hold con Stop-Loss** — stop-loss y take-profit configurables

**Flujo:** Definir Estrategia → Seleccionar Período → Ejecutar (históricos vía API) → Ver Resultados.
**Métricas:** Retorno Total · Sharpe Ratio · Max Drawdown · vs S&P 500.

## Diseño

Mockups originales del brainstorming en [`docs/design/`](docs/design/): `architecture.html`, `backtest-design.html`, `ui-review.html`.
