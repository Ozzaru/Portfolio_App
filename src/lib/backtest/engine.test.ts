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

  it('activo del portafolio que empieza tarde → recorta el inicio y avisa, no lanza', () => {
    const D = ['2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05']
    const priceSeries: PriceSeriesByTicker = new Map([
      ['A', mk(D, [100, 110, 120, 130])],
      ['B', mk(['2024-01-04', '2024-01-05'], [100, 110])], // IPO el 2024-01-04
    ])
    const r = runBacktest(
      baseInput({
        priceSeries,
        config: { targetWeights: { A: 0.5, B: 0.5 }, frequency: 'monthly', from: '2024-01-01', to: '2024-01-31', initialCapital: 1000 },
        benchmarkSeries: mk(D, [100, 100, 100, 100]),
      })
    )
    // el eje arranca el primer día con TODOS los tickers vivos (no en el arranque de A)
    expect(r.lines.rebalanced.equityCurve.map((p) => p.date)).toEqual(['2024-01-04', '2024-01-05'])
    expect(r.warnings.some((w) => /B/.test(w) && /2024-01-04/.test(w))).toBe(true)
  })

  it('activo del portafolio sin datos en el rango → error claro nombrando el ticker', () => {
    const priceSeries: PriceSeriesByTicker = new Map([
      ['A', mk(DATES, [100, 200, 100])],
      ['B', []], // sin datos en el rango
    ])
    expect(() => runBacktest(baseInput({ priceSeries }))).toThrow(/B/)
  })

  it('ventana demasiado corta para anualizar → nota sobre CAGR/Sharpe', () => {
    const r = runBacktest(baseInput()) // 3 días operativos << 1 mes
    expect(r.warnings.some((w) => /anualiz/i.test(w) && /(CAGR|Sharpe)/.test(w))).toBe(true)
  })

  it('ventana suficientemente larga → sin nota de anualización', () => {
    const longDates = Array.from({ length: 25 }, (_, i) => `2024-01-${String(i + 2).padStart(2, '0')}`)
    const vals = longDates.map((_, i) => 100 + i)
    const priceSeries: PriceSeriesByTicker = new Map([
      ['A', mk(longDates, vals)],
      ['B', mk(longDates, vals)],
    ])
    const r = runBacktest(baseInput({ priceSeries, benchmarkSeries: mk(longDates, vals) }))
    expect(r.warnings.some((w) => /anualiz/i.test(w))).toBe(false)
  })
})
