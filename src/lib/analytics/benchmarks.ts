// src/lib/analytics/benchmarks.ts
export interface BenchmarkPreset {
  ticker: string
  label: string
  assetType: 'etf' | 'crypto'
}

export const BENCHMARK_PRESETS: BenchmarkPreset[] = [
  { ticker: 'SPY', label: 'S&P 500', assetType: 'etf' },
  { ticker: 'QQQ', label: 'Nasdaq 100', assetType: 'etf' },
  { ticker: 'BTC', label: 'Bitcoin', assetType: 'crypto' },
]

export function benchmarkPreset(ticker: string): BenchmarkPreset | undefined {
  return BENCHMARK_PRESETS.find((b) => b.ticker === ticker.toUpperCase())
}
