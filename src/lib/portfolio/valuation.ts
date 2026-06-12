// src/lib/portfolio/valuation.ts
import type { Holding } from '@/lib/portfolio/holdings'

export interface Quote {
  ticker: string
  price: number
}

export interface PositionView extends Holding {
  currentPrice: number | null
  marketValue: number | null
  unrealizedPnl: number | null
  unrealizedPnlPct: number | null
}

export interface PortfolioTotals {
  totalValue: number
  totalCost: number
  totalPnl: number
  totalPnlPct: number
  assetCount: number
}

export function valuePositions(holdings: Holding[], quotes: Quote[]): PositionView[] {
  const priceMap = new Map(quotes.map((q) => [q.ticker, q.price]))
  return holdings.map((h) => {
    const price = priceMap.get(h.ticker) ?? null
    const marketValue = price !== null ? h.quantity * price : null
    const unrealizedPnl = marketValue !== null ? marketValue - h.costBasis : null
    const unrealizedPnlPct =
      unrealizedPnl !== null && h.costBasis > 0 ? (unrealizedPnl / h.costBasis) * 100 : null
    return { ...h, currentPrice: price, marketValue, unrealizedPnl, unrealizedPnlPct }
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
