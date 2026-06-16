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

  it('P&L absoluto en raw: valor final − capital neto aportado', () => {
    const res = computeAnalytics({
      transactions: txs,
      priceSeries,
      benchmarkSeries: null,
      benchmarkTicker: 'SPY',
      assetTypeByTicker: new Map([['AAPL', 'stock']]),
      period: 'ALL',
      today: '2024-01-04',
    })
    // valor final 10×121 = 1210; capital neto aportado 10×100 = 1000 ⇒ 210.
    // (V_ini incluye la compra del primer día porque holdingsAsOf usa <=, y la
    // ventana de flujos es (start, today] estrictamente posterior → no se duplica.)
    expect(res.summary.absolutePnl).toBeCloseTo(210)
    expect(res.summary.benchmarkTwr).toBeNull()
  })

  it('multi-activo: retorno diario es el promedio ponderado de los activos', () => {
    const multiSeries: PriceSeriesByTicker = new Map([
      ['AAPL', [
        { date: '2024-01-02', price: 100, adjPrice: 100 },
        { date: '2024-01-03', price: 110, adjPrice: 110 },
      ]],
      ['MSFT', [
        { date: '2024-01-02', price: 100, adjPrice: 100 },
        { date: '2024-01-03', price: 90, adjPrice: 90 },
      ]],
    ])
    const multiTxs: Transaction[] = [
      { assetId: 'a1', ticker: 'AAPL', side: 'buy', quantity: 10, price: 100, fees: 0, executedAt: '2024-01-02' },
      { assetId: 'a2', ticker: 'MSFT', side: 'buy', quantity: 10, price: 100, fees: 0, executedAt: '2024-01-02' },
    ]
    const res = computeAnalytics({
      transactions: multiTxs,
      priceSeries: multiSeries,
      benchmarkSeries: null,
      benchmarkTicker: 'SPY',
      assetTypeByTicker: new Map([['AAPL', 'stock'], ['MSFT', 'stock']]),
      period: 'ALL',
      today: '2024-01-03',
    })
    // pesos 0.5/0.5; retornos +10% / −10% ⇒ retorno diario 0 ⇒ TWR 0, índice plano.
    expect(res.summary.portfolioTwr).toBeCloseTo(0)
    expect(res.series.at(-1)!.portfolio).toBeCloseTo(100)
  })

  it('correlación usa fechas con precio REAL (sin forward-fill); excluye el hueco', () => {
    // MSFT no tiene precio el 01-04 (hueco). Con forward-fill se colaría un retorno
    // 0 ese día; con precio real, las fechas usables son {01-02, 01-03, 01-05}.
    const corrSeries: PriceSeriesByTicker = new Map([
      ['AAPL', [
        { date: '2024-01-02', price: 100, adjPrice: 100 },
        { date: '2024-01-03', price: 110, adjPrice: 110 },
        { date: '2024-01-04', price: 121, adjPrice: 121 },
        { date: '2024-01-05', price: 133.1, adjPrice: 133.1 },
      ]],
      ['MSFT', [
        { date: '2024-01-02', price: 100, adjPrice: 100 },
        { date: '2024-01-03', price: 90, adjPrice: 90 },
        // 01-04 ausente a propósito (hueco real)
        { date: '2024-01-05', price: 72.9, adjPrice: 72.9 },
      ]],
    ])
    const corrTxs: Transaction[] = [
      { assetId: 'a1', ticker: 'AAPL', side: 'buy', quantity: 1, price: 100, fees: 0, executedAt: '2024-01-02' },
      { assetId: 'a2', ticker: 'MSFT', side: 'buy', quantity: 1, price: 100, fees: 0, executedAt: '2024-01-02' },
    ]
    const res = computeAnalytics({
      transactions: corrTxs,
      priceSeries: corrSeries,
      benchmarkSeries: null,
      benchmarkTicker: 'SPY',
      assetTypeByTicker: new Map([['AAPL', 'stock'], ['MSFT', 'stock']]),
      period: 'ALL',
      today: '2024-01-05',
    })
    expect(res.correlation.tickers).toEqual(['AAPL', 'MSFT'])
    expect(res.correlation.matrix[0][0]).toBe(1)
    expect(res.correlation.matrix[1][1]).toBe(1)
    // AAPL sube, MSFT baja en cada paso real ⇒ correlación −1.
    expect(res.correlation.matrix[0][1]).toBeCloseTo(-1)
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
