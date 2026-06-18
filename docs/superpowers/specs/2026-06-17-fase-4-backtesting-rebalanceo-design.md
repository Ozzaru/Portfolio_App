# Fase 4 — Backtesting Engine (Rebalanceo) · Design Spec

**Fecha:** 2026-06-17
**Depende de:** Fase 1 (dominio de holdings), Fase 2 (históricos en `price_cache`, backfill) y Fase 3 (primitivas de riesgo/retorno en `src/lib/analytics/`).
**Roadmap:** [docs/superpowers/plans/ROADMAP.md](../plans/ROADMAP.md) — Fase 4.

## Objetivo

Backtesting **portfolio-céntrico** (estilo PORT/PRTU de Bloomberg): responder *"¿qué habría pasado con MI
cartera si la hubiera rebalanceado periódicamente a pesos objetivo, frente a dejarla derivar?"*. El MVP
implementa **una** estrategia — **Rebalanceo periódico** — sobre la **cartera real** del usuario, comparando
tres líneas sobre el histórico (cierre ajustado): cartera **rebalanceada**, cartera **buy & hold** (deriva) y
**S&P 500**. Para cada línea: **Retorno Total · Sharpe · Max Drawdown**, más **vs S&P 500**, y una gráfica de
equity. Todo on-demand, autenticado, sin `service_role`, reutilizando dominio puro de Fases 1–3.

## Cambio de alcance respecto al roadmap original

El README/roadmap inicial listaba 4 familias de estrategias (Momentum/SMA, Rebalanceo, DCA, Buy&Hold+SL/TP).
Tras precisar el caso de uso real — **gestionar la cartera personal, no hacer trading de activos sueltos** — se
**descarta del MVP el motor "señal-por-activo"** (SMA Crossover, RSI, ruptura, SL/TP): son herramientas de
*trader*, no de *gestor de cartera*. El MVP se centra en el motor **portfolio-céntrico**. DCA queda como
fast-follow natural (mismo motor). Ver "Fuera de alcance".

## Principios de arquitectura (heredados de Fases 1–3)

- **Lógica pura en `src/lib/backtest/`** con tests Vitest; cálculo aislado de IO.
- **Route Handler fino y autenticado**; la IO (Supabase, red) se carga ahí y se delega a funciones puras.
- **Página `'use client'`** que consume el API; gráfica con **recharts** (ya instalado).
- **Reutilizar, no reescribir:** métricas de `analytics/riskMetrics` (`sharpe`, `maxDrawdown`, `volatility`) y
  `analytics/returns` (`normalizeToBase`), dominio de holdings de Fase 1 (`computeHoldings`), lectura paginada
  de `price_cache` con `fetchAllRows` (`src/lib/supabase/paginate.ts`) y auto-backfill de `market-data/refresh`.
- **Sin migraciones nuevas.** El MVP es ad-hoc (no persiste). La tabla `strategies` ya existe para una mejora
  futura de "guardar estrategias con nombre".

---

## Decisiones de diseño

### 1. La cartera es el sujeto; las entradas salen de ella

El conjunto de activos del backtest **se deriva de la cartera real** (holdings de Fase 1 a partir de
`transactions`). Los **pesos objetivo** se prellenan con los **pesos actuales** del usuario y son **editables**
(esto es el *what-if* de PORT). No hay entrada de tickers arbitrarios fuera de la cartera (eso sería un
backtester genérico; ver "Fuera de alcance"). El benchmark es **SPY** (S&P 500), añadido automáticamente.

### 2. Modelo de simulación

- **Capital inicial notional:** def. **$10.000**, editable. Las métricas (retorno %, Sharpe, drawdown) son
  **invariantes de escala**, así que el monto solo afecta la etiqueta en dólares de la gráfica, no las conclusiones.
  Se asigna en `t0` (inicio del período) a los pesos objetivo.
