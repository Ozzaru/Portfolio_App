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
- **Sin migración SQL:** `snapshots` y `price_cache` ya existen; el benchmark vive en `price_cache`
  (tabla compartida de datos de mercado). Las preferencias de UI van en **localStorage**.

---

## Decisiones de diseño

### 0. Base de precios: **adjusted close** para los cálculos de retorno

Todos los cálculos de **retorno** (serie del chart, TWR, volatilidad, Sharpe, drawdown, correlación, retorno por
activo y benchmark) usan **precio de cierre ajustado** (adjusted close), **en ambos lados** (activos del portafolio
y benchmark). El adjusted close incorpora splits y dividendos, por lo que:
- los **retornos a través de un split son correctos** aun con la cantidad sin ajustar (el factor de split va dentro
  del precio; `cantidad × adj_close` tiene trayectoria de retorno continua);
- la comparación portafolio vs benchmark queda en la **misma base** (total return), sin sesgo por dividendos.

**Implicación en Fase 2:** el backfill (y la auto-descarga del benchmark) almacenan adjusted close en `price_cache`.
Esto extiende el adaptador Yahoo para exponer `indicators.adjclose` y el de Alpha Vantage para usar
`TIME_SERIES_DAILY_ADJUSTED`. CoinGecko (crypto) no tiene splits/dividendos → ya es "ajustado". En la fecha más
reciente `adj_close == close`, así que el **valor actual** del dashboard y `/api/positions` (que usan el último
precio) no cambian. Los niveles **absolutos históricos** quedan en base ajustada (ligeramente comprimidos), lo cual
es correcto para retornos. Tras un nuevo corporate action hay que **re-ejecutar el backfill** (upsert idempotente
reescribe la serie reajustada) — ver "Limitaciones conocidas".

### 1. Origen de la serie de rendimiento: **híbrido**

Para cada fecha del rango:
1. **Si existe un snapshot guardado** de esa fecha → se usa ese valor (dato real observado).
2. **Si no** → se **reconstruye**: `holdings as-of fecha` (transacciones con `executedAt ≤ fecha`, por costo
   promedio de la Fase 1) × **adjusted close** de ese día.

**El chart se dibuja en espacio de retornos (normalizado a 100)**, no en dólares absolutos. Esto evita cualquier
salto en la costura snapshot↔reconstrucción: los snapshots solo existen en fechas **recientes** (desde que el usuario
empezó a refrescar), donde el factor de ajuste ≈ 1 y por tanto snapshot (raw $) y reconstrucción (adj $) **coinciden**;
en el pasado, donde no hay snapshots, la serie es reconstrucción pura. Se siguen grabando snapshots hacia adelante
(Fase 2) y son además la fuente del **valor absoluto actual** y un cross-check del dato real.

**Por qué:** da una gráfica útil con ~5 años de datos desde el día uno (vía el backfill de Fase 2) y al mismo
tiempo respeta el dato real observado donde exista. Es la combinación más fiel + con más histórico.

**Rango temporal:** la serie nunca empieza antes de la **primera transacción** del usuario (no existe portafolio
antes). Esto evita el problema de "años vacíos" y acota el cómputo.

### 2. Método de retorno: **TWR + P&L absoluto**

- **% principal = Time-Weighted Return (TWR).** Neutraliza el efecto de aportaciones/retiros, es el estándar de
  la industria y **lo único comparable de forma justa contra un benchmark** (objetivo de Fase 3/4).
  TWR diario con **convención end-of-day** (los flujos del día se asumen al cierre): `r_t = (V_t − F_t) / V_{t-1} − 1`,
  encadenado `TWR = Π(1 + r_t) − 1`. Guarda: si `V_{t-1} = 0` (día de inicio del portafolio), `r_t = 0`.
  Se elige end-of-day (vs beginning-of-day `V_t/(V_{t-1}+F_t)−1`) porque aísla el retorno de mercado de los holdings
  preexistentes sin **diluir** el retorno del día al meter el flujo nuevo en el denominador.

  **Modelo de flujos (importante, propio de esta app):** la app **no modela una cuenta de efectivo** —
  [holdings.ts](../../../src/lib/portfolio/holdings.ts) deriva las posiciones por activo solo de compras/ventas; una
  compra **no** debita ningún saldo de cash rastreado. Por tanto `V_t = Σ holdings × precio` no contiene caja, y una
  compra con capital fresco **sí es un flujo externo** de entrada (`F_t` = +costo), una venta uno de salida
  (`F_t` = −ingreso). Tratarlas como flujo 0 (modelo de corretaje con caja interna) daría división por cero el primer
  día de compra (`r₁ = V₁/0`). Borde documentado: si el usuario modela un activo `cash` explícito, la app no
  auto-debita ese cash al comprar otro activo, así que mezclar ambos estilos sobreestimaría los aportes.
