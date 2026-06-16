// src/lib/analytics/engine.test.ts
import { describe, it, expect } from 'vitest'
import { computeAnalytics } from './engine'
import type { PriceSeriesByTicker } from './types'
import type { Transaction } from '@/lib/portfolio/holdings'

const txs: Transaction[] = [
  { assetId: 'a1', ticker: 'AAPL', side: 'buy', quantity: 10, price: 100, fees: 0, executedAt: '2024-01-02' },
]

const priceSeries: PriceSeriesByTicker = new Map([
  [
    'AAPL',
    [
      { date: '2024-01-02', price: 100, adjPrice: 100 },
      { date: '2024-01-03', price: 110, adjPrice: 110 },
      { date: '2024-01-04', price: 121, adjPrice: 121 },
    ],
  ],
])

const benchmarkSeries = [
  { date: '2024-01-02', price: 400, adjPrice: 400 },
  { date: '2024-01-03', price: 404, adjPrice: 404 },
  { date: '2024-01-04', price: 408, adjPrice: 408 },
]

describe('computeAnalytics', () => {
  it('serie normalizada a 100 y TWR del portafolio (un solo activo = su retorno)', () => {
    const res = computeAnalytics({
      transactions: txs,
      priceSeries,
      benchmarkSeries,
      benchmarkTicker: 'SPY',
      assetTypeByTicker: new Map([['AAPL', 'stock']]),
      period: 'ALL',
      today: '2024-01-04',
    })
    expect(res.series[0]).toEqual({ date: '2024-01-02', portfolio: 100, benchmark: 100 })
    expect(res.series.at(-1)!.portfolio).toBeCloseTo(121)
    expect(res.summary.portfolioTwr).toBeCloseTo(0.21)
    expect(res.summary.benchmarkTwr).toBeCloseTo(408 / 400 - 1)
    expect(res.series.at(-1)!.benchmark).toBeCloseTo((408 / 400) * 100)
  })

  it('P&L absoluto en raw: valor final − capital aportado (ALL, V_ini=0)', () => {
    const res = computeAnalytics({
      transactions: txs,
      priceSeries,
      benchmarkSeries: null,
      benchmarkTicker: 'SPY',
      assetTypeByTicker: new Map([['AAPL', 'stock']]),
      period: 'ALL',
      today: '2024-01-04',
    })
    expect(res.summary.absolutePnl).toBeCloseTo(210)
    expect(res.summary.benchmarkTwr).toBeNull()
  })

  it('sin transacciones → resultado vacío', () => {
    const res = computeAnalytics({
      transactions: [],
      priceSeries: new Map(),
      benchmarkSeries: null,
      benchmarkTicker: 'SPY',
      assetTypeByTicker: new Map(),
      period: 'ALL',
      today: '2024-01-04',
    })
    expect(res.series).toEqual([])
    expect(res.summary.portfolioTwr).toBeNull()
    expect(res.perAsset).toEqual([])
    expect(res.correlation.tickers).toEqual([])
  })
})
