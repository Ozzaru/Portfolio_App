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
  return [...byDate].map(([date, price]) => ({ date, price, adjPrice: price }))
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
