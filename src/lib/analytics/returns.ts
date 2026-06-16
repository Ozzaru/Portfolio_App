// src/lib/analytics/returns.ts

// Retorno diario del portafolio = Σ wᵢ,ₜ₋₁ × rᵢ,ₜ. Los pesos son start-of-day,
// así que una compra del día entra con peso 0 (no genera retorno espurio) y una
// liquidación total deja pesos vacíos → retorno 0 (nunca se divide por V_{t-1}).
export function portfolioDailyReturn(weights: Map<string, number>, assetReturns: Map<string, number>): number {
  let r = 0
  for (const [ticker, w] of weights) {
    const ri = assetReturns.get(ticker)
    if (ri !== undefined) r += w * ri
  }
  return r
}

// TWR encadenado: Π(1 + r) − 1.
export function timeWeightedReturn(dailyReturns: number[]): number {
  return dailyReturns.reduce((acc, r) => acc * (1 + r), 1) - 1
}

// Serie índice normalizada a `base` (default 100). Devuelve N+1 puntos para N
// retornos: el primer punto es `base`.
export function normalizeToBase(dailyReturns: number[], base = 100): number[] {
  const out: number[] = [base]
  let acc = base
  for (const r of dailyReturns) {
    acc *= 1 + r
    out.push(acc)
  }
  return out
}

// P&L absoluto del período en dólares reales (raw close): dinero ganado/perdido por
// mercado, excluyendo aportaciones/retiros. (V_fin − V_ini) − flujos_netos.
export function absolutePnl(startValue: number, endValue: number, netFlows: number): number {
  return endValue - startValue - netFlows
}
