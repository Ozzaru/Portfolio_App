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
      { date: '2024-01-02', price: 42500, adjPrice: 42500 },
      { date: '2024-01-03', price: 44000, adjPrice: 44000 },
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

  it('fetchQuotes devuelve cotizaciones para los ids conocidos y reporta en `failed` los tickers sin id', async () => {
    const a = createCoinGeckoAdapter(async () => ({ bitcoin: { usd: 60000 } }))
    const { quotes, failed } = await a.fetchQuotes(['BTC', 'FOOBAR'])
    expect(quotes).toEqual([{ ticker: 'BTC', price: 60000, date: expect.any(String) }])
    expect(failed).toEqual([{ ticker: 'FOOBAR', error: expect.stringContaining('CoinGecko') }])
  })

  it('fetchQuotes: si ningún ticker tiene id, no llama a la red y todos van a `failed`', async () => {
    const a = createCoinGeckoAdapter(async () => {
      throw new Error('no debería llamarse')
    })
    const { quotes, failed } = await a.fetchQuotes(['FOOBAR'])
    expect(quotes).toEqual([])
    expect(failed).toEqual([{ ticker: 'FOOBAR', error: expect.stringContaining('CoinGecko') }])
  })

  it('fetchQuotes: si la llamada HTTP entera falla, propaga la excepción (fallo de fuente, no de ticker)', async () => {
    const a = createCoinGeckoAdapter(async () => {
      throw new Error('coingecko caído')
    })
    await expect(a.fetchQuotes(['BTC'])).rejects.toThrow('coingecko caído')
  })
})