- **Acciones fraccionarias** permitidas. **Sin comisiones ni slippage** (YAGNI para uso personal; nota a futuro).
- **Totalmente invertido**, sin efectivo ocioso (rf = 0). El rebalanceo redistribuye el 100% del valor.
- **Base de precio:** **cierre ajustado** (`adj_price`, coalesce `?? price`), igual que los retornos de Fase 3
  (split/dividend-safe). Coherente con la Decisión 0 de Fase 3.

### 3. Las tres líneas

Dadas las fechas operativas del período y la serie de cierre ajustado por activo:

- **Buy & Hold (deriva):** en `t0`, `shares_i = (C · w_i) / adj_i(t0)`; fijas. `V(t) = Σ shares_i · adj_i(t)`.
- **Rebalanceado:** igual que Buy & Hold entre fechas de rebalanceo; en cada **fecha de rebalanceo** `r` se
  recalcula `V = Σ shares_i · adj_i(r)` y se resetea `shares_i = (V · w_i) / adj_i(r)` (restaura los pesos).
- **S&P 500:** `shares_SPY = C / adj_SPY(t0)`; `V(t) = shares_SPY · adj_SPY(t)`.

**vs S&P 500** = `retornoTotal(línea) − retornoTotal(SPY)`, reportado para la línea rebalanceada (y disponible
para buy&hold).

### 4. Fechas operativas (anti-ruido de fin de semana)

Se reutiliza el criterio de la **Decisión 4 de Fase 3**: las fechas operativas son las fechas con **precio real**
de los activos **stock/ETF** del portafolio; los activos crypto se *forward-fillean* a esas fechas. Si la cartera
es 100% crypto, se cae a las fechas crypto. Esto mantiene la base de retornos en días hábiles bursátiles (≈252/año)
y evita inyectar ceros de fin de semana en Sharpe/volatilidad.

### 5. Frecuencia de rebalanceo

**Mensual** (def.) o **Trimestral**. Una fecha de rebalanceo es el **primer día operativo de cada mes**
(trimestral: meses 0, +3, +6, …, contados desde `t0`). No se rebalancea en `t0` (ahí es la asignación inicial).
Si el período es más corto que un intervalo, "rebalanceado" coincide con "buy & hold".

### 6. Período y datos

- **Selector de fechas inicio/fin**, def. **últimos 5 años**, acotado a la disponibilidad de datos.
- **Auto-backfill:** antes de calcular, se garantiza histórico de los activos de la cartera **+ SPY** para el
  período, reutilizando `backfillHistory` (igual que `/api/analytics` hace con el benchmark). Lectura con
  `fetchAllRows` paginado (evita el tope de 1000 filas).
- ⚠️ **Crypto:** CoinGecko gratuito solo da ~1 año; un período mayor con crypto tendrá la serie crypto recortada
  (se informa). Acciones/ETF tienen 5 años.

### 7. Métricas (reutilizadas)

Por línea, a partir de su curva de equity diaria `V(t)`:
- **Retorno Total** = `V_fin / V_ini − 1`.
- **Sharpe** = `analytics/riskMetrics.sharpe(retornosDiarios)` (anualizado, rf=0).
- **Max Drawdown** = `analytics/riskMetrics.maxDrawdown(V)`.
- (Volatilidad disponible vía `volatility` si se quiere mostrar.)

`retornosDiarios(t) = V(t)/V(t−1) − 1`. No se duplica ninguna fórmula de riesgo.

### 8. Persistencia: ad-hoc (MVP)

Defines → ejecutas → ves resultados, **sin guardar**. La tabla `strategies` (con `check` para los 4 tipos) queda
intacta para una mejora futura. Mantiene el MVP enfocado.

---

## Arquitectura de módulos

