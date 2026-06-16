import { describe, it, expect } from 'vitest'
import { unixToISODate, msToISODate, isoYearsAgo } from './dates'

describe('date helpers', () => {
  it('convierte segundos unix a YYYY-MM-DD (UTC)', () => {
    expect(unixToISODate(1704153600)).toBe('2024-01-02') // 2024-01-02T00:00:00Z
  })
  it('convierte milisegundos a YYYY-MM-DD (UTC)', () => {
    expect(msToISODate(1704153600000)).toBe('2024-01-02')
  })
  it('resta años respecto a una fecha base', () => {
    expect(isoYearsAgo(5, new Date('2026-06-15T00:00:00Z'))).toBe('2021-06-15')
  })
})
