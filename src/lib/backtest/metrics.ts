// src/lib/backtest/metrics.ts
import { sharpe, maxDrawdown } from '@/lib/analytics/riskMetrics'
import type { EquityPoint } from './types'

const TRADING_DAYS = 252

export function dailyReturns(equity: number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1]
    out.push(prev !== 0 ? equity[i] / prev - 1 : 0)
  }
  return out
}

export function totalReturn(equity: number[]): number {
  if (equity.length < 2 || equity[0] === 0) return 0
  return equity[equity.length - 1] / equity[0] - 1
}

// CAGR = (V_fin/V_ini)^(252/N) − 1, N = nº de días operativos (= equity.length).
// 252 días hábiles/año, consistente con las fechas operativas (Decisión 4/7 del spec).
export function cagr(equity: number[]): number | null {
  const n = equity.length
  if (n < 2 || equity[0] <= 0) return null
  return (equity[n - 1] / equity[0]) ** (TRADING_DAYS / n) - 1
}

// Exceso GEOMÉTRICO, no resta aritmética (Decisión 7 del spec).
export function geometricExcess(rLine: number, rBench: number): number {
  return (1 + rLine) / (1 + rBench) - 1
}

export function lineMetrics(equityCurve: EquityPoint[]): {
  totalReturn: number
  cagr: number | null
  sharpe: number | null
  maxDrawdown: number | null
} {
  const values = equityCurve.map((p) => p.value)
  return {
    totalReturn: totalReturn(values),
    cagr: cagr(values),
    sharpe: sharpe(dailyReturns(values)),
    maxDrawdown: maxDrawdown(values),
  }
}
