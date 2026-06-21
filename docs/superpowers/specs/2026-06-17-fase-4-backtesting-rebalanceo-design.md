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
`transactions`). No hay entrada de tickers arbitrarios fuera de la cartera (eso sería un backtester genérico;
ver "Fuera de alcance"). El benchmark es **SPY** (S&P 500), añadido automáticamente.

Los **pesos objetivo** son **editables** (el *what-if* de PORT), con dos botones de relleno rápido:
**Equiponderado (1/N)** y **Mis pesos actuales**.

### 1b. Sesgo de retrospectiva en los pesos objetivo (look-ahead/hindsight)

⚠️ **Riesgo metodológico.** Los pesos actuales de la cartera son el **resultado** de la evolución de precios:
un activo que se disparó pesa mucho hoy *porque* subió. Usar ese peso de hoy como **peso objetivo constante
desde `t0`** inyecta conocimiento del futuro en la elección del parámetro y produce retornos ficticiamente
altos (peor aún si encima se *rebalancea hacia* ese peso cada mes). Ejemplo: comprar NVDA y un bono al 50/50
en 2021; hoy NVDA pesa ~80%; fijar 80% desde 2021 asume una sobreexposición que solo el rally justifica.

**El motor no está mal** — computa correctamente lo que esos pesos habrían producido; el sesgo está en el
**input por defecto**, no en el cálculo. Por eso el fix es de UI/encuadre, no del motor:

- **No hay default silencioso de "pesos actuales".** El relleno por defecto es **Equiponderado (1/N)**, que no
  depende del resultado histórico.
- "Mis pesos actuales" sigue disponible como botón, pero al activarlo se muestra un **banner de advertencia
  severo**: *"Estos pesos reflejan la composición de HOY, no tu tesis de inversión de hace N años. Usarlos como
  objetivo histórico introduce sesgo de retrospectiva: el backtest sobrestimará el rendimiento."*

### 2. Modelo de simulación

- **Capital inicial notional:** def. **$10.000**, editable. Las métricas (retorno %, Sharpe, drawdown) son
  **invariantes de escala**, así que el monto solo afecta la etiqueta en dólares de la gráfica, no las conclusiones.
  Se asigna en `t0` (inicio del período) a los pesos objetivo.
- **Asignación de capital continua** (sin tamaño de lote ni acciones enteras; equivale a fraccionarias). El motor
  opera en espacio de capital, no de acciones (Decisión 3). **Sin comisiones ni slippage** (ver Decisión 4b).
- **Totalmente invertido**, sin efectivo ocioso (rf = 0). El rebalanceo redistribuye el 100% del valor.
- **Base de precio:** **cierre ajustado** (`adj_price`, coalesce `?? price`), igual que los retornos de Fase 3
  (split/dividend-safe). Coherente con la Decisión 0 de Fase 3.

### 3. Las tres líneas — formulación por evolución de capital

El motor opera **puramente en espacio de capital y factores de retorno**, sin la variable "acciones". Modelar
`shares = capital$ / adj_close` es un antipatrón cuantitativo: el adjusted close no es un precio real en `t`
(está reescrito hacia atrás por splits/dividendos), y exponer "shares" sintéticas invita a cruzarlas por error
con los holdings físicos de Fase 1. El álgebra es equivalente a la de acciones, pero esta forma mantiene el
motor **aislado de cantidades físicas**. Dadas las fechas operativas y la serie de cierre ajustado por activo:

- **Buy & Hold (deriva):** desde `t0`, sin tocar:
  `V(t) = Σ_i  C · w_i · ( adj_i(t) / adj_i(t0) )`.
- **Rebalanceado:** entre fechas de rebalanceo consecutivas `r_k` y `r_{k+1}` evoluciona como buy & hold,
  reanclando el capital total en cada `r_k`:
  `V(t) = Σ_i  V(r_k) · w_i · ( adj_i(t) / adj_i(r_k) )`  para `t ∈ [r_k, r_{k+1})`, con `V(r_0) = C`.
- **S&P 500:** `V(t) = C · ( adj_SPY(t) / adj_SPY(t0) )`.

**Turnover:** en cada rebalanceo `r_k`, `turnover_k = ½ · Σ_i |w_i − w_i^{pre}|` (mitad de la suma de cambios de
peso = fracción del valor efectivamente negociada). El motor acumula `turnoverTotal = Σ_k turnover_k` y lo
expone en el resultado (ver Decisión 4b).

