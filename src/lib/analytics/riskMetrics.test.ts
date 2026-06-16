// src/lib/analytics/riskMetrics.test.ts
import { describe, it, expect } from 'vitest'
import { mean, stdDev, volatility, sharpe, maxDrawdown } from './riskMetrics'

describe('mean / stdDev', () => {
  it('media simple', () => {
    expect(mean([1, 2, 3])).toBe(2)
  })
  it('desviación estándar muestral (n-1)', () => {
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2)
  })
  it('stdDev de <2 elementos = 0', () => {
    expect(stdDev([5])).toBe(0)
  })
})

describe('volatility', () => {
  it('anualiza la desviación estándar diaria por √252', () => {
    const r = [0.01, -0.02, 0.015, -0.005, 0.0]
    expect(volatility(r)).toBeCloseTo(stdDev(r) * Math.sqrt(252))
  })
  it('null con menos de 2 retornos', () => {
    expect(volatility([0.01])).toBeNull()
  })
})

describe('sharpe', () => {
  it('se calcula desde retornos diarios y anualiza por √252 (rf=0)', () => {
    const r = [0.01, 0.02, -0.01, 0.005, 0.0]
    const expected = (mean(r) / stdDev(r)) * Math.sqrt(252)
    expect(sharpe(r)).toBeCloseTo(expected)
  })
  it('null si la desviación es 0 (sin variación)', () => {
    expect(sharpe([0.01, 0.01, 0.01])).toBeNull()
  })
  it('null con menos de 2 retornos', () => {
    expect(sharpe([0.01])).toBeNull()
  })
})

describe('maxDrawdown', () => {
  it('mayor caída pico-a-valle como fracción negativa', () => {
    expect(maxDrawdown([100, 120, 90, 80, 130])).toBeCloseTo(-1 / 3)
  })
  it('serie monótona creciente → 0', () => {
    expect(maxDrawdown([100, 110, 120])).toBe(0)
  })
  it('null con menos de 2 puntos', () => {
    expect(maxDrawdown([100])).toBeNull()
  })
})
