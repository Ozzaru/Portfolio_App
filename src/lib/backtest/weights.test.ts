// src/lib/backtest/weights.test.ts
import { describe, it, expect } from 'vitest'
import { equalWeights, normalizeWeights, validateWeights } from './weights'

describe('equalWeights', () => {
  it('reparte 1/N entre N tickers', () => {
    expect(equalWeights(['A', 'B', 'C', 'D'])).toEqual({ A: 0.25, B: 0.25, C: 0.25, D: 0.25 })
  })
  it('lista vacía → objeto vacío', () => {
    expect(equalWeights([])).toEqual({})
  })
})

describe('normalizeWeights', () => {
  it('normaliza a que sumen 1', () => {
    expect(normalizeWeights({ A: 60, B: 40 })).toEqual({ A: 0.6, B: 0.4 })
  })
  it('ya normalizado se mantiene', () => {
    const r = normalizeWeights({ A: 0.5, B: 0.5 })
    expect(r.A).toBeCloseTo(0.5)
    expect(r.B).toBeCloseTo(0.5)
  })
})

describe('validateWeights', () => {
  it('acepta pesos positivos', () => {
    expect(validateWeights({ A: 0.6, B: 0.4 })).toEqual({ ok: true })
  })
  it('rechaza peso negativo', () => {
    expect(validateWeights({ A: 1.2, B: -0.2 }).ok).toBe(false)
  })
  it('rechaza si todo es 0', () => {
    expect(validateWeights({ A: 0, B: 0 }).ok).toBe(false)
  })
  it('rechaza objeto vacío', () => {
    expect(validateWeights({}).ok).toBe(false)
  })
})
