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
