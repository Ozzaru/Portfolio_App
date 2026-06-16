# Fase 3 — Analytics Engine · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calcular y visualizar el rendimiento histórico del portafolio (gráfica de valor normalizada, benchmark, TWR, P&L absoluto, volatilidad, Sharpe, drawdown, retorno por activo y correlaciones) on-demand y autenticado, reutilizando el dominio puro de Fase 1 y los datos de Fase 2.

**Architecture:** Lógica pura y testeable en `src/lib/analytics/` (Vitest), un Route Handler fino y autenticado `GET /api/analytics` que carga IO (Supabase + adaptadores de Fase 2) y delega en el motor puro, y dos páginas `'use client'` (dashboard + `/analytics`) que consumen el endpoint con recharts. Una migración aditiva añade `price_cache.adj_price` para almacenar el cierre **ajustado** junto al **crudo**: los **retornos** usan adjusted close (split/dividend-safe), el **valor absoluto en $** usa raw close.

**Tech Stack:** Next.js 16.2.9 (Route Handlers, `'use client'`, dev con `--webpack`), TypeScript, Supabase (`@supabase/ssr`), recharts 3.x, Vitest 4.x, Tailwind 4.

**Spec de diseño:** [docs/superpowers/specs/2026-06-16-fase-3-analytics-engine-design.md](../specs/2026-06-16-fase-3-analytics-engine-design.md)

---

## Notas de arquitectura (leer antes de empezar)

- **Convención de tests del proyecto (Fases 1–2):** la lógica pura se cubre con unit tests Vitest; los Route Handlers y la UI se validan con `lint` + `build` + verificación e2e manual. Este plan sigue esa convención: las Tasks de motor puro y adaptadores son TDD; las Tasks de API/UI no llevan test unitario, sino `lint`/`build` y checklist manual.
- **Bifurcación raw/adjusted (Decisión 0 de la spec):** se almacenan dos series. `price` = cierre **crudo** (valor absoluto en $). `adj_price` = cierre **ajustado** (retornos: chart, TWR, vol, Sharpe, drawdown, correlación, benchmark, retorno por activo). El motor de analytics, al leer `price_cache`, hace `adjPrice = row.adj_price ?? row.price` (coalesce) para degradar con gracia ante filas antiguas/manuales/crypto donde `adj_price` sea null.
- **Trabajo en `main`:** convención del proyecto desde la Fase 1. Commits frecuentes.
- **Dev server:** si necesitas levantarlo para la verificación manual, usa `npm run dev` (ya fijado a `next dev --webpack` en package.json; Turbopack rompe `src/proxy.ts`).
- **Desviaciones menores respecto a la lista de archivos de la spec (justificadas):**
  - Se añade `src/lib/analytics/types.ts` (tipos compartidos `Period`, `PricePointAdj`, `PriceSeriesByTicker`, `AnalyticsResult`) para DRY entre módulos.
  - Se añade `src/lib/analytics/engine.ts` (`computeAnalytics`) que pega los módulos puros y produce el shape del API, manteniendo el Route Handler fino.
  - Se añade `src/lib/analytics/benchmarks.ts` (presets SPY/QQQ/BTC) compartido entre el route y el `<BenchmarkSelector>`.
  - **No se cargan `snapshots`** en el motor: la Decisión 1 (revisada) de la spec dice que la reconstrucción por retornos hace que el chart ya **no dependa de snapshots**. El valor absoluto del período sale del raw close de `price_cache`. Los snapshots se siguen grabando en Fase 2 como cross-check, pero el motor no los necesita.

---

## File Structure

**Crear — migración SQL:**
- `supabase/migrations/0002_price_cache_adj_close.sql` — `alter table price_cache add column adj_price numeric;` (nullable, aditiva).

**Crear — motor puro `src/lib/analytics/`:**
- `types.ts` — `Period`, `PricePointAdj`, `PriceSeriesByTicker`, `AnalyticsResult`.
- `dates.ts` — `periodStartDate(period, firstTxDate, today)`.
- `series.ts` — `priceAsOf`, `holdingsAsOf`, `tradingDates`, `portfolioRawValue`, `startOfDayWeights`, `assetReturn`.
- `returns.ts` — `portfolioDailyReturn`, `timeWeightedReturn`, `normalizeToBase`, `absolutePnl`.
- `riskMetrics.ts` — `mean`, `stdDev`, `volatility`, `sharpe`, `maxDrawdown`.
- `correlation.ts` — `pearson`, `correlationMatrix`.
- `perAsset.ts` — `perAssetReturns`.
- `benchmarks.ts` — `BENCHMARK_PRESETS`, `benchmarkPreset`.
- `engine.ts` — `computeAnalytics` (orquestador puro).
- `*.test.ts` junto a cada módulo de lógica.

**Crear — UI:**
- `src/lib/hooks/use-prefs.ts` — `usePeriod()` / `useBenchmark()` sobre localStorage.
- `src/components/period-selector.tsx` — botones 1S/1M/3M/1A/Todo.
- `src/components/benchmark-selector.tsx` — desplegable de presets.

**Crear — API:**
- `src/app/api/analytics/route.ts` — `GET /api/analytics?period=&benchmark=`.

**Modificar — Fase 2 (bifurcación raw/adjusted):**
- `src/lib/market-data/types.ts` — `PricePoint` gana `adjPrice`.
- `src/lib/market-data/yahoo.ts` + `yahoo.test.ts` — extraer `indicators.adjclose`.
- `src/lib/market-data/alpha-vantage.ts` + `alpha-vantage.test.ts` — `TIME_SERIES_DAILY_ADJUSTED`, `5. adjusted close`.
- `src/lib/market-data/coingecko.ts` + `coingecko.test.ts` — `adjPrice = price`.
- `src/lib/market-data/refresh.ts` + `refresh.test.ts` — `PriceRow` gana `adjPrice`.
- `src/app/api/prices/backfill/route.ts` — upsert escribe `adj_price`.
- `src/app/api/prices/refresh/route.ts` — upsert de la cotización de hoy escribe `adj_price = price`.

**Modificar — UI y docs:**
- `src/app/(app)/dashboard/page.tsx` — sección "Rendimiento" (selector + gráfica), quitar placeholder de Fase 3.
- `src/app/(app)/analytics/page.tsx` — reemplazar el placeholder por la página completa.
- `docs/superpowers/plans/ROADMAP.md` — marcar Fase 3 como planificada.

---

## Task 1: Migración SQL — `price_cache.adj_price`

**Files:**
- Create: `supabase/migrations/0002_price_cache_adj_close.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- supabase/migrations/0002_price_cache_adj_close.sql
-- Fase 3: cierre ajustado junto al crudo (bifurcación raw/adjusted, Decisión 0).
-- Aditiva y nullable: las filas existentes y el endpoint /api/positions no cambian
-- (en la fecha más reciente adj_price == price). El motor de analytics coalesce
-- adj_price ?? price al leer, así que filas antiguas degradan con gracia.
alter table price_cache add column adj_price numeric;
```

- [ ] **Step 2: Aplicar en Supabase**

Ejecutar el contenido del archivo en el **SQL Editor** del proyecto Supabase (ref `fobpkqiciegpmwuiiudn`). No hay CLI local de migraciones en este proyecto (igual que `0001_init.sql`).
Expected: `Success. No rows returned`. La columna `adj_price` aparece en `price_cache`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0002_price_cache_adj_close.sql
git commit -m "feat(db): price_cache.adj_price para bifurcacion raw/adjusted (Fase 3)"
```

---

## Task 2: `PricePoint.adjPrice` + adaptador Yahoo (adjusted close)

**Files:**
- Modify: `src/lib/market-data/types.ts`
- Modify: `src/lib/market-data/yahoo.ts`
- Test: `src/lib/market-data/yahoo.test.ts`

- [ ] **Step 1: Extender el tipo `PricePoint`**

En `src/lib/market-data/types.ts`, reemplazar la interfaz `PricePoint`:

```ts
// Precio de un ticker en una fecha concreta (YYYY-MM-DD, UTC).
// price = cierre crudo (valor absoluto $). adjPrice = cierre ajustado (retornos).
export interface PricePoint {
  date: string
  price: number
  adjPrice: number
}
```

- [ ] **Step 2: Actualizar el test de Yahoo para esperar adjusted close**

En `src/lib/market-data/yahoo.test.ts`, reemplazar `sample` y las aserciones de `parseYahooChart` / `fetchHistory`:

```ts
const sample = {
  chart: {
    error: null,
    result: [
      {
        meta: { symbol: 'AAPL', regularMarketPrice: 175.5, regularMarketTime: 1718409600 },
        timestamp: [1704153600, 1704240000],
        indicators: {
          quote: [{ close: [185.1, null] }],
          adjclose: [{ adjclose: [184.2, null] }],
        },
      },
    ],
  },
}

describe('parseYahooChart', () => {
  it('extrae precio actual e histórico (raw + adjusted), saltando closes nulos', () => {
    const out = parseYahooChart(sample)
    expect(out.ticker).toBe('AAPL')
    expect(out.current).toEqual({ date: '2024-06-15', price: 175.5, adjPrice: 175.5 })
    expect(out.history).toEqual([{ date: '2024-01-02', price: 185.1, adjPrice: 184.2 }])
  })

  it('si falta adjclose, adjPrice cae al raw close', () => {
    const noAdj = {
      chart: {
        error: null,
        result: [
          {
            meta: { symbol: 'AAPL', regularMarketPrice: 175.5, regularMarketTime: 1718409600 },
            timestamp: [1704153600],
            indicators: { quote: [{ close: [185.1] }] },
          },
        ],
      },
    }
    expect(parseYahooChart(noAdj).history).toEqual([{ date: '2024-01-02', price: 185.1, adjPrice: 185.1 }])
  })

  it('lanza con mensaje si la respuesta es de error', () => {
    expect(() => parseYahooChart({ chart: { result: null, error: { description: 'Not Found' } } })).toThrow(
      'Not Found'
    )
  })
})
```

Y en `describe('createYahooAdapter')` actualizar las aserciones que comparan `PricePoint`:

```ts
  it('fetchHistory devuelve los puntos históricos (raw + adjusted)', async () => {
    const a = createYahooAdapter(async () => sample)
    const hist = await a.fetchHistory('AAPL', '2021-06-15')
    expect(hist).toEqual([{ date: '2024-01-02', price: 185.1, adjPrice: 184.2 }])
  })
