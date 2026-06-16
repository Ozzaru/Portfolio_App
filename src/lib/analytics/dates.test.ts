// src/lib/analytics/dates.test.ts
import { describe, it, expect } from 'vitest'
import { periodStartDate } from './dates'

describe('periodStartDate', () => {
  const today = '2026-06-16'
  const firstTx = '2024-01-10'

  it('1W resta 7 días', () => {
    expect(periodStartDate('1W', firstTx, today)).toBe('2026-06-09')
  })
  it('1M resta un mes', () => {
    expect(periodStartDate('1M', firstTx, today)).toBe('2026-05-16')
  })
  it('3M resta tres meses', () => {
    expect(periodStartDate('3M', firstTx, today)).toBe('2026-03-16')
  })
  it('1Y resta un año', () => {
    expect(periodStartDate('1Y', firstTx, today)).toBe('2025-06-16')
  })
  it('ALL devuelve la primera transacción', () => {
    expect(periodStartDate('ALL', firstTx, today)).toBe('2024-01-10')
  })
  it('nunca empieza antes de la primera transacción', () => {
    expect(periodStartDate('1Y', '2026-03-01', today)).toBe('2026-03-01')
  })
})
