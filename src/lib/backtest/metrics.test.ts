// src/lib/backtest/metrics.test.ts
import { describe, it, expect } from 'vitest'
import { dailyReturns, totalReturn, cagr, geometricExcess, lineMetrics } from './metrics'

describe('dailyReturns', () => {
  it('retornos día a día', () => {
    const r = dailyReturns([100, 110, 99])
    expect(r[0]).toBeCloseTo(0.1)
    expect(r[1]).toBeCloseTo(-0.1)
  })
})

describe('totalReturn', () => {
  it('último / primero − 1', () => {
    expect(totalReturn([100, 150])).toBeCloseTo(0.5)
  })
  it('serie de un punto → 0', () => {
    expect(totalReturn([100])).toBe(0)
  })
})

describe('cagr', () => {
  it('un año (252 días) duplicando → 100%', () => {
    const eq = Array.from({ length: 252 }, (_, i) => (i === 0 ? 100 : i === 251 ? 200 : 150))
    expect(cagr(eq)).toBeCloseTo(1.0, 6)
  })
  it('menos de 2 puntos → null', () => {
    expect(cagr([100])).toBeNull()
  })
})

describe('geometricExcess', () => {
  it('(1+0.5)/(1+0.2) − 1 = 0.25', () => {
    expect(geometricExcess(0.5, 0.2)).toBeCloseTo(0.25)
  })
})

describe('lineMetrics', () => {
  it('totalReturn y maxDrawdown sobre la curva de equity', () => {
    const curve = [
      { date: '2024-01-01', value: 100 },
      { date: '2024-01-02', value: 120 },
      { date: '2024-01-03', value: 90 },
      { date: '2024-01-04', value: 130 },
    ]
    const m = lineMetrics(curve)
    expect(m.totalReturn).toBeCloseTo(0.3) // 130/100 − 1
    expect(m.maxDrawdown).toBeCloseTo(-0.25) // 90/120 − 1
  })
})
