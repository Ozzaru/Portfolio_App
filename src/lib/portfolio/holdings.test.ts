// src/lib/portfolio/holdings.test.ts
import { describe, it, expect } from 'vitest'
import { computeHoldings, type Transaction } from '@/lib/portfolio/holdings'

function tx(partial: Partial<Transaction> & Pick<Transaction, 'side' | 'quantity' | 'price'>): Transaction {
  return {
    assetId: partial.assetId ?? 'a1',
    ticker: partial.ticker ?? 'AAPL',
    fees: partial.fees ?? 0,
    executedAt: partial.executedAt ?? '2026-01-15',
    ...partial,
  } as Transaction
}

describe('computeHoldings', () => {
  it('devuelve lista vacía sin transacciones', () => {
    expect(computeHoldings([])).toEqual([])
  })

  it('acumula una compra incluyendo comisiones en el costo', () => {
    const [h] = computeHoldings([tx({ side: 'buy', quantity: 10, price: 100, fees: 5 })])
    expect(h.quantity).toBe(10)
    expect(h.costBasis).toBe(1005)
    expect(h.avgCost).toBeCloseTo(100.5)
  })

  it('reduce a costo promedio en venta parcial', () => {
    const [h] = computeHoldings([
      tx({ side: 'buy', quantity: 10, price: 100 }),
      tx({ side: 'sell', quantity: 4, price: 150, executedAt: '2026-02-01' }),
    ])
    expect(h.quantity).toBe(6)
    expect(h.costBasis).toBe(600)
    expect(h.avgCost).toBe(100)
  })

  it('elimina posiciones totalmente vendidas', () => {
    const result = computeHoldings([
      tx({ side: 'buy', quantity: 10, price: 100 }),
      tx({ side: 'sell', quantity: 10, price: 120, executedAt: '2026-02-01' }),
    ])
    expect(result).toEqual([])
  })

  it('recorta ventas que exceden el saldo disponible', () => {
    const result = computeHoldings([
      tx({ side: 'buy', quantity: 5, price: 100 }),
      tx({ side: 'sell', quantity: 99, price: 120, executedAt: '2026-02-01' }),
    ])
    expect(result).toEqual([])
  })

  it('mantiene activos independientes', () => {
    const result = computeHoldings([
      tx({ side: 'buy', quantity: 10, price: 100 }),
      tx({ assetId: 'a2', ticker: 'BTC', side: 'buy', quantity: 0.5, price: 60000 }),
    ])
    expect(result).toHaveLength(2)
    const btc = result.find((h) => h.ticker === 'BTC')!
    expect(btc.quantity).toBe(0.5)
    expect(btc.costBasis).toBe(30000)
  })

  it('procesa transacciones desordenadas por fecha', () => {
    const [h] = computeHoldings([
      tx({ side: 'sell', quantity: 4, price: 150, executedAt: '2026-03-01' }),
      tx({ side: 'buy', quantity: 10, price: 100, executedAt: '2026-01-01' }),
    ])
    expect(h.quantity).toBe(6)
    expect(h.costBasis).toBe(600)
  })
})