```

(Las aserciones de `supports` y `fetchQuotes` no cambian, salvo que `fetchQuotes` ya no toca `adjPrice`.)

- [ ] **Step 3: Ejecutar el test para verlo fallar**

Run: `npm run test -- yahoo`
Expected: FAIL (la implementación aún no extrae `adjclose` ni añade `adjPrice`).

- [ ] **Step 4: Implementar la extracción de adjusted close en Yahoo**

En `src/lib/market-data/yahoo.ts`, reemplazar el cuerpo de `parseYahooChart`:

```ts
/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseYahooChart(json: any): YahooParsed {
  const result = json?.chart?.result?.[0]
  if (!result) {
    throw new Error(json?.chart?.error?.description ?? 'respuesta de Yahoo inválida')
  }
  const ticker: string = result.meta?.symbol ?? ''
  const timestamps: number[] = result.timestamp ?? []
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? []
  const adjcloses: (number | null)[] = result.indicators?.adjclose?.[0]?.adjclose ?? []

  const history: PricePoint[] = []
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i]
    if (typeof c !== 'number') continue
    const a = adjcloses[i]
    history.push({ date: unixToISODate(timestamps[i]), price: c, adjPrice: typeof a === 'number' ? a : c })
  }

  const metaPrice = result.meta?.regularMarketPrice
  const current: PricePoint | null =
    typeof metaPrice === 'number'
      ? {
          date: unixToISODate(result.meta?.regularMarketTime ?? timestamps[timestamps.length - 1]),
          price: metaPrice,
          adjPrice: metaPrice, // la cotización de hoy: sin ajuste todavía → adj == raw
        }
      : history.at(-1) ?? null

  return { ticker, current, history }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
```

- [ ] **Step 5: Ejecutar el test para verlo pasar**

Run: `npm run test -- yahoo`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/market-data/types.ts src/lib/market-data/yahoo.ts src/lib/market-data/yahoo.test.ts
git commit -m "feat(market-data): Yahoo expone adjusted close; PricePoint.adjPrice"
```

---

## Task 3: Adaptador Alpha Vantage (TIME_SERIES_DAILY_ADJUSTED)

**Files:**
- Modify: `src/lib/market-data/alpha-vantage.ts`
- Test: `src/lib/market-data/alpha-vantage.test.ts`

- [ ] **Step 1: Actualizar el test para esperar `5. adjusted close`**

En `src/lib/market-data/alpha-vantage.test.ts`, reemplazar `sample` y la aserción de `parseAlphaDaily`:

```ts
const sample = {
  'Time Series (Daily)': {
    '2024-01-03': { '4. close': '185.30', '5. adjusted close': '184.40' },
    '2024-01-02': { '4. close': '185.10', '5. adjusted close': '184.20' },
  },
}

describe('parseAlphaDaily', () => {
  it('mapea la serie a PricePoint[] (raw + adjusted) ordenado ascendente', () => {
    expect(parseAlphaDaily(sample)).toEqual([
      { date: '2024-01-02', price: 185.1, adjPrice: 184.2 },
      { date: '2024-01-03', price: 185.3, adjPrice: 184.4 },
    ])
  })
  it('si falta adjusted close, adjPrice cae al raw close', () => {
    const noAdj = { 'Time Series (Daily)': { '2024-01-02': { '4. close': '185.10' } } }
    expect(parseAlphaDaily(noAdj)).toEqual([{ date: '2024-01-02', price: 185.1, adjPrice: 185.1 }])
  })
  it('lanza al detectar el aviso de límite', () => {
    expect(() => parseAlphaDaily({ Note: 'rate limit 25/day' })).toThrow(/límite/)
    expect(() => parseAlphaDaily({ Information: 'premium endpoint' })).toThrow(/límite/)
  })
})
```

- [ ] **Step 2: Ejecutar el test para verlo fallar**

Run: `npm run test -- alpha-vantage`
Expected: FAIL (`adjPrice` no existe y el endpoint es el no-ajustado).

- [ ] **Step 3: Implementar el parseo ajustado y cambiar el endpoint**

En `src/lib/market-data/alpha-vantage.ts`, reemplazar `parseAlphaDaily` y la URL de `fetchHistory`:

```ts
/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseAlphaDaily(json: any): PricePoint[] {
  if (json?.Note || json?.Information) {
    throw new Error('límite de Alpha Vantage alcanzado (25/día en plan gratuito)')
  }
  const series = json?.['Time Series (Daily)']
  if (!series) throw new Error(json?.['Error Message'] ?? 'respuesta de Alpha Vantage inválida')
  return Object.entries(series)
    .map(([date, v]: [string, any]) => {
      const price = Number(v['4. close'])
      const adj = v['5. adjusted close']
      return { date, price, adjPrice: adj != null ? Number(adj) : price }
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}
/* eslint-enable @typescript-eslint/no-explicit-any */
```

Y dentro de `createAlphaVantageAdapter`, en `fetchHistory`, cambiar la función del query:

```ts
      const url = `${BASE}?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${encodeURIComponent(
        ticker
      )}&outputsize=full&apikey=${apiKey}`
```

- [ ] **Step 4: Ejecutar el test para verlo pasar**

Run: `npm run test -- alpha-vantage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/market-data/alpha-vantage.ts src/lib/market-data/alpha-vantage.test.ts
git commit -m "feat(market-data): Alpha Vantage usa TIME_SERIES_DAILY_ADJUSTED"
```

---

## Task 4: Adaptador CoinGecko (`adjPrice = price`)

**Files:**
- Modify: `src/lib/market-data/coingecko.ts`
- Test: `src/lib/market-data/coingecko.test.ts`

- [ ] **Step 1: Leer el test actual y ajustar la aserción de `parseMarketChart`**

En `src/lib/market-data/coingecko.test.ts`, localizar la aserción de `parseMarketChart` (devuelve `PricePoint[]`) y actualizarla para incluir `adjPrice` igual a `price`. Ejemplo (ajusta los valores al `sample` existente del archivo):

```ts
  it('mapea prices a PricePoint[] con adjPrice = price (no hay splits en crypto)', () => {
    const out = parseMarketChart({ prices: [[1704153600000, 42000], [1704240000000, 43000]] })
    expect(out).toEqual([
      { date: '2024-01-02', price: 42000, adjPrice: 42000 },
      { date: '2024-01-03', price: 43000, adjPrice: 43000 },
    ])
  })
```

- [ ] **Step 2: Ejecutar el test para verlo fallar**

Run: `npm run test -- coingecko`
Expected: FAIL (falta `adjPrice`).

- [ ] **Step 3: Implementar `adjPrice = price` en `parseMarketChart`**

En `src/lib/market-data/coingecko.ts`, en `parseMarketChart`, cambiar el map final:

```ts
  return [...byDate].map(([date, price]) => ({ date, price, adjPrice: price }))
```

- [ ] **Step 4: Ejecutar el test para verlo pasar**

Run: `npm run test -- coingecko`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/market-data/coingecko.ts src/lib/market-data/coingecko.test.ts
git commit -m "feat(market-data): CoinGecko fija adjPrice = price (sin splits)"
```

---

## Task 5: Propagar `adjPrice` en el orquestador y los route handlers de precios

**Files:**
- Modify: `src/lib/market-data/refresh.ts`
- Test: `src/lib/market-data/refresh.test.ts`
- Modify: `src/app/api/prices/backfill/route.ts`
- Modify: `src/app/api/prices/refresh/route.ts`

- [ ] **Step 1: Actualizar el test de `refresh` para que `PriceRow` lleve `adjPrice`**

En `src/lib/market-data/refresh.test.ts`, localizar el test de `backfillHistory` que verifica las `rows`. Los `PricePoint` de prueba ahora deben incluir `adjPrice`, y la `PriceRow` esperada también. Ejemplo (adapta a los fixtures existentes del archivo):

```ts
  it('backfillHistory propaga raw y adjusted a cada PriceRow', async () => {
    const yahoo = {
      id: 'yahoo',
      supports: (t: string) => t === 'stock' || t === 'etf',
      fetchQuotes: async () => [],
      fetchHistory: async () => [{ date: '2024-01-02', price: 185.1, adjPrice: 184.2 }],
    }
    const coingecko = {
      id: 'coingecko',
      supports: (t: string) => t === 'crypto',
      fetchQuotes: async () => [],
      fetchHistory: async () => [],
    }
    const { rows } = await backfillHistory(
      [{ ticker: 'AAPL', asset_type: 'stock' }],
      '2021-06-15',
      { yahoo, coingecko, alphaVantage: undefined }
    )
    expect(rows).toEqual([{ ticker: 'AAPL', date: '2024-01-02', price: 185.1, adjPrice: 184.2, source: 'yahoo' }])
  })
```

- [ ] **Step 2: Ejecutar el test para verlo fallar**

Run: `npm run test -- refresh`
Expected: FAIL (`PriceRow` aún no tiene `adjPrice`).

- [ ] **Step 3: Añadir `adjPrice` a `PriceRow` y mapearlo en `backfillHistory`**

En `src/lib/market-data/refresh.ts`, actualizar la interfaz `PriceRow`:

```ts
export interface PriceRow {
  ticker: string
  date: string
  price: number
  adjPrice: number
  source: string
}
```

Y en `backfillHistory`, los dos `rows.push(...points.map(...))` (rama Yahoo/CoinGecko y rama Alpha Vantage) deben incluir `adjPrice`:

```ts
      rows.push(
        ...points.map((p) => ({ ticker: a.ticker, date: p.date, price: p.price, adjPrice: p.adjPrice, source: src }))
      )
```

```ts
          rows.push(
            ...points.map((p) => ({
              ticker: a.ticker,
              date: p.date,
              price: p.price,
              adjPrice: p.adjPrice,
              source: 'alpha-vantage',
            }))
          )
```

- [ ] **Step 4: Ejecutar el test para verlo pasar**

Run: `npm run test -- refresh`
Expected: PASS.

- [ ] **Step 5: Escribir `adj_price` en el upsert del backfill**

En `src/app/api/prices/backfill/route.ts`, en el `.map` del batch, añadir `adj_price`:

```ts
    const batch = rows.slice(i, i + 500).map((r) => ({
      ticker: r.ticker,
      price: r.price,
      adj_price: r.adjPrice,
      price_date: r.date,
      source: r.source,
    }))
```

- [ ] **Step 6: Escribir `adj_price = price` en el upsert del refresh (cotización de hoy)**

En `src/app/api/prices/refresh/route.ts`, en el `.map` de `quotes`, añadir `adj_price` igual al precio (la cotización de hoy aún no tiene ajuste):

```ts
    const rows = quotes.map((q) => ({
      ticker: q.ticker,
      price: q.price,
      adj_price: q.price,
      price_date: q.date,
      source: sourceOf(q.ticker, assets ?? []),
    }))
