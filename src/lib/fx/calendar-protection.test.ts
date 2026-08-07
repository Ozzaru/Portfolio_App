// src/lib/fx/calendar-protection.test.ts
import { describe, it, expect } from 'vitest'
import { computeAnalytics } from '@/lib/analytics/engine'
import type { PricePointAdj, PriceSeriesByTicker } from '@/lib/analytics/types'
import type { Transaction } from '@/lib/portfolio/holdings'
import { toBaseCurrency, transactionsToBaseCurrency } from './convert'

const pt = (date: string, price: number): PricePointAdj => ({ date, price, adjPrice: price })

describe('protección de calendario tras convertir a CLP', () => {
  it('un feriado chileno no diluye la correlación (intersección, no forward-fill)', () => {
    // AAPL cotiza los 4 días; ENELCHILE.SN no cotiza el 07 (feriado en Chile).
    // En las fechas COMPARTIDAS ambos se mueven idéntico → correlación exacta 1.
    // Si el motor usara la unión con forward-fill, ENELCHILE tendría un retorno
    // 0 artificial el 07 y la correlación caería por debajo de 1.
    const series: PriceSeriesByTicker = new Map([
      ['AAPL', [pt('2026-01-05', 100), pt('2026-01-06', 110), pt('2026-01-07', 105), pt('2026-01-08', 115.5)]],
      ['ENELCHILE.SN', [pt('2026-01-05', 80), pt('2026-01-06', 88), pt('2026-01-08', 92.4)]],
    ])
    // FX constante: aísla el efecto del calendario del efecto cambiario.
    const fxSeries: PricePointAdj[] = [pt('2026-01-01', 900)]
    const currencies = new Map([
      ['AAPL', 'USD'],
      ['ENELCHILE.SN', 'CLP'],
    ])

    const transactions: Transaction[] = [
      { assetId: 'a1', ticker: 'AAPL', side: 'buy', quantity: 1, price: 100, fees: 0, executedAt: '2026-01-05' },
      { assetId: 'a2', ticker: 'ENELCHILE.SN', side: 'buy', quantity: 1, price: 80, fees: 0, executedAt: '2026-01-05' },
    ]

    const result = computeAnalytics({
      transactions: transactionsToBaseCurrency(transactions, currencies, fxSeries),
      priceSeries: toBaseCurrency(series, currencies, fxSeries),
      benchmarkSeries: null,
      benchmarkTicker: 'SPY',
      assetTypeByTicker: new Map([
        ['AAPL', 'stock'],
        ['ENELCHILE.SN', 'stock'],
      ]),
      period: 'ALL',
      today: '2026-01-08',
    })

    const i = result.correlation.tickers.indexOf('AAPL')
    const j = result.correlation.tickers.indexOf('ENELCHILE.SN')
    expect(result.correlation.matrix[i][j]).toBeCloseTo(1, 10)
  })

  it('convertir no altera el conjunto de fechas de cada ticker', () => {
    const series: PriceSeriesByTicker = new Map([
      ['AAPL', [pt('2026-01-05', 100), pt('2026-01-06', 110)]],
      ['ENELCHILE.SN', [pt('2026-01-05', 80)]],
    ])
    const fxSeries: PricePointAdj[] = [pt('2026-01-01', 900)]
    const out = toBaseCurrency(
      series,
      new Map([
        ['AAPL', 'USD'],
        ['ENELCHILE.SN', 'CLP'],
      ]),
      fxSeries
    )
    expect(out.get('AAPL')!.map((p) => p.date)).toEqual(['2026-01-05', '2026-01-06'])
    expect(out.get('ENELCHILE.SN')!.map((p) => p.date)).toEqual(['2026-01-05'])
  })
})
