// src/lib/scenarios/stress.test.ts
import { describe, it, expect } from 'vitest'
import { stressAsset } from './stress'
import type { ScenarioHolding } from './types'

const h: ScenarioHolding = { ticker: 'AAPL', assetType: 'stock', quantity: 10, currentPrice: 100 }

describe('stressAsset', () => {
  it('aplica beta·marketShock a precio crudo', () => {
    const a = stressAsset(h, 1.2, false, { marketShock: -0.2, overrides: {} })
    expect(a?.valueBefore).toBe(1000)
    expect(a?.shockApplied).toBeCloseTo(-0.24) // 1.2 × -0.2
    expect(a?.valueAfter).toBeCloseTo(760)
    expect(a?.lossContribAbs).toBeCloseTo(-240)
    expect(a?.betaFallback).toBe(false)
  })

  it('el override tiene precedencia sobre la beta', () => {
    const a = stressAsset(h, 1.2, false, { marketShock: -0.2, overrides: { AAPL: -0.5 } })
    expect(a?.shockApplied).toBe(-0.5)
    expect(a?.valueAfter).toBeCloseTo(500)
  })

  it('sin precio actual → null (no valuable)', () => {
    const a = stressAsset({ ...h, currentPrice: null }, 1, false, { marketShock: -0.2, overrides: {} })
    expect(a).toBeNull()
  })
})