```

- [ ] **Step 7: Verificar build + lint + suite completa**

Run: `npm run test && npm run lint && npm run build`
Expected: tests PASS, lint sin errores, build OK.

- [ ] **Step 8: Commit**

```bash
git add src/lib/market-data/refresh.ts src/lib/market-data/refresh.test.ts src/app/api/prices/backfill/route.ts src/app/api/prices/refresh/route.ts
git commit -m "feat(market-data): persistir adj_price en backfill y refresh"
```

---

## Task 6: `analytics/types.ts` + `analytics/dates.ts` (`periodStartDate`)

**Files:**
- Create: `src/lib/analytics/types.ts`
- Create: `src/lib/analytics/dates.ts`
- Test: `src/lib/analytics/dates.test.ts`

- [ ] **Step 1: Crear los tipos compartidos**

```ts
// src/lib/analytics/types.ts
export type Period = '1W' | '1M' | '3M' | '1Y' | 'ALL'

// Precio diario con cierre crudo (valor $) y ajustado (retornos).
export interface PricePointAdj {
  date: string // YYYY-MM-DD
  price: number // raw close
  adjPrice: number // adjusted close
}

// Historial por ticker, ORDENADO ascendente por fecha.
export type PriceSeriesByTicker = Map<string, PricePointAdj[]>

export interface AnalyticsResult {
  series: { date: string; portfolio: number; benchmark: number | null }[]
  summary: {
    portfolioTwr: number | null
    benchmarkTwr: number | null
    absolutePnl: number | null
    volatility: number | null
    sharpe: number | null
    maxDrawdown: number | null
  }
  perAsset: { ticker: string; return: number | null }[]
  correlation: { tickers: string[]; matrix: (number | null)[][] }
  benchmarkError: string | null
}
```

- [ ] **Step 2: Escribir el test de `periodStartDate`**

```ts
// src/lib/analytics/dates.test.ts
import { describe, it, expect } from 'vitest'
import { periodStartDate } from './dates'

describe('periodStartDate', () => {
  const today = '2026-06-16'
  const firstTx = '2024-01-10'

  it('1W resta 7 días', () => {
    expect(periodStartDate('1W', firstTx, today)).toBe('2026-06-09')
  })
  it('1M resta un mes', () => {
    expect(periodStartDate('1M', firstTx, today)).toBe('2026-05-16')
  })
  it('3M resta tres meses', () => {
    expect(periodStartDate('3M', firstTx, today)).toBe('2026-03-16')
  })
  it('1Y resta un año', () => {
    expect(periodStartDate('1Y', firstTx, today)).toBe('2025-06-16')
  })
  it('ALL devuelve la primera transacción', () => {
    expect(periodStartDate('ALL', firstTx, today)).toBe('2024-01-10')
  })
  it('nunca empieza antes de la primera transacción', () => {
    // 1A desde 2026-06-16 = 2025-06-16, pero la primera tx es posterior
    expect(periodStartDate('1Y', '2026-03-01', today)).toBe('2026-03-01')
  })
})
```

- [ ] **Step 3: Ejecutar el test para verlo fallar**

Run: `npm run test -- analytics/dates`
Expected: FAIL ("periodStartDate is not defined").

- [ ] **Step 4: Implementar `periodStartDate`**

```ts
// src/lib/analytics/dates.ts
import type { Period } from './types'

// Fecha de inicio del período. Nunca antes de la primera transacción (no existe
// portafolio antes). 'ALL' = primera transacción. Cálculo en UTC.
export function periodStartDate(period: Period, firstTxDate: string, today: string): string {
  if (period === 'ALL') return firstTxDate
  const d = new Date(`${today}T00:00:00Z`)
  switch (period) {
    case '1W':
      d.setUTCDate(d.getUTCDate() - 7)
      break
    case '1M':
      d.setUTCMonth(d.getUTCMonth() - 1)
      break
    case '3M':
      d.setUTCMonth(d.getUTCMonth() - 3)
      break
    case '1Y':
      d.setUTCFullYear(d.getUTCFullYear() - 1)
      break
  }
  const candidate = d.toISOString().slice(0, 10)
  return candidate > firstTxDate ? candidate : firstTxDate
}
```

- [ ] **Step 5: Ejecutar el test para verlo pasar**

Run: `npm run test -- analytics/dates`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/analytics/types.ts src/lib/analytics/dates.ts src/lib/analytics/dates.test.ts
git commit -m "feat(analytics): tipos compartidos y periodStartDate"
```

---

## Task 7: `analytics/series.ts` (holdings as-of, pesos, retornos por activo)

**Files:**
- Create: `src/lib/analytics/series.ts`
- Test: `src/lib/analytics/series.test.ts`

Reutiliza `computeHoldings` de Fase 1. Define los bloques que el motor encadena: lookup de precio con forward-fill, holdings as-of fecha, lista de fechas operativas, valor crudo del portafolio, pesos start-of-day (raw) y retorno por activo (adjusted).

- [ ] **Step 1: Escribir los tests de `series.ts`**

```ts
// src/lib/analytics/series.test.ts
import { describe, it, expect } from 'vitest'
import {
  priceAsOf,
  holdingsAsOf,
  tradingDates,
  portfolioRawValue,
  startOfDayWeights,
  assetReturn,
} from './series'
import type { PriceSeriesByTicker } from './types'
import type { Transaction } from '@/lib/portfolio/holdings'

const series: PriceSeriesByTicker = new Map([
  [
    'AAPL',
    [
      { date: '2024-01-02', price: 100, adjPrice: 90 },
      { date: '2024-01-03', price: 110, adjPrice: 99 },
      { date: '2024-01-05', price: 120, adjPrice: 108 },
    ],
  ],
  [
    'BTC',
    [
      { date: '2024-01-02', price: 40000, adjPrice: 40000 },
      { date: '2024-01-03', price: 41000, adjPrice: 41000 },
      { date: '2024-01-04', price: 42000, adjPrice: 42000 },
      { date: '2024-01-05', price: 43000, adjPrice: 43000 },
    ],
  ],
])

const txs: Transaction[] = [
  { assetId: 'a1', ticker: 'AAPL', side: 'buy', quantity: 10, price: 100, fees: 0, executedAt: '2024-01-02' },
  { assetId: 'a2', ticker: 'BTC', side: 'buy', quantity: 1, price: 40000, fees: 0, executedAt: '2024-01-03' },
]

describe('priceAsOf', () => {
  it('devuelve el último punto con fecha <= objetivo (forward-fill)', () => {
    expect(priceAsOf(series.get('AAPL')!, '2024-01-04')).toEqual({ date: '2024-01-03', price: 110, adjPrice: 99 })
  })
  it('devuelve null si no hay punto <= objetivo', () => {
    expect(priceAsOf(series.get('AAPL')!, '2024-01-01')).toBeNull()
  })
})

describe('holdingsAsOf', () => {
  it('solo cuenta transacciones con executedAt <= fecha', () => {
    const h = holdingsAsOf(txs, '2024-01-02')
    expect(h).toHaveLength(1)
    expect(h[0].ticker).toBe('AAPL')
  })
  it('incluye ambos activos una vez compradas ambas', () => {
    expect(holdingsAsOf(txs, '2024-01-03')).toHaveLength(2)
  })
})

describe('tradingDates', () => {
  it('usa las fechas reales de stock/etf cuando existen (ignora días extra de crypto)', () => {
    expect(tradingDates(series, ['AAPL'], ['BTC'], '2024-01-02', '2024-01-05')).toEqual([
      '2024-01-02',
      '2024-01-03',
      '2024-01-05',
    ])
  })
  it('cae a las fechas de crypto si no hay stock/etf', () => {
    expect(tradingDates(series, [], ['BTC'], '2024-01-02', '2024-01-05')).toEqual([
      '2024-01-02',
      '2024-01-03',
      '2024-01-04',
      '2024-01-05',
    ])
  })
})

describe('portfolioRawValue', () => {
  it('suma cantidad × raw close (forward-fill)', () => {
    const h = holdingsAsOf(txs, '2024-01-05')
    // AAPL 10×120 + BTC 1×43000
    expect(portfolioRawValue(h, series, '2024-01-05')).toBe(10 * 120 + 43000)
  })
})

describe('startOfDayWeights', () => {
  it('normaliza por valor crudo y suma 1', () => {
    const h = holdingsAsOf(txs, '2024-01-03')
    const w = startOfDayWeights(h, series, '2024-01-03')
    const aapl = 10 * 110
    const btc = 1 * 41000
    expect(w.get('AAPL')).toBeCloseTo(aapl / (aapl + btc))
    expect(w.get('BTC')).toBeCloseTo(btc / (aapl + btc))
    expect((w.get('AAPL') ?? 0) + (w.get('BTC') ?? 0)).toBeCloseTo(1)
  })
  it('devuelve pesos vacíos si el valor total es 0', () => {
    expect(startOfDayWeights([], series, '2024-01-03').size).toBe(0)
  })
})

describe('assetReturn', () => {
  it('usa adjusted close entre dos fechas', () => {
    // AAPL adj 99 → 108 de 2024-01-03 a 2024-01-05
    expect(assetReturn(series, 'AAPL', '2024-01-03', '2024-01-05')).toBeCloseTo(108 / 99 - 1)
  })
  it('devuelve null si falta precio en t-1', () => {
    expect(assetReturn(series, 'AAPL', '2024-01-01', '2024-01-03')).toBeNull()
  })
})
```

- [ ] **Step 2: Ejecutar el test para verlo fallar**

Run: `npm run test -- analytics/series`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar `series.ts`**

