# Fase 3 — Analytics Engine · Design Spec

**Fecha:** 2026-06-16
**Depende de:** Fase 1 (dominio de holdings/valuation) y Fase 2 (históricos en `price_cache`, snapshots).
**Roadmap:** [docs/superpowers/plans/ROADMAP.md](../plans/ROADMAP.md) — Fase 3.

## Objetivo

Calcular y visualizar el **rendimiento histórico** del portafolio: una gráfica de valor en el tiempo
con selector de período global, comparación contra un benchmark de mercado, métricas de retorno/riesgo,
retorno por activo y una matriz de correlaciones — todo on-demand, autenticado y sin `service_role`,
reutilizando el dominio puro de la Fase 1 y los datos de la Fase 2.

## Principios de arquitectura (heredados de Fases 1–2)

- **Lógica pura en `src/lib/`** con tests Vitest; **parseo/cálculo testeable** aislado de IO.
- **Route Handlers finos y autenticados**; la IO (Supabase, red) se carga ahí y se delega a funciones puras.
- **Páginas `'use client'`** que consumen el API; gráficas con **recharts** (ya instalado).
- **Una migración aditiva:** se añade `price_cache.adj_price` (nullable) para almacenar el cierre **ajustado** junto
  al **crudo** (ver Decisión 0). `snapshots` y el resto de `price_cache` ya existen; el benchmark vive en
  `price_cache` (tabla compartida). Las preferencias de UI van en **localStorage**.

---

## Decisiones de diseño

### 0. Base de precios: **bifurcación raw / adjusted**

Se almacenan y usan **dos** series de precio, cada una para un propósito distinto. Mezclarlas es un error grave:
el adjusted close reescribe el historial hacia atrás ante un split/dividendo, mientras las cantidades de los
holdings están fijas → usar adjusted para el **valor absoluto** da disparates (un split 4:1 valoraría una compra
real de $1000 en $250). Por eso:

- **Retornos** (serie del chart, TWR, volatilidad, Sharpe, drawdown, correlación, retorno por activo, benchmark):
  **adjusted close**. Incorpora splits y dividendos → los retornos a nivel de activo son correctos y split-safe
  **sin** necesidad del workaround, y la comparación vs benchmark queda en la misma base (total return).
- **Valor absoluto en $** (`V_t`, `absolutePnl`, valor del dashboard): **close crudo (raw)**. Mantiene los dólares
  en su escala real (la compra de $1000 vale $1000). Para que sea exacto a través de un split, el usuario debe
  registrar el split como transacción (ver "Limitaciones conocidas"); el **TWR no depende de ese workaround**.

**Almacenamiento:** `price_cache` gana la columna `adj_price` (nullable). El backfill y la auto-descarga del
benchmark guardan **ambos**: `price` (raw) y `adj_price` (ajustado). Crypto (CoinGecko) y precios manuales →
`adj_price = price` (no hay splits/dividendos). En la fecha más reciente `adj_price == price`, así que el valor
actual del dashboard y `/api/positions` no cambian.

**Implicación en Fase 2:** el adaptador Yahoo expone `indicators.adjclose` además de `quote.close`; Alpha Vantage
usa `TIME_SERIES_DAILY_ADJUSTED` (raw `4. close` + `5. adjusted close`). Tras un nuevo corporate action hay que
**re-ejecutar el backfill** (upsert idempotente reescribe `adj_price`) — ver "Limitaciones conocidas".

### 1. Origen de la serie de rendimiento: **reconstrucción por retornos de constituyentes**

El **chart de rendimiento es una serie de retornos** (normalizada a 100), construida a partir de los **retornos
diarios de cada activo** (adjusted close) ponderados por su peso en el portafolio (ver Decisión 2), no como un ratio
de valores absolutos. Para cada fecha del rango se computan: los holdings as-of fecha (transacciones con
`executedAt ≤ fecha`, costo promedio de Fase 1), sus pesos (raw close) y los retornos por activo (adjusted close).

**Rol de los snapshots:** la reconstrucción por retornos hace que el chart **ya no dependa de los snapshots**
(quedan superados para los retornos). Los snapshots se siguen grabando hacia adelante (Fase 2) y sirven como
**valor absoluto observado** / cross-check del dato real; el **valor absoluto actual** del dashboard sigue saliendo
de `/api/positions`. Esto matiza la decisión de "híbrido" de rondas anteriores: el motor de retornos es
auto-suficiente; los snapshots aportan fidelidad solo en la dimensión de valor absoluto.

