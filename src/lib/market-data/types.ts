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

// Resultado por fuente tras un refresco/backfill (para la UI de estado).
export interface SourceResult {
  source: string
  ok: boolean
  count: number // nº de precios obtenidos
  error?: string
}

export interface MarketDataAdapter {
  id: string
  supports(assetType: string): boolean
  fetchQuotes(tickers: string[]): Promise<Quote[]>
  fetchHistory(ticker: string, fromISO: string): Promise<PricePoint[]>
}

// IO de red aislada: recibe URL, devuelve JSON parseado. Inyectable en tests.
export type JsonFetcher = (url: string) => Promise<unknown>
