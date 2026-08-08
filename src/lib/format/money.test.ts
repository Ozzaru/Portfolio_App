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

  it('degrada en vez de lanzar con un código de moneda inválido', () => {
    // El CHECK de la BD solo exige 3 caracteres en mayúsculas, así que un código
    // no-ISO es persistible. Intl lanza RangeError con él, y esto se usa en el
    // render de páginas cliente: una celda mal formateada es aceptable, tumbar
    // la página no.
    const out = formatMoney(1234.5, '123')
    expect(out).toContain('1.234')
    expect(out).toContain('123')
  })
})
