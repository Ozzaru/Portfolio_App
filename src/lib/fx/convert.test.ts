// src/lib/fx/convert.test.ts
import { describe, it, expect } from 'vitest'
import type { PricePointAdj } from '@/lib/analytics/types'
import { fxAsOf } from './convert'

const fx = (date: string, price: number): PricePointAdj => ({ date, price, adjPrice: price })

const FX_SERIES: PricePointAdj[] = [
  fx('2026-01-05', 900),
  fx('2026-01-06', 910),
  fx('2026-01-09', 950),
]

describe('fxAsOf', () => {
  it('devuelve el valor de la fecha exacta', () => {
    expect(fxAsOf(FX_SERIES, '2026-01-06')).toBe(910)
  })

  it('hace forward-fill: usa el último publicado si no hay dato ese día', () => {
    expect(fxAsOf(FX_SERIES, '2026-01-08')).toBe(910)
  })

  it('devuelve null antes del inicio de la serie', () => {
    expect(fxAsOf(FX_SERIES, '2026-01-02')).toBeNull()
  })

  it('devuelve null si el tipo de cambio no es positivo', () => {
    expect(fxAsOf([fx('2026-01-05', 0)], '2026-01-05')).toBeNull()
  })

  it('devuelve null con serie vacía', () => {
    expect(fxAsOf([], '2026-01-05')).toBeNull()
  })
})