**Por qué:** da una gráfica útil con ~5 años de datos desde el día uno (vía el backfill de Fase 2) y, al computar
los retornos a nivel de activo con adjusted close, es correcta ante splits/dividendos sin depender de workarounds.

**Rango temporal:** la serie nunca empieza antes de la **primera transacción** del usuario (no existe portafolio
antes). Esto evita el problema de "años vacíos" y acota el cómputo.

### 2. Método de retorno: **TWR + P&L absoluto**

- **% principal = Time-Weighted Return (TWR) por retornos de constituyentes.** En vez de comparar valores absolutos
  `V_t/V_{t-1}` (que mezcla retorno de mercado con cambios de composición y obliga a manejar flujos `F_t` y divisiones
  por cero), el retorno diario del portafolio es el **promedio ponderado de los retornos de sus activos**:

  `r_portafolio,t = Σᵢ ( wᵢ,ₜ₋₁ × rᵢ,ₜ^adj )`

  donde `rᵢ,ₜ^adj = adj_closeᵢ,ₜ / adj_closeᵢ,ₜ₋₁ − 1` (retorno del activo con **adjusted close**) y `wᵢ,ₜ₋₁` es el
  peso del activo al **inicio** del día (holdings as-of × **raw close** de `t-1`, normalizado). TWR encadenado
  `TWR = Π(1 + r_portafolio,t) − 1`. La serie del chart es el producto acumulado normalizado a 100.

  **Por qué este método (resuelve flujos, splits y dividendos a la vez):**
  - **Flujos:** una compra entra como peso nuevo el día siguiente (al inicio del día de compra su peso es 0 → no
    genera retorno espurio). No hace falta `F_t` en la fórmula ni convención de timing.
  - **Splits/dividendos:** los retornos por activo usan adjusted close → correctos sin workaround.
  - **Liquidación → recompra:** si el portafolio se vacía (todo vendido), los días sin holdings tienen pesos 0 →
    `r_portafolio,t = 0`; la recompra reanuda el encadenamiento sin dividir nunca por `V_{t-1}=0`.

  **Modelo de flujos (propio de esta app):** la app **no modela una cuenta de efectivo** —
  [holdings.ts](../../../src/lib/portfolio/holdings.ts) deriva posiciones por activo solo de compras/ventas. Esto es
  consistente con el método de pesos: el capital fresco entra como peso nuevo, no como retorno. Borde documentado:
  si el usuario modela un activo `cash` explícito, la app no lo auto-debita al comprar otro activo.
- **P&L absoluto en $ (del período)** = `(V_fin − V_ini) − flujos_netos_del_período`, con `V` en **raw close** y
  `flujos` = compras (+) / ventas (−) en dólares reales (misma base raw → sin desajuste de escala). Es el dinero
  ganado/perdido por movimiento de mercado en el período (excluye aportaciones/retiros). Para "Todo" equivale a
  `valor_actual − capital_neto_aportado`. Requiere el workaround de split para ser exacto a través de un split
  (ver "Limitaciones conocidas"); el TWR no lo requiere.
- **MWR / IRR (money-weighted): fuera de alcance.** Evolución futura: se añade como métrica secundaria sin
  tocar lo demás (necesitaría un solver de IRR y no es comparable contra una línea de benchmark).

### 3. Benchmark: **presets seleccionables** (con motor agnóstico)

- Presets: **S&P 500 = `SPY`**, **Nasdaq 100 = `QQQ`**, **Bitcoin = `BTC`**. Default `SPY`.
- El **motor recibe el benchmark como parámetro** (`?benchmark=SPY`), totalmente agnóstico al ticker.
- El servidor **auto-descarga** el histórico del benchmark elegido si falta en `price_cache`, reutilizando el
  `resolver` + adaptadores de la Fase 2 (Yahoo para SPY/QQQ, CoinGecko para BTC). Error **aislado**: si falla,
  la página se dibuja con el portafolio y una nota "benchmark no disponible".
- La elección se persiste en **localStorage**.
- El benchmark no tiene flujos → su TWR = retorno del **adjusted close** (total return, mismo basis que el
  portafolio; ver Decisión 0). La gráfica superpone portafolio y benchmark **normalizados a 100** al inicio del período.

