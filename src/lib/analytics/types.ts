// src/lib/analytics/types.ts
export type Period = '1W' | '1M' | '3M' | '1Y' | 'ALL'

// Precio diario con cierre crudo (valor $) y ajustado (retornos).
export interface PricePointAdj {
  date: string // YYYY-MM-DD
  price: number // raw close
  adjPrice: number // adjusted close
}

// Historial por ticker, ORDENADO ascendente por fecha.
export type PriceSeriesByTicker = Map<string, PricePointAdj[]>

export interface AnalyticsResult {
  series: { date: string; portfolio: number; benchmark: number | null }[]
  summary: {
    portfolioTwr: number | null
    benchmarkTwr: number | null
    absolutePnl: number | null
    volatility: number | null
    sharpe: number | null
    maxDrawdown: number | null
  }
  perAsset: { ticker: string; return: number | null }[]
  correlation: { tickers: string[]; matrix: (number | null)[][] }
  benchmarkError: string | null
}
