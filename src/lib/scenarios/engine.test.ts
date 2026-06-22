// src/lib/scenarios/engine.test.ts
import { describe, it, expect } from 'vitest'
import { runScenario } from './engine'
import type { PriceSeriesByTicker } from '@/lib/analytics/types'
import type { ScenarioHolding } from './types'

const holdings: ScenarioHolding[] = [
  { ticker: 'AAPL', assetType: 'stock', quantity: 10, currentPrice: 100 }, // 1000
  { ticker: 'SPCX', assetType: 'etf', quantity: 5, currentPrice: 200 }, // 1000
]

describe('runScenario', () => {
  it('P&L bottom-up cuadra con la suma de las partes (incluso con override)', () => {
    // Sin histórico → betas por fallback (stock 1.0, etf 1.0). marketShock -0.20, override AAPL -0.50.
    const r = runScenario({
      config: { marketShock: -0.2, overrides: { AAPL: -0.5 } },
      holdings,
      priceSeries: new Map() as PriceSeriesByTicker,
      benchmarkSeries: null,
      benchmarkTicker: 'SPY',
    })
    // AAPL 1000 → 500 (override). SPCX 1000 → 800 (beta 1 × -0.2). Total 2000 → 1300.
    expect(r.portfolio.valueBefore).toBe(2000)
    expect(r.portfolio.valueAfter).toBeCloseTo(1300)
    expect(r.portfolio.pnlPct).toBeCloseTo(-0.35) // bottom-up
    // aggregateBeta = 0.5·1 + 0.5·1 = 1 → si se usara betaAgregada×shock daría -0.20 (incorrecto)
    expect(r.portfolio.aggregateBeta).toBeCloseTo(1)
    expect(r.vsBenchmark.marketShock).toBe(-0.2)
  })

  it('ordena perAsset por contribución a la pérdida (peor primero)', () => {
    const r = runScenario({
      config: { marketShock: -0.2, overrides: { AAPL: -0.5 } },
      holdings,
      priceSeries: new Map() as PriceSeriesByTicker,
      benchmarkSeries: null,
      benchmarkTicker: 'SPY',
    })
    expect(r.perAsset[0].ticker).toBe('AAPL') // -500 peor que -200
    expect(r.perAsset[1].ticker).toBe('SPCX')
  })

  it('warning de benchmark ausente y de betas por fallback', () => {
    const r = runScenario({
      config: { marketShock: -0.2, overrides: {} },
      holdings,
      priceSeries: new Map() as PriceSeriesByTicker,
      benchmarkSeries: null,
      benchmarkTicker: 'SPY',
    })
    expect(r.warnings.some((w) => /SPY/.test(w))).toBe(true)
    expect(r.warnings.some((w) => /AAPL/.test(w))).toBe(true)
  })

  it('activo sin precio actual → excluido del total con warning', () => {
    const r = runScenario({
      config: { marketShock: -0.2, overrides: {} },
      holdings: [{ ticker: 'X', assetType: 'stock', quantity: 1, currentPrice: null }],
      priceSeries: new Map() as PriceSeriesByTicker,
      benchmarkSeries: null,
      benchmarkTicker: 'SPY',
    })
    expect(r.perAsset).toHaveLength(0)
    expect(r.warnings.some((w) => /X/.test(w))).toBe(true)
  })
})
