# Fase 2 — Market Data Service · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Obtener precios (actuales y ~5 años de histórico) desde APIs externas hacia `price_cache`, registrar el snapshot diario del valor del portafolio, y mostrar estado por fuente en `/data-sources` — todo on-demand y sin `service_role`.

**Architecture:** Adaptadores por fuente (Yahoo/CoinGecko/Alpha Vantage) con interfaz común y **parseo puro** testeable; un orquestador `refresh` con aislamiento de errores por fuente; una función pura `computeSnapshotValue` que reusa el dominio de Fase 1; y Route Handlers autenticados finos que cargan datos, llaman a la lógica pura y hacen upsert idempotente. La red se aísla en un *fetcher* inyectable para mockear en tests.

**Tech Stack:** Next.js 16 (App Router, Route Handlers), Supabase JS (`@supabase/ssr`), Zod, Vitest. Sin dependencias nuevas.

**Spec:** [docs/superpowers/specs/2026-06-15-fase-2-market-data-service-design.md](../specs/2026-06-15-fase-2-market-data-service-design.md)

---

## File Structure

**Crear:**
- `src/lib/market-data/types.ts` — interfaces (`MarketDataAdapter`, `Quote`, `PricePoint`, `SourceResult`, `JsonFetcher`).
- `src/lib/market-data/http.ts` — fetcher JSON por defecto (única IO de red real).
- `src/lib/market-data/dates.ts` — helpers de fecha (`unixToISODate`, `msToISODate`, `isoYearsAgo`).
- `src/lib/market-data/yahoo.ts` — adaptador acciones/ETF (+ `parseYahooChart` puro).
- `src/lib/market-data/coingecko.ts` — adaptador crypto (+ mapa ticker→id, `parseSimplePrice`, `parseMarketChart`).
- `src/lib/market-data/alpha-vantage.ts` — respaldo histórico de acciones (+ `parseAlphaDaily`).
- `src/lib/market-data/resolver.ts` — `adapterForQuotes(assetType)`.
- `src/lib/market-data/refresh.ts` — `refreshQuotes`, `backfillHistory` (orquestación con inyección de adaptadores).
- `src/lib/portfolio/snapshot.ts` — `computeSnapshotValue`.
- `src/app/api/prices/refresh/route.ts` — `POST` refresco actual + snapshot.
- `src/app/api/prices/backfill/route.ts` — `POST` backfill 5 años.
- `src/app/api/prices/status/route.ts` — `GET` estado por fuente (derivado de `price_cache`).
- Tests `*.test.ts` junto a cada módulo de `src/lib/`.

**Modificar:**
- `src/app/(app)/data-sources/page.tsx` — tarjetas de estado vivas + botones "Actualizar precios" y "Backfill históricos".
- `.env.example` — añadir `ALPHA_VANTAGE_API_KEY` (opcional).
- `docs/superpowers/plans/ROADMAP.md` — marcar Fase 2 como planificada/implementada.

**Nota de diseño (precisión sobre la spec):** el endpoint de cotización múltiple de Yahoo (`v7/finance/quote`) hoy exige un *crumb*/cookie. Para evitar esa fragilidad, Yahoo se consulta **por símbolo** vía el endpoint `chart` (una llamada por ticker que devuelve tanto el precio actual como el histórico). A escala personal (pocos tickers, 1×/día) es holgado. CoinGecko **sí** agrupa varios ids en una llamada.

---

## Task 1: Tipos, fetcher y helpers de fecha

**Files:**
- Create: `src/lib/market-data/types.ts`
- Create: `src/lib/market-data/http.ts`
- Create: `src/lib/market-data/dates.ts`
- Test: `src/lib/market-data/dates.test.ts`

- [ ] **Step 1: Escribir los tipos**

`src/lib/market-data/types.ts`:
```ts
// Precio de un ticker en una fecha concreta (YYYY-MM-DD, UTC).
export interface PricePoint {
  date: string
  price: number
}

// Cotización actual normalizada.
export interface Quote {
  ticker: string
  price: number
  date: string // YYYY-MM-DD
}

// Resultado por fuente tras un refresco/backfill (para la UI de estado).
export interface SourceResult {
  source: string
  ok: boolean
  count: number // nº de precios obtenidos
  error?: string
}

export interface MarketDataAdapter {
  id: string
  supports(assetType: string): boolean
  fetchQuotes(tickers: string[]): Promise<Quote[]>
  fetchHistory(ticker: string, fromISO: string): Promise<PricePoint[]>
}

// IO de red aislada: recibe URL, devuelve JSON parseado. Inyectable en tests.
export type JsonFetcher = (url: string) => Promise<unknown>
```

- [ ] **Step 2: Escribir el fetcher por defecto**

`src/lib/market-data/http.ts`:
```ts
import type { JsonFetcher } from './types'

// Único punto de red real. Un User-Agent de navegador evita bloqueos de Yahoo.
export const defaultFetcher: JsonFetcher = async (url) => {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (portfolio-app)' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} al pedir ${new URL(url).host}`)
  return res.json()
}
```

- [ ] **Step 3: Escribir el test de helpers de fecha (falla)**

`src/lib/market-data/dates.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { unixToISODate, msToISODate, isoYearsAgo } from './dates'

