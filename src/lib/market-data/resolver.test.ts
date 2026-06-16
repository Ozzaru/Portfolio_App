import { describe, it, expect } from 'vitest'
import { quoteSourceFor } from './resolver'

describe('quoteSourceFor', () => {
  it('acciones/ETF → yahoo, crypto → coingecko', () => {
    expect(quoteSourceFor('stock')).toBe('yahoo')
    expect(quoteSourceFor('etf')).toBe('yahoo')
    expect(quoteSourceFor('crypto')).toBe('coingecko')
  })
  it('cash/other → null (sin cotización de mercado)', () => {
    expect(quoteSourceFor('cash')).toBeNull()
    expect(quoteSourceFor('other')).toBeNull()
  })
})