```ts
// src/lib/analytics/series.ts
import { computeHoldings, type Holding, type Transaction } from '@/lib/portfolio/holdings'
import type { PricePointAdj, PriceSeriesByTicker } from './types'

// Último punto con fecha <= objetivo (forward-fill). La serie debe venir ordenada
// ascendente. Devuelve null si no hay ningún punto <= objetivo.
export function priceAsOf(series: PricePointAdj[], date: string): PricePointAdj | null {
  let found: PricePointAdj | null = null
  for (const p of series) {
    if (p.date <= date) found = p
    else break
  }
  return found
}

// Holdings derivados solo de las transacciones con executedAt <= fecha (costo
// promedio de Fase 1). Reusa el dominio puro sin duplicarlo.
export function holdingsAsOf(transactions: Transaction[], date: string): Holding[] {
  return computeHoldings(transactions.filter((t) => t.executedAt <= date))
}

// Fechas operativas del rango: fechas con precio REAL de los tickers stock/etf;
// si no hay ninguno (portafolio all-crypto) cae a las fechas de los crypto.
// Mantiene la base de retornos en días hábiles bursátiles (≈252/año) y evita
// inyectar ceros de fin de semana (ver Decisión 4 de la spec).
export function tradingDates(
  series: PriceSeriesByTicker,
  stockEtfTickers: string[],
  cryptoTickers: string[],
  from: string,
  to: string
): string[] {
  const collect = (tickers: string[]): Set<string> => {
    const set = new Set<string>()
    for (const t of tickers) {
      for (const p of series.get(t) ?? []) {
        if (p.date >= from && p.date <= to) set.add(p.date)
      }
    }
    return set
  }
  let dates = collect(stockEtfTickers)
  if (dates.size === 0) dates = collect(cryptoTickers)
  return [...dates].sort()
}

// Valor crudo (raw close) del portafolio en una fecha. Forward-fill por ticker.
export function portfolioRawValue(holdings: Holding[], series: PriceSeriesByTicker, date: string): number {
  let total = 0
  for (const h of holdings) {
    const p = priceAsOf(series.get(h.ticker) ?? [], date)
    if (p) total += h.quantity * p.price
  }
  return total
}

// Pesos al inicio del día: holdings valuados a raw close as-of `date`, normalizados.
// Devuelve mapa vacío si el valor total es 0 (días sin holdings → retorno 0 aguas arriba).
export function startOfDayWeights(
  holdings: Holding[],
  series: PriceSeriesByTicker,
  date: string
): Map<string, number> {
  const values = new Map<string, number>()
  let total = 0
  for (const h of holdings) {
    const p = priceAsOf(series.get(h.ticker) ?? [], date)
    if (p) {
      const v = h.quantity * p.price
      values.set(h.ticker, v)
      total += v
    }
  }
  const weights = new Map<string, number>()
  if (total <= 0) return weights
  for (const [t, v] of values) weights.set(t, v / total)
  return weights
}

// Retorno de un activo entre dos fechas usando adjusted close (split/dividend-safe).
// null si falta precio en cualquiera de las dos o si el de t-1 no es positivo.
export function assetReturn(
  series: PriceSeriesByTicker,
  ticker: string,
  prevDate: string,
  date: string
): number | null {
  const s = series.get(ticker) ?? []
  const prev = priceAsOf(s, prevDate)
  const cur = priceAsOf(s, date)
  if (!prev || !cur || prev.adjPrice <= 0) return null
  return cur.adjPrice / prev.adjPrice - 1
}
```

- [ ] **Step 4: Ejecutar el test para verlo pasar**

Run: `npm run test -- analytics/series`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/series.ts src/lib/analytics/series.test.ts
git commit -m "feat(analytics): series — holdings as-of, fechas operativas, pesos y retorno por activo"
```

---

## Task 8: `analytics/returns.ts` (TWR + P&L absoluto)

**Files:**
- Create: `src/lib/analytics/returns.ts`
- Test: `src/lib/analytics/returns.test.ts`

- [ ] **Step 1: Escribir los tests de `returns.ts`**

Cubre: retorno diario ponderado; **día de compra entra como peso al día siguiente** (peso 0 al inicio → sin retorno espurio); **split sin workaround da retorno correcto** (adj close); **liquidación total → recompra** sin división por cero; TWR encadenado; normalización a 100; P&L absoluto en raw.

```ts
// src/lib/analytics/returns.test.ts
import { describe, it, expect } from 'vitest'
import { portfolioDailyReturn, timeWeightedReturn, normalizeToBase, absolutePnl } from './returns'

describe('portfolioDailyReturn', () => {
  it('suma ponderada de los retornos de los activos', () => {
    const w = new Map([
      ['AAPL', 0.6],
      ['BTC', 0.4],
    ])
    const r = new Map([
      ['AAPL', 0.1],
      ['BTC', -0.05],
    ])
    expect(portfolioDailyReturn(w, r)).toBeCloseTo(0.6 * 0.1 + 0.4 * -0.05)
  })
  it('ignora activos sin retorno disponible', () => {
    const w = new Map([['AAPL', 1]])
    expect(portfolioDailyReturn(w, new Map())).toBe(0)
  })
  it('el día de compra entra con peso 0 → no genera retorno espurio', () => {
    // Compra el día t: al INICIO de t su peso es 0 (no estaba). Aunque el activo
    // tenga retorno ese día, no contribuye hasta t+1.
    const w = new Map<string, number>() // start-of-day sin holdings todavía
    const r = new Map([['NEW', 0.2]])
    expect(portfolioDailyReturn(w, r)).toBe(0)
  })
  it('liquidación total: pesos vacíos → retorno 0 (nunca divide por valor previo)', () => {
    expect(portfolioDailyReturn(new Map(), new Map([['AAPL', 0.3]]))).toBe(0)
  })
})

describe('timeWeightedReturn', () => {
  it('encadena (1+r) y resta 1', () => {
    expect(timeWeightedReturn([0.1, -0.05, 0.02])).toBeCloseTo(1.1 * 0.95 * 1.02 - 1)
  })
  it('sin retornos → 0', () => {
    expect(timeWeightedReturn([])).toBe(0)
  })
  it('split 2:1 con adjusted close NO distorsiona el TWR (retorno ≈ 0 en el día del split)', () => {
    // Con adj close el split ya está incorporado: el "retorno" del día del split es 0.
    // Encadenar 0s no altera el TWR previo.
    expect(timeWeightedReturn([0.05, 0, 0.03])).toBeCloseTo(1.05 * 1 * 1.03 - 1)
  })
})

describe('normalizeToBase', () => {
  it('produce la serie índice partiendo de 100', () => {
    expect(normalizeToBase([0.1, -0.05], 100)).toEqual([100, 110, 104.5])
  })
  it('con cero retornos devuelve solo el punto base', () => {
    expect(normalizeToBase([], 100)).toEqual([100])
  })
})

describe('absolutePnl', () => {
  it('(V_fin − V_ini) − flujos_netos', () => {
    expect(absolutePnl(1000, 1500, 200)).toBe(300)
  })
  it('para "Todo" (V_ini=0): valor_actual − capital_neto_aportado', () => {
    expect(absolutePnl(0, 1750, 1500)).toBe(250)
  })
})
```

- [ ] **Step 2: Ejecutar el test para verlo fallar**

Run: `npm run test -- analytics/returns`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar `returns.ts`**

```ts
// src/lib/analytics/returns.ts

// Retorno diario del portafolio = Σ wᵢ,ₜ₋₁ × rᵢ,ₜ. Los pesos son start-of-day,
// así que una compra del día entra con peso 0 (no genera retorno espurio) y una
// liquidación total deja pesos vacíos → retorno 0 (nunca se divide por V_{t-1}).
export function portfolioDailyReturn(weights: Map<string, number>, assetReturns: Map<string, number>): number {
  let r = 0
  for (const [ticker, w] of weights) {
    const ri = assetReturns.get(ticker)
    if (ri !== undefined) r += w * ri
  }
  return r
}

// TWR encadenado: Π(1 + r) − 1.
export function timeWeightedReturn(dailyReturns: number[]): number {
  return dailyReturns.reduce((acc, r) => acc * (1 + r), 1) - 1
}

// Serie índice normalizada a `base` (default 100). Devuelve N+1 puntos para N
// retornos: el primer punto es `base`.
export function normalizeToBase(dailyReturns: number[], base = 100): number[] {
  const out: number[] = [base]
  let acc = base
  for (const r of dailyReturns) {
    acc *= 1 + r
    out.push(acc)
  }
  return out
}

// P&L absoluto del período en dólares reales (raw close): dinero ganado/perdido por
// mercado, excluyendo aportaciones/retiros. (V_fin − V_ini) − flujos_netos.
export function absolutePnl(startValue: number, endValue: number, netFlows: number): number {
  return endValue - startValue - netFlows
}
```

- [ ] **Step 4: Ejecutar el test para verlo pasar**

Run: `npm run test -- analytics/returns`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/returns.ts src/lib/analytics/returns.test.ts
git commit -m "feat(analytics): returns — TWR ponderado, normalización y P&L absoluto"
```

---

## Task 9: `analytics/riskMetrics.ts` (volatilidad, Sharpe, drawdown)

**Files:**
- Create: `src/lib/analytics/riskMetrics.ts`
- Test: `src/lib/analytics/riskMetrics.test.ts`

- [ ] **Step 1: Escribir los tests de `riskMetrics.ts`**

```ts
// src/lib/analytics/riskMetrics.test.ts
import { describe, it, expect } from 'vitest'
import { mean, stdDev, volatility, sharpe, maxDrawdown } from './riskMetrics'

describe('mean / stdDev', () => {
  it('media simple', () => {
    expect(mean([1, 2, 3])).toBe(2)
  })
  it('desviación estándar muestral (n-1)', () => {
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2)
  })
  it('stdDev de <2 elementos = 0', () => {
    expect(stdDev([5])).toBe(0)
  })
})

describe('volatility', () => {
  it('anualiza la desviación estándar diaria por √252', () => {
    const r = [0.01, -0.02, 0.015, -0.005, 0.0]
    expect(volatility(r)).toBeCloseTo(stdDev(r) * Math.sqrt(252))
  })
  it('null con menos de 2 retornos', () => {
    expect(volatility([0.01])).toBeNull()
  })
})

describe('sharpe', () => {
  it('se calcula desde retornos diarios y anualiza por √252 (rf=0)', () => {
    const r = [0.01, 0.02, -0.01, 0.005, 0.0]
    const expected = (mean(r) / stdDev(r)) * Math.sqrt(252)
    expect(sharpe(r)).toBeCloseTo(expected)
  })
  it('null si la desviación es 0 (sin variación)', () => {
    expect(sharpe([0.01, 0.01, 0.01])).toBeNull()
  })
  it('null con menos de 2 retornos', () => {
    expect(sharpe([0.01])).toBeNull()
  })
})

describe('maxDrawdown', () => {
  it('mayor caída pico-a-valle como fracción negativa', () => {
    // pico 120 → valle 80 = -0.3333
    expect(maxDrawdown([100, 120, 90, 80, 130])).toBeCloseTo(-1 / 3)
  })
  it('serie monótona creciente → 0', () => {
    expect(maxDrawdown([100, 110, 120])).toBe(0)
  })
  it('null con menos de 2 puntos', () => {
    expect(maxDrawdown([100])).toBeNull()
  })
})
```

- [ ] **Step 2: Ejecutar el test para verlo fallar**

Run: `npm run test -- analytics/riskMetrics`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar `riskMetrics.ts`**