describe('date helpers', () => {
  it('convierte segundos unix a YYYY-MM-DD (UTC)', () => {
    expect(unixToISODate(1704153600)).toBe('2024-01-02') // 2024-01-02T00:00:00Z
  })
  it('convierte milisegundos a YYYY-MM-DD (UTC)', () => {
    expect(msToISODate(1704153600000)).toBe('2024-01-02')
  })
  it('resta años respecto a una fecha base', () => {
    expect(isoYearsAgo(5, new Date('2026-06-15T00:00:00Z'))).toBe('2021-06-15')
  })
})
```

- [ ] **Step 4: Ejecutar el test y verificar que falla**

Run: `npm test -- dates`
Expected: FAIL ("unixToISODate is not a function" / módulo no encontrado).

- [ ] **Step 5: Implementar los helpers**

`src/lib/market-data/dates.ts`:
```ts
export function unixToISODate(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

export function msToISODate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function isoYearsAgo(years: number, base: Date = new Date()): string {
  const d = new Date(base)
  d.setUTCFullYear(d.getUTCFullYear() - years)
  return d.toISOString().slice(0, 10)
}
```

- [ ] **Step 6: Ejecutar el test y verificar que pasa**

Run: `npm test -- dates`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/lib/market-data/types.ts src/lib/market-data/http.ts src/lib/market-data/dates.ts src/lib/market-data/dates.test.ts
git commit -m "feat(market-data): tipos, fetcher inyectable y helpers de fecha"
```

---

## Task 2: Adaptador Yahoo Finance (acciones/ETF)

**Files:**
- Create: `src/lib/market-data/yahoo.ts`
- Test: `src/lib/market-data/yahoo.test.ts`

- [ ] **Step 1: Escribir el test del parser (falla)**

`src/lib/market-data/yahoo.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseYahooChart, createYahooAdapter } from './yahoo'

const sample = {
  chart: {
    error: null,
    result: [
      {
        meta: { symbol: 'AAPL', regularMarketPrice: 175.5, regularMarketTime: 1718409600 },
        timestamp: [1704153600, 1704240000],
        indicators: { quote: [{ close: [185.1, null] }] },
      },
    ],
  },
}

describe('parseYahooChart', () => {
  it('extrae precio actual e histórico, saltando closes nulos', () => {
    const out = parseYahooChart(sample)
    expect(out.ticker).toBe('AAPL')
    expect(out.current).toEqual({ date: '2024-06-15', price: 175.5 })
    expect(out.history).toEqual([{ date: '2024-01-02', price: 185.1 }])
  })

  it('lanza con mensaje si la respuesta es de error', () => {
    expect(() => parseYahooChart({ chart: { result: null, error: { description: 'Not Found' } } })).toThrow(
      'Not Found'
    )
  })
})

describe('createYahooAdapter', () => {
  it('soporta stock y etf, no crypto', () => {
    const a = createYahooAdapter(async () => sample)
    expect(a.supports('stock')).toBe(true)
    expect(a.supports('etf')).toBe(true)
    expect(a.supports('crypto')).toBe(false)
  })

  it('fetchQuotes devuelve una cotización por ticker usando el fetcher inyectado', async () => {
    const a = createYahooAdapter(async () => sample)
    const quotes = await a.fetchQuotes(['AAPL'])
    expect(quotes).toEqual([{ ticker: 'AAPL', price: 175.5, date: '2024-06-15' }])
  })

  it('fetchHistory devuelve los puntos históricos', async () => {
    const a = createYahooAdapter(async () => sample)
    const hist = await a.fetchHistory('AAPL', '2021-06-15')
    expect(hist).toEqual([{ date: '2024-01-02', price: 185.1 }])
  })
})
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `npm test -- yahoo`
Expected: FAIL (módulo no encontrado).

- [ ] **Step 3: Implementar el adaptador**

`src/lib/market-data/yahoo.ts`:
```ts
import type { JsonFetcher, MarketDataAdapter, PricePoint, Quote } from './types'
import { unixToISODate } from './dates'

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart'

interface YahooParsed {
  ticker: string
  current: PricePoint | null
  history: PricePoint[]
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseYahooChart(json: any): YahooParsed {
  const result = json?.chart?.result?.[0]
  if (!result) {
    throw new Error(json?.chart?.error?.description ?? 'respuesta de Yahoo inválida')
  }
  const ticker: string = result.meta?.symbol ?? ''
  const timestamps: number[] = result.timestamp ?? []
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? []

  const history: PricePoint[] = []
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i]
    if (typeof c !== 'number') continue
    history.push({ date: unixToISODate(timestamps[i]), price: c })
  }

  const metaPrice = result.meta?.regularMarketPrice
  const current: PricePoint | null =
    typeof metaPrice === 'number'
      ? { date: unixToISODate(result.meta?.regularMarketTime ?? timestamps[timestamps.length - 1]), price: metaPrice }
      : history.at(-1) ?? null

  return { ticker, current, history }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function createYahooAdapter(fetcher: JsonFetcher): MarketDataAdapter {
  async function chart(ticker: string, range: string): Promise<YahooParsed> {
    const url = `${BASE}/${encodeURIComponent(ticker)}?range=${range}&interval=1d`
    return parseYahooChart(await fetcher(url))
  }

  return {
    id: 'yahoo',
    supports: (t) => t === 'stock' || t === 'etf',
    async fetchQuotes(tickers) {
      const out: Quote[] = []
      for (const t of tickers) {
        const { current } = await chart(t, '1d')
        if (current) out.push({ ticker: t, price: current.price, date: current.date })
      }
      return out
    },
    async fetchHistory(ticker) {
      const { history } = await chart(ticker, '5y')
      return history
    },
  }
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `npm test -- yahoo`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/market-data/yahoo.ts src/lib/market-data/yahoo.test.ts
git commit -m "feat(market-data): adaptador Yahoo Finance (acciones/ETF)"
```

---

## Task 3: Adaptador CoinGecko (crypto)

**Files:**
- Create: `src/lib/market-data/coingecko.ts`
- Test: `src/lib/market-data/coingecko.test.ts`

- [ ] **Step 1: Escribir el test (falla)**

`src/lib/market-data/coingecko.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { resolveCoinId, parseSimplePrice, parseMarketChart, createCoinGeckoAdapter } from './coingecko'

describe('resolveCoinId', () => {
  it('mapea tickers conocidos (case-insensitive)', () => {
    expect(resolveCoinId('btc')).toBe('bitcoin')
    expect(resolveCoinId('ETH')).toBe('ethereum')
  })
  it('devuelve null para tickers desconocidos', () => {
    expect(resolveCoinId('FOOBAR')).toBeNull()
  })
})

describe('parseSimplePrice', () => {
  it('mapea id→precio de vuelta a ticker con la fecha dada', () => {
    const json = { bitcoin: { usd: 60000 }, ethereum: { usd: 3000 } }
    const out = parseSimplePrice(json, [['BTC', 'bitcoin'], ['ETH', 'ethereum']], '2026-06-15')
    expect(out).toEqual([
      { ticker: 'BTC', price: 60000, date: '2026-06-15' },
      { ticker: 'ETH', price: 3000, date: '2026-06-15' },
    ])
  })
})

describe('parseMarketChart', () => {
  it('deduplica por día quedándose con el último precio del día', () => {
    const json = { prices: [[1704153600000, 42000], [1704196800000, 42500], [1704240000000, 44000]] }
    const out = parseMarketChart(json)
    expect(out).toEqual([
      { date: '2024-01-02', price: 42500 },
      { date: '2024-01-03', price: 44000 },
    ])
  })
  it('lanza si no hay array de precios', () => {
    expect(() => parseMarketChart({ status: { error_message: 'rate limit' } })).toThrow('rate limit')
  })
})

describe('createCoinGeckoAdapter', () => {
  it('soporta crypto y reporta error claro para ticker sin id', async () => {
    const a = createCoinGeckoAdapter(async () => ({}))
    expect(a.supports('crypto')).toBe(true)
    await expect(a.fetchHistory('FOOBAR', '2025-06-15')).rejects.toThrow(/CoinGecko/)
  })
})
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `npm test -- coingecko`
Expected: FAIL.

- [ ] **Step 3: Implementar el adaptador**

`src/lib/market-data/coingecko.ts`:
```ts
import type { JsonFetcher, MarketDataAdapter, PricePoint, Quote } from './types'
import { msToISODate } from './dates'

const BASE = 'https://api.coingecko.com/api/v3'
// El plan gratuito limita el histórico a ~365 días.
const FREE_HISTORY_DAYS = 365

// CoinGecko usa ids (bitcoin), no tickers (BTC). Mapa curado de los más comunes.
// Tickers no presentes reportan un error claro pidiendo añadirlos aquí.
const COIN_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  ADA: 'cardano',
  XRP: 'ripple',
  DOGE: 'dogecoin',
  DOT: 'polkadot',
  MATIC: 'matic-network',
  LTC: 'litecoin',
  BNB: 'binancecoin',
  AVAX: 'avalanche-2',
  LINK: 'chainlink',
  USDT: 'tether',
  USDC: 'usd-coin',
}

export function resolveCoinId(ticker: string): string | null {
  return COIN_IDS[ticker.toUpperCase()] ?? null
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseSimplePrice(
  json: any,
  pairs: [string, string][], // [ticker, id]
  date: string
): Quote[] {
  const out: Quote[] = []
  for (const [ticker, id] of pairs) {
    const usd = json?.[id]?.usd
    if (typeof usd === 'number') out.push({ ticker, price: usd, date })
  }
  return out
}

export function parseMarketChart(json: any): PricePoint[] {
  const prices = json?.prices
  if (!Array.isArray(prices)) {
    throw new Error(json?.status?.error_message ?? 'respuesta de CoinGecko inválida')
  }
  const byDate = new Map<string, number>()
  for (const [ms, price] of prices) byDate.set(msToISODate(ms), price)
  return [...byDate].map(([date, price]) => ({ date, price }))
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function createCoinGeckoAdapter(fetcher: JsonFetcher): MarketDataAdapter {
  return {
    id: 'coingecko',
    supports: (t) => t === 'crypto',
    async fetchQuotes(tickers) {
      const pairs: [string, string][] = []
      for (const t of tickers) {
        const id = resolveCoinId(t)
        if (id) pairs.push([t, id])
      }
      if (pairs.length === 0) return []
      const ids = pairs.map(([, id]) => id).join(',')
      const url = `${BASE}/simple/price?ids=${ids}&vs_currencies=usd`
      const today = new Date().toISOString().slice(0, 10)
      return parseSimplePrice(await fetcher(url), pairs, today)
    },
    async fetchHistory(ticker) {
      const id = resolveCoinId(ticker)
      if (!id) throw new Error(`CoinGecko: id desconocido para "${ticker}" (añádelo al mapa COIN_IDS)`)
      const url = `${BASE}/coins/${id}/market_chart?vs_currency=usd&days=${FREE_HISTORY_DAYS}&interval=daily`
      return parseMarketChart(await fetcher(url))
    },
  }
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `npm test -- coingecko`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/market-data/coingecko.ts src/lib/market-data/coingecko.test.ts
git commit -m "feat(market-data): adaptador CoinGecko (crypto, histórico 1 año)"
```

---

## Task 4: Adaptador Alpha Vantage (respaldo histórico de acciones)

**Files:**
- Create: `src/lib/market-data/alpha-vantage.ts`
- Test: `src/lib/market-data/alpha-vantage.test.ts`

- [ ] **Step 1: Escribir el test (falla)**

`src/lib/market-data/alpha-vantage.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseAlphaDaily, createAlphaVantageAdapter } from './alpha-vantage'

const sample = {
  'Time Series (Daily)': {
    '2024-01-03': { '4. close': '185.30' },
    '2024-01-02': { '4. close': '185.10' },
  },
}

describe('parseAlphaDaily', () => {
  it('mapea la serie a PricePoint[] ordenado ascendente', () => {
    expect(parseAlphaDaily(sample)).toEqual([
      { date: '2024-01-02', price: 185.1 },
      { date: '2024-01-03', price: 185.3 },
    ])
  })
  it('lanza al detectar el aviso de límite', () => {
    expect(() => parseAlphaDaily({ Note: 'rate limit 25/day' })).toThrow(/límite/)
    expect(() => parseAlphaDaily({ Information: 'premium endpoint' })).toThrow(/límite/)
  })
})

describe('createAlphaVantageAdapter', () => {
  it('sin API key, fetchHistory lanza pidiendo configurarla', async () => {
    const a = createAlphaVantageAdapter(async () => sample, undefined)
    await expect(a.fetchHistory('AAPL', '2021-06-15')).rejects.toThrow(/API key/)
  })
  it('con API key, devuelve el histórico parseado', async () => {
    const a = createAlphaVantageAdapter(async () => sample, 'KEY')
    expect(await a.fetchHistory('AAPL', '2021-06-15')).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `npm test -- alpha-vantage`
Expected: FAIL.

- [ ] **Step 3: Implementar el adaptador**

`src/lib/market-data/alpha-vantage.ts`:
```ts
import type { JsonFetcher, MarketDataAdapter, PricePoint, Quote } from './types'

const BASE = 'https://www.alphavantage.co/query'

/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseAlphaDaily(json: any): PricePoint[] {
  if (json?.Note || json?.Information) {
    throw new Error('límite de Alpha Vantage alcanzado (25/día en plan gratuito)')
  }
  const series = json?.['Time Series (Daily)']
  if (!series) throw new Error(json?.['Error Message'] ?? 'respuesta de Alpha Vantage inválida')
  return Object.entries(series)
    .map(([date, v]: [string, any]) => ({ date, price: Number(v['4. close']) }))
    .sort((a, b) => a.date.localeCompare(b.date))
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Solo respaldo de históricos de acciones/ETF; nunca cotización actual.
export function createAlphaVantageAdapter(
  fetcher: JsonFetcher,
  apiKey: string | undefined
): MarketDataAdapter {
  return {
    id: 'alpha-vantage',
    supports: (t) => t === 'stock' || t === 'etf',
    async fetchQuotes(): Promise<Quote[]> {
      return [] // no se usa para cotización actual
    },
    async fetchHistory(ticker) {
      if (!apiKey) throw new Error('Alpha Vantage sin API key configurada')
      const url = `${BASE}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(
        ticker
      )}&outputsize=full&apikey=${apiKey}`
      return parseAlphaDaily(await fetcher(url))
    },
  }
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `npm test -- alpha-vantage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/market-data/alpha-vantage.ts src/lib/market-data/alpha-vantage.test.ts
git commit -m "feat(market-data): adaptador Alpha Vantage (respaldo histórico)"
```

---

## Task 5: Resolver de fuente por tipo de activo

**Files:**
- Create: `src/lib/market-data/resolver.ts`
- Test: `src/lib/market-data/resolver.test.ts`

- [ ] **Step 1: Escribir el test (falla)**

`src/lib/market-data/resolver.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { quoteSourceFor } from './resolver'

describe('quoteSourceFor', () => {
  it('acciones/ETF → yahoo, crypto → coingecko', () => {
    expect(quoteSourceFor('stock')).toBe('yahoo')
    expect(quoteSourceFor('etf')).toBe('yahoo')
    expect(quoteSourceFor('crypto')).toBe('coingecko')
  })
  it('cash/other → null (sin cotización de mercado)', () => {
    expect(quoteSourceFor('cash')).toBeNull()
    expect(quoteSourceFor('other')).toBeNull()
  })
})
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `npm test -- resolver`
Expected: FAIL.

- [ ] **Step 3: Implementar el resolver**

`src/lib/market-data/resolver.ts`:
```ts
export type QuoteSource = 'yahoo' | 'coingecko'

export function quoteSourceFor(assetType: string): QuoteSource | null {
  if (assetType === 'stock' || assetType === 'etf') return 'yahoo'
  if (assetType === 'crypto') return 'coingecko'
  return null
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `npm test -- resolver`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/market-data/resolver.ts src/lib/market-data/resolver.test.ts
git commit -m "feat(market-data): resolver de fuente por tipo de activo"
```

---

## Task 6: Orquestador `refresh` (cotizaciones + backfill, con aislamiento por fuente)

**Files:**
- Create: `src/lib/market-data/refresh.ts`
- Test: `src/lib/market-data/refresh.test.ts`

- [ ] **Step 1: Escribir el test (falla)**

`src/lib/market-data/refresh.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { refreshQuotes, backfillHistory } from './refresh'
import type { MarketDataAdapter } from './types'

const okYahoo: MarketDataAdapter = {
  id: 'yahoo',
  supports: (t) => t === 'stock' || t === 'etf',
  fetchQuotes: async (ts) => ts.map((t) => ({ ticker: t, price: 100, date: '2026-06-15' })),
  fetchHistory: async (t) => [{ date: '2021-06-15', price: 90 }],
}
const failingCoin: MarketDataAdapter = {
  id: 'coingecko',
  supports: (t) => t === 'crypto',
  fetchQuotes: async () => {
    throw new Error('coingecko caído')
  },
  fetchHistory: async () => {
    throw new Error('coingecko caído')
  },
}

const assets = [
  { ticker: 'AAPL', asset_type: 'stock' },
  { ticker: 'BTC', asset_type: 'crypto' },
]

describe('refreshQuotes', () => {
  it('agrega cotizaciones OK y aísla la fuente caída', async () => {
    const { quotes, results } = await refreshQuotes(assets, {
      yahoo: okYahoo,
      coingecko: failingCoin,
    })
    expect(quotes).toEqual([{ ticker: 'AAPL', price: 100, date: '2026-06-15' }])
    expect(results).toContainEqual({ source: 'yahoo', ok: true, count: 1 })
    expect(results).toContainEqual(
      expect.objectContaining({ source: 'coingecko', ok: false, error: 'coingecko caído' })
    )
  })

  it('ignora activos sin fuente de mercado (cash)', async () => {
    const { quotes } = await refreshQuotes([{ ticker: 'USD', asset_type: 'cash' }], {
      yahoo: okYahoo,
      coingecko: failingCoin,
    })
    expect(quotes).toEqual([])
  })
})

describe('backfillHistory', () => {
  it('devuelve filas {ticker,date,price,source} por activo', async () => {
    const { rows, results } = await backfillHistory(
      [{ ticker: 'AAPL', asset_type: 'stock' }],
      '2021-06-15',
      { yahoo: okYahoo, coingecko: failingCoin, alphaVantage: undefined }
    )
    expect(rows).toEqual([{ ticker: 'AAPL', date: '2021-06-15', price: 90, source: 'yahoo' }])
    expect(results).toContainEqual({ source: 'yahoo', ok: true, count: 1 })
  })

  it('usa Alpha Vantage cuando Yahoo falla y hay key', async () => {
    const failingYahoo: MarketDataAdapter = {
      ...okYahoo,
      fetchHistory: async () => {
        throw new Error('yahoo caído')
      },
    }
    const alpha: MarketDataAdapter = {
      id: 'alpha-vantage',
      supports: (t) => t === 'stock' || t === 'etf',
      fetchQuotes: async () => [],
      fetchHistory: async () => [{ date: '2021-06-15', price: 88 }],
    }
    const { rows } = await backfillHistory([{ ticker: 'AAPL', asset_type: 'stock' }], '2021-06-15', {
      yahoo: failingYahoo,
      coingecko: failingCoin,
      alphaVantage: alpha,
    })
    expect(rows).toEqual([{ ticker: 'AAPL', date: '2021-06-15', price: 88, source: 'alpha-vantage' }])
  })
})
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `npm test -- refresh`
Expected: FAIL.

- [ ] **Step 3: Implementar el orquestador**

`src/lib/market-data/refresh.ts`:
```ts
import type { MarketDataAdapter, Quote, SourceResult } from './types'
import { quoteSourceFor } from './resolver'

export interface AssetRef {
  ticker: string
  asset_type: string
}

export interface PriceRow {
  ticker: string
  date: string
  price: number
  source: string
}

interface QuoteAdapters {
  yahoo: MarketDataAdapter
  coingecko: MarketDataAdapter
}

// Refresca la cotización de hoy agrupando por fuente. Una fuente caída
// no rompe a las demás: se reporta en SourceResult.
export async function refreshQuotes(
  assets: AssetRef[],
  adapters: QuoteAdapters
): Promise<{ quotes: Quote[]; results: SourceResult[] }> {
  const groups: Record<'yahoo' | 'coingecko', string[]> = { yahoo: [], coingecko: [] }
  for (const a of assets) {
    const src = quoteSourceFor(a.asset_type)
    if (src) groups[src].push(a.ticker)
  }

  const quotes: Quote[] = []
  const results: SourceResult[] = []

  for (const src of ['yahoo', 'coingecko'] as const) {
    const tickers = groups[src]
    if (tickers.length === 0) continue
    try {
      const got = await adapters[src].fetchQuotes(tickers)
      quotes.push(...got)
      results.push({ source: src, ok: true, count: got.length })
    } catch (e) {
      results.push({ source: src, ok: false, count: 0, error: errorMessage(e) })
    }
  }

  return { quotes, results }
}

interface HistoryAdapters extends QuoteAdapters {
  alphaVantage: MarketDataAdapter | undefined
}

// Backfill de históricos por activo. Para acciones/ETF, si Yahoo falla y hay
// Alpha Vantage configurado, se reintenta con AV.
export async function backfillHistory(
  assets: AssetRef[],
  fromISO: string,
  adapters: HistoryAdapters
): Promise<{ rows: PriceRow[]; results: SourceResult[] }> {
  const rows: PriceRow[] = []
  const perSource = new Map<string, { ok: boolean; count: number; error?: string }>()

  const record = (source: string, ok: boolean, count: number, error?: string) => {
    const prev = perSource.get(source) ?? { ok: true, count: 0 }
    perSource.set(source, {
      ok: prev.ok && ok,
      count: prev.count + count,
      error: error ?? prev.error,
    })
  }

  for (const a of assets) {
    const src = quoteSourceFor(a.asset_type)
    if (!src) continue
    try {
      const points = await adapters[src].fetchHistory(a.ticker, fromISO)
      rows.push(...points.map((p) => ({ ticker: a.ticker, date: p.date, price: p.price, source: src })))
      record(src, true, points.length)
    } catch (e) {
      // Respaldo Alpha Vantage solo para acciones/ETF con key configurada.
      if (src === 'yahoo' && adapters.alphaVantage) {
        try {
          const points = await adapters.alphaVantage.fetchHistory(a.ticker, fromISO)
          rows.push(
            ...points.map((p) => ({ ticker: a.ticker, date: p.date, price: p.price, source: 'alpha-vantage' }))
          )
          record('alpha-vantage', true, points.length)
          continue
        } catch (e2) {
          record('alpha-vantage', false, 0, errorMessage(e2))
        }
      }
      record(src, false, 0, errorMessage(e))
    }
  }

  const results: SourceResult[] = [...perSource].map(([source, v]) => ({ source, ...v }))
  return { rows, results }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `npm test -- refresh`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/market-data/refresh.ts src/lib/market-data/refresh.test.ts
git commit -m "feat(market-data): orquestador refreshQuotes/backfillHistory con aislamiento por fuente"
```

---

## Task 7: Función pura de snapshot

**Files:**
- Create: `src/lib/portfolio/snapshot.ts`
- Test: `src/lib/portfolio/snapshot.test.ts`

- [ ] **Step 1: Escribir el test (falla)**

`src/lib/portfolio/snapshot.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { computeSnapshotValue } from './snapshot'
import type { Transaction } from './holdings'

const txs: Transaction[] = [
  { assetId: 'a1', ticker: 'AAPL', side: 'buy', quantity: 10, price: 150, fees: 0, executedAt: '2026-06-10' },
]

describe('computeSnapshotValue', () => {
  it('valor total = cantidad × precio actual', () => {
    expect(computeSnapshotValue(txs, [{ ticker: 'AAPL', price: 175 }])).toBe(1750)
  })
  it('un ticker sin precio aporta 0 al valor', () => {
    expect(computeSnapshotValue(txs, [])).toBe(0)
  })
})
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `npm test -- snapshot`
Expected: FAIL.

- [ ] **Step 3: Implementar la función**

`src/lib/portfolio/snapshot.ts`:
```ts
import { computeHoldings, type Transaction } from './holdings'
import { valuePositions, portfolioTotals, type Quote } from './valuation'

// Valor total del portafolio dado un conjunto de cotizaciones. Reusa el dominio
// de Fase 1; devuelve el número que se guarda en snapshots.total_value.
export function computeSnapshotValue(transactions: Transaction[], quotes: Quote[]): number {
  const holdings = computeHoldings(transactions)
  const positions = valuePositions(holdings, quotes)
  return portfolioTotals(positions).totalValue
}
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `npm test -- snapshot`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/portfolio/snapshot.ts src/lib/portfolio/snapshot.test.ts
git commit -m "feat(portfolio): computeSnapshotValue (valor total del portafolio)"
```

---

## Task 8: Route Handler `POST /api/prices/refresh`

**Files:**
- Create: `src/app/api/prices/refresh/route.ts`

**Nota:** siguiendo el patrón de Fase 1, los Route Handlers no se testean con unit tests (la lógica pura ya está cubierta); se verifican con build + e2e manual.

- [ ] **Step 1: Implementar el handler**

`src/app/api/prices/refresh/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { defaultFetcher } from '@/lib/market-data/http'
import { createYahooAdapter } from '@/lib/market-data/yahoo'
import { createCoinGeckoAdapter } from '@/lib/market-data/coingecko'
import { refreshQuotes, type AssetRef } from '@/lib/market-data/refresh'
import { computeHoldings, type Transaction } from '@/lib/portfolio/holdings'
import { computeSnapshotValue } from '@/lib/portfolio/snapshot'

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: assets, error: aErr } = await supabase.from('assets').select('ticker, asset_type')
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 })

  const adapters = {
    yahoo: createYahooAdapter(defaultFetcher),
    coingecko: createCoinGeckoAdapter(defaultFetcher),
  }
  const { quotes, results } = await refreshQuotes((assets ?? []) as AssetRef[], adapters)

  // Upsert de cada cotización de hoy en price_cache (idempotente por la unique).
  if (quotes.length > 0) {
    const rows = quotes.map((q) => ({
      ticker: q.ticker,
      price: q.price,
      price_date: q.date,
      source: sourceOf(q.ticker, assets ?? []),
    }))
    const { error: upErr } = await supabase
      .from('price_cache')
      .upsert(rows, { onConflict: 'ticker,price_date,source' })
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  // Snapshot de hoy (idempotente por unique(user_id, snapshot_date)).
  const snapshotValue = await takeSnapshot(supabase, user.id, quotes)

  return NextResponse.json({ results, quotes: quotes.length, snapshotValue })
}

// Determina la fuente (yahoo/coingecko) según el tipo del activo del ticker.
/* eslint-disable @typescript-eslint/no-explicit-any */
function sourceOf(ticker: string, assets: any[]): string {
  const a = assets.find((x) => x.ticker === ticker)
  return a?.asset_type === 'crypto' ? 'coingecko' : 'yahoo'
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* eslint-disable @typescript-eslint/no-explicit-any */
async function takeSnapshot(supabase: any, userId: string, quotes: { ticker: string; price: number }[]) {
  const { data: txRows, error } = await supabase
    .from('transactions')
    .select('asset_id, side, quantity, price, fees, executed_at, assets(ticker)')
  if (error) return null
  const transactions: Transaction[] = (txRows ?? []).map((row: any) => ({
    assetId: row.asset_id,
    ticker: row.assets?.ticker ?? '',
    side: row.side,
    quantity: Number(row.quantity),
    price: Number(row.price),
    fees: Number(row.fees),
    executedAt: row.executed_at,
  }))
  if (computeHoldings(transactions).length === 0) return null
  const totalValue = computeSnapshotValue(transactions, quotes)
  const today = new Date().toISOString().slice(0, 10)
  await supabase
    .from('snapshots')
    .upsert(
      { user_id: userId, snapshot_date: today, total_value: totalValue },
      { onConflict: 'user_id,snapshot_date' }
    )
  return totalValue
}
/* eslint-enable @typescript-eslint/no-explicit-any */
```

- [ ] **Step 2: Verificar build y lint**

Run: `npm run lint && npm run build`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/prices/refresh/route.ts
git commit -m "feat(api): POST /api/prices/refresh — cotización actual + snapshot del día"
```

---

## Task 9: Route Handler `POST /api/prices/backfill`

**Files:**
- Create: `src/app/api/prices/backfill/route.ts`

- [ ] **Step 1: Implementar el handler**

`src/app/api/prices/backfill/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { defaultFetcher } from '@/lib/market-data/http'
import { createYahooAdapter } from '@/lib/market-data/yahoo'
import { createCoinGeckoAdapter } from '@/lib/market-data/coingecko'
import { createAlphaVantageAdapter } from '@/lib/market-data/alpha-vantage'
import { backfillHistory, type AssetRef } from '@/lib/market-data/refresh'
import { isoYearsAgo } from '@/lib/market-data/dates'

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: assets, error: aErr } = await supabase.from('assets').select('ticker, asset_type')
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 })

  const apiKey = process.env.ALPHA_VANTAGE_API_KEY
  const adapters = {
    yahoo: createYahooAdapter(defaultFetcher),
    coingecko: createCoinGeckoAdapter(defaultFetcher),
    alphaVantage: apiKey ? createAlphaVantageAdapter(defaultFetcher, apiKey) : undefined,
  }

  const fromISO = isoYearsAgo(5)
  const { rows, results } = await backfillHistory((assets ?? []) as AssetRef[], fromISO, adapters)

  // Upsert por lotes (idempotente). Lotes de 500 para no exceder límites de payload.
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500).map((r) => ({
      ticker: r.ticker,
      price: r.price,
      price_date: r.date,
      source: r.source,
    }))
    const { error: upErr } = await supabase
      .from('price_cache')
      .upsert(batch, { onConflict: 'ticker,price_date,source' })
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  return NextResponse.json({ results, inserted: rows.length })
}
```

- [ ] **Step 2: Verificar build y lint**

Run: `npm run lint && npm run build`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/prices/backfill/route.ts
git commit -m "feat(api): POST /api/prices/backfill — históricos 5 años (idempotente)"
```

---

## Task 10: Route Handler `GET /api/prices/status`

**Files:**
- Create: `src/app/api/prices/status/route.ts`

- [ ] **Step 1: Implementar el handler**

`src/app/api/prices/status/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Estado por fuente derivado de price_cache: última fecha y nº de tickers distintos.
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase.from('price_cache').select('ticker, price_date, source')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const bySource = new Map<string, { lastDate: string; tickers: Set<string> }>()
  for (const row of data ?? []) {
    const s = bySource.get(row.source) ?? { lastDate: '', tickers: new Set<string>() }
    if (row.price_date > s.lastDate) s.lastDate = row.price_date
    s.tickers.add(row.ticker)
    bySource.set(row.source, s)
  }

  const status = [...bySource].map(([source, v]) => ({
    source,
    lastDate: v.lastDate,
    tickerCount: v.tickers.size,
  }))
  return NextResponse.json(status)
}
```

- [ ] **Step 2: Verificar build y lint**

Run: `npm run lint && npm run build`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/prices/status/route.ts
git commit -m "feat(api): GET /api/prices/status — estado por fuente derivado de price_cache"
```

---

## Task 11: UI de `/data-sources` con estado vivo y botones

**Files:**
- Modify: `src/app/(app)/data-sources/page.tsx`

- [ ] **Step 1: Reemplazar el componente por la versión con estado y acciones**

Reemplazar el contenido completo de `src/app/(app)/data-sources/page.tsx` por:
```tsx
// src/app/(app)/data-sources/page.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'

interface PriceRow {
  id: string
  ticker: string
  price: number
  price_date: string
  source: string
}
interface SourceStatus {
  source: string
  lastDate: string
  tickerCount: number
}
interface RefreshResult {
  source: string
  ok: boolean
  count: number
  error?: string
}

const inputCls =
  'rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200'
const btnCls =
  'rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50'

const apiSources = [
  { id: 'yahoo', name: 'Yahoo Finance', note: 'Acciones y ETFs' },
  { id: 'coingecko', name: 'CoinGecko', note: 'Criptomonedas — histórico 1 año (plan gratuito)' },
  { id: 'alpha-vantage', name: 'Alpha Vantage', note: 'Respaldo histórico (clave opcional)' },
]

export default function DataSourcesPage() {
  const [prices, setPrices] = useState<PriceRow[]>([])
  const [status, setStatus] = useState<SourceStatus[]>([])
  const [results, setResults] = useState<RefreshResult[]>([])
  const [busy, setBusy] = useState<null | 'refresh' | 'backfill'>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [pRes, sRes] = await Promise.all([fetch('/api/prices'), fetch('/api/prices/status')])
    if (pRes.ok) pRes.json().then(setPrices)
    if (sRes.ok) sRes.json().then(setStatus)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function run(action: 'refresh' | 'backfill') {
    setBusy(action)
    setError(null)
    setResults([])
    const res = await fetch(`/api/prices/${action}`, { method: 'POST' })
    setBusy(null)
    if (!res.ok) {
      setError('La operación falló (revisa la consola del servidor)')
      return
    }
    const data = await res.json()
    setResults(data.results ?? [])
    await load()
  }

  function statusFor(id: string) {
    return status.find((s) => s.source === id)
  }
  function resultFor(id: string) {
    return results.find((r) => r.source === id)
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-slate-100">Fuentes de datos</h1>

      <div className="flex flex-wrap gap-2">
        <button className={btnCls} disabled={busy !== null} onClick={() => run('refresh')}>
          {busy === 'refresh' ? 'Actualizando…' : 'Actualizar precios'}
        </button>
        <button className={btnCls} disabled={busy !== null} onClick={() => run('backfill')}>
          {busy === 'backfill' ? 'Descargando históricos…' : 'Backfill históricos (5 años)'}
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {apiSources.map((s) => {
          const st = statusFor(s.id)
          const rs = resultFor(s.id)
          const badge = rs
            ? rs.ok
              ? { text: 'OK', cls: 'bg-green-900 text-green-300' }
              : { text: 'ERROR', cls: 'bg-red-900 text-red-300' }
            : st
              ? { text: 'OK', cls: 'bg-green-900 text-green-300' }
              : { text: 'Sin datos', cls: 'bg-slate-800 text-slate-500' }
          return (
            <div key={s.id} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">{s.name}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${badge.cls}`}>{badge.text}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">{s.note}</p>
              {st && (
                <p className="mt-2 text-xs text-slate-400">
                  {st.tickerCount} tickers · última: {st.lastDate}
                </p>
              )}
              {rs?.error && <p className="mt-1 text-xs text-red-400">{rs.error}</p>}
            </div>
          )
        })}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-200">Entrada manual de precios</h2>
        <form
          className="mb-4 flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            setError(null)
            const form = e.currentTarget
            const fd = new FormData(form)
            const res = await fetch('/api/prices', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ticker: fd.get('ticker'),
                price: fd.get('price'),
                priceDate: fd.get('priceDate'),
              }),
            })
            if (!res.ok) {
              setError('No se pudo guardar el precio (revisa los campos)')
              return
            }
            form.reset()
            await load()
          }}
        >
          <input name="ticker" placeholder="Ticker (AAPL)" required className={inputCls} />
          <input name="price" type="number" step="any" min="0" placeholder="Precio" required className={inputCls} />
          <input name="priceDate" type="date" required className={inputCls} />
          <button type="submit" className={btnCls}>
            Guardar precio
          </button>
        </form>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-xs uppercase text-slate-500">
              <th className="py-2">Ticker</th>
              <th className="text-right">Precio</th>
              <th>Fecha</th>
              <th>Fuente</th>
            </tr>
          </thead>
          <tbody>
            {prices.map((p) => (
              <tr key={p.id} className="border-b border-slate-900">
                <td className="py-2 font-semibold">{p.ticker}</td>
                <td className="text-right">{Number(p.price).toLocaleString()}</td>
                <td>{p.price_date}</td>
                <td className="text-slate-500">{p.source}</td>
              </tr>
            ))}
            {prices.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-slate-500">
                  Sin precios cacheados todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Verificar lint y build**

Run: `npm run lint && npm run build`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/data-sources/page.tsx"
git commit -m "feat(ui): /data-sources con estado por fuente y botones de refresco/backfill"
```

---

## Task 12: Configuración, verificación e2e y roadmap

**Files:**
- Modify: `.env.example`
- Modify: `docs/superpowers/plans/ROADMAP.md`

- [ ] **Step 1: Añadir la clave opcional a `.env.example`**

Añadir al final de `.env.example`:
```bash
# Opcional — respaldo de históricos de acciones (clave gratuita en alphavantage.co).
# Si falta, esa fuente aparece como "Sin datos" y se omite.
ALPHA_VANTAGE_API_KEY=
```

- [ ] **Step 2: Verificación completa**

Run: `npm run lint && npm run build && npm test`
Expected: lint OK, build OK, todos los tests Vitest en verde (los de Fase 1 + los nuevos de market-data y snapshot).

- [ ] **Step 3: Verificación e2e manual**

Con `npm run dev` corriendo y sesión iniciada:
1. En **Portafolio**, asegúrate de tener un activo `stock` (ej. `AAPL`) y uno `crypto` (ej. `BTC`) con alguna transacción.
2. En **Fuentes de datos**, pulsa **"Actualizar precios"** → las tarjetas Yahoo y CoinGecko muestran **OK** con nº de tickers y fecha de hoy; el Dashboard refleja el valor con precios reales (sin entrada manual).
3. Pulsa **"Backfill históricos (5 años)"** → `inserted` > 0; la tabla de precios muestra filas con `source` = `yahoo`/`coingecko`.
4. Vuelve a pulsar backfill → no se duplican filas (idempotente).
5. Si un ticker crypto no está en el mapa (ej. uno raro), la tarjeta CoinGecko muestra **ERROR** con el mensaje, pero Yahoo sigue **OK** (aislamiento).

- [ ] **Step 4: Actualizar el roadmap**

En `docs/superpowers/plans/ROADMAP.md`, fila de la Fase 2: cambiar el enlace `_(pendiente)_` por `[2026-06-15-fase-2-market-data-service.md](2026-06-15-fase-2-market-data-service.md)` y el estado a **Implementada**.

- [ ] **Step 5: Commit**

```bash
git add .env.example docs/superpowers/plans/ROADMAP.md
git commit -m "chore(market-data): env de Alpha Vantage y roadmap Fase 2 implementada"
```

---

## Notas de implementación

- **Sin `service_role`:** todos los handlers usan `createClient()` (sesión autenticada). RLS cubre los upserts a `price_cache`/`snapshots` (políticas de Fase 1).
- **Idempotencia:** `price_cache` tiene `unique(ticker, price_date, source)` y `snapshots` `unique(user_id, snapshot_date)`; todos los writes son upsert con `onConflict`, así que reintentar es seguro.
- **Crypto histórico:** capado a ~1 año por el plan gratuito de CoinGecko (documentado en la UI). Es esperado, no un bug.
- **Cron-ready:** `refreshQuotes`, `backfillHistory` y `computeSnapshotValue` son puras; un futuro `POST /api/cron/snapshot` protegido por `CRON_SECRET` las reutiliza sin cambios.
- **Tickers crypto:** CoinGecko usa ids (`bitcoin`), no símbolos (`BTC`). El mapa `COIN_IDS` cubre los comunes; añadir uno nuevo es una línea. Un ticker sin id reporta ERROR claro en su tarjeta.
