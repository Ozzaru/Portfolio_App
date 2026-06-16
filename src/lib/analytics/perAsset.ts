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