```ts
// src/lib/analytics/riskMetrics.ts

const TRADING_DAYS = 252

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

// Desviación estándar muestral (n-1). 0 si hay menos de 2 datos.
export function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  const variance = xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)
  return Math.sqrt(variance)
}

// Volatilidad anualizada: desv. estándar de los retornos (días hábiles) × √252.
export function volatility(returns: number[]): number | null {
  if (returns.length < 2) return null
  return stdDev(returns) * Math.sqrt(TRADING_DAYS)
}

// Sharpe desde retornos diarios (consistencia dimensional): media(r − rf_diario) /
// desv_std(r) × √252. rf anual por defecto 0.
export function sharpe(returns: number[], rfAnnual = 0): number | null {
  if (returns.length < 2) return null
  const sd = stdDev(returns)
  if (sd === 0) return null
  const dailyRf = rfAnnual / TRADING_DAYS
  return ((mean(returns) - dailyRf) / sd) * Math.sqrt(TRADING_DAYS)
}

// Máximo drawdown sobre una serie índice (mayor caída pico-a-valle). Fracción ≤ 0.
export function maxDrawdown(indexSeries: number[]): number | null {
  if (indexSeries.length < 2) return null
  let peak = indexSeries[0]
  let maxDd = 0
  for (const v of indexSeries) {
    if (v > peak) peak = v
    if (peak > 0) {
      const dd = v / peak - 1
      if (dd < maxDd) maxDd = dd
    }
  }
  return maxDd
}
```

- [ ] **Step 4: Ejecutar el test para verlo pasar**

Run: `npm run test -- analytics/riskMetrics`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/riskMetrics.ts src/lib/analytics/riskMetrics.test.ts
git commit -m "feat(analytics): riskMetrics — volatilidad, Sharpe y max drawdown"
```

---

## Task 10: `analytics/correlation.ts` (Pearson + matriz)

**Files:**
- Create: `src/lib/analytics/correlation.ts`
- Test: `src/lib/analytics/correlation.test.ts`

- [ ] **Step 1: Escribir los tests de `correlation.ts`**

```ts
// src/lib/analytics/correlation.test.ts
import { describe, it, expect } from 'vitest'
import { pearson, correlationMatrix } from './correlation'

describe('pearson', () => {
  it('correlación perfecta positiva = 1', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1)
  })
  it('correlación perfecta negativa = -1', () => {
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1)
  })
  it('null con menos de 2 puntos', () => {
    expect(pearson([1], [2])).toBeNull()
  })
  it('null si una serie no tiene varianza', () => {
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull()
  })
})

describe('correlationMatrix', () => {
  it('diagonal = 1 y simétrica', () => {
    const r = new Map([
      ['AAPL', [0.01, 0.02, -0.01, 0.0]],
      ['BTC', [0.02, 0.01, 0.0, -0.02]],
    ])
    const { tickers, matrix } = correlationMatrix(r)
    expect(tickers).toEqual(['AAPL', 'BTC'])
    expect(matrix[0][0]).toBe(1)
    expect(matrix[1][1]).toBe(1)
    expect(matrix[0][1]).toBeCloseTo(matrix[1][0] as number)
  })
  it('un solo ticker → matriz 1×1', () => {
    const { tickers, matrix } = correlationMatrix(new Map([['AAPL', [0.01, 0.02]]]))
    expect(tickers).toEqual(['AAPL'])
    expect(matrix).toEqual([[1]])
  })
})
```

- [ ] **Step 2: Ejecutar el test para verlo fallar**

Run: `npm run test -- analytics/correlation`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar `correlation.ts`**

```ts
// src/lib/analytics/correlation.ts
import { mean } from './riskMetrics'

// Coeficiente de Pearson sobre dos series ALINEADAS (mismas fechas operativas).
// null si <2 puntos o si alguna serie no tiene varianza.
export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length)
  if (n < 2) return null
  const ma = mean(a.slice(0, n))
  const mb = mean(b.slice(0, n))
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma
    const y = b[i] - mb
    num += x * y
    da += x * x
    db += y * y
  }
  if (da === 0 || db === 0) return null
  return num / Math.sqrt(da * db)
}

// Matriz de correlaciones. Las series de retornos por ticker deben venir ya
// alineadas sobre las MISMAS fechas operativas (el engine se encarga). Diagonal = 1.
export function correlationMatrix(returnsByTicker: Map<string, number[]>): {
  tickers: string[]
  matrix: (number | null)[][]
} {
  const tickers = [...returnsByTicker.keys()]
  const matrix = tickers.map((ti) =>
    tickers.map((tj) => {
      if (ti === tj) return 1
      return pearson(returnsByTicker.get(ti)!, returnsByTicker.get(tj)!)
    })
  )
  return { tickers, matrix }
}
```

- [ ] **Step 4: Ejecutar el test para verlo pasar**

Run: `npm run test -- analytics/correlation`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/correlation.ts src/lib/analytics/correlation.test.ts
git commit -m "feat(analytics): correlation — Pearson y matriz"
```

---

## Task 11: `analytics/perAsset.ts` (retorno por activo)

**Files:**
- Create: `src/lib/analytics/perAsset.ts`
- Test: `src/lib/analytics/perAsset.test.ts`

- [ ] **Step 1: Escribir el test de `perAsset.ts`**

```ts
// src/lib/analytics/perAsset.test.ts
import { describe, it, expect } from 'vitest'
import { perAssetReturns } from './perAsset'
import type { PriceSeriesByTicker } from './types'

const series: PriceSeriesByTicker = new Map([
  [
    'AAPL',
    [
      { date: '2024-01-02', price: 100, adjPrice: 90 },
      { date: '2024-01-05', price: 120, adjPrice: 108 },
    ],
  ],
  [
    'TSLA',
    [{ date: '2024-01-05', price: 200, adjPrice: 200 }], // sin precio al inicio del período
  ],
])

describe('perAssetReturns', () => {
  it('retorno de adjusted close de inicio a fin del período', () => {
    const out = perAssetReturns(['AAPL'], series, '2024-01-02', '2024-01-05')
    expect(out).toEqual([{ ticker: 'AAPL', return: 108 / 90 - 1 }])
  })
  it('null si falta precio al inicio del período', () => {
    const out = perAssetReturns(['TSLA'], series, '2024-01-02', '2024-01-05')
    expect(out).toEqual([{ ticker: 'TSLA', return: null }])
  })
})
```

- [ ] **Step 2: Ejecutar el test para verlo fallar**

Run: `npm run test -- analytics/perAsset`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar `perAsset.ts`**

```ts
// src/lib/analytics/perAsset.ts
import { priceAsOf } from './series'
import type { PriceSeriesByTicker } from './types'

// Retorno de precio (adjusted close) de cada ticker entre el inicio y el fin del
// período. null si falta precio en cualquiera de los dos extremos.
export function perAssetReturns(
  tickers: string[],
  series: PriceSeriesByTicker,
  from: string,
  to: string
): { ticker: string; return: number | null }[] {
  return tickers.map((ticker) => {
    const s = series.get(ticker) ?? []
    const start = priceAsOf(s, from)
    const end = priceAsOf(s, to)
    const ret = start && end && start.adjPrice > 0 ? end.adjPrice / start.adjPrice - 1 : null
    return { ticker, return: ret }
  })
}
```

- [ ] **Step 4: Ejecutar el test para verlo pasar**

Run: `npm run test -- analytics/perAsset`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/perAsset.ts src/lib/analytics/perAsset.test.ts
git commit -m "feat(analytics): perAsset — retorno por activo (adjusted)"
```

---

## Task 12: `analytics/benchmarks.ts` + `analytics/engine.ts` (orquestador)

**Files:**
- Create: `src/lib/analytics/benchmarks.ts`
- Create: `src/lib/analytics/engine.ts`
- Test: `src/lib/analytics/engine.test.ts`

`computeAnalytics` pega todos los módulos puros y produce el `AnalyticsResult`. Es puro: recibe transacciones, las series de precios ya cargadas (usuario + benchmark) y el período; no toca IO.

- [ ] **Step 1: Crear los presets de benchmark**

```ts
// src/lib/analytics/benchmarks.ts
export interface BenchmarkPreset {
  ticker: string
  label: string
  assetType: 'etf' | 'crypto'
}

export const BENCHMARK_PRESETS: BenchmarkPreset[] = [
  { ticker: 'SPY', label: 'S&P 500', assetType: 'etf' },
  { ticker: 'QQQ', label: 'Nasdaq 100', assetType: 'etf' },
  { ticker: 'BTC', label: 'Bitcoin', assetType: 'crypto' },
]

export function benchmarkPreset(ticker: string): BenchmarkPreset | undefined {
  return BENCHMARK_PRESETS.find((b) => b.ticker === ticker.toUpperCase())
}
```

- [ ] **Step 2: Escribir el test de `engine.ts`**

Cubre el camino feliz (serie normalizada a 100, TWR, P&L, benchmark) y el caso sin transacciones.

```ts
// src/lib/analytics/engine.test.ts
import { describe, it, expect } from 'vitest'
import { computeAnalytics } from './engine'
import type { PriceSeriesByTicker } from './types'
import type { Transaction } from '@/lib/portfolio/holdings'

const txs: Transaction[] = [
  { assetId: 'a1', ticker: 'AAPL', side: 'buy', quantity: 10, price: 100, fees: 0, executedAt: '2024-01-02' },
]

const priceSeries: PriceSeriesByTicker = new Map([
  [
    'AAPL',
    [
      { date: '2024-01-02', price: 100, adjPrice: 100 },
      { date: '2024-01-03', price: 110, adjPrice: 110 },
      { date: '2024-01-04', price: 121, adjPrice: 121 },
    ],
  ],
])

const benchmarkSeries = [
  { date: '2024-01-02', price: 400, adjPrice: 400 },
  { date: '2024-01-03', price: 404, adjPrice: 404 },
  { date: '2024-01-04', price: 408, adjPrice: 408 },
]

