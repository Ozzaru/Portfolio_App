// src/lib/analytics/engine.ts
import { type Transaction } from '@/lib/portfolio/holdings'
import type { AnalyticsResult, Period, PricePointAdj, PriceSeriesByTicker } from './types'
import { periodStartDate } from './dates'
import {
  priceAsOf,
  holdingsAsOf,
  tradingDates,
  portfolioRawValue,
  startOfDayWeights,
  assetReturn,
} from './series'
import { portfolioDailyReturn, timeWeightedReturn, normalizeToBase, absolutePnl } from './returns'
import { volatility, sharpe, maxDrawdown } from './riskMetrics'
import { correlationMatrix } from './correlation'
import { perAssetReturns } from './perAsset'

export interface AnalyticsInput {
  transactions: Transaction[]
  priceSeries: PriceSeriesByTicker
  benchmarkSeries: PricePointAdj[] | null
  benchmarkTicker: string
  assetTypeByTicker: Map<string, string>
  period: Period
  today: string
}

const EMPTY: AnalyticsResult = {
  series: [],
  summary: {
    portfolioTwr: null,
    benchmarkTwr: null,
    absolutePnl: null,
    volatility: null,
    sharpe: null,
    maxDrawdown: null,
  },
  perAsset: [],
  correlation: { tickers: [], matrix: [] },
  benchmarkError: null,
}

// Flujos netos en (from, to]: compras (+, con fees) / ventas (−) en dólares reales.
function netFlows(transactions: Transaction[], from: string, to: string): number {
  let flows = 0
  for (const t of transactions) {
    if (t.executedAt > from && t.executedAt <= to) {
      flows += t.side === 'buy' ? t.quantity * t.price + t.fees : -(t.quantity * t.price)
    }
  }
  return flows
}

export function computeAnalytics(input: AnalyticsInput): AnalyticsResult {
  const { transactions, priceSeries, benchmarkSeries, assetTypeByTicker, period, today } = input
  if (transactions.length === 0) return { ...EMPTY }

  const txDates = transactions.map((t) => t.executedAt).sort()
  const firstTx = txDates[0]
  const start = periodStartDate(period, firstTx, today)

  // Tickers que aparecen en transacciones hasta hoy (incluye los ya vendidos, que
  // contribuyen al chart mientras se tuvieron vía holdingsAsOf por día).
  const allTickers = [...new Set(transactions.filter((t) => t.executedAt <= today).map((t) => t.ticker))]
  const stockEtf = allTickers.filter((t) => {
    const ty = assetTypeByTicker.get(t)
    return ty === 'stock' || ty === 'etf'
  })
  const crypto = allTickers.filter((t) => assetTypeByTicker.get(t) === 'crypto')

  const dates = tradingDates(priceSeries, stockEtf, crypto, start, today)
  if (dates.length < 2) return { ...EMPTY }

  // Retornos diarios del portafolio: Σ wᵢ,ₜ₋₁ × rᵢ,ₜ entre fechas operativas consecutivas.
  const dailyReturns: number[] = []
  for (let i = 1; i < dates.length; i++) {
    const prevDate = dates[i - 1]
    const date = dates[i]
    const weights = startOfDayWeights(holdingsAsOf(transactions, prevDate), priceSeries, prevDate)
    const assetReturns = new Map<string, number>()
    for (const ticker of weights.keys()) {
      const r = assetReturn(priceSeries, ticker, prevDate, date)
      if (r !== null) assetReturns.set(ticker, r)
    }
    dailyReturns.push(portfolioDailyReturn(weights, assetReturns))
  }

  const portfolioIndex = normalizeToBase(dailyReturns, 100) // length === dates.length

  // Benchmark normalizado a 100 al inicio del período (TWR = retorno de adj close).
  let benchmarkTwr: number | null = null
  let benchmarkIndex: (number | null)[] | null = null
  if (benchmarkSeries && benchmarkSeries.length > 0) {
    const startP = priceAsOf(benchmarkSeries, dates[0])
    if (startP && startP.adjPrice > 0) {
      const base = startP.adjPrice
      benchmarkIndex = dates.map((d) => {
        const p = priceAsOf(benchmarkSeries, d)
        return p ? (p.adjPrice / base) * 100 : null
      })
      const endP = priceAsOf(benchmarkSeries, dates[dates.length - 1])
      if (endP) benchmarkTwr = endP.adjPrice / base - 1
    }
  }

  const series = dates.map((date, i) => ({
    date,
    portfolio: round2(portfolioIndex[i]),
    benchmark: benchmarkIndex ? roundOrNull(benchmarkIndex[i]) : null,
  }))

  // P&L absoluto en raw close.
  const startValue = portfolioRawValue(holdingsAsOf(transactions, start), priceSeries, start)
  const endValue = portfolioRawValue(holdingsAsOf(transactions, today), priceSeries, today)
  const pnl = absolutePnl(startValue, endValue, netFlows(transactions, start, today))

  // Métricas de riesgo sobre los retornos diarios (días operativos).
  const vol = volatility(dailyReturns)
  const shp = sharpe(dailyReturns)
  const mdd = maxDrawdown(portfolioIndex)

  // Tickers actualmente mantenidos: para retorno por activo y correlación.
  const heldTickers = holdingsAsOf(transactions, today).map((h) => h.ticker)

  // Correlación: intersección de fechas operativas con precio real para TODOS los
  // tickers mantenidos (evita arrays desalineados). Retornos entre fechas consecutivas.
  const correlation = buildCorrelation(heldTickers, priceSeries, dates)

  return {
    series,
    summary: {
      portfolioTwr: timeWeightedReturn(dailyReturns),
      benchmarkTwr,
      absolutePnl: pnl,
      volatility: vol,
      sharpe: shp,
      maxDrawdown: mdd,
    },
    perAsset: perAssetReturns(heldTickers, priceSeries, start, today),
    correlation,
    benchmarkError: null,
  }
}

function buildCorrelation(
  tickers: string[],
  priceSeries: PriceSeriesByTicker,
  dates: string[]
): { tickers: string[]; matrix: (number | null)[][] } {
  if (tickers.length < 2) return { tickers, matrix: tickers.length === 1 ? [[1]] : [] }
  // Fechas donde TODOS los tickers tienen precio real as-of (intersección).
  const usable = dates.filter((d) => tickers.every((t) => priceAsOf(priceSeries.get(t) ?? [], d) !== null))
  const returnsByTicker = new Map<string, number[]>()
  for (const t of tickers) {
    const rets: number[] = []
    for (let i = 1; i < usable.length; i++) {
      const prev = priceAsOf(priceSeries.get(t) ?? [], usable[i - 1])!
      const cur = priceAsOf(priceSeries.get(t) ?? [], usable[i])!
      rets.push(prev.adjPrice > 0 ? cur.adjPrice / prev.adjPrice - 1 : 0)
    }
    returnsByTicker.set(t, rets)
  }
  return correlationMatrix(returnsByTicker)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
function roundOrNull(n: number | null): number | null {
  return n === null ? null : round2(n)
}
