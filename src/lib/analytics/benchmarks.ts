// src/lib/analytics/benchmarks.ts
export interface BenchmarkPreset {
  ticker: string
  label: string
  assetType: 'etf' | 'crypto'
  // Si se mantiene fresco en cada refresh/backfill, sin esperar a que el usuario
  // lo seleccione. Campo OBLIGATORIO a propósito: quien agregue un preset tiene
  // que decidir explícitamente si vale la cuota de API, en vez de heredar un
  // default silencioso. Ver benchmarks.test.ts.
  autoRefresh: boolean
}

export const BENCHMARK_PRESETS: BenchmarkPreset[] = [
  { ticker: 'SPY', label: 'S&P 500', assetType: 'etf', autoRefresh: true },
  { ticker: 'QQQ', label: 'Nasdaq 100', assetType: 'etf', autoRefresh: true },
  // BTC queda fuera del auto-refresh: la cuota de CoinGecko no se justifica para
  // un benchmark que no se usa. Sigue siendo seleccionable — si el usuario lo
  // elige, `/api/analytics` lo descarga bajo demanda como siempre.
  { ticker: 'BTC', label: 'Bitcoin', assetType: 'crypto', autoRefresh: false },
]

export function benchmarkPreset(ticker: string): BenchmarkPreset | undefined {
  return BENCHMARK_PRESETS.find((b) => b.ticker === ticker.toUpperCase())
}

// Benchmarks a inyectar en el ciclo de precios, con la forma que esperan
// `refreshQuotes` y `backfillHistory`.
//
// Devuelve la forma estructural `{ ticker, asset_type }` en vez de importar
// `AssetRef` de market-data: es compatible por estructura y evita crear una
// dependencia analytics → market-data que hoy no existe.
//
// Excluye los que el usuario ya tiene como activo propio. Si posees SPY, ya
// viene en `assets` y el refresh lo va a pedir igual; inyectarlo duplicaría la
// llamada a Yahoo para el mismo ticker.
export function benchmarkRefsToRefresh(
  existingTickers: Iterable<string>
): { ticker: string; asset_type: string }[] {
  const existing = new Set([...existingTickers].map((t) => t.toUpperCase()))
  return BENCHMARK_PRESETS.filter((b) => b.autoRefresh && !existing.has(b.ticker)).map((b) => ({
    ticker: b.ticker,
    asset_type: b.assetType,
  }))
}