describe('computeAnalytics', () => {
  it('serie normalizada a 100 y TWR del portafolio (un solo activo = su retorno)', () => {
    const res = computeAnalytics({
      transactions: txs,
      priceSeries,
      benchmarkSeries,
      benchmarkTicker: 'SPY',
      assetTypeByTicker: new Map([['AAPL', 'stock']]),
      period: 'ALL',
      today: '2024-01-04',
    })
    expect(res.series[0]).toEqual({ date: '2024-01-02', portfolio: 100, benchmark: 100 })
    // 100 → 110 → 121 ⇒ índice final 121
    expect(res.series.at(-1)!.portfolio).toBeCloseTo(121)
    expect(res.summary.portfolioTwr).toBeCloseTo(0.21)
    // benchmark 400 → 408 ⇒ +2%
    expect(res.summary.benchmarkTwr).toBeCloseTo(408 / 400 - 1)
    expect(res.series.at(-1)!.benchmark).toBeCloseTo((408 / 400) * 100)
  })

  it('P&L absoluto en raw: valor final − capital aportado (ALL, V_ini=0)', () => {
    const res = computeAnalytics({
      transactions: txs,
      priceSeries,
      benchmarkSeries: null,
      benchmarkTicker: 'SPY',
      assetTypeByTicker: new Map([['AAPL', 'stock']]),
      period: 'ALL',
      today: '2024-01-04',
    })
    // valor final 10×121 = 1210; aportado 10×100 = 1000 ⇒ 210
    expect(res.summary.absolutePnl).toBeCloseTo(210)
    expect(res.summary.benchmarkTwr).toBeNull()
  })

  it('sin transacciones → resultado vacío', () => {
    const res = computeAnalytics({
      transactions: [],
      priceSeries: new Map(),
      benchmarkSeries: null,
      benchmarkTicker: 'SPY',
      assetTypeByTicker: new Map(),
      period: 'ALL',
      today: '2024-01-04',
    })
    expect(res.series).toEqual([])
    expect(res.summary.portfolioTwr).toBeNull()
    expect(res.perAsset).toEqual([])
    expect(res.correlation.tickers).toEqual([])
  })
})
```

- [ ] **Step 3: Ejecutar el test para verlo fallar**

Run: `npm run test -- analytics/engine`
Expected: FAIL (módulo no existe).

- [ ] **Step 4: Implementar `engine.ts`**

```ts
// src/lib/analytics/engine.ts
import { type Transaction } from '@/lib/portfolio/holdings'
import type { AnalyticsResult, Period, PricePointAdj, PriceSeriesByTicker } from './types'
import { periodStartDate } from './dates'
import {
  priceAsOf,
  holdingsAsOf,
  tradingDates,
  portfolioRawValue,
  startOfDayWeights,
  assetReturn,
} from './series'
import { portfolioDailyReturn, timeWeightedReturn, normalizeToBase, absolutePnl } from './returns'
import { volatility, sharpe, maxDrawdown } from './riskMetrics'
import { correlationMatrix } from './correlation'
import { perAssetReturns } from './perAsset'

export interface AnalyticsInput {
  transactions: Transaction[]
  priceSeries: PriceSeriesByTicker
  benchmarkSeries: PricePointAdj[] | null
  benchmarkTicker: string
  assetTypeByTicker: Map<string, string>
  period: Period
  today: string
}

const EMPTY: AnalyticsResult = {
  series: [],
  summary: {
    portfolioTwr: null,
    benchmarkTwr: null,
    absolutePnl: null,
    volatility: null,
    sharpe: null,
    maxDrawdown: null,
  },
  perAsset: [],
  correlation: { tickers: [], matrix: [] },
  benchmarkError: null,
}

// Flujos netos en (from, to]: compras (+, con fees) / ventas (−) en dólares reales.
function netFlows(transactions: Transaction[], from: string, to: string): number {
  let flows = 0
  for (const t of transactions) {
    if (t.executedAt > from && t.executedAt <= to) {
      flows += t.side === 'buy' ? t.quantity * t.price + t.fees : -(t.quantity * t.price)
    }
  }
  return flows
}

export function computeAnalytics(input: AnalyticsInput): AnalyticsResult {
  const { transactions, priceSeries, benchmarkSeries, assetTypeByTicker, period, today } = input
  if (transactions.length === 0) return { ...EMPTY }

  const txDates = transactions.map((t) => t.executedAt).sort()
  const firstTx = txDates[0]
  const start = periodStartDate(period, firstTx, today)

  // Tickers que aparecen en transacciones hasta hoy (incluye los ya vendidos, que
  // contribuyen al chart mientras se tuvieron vía holdingsAsOf por día).
  const allTickers = [...new Set(transactions.filter((t) => t.executedAt <= today).map((t) => t.ticker))]
  const stockEtf = allTickers.filter((t) => {
    const ty = assetTypeByTicker.get(t)
    return ty === 'stock' || ty === 'etf'
  })
  const crypto = allTickers.filter((t) => assetTypeByTicker.get(t) === 'crypto')

  const dates = tradingDates(priceSeries, stockEtf, crypto, start, today)
  if (dates.length < 2) return { ...EMPTY }

  // Retornos diarios del portafolio: Σ wᵢ,ₜ₋₁ × rᵢ,ₜ entre fechas operativas consecutivas.
  const dailyReturns: number[] = []
  for (let i = 1; i < dates.length; i++) {
    const prevDate = dates[i - 1]
    const date = dates[i]
    const weights = startOfDayWeights(holdingsAsOf(transactions, prevDate), priceSeries, prevDate)
    const assetReturns = new Map<string, number>()
    for (const ticker of weights.keys()) {
      const r = assetReturn(priceSeries, ticker, prevDate, date)
      if (r !== null) assetReturns.set(ticker, r)
    }
    dailyReturns.push(portfolioDailyReturn(weights, assetReturns))
  }

  const portfolioIndex = normalizeToBase(dailyReturns, 100) // length === dates.length

  // Benchmark normalizado a 100 al inicio del período (TWR = retorno de adj close).
  let benchmarkTwr: number | null = null
  let benchmarkIndex: (number | null)[] | null = null
  if (benchmarkSeries && benchmarkSeries.length > 0) {
    const startP = priceAsOf(benchmarkSeries, dates[0])
    if (startP && startP.adjPrice > 0) {
      const base = startP.adjPrice
      benchmarkIndex = dates.map((d) => {
        const p = priceAsOf(benchmarkSeries, d)
        return p ? (p.adjPrice / base) * 100 : null
      })
      const endP = priceAsOf(benchmarkSeries, dates[dates.length - 1])
      if (endP) benchmarkTwr = endP.adjPrice / base - 1
    }
  }

  const series = dates.map((date, i) => ({
    date,
    portfolio: round2(portfolioIndex[i]),
    benchmark: benchmarkIndex ? roundOrNull(benchmarkIndex[i]) : null,
  }))

  // P&L absoluto en raw close.
  const startValue = portfolioRawValue(holdingsAsOf(transactions, start), priceSeries, start)
  const endValue = portfolioRawValue(holdingsAsOf(transactions, today), priceSeries, today)
  const pnl = absolutePnl(startValue, endValue, netFlows(transactions, start, today))

  // Métricas de riesgo sobre los retornos diarios (días operativos).
  const vol = volatility(dailyReturns)
  const shp = sharpe(dailyReturns)
  const mdd = maxDrawdown(portfolioIndex)

  // Tickers actualmente mantenidos: para retorno por activo y correlación.
  const heldTickers = holdingsAsOf(transactions, today).map((h) => h.ticker)

  // Correlación: intersección de fechas operativas con precio real para TODOS los
  // tickers mantenidos (evita arrays desalineados). Retornos entre fechas consecutivas.
  const correlation = buildCorrelation(heldTickers, priceSeries, dates)

  return {
    series,
    summary: {
      portfolioTwr: timeWeightedReturn(dailyReturns),
      benchmarkTwr,
      absolutePnl: pnl,
      volatility: vol,
      sharpe: shp,
      maxDrawdown: mdd,
    },
    perAsset: perAssetReturns(heldTickers, priceSeries, start, today),
    correlation,
    benchmarkError: null,
  }
}

