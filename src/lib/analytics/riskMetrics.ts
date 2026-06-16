// src/lib/analytics/riskMetrics.ts

const TRADING_DAYS = 252

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

// Desviación estándar muestral (n-1). 0 si hay menos de 2 datos.
export function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  const variance = xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)
  return Math.sqrt(variance)
}

// Volatilidad anualizada: desv. estándar de los retornos (días hábiles) × √252.
export function volatility(returns: number[]): number | null {
  if (returns.length < 2) return null
  return stdDev(returns) * Math.sqrt(TRADING_DAYS)
}

// Sharpe desde retornos diarios (consistencia dimensional): media(r − rf_diario) /
// desv_std(r) × √252. rf anual por defecto 0.
export function sharpe(returns: number[], rfAnnual = 0): number | null {
  if (returns.length < 2) return null
  const sd = stdDev(returns)
  if (sd === 0) return null
  const dailyRf = rfAnnual / TRADING_DAYS
  return ((mean(returns) - dailyRf) / sd) * Math.sqrt(TRADING_DAYS)
}

// Máximo drawdown sobre una serie índice (mayor caída pico-a-valle). Fracción ≤ 0.
export function maxDrawdown(indexSeries: number[]): number | null {
  if (indexSeries.length < 2) return null
  let peak = indexSeries[0]
  let maxDd = 0
  for (const v of indexSeries) {
    if (v > peak) peak = v
    if (peak > 0) {
      const dd = v / peak - 1
      if (dd < maxDd) maxDd = dd
    }
  }
  return maxDd
}