**Evolución futura → opción "ticker libre" (cualquier benchmark):** el contrato del API no cambia (el benchmark
ya es un parámetro). Solo añadiría: (a) input validado en vez del desplegable, (b) mover la preferencia a una
tabla de settings (Fase 6), (c) manejo de moneda no-USD y alineación de días hábiles cripto/acciones.

### 4. Métricas de `/analytics`

- **Núcleo:** TWR portafolio **vs** benchmark (gráfica normalizada a 100) · **P&L absoluto $** · **matriz de
  correlaciones** (ver nota de sincronicidad abajo).
- **Riesgo:** **volatilidad** (desv. estándar de retornos, anualizada ×√252) · **Sharpe** · **máximo drawdown**
  (mayor caída pico-a-valle).
- **Base común de las estadísticas de distribución (volatilidad, Sharpe, correlación):** se calculan sobre
  **retornos de días hábiles bursátiles** (≈252/año), **sin forward-fill**, no sobre retornos de calendario. Si se
  usaran días de calendario, los ceros de fin de semana (precios de acciones forward-filled) **deflactarían** la
  volatilidad y **distorsionarían** el escalado ×√252 y la correlación de Pearson. El **TWR encadenado no se ve
  afectado** (los días sin movimiento aportan factor 1). La **línea de valor del chart sí** puede forward-fill para
  verse continua; es solo el cómputo de estas estadísticas el que usa días hábiles.
- **Sharpe (consistencia dimensional):** se calcula **desde los retornos diarios** (de días hábiles), no dividiendo
  un retorno de período por una volatilidad anualizada (eso mezclaría dimensiones temporales). Fórmula:
  `Sharpe = media(retornos − rf) / desv_std(retornos) × √252`, con `rf = 0` por defecto (documentado y
  parametrizable después). Ambos términos en base diaria → ratio adimensional → √252 anualiza.
- **Correlaciones (sin sesgo de asincronía):** Pearson sobre los mismos retornos de días hábiles. Así el retorno
  Vie→Lun de un cripto y de una acción abarcan el mismo intervalo y son comparables; se evita que los retornos 0 de
  fin de semana diluyan la correlación hacia abajo.
- **Nota de implementación (vol/Sharpe/correlación):** los retornos se calculan **a partir de la lista filtrada de
  fechas operativas**, tomando `serie[t] / serie[t-1] − 1` entre índices **consecutivos de esa lista** (no de un array
  global de retornos diarios de calendario). Para cripto, su retorno del lunes se recalcula como `P_lunes / P_viernes − 1`
  sobre esas mismas fechas de intersección, no `domingo→lunes`.
- **Retorno por activo:** retorno de precio (adjusted close) de cada ticker mantenido (inicio → fin del período).
- **Fuera de alcance:** mejor/peor día del período.

### 5. Selector de período: **global y sincronizado**

- Períodos: **1S · 1M · 3M · 1A · Todo** (Todo = desde la primera transacción).
- Una sola preferencia compartida (localStorage) entre dashboard y `/analytics`: cambiarlo en una página se
  refleja en la otra.
- **Afecta:** la gráfica de rendimiento del **dashboard** y **todas** las métricas de `/analytics`.
- **No afecta:** las KPI cards del dashboard (Valor Total, P&L Hoy, Retorno Total, Activos) se mantienen como
  "foto de ahora"; `/analytics` es el análisis por período. Así "Retorno Total" no cambia de significado.

---

## Estructura de archivos

**Crear — migración SQL:**
- `supabase/migrations/0002_price_cache_adj_close.sql` — `alter table price_cache add column adj_price numeric;`
  (nullable, aditiva).

**Crear — motor puro `src/lib/analytics/`:**
- `dates.ts` — `periodStartDate(period, firstTxDate, today)`: mapea el período a fecha de inicio.
- `series.ts` — para el rango: holdings as-of por día y produce (a) **retornos por activo** (adjusted close),
  (b) **pesos start-of-day** (raw close), (c) **serie de valor absoluto** (raw close). Reusa holdings de Fase 1.