```
src/lib/backtest/
  types.ts        — BacktestConfig, BacktestResult, EquityPoint, StrategyLine
  weights.ts      — pesos actuales desde holdings; normalización; validación
  schedule.ts     — fechas de rebalanceo (mensual/trimestral) sobre fechas operativas
  rebalance.ts    — simulación de las 3 líneas (buy&hold, rebalanceado, benchmark)
  metrics.ts      — equity curve → { totalReturn, sharpe, maxDrawdown } (REUSA analytics)
  engine.ts       — orquestador puro: config + series → BacktestResult

src/app/api/backtest/route.ts   — POST: auth, carga holdings + price_cache, auto-backfill, llama engine
src/app/(app)/backtest/page.tsx — formulario (pesos editables, frecuencia, período, capital) + resultados
```

**Contrato del motor (puro):** `runBacktest(config, priceSeriesByTicker, benchmarkSeries, tradingDates) → BacktestResult`.
Sin IO. El route handler hace toda la IO y delega.

## API

`POST /api/backtest`
```jsonc
// request
{
  "targetWeights": { "AAPL": 0.6, "SPCX": 0.4 },  // editable; se normaliza si no suma 1
  "frequency": "monthly",                          // "monthly" | "quarterly"
  "from": "2021-06-17", "to": "2026-06-17",        // período
  "initialCapital": 10000
}
// response
{
  "lines": {
    "rebalanced": { "equityCurve": [{"date","value"}], "totalReturn", "sharpe", "maxDrawdown" },
    "buyHold":    { ... },
    "benchmark":  { ... }                            // S&P 500 (SPY)
  },
  "vsBenchmark": 0.081,                              // rebalanced.totalReturn − benchmark.totalReturn
  "warnings": ["crypto recortado a 1 año", ...],
  "benchmarkError": null
}
```
Errores: 401 sin auth; 400 si la cartera está vacía o un activo no tiene datos tras el backfill (se nombra).

## UI `/backtest`

Sigue el mockup (`docs/design/backtest-design.html`) y el patrón de `/analytics`:
1. **Definir:** tabla de los activos de tu cartera con input de **peso objetivo** editable (prellenado con el
   peso actual), selector de **frecuencia** (Mensual/Trimestral), **fechas** inicio/fin, **capital inicial**.
2. **Ejecutar:** botón → `POST /api/backtest` (estado "Ejecutando…").
3. **Resultados:** tabla/cards comparando las 3 líneas en las 4 métricas + **gráfica de equity** (3 series:
   Rebalanceado, Buy & Hold, S&P 500) con recharts. Banner de `warnings` si los hay.

## Tests (TDD, motor puro)

- `schedule`: fechas de rebalanceo mensual/trimestral correctas; no rebalancea en `t0`; período corto → vacío.
- `weights`: normalización (pesos que no suman 1), pesos desde holdings, validación (peso negativo/cero).
- `rebalance`: series sintéticas de 2 activos con resultado calculable a mano → verificar que en cada fecha de
  rebalanceo se restauran los pesos, que buy&hold deriva, y las curvas de equity esperadas.
- `metrics`: curva conocida → totalReturn/Sharpe/maxDrawdown contra valores esperados (cross-check con analytics).
- `engine`: integración pura — un activo (rebalanceado == buy&hold), portafolio mixto stock+crypto (fechas
  operativas = stock), datos insuficientes (error nombrando el ticker).

## Limitaciones conocidas

- Sin comisiones/slippage/impuestos → resultados optimistas frente a la realidad operativa.
- El rebalanceo asume ejecución al cierre ajustado del día de rebalanceo (sin spread).
- Crypto limitado a ~1 año (CoinGecko gratuito).
- SMA200 y demás señales de trading no existen (fuera de alcance).
- Capital notional: no modela aportes/retiros durante el período (eso sería DCA, fast-follow).

## Fuera de alcance (MVP)

- Estrategias de **señal-por-activo**: SMA Crossover, RSI, ruptura de máximos, Stop-Loss/Take-Profit.
- **DCA** (aportes periódicos) — fast-follow en el mismo motor de cartera.
- **Persistencia** de estrategias con nombre (tabla `strategies`).
- Backtesting sobre **tickers arbitrarios** fuera de la cartera.
- Comisiones, slippage, impuestos, efectivo con rendimiento.