- **P&L absoluto en $ (del período)** = `(V_fin − V_ini) − flujos_netos_del_período`, es decir el dinero ganado/perdido
  por movimiento de mercado durante el período seleccionado (excluyendo aportaciones/retiros). Para "Todo" equivale a
  `valor_actual − capital_neto_aportado`. Métrica intuitiva ("cuánto he ganado"), consistente con que el período
  afecta a toda la página.
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

**Crear — motor puro `src/lib/analytics/`:**
- `dates.ts` — `periodStartDate(period, firstTxDate, today)`: mapea el período a fecha de inicio.
- `series.ts` — reconstrucción híbrida de la serie diaria de valor + flujos de caja netos por día.
- `returns.ts` — `timeWeightedReturn(serie, flujos)`, `absolutePnl(serie, flujos)` = `(V_fin − V_ini) − Σflujos`,
  `normalizeToBase(serie, 100)`.
- `riskMetrics.ts` — `dailyReturns`, `volatility` (×√252), `sharpe` (desde retornos diarios ×√252, `rf=0`),
  `maxDrawdown`.
- `correlation.ts` — `correlationMatrix(seriesPorTicker)`: Pearson sobre retornos de **días hábiles bursátiles**
  (sin forward-fill; intersección de fechas con precio real).
- `perAsset.ts` — `perAssetReturns(...)` retorno por activo en el período.
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
2. Carga `transactions` (+`ticker`, `asset_type`), `price_cache` (tickers del usuario + benchmark), `snapshots`.
3. **Auto-gestión del benchmark:** si falta histórico del benchmark en el período, lo descarga con los adaptadores
   de Fase 2 y hace upsert en `price_cache`; error aislado → `benchmarkError`.
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
  valor**. La **matriz de correlaciones NO usa forward-fill** (ver Decisión 4).
- **Crypto >1 año / IPO tardía** → el ticker aporta 0 antes de su primer precio disponible; "Todo" se ancla a la
  primera transacción. Esperado y documentado.
- **Guardas numéricas:** `V_{t-1}=0` (primer día), divisiones por cero, períodos sin suficientes puntos para
  vol/Sharpe (devolver `null`/aviso, no `NaN`).

---

## Limitaciones conocidas

- **Corporate actions (splits) sobre cantidades:** la app guarda **cantidades sin ajustar** y no procesa splits en
  `transactions`. El uso de **adjusted close** (Decisión 0) hace que los **retornos** a través de un split sean
  correctos, pero el **valor absoluto** de una posición que hizo split queda mal (p. ej. 10 acciones tras un split
  2:1 deberían ser 20) — esto ya afecta al dashboard de Fase 1/2, no lo introduce la Fase 3.
  **Workaround:** registrar el split como una transacción de ajuste. **Fix completo (futuro):** una función de
  corporate actions que ajuste cantidades. Fuera de alcance de la Fase 3 (YAGNI para una app personal).
- **Staleness del adjusted close:** los valores ajustados se calculan respecto al historial de splits/dividendos
  conocido al momento del backfill. Tras un **nuevo** corporate action hay que **re-ejecutar el backfill** (el upsert
  idempotente reescribe la serie reajustada).

---

## Estrategia de tests

- **Vitest (puro):** `periodStartDate`; reconstrucción híbrida (override por snapshot + forward-fill + ticker sin
  histórico aporta 0); **TWR end-of-day con flujos** (incl. guarda `V_{t-1}=0` y día de compra con holdings previos);
  `absolutePnl`; **Sharpe desde retornos diarios** (verificar escalado √252 y períodos ≠ 1 año); volatilidad/drawdown;
  **correlación sobre días hábiles sin forward-fill** (incl. <2 activos y cripto+acción sin dilución de fin de semana);
  normalización a 100; retorno por activo.
- **Vitest (Fase 2 modificada):** `parseYahooChart` extrae adjusted close; `parseAlphaDaily` usa `5. adjusted close`.
- **Route Handler + UI:** `lint` + `build` + verificación e2e manual (la lógica pura ya queda cubierta por unit
  tests, según la convención de las Fases 1–2).

---

## Fuera de alcance (Fase 3)

- MWR / IRR (money-weighted return).
- Manejo de corporate actions / ajuste de cantidades por split (ver "Limitaciones conocidas").
- Benchmark de ticker libre y sistema de settings persistente en Supabase (llega con Fase 6).
- Mejor/peor día del período.
- Partir el endpoint de analytics por rendimiento.
