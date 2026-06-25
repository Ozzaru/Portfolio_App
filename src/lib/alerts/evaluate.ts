// src/lib/alerts/evaluate.ts
import type { AlertRow, AlertTrigger } from './types'

// Decide qué alertas (ya filtradas a `active` por el caller) deben pasar a `triggered`.
// Función pura sobre dos mapas estáticos ticker -> precio. Desigualdad ESTRICTA en
// above/below (spot == threshold NO dispara); pct_change usa ≥. Omite (no dispara) si
// falta el spot, o si para pct_change falta/es 0 el cierre anterior (sin NaN ni div/0).
export function evaluateAlerts(
  alerts: AlertRow[],
  currentPrices: Map<string, number>,
  previousClosePrices: Map<string, number>
): AlertTrigger[] {
  const triggers: AlertTrigger[] = []
  for (const a of alerts) {
    const spot = currentPrices.get(a.ticker)
    if (spot === undefined || !Number.isFinite(spot)) continue

    if (a.alertType === 'price_above') {
      if (spot > a.threshold) triggers.push({ id: a.id, reason: `${a.ticker} ${spot} > ${a.threshold}` })
    } else if (a.alertType === 'price_below') {
      if (spot < a.threshold) triggers.push({ id: a.id, reason: `${a.ticker} ${spot} < ${a.threshold}` })
    } else {
      // pct_change
      const prev = previousClosePrices.get(a.ticker)
      if (prev === undefined || !Number.isFinite(prev) || prev === 0) continue
      const movePct = Math.abs(spot / prev - 1) * 100
      if (movePct >= a.threshold) {
        triggers.push({ id: a.id, reason: `${a.ticker} movió ${movePct.toFixed(2)}% ≥ ${a.threshold}%` })
      }
    }
  }
  return triggers
}
