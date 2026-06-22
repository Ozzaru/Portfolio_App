// src/lib/scenarios/types.ts
import type { PricePointAdj, PriceSeriesByTicker } from '@/lib/analytics/types'

// Refleja el enum real del esquema (0001_init.sql).
export type AssetType = 'stock' | 'etf' | 'crypto' | 'cash' | 'other'

export interface ScenarioConfig {
  marketShock: number // fracción con signo, ej. -0.20 = -20%
  overrides: Record<string, number> // ticker -> shock en fracción
}

export interface ScenarioHolding {
  ticker: string
  assetType: AssetType
  quantity: number
  currentPrice: number | null // precio crudo actual; null si falta
}

export interface AssetStress {
  ticker: string
  beta: number
  betaFallback: boolean
  shockApplied: number // fracción aplicada (override o beta·marketShock)
  valueBefore: number
  valueAfter: number
  lossContribAbs: number // valueAfter - valueBefore (negativo = pérdida)
}

export interface StressResult {
  portfolio: {
    valueBefore: number
    valueAfter: number
    pnlAbs: number
    pnlPct: number // bottom-up: Σ after / Σ before − 1
    aggregateBeta: number // descriptiva: Σ wᵢ·βᵢ (peso por valor crudo)
  }
  vsBenchmark: {
    marketShock: number // el S&P cae exactamente esto
    portfolioPct: number // = portfolio.pnlPct
  }
  perAsset: AssetStress[] // ordenado por lossContribAbs asc (peor primero)
  warnings: string[]
}

export interface RunScenarioInput {
  config: ScenarioConfig
  holdings: ScenarioHolding[]
  priceSeries: PriceSeriesByTicker // histórico de la cartera (para betas)
  benchmarkSeries: PricePointAdj[] | null
  benchmarkTicker: string
}
