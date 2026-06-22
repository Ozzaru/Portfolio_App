// src/lib/scenarios/beta.test.ts
import { describe, it, expect } from 'vitest'
import { alignedAdjReturns, computeBeta, resolveBeta, FALLBACK_BETA_BY_TYPE } from './beta'
import type { PricePointAdj } from '@/lib/analytics/types'

const mk = (rows: [string, number][]): PricePointAdj[] =>
  rows.map(([date, v]) => ({ date, price: v, adjPrice: v }))

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

describe('resolveBeta', () => {
  it('usa la beta histórica cuando hay suficientes observaciones', () => {
    const dates = Array.from({ length: 25 }, (_, i) => `2026-05-${String(i + 1).padStart(2, '0')}`)
    const vals: [string, number][] = dates.map((d, i) => [d, 100 + (i % 2)]) // 100,101,100,101…
    const series = mk(vals)
    const r = resolveBeta(series, series, 'crypto') // serie idéntica → beta 1
    expect(r.fallback).toBe(false)
    expect(r.beta).toBeCloseTo(1) // 1, no el 1.5 de fallback de crypto → probó la rama histórica
  })
  it('fallback por asset_type cuando el histórico es insuficiente', () => {
    const short = mk([['2026-06-15', 10], ['2026-06-16', 11]]) // 1 retorno < MIN_BETA_OBS
    expect(resolveBeta(short, short, 'crypto')).toEqual({ beta: 1.5, fallback: true })
    expect(resolveBeta(short, short, 'cash')).toEqual({ beta: 0, fallback: true })
    expect(resolveBeta(short, short, 'stock')).toEqual({ beta: 1, fallback: true })
  })
})

describe('FALLBACK_BETA_BY_TYPE', () => {
  it('cash 0, crypto 1.5, resto 1', () => {
    expect(FALLBACK_BETA_BY_TYPE.cash).toBe(0)
    expect(FALLBACK_BETA_BY_TYPE.crypto).toBe(1.5)
    expect(FALLBACK_BETA_BY_TYPE.etf).toBe(1)
  })
})
