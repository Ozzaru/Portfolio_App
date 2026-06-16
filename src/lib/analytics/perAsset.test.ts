// src/lib/analytics/perAsset.test.ts
import { describe, it, expect } from 'vitest'
import { perAssetReturns } from './perAsset'
import type { PriceSeriesByTicker } from './types'

const series: PriceSeriesByTicker = new Map([
  [
    'AAPL',
    [
      { date: '2024-01-02', price: 100, adjPrice: 90 },
      { date: '2024-01-05', price: 120, adjPrice: 108 },
    ],
  ],
  [
    'TSLA',
    [{ date: '2024-01-05', price: 200, adjPrice: 200 }], // sin precio al inicio del período
  ],
])

describe('perAssetReturns', () => {
  it('retorno de adjusted close de inicio a fin del período', () => {
    const out = perAssetReturns(['AAPL'], series, '2024-01-02', '2024-01-05')
    expect(out).toEqual([{ ticker: 'AAPL', return: 108 / 90 - 1 }])
  })
  it('null si falta precio al inicio del período', () => {
    const out = perAssetReturns(['TSLA'], series, '2024-01-02', '2024-01-05')
    expect(out).toEqual([{ ticker: 'TSLA', return: null }])
  })
})
