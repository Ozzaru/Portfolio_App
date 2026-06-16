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