**vs S&P 500:** ver Decisión 7 — **exceso de retorno geométrico**, no resta aritmética.

### 4. Fechas operativas (anti-ruido de fin de semana)

Se reutiliza el criterio de la **Decisión 4 de Fase 3**: las fechas operativas son las fechas con **precio real**
de los activos **stock/ETF** del portafolio; los activos crypto se *forward-fillean* a esas fechas. Si la cartera
es 100% crypto, se cae a las fechas crypto. Esto mantiene la base de retornos en días hábiles bursátiles (≈252/año)
y evita inyectar ceros de fin de semana en Sharpe/volatilidad.

### 4b. Fricción cero y turnover (sesgo direccional)

El MVP no cobra **comisiones ni slippage**. Esto no es ruido neutro: el rebalanceo periódico genera *turnover*
(compra/venta para restaurar pesos), mientras buy & hold tiene turnover **cero**. Aunque la comisión sea $0, el
**spread bid-ask** es un costo real. Ignorarlo **infla sistemáticamente** el Sharpe del rebalanceo frente al de
buy & hold — un sesgo *direccional*, no simétrico. Mitigación en el MVP (sin modelar costos, que es fast-follow):

- **Nota explícita en la UI** bajo las métricas de la línea Rebalanceado: *"El retorno no descuenta costos de
  transacción (spread/comisiones) del rebalanceo; el Sharpe del rebalanceo está optimista frente a Buy & Hold."*
- **Mostrar el turnover acumulado** (Decisión 3) junto a esa línea, para que el sesgo sea visible y cuantificable.

Modelar un costo configurable en bps por turnover queda como fast-follow.

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

### 7. Métricas (reutilizadas) y comparación vs benchmark

Por línea, a partir de su curva de equity diaria `V(t)`:
- **Retorno Total** = `V_fin / V_ini − 1`.
- **CAGR** (tasa anualizada compuesta) = `(V_fin / V_ini)^(252 / N) − 1`, con `N` = nº de días operativos del
  período. Usar 252 días hábiles/año es **consistente** con las fechas operativas (Decisión 4). El CAGR
  **estandariza** la comparación independientemente de si el usuario eligió 1 o 5 años.
- **Sharpe** = `analytics/riskMetrics.sharpe(retornosDiarios)` (anualizado, rf=0).
- **Max Drawdown** = `analytics/riskMetrics.maxDrawdown(V)`.
- (Volatilidad disponible vía `volatility` si se quiere mostrar.)

`retornosDiarios(t) = V(t)/V(t−1) − 1`. No se duplica ninguna fórmula de riesgo.

**vs S&P 500 — exceso geométrico, NO resta aritmética.** Restar retornos acumulados multi-año
(`+300% − +200% = "+100%"`) sobredimensiona y no es comparable entre períodos. Se reporta:
- **Exceso geométrico** = `(1 + RetornoTotal_línea) / (1 + RetornoTotal_SPY) − 1`.
- y/o **spread de CAGR** = `CAGR_línea − CAGR_SPY` (ya anualizado, comparable entre períodos).

Reportado para la línea rebalanceada (y disponible para buy & hold).

### 8. Persistencia: ad-hoc (MVP)

Defines → ejecutas → ves resultados, **sin guardar**. La tabla `strategies` (con `check` para los 4 tipos) queda
intacta para una mejora futura. Mantiene el MVP enfocado.

---

## Arquitectura de módulos

