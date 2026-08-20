// src/lib/analytics/synthetic/simulate.ts
import { priceAsOf } from '../series'
import type { PriceSeriesByTicker } from '../types'
import type { EquityPoint } from './types'

// Cierre ajustado as-of fecha (forward-fill). Lanza si no hay precio ≤ fecha.
function adjAt(priceSeries: PriceSeriesByTicker, ticker: string, date: string): number {
  const p = priceAsOf(priceSeries.get(ticker) ?? [], date)
  if (!p) throw new Error(`sin precio para ${ticker} en ${date}`)
  return p.adjPrice
}

// Simula UNA línea en espacio de capital (sin "acciones"): cada activo evoluciona por
// el factor adj(t)/adj(ancla); en cada fecha de rebalanceo se reancla el capital total
// a los pesos objetivo. turnover_k = ½·Σ|w_i − w_i^pre|, acumulado (Decisión 3 del spec).
export function simulateLine(
  dates: string[],
  priceSeries: PriceSeriesByTicker,
  weights: Record<string, number>,
  rebalanceDates: string[],
  initialCapital: number,
): { equityCurve: EquityPoint[]; turnoverTotal: number } {
  const tickers = Object.keys(weights)
  const rebal = new Set(rebalanceDates)
  const anchorCap: Record<string, number> = {}
  const anchorPrice: Record<string, number> = {}
  for (const t of tickers) {
    anchorCap[t] = initialCapital * weights[t]
    anchorPrice[t] = adjAt(priceSeries, t, dates[0])
  }

  const equityCurve: EquityPoint[] = []
  let turnoverTotal = 0

  for (const d of dates) {
    const cap: Record<string, number> = {}
    let V = 0
    for (const t of tickers) {
      cap[t] = anchorCap[t] * (adjAt(priceSeries, t, d) / anchorPrice[t])
      V += cap[t]
    }
    if (d !== dates[0] && rebal.has(d)) {
      let tv = 0
      for (const t of tickers) {
        const preW = V > 0 ? cap[t] / V : 0
        tv += Math.abs(weights[t] - preW)
      }
      turnoverTotal += 0.5 * tv
      for (const t of tickers) {
        anchorCap[t] = V * weights[t]
        anchorPrice[t] = adjAt(priceSeries, t, d)
      }
    }
    equityCurve.push({ date: d, value: V })
  }
  return { equityCurve, turnoverTotal }
}
