// src/lib/analytics/beta.test.ts
import { describe, it, expect } from 'vitest'
import { alignedAdjReturns, computeBeta, beta, MIN_BETA_OBS } from './beta'
import type { PricePointAdj } from './types'

const mk = (rows: [string, number][]): PricePointAdj[] =>
  rows.map(([date, v]) => ({ date, price: v, adjPrice: v }))

// 25 fechas alternando 100/101 → 24 retornos, por encima de MIN_BETA_OBS.
const longSeries = (): PricePointAdj[] => {
  const rows: [string, number][] = Array.from(
    { length: 25 },
    (_, i) => [`2026-05-${String(i + 1).padStart(2, '0')}`, 100 + (i % 2)] as [string, number]
  )
  return mk(rows)
}

// 3 fechas → 2 retornos, por debajo de MIN_BETA_OBS pero suficiente para computeBeta.
const shortSeries = (): PricePointAdj[] =>
  mk([['2026-06-15', 10], ['2026-06-16', 11], ['2026-06-17', 12]])

describe('alignedAdjReturns', () => {
  it('calcula retornos ajustados sobre fechas comunes consecutivas', () => {
    const a = mk([['2026-06-10', 100], ['2026-06-11', 110], ['2026-06-12', 121]])
    const b = mk([['2026-06-11', 200], ['2026-06-12', 210]]) // solo 06-11 y 06-12 son comunes
    const { rA, rB } = alignedAdjReturns(a, b)
    expect(rA).toHaveLength(1)
    expect(rA[0]).toBeCloseTo(121 / 110 - 1)
    expect(rB[0]).toBeCloseTo(210 / 200 - 1)
  })
})

describe('computeBeta', () => {
  it('beta = 2 cuando el activo se mueve el doble que el benchmark', () => {
    const rB = [0.01, -0.02, 0.03, -0.01, 0.02]
    const rA = rB.map((x) => 2 * x)
    expect(computeBeta(rA, rB)).toBeCloseTo(2)
  })
  it('null con menos de 2 observaciones', () => {
    expect(computeBeta([0.01], [0.02])).toBeNull()
  })
  it('null si la varianza del benchmark es 0', () => {
    expect(computeBeta([0.01, 0.02], [0, 0])).toBeNull()
  })
})

describe('beta', () => {
  it('calcula la beta histórica cuando hay observaciones suficientes', () => {
    const s = longSeries()
    expect(beta(s, s)).toBeCloseTo(1) // serie contra sí misma → beta exactamente 1
  })

  it('null cuando hay menos de MIN_BETA_OBS observaciones', () => {
    const s = shortSeries() // 2 retornos < 20
    expect(beta(s, s)).toBeNull()
  })

  it('respeta un minObs explícito más bajo', () => {
    const s = shortSeries()
    expect(beta(s, s, 2)).toBeCloseTo(1)
    expect(MIN_BETA_OBS).toBe(20) // el default no se ve afectado por el override
  })
})
