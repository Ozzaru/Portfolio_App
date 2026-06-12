# Portfolio App — Roadmap de implementación

Diseño completo en [README.md](../../../README.md) y [docs/design/](../../design/).
Cada fase produce software funcional y testeable por sí misma. Una fase = un plan de implementación en este directorio.

| Fase | Plan | Alcance | Estado |
|------|------|---------|--------|
| 1 | [2026-06-11-fase-1-fundacion-y-portfolio-manager.md](2026-06-11-fase-1-fundacion-y-portfolio-manager.md) | Scaffolding Next.js · esquema Supabase completo · auth · shell con sidebar · Portfolio Manager (CRUD assets/transactions) · precios manuales · Dashboard v1 (KPIs + distribución + posiciones) | **Planificada** |
| 2 | _(pendiente)_ | Market Data Service: adaptadores Yahoo Finance / CoinGecko / Alpha Vantage, caché en `price_cache`, página `/data-sources` con estado OK/ERROR por fuente, snapshots diarios | Pendiente |
| 3 | _(pendiente)_ | Analytics Engine: retornos, benchmarks, correlaciones, página `/analytics`, gráfica de rendimiento en dashboard + selector de período global (1S · 1M · 3M · 1A · Todo) | Pendiente |
| 4 | _(pendiente)_ | Backtesting Engine: 4 estrategias (Momentum, Rebalanceo, DCA, Buy & Hold + SL/TP), métricas (Retorno, Sharpe, Max Drawdown, vs S&P 500), página `/backtest` | Pendiente |
| 5 | _(pendiente)_ | Scenario Simulator: what-if, estrés, rebalanceo simulado, página `/scenarios` | Pendiente |
| 6 | _(pendiente)_ | Alerts System: precio / % cambio / drift de rebalanceo, notificación email, páginas `/alerts` y `/settings` | Pendiente |

**Dependencias:** 2 depende de 1 · 3 depende de 2 (necesita históricos y snapshots) · 4 depende de 2 · 5 depende de 3 · 6 depende de 2.

**Decisión de alcance Fase 1:** el dashboard de la Fase 1 incluye KPI cards, distribución de activos y tabla de posiciones, pero **no** la gráfica de rendimiento ni el selector de período — ambos requieren snapshots históricos que solo existen a partir de la Fase 2/3. El esquema SQL completo (incluidas `strategies` y `alerts`) se crea desde la Fase 1 para fijar el contrato de datos.
