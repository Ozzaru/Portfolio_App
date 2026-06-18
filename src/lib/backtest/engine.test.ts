// src/lib/backtest/engine.test.ts
import { describe, it, expect } from 'vitest'
import { runBacktest } from './engine'
import type { PriceSeriesByTicker, PricePointAdj } from '@/lib/analytics/types'
import type { RunBacktestInput } from './types'

const mk = (dates: string[], vals: number[]): PricePointAdj[] =>
  dates.map((date, i) => ({ date, price: vals[i], adjPrice: vals[i] }))
const DATES = ['2024-01-02', '2024-01-03', '2024-01-04']

function baseInput(over: Partial<RunBacktestInput> = {}): RunBacktestInput {
  const priceSeries: PriceSeriesByTicker = new Map([
    ['A', mk(DATES, [100, 200, 100])],
    ['B', mk(DATES, [100, 100, 100])],
  ])
  return {
    config: { targetWeights: { A: 0.5, B: 0.5 }, frequency: 'monthly', from: '2024-01-01', to: '2024-01-31', initialCapital: 1000 },
    priceSeries,
    benchmarkSeries: mk(DATES, [100, 110, 120]),
    benchmarkTicker: 'SPY',
    stockEtfTickers: ['A', 'B'],
    cryptoTickers: [],
    ...over,
  }
}

describe('runBacktest', () => {
  it('produce las tres líneas con métricas', () => {
    const r = runBacktest(baseInput())
    expect(r.lines.buyHold.equityCurve.map((p) => p.value)).toEqual([1000, 1500, 1000])
    expect(r.lines.rebalanced.turnoverTotal).toBe(0) // sin rebalanceo dentro de un mes
    expect(r.lines.benchmark?.equityCurve.at(-1)?.value).toBeCloseTo(1200) // 1000 * 120/100
    expect(r.lines.benchmark?.totalReturn).toBeCloseTo(0.2)
  })

  it('un solo activo: rebalanceado == buy & hold', () => {
    const input = baseInput({ config: { targetWeights: { A: 1 }, frequency: 'monthly', from: '2024-01-01', to: '2024-01-31', initialCapital: 1000 } })
    const r = runBacktest(input)
    expect(r.lines.rebalanced.equityCurve).toEqual(r.lines.buyHold.equityCurve)
  })

  it('vsBenchmark usa exceso geométrico, no resta', () => {
    const r = runBacktest(baseInput())
    const rt = r.lines.rebalanced.totalReturn
    expect(r.vsBenchmark.geometric).toBeCloseTo((1 + rt) / (1 + 0.2) - 1)
  })

  it('benchmark ausente → benchmarkError y línea null', () => {
    const r = runBacktest(baseInput({ benchmarkSeries: null }))
    expect(r.lines.benchmark).toBeNull()
    expect(r.benchmarkError).toMatch(/SPY/)
    expect(r.vsBenchmark.geometric).toBeNull()
  })

  it('warning de sesgo si weightsFromCurrent', () => {
    const r = runBacktest(baseInput({ config: { ...baseInput().config, weightsFromCurrent: true } }))
    expect(r.warnings.some((w) => /retrospectiva/i.test(w))).toBe(true)
  })

  it('activo del portafolio sin precio al inicio → lanza nombrando el ticker', () => {
    const priceSeries: PriceSeriesByTicker = new Map([
      ['A', mk(DATES, [100, 200, 100])],
      ['B', [{ date: '2024-01-04', price: 100, adjPrice: 100 }]], // empieza tarde
    ])
    expect(() => runBacktest(baseInput({ priceSeries }))).toThrow(/B/)
  })
})
