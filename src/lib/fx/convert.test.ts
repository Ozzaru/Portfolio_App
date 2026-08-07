// src/lib/fx/convert.test.ts
import { describe, it, expect } from 'vitest'
import type { PricePointAdj, PriceSeriesByTicker } from '@/lib/analytics/types'
import type { Transaction } from '@/lib/portfolio/holdings'
import { fxAsOf, convertSeries, toBaseCurrency, transactionsToBaseCurrency } from './convert'

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

describe('convertSeries', () => {
  const usdPoints: PricePointAdj[] = [
    { date: '2026-01-05', price: 100, adjPrice: 90 },
    { date: '2026-01-06', price: 200, adjPrice: 180 },
  ]

  it('multiplica price y adjPrice por el FX del día (dirección: CLP por 1 USD)', () => {
    const out = convertSeries(usdPoints, 'USD', FX_SERIES)
    expect(out[0]).toEqual({ date: '2026-01-05', price: 90_000, adjPrice: 81_000 })
    expect(out[1]).toEqual({ date: '2026-01-06', price: 182_000, adjPrice: 163_800 })
  })

  it('deja los valores en CLP sin modificar (pasa directo, sin redondeo)', () => {
    const clpPoints: PricePointAdj[] = [{ date: '2026-01-05', price: 79.68, adjPrice: 79.68 }]
    expect(convertSeries(clpPoints, 'CLP', FX_SERIES)).toEqual(clpPoints)
  })

  it('descarta el punto si falta FX para su fecha (nunca lo deja pasar sin convertir)', () => {
    const points: PricePointAdj[] = [
      { date: '2026-01-02', price: 100, adjPrice: 100 },
      { date: '2026-01-05', price: 100, adjPrice: 100 },
    ]
    const out = convertSeries(points, 'USD', FX_SERIES)
    expect(out).toHaveLength(1)
    expect(out[0].date).toBe('2026-01-05')
  })

  it('nunca agrega fechas: la salida es subconjunto de la entrada', () => {
    const out = convertSeries(usdPoints, 'USD', FX_SERIES)
    const input = new Set(usdPoints.map((p) => p.date))
    for (const p of out) expect(input.has(p.date)).toBe(true)
  })

  it('lanza ante una moneda no soportada en vez de convertirla mal', () => {
    expect(() => convertSeries(usdPoints, 'EUR', FX_SERIES)).toThrow(/no soportada/)
  })
})

describe('toBaseCurrency', () => {
  it('convierte los USD y deja los CLP intactos, en el mismo mapa', () => {
    const series: PriceSeriesByTicker = new Map([
      ['AAPL', [{ date: '2026-01-05', price: 100, adjPrice: 100 }]],
      ['ENELCHILE.SN', [{ date: '2026-01-05', price: 79.68, adjPrice: 79.68 }]],
    ])
    const currencies = new Map([
      ['AAPL', 'USD'],
      ['ENELCHILE.SN', 'CLP'],
    ])
    const out = toBaseCurrency(series, currencies, FX_SERIES)
    expect(out.get('AAPL')![0].price).toBe(90_000)
    expect(out.get('ENELCHILE.SN')![0].price).toBe(79.68)
  })

  it('asume USD cuando el ticker no tiene moneda declarada (default del esquema)', () => {
    const series: PriceSeriesByTicker = new Map([
      ['SPY', [{ date: '2026-01-05', price: 100, adjPrice: 100 }]],
    ])
    const out = toBaseCurrency(series, new Map(), FX_SERIES)
    expect(out.get('SPY')![0].price).toBe(90_000)
  })
})

describe('transactionsToBaseCurrency', () => {
  const buy = (ticker: string, executedAt: string): Transaction => ({
    assetId: 'a1',
    ticker,
    side: 'buy',
    quantity: 10,
    price: 100,
    fees: 5,
    executedAt,
  })
  const currencies = new Map([
    ['AAPL', 'USD'],
    ['ENELCHILE.SN', 'CLP'],
  ])

  it('usa el FX de executedAt, NO el de hoy', () => {
    const [tx] = transactionsToBaseCurrency([buy('AAPL', '2026-01-05')], currencies, FX_SERIES)
    expect(tx.price).toBe(90_000)
    expect(tx.fees).toBe(4_500)
  })

  it('convierte cada transacción con el FX de SU propia fecha', () => {
    const out = transactionsToBaseCurrency(
      [buy('AAPL', '2026-01-05'), buy('AAPL', '2026-01-09')],
      currencies,
      FX_SERIES
    )
    expect(out[0].price).toBe(90_000)
    expect(out[1].price).toBe(95_000)
  })

  it('deja las transacciones en CLP intactas', () => {
    const tx = buy('ENELCHILE.SN', '2026-01-05')
    expect(transactionsToBaseCurrency([tx], currencies, FX_SERIES)[0]).toEqual(tx)
  })

  it('LANZA si falta FX: descartar una compra falsearía la cartera', () => {
    expect(() =>
      transactionsToBaseCurrency([buy('AAPL', '2026-01-02')], currencies, FX_SERIES)
    ).toThrow(/USDCLP=X para 2026-01-02/)
  })
})
