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

### 1. Origen de la serie de rendimiento: **híbrido**

Para cada fecha del rango:
1. **Si existe un snapshot guardado** de esa fecha → se usa ese valor (dato real observado, fidelidad máxima).
2. **Si no** → se **reconstruye**: `holdings as-of fecha` (transacciones con `executedAt ≤ fecha`, por costo
   promedio de la Fase 1) × precio de ese día.

Se siguen grabando snapshots hacia adelante (Fase 2), así el registro "real" se consolida y reemplaza a la
reconstrucción en esos días. Reconstrucción y snapshots leen del mismo `price_cache`, así que son consistentes
(no hay discontinuidades donde se "tocan").

**Por qué:** da una gráfica útil con 5 años de datos desde el día uno (vía el backfill de Fase 2) y al mismo
tiempo respeta el dato real observado donde exista. Es la combinación más fiel + con más histórico.

**Rango temporal:** la serie nunca empieza antes de la **primera transacción** del usuario (no existe portafolio
antes). Esto evita el problema de "años vacíos" y acota el cómputo.

### 2. Método de retorno: **TWR + P&L absoluto**

- **% principal = Time-Weighted Return (TWR).** Neutraliza el efecto de aportaciones/retiros, es el estándar de
  la industria y **lo único comparable de forma justa contra un benchmark** (objetivo de Fase 3/4).
  TWR diario: `r_t = V_t / (V_{t-1} + F_t) − 1`, donde `F_t` = flujo externo neto del día (compras = +, ventas = −);
  encadenado `TWR = Π(1 + r_t) − 1`.
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
- El benchmark no tiene flujos → su TWR = retorno de precio puro. La gráfica superpone portafolio y benchmark
  **normalizados a 100** al inicio del período.

**Evolución futura → opción "ticker libre" (cualquier benchmark):** el contrato del API no cambia (el benchmark
ya es un parámetro). Solo añadiría: (a) input validado en vez del desplegable, (b) mover la preferencia a una
tabla de settings (Fase 6), (c) manejo de moneda no-USD y alineación de días hábiles cripto/acciones.

### 4. Métricas de `/analytics`

- **Núcleo:** TWR portafolio **vs** benchmark (gráfica normalizada a 100) · **P&L absoluto $** · **matriz de
  correlaciones** (Pearson sobre retornos diarios).
- **Riesgo** (baratas con la serie diaria): **volatilidad** (desv. estándar de retornos diarios, anualizada ×√252)
  · **Sharpe** (tasa libre de riesgo = 0 por defecto, documentado y parametrizable después) · **máximo drawdown**
  (mayor caída pico-a-valle).
- **Retorno por activo:** retorno de precio de cada ticker mantenido (precio inicio → fin del período).
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
- `riskMetrics.ts` — `dailyReturns`, `volatility`, `sharpe`, `maxDrawdown`.
- `correlation.ts` — `correlationMatrix(seriesPorTicker)` (Pearson, fechas solapadas).
- `perAsset.ts` — `perAssetReturns(...)` retorno por activo en el período.
- Tests `*.test.ts` junto a cada módulo.

**Crear — UI:**
- `src/components/period-selector.tsx` — botones 1S/1M/3M/1A/Todo.
- `src/components/benchmark-selector.tsx` — desplegable de presets.
- `src/lib/hooks/use-prefs.ts` — `usePeriod()` / `useBenchmark()` sobre localStorage.

**Crear — API:**
- `src/app/api/analytics/route.ts` — `GET /api/analytics?period=&benchmark=`.

**Modificar:**
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
- **Precio faltante** (fin de semana/hueco) → forward-fill con el último precio conocido ≤ fecha.
- **Crypto >1 año / IPO tardía** → el ticker aporta 0 antes de su primer precio disponible; "Todo" se ancla a la
  primera transacción. Esperado y documentado.
- **Guardas numéricas:** `V_{t-1}=0` (primer día), divisiones por cero, períodos sin suficientes puntos para
  vol/Sharpe (devolver `null`/aviso, no `NaN`).

---

## Estrategia de tests

- **Vitest (puro):** `periodStartDate`; reconstrucción híbrida (override por snapshot + forward-fill + ticker sin
  histórico aporta 0); TWR con flujos; volatilidad/Sharpe/drawdown; correlación (incl. <2 activos); normalización;
  retorno por activo.
- **Route Handler + UI:** `lint` + `build` + verificación e2e manual (la lógica pura ya queda cubierta por unit
  tests, según la convención de las Fases 1–2).

---

## Fuera de alcance (Fase 3)

- MWR / IRR (money-weighted return).
- Benchmark de ticker libre y sistema de settings persistente en Supabase (llega con Fase 6).
- Mejor/peor día del período.
- Partir el endpoint de analytics por rendimiento.
