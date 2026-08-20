# Portfolio App — Roadmap de implementación

Diseño completo en [README.md](../../../README.md) y [docs/design/](../../design/).
Cada fase produce software funcional y testeable por sí misma. Una fase = un plan de implementación en este directorio.

| Fase | Plan | Alcance | Estado |
|------|------|---------|--------|
| 1 | [2026-06-11-fase-1-fundacion-y-portfolio-manager.md](2026-06-11-fase-1-fundacion-y-portfolio-manager.md) ([spec](../specs/2026-06-11-fase-1-fundacion-y-portfolio-manager-design.md)) | Scaffolding Next.js · esquema Supabase completo · auth · shell con sidebar · Portfolio Manager (CRUD assets/transactions) · precios manuales · Dashboard v1 (KPIs + distribución + posiciones) | **Implementada** |
| 2 | [2026-06-15-fase-2-market-data-service.md](2026-06-15-fase-2-market-data-service.md) ([spec](../specs/2026-06-15-fase-2-market-data-service-design.md)) | Market Data Service: adaptadores Yahoo Finance / CoinGecko / Alpha Vantage, caché en `price_cache`, página `/data-sources` con estado OK/ERROR por fuente, snapshots (on-demand, cron-ready) | **Implementada** |
| 3 | [2026-06-16-fase-3-analytics-engine.md](2026-06-16-fase-3-analytics-engine.md) ([spec](../specs/2026-06-16-fase-3-analytics-engine-design.md)) | Analytics Engine: retornos (TWR), benchmarks, correlaciones, página `/analytics`, gráfica de rendimiento en dashboard + selector de período global (1S · 1M · 3M · 1A · Todo) | **Implementada** |
| 4 | [2026-06-17-fase-4-backtesting-rebalanceo.md](2026-06-17-fase-4-backtesting-rebalanceo.md) ([spec](../specs/2026-06-17-fase-4-backtesting-rebalanceo-design.md)) | Backtesting Engine (MVP portfolio-céntrico, estilo PORT/PRTU): **Rebalanceo periódico sobre la cartera real** (rebalanceado vs buy&hold vs S&P 500), métricas (Retorno Total, CAGR, Sharpe, Max Drawdown, exceso geométrico) + turnover + gráfica, página `/backtest`. Motor señal-por-activo (Momentum/SMA/RSI/SL-TP) y DCA **descartados/diferidos** (ver spec). | **Eliminada (2026-08-19)** |
| 5 | [2026-06-22-fase-5-scenario-simulator.md](2026-06-22-fase-5-scenario-simulator.md) ([spec](../specs/2026-06-22-fase-5-scenario-simulator-design.md)) | Scenario Simulator (MVP **stress test**): shock de mercado (S&P 500) propagado por **beta** + overrides por activo (fallback por `asset_type`), impacto total, ranking de peores, **vs S&P estresado**, gráfica de barras, página `/scenarios`. What-if / rebalanceo simulado / replay histórico **diferidos** (ver spec). | **Eliminada (2026-08-19)** |
| 6 | [2026-06-24-fase-6-alerts-system.md](2026-06-24-fase-6-alerts-system.md) ([spec](../specs/2026-06-24-fase-6-alerts-system-design.md)) | Alerts System (MVP): alertas **in-app** de precio (`price_above`, `price_below`, `pct_change`), evaluación que lee solo `price_cache` (cero API externa), auto al refrescar precios (cron-ready) + botón, CRUD en `/alerts` + badge en el shell. `rebalance_drift`, email y `/settings` **diferidos** (ver spec). | **Implementada (MVP)** |
| 7 | [2026-08-06-fase-7-multi-moneda-clp.md](2026-08-06-fase-7-multi-moneda-clp.md) ([spec](../specs/2026-08-06-fase-7-multi-moneda-clp-design.md)) | Soporte **multi-moneda con base CLP** (acciones chilenas vía Zesty): `USDCLP=X` cacheado en `price_cache`, módulo `src/lib/fx/` que normaliza en la **frontera de datos** (motores sin cambios), **cost basis al FX de la fecha de compra**, comisión + IVA desglosados, benchmark y backtest en CLP, migración del histórico de snapshots. **Volatilidad individual por activo** diferida (ver spec). | **Implementada** |

**Dependencias:** 2 depende de 1 · 3 depende de 2 (necesita históricos y snapshots) · 4 depende de 2 · 5 depende de 3 · 6 depende de 2 · 7 depende de 1, 2 y 3.

**Decisión de alcance Fase 1:** el dashboard de la Fase 1 incluye KPI cards, distribución de activos y tabla de posiciones, pero **no** la gráfica de rendimiento ni el selector de período — ambos requieren snapshots históricos que solo existen a partir de la Fase 2/3. El esquema SQL completo (incluidas `strategies` y `alerts`) se crea desde la Fase 1 para fijar el contrato de datos.

## Ciclo post-MVP (2026-08)

Cada proyecto lleva su propio spec y plan, igual que las fases.

| # | Proyecto | Alcance | Estado |
|------|----------|---------|--------|
| 1 | [Limpieza](2026-08-19-limpieza-backtest-escenarios.md) ([spec](../specs/2026-08-19-limpieza-backtest-escenarios-design.md)) | Eliminar Backtest y Escenarios; rescatar el simulador de carteras y el cálculo de beta hacia `analytics/` | **Implementada** |
| 2 | Performance | Filtrar `price_cache` por ticker en `/api/positions`, Server Components, caché entre navegaciones | **Pendiente** |
| 3 | Portafolios CLP / USD | Separar la medición por moneda en vez de consolidar todo en CLP | **Pendiente** |
| 4 | Dashboard: multi-benchmark | Selector de benchmark en el dashboard, comparación simultánea (S&P 500, Nasdaq 100, buy & hold, equiponderado), fechas en dd/mm/aaaa | **Pendiente** |
| 5 | Deploy web + responsive | Publicar la app con acceso desde celular y PC; layout adaptable | **Pendiente** |
| 6 | Configuración + alertas automáticas | Poblar `/settings`; evaluación de alertas por cron sin intervención manual | **Pendiente** |

**Dependencias:** 4 depende de 1 (usa `analytics/synthetic/` y `analytics/beta.ts`) y de 3 (el benchmark se elige por portafolio) · 6 depende de 5 (el cron necesita un endpoint público al que pegarle).
