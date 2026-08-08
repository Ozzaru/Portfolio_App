// Precio de un ticker en una fecha concreta (YYYY-MM-DD, UTC).
// price = cierre crudo (valor absoluto $). adjPrice = cierre ajustado (retornos).
export interface PricePoint {
  date: string
  price: number
  adjPrice: number
}

// Cotización actual normalizada.
export interface Quote {
  ticker: string
  price: number
  date: string // YYYY-MM-DD
}

// Ticker que falló individualmente dentro de una fuente. Se reporta en vez de
// silenciarse: un precio ausente sin explicación es peor que un error visible.
export interface FailedTicker {
  ticker: string
  error: string
}

export interface QuotesResult {
  quotes: Quote[]
  failed: FailedTicker[]
}

// Resultado por fuente tras un refresco/backfill (para la UI de estado).
export interface SourceResult {
  source: string
  ok: boolean
  count: number // nº de precios obtenidos
  error?: string
  failed?: FailedTicker[]
}

export interface MarketDataAdapter {
  id: string
  supports(assetType: string): boolean
  fetchQuotes(tickers: string[]): Promise<QuotesResult>
  fetchHistory(ticker: string, fromISO: string): Promise<PricePoint[]>
}

// IO de red aislada: recibe URL, devuelve JSON parseado. Inyectable en tests.
export type JsonFetcher = (url: string) => Promise<unknown>