```
src/lib/backtest/
  types.ts        — BacktestConfig, BacktestResult, EquityPoint, StrategyLine
  weights.ts      — pesos desde holdings; relleno 1/N; normalización; validación
  schedule.ts     — fechas de rebalanceo (mensual/trimestral) sobre fechas operativas
  rebalance.ts    — simulación por evolución de capital (3 líneas) + turnover acumulado
  metrics.ts      — equity curve → { totalReturn, cagr, sharpe, maxDrawdown }; exceso geométrico (REUSA analytics)
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
    "rebalanced": { "equityCurve": [{"date","value"}], "totalReturn", "cagr", "sharpe", "maxDrawdown",
                    "turnoverTotal": 4.7 },          // turnover solo en la línea rebalanceada
    "buyHold":    { "equityCurve": [...], "totalReturn", "cagr", "sharpe", "maxDrawdown", "turnoverTotal": 0 },
    "benchmark":  { ... }                            // S&P 500 (SPY)
  },
  "vsBenchmark": {                                    // exceso GEOMÉTRICO, no resta aritmética
    "geometric": 0.062,                              // (1+Rt_reb)/(1+Rt_spy) − 1
    "cagrSpread": 0.013                              // cagr_reb − cagr_spy (anualizado)
  },
  "warnings": ["crypto recortado a 1 año", "pesos = composición actual: sesgo de retrospectiva", ...],
  "benchmarkError": null
}
```
Errores: 401 sin auth; 400 si la cartera está vacía o un activo no tiene datos tras el backfill (se nombra).

## UI `/backtest`

Sigue el mockup (`docs/design/backtest-design.html`) y el patrón de `/analytics`:
1. **Definir:** tabla de los activos de tu cartera con input de **peso objetivo** editable, con botones de relleno
   rápido **Equiponderado (1/N)** (default) y **Mis pesos actuales**; selector de **frecuencia**
   (Mensual/Trimestral), **fechas** inicio/fin, **capital inicial**. Al pulsar "Mis pesos actuales" se muestra el
   **banner de sesgo de retrospectiva** (Decisión 1b).
2. **Ejecutar:** botón → `POST /api/backtest` (estado "Ejecutando…").
3. **Resultados:** tabla/cards comparando las 3 líneas en sus métricas (Retorno Total, **CAGR**, Sharpe,
   Max Drawdown) + **vs S&P 500** (exceso geométrico) + **gráfica de equity** (3 series: Rebalanceado, Buy & Hold,
   S&P 500) con recharts. Bajo la línea Rebalanceado: **turnover acumulado** + **nota de costos de transacción**
   (Decisión 4b). Banner de `warnings` si los hay.

## Tests (TDD, motor puro)

- `schedule`: fechas de rebalanceo mensual/trimestral correctas; no rebalancea en `t0`; período corto → vacío.
- `weights`: relleno **1/N** (N activos → cada uno 1/N), normalización (pesos que no suman 1), pesos desde
  holdings, validación (peso negativo/cero).
- `rebalance`: series sintéticas de 2 activos con resultado calculable a mano → verificar la **evolución de
  capital** (factores `adj(t)/adj(r_k)`), que en cada fecha de rebalanceo se restauran los pesos, que buy&hold
  deriva, las curvas de equity esperadas, y el **turnover acumulado** (`turnoverTotal=0` para buy&hold).
- `metrics`: curva conocida → totalReturn / **CAGR** (`(Vf/Vi)^(252/N)−1`) / Sharpe / maxDrawdown contra valores
  esperados; **exceso geométrico** vs benchmark (≠ resta aritmética) con un caso donde ambas difieran.
- `engine`: integración pura — un activo (rebalanceado == buy&hold), portafolio mixto stock+crypto (fechas
  operativas = stock), datos insuficientes (error nombrando el ticker).

## Limitaciones conocidas

- Sin comisiones/slippage/impuestos → optimista; **sesga el Sharpe del rebalanceo al alza** vs buy&hold
  (Decisión 4b). Mitigado con nota + turnover visible; el costeo en bps es fast-follow.
- El rebalanceo asume ejecución al cierre ajustado del día de rebalanceo (sin spread).
- **Pesos = "Mis pesos actuales"** acarrean sesgo de retrospectiva (Decisión 1b); el default 1/N lo evita.
- Crypto limitado a ~1 año (CoinGecko gratuito).
- SMA200 y demás señales de trading no existen (fuera de alcance).
- Capital notional: no modela aportes/retiros durante el período (eso sería DCA, fast-follow).

## Fuera de alcance (MVP)

- Estrategias de **señal-por-activo**: SMA Crossover, RSI, ruptura de máximos, Stop-Loss/Take-Profit.
- **DCA** (aportes periódicos) — fast-follow en el mismo motor de cartera.
- **Persistencia** de estrategias con nombre (tabla `strategies`).
- Backtesting sobre **tickers arbitrarios** fuera de la cartera.
- Comisiones, slippage, impuestos, efectivo con rendimiento.
