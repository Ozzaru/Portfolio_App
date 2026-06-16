// src/lib/analytics/series.test.ts
import { describe, it, expect } from 'vitest'
import {
  priceAsOf,
  holdingsAsOf,
  tradingDates,
  portfolioRawValue,
  startOfDayWeights,
  assetReturn,
} from './series'
import type { PriceSeriesByTicker } from './types'
import type { Transaction } from '@/lib/portfolio/holdings'

const series: PriceSeriesByTicker = new Map([
  [
    'AAPL',
    [
      { date: '2024-01-02', price: 100, adjPrice: 90 },
      { date: '2024-01-03', price: 110, adjPrice: 99 },
      { date: '2024-01-05', price: 120, adjPrice: 108 },
    ],
  ],
  [
    'BTC',
    [
      { date: '2024-01-02', price: 40000, adjPrice: 40000 },
      { date: '2024-01-03', price: 41000, adjPrice: 41000 },
      { date: '2024-01-04', price: 42000, adjPrice: 42000 },
      { date: '2024-01-05', price: 43000, adjPrice: 43000 },
    ],
  ],
])

const txs: Transaction[] = [
  { assetId: 'a1', ticker: 'AAPL', side: 'buy', quantity: 10, price: 100, fees: 0, executedAt: '2024-01-02' },
  { assetId: 'a2', ticker: 'BTC', side: 'buy', quantity: 1, price: 40000, fees: 0, executedAt: '2024-01-03' },
]

describe('priceAsOf', () => {
  it('devuelve el último punto con fecha <= objetivo (forward-fill)', () => {
    expect(priceAsOf(series.get('AAPL')!, '2024-01-04')).toEqual({ date: '2024-01-03', price: 110, adjPrice: 99 })
  })
  it('devuelve null si no hay punto <= objetivo', () => {
    expect(priceAsOf(series.get('AAPL')!, '2024-01-01')).toBeNull()
  })
})

describe('holdingsAsOf', () => {
  it('solo cuenta transacciones con executedAt <= fecha', () => {
    const h = holdingsAsOf(txs, '2024-01-02')
    expect(h).toHaveLength(1)
    expect(h[0].ticker).toBe('AAPL')
  })
  it('incluye ambos activos una vez compradas ambas', () => {
    expect(holdingsAsOf(txs, '2024-01-03')).toHaveLength(2)
  })
})

describe('tradingDates', () => {
  it('usa las fechas reales de stock/etf cuando existen (ignora días extra de crypto)', () => {
    expect(tradingDates(series, ['AAPL'], ['BTC'], '2024-01-02', '2024-01-05')).toEqual([
      '2024-01-02',
      '2024-01-03',
      '2024-01-05',
    ])
  })
  it('cae a las fechas de crypto si no hay stock/etf', () => {
    expect(tradingDates(series, [], ['BTC'], '2024-01-02', '2024-01-05')).toEqual([
      '2024-01-02',
      '2024-01-03',
      '2024-01-04',
      '2024-01-05',
    ])
  })
})

describe('portfolioRawValue', () => {
  it('suma cantidad × raw close (forward-fill)', () => {
    const h = holdingsAsOf(txs, '2024-01-05')
    expect(portfolioRawValue(h, series, '2024-01-05')).toBe(10 * 120 + 43000)
  })
})

describe('startOfDayWeights', () => {
  it('normaliza por valor crudo y suma 1', () => {
    const h = holdingsAsOf(txs, '2024-01-03')
    const w = startOfDayWeights(h, series, '2024-01-03')
    const aapl = 10 * 110
    const btc = 1 * 41000
    expect(w.get('AAPL')).toBeCloseTo(aapl / (aapl + btc))
    expect(w.get('BTC')).toBeCloseTo(btc / (aapl + btc))
    expect((w.get('AAPL') ?? 0) + (w.get('BTC') ?? 0)).toBeCloseTo(1)
  })
  it('devuelve pesos vacíos si el valor total es 0', () => {
    expect(startOfDayWeights([], series, '2024-01-03').size).toBe(0)
  })
})

describe('assetReturn', () => {
  it('usa adjusted close entre dos fechas', () => {
    expect(assetReturn(series, 'AAPL', '2024-01-03', '2024-01-05')).toBeCloseTo(108 / 99 - 1)
  })
  it('devuelve null si falta precio en t-1', () => {
    expect(assetReturn(series, 'AAPL', '2024-01-01', '2024-01-03')).toBeNull()
  })
})
