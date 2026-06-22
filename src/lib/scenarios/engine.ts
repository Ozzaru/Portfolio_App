// src/lib/scenarios/engine.ts
import { resolveBeta } from './beta'
import { stressAsset } from './stress'
import type { AssetStress, RunScenarioInput, StressResult } from './types'

export function runScenario(input: RunScenarioInput): StressResult {
  const { config, holdings, priceSeries, benchmarkSeries, benchmarkTicker } = input
  const warnings: string[] = []
  const benchSeries = benchmarkSeries ?? []
  if (benchSeries.length === 0) {
    warnings.push(`benchmark ${benchmarkTicker} no disponible: betas por fallback`)
  }

  const perAsset: AssetStress[] = []
  for (const h of holdings) {
    if (h.currentPrice === null) {
      warnings.push(`${h.ticker} sin precio actual: excluido del escenario`)
      continue
    }
    const { beta, fallback } = resolveBeta(priceSeries.get(h.ticker) ?? [], benchSeries, h.assetType)
    if (fallback) {
      warnings.push(`beta de ${h.ticker} por fallback (${h.assetType}): histórico insuficiente`)
    }
    const a = stressAsset(h, beta, fallback, config)
    if (a) perAsset.push(a)
  }

  const valueBefore = perAsset.reduce((s, a) => s + a.valueBefore, 0)
  const valueAfter = perAsset.reduce((s, a) => s + a.valueAfter, 0)
  const pnlAbs = valueAfter - valueBefore
  const pnlPct = valueBefore > 0 ? valueAfter / valueBefore - 1 : 0
  // Descriptiva: peso por valor crudo. NUNCA se usa como base del P&L (Decisión 5).
  const aggregateBeta =
    valueBefore > 0 ? perAsset.reduce((s, a) => s + (a.valueBefore / valueBefore) * a.beta, 0) : 0

  perAsset.sort((x, y) => x.lossContribAbs - y.lossContribAbs) // más negativo (peor) primero

  return {
    portfolio: { valueBefore, valueAfter, pnlAbs, pnlPct, aggregateBeta },
    vsBenchmark: { marketShock: config.marketShock, portfolioPct: pnlPct },
    perAsset,
    warnings,
  }
}
