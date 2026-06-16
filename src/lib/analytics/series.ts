// src/lib/analytics/series.ts
import { computeHoldings, type Holding, type Transaction } from '@/lib/portfolio/holdings'
import type { PricePointAdj, PriceSeriesByTicker } from './types'

// Último punto con fecha <= objetivo (forward-fill). La serie debe venir ordenada
// ascendente. Devuelve null si no hay ningún punto <= objetivo.
export function priceAsOf(series: PricePointAdj[], date: string): PricePointAdj | null {
  let found: PricePointAdj | null = null
  for (const p of series) {
    if (p.date <= date) found = p
    else break
  }
  return found
}

// Holdings derivados solo de las transacciones con executedAt <= fecha (costo
// promedio de Fase 1). Reusa el dominio puro sin duplicarlo.
export function holdingsAsOf(transactions: Transaction[], date: string): Holding[] {
  return computeHoldings(transactions.filter((t) => t.executedAt <= date))
}

// Fechas operativas del rango: fechas con precio REAL de los tickers stock/etf;
// si no hay ninguno (portafolio all-crypto) cae a las fechas de los crypto.
// Mantiene la base de retornos en días hábiles bursátiles (≈252/año) y evita
// inyectar ceros de fin de semana (ver Decisión 4 de la spec).
export function tradingDates(
  series: PriceSeriesByTicker,
  stockEtfTickers: string[],
  cryptoTickers: string[],
  from: string,
  to: string
): string[] {
  const collect = (tickers: string[]): Set<string> => {
    const set = new Set<string>()
    for (const t of tickers) {
      for (const p of series.get(t) ?? []) {
        if (p.date >= from && p.date <= to) set.add(p.date)
      }
    }
    return set
  }
  let dates = collect(stockEtfTickers)
  if (dates.size === 0) dates = collect(cryptoTickers)
  return [...dates].sort()
}

// Valor crudo (raw close) del portafolio en una fecha. Forward-fill por ticker.
export function portfolioRawValue(holdings: Holding[], series: PriceSeriesByTicker, date: string): number {
  let total = 0
  for (const h of holdings) {
    const p = priceAsOf(series.get(h.ticker) ?? [], date)
    if (p) total += h.quantity * p.price
  }
  return total
}

// Pesos al inicio del día: holdings valuados a raw close as-of `date`, normalizados.
// Devuelve mapa vacío si el valor total es 0 (días sin holdings → retorno 0 aguas arriba).
export function startOfDayWeights(
  holdings: Holding[],
  series: PriceSeriesByTicker,
  date: string
): Map<string, number> {
  const values = new Map<string, number>()
  let total = 0
  for (const h of holdings) {
    const p = priceAsOf(series.get(h.ticker) ?? [], date)
    if (p) {
      const v = h.quantity * p.price
      values.set(h.ticker, v)
      total += v
    }
  }
  const weights = new Map<string, number>()
  if (total <= 0) return weights
  for (const [t, v] of values) weights.set(t, v / total)
  return weights
}

// Retorno de un activo entre dos fechas usando adjusted close (split/dividend-safe).
// null si falta precio en cualquiera de las dos o si el de t-1 no es positivo.
export function assetReturn(
  series: PriceSeriesByTicker,
  ticker: string,
  prevDate: string,
  date: string
): number | null {
  const s = series.get(ticker) ?? []
  const prev = priceAsOf(s, prevDate)
  const cur = priceAsOf(s, date)
  if (!prev || !cur || prev.adjPrice <= 0) return null
  return cur.adjPrice / prev.adjPrice - 1
}
