// src/lib/analytics/returns.test.ts
import { describe, it, expect } from 'vitest'
import { portfolioDailyReturn, timeWeightedReturn, normalizeToBase, absolutePnl } from './returns'

describe('portfolioDailyReturn', () => {
  it('suma ponderada de los retornos de los activos', () => {
    const w = new Map([
      ['AAPL', 0.6],
      ['BTC', 0.4],
    ])
    const r = new Map([
      ['AAPL', 0.1],
      ['BTC', -0.05],
    ])
    expect(portfolioDailyReturn(w, r)).toBeCloseTo(0.6 * 0.1 + 0.4 * -0.05)
  })
  it('ignora activos sin retorno disponible', () => {
    const w = new Map([['AAPL', 1]])
    expect(portfolioDailyReturn(w, new Map())).toBe(0)
  })
  it('el día de compra entra con peso 0 → no genera retorno espurio', () => {
    const w = new Map<string, number>() // start-of-day sin holdings todavía
    const r = new Map([['NEW', 0.2]])
    expect(portfolioDailyReturn(w, r)).toBe(0)
  })
  it('liquidación total: pesos vacíos → retorno 0 (nunca divide por valor previo)', () => {
    expect(portfolioDailyReturn(new Map(), new Map([['AAPL', 0.3]]))).toBe(0)
  })
})

describe('timeWeightedReturn', () => {
  it('encadena (1+r) y resta 1', () => {
    expect(timeWeightedReturn([0.1, -0.05, 0.02])).toBeCloseTo(1.1 * 0.95 * 1.02 - 1)
  })
  it('sin retornos → 0', () => {
    expect(timeWeightedReturn([])).toBe(0)
  })
  it('split 2:1 con adjusted close NO distorsiona el TWR (retorno ≈ 0 en el día del split)', () => {
    expect(timeWeightedReturn([0.05, 0, 0.03])).toBeCloseTo(1.05 * 1 * 1.03 - 1)
  })
})

describe('normalizeToBase', () => {
  it('produce la serie índice partiendo de 100', () => {
    const out = normalizeToBase([0.1, -0.05], 100)
    expect(out).toHaveLength(3)
    expect(out[0]).toBe(100)
    expect(out[1]).toBeCloseTo(110)
    expect(out[2]).toBeCloseTo(104.5)
  })
  it('con cero retornos devuelve solo el punto base', () => {
    expect(normalizeToBase([], 100)).toEqual([100])
  })
})

describe('absolutePnl', () => {
  it('(V_fin − V_ini) − flujos_netos', () => {
    expect(absolutePnl(1000, 1500, 200)).toBe(300)
  })
  it('para "Todo" (V_ini=0): valor_actual − capital_neto_aportado', () => {
    expect(absolutePnl(0, 1750, 1500)).toBe(250)
  })
})
