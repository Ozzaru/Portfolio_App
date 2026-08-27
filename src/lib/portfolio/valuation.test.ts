// src/lib/portfolio/valuation.test.ts
import { describe, it, expect } from 'vitest'
import { valuePositions, portfolioTotals, type Quote } from '@/lib/portfolio/valuation'
import type { Holding } from '@/lib/portfolio/holdings'

const holding = (over: Partial<Holding> = {}): Holding => ({
  assetId: 'a1',
  ticker: 'AAPL',
  quantity: 10,
  costBasis: 1000,
  avgCost: 100,
  ...over,
})

describe('valuePositions', () => {
  it('valora con el precio disponible', () => {
    const [p] = valuePositions([holding()], [{ ticker: 'AAPL', price: 120 }], 'CLP')
    expect(p.currentPrice).toBe(120)
    expect(p.marketValue).toBe(1200)
    expect(p.unrealizedPnl).toBe(200)
    expect(p.unrealizedPnlPct).toBeCloseTo(20)
  })

  it('marca null cuando no hay precio', () => {
    const [p] = valuePositions([holding()], [], 'CLP')
    expect(p.currentPrice).toBeNull()
    expect(p.marketValue).toBeNull()
    expect(p.unrealizedPnl).toBeNull()
    expect(p.unrealizedPnlPct).toBeNull()
  })
})

describe('presentación en moneda nativa', () => {
  const holdings = [{ assetId: 'a', ticker: 'ENELCHILE.SN', quantity: 244, costBasis: 19477, avgCost: 79.82 }]

  it('expone moneda y precio nativos junto al valor en base', () => {
    const [p] = valuePositions(holdings, [{ ticker: 'ENELCHILE.SN', price: 80 }], 'CLP', new Map([
      ['ENELCHILE.SN', { currency: 'CLP', price: 80 }],
    ]))
    expect(p.nativeCurrency).toBe('CLP')
    expect(p.nativePrice).toBe(80)
    expect(p.marketValue).toBe(19520)
  })

  it('sin mapa nativo, la etiqueta es la moneda base — porque el precio también lo es', () => {
    // `nativePrice` cae al precio EN BASE, así que `nativeCurrency` tiene que
    // decir "base". Etiquetarlo con una moneda fija pondría un rótulo falso
    // sobre un número ya convertido.
    const [p] = valuePositions(holdings, [{ ticker: 'ENELCHILE.SN', price: 80 }], 'CLP')
    expect(p.nativeCurrency).toBe('CLP')
    expect(p.nativePrice).toBe(80)
  })
})

describe('portfolioTotals', () => {
  it('suma solo posiciones con precio para valor y P&L', () => {
    const quotes: Quote[] = [{ ticker: 'AAPL', price: 120 }]
    const positions = valuePositions(
      [holding(), holding({ assetId: 'a2', ticker: 'BTC', quantity: 1, costBasis: 50000, avgCost: 50000 })],
      quotes,
      'CLP'
    )
    const t = portfolioTotals(positions)
    expect(t.totalValue).toBe(1200)
    expect(t.totalCost).toBe(51000) // incluye también las no valoradas
    expect(t.totalPnl).toBe(200)
    expect(t.totalPnlPct).toBeCloseTo(20)
    expect(t.assetCount).toBe(2)
  })

  it('devuelve ceros con portafolio vacío', () => {
    const t = portfolioTotals([])
    expect(t).toEqual({ totalValue: 0, totalCost: 0, totalPnl: 0, totalPnlPct: 0, assetCount: 0 })
  })
})
