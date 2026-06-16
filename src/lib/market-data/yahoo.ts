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
