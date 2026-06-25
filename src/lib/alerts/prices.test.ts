// src/lib/alerts/prices.test.ts
import { describe, it, expect } from 'vitest'
import { deriveCurrentAndPrevClose, type PriceRow } from './prices'

describe('deriveCurrentAndPrevClose', () => {
  it('current = fecha máxima; prevClose = fecha previa distinta', () => {
    const rows: PriceRow[] = [
      { ticker: 'AAPL', price: 100, price_date: '2026-06-16' },
      { ticker: 'AAPL', price: 98, price_date: '2026-06-15' },
      { ticker: 'AAPL', price: 95, price_date: '2026-06-12' },
    ]
    const { current, prevClose } = deriveCurrentAndPrevClose(rows)
    expect(current.get('AAPL')).toBe(100)
    expect(prevClose.get('AAPL')).toBe(98)
  })

  it('varias fuentes el mismo día NO se usan como prevClose (Decisión 4)', () => {
    const rows: PriceRow[] = [
      { ticker: 'AAPL', price: 100, price_date: '2026-06-16' },
      { ticker: 'AAPL', price: 101, price_date: '2026-06-16' }, // mismo día, otra fuente
      { ticker: 'AAPL', price: 98, price_date: '2026-06-15' },
    ]
    const { current, prevClose } = deriveCurrentAndPrevClose(rows)
    expect([100, 101]).toContain(current.get('AAPL')) // una del 06-16
    expect(prevClose.get('AAPL')).toBe(98) // NO la otra del 06-16
  })

  it('un solo día → sin prevClose', () => {
    const rows: PriceRow[] = [{ ticker: 'X', price: 10, price_date: '2026-06-16' }]
    const { current, prevClose } = deriveCurrentAndPrevClose(rows)
    expect(current.get('X')).toBe(10)
    expect(prevClose.has('X')).toBe(false)
  })
})
