// src/lib/portfolio/valuation.ts
import type { Holding } from '@/lib/portfolio/holdings'
import { BASE_CURRENCY } from '@/lib/fx/constants'

export interface Quote {
  ticker: string
  price: number // en moneda BASE (ya convertido en la frontera)
}

// Precio tal como lo publica el mercado de origen, para mostrarlo sin traducir.
export interface NativeQuote {
  currency: string
  price: number | null
}

export interface PositionView extends Holding {
  // Todos estos campos están en moneda BASE: reciben holdings y quotes ya
  // convertidos por el módulo fx (Decisión 2).
  currentPrice: number | null
  marketValue: number | null
  unrealizedPnl: number | null
  unrealizedPnlPct: number | null
  // Solo para presentación: el precio que el usuario ve en su broker.
  nativeCurrency: string
  nativePrice: number | null
}

export interface PortfolioTotals {
  totalValue: number
  totalCost: number
  totalPnl: number
  totalPnlPct: number
  assetCount: number
}

export function valuePositions(
  holdings: Holding[],
  quotes: Quote[],
  native: Map<string, NativeQuote> = new Map()
): PositionView[] {
  const priceMap = new Map(quotes.map((q) => [q.ticker, q.price]))
  return holdings.map((h) => {
    const price = priceMap.get(h.ticker) ?? null
    const marketValue = price !== null ? h.quantity * price : null
    const unrealizedPnl = marketValue !== null ? marketValue - h.costBasis : null
    const unrealizedPnlPct =
      unrealizedPnl !== null && h.costBasis > 0 ? (unrealizedPnl / h.costBasis) * 100 : null
    const n = native.get(h.ticker)
    return {
      ...h,
      currentPrice: price,
      marketValue,
      unrealizedPnl,
      unrealizedPnlPct,
      nativeCurrency: n?.currency ?? BASE_CURRENCY,
      nativePrice: n?.price ?? price,
    }
  })
}

export function portfolioTotals(positions: PositionView[]): PortfolioTotals {
  const valued = positions.filter((p) => p.marketValue !== null)
  const totalValue = valued.reduce((s, p) => s + (p.marketValue ?? 0), 0)
  const totalCost = positions.reduce((s, p) => s + p.costBasis, 0)
  const valuedCost = valued.reduce((s, p) => s + p.costBasis, 0)
  const totalPnl = totalValue - valuedCost
  const totalPnlPct = valuedCost > 0 ? (totalPnl / valuedCost) * 100 : 0
  return { totalValue, totalCost, totalPnl, totalPnlPct, assetCount: positions.length }
}
