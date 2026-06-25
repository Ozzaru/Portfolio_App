// src/lib/alerts/evaluate.test.ts
import { describe, it, expect } from 'vitest'
import { evaluateAlerts } from './evaluate'
import type { AlertRow } from './types'

const m = (entries: [string, number][]) => new Map(entries)

describe('evaluateAlerts', () => {
  it('price_above dispara solo si spot > threshold (estricto)', () => {
    const alerts: AlertRow[] = [{ id: 'a', ticker: 'AAPL', alertType: 'price_above', threshold: 150, status: 'active' }]
    expect(evaluateAlerts(alerts, m([['AAPL', 151]]), new Map())).toHaveLength(1)
    expect(evaluateAlerts(alerts, m([['AAPL', 150]]), new Map())).toHaveLength(0) // borde exacto: no dispara
    expect(evaluateAlerts(alerts, m([['AAPL', 149]]), new Map())).toHaveLength(0)
  })

  it('price_below dispara solo si spot < threshold (estricto)', () => {
    const alerts: AlertRow[] = [{ id: 'a', ticker: 'AAPL', alertType: 'price_below', threshold: 150, status: 'active' }]
    expect(evaluateAlerts(alerts, m([['AAPL', 149]]), new Map())).toHaveLength(1)
    expect(evaluateAlerts(alerts, m([['AAPL', 150]]), new Map())).toHaveLength(0)
  })

  it('pct_change dispara con |Δ%| ≥ threshold en ambos sentidos', () => {
    const alerts: AlertRow[] = [{ id: 'a', ticker: 'X', alertType: 'pct_change', threshold: 5, status: 'active' }]
    expect(evaluateAlerts(alerts, m([['X', 106]]), m([['X', 100]]))).toHaveLength(1) // +6%
    expect(evaluateAlerts(alerts, m([['X', 94]]), m([['X', 100]]))).toHaveLength(1) // -6%
    expect(evaluateAlerts(alerts, m([['X', 105]]), m([['X', 100]]))).toHaveLength(1) // exacto 5% → dispara (≥)
    expect(evaluateAlerts(alerts, m([['X', 103]]), m([['X', 100]]))).toHaveLength(0) // +3%
  })

  it('pct_change se omite si falta prevClose o es 0 (sin NaN ni división por cero)', () => {
    const alerts: AlertRow[] = [{ id: 'a', ticker: 'X', alertType: 'pct_change', threshold: 5, status: 'active' }]
    expect(evaluateAlerts(alerts, m([['X', 100]]), new Map())).toHaveLength(0) // sin prev
    expect(evaluateAlerts(alerts, m([['X', 100]]), m([['X', 0]]))).toHaveLength(0) // prev 0
  })

  it('omite alertas cuyo ticker no tiene spot', () => {
    const alerts: AlertRow[] = [{ id: 'a', ticker: 'AAPL', alertType: 'price_above', threshold: 150, status: 'active' }]
    expect(evaluateAlerts(alerts, new Map(), new Map())).toHaveLength(0)
  })
})
