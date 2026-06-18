// src/lib/backtest/types.ts
export type RebalanceFrequency = 'monthly' | 'quarterly'

export interface EquityPoint {
  date: string // YYYY-MM-DD
  value: number // valor del portafolio en $ ese día
}

export interface BacktestConfig {
  targetWeights: Record<string, number> // ticker -> peso (se normaliza)
  frequency: RebalanceFrequency
  from: string // YYYY-MM-DD
  to: string // YYYY-MM-DD
  initialCapital: number
  weightsFromCurrent?: boolean // true si el usuario usó "Mis pesos actuales" (banner de sesgo)
}

export interface StrategyLine {
  equityCurve: EquityPoint[]
  totalReturn: number
  cagr: number | null
  sharpe: number | null
  maxDrawdown: number | null
  turnoverTotal: number // turnover acumulado (one-way); 0 para buy & hold y benchmark
}

export interface VsBenchmark {
  geometric: number | null // (1+Rt_línea)/(1+Rt_bench) − 1
  cagrSpread: number | null // cagr_línea − cagr_bench
}

export interface BacktestResult {
  lines: {
    rebalanced: StrategyLine
    buyHold: StrategyLine
    benchmark: StrategyLine | null
  }
  vsBenchmark: VsBenchmark
  warnings: string[]
  benchmarkError: string | null
}