- `returns.ts` — `portfolioDailyReturns(pesos, retornosPorActivo)` = `Σ wᵢ rᵢ`; `timeWeightedReturn` = `Π(1+r)−1`;
  `absolutePnl(serieValorRaw, flujos)` = `(V_fin − V_ini) − Σflujos`; `normalizeToBase(retornos, 100)`.
- `riskMetrics.ts` — `dailyReturns` (entre fechas operativas consecutivas), `volatility` (×√252),
  `sharpe` (desde retornos diarios ×√252, `rf=0`), `maxDrawdown`.
- `correlation.ts` — `correlationMatrix(seriesPorTicker)`: Pearson sobre retornos de **días hábiles bursátiles**
  (sin forward-fill; intersección de fechas con precio real; retornos entre índices consecutivos de esa lista).
- `perAsset.ts` — `perAssetReturns(...)` retorno por activo en el período (adjusted close).
- Tests `*.test.ts` junto a cada módulo.

**Crear — UI:**
- `src/components/period-selector.tsx` — botones 1S/1M/3M/1A/Todo.
- `src/components/benchmark-selector.tsx` — desplegable de presets.
- `src/lib/hooks/use-prefs.ts` — `usePeriod()` / `useBenchmark()` sobre localStorage.

**Crear — API:**
- `src/app/api/analytics/route.ts` — `GET /api/analytics?period=&benchmark=`.

**Modificar:**
- `src/lib/market-data/yahoo.ts` — `parseYahooChart` expone también la serie **adjusted close** (`indicators.adjclose`);
  `fetchHistory` devuelve adjusted close. Actualizar `yahoo.test.ts`.
- `src/lib/market-data/alpha-vantage.ts` — usar `TIME_SERIES_DAILY_ADJUSTED` y parsear `5. adjusted close`.
  Actualizar `alpha-vantage.test.ts`.
- `src/app/(app)/dashboard/page.tsx` — sección "Rendimiento" (selector + gráfica), quitar el placeholder de Fase 3.
- `src/app/(app)/analytics/page.tsx` — reemplazar el placeholder por la página completa.
- `docs/superpowers/plans/ROADMAP.md` — marcar Fase 3 como planificada/implementada.

---

## Contrato del API

`GET /api/analytics?period=3M&benchmark=SPY`

Flujo del handler:
1. Auth (`getUser`; 401 si no hay sesión).
2. Carga `transactions` (+`ticker`, `asset_type`), `price_cache` (`ticker, price_date, price, adj_price` de los
   tickers del usuario + benchmark), `snapshots`.
3. **Auto-gestión del benchmark:** si falta histórico del benchmark en el período, lo descarga con los adaptadores
   de Fase 2 (guardando `price` y `adj_price`) y hace upsert en `price_cache`; error aislado → `benchmarkError`.
4. Calcula con el motor puro y responde:

```jsonc
{
  "series": [{ "date": "2025-06-16", "portfolio": 100, "benchmark": 100 }],  // normalizado a 100
  "summary": {
    "portfolioTwr": 0.182, "benchmarkTwr": 0.121,
    "absolutePnl": 3240.5, "volatility": 0.21, "sharpe": 0.86, "maxDrawdown": -0.14
  },
  "perAsset": [{ "ticker": "AAPL", "return": 0.23 }],
  "correlation": { "tickers": ["AAPL", "BTC"], "matrix": [[1, 0.3], [0.3, 1]] },
  "benchmarkError": null
}
```

**Un solo endpoint** sirve también al dashboard (que usa únicamente `series`). Con pocos tickers el cómputo extra
es trivial; si en el futuro pesa, se parte en `/api/analytics/series` + `/api/analytics`. Anotado, no se hace ahora.

---

## UI

- **`use-prefs.ts`:** `usePeriod()` (default `1A`) y `useBenchmark()` (default `SPY`), en localStorage con clave
  compartida entre páginas (sincronización).
- **Dashboard:** nueva sección "Rendimiento" con `<PeriodSelector>` + `LineChart` (recharts) de portafolio vs
  benchmark normalizados. KPI cards sin cambios. Se elimina el texto placeholder de Fase 3.
- **`/analytics`:** `<PeriodSelector>` + `<BenchmarkSelector>` arriba; gráfica grande; tarjetas de métricas
  (TWR tú vs benchmark, P&L $, volatilidad, Sharpe, máx. drawdown); tabla de retorno por activo; matriz de
  correlaciones tipo heatmap (verde = se mueven juntos, rojo = opuestos).

