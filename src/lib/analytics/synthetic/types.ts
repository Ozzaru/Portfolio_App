// src/lib/analytics/synthetic/types.ts
// Tipos de las carteras sintéticas (benchmarks hipotéticos sobre la cartera real).

export type RebalanceFrequency = 'monthly' | 'quarterly'

export interface EquityPoint {
  date: string // YYYY-MM-DD
  value: number // valor de la cartera simulada ese día
}
