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

describe('comisiones de venta (Decisión 14)', () => {
  it('capitaliza los fees de venta en el costo de la posición restante', () => {
    const [h] = computeHoldings([
      { assetId: 'a', ticker: 'AAPL', side: 'buy', quantity: 10, price: 100, fees: 5, executedAt: '2026-01-05' },
      { assetId: 'a', ticker: 'AAPL', side: 'sell', quantity: 5, price: 120, fees: 3, executedAt: '2026-01-06' },
    ])
    // Compra: costBasis = 10*100 + 5 = 1005, avgCost = 100.5
    // Venta:  1005 − 5*100.5 + 3 = 505.5 sobre 5 acciones → avgCost 101.1
    expect(h.quantity).toBe(5)
    expect(h.costBasis).toBeCloseTo(505.5, 10)
    expect(h.avgCost).toBeCloseTo(101.1, 10)
  })

  it('el cierre total resetea el costo: una recompra posterior no hereda el fee de la venta que cerró la posición', () => {
    const [h] = computeHoldings([
      // Compra: costBasis = 10*100 + 5 = 1005, avgCost = 100.5
      { assetId: 'a', ticker: 'AAPL', side: 'buy', quantity: 10, price: 100, fees: 5, executedAt: '2026-01-05' },
      // Venta TOTAL (cierra la posición): costBasis 1005 − 10*100.5 = 0, luego
      // += fee 3 → 3 residual con quantity 0. Sin el fix, ese costBasis=3
      // sobrevive en el Map interno (el holding solo se filtra de la SALIDA,
      // no se borra del Map) y lo hereda la recompra de abajo.
      { assetId: 'a', ticker: 'AAPL', side: 'sell', quantity: 10, price: 120, fees: 3, executedAt: '2026-01-06' },
      // Recompra tras el cierre: si costBasis arrancara en 3 (heredado), daría
      // 403 / 100.75 en vez de 400 / 100. El costo base no puede depender de
      // una venta ya liquidada por completo.
      { assetId: 'a', ticker: 'AAPL', side: 'buy', quantity: 4, price: 100, fees: 0, executedAt: '2026-01-10' },
    ])
    expect(h.quantity).toBe(4)
    expect(h.costBasis).toBe(400)
    expect(h.avgCost).toBe(100)
  })
})
