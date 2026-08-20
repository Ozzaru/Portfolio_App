// src/lib/analytics/beta.ts
import type { PricePointAdj } from './types'
import { mean } from './riskMetrics'

// Mínimo de observaciones diarias comunes para fiarse de la beta histórica.
// ~1 mes operativo. Ver §5 del spec de limpieza para la semántica exacta.
export const MIN_BETA_OBS = 20

// Retornos diarios de cierre AJUSTADO sobre las fechas comunes (consecutivas) de ambas series.
export function alignedAdjReturns(
  a: PricePointAdj[],
  b: PricePointAdj[]
): { rA: number[]; rB: number[] } {
  const bByDate = new Map(b.map((p) => [p.date, p.adjPrice]))
  const common: { date: string; a: number; b: number }[] = []
  for (const p of a) {
    const bp = bByDate.get(p.date)
    if (bp !== undefined) common.push({ date: p.date, a: p.adjPrice, b: bp })
  }
  common.sort((x, y) => x.date.localeCompare(y.date))
  const rA: number[] = []
  const rB: number[] = []
  for (let i = 1; i < common.length; i++) {
    const pa = common[i - 1].a
    const pb = common[i - 1].b
    if (pa > 0 && pb > 0) {
      rA.push(common[i].a / pa - 1)
      rB.push(common[i].b / pb - 1)
    }
  }
  return { rA, rB }
}

// Beta = cov(rA,rB) / var(rB). La normalización 1/(n-1) se cancela, así que se usan sumas.
// null si hay < 2 observaciones o var(rB) = 0. Función pura sobre arrays alineados.
export function computeBeta(rA: number[], rB: number[]): number | null {
  const n = Math.min(rA.length, rB.length)
  if (n < 2) return null
  const ma = mean(rA.slice(0, n))
  const mb = mean(rB.slice(0, n))
  let cov = 0
  let varB = 0
  for (let i = 0; i < n; i++) {
    cov += (rA[i] - ma) * (rB[i] - mb)
    varB += (rB[i] - mb) ** 2
  }
  if (varB === 0) return null
  return cov / varB
}

// Beta histórica del activo vs. benchmark. Devuelve null —y la UI muestra "—"— cuando
// no hay evidencia suficiente: por debajo de `minObs` observaciones comunes, con varianza
// nula en el benchmark, o si el resultado no es finito. Nunca inventa un valor por
// defecto: una beta supuesta presentada como medición engaña más que un guion.
//
// `minObs` es parámetro (no constante) porque MIN_BETA_OBS asume retornos DIARIOS; sobre
// retornos semanales o mensuales el umbral razonable es otro (§5 del spec de limpieza).
export function beta(
  assetSeries: PricePointAdj[],
  benchSeries: PricePointAdj[],
  minObs: number = MIN_BETA_OBS
): number | null {
  const { rA, rB } = alignedAdjReturns(assetSeries, benchSeries)
  if (rA.length < minObs) return null
  const b = computeBeta(rA, rB)
  return b !== null && Number.isFinite(b) ? b : null
}
