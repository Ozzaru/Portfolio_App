// src/lib/portfolio/holdings.ts
export interface Transaction {
  assetId: string
  ticker: string
  side: 'buy' | 'sell'
  quantity: number
  price: number
  fees: number
  executedAt: string // YYYY-MM-DD
}

export interface Holding {
  assetId: string
  ticker: string
  quantity: number
  costBasis: number // costo total de la posición abierta (método de costo promedio)
  avgCost: number
}

const EPSILON = 1e-9

export function computeHoldings(transactions: Transaction[]): Holding[] {
  const sorted = [...transactions].sort((a, b) => a.executedAt.localeCompare(b.executedAt))
  const byAsset = new Map<string, Holding>()

  for (const tx of sorted) {
    const h = byAsset.get(tx.assetId) ?? {
      assetId: tx.assetId,
      ticker: tx.ticker,
      quantity: 0,
      costBasis: 0,
      avgCost: 0,
    }
    if (tx.side === 'buy') {
      h.costBasis += tx.quantity * tx.price + tx.fees
      h.quantity += tx.quantity
    } else {
      const sellQty = Math.min(tx.quantity, h.quantity)
      h.costBasis -= sellQty * h.avgCost
      // La comisión de venta es un costo real de la operación: se capitaliza en
      // la posición restante, igual que las comisiones de compra.
      h.costBasis += tx.fees
      h.quantity -= sellQty
      // Cierre total: la posición se reinicia a cero. Sin esto, el costo
      // remanente (la comisión de esta venta) quedaría en el Map y lo heredaría
      // una recompra posterior del mismo activo, inflando su costo base.
      // Limitación conocida: ese fee de cierre no se registra en ningún lado —
      // este modelo sigue posiciones abiertas, no P&L realizado.
      if (h.quantity <= EPSILON) {
        h.quantity = 0
        h.costBasis = 0
      }
    }
    h.avgCost = h.quantity > EPSILON ? h.costBasis / h.quantity : 0
    byAsset.set(tx.assetId, h)
  }

  return [...byAsset.values()].filter((h) => h.quantity > EPSILON)
}
