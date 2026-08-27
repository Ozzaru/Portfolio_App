// src/lib/fx/floor.test.ts
//
// Regresión: la línea del benchmark desapareció al estrechar la serie FX.
//
// `convertSeries` descarta —a propósito, Regla 3— todo punto para el que no hay
// tipo de cambio. Mientras `loadFxSeries` traía el histórico completo eso nunca
// se activaba: el FX siempre empezaba antes que cualquier serie a convertir.
//
// Al ponerle piso `firstTx`, el FX pasó a poder empezar DESPUÉS del punto más
// antiguo que debe convertir: la semilla del benchmark es `max(fecha <
// windowStart)` y no tiene cota inferior. Si el benchmark está desactualizado y
// su única fila es esa semilla anterior a `firstTx`, se descarta, la serie queda
// vacía y el motor omite la línea sin decir nada.
//
// El piso correcto no es `firstTx`: es la fecha más antigua de CUALQUIER serie
// que el FX vaya a convertir. Esa fecha ya está disponible sin consultas extra
// —es el mínimo `price_date` de las filas que devolvió `prices_windowed`.

import { describe, it, expect } from 'vitest'
import { fxFloor } from './floor'
import { convertSeries } from './convert'

describe('convertSeries — el comportamiento que hace necesario el piso', () => {
  it('descarta los puntos anteriores al primer punto del FX', () => {
    const bench = [{ date: '2025-12-31', price: 400, adjPrice: 400 }]
    const fx = [{ date: '2026-01-14', price: 950, adjPrice: 950 }]
    // No es un bug de convertSeries: sin tipo de cambio, dejar pasar el punto
    // sin convertir inyectaría un error de ~950x. Descartar es lo correcto.
    expect(convertSeries(bench, 'USD', fx, 'CLP')).toEqual([])
  })

  it('los conserva cuando el FX empieza antes', () => {
    const bench = [{ date: '2025-12-31', price: 400, adjPrice: 400 }]
    const fx = [{ date: '2025-12-30', price: 950, adjPrice: 950 }]
    expect(convertSeries(bench, 'USD', fx, 'CLP')).toHaveLength(1)
  })
})

describe('fxFloor', () => {
  it('usa la primera transacción cuando todos los precios son posteriores', () => {
    // Caso normal: el cost basis necesita FX desde la primera compra, y ninguna
    // serie de precios se remonta más atrás.
    expect(fxFloor('2026-01-15', ['2026-01-20', '2026-02-03'])).toBe('2026-01-15')
  })

  it('baja hasta la semilla del benchmark cuando ésta precede a la primera transacción', () => {
    // El caso de la regresión: el benchmark trae una semilla de 2025-12-31, que
    // es anterior a la primera transacción. El FX tiene que llegar hasta ahí.
    expect(fxFloor('2026-01-15', ['2025-12-31', '2026-01-20'])).toBe('2025-12-31')
  })

  it('sin precios, cae a la primera transacción', () => {
    expect(fxFloor('2026-01-15', [])).toBe('2026-01-15')
  })

  it('el resultado siempre es <= a todo lo que hay que convertir', () => {
    const firstTx = '2026-01-15'
    const dates = ['2025-11-03', '2026-01-20', '2026-03-01']
    const floor = fxFloor(firstTx, dates)
    for (const d of dates) expect(floor <= d).toBe(true)
    expect(floor <= firstTx).toBe(true)
  })
})
