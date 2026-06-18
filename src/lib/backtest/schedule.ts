// src/lib/backtest/schedule.ts
import type { RebalanceFrequency } from './types'

// Fechas de rebalanceo = primer día operativo de cada mes nuevo posterior a t0
// (trimestral: solo los que caen a +3, +6, … meses de t0). En t0 solo hay
// asignación inicial, no cuenta como rebalanceo (ver Decisión 5 del spec).
export function rebalanceDates(tradingDates: string[], frequency: RebalanceFrequency): string[] {
  if (tradingDates.length === 0) return []
  const ym = (d: string) => d.slice(0, 7) // "YYYY-MM"
  const monthsSince = (d: string, t0: string) => {
    const [y, m] = d.slice(0, 7).split('-').map(Number)
    const [y0, m0] = t0.slice(0, 7).split('-').map(Number)
    return (y - y0) * 12 + (m - m0)
  }
  const t0 = tradingDates[0]
  const out: string[] = []
  let prevKey = ym(t0)
  for (let i = 1; i < tradingDates.length; i++) {
    const d = tradingDates[i]
    const key = ym(d)
    if (key !== prevKey) {
      prevKey = key
      if (frequency === 'monthly' || monthsSince(d, t0) % 3 === 0) out.push(d)
    }
  }
  return out
}
