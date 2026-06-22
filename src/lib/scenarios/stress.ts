// src/lib/scenarios/stress.ts
import type { AssetStress, ScenarioConfig, ScenarioHolding } from './types'

// Aplica el shock a una posición valuada a precio CRUDO (Decisión 6).
// shock = override ?? beta·marketShock. Devuelve null si no hay precio actual.
export function stressAsset(
  holding: ScenarioHolding,
  beta: number,
  betaFallback: boolean,
  config: ScenarioConfig
): AssetStress | null {
  if (holding.currentPrice === null) return null
  const valueBefore = holding.quantity * holding.currentPrice
  const override = config.overrides[holding.ticker]
  const shockApplied = override !== undefined ? override : beta * config.marketShock
  const valueAfter = valueBefore * (1 + shockApplied)
  return {
    ticker: holding.ticker,
    beta,
    betaFallback,
    shockApplied,
    valueBefore,
    valueAfter,
    lossContribAbs: valueAfter - valueBefore,
  }
}
