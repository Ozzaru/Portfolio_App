import { describe, it, expect } from 'vitest'
import { parseYahooChart, createYahooAdapter } from './yahoo'

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

describe('createYahooAdapter', () => {
  it('soporta stock y etf, no crypto', () => {
    const a = createYahooAdapter(async () => sample)
    expect(a.supports('stock')).toBe(true)
    expect(a.supports('etf')).toBe(true)
    expect(a.supports('crypto')).toBe(false)
  })

  it('fetchQuotes devuelve una cotización por ticker usando el fetcher inyectado', async () => {
    const a = createYahooAdapter(async () => sample)
    const { quotes, failed } = await a.fetchQuotes(['AAPL'])
    expect(quotes).toEqual([{ ticker: 'AAPL', price: 175.5, date: '2024-06-15' }])
    expect(failed).toEqual([])
  })

  // Caso real: el usuario creó el activo chileno como "ENELCHILE" (sin el
  // sufijo .SN que exige Yahoo para la Bolsa de Santiago). Esa petición
  // respondía HTTP 404 y, como el bucle antiguo relanzaba el error, tumbaba
  // TODO el lote — incluso cotizaciones válidas como AAPL o ASML se perdían.
  // Un ticker inválido debe fallar solo, sin descartar a los demás.
  it('un ticker inválido no descarta las cotizaciones de los demás; se reporta en `failed`', async () => {
    const fetcher = async (url: string) => {
      if (url.includes('ENELCHILE')) throw new Error('HTTP 404')
      return sample
    }
    const a = createYahooAdapter(fetcher)
    const { quotes, failed } = await a.fetchQuotes(['AAPL', 'ENELCHILE', 'ASML'])
    expect(quotes).toEqual([
      { ticker: 'AAPL', price: 175.5, date: '2024-06-15' },
      { ticker: 'ASML', price: 175.5, date: '2024-06-15' },
    ])
    expect(failed).toEqual([{ ticker: 'ENELCHILE', error: 'HTTP 404' }])
  })

  it('fetchHistory devuelve los puntos históricos (raw + adjusted)', async () => {
    const a = createYahooAdapter(async () => sample)
    const hist = await a.fetchHistory('AAPL', '2021-06-15')
    expect(hist).toEqual([{ date: '2024-01-02', price: 185.1, adjPrice: 184.2 }])
  })
})
