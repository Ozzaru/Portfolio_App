// src/lib/analytics/synthetic/simulate.test.ts
import { describe, it, expect } from 'vitest'
import { simulateLine } from './simulate'
import type { PriceSeriesByTicker } from '../types'

// A se duplica en d1 y vuelve a 100 en d2; B plano. Precio raw = ajustado en el test.
function series(): PriceSeriesByTicker {
  const mk = (vals: number[]) =>
    ['d0', 'd1', 'd2'].map((date, i) => ({ date, price: vals[i], adjPrice: vals[i] }))
  return new Map([
    ['A', mk([100, 200, 100])],
    ['B', mk([100, 100, 100])],
  ])
}
const DATES = ['d0', 'd1', 'd2']
const W = { A: 0.5, B: 0.5 }

describe('simulateLine', () => {
  it('buy & hold (sin rebalanceo) deriva y turnover = 0', () => {
    const { equityCurve, turnoverTotal } = simulateLine(DATES, series(), W, [], 1000)
    expect(equityCurve.map((p) => p.value)).toEqual([1000, 1500, 1000])
    expect(turnoverTotal).toBe(0)
  })

  it('rebalanceado en d1 fija las ganancias y acumula turnover', () => {
    const { equityCurve, turnoverTotal } = simulateLine(DATES, series(), W, ['d1'], 1000)
    // d1: V=1500, se resetea a 750/750 (A@200, B@100); d2: A=750*100/200=375, B=750 → 1125
    expect(equityCurve.map((p) => p.value)).toEqual([1000, 1500, 1125])
    expect(turnoverTotal).toBeCloseTo(1 / 6) // ½·(|0.5−0.667|+|0.5−0.333|)
  })

  it('un solo activo: turnover 0 aunque haya fecha de rebalanceo', () => {
    const { turnoverTotal } = simulateLine(DATES, series(), { A: 1 }, ['d1'], 1000)
    expect(turnoverTotal).toBeCloseTo(0)
  })

  it('lanza error nombrando el ticker sin precio en una fecha', () => {
    const incompleta: PriceSeriesByTicker = new Map([['A', [{ date: 'd1', price: 1, adjPrice: 1 }]]])
    expect(() => simulateLine(DATES, incompleta, { A: 1 }, [], 1000)).toThrow(/A/)
  })
})
