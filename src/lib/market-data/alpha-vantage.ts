import type { JsonFetcher, MarketDataAdapter, PricePoint, QuotesResult } from './types'

const BASE = 'https://www.alphavantage.co/query'

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

// Solo respaldo de históricos de acciones/ETF; nunca cotización actual.
export function createAlphaVantageAdapter(
  fetcher: JsonFetcher,
  apiKey: string | undefined
): MarketDataAdapter {
  return {
    id: 'alpha-vantage',
    supports: (t) => t === 'stock' || t === 'etf',
    async fetchQuotes(): Promise<QuotesResult> {
      return { quotes: [], failed: [] } // no se usa para cotización actual
    },
    async fetchHistory(ticker) {
      if (!apiKey) throw new Error('Alpha Vantage sin API key configurada')
      const url = `${BASE}?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${encodeURIComponent(
        ticker
      )}&outputsize=full&apikey=${apiKey}`
      return parseAlphaDaily(await fetcher(url))
    },
  }
}