function buildCorrelation(
  tickers: string[],
  priceSeries: PriceSeriesByTicker,
  dates: string[]
): { tickers: string[]; matrix: (number | null)[][] } {
  if (tickers.length < 2) return { tickers, matrix: tickers.length === 1 ? [[1]] : [] }
  // Fechas donde TODOS los tickers tienen precio real as-of (intersección).
  const usable = dates.filter((d) => tickers.every((t) => priceAsOf(priceSeries.get(t) ?? [], d) !== null))
  const returnsByTicker = new Map<string, number[]>()
  for (const t of tickers) {
    const rets: number[] = []
    for (let i = 1; i < usable.length; i++) {
      const prev = priceAsOf(priceSeries.get(t) ?? [], usable[i - 1])!
      const cur = priceAsOf(priceSeries.get(t) ?? [], usable[i])!
      rets.push(prev.adjPrice > 0 ? cur.adjPrice / prev.adjPrice - 1 : 0)
    }
    returnsByTicker.set(t, rets)
  }
  return correlationMatrix(returnsByTicker)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
function roundOrNull(n: number | null): number | null {
  return n === null ? null : round2(n)
}
```

- [ ] **Step 5: Ejecutar el test para verlo pasar**

Run: `npm run test -- analytics/engine`
Expected: PASS.

- [ ] **Step 6: Verificar la suite pura completa**

Run: `npm run test`
Expected: todos los tests (Fase 1, 2 y 3) PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/analytics/benchmarks.ts src/lib/analytics/engine.ts src/lib/analytics/engine.test.ts
git commit -m "feat(analytics): engine — orquestador puro computeAnalytics + presets de benchmark"
```

---

## Task 13: API `GET /api/analytics`

**Files:**
- Create: `src/app/api/analytics/route.ts`

Sin test unitario (convención del proyecto: Route Handlers se validan con `lint`/`build`/e2e manual). Carga IO y delega en `computeAnalytics`. Auto-gestiona el histórico del benchmark con los adaptadores de Fase 2; error aislado → `benchmarkError`.

- [ ] **Step 1: Implementar el Route Handler**

```ts
// src/app/api/analytics/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { defaultFetcher } from '@/lib/market-data/http'
import { createYahooAdapter } from '@/lib/market-data/yahoo'
import { createCoinGeckoAdapter } from '@/lib/market-data/coingecko'
import { createAlphaVantageAdapter } from '@/lib/market-data/alpha-vantage'
import { backfillHistory, type AssetRef } from '@/lib/market-data/refresh'
import { isoYearsAgo } from '@/lib/market-data/dates'
import { computeAnalytics } from '@/lib/analytics/engine'
import { benchmarkPreset } from '@/lib/analytics/benchmarks'
import type { Period, PricePointAdj, PriceSeriesByTicker } from '@/lib/analytics/types'
import type { Transaction } from '@/lib/portfolio/holdings'

const PERIODS: Period[] = ['1W', '1M', '3M', '1Y', 'ALL']

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const period: Period = PERIODS.includes(searchParams.get('period') as Period)
    ? (searchParams.get('period') as Period)
    : '1Y'
  const benchmarkTicker = (searchParams.get('benchmark') ?? 'SPY').toUpperCase()
  const preset = benchmarkPreset(benchmarkTicker)

  // Transacciones + tipos de activo del usuario.
  const { data: txRows, error: txErr } = await supabase
    .from('transactions')
    .select('asset_id, side, quantity, price, fees, executed_at, assets(ticker, asset_type)')
  if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 })

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const transactions: Transaction[] = (txRows ?? []).map((row: any) => ({
    assetId: row.asset_id,
    ticker: row.assets?.ticker ?? '',
    side: row.side,
    quantity: Number(row.quantity),
    price: Number(row.price),
    fees: Number(row.fees),
    executedAt: row.executed_at,
  }))
  const assetTypeByTicker = new Map<string, string>()
  for (const row of (txRows ?? []) as any[]) {
    if (row.assets?.ticker) assetTypeByTicker.set(row.assets.ticker, row.assets.asset_type)
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const userTickers = [...assetTypeByTicker.keys()]
  const today = new Date().toISOString().slice(0, 10)

  // Auto-gestión del benchmark: descargar su histórico si falta.
  let benchmarkError: string | null = null
  if (preset) {
    try {
      const benchCount = await countBenchmarkRows(supabase, benchmarkTicker)
      if (benchCount < 2) {
        await downloadBenchmark(supabase, preset.ticker, preset.assetType)
      }
    } catch (e) {
      benchmarkError = e instanceof Error ? e.message : 'benchmark no disponible'
    }
  } else {
    benchmarkError = `benchmark "${benchmarkTicker}" no reconocido`
  }

  // Cargar price_cache de los tickers del usuario + el benchmark.
  const wantedTickers = [...new Set([...userTickers, benchmarkTicker])]
  const priceSeries: PriceSeriesByTicker = new Map()
  let benchmarkSeries: PricePointAdj[] | null = null
  if (wantedTickers.length > 0) {
    const { data: priceRows, error: pErr } = await supabase
      .from('price_cache')
      .select('ticker, price, adj_price, price_date')
      .in('ticker', wantedTickers)
      .order('price_date', { ascending: true })
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })

    const byTicker = new Map<string, PricePointAdj[]>()
    for (const row of priceRows ?? []) {
      const arr = byTicker.get(row.ticker) ?? []
      const price = Number(row.price)
      arr.push({
        date: row.price_date,
        price,
        adjPrice: row.adj_price != null ? Number(row.adj_price) : price, // coalesce
      })
      byTicker.set(row.ticker, arr)
    }
    for (const t of userTickers) priceSeries.set(t, byTicker.get(t) ?? [])
    benchmarkSeries = byTicker.get(benchmarkTicker) ?? null
  }

  const result = computeAnalytics({
    transactions,
    priceSeries,
    benchmarkSeries,
    benchmarkTicker,
    assetTypeByTicker,
    period,
    today,
  })

  return NextResponse.json({ ...result, benchmarkError: benchmarkError ?? result.benchmarkError })
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function countBenchmarkRows(supabase: any, ticker: string): Promise<number> {
  const { count, error } = await supabase
    .from('price_cache')
    .select('id', { count: 'exact', head: true })
    .eq('ticker', ticker)
  if (error) throw new Error(error.message)
  return count ?? 0
}

async function downloadBenchmark(supabase: any, ticker: string, assetType: 'etf' | 'crypto') {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY
  const adapters = {
    yahoo: createYahooAdapter(defaultFetcher),
    coingecko: createCoinGeckoAdapter(defaultFetcher),
    alphaVantage: apiKey ? createAlphaVantageAdapter(defaultFetcher, apiKey) : undefined,
  }
  const ref: AssetRef = { ticker, asset_type: assetType }
  const { rows, results } = await backfillHistory([ref], isoYearsAgo(5), adapters)
  const failed = results.find((r) => !r.ok)
  if (rows.length === 0 && failed) throw new Error(failed.error ?? 'no se pudo descargar el benchmark')
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500).map((r) => ({
      ticker: r.ticker,
      price: r.price,
      adj_price: r.adjPrice,
      price_date: r.date,
      source: r.source,
    }))
    const { error } = await supabase.from('price_cache').upsert(batch, { onConflict: 'ticker,price_date,source' })
    if (error) throw new Error(error.message)
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
```

- [ ] **Step 2: Verificar lint + build**

Run: `npm run lint && npm run build`
Expected: sin errores; la ruta `/api/analytics` compila.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/analytics/route.ts
git commit -m "feat(api): GET /api/analytics — motor de retornos + auto-gestión de benchmark"
```

---

## Task 14: Hook `use-prefs.ts` (período + benchmark en localStorage)

**Files:**
- Create: `src/lib/hooks/use-prefs.ts`

Sin test unitario (hook de cliente sobre localStorage; se valida con e2e manual). Preferencia compartida entre dashboard y `/analytics`: al navegar entre páginas cada una remonta y lee el valor actual de localStorage → quedan sincronizadas. Se añade además un listener de `storage` para sincronizar entre pestañas.

- [ ] **Step 1: Implementar el hook**

```ts
// src/lib/hooks/use-prefs.ts
'use client'

import { useEffect, useState } from 'react'
import type { Period } from '@/lib/analytics/types'

const PERIOD_KEY = 'pa.period'
const BENCHMARK_KEY = 'pa.benchmark'

function usePref(key: string, fallback: string): [string, (v: string) => void] {
  const [value, setValue] = useState<string>(fallback)

  useEffect(() => {
    const stored = window.localStorage.getItem(key)
    if (stored) setValue(stored)
    const onStorage = (e: StorageEvent) => {
      if (e.key === key && e.newValue) setValue(e.newValue)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [key])

  const update = (v: string) => {
    setValue(v)
    window.localStorage.setItem(key, v)
  }
  return [value, update]
}

export function usePeriod(): [Period, (p: Period) => void] {
  const [value, set] = usePref(PERIOD_KEY, '1Y')
  return [value as Period, set as (p: Period) => void]
}

export function useBenchmark(): [string, (b: string) => void] {
  return usePref(BENCHMARK_KEY, 'SPY')
}
```

- [ ] **Step 2: Verificar lint + build**

Run: `npm run lint && npm run build`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/lib/hooks/use-prefs.ts
git commit -m "feat(ui): use-prefs — período y benchmark en localStorage (sincronizado)"
```

---

## Task 15: Componentes `PeriodSelector` y `BenchmarkSelector`

**Files:**
- Create: `src/components/period-selector.tsx`
- Create: `src/components/benchmark-selector.tsx`

Presentacionales (value + onChange). Sin test unitario.

- [ ] **Step 1: Implementar `PeriodSelector`**

```tsx
// src/components/period-selector.tsx
'use client'

import type { Period } from '@/lib/analytics/types'

const OPTIONS: { value: Period; label: string }[] = [
  { value: '1W', label: '1S' },
  { value: '1M', label: '1M' },
  { value: '3M', label: '3M' },
  { value: '1Y', label: '1A' },
  { value: 'ALL', label: 'Todo' },
]

export function PeriodSelector({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-800 bg-slate-900 p-1">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded px-3 py-1 text-sm font-medium transition ${
            value === o.value ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Implementar `BenchmarkSelector`**

```tsx
// src/components/benchmark-selector.tsx
'use client'

import { BENCHMARK_PRESETS } from '@/lib/analytics/benchmarks'

export function BenchmarkSelector({ value, onChange }: { value: string; onChange: (b: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-200"
    >
      {BENCHMARK_PRESETS.map((b) => (
        <option key={b.ticker} value={b.ticker}>
          {b.label} ({b.ticker})
        </option>
      ))}
    </select>
  )
}
```

- [ ] **Step 3: Verificar lint + build**

Run: `npm run lint && npm run build`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/components/period-selector.tsx src/components/benchmark-selector.tsx
git commit -m "feat(ui): PeriodSelector y BenchmarkSelector"
```

---

## Task 16: Sección "Rendimiento" en el dashboard

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Añadir tipos, estado y fetch de analytics**

En `src/app/(app)/dashboard/page.tsx`, añadir imports al inicio (junto a los existentes de recharts):

```tsx
import { LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts'
import { PeriodSelector } from '@/components/period-selector'
import { usePeriod, useBenchmark } from '@/lib/hooks/use-prefs'
```

(Conserva el import existente `import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'`.)

Añadir una interfaz para los puntos de la serie, encima del componente:

```tsx
interface SeriesPoint {
  date: string
  portfolio: number
  benchmark: number | null
}
```

Dentro de `DashboardPage`, añadir estado y efecto (debajo del `useEffect` de `/api/positions`):

```tsx
  const [period, setPeriod] = usePeriod()
  const [benchmark] = useBenchmark()
  const [series, setSeries] = useState<SeriesPoint[]>([])

  useEffect(() => {
    fetch(`/api/analytics?period=${period}&benchmark=${benchmark}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setSeries(data.series as SeriesPoint[])
      })
  }, [period, benchmark])
```

- [ ] **Step 2: Reemplazar el placeholder por la sección de rendimiento**

Quitar el `<p>` final (el placeholder de Fase 3):

```tsx
      <p className="text-xs text-slate-600">
        La gráfica de rendimiento histórico y el selector de período llegan en la Fase 3 (requieren snapshots de la Fase 2).
      </p>
```

y reemplazarlo por:

```tsx
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-200">Rendimiento</h2>
          <PeriodSelector value={period} onChange={setPeriod} />
        </div>
        {series.length < 2 ? (
          <p className="py-10 text-center text-sm text-slate-500">
            Registra transacciones y corre el backfill de históricos en{' '}
            <a href="/data-sources" className="text-blue-400 underline">
              Fuentes de datos
            </a>{' '}
            para ver el rendimiento.
          </p>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} minTickGap={40} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} domain={['auto', 'auto']} />
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', color: '#e2e8f0' }}
                />
                <Legend />
                <Line type="monotone" dataKey="portfolio" name="Portafolio" stroke="#3b82f6" dot={false} />
                <Line type="monotone" dataKey="benchmark" name="Benchmark" stroke="#22c55e" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
```

- [ ] **Step 3: Verificar lint + build**

Run: `npm run lint && npm run build`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/dashboard/page.tsx"
git commit -m "feat(ui): dashboard — sección Rendimiento con selector de período y gráfica"
```

---

## Task 17: Página `/analytics` completa

**Files:**
- Modify: `src/app/(app)/analytics/page.tsx`

- [ ] **Step 1: Implementar la página completa**

Reemplazar **todo** el contenido de `src/app/(app)/analytics/page.tsx`:

