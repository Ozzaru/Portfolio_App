// src/lib/scenarios/beta.ts
import type { PricePointAdj } from '@/lib/analytics/types'
import { mean } from '@/lib/analytics/riskMetrics'
import type { AssetType } from './types'

// Mínimo de observaciones diarias comunes para fiarse de la beta histórica.
export const MIN_BETA_OBS = 20

// Beta de fallback por tipo de activo (Decisión 3 del spec). cash no co-mueve con el
// mercado; crypto es alta beta sistémica (heurística tuneable); equity-ish = neutral.
export const FALLBACK_BETA_BY_TYPE: Record<AssetType, number> = {
  stock: 1.0,
  etf: 1.0,
  other: 1.0,
  crypto: 1.5,
  cash: 0.0,
}

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

// Beta efectiva del activo: histórica si hay >= MIN_BETA_OBS obs comunes y es finita;
// si no, fallback por asset_type (Decisión 3).
export function resolveBeta(
  assetSeries: PricePointAdj[],
  benchSeries: PricePointAdj[],
  assetType: AssetType
): { beta: number; fallback: boolean } {
  const { rA, rB } = alignedAdjReturns(assetSeries, benchSeries)
  if (rA.length >= MIN_BETA_OBS) {
    const b = computeBeta(rA, rB)
    if (b !== null && Number.isFinite(b)) return { beta: b, fallback: false }
  }
  return { beta: FALLBACK_BETA_BY_TYPE[assetType], fallback: true }
}