---

## Manejo de errores y casos borde

- **Sin transacciones** → estados vacíos con mensaje guía.
- **Sin histórico** (no se corrió el backfill de Fase 2) → aviso con enlace a `/data-sources`.
- **<2 activos** → la matriz de correlaciones muestra aviso en vez de tabla.
- **Benchmark falla** → se dibuja solo el portafolio + nota "benchmark no disponible" (`benchmarkError`); no rompe.
- **Precio faltante** (fin de semana/hueco) → forward-fill con el último precio conocido ≤ fecha **para la línea de
  valor**. Las **estadísticas de distribución (vol/Sharpe/correlación) NO usan forward-fill** (ver Decisión 4).
- **Crypto >1 año / IPO tardía** → el ticker aporta 0 antes de su primer precio disponible; "Todo" se ancla a la
  primera transacción. Esperado y documentado.
- **Liquidación total → recompra:** los días sin holdings tienen pesos 0 → `r_portafolio,t = 0`; la recompra reanuda
  el encadenamiento. Por construcción (retornos ponderados) **nunca se divide por `V_{t-1}=0`**.
- **Guardas numéricas:** activo sin precio en `t-1` (no entra en los pesos ese día), divisiones por cero, períodos
  sin suficientes puntos para vol/Sharpe (devolver `null`/aviso, no `NaN`).

---

## Limitaciones conocidas

- **Corporate actions (splits) sobre cantidades:** la app guarda **cantidades sin ajustar** y no procesa splits en
  `transactions`. Gracias a los retornos por activo con **adjusted close**, el **TWR, el chart y las métricas de
  retorno son correctos a través de un split sin workaround**. Lo que queda mal es el **valor absoluto en $** (raw):
  una posición que hizo split 2:1 sigue valorada con 10 acciones en vez de 20 — esto ya afecta al dashboard de
  Fase 1/2, no lo introduce la Fase 3. **Workaround:** registrar el split como transacción de ajuste (corrige el
  valor absoluto). **Fix completo (futuro):** una función de corporate actions. Fuera de alcance (YAGNI app personal).
- **Dividendos en efectivo no rastreados:** como no hay cuenta de efectivo, el **valor absoluto en $** (raw) no
  incluye el cash de un dividendo recibido (el precio raw cae en la fecha ex-dividendo y ese efectivo "se pierde" de
  la valoración). El **TWR sí incluye el total return** (vía adjusted close). Es decir, el TWR puede superar el
  crecimiento del valor absoluto por el monto de los dividendos. Documentado, no es un bug.
- **Staleness del adjusted close:** `adj_price` se calcula respecto al historial de splits/dividendos conocido al
  momento del backfill. Tras un **nuevo** corporate action hay que **re-ejecutar el backfill** (el upsert idempotente
  reescribe `adj_price`).

---

## Estrategia de tests

- **Vitest (puro):** `periodStartDate`; `series.ts` (holdings as-of, pesos start-of-day raw, retornos por activo adj);
  **TWR por retornos ponderados** (incl. día de compra entra como peso al día siguiente; **split sin workaround da
  retorno correcto**; **liquidación total → recompra** sin división por cero); `absolutePnl` en raw (incl. el caso
  split que requiere workaround); **Sharpe desde retornos diarios** (escalado √252, períodos ≠ 1 año);
  volatilidad/drawdown; **correlación/vol sobre días hábiles sin forward-fill** (retornos entre fechas operativas
  consecutivas; <2 activos; cripto+acción Vie→Lun sin dilución); normalización a 100; retorno por activo.
- **Vitest (Fase 2 modificada):** `parseYahooChart` extrae raw **y** adjusted close; `parseAlphaDaily` usa
  `4. close` (raw) **y** `5. adjusted close`.
- **Route Handler + UI:** `lint` + `build` + verificación e2e manual (la lógica pura ya queda cubierta por unit
  tests, según la convención de las Fases 1–2).

---

## Fuera de alcance (Fase 3)

- MWR / IRR (money-weighted return).
- Manejo de corporate actions / ajuste de cantidades por split (ver "Limitaciones conocidas").
- Benchmark de ticker libre y sistema de settings persistente en Supabase (llega con Fase 6).
- Mejor/peor día del período.
- Partir el endpoint de analytics por rendimiento.
