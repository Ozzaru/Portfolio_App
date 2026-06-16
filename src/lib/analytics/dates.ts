// src/lib/analytics/dates.ts
import type { Period } from './types'

// Fecha de inicio del período. Nunca antes de la primera transacción (no existe
// portafolio antes). 'ALL' = primera transacción. Cálculo en UTC.
export function periodStartDate(period: Period, firstTxDate: string, today: string): string {
  if (period === 'ALL') return firstTxDate
  const d = new Date(`${today}T00:00:00Z`)
  switch (period) {
    case '1W':
      d.setUTCDate(d.getUTCDate() - 7)
      break
    case '1M':
      d.setUTCMonth(d.getUTCMonth() - 1)
      break
    case '3M':
      d.setUTCMonth(d.getUTCMonth() - 3)
      break
    case '1Y':
      d.setUTCFullYear(d.getUTCFullYear() - 1)
      break
  }
  const candidate = d.toISOString().slice(0, 10)
  return candidate > firstTxDate ? candidate : firstTxDate
}
