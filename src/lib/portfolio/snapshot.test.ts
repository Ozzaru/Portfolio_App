import { describe, it, expect } from 'vitest'
import { computeSnapshotValue } from './snapshot'
import type { Transaction } from './holdings'

const txs: Transaction[] = [
  { assetId: 'a1', ticker: 'AAPL', side: 'buy', quantity: 10, price: 150, fees: 0, executedAt: '2026-06-10' },
]

describe('computeSnapshotValue', () => {
  it('valor total = cantidad × precio actual', () => {
    expect(computeSnapshotValue(txs, [{ ticker: 'AAPL', price: 175 }], 'CLP')).toBe(1750)
  })
  it('un ticker sin precio aporta 0 al valor', () => {
    expect(computeSnapshotValue(txs, [], 'CLP')).toBe(0)
  })
})