```tsx
// src/app/(app)/analytics/page.tsx
'use client'

import { useEffect, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { PeriodSelector } from '@/components/period-selector'
import { BenchmarkSelector } from '@/components/benchmark-selector'
import { usePeriod, useBenchmark } from '@/lib/hooks/use-prefs'

interface AnalyticsData {
  series: { date: string; portfolio: number; benchmark: number | null }[]
  summary: {
    portfolioTwr: number | null
    benchmarkTwr: number | null
    absolutePnl: number | null
    volatility: number | null
    sharpe: number | null
    maxDrawdown: number | null
  }
  perAsset: { ticker: string; return: number | null }[]
  correlation: { tickers: string[]; matrix: (number | null)[][] }
  benchmarkError: string | null
}

const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(1)}%`)
const usd = (n: number | null) =>
  n === null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const num = (n: number | null) => (n === null ? '—' : n.toFixed(2))

function MetricCard({ label, value, accent }: { label: string; value: string; accent?: 'up' | 'down' }) {
  const color = accent === 'up' ? 'text-green-400' : accent === 'down' ? 'text-red-400' : 'text-slate-100'
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-bold ${color}`}>{value}</div>
    </div>
  )
}

// Verde = se mueven juntos (+1), rojo = opuestos (−1).
function corrColor(v: number | null): string {
  if (v === null) return 'bg-slate-800 text-slate-500'
  if (v >= 0) return `text-white`
  return `text-white`
}
function corrStyle(v: number | null): React.CSSProperties {
  if (v === null) return {}
  // interpola rojo(−1) → gris(0) → verde(+1)
  const g = v > 0 ? Math.round(120 * v) : 0
  const r = v < 0 ? Math.round(120 * -v) : 0
  return { backgroundColor: `rgb(${30 + r}, ${30 + g}, 40)` }
}

export default function AnalyticsPage() {
  const [period, setPeriod] = usePeriod()
  const [benchmark, setBenchmark] = useBenchmark()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/analytics?period=${period}&benchmark=${benchmark}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setData(d)
        setLoading(false)
      })
  }, [period, benchmark])

  const s = data?.summary
  const hasSeries = (data?.series.length ?? 0) >= 2

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-100">Analítica</h1>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodSelector value={period} onChange={setPeriod} />
          <BenchmarkSelector value={benchmark} onChange={setBenchmark} />
        </div>
      </div>

      {data?.benchmarkError && (
        <p className="rounded border border-amber-900 bg-amber-950 px-3 py-2 text-sm text-amber-300">
          Benchmark no disponible: {data.benchmarkError}
        </p>
      )}

      {loading && <p className="text-sm text-slate-500">Calculando…</p>}

      {!loading && !hasSeries && (
        <p className="py-10 text-center text-sm text-slate-500">
          No hay suficientes datos. Registra transacciones y corre el backfill de históricos en{' '}
          <a href="/data-sources" className="text-blue-400 underline">
            Fuentes de datos
          </a>
          .
        </p>
      )}

      {!loading && hasSeries && data && s && (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <MetricCard
              label="Retorno (TWR)"
              value={pct(s.portfolioTwr)}
              accent={s.portfolioTwr === null ? undefined : s.portfolioTwr >= 0 ? 'up' : 'down'}
            />
            <MetricCard label="Benchmark (TWR)" value={pct(s.benchmarkTwr)} />
            <MetricCard
              label="P&L del período"
              value={usd(s.absolutePnl)}
              accent={s.absolutePnl === null ? undefined : s.absolutePnl >= 0 ? 'up' : 'down'}
            />
            <MetricCard label="Volatilidad" value={pct(s.volatility)} />
            <MetricCard label="Sharpe" value={num(s.sharpe)} />
            <MetricCard
              label="Máx. drawdown"
              value={pct(s.maxDrawdown)}
              accent={s.maxDrawdown === null ? undefined : 'down'}
            />
          </section>

          <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-3 text-lg font-semibold text-slate-200">Rendimiento vs benchmark</h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} minTickGap={40} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', color: '#e2e8f0' }} />
                  <Legend />
                  <Line type="monotone" dataKey="portfolio" name="Portafolio" stroke="#3b82f6" dot={false} />
                  <Line type="monotone" dataKey="benchmark" name="Benchmark" stroke="#22c55e" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <h2 className="mb-3 text-lg font-semibold text-slate-200">Retorno por activo</h2>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-xs uppercase text-slate-500">
                    <th className="py-2">Ticker</th>
                    <th className="text-right">Retorno</th>
                  </tr>
                </thead>
                <tbody>
                  {data.perAsset.map((a) => (
                    <tr key={a.ticker} className="border-b border-slate-900">
                      <td className="py-2 font-semibold">{a.ticker}</td>
                      <td
                        className={`text-right ${
                          a.return === null ? 'text-slate-500' : a.return >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}
                      >
                        {pct(a.return)}
                      </td>
                    </tr>
                  ))}
                  {data.perAsset.length === 0 && (
                    <tr>
                      <td colSpan={2} className="py-4 text-slate-500">
                        Sin posiciones abiertas.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>

            <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <h2 className="mb-3 text-lg font-semibold text-slate-200">Correlaciones</h2>
              {data.correlation.tickers.length < 2 ? (
                <p className="py-6 text-center text-sm text-slate-500">
                  Se necesitan al menos 2 activos para la matriz de correlaciones.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="text-sm">
                    <thead>
                      <tr>
                        <th className="p-2"></th>
                        {data.correlation.tickers.map((t) => (
                          <th key={t} className="p-2 text-xs text-slate-400">
                            {t}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.correlation.matrix.map((row, i) => (
                        <tr key={data.correlation.tickers[i]}>
                          <td className="p-2 text-xs font-semibold text-slate-400">
                            {data.correlation.tickers[i]}
                          </td>
                          {row.map((v, j) => (
                            <td
                              key={j}
                              className={`p-2 text-center text-xs ${corrColor(v)}`}
                              style={corrStyle(v)}
                            >
                              {v === null ? '—' : v.toFixed(2)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verificar lint + build**

Run: `npm run lint && npm run build`
Expected: sin errores. Si lint se queja del import `React` para `React.CSSProperties`, cambiar el tipo a `import { type CSSProperties } from 'react'` y usar `CSSProperties`.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/analytics/page.tsx"
git commit -m "feat(ui): página /analytics completa — métricas, gráfica, retorno por activo y correlaciones"
```

---

## Task 18: ROADMAP + verificación final + e2e manual

**Files:**
- Modify: `docs/superpowers/plans/ROADMAP.md`

- [ ] **Step 1: Marcar Fase 3 en el ROADMAP**

En `docs/superpowers/plans/ROADMAP.md`, en la fila de la Fase 3, sustituir `_(pendiente)_` por el enlace al plan y cambiar el estado a **Implementada**:

```markdown
| 3 | [2026-06-16-fase-3-analytics-engine.md](2026-06-16-fase-3-analytics-engine.md) | Analytics Engine: retornos (TWR), benchmarks, correlaciones, página `/analytics`, gráfica de rendimiento en dashboard + selector de período global (1S · 1M · 3M · 1A · Todo) | **Implementada** |
```

- [ ] **Step 2: Verificación completa de la suite + lint + build**

Run: `npm run test && npm run lint && npm run build`
Expected: todos los tests PASS, lint limpio, build OK.

- [ ] **Step 3: Verificación e2e manual (checklist)**

Levantar el dev server: `npm run dev` (webpack). Con sesión iniciada y datos de Fase 1/2 cargados (activo AAPL + transacción + backfill corrido):

- [ ] `/dashboard` muestra la sección "Rendimiento" con la gráfica portafolio vs benchmark normalizada a 100; el selector de período cambia la curva.
- [ ] Cambiar el período en el dashboard y navegar a `/analytics`: el selector aparece con el **mismo** período (sincronización vía localStorage).
- [ ] `/analytics` muestra: tarjetas (TWR, Benchmark TWR, P&L del período, Volatilidad, Sharpe, Máx. drawdown), gráfica grande, tabla de retorno por activo y matriz de correlaciones (o aviso si <2 activos).
- [ ] Cambiar el benchmark a Nasdaq 100 / Bitcoin: la curva del benchmark se redibuja; la primera vez puede tardar (auto-descarga). Si una fuente falla, aparece la nota "Benchmark no disponible" y el portafolio se sigue dibujando.
- [ ] Sin transacciones / sin backfill: ambas vistas muestran el estado vacío con enlace a `/data-sources`.

- [ ] **Step 4: Commit final**

```bash
git add docs/superpowers/plans/ROADMAP.md
git commit -m "docs(roadmap): Fase 3 Analytics Engine implementada"
```

---

## Self-Review (cobertura de la spec)

- **Decisión 0 (raw/adjusted):** Task 1 (migración `adj_price`), Tasks 2–5 (adaptadores + orquestador + route handlers escriben ambas series), engine coalesce `adj_price ?? price`. ✅
- **Decisión 1 (reconstrucción por retornos; snapshots superados):** Task 12 `computeAnalytics` reconstruye desde retornos de constituyentes; no se cargan snapshots (documentado). Rango ≥ primera transacción vía `periodStartDate`. ✅
- **Decisión 2 (TWR + P&L absoluto):** Tasks 7–8 (`startOfDayWeights`, `assetReturn`, `portfolioDailyReturn`, `timeWeightedReturn`, `absolutePnl`); tests del día de compra con peso 0, split sin workaround, liquidación→recompra. MWR fuera de alcance. ✅
- **Decisión 3 (benchmark presets + motor agnóstico + auto-descarga + localStorage):** Tasks 12–15 (`benchmarks.ts`, parámetro `?benchmark=`, `downloadBenchmark`, `useBenchmark`). ✅
- **Decisión 4 (métricas; días hábiles; Sharpe desde retornos diarios; correlación sin asincronía):** Tasks 9–10 + `tradingDates` (Task 7) + `buildCorrelation` (intersección de fechas reales). ✅
- **Decisión 5 (selector global sincronizado; afecta dashboard chart + todas las métricas de /analytics, no las KPI cards):** Tasks 14, 16, 17. ✅
- **Contrato del API:** Task 13 produce `series` / `summary` / `perAsset` / `correlation` / `benchmarkError`; un solo endpoint sirve al dashboard (solo usa `series`). ✅
- **Casos borde:** sin transacciones (Task 12), sin histórico (estado vacío UI Tasks 16/17), <2 activos (correlación Task 12/17), benchmark falla (Task 13), forward-fill para la línea / sin forward-fill para distribución (`tradingDates` + `buildCorrelation`), liquidación→recompra (Task 8), guardas numéricas (null en vol/Sharpe/drawdown/correlación). ✅
- **Fuera de alcance:** MWR/IRR, corporate actions, ticker libre, mejor/peor día, partir el endpoint — no se implementan. ✅
