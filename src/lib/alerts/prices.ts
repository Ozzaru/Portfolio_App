// src/lib/alerts/prices.ts
export interface PriceRow {
  ticker: string
  price: number
  price_date: string // YYYY-MM-DD
}

// Deriva spot (precio de la fecha máxima) y cierre del día hábil anterior (fecha previa
// DISTINTA), por ticker. Deduplica a un precio por fecha (primera aparición gana), evitando
// usar otra fuente del mismo día como "cierre anterior" (Decisión 4). No asume orden de entrada.
export function deriveCurrentAndPrevClose(rows: PriceRow[]): {
  current: Map<string, number>
  prevClose: Map<string, number>
} {
  const byTicker = new Map<string, Map<string, number>>()
  for (const r of rows) {
    const m = byTicker.get(r.ticker) ?? new Map<string, number>()
    if (!m.has(r.price_date)) m.set(r.price_date, Number(r.price))
    byTicker.set(r.ticker, m)
  }
  const current = new Map<string, number>()
  const prevClose = new Map<string, number>()
  for (const [ticker, m] of byTicker) {
    const dates = [...m.keys()].sort((a, b) => b.localeCompare(a)) // fecha desc
    if (dates.length >= 1) current.set(ticker, m.get(dates[0])!)
    if (dates.length >= 2) prevClose.set(ticker, m.get(dates[1])!)
  }
  return { current, prevClose }
}
