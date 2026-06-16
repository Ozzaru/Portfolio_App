import { describe, it, expect } from 'vitest'
import { refreshQuotes, backfillHistory } from './refresh'
import type { MarketDataAdapter } from './types'

const okYahoo: MarketDataAdapter = {
  id: 'yahoo',
  supports: (t) => t === 'stock' || t === 'etf',
  fetchQuotes: async (ts) => ts.map((t) => ({ ticker: t, price: 100, date: '2026-06-15' })),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  fetchHistory: async (_t) => [{ date: '2021-06-15', price: 90, adjPrice: 81 }],
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
  it('devuelve filas {ticker,date,price,adjPrice,source} por activo', async () => {
    const { rows, results } = await backfillHistory(
      [{ ticker: 'AAPL', asset_type: 'stock' }],
      '2021-06-15',
      { yahoo: okYahoo, coingecko: failingCoin, alphaVantage: undefined }
    )
    expect(rows).toEqual([{ ticker: 'AAPL', date: '2021-06-15', price: 90, adjPrice: 81, source: 'yahoo' }])
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
      fetchHistory: async () => [{ date: '2021-06-15', price: 88, adjPrice: 80 }],
    }
    const { rows } = await backfillHistory([{ ticker: 'AAPL', asset_type: 'stock' }], '2021-06-15', {
      yahoo: failingYahoo,
      coingecko: failingCoin,
      alphaVantage: alpha,
    })
    expect(rows).toEqual([{ ticker: 'AAPL', date: '2021-06-15', price: 88, adjPrice: 80, source: 'alpha-vantage' }])
  })
})
