// src/lib/format/money.test.ts
import { describe, it, expect } from 'vitest'
import { formatMoney } from './money'

// Las aserciones usan `toContain` a propósito: la salida exacta de Intl
// (símbolo, espacios no separables) varía entre versiones de ICU/Node y haría
// el test frágil. Lo que importa es la agrupación y los decimales.
describe('formatMoney', () => {
  it('formatea CLP sin decimales y con separador de miles', () => {
    expect(formatMoney(19442, 'CLP')).toContain('19.442')
    expect(formatMoney(19442, 'CLP')).not.toContain(',')
  })

  it('formatea USD con dos decimales', () => {
    expect(formatMoney(293.08, 'USD')).toContain('293,08')
  })

  it('redondea CLP al peso entero', () => {
    expect(formatMoney(19441.92, 'CLP')).toContain('19.442')
  })

  it('devuelve — para null', () => {
    expect(formatMoney(null, 'CLP')).toBe('—')
  })

  it('devuelve — para valores no finitos', () => {
    expect(formatMoney(Number.NaN, 'CLP')).toBe('—')
  })
})
