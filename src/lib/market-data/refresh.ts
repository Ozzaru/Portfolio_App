import type { MarketDataAdapter, Quote, SourceResult } from './types'
import { quoteSourceFor } from './resolver'

export interface AssetRef {
  ticker: string
  asset_type: string
}

export interface PriceRow {
  ticker: string
  date: string
  price: number
  adjPrice: number
  source: string
}

interface QuoteAdapters {
  yahoo: MarketDataAdapter
  coingecko: MarketDataAdapter
}

// Refresca la cotización de hoy agrupando por fuente. Una fuente caída
// no rompe a las demás: se reporta en SourceResult.
export async function refreshQuotes(
  assets: AssetRef[],
  adapters: QuoteAdapters
): Promise<{ quotes: Quote[]; results: SourceResult[] }> {
  const groups: Record<'yahoo' | 'coingecko', string[]> = { yahoo: [], coingecko: [] }
  for (const a of assets) {
    const src = quoteSourceFor(a.asset_type)
    if (src) groups[src].push(a.ticker)
  }

  const quotes: Quote[] = []
  const results: SourceResult[] = []

  for (const src of ['yahoo', 'coingecko'] as const) {
    const tickers = groups[src]
    if (tickers.length === 0) continue
    try {
      const got = await adapters[src].fetchQuotes(tickers)
      quotes.push(...got)
      results.push({ source: src, ok: true, count: got.length })
    } catch (e) {
      results.push({ source: src, ok: false, count: 0, error: errorMessage(e) })
    }
  }

  return { quotes, results }
}

interface HistoryAdapters extends QuoteAdapters {
  alphaVantage: MarketDataAdapter | undefined
}

// Backfill de históricos por activo. Para acciones/ETF, si Yahoo falla y hay
// Alpha Vantage configurado, se reintenta con AV.
export async function backfillHistory(
  assets: AssetRef[],
  fromISO: string,
  adapters: HistoryAdapters
): Promise<{ rows: PriceRow[]; results: SourceResult[] }> {
  const rows: PriceRow[] = []
  const perSource = new Map<string, { ok: boolean; count: number; error?: string }>()

  const record = (source: string, ok: boolean, count: number, error?: string) => {
    const prev = perSource.get(source) ?? { ok: true, count: 0 }
    perSource.set(source, {
      ok: prev.ok && ok,
      count: prev.count + count,
      error: error ?? prev.error,
    })
  }

  for (const a of assets) {
    const src = quoteSourceFor(a.asset_type)
    if (!src) continue
    try {
      const points = await adapters[src].fetchHistory(a.ticker, fromISO)
      rows.push(
        ...points.map((p) => ({ ticker: a.ticker, date: p.date, price: p.price, adjPrice: p.adjPrice, source: src }))
      )
      record(src, true, points.length)
    } catch (e) {
      // Respaldo Alpha Vantage solo para acciones/ETF con key configurada.
      if (src === 'yahoo' && adapters.alphaVantage) {
        try {
          const points = await adapters.alphaVantage.fetchHistory(a.ticker, fromISO)
          rows.push(
            ...points.map((p) => ({
              ticker: a.ticker,
              date: p.date,
              price: p.price,
              adjPrice: p.adjPrice,
              source: 'alpha-vantage',
            }))
          )
          record('alpha-vantage', true, points.length)
          continue
        } catch (e2) {
          record('alpha-vantage', false, 0, errorMessage(e2))
        }
      }
      record(src, false, 0, errorMessage(e))
    }
  }

  const results: SourceResult[] = [...perSource].map(([source, v]) => ({ source, ...v }))
  return { rows, results }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
