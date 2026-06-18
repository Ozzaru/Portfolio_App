// src/lib/backtest/engine.ts
import { tradingDates } from '@/lib/analytics/series'
import type { PriceSeriesByTicker } from '@/lib/analytics/types'
import { normalizeWeights } from './weights'
import { rebalanceDates } from './schedule'
import { simulateLine } from './rebalance'
import { lineMetrics, geometricExcess } from './metrics'
import type { BacktestResult, RunBacktestInput, StrategyLine } from './types'

const HINDSIGHT_WARNING =
  'Pesos = composición actual: sesgo de retrospectiva (el backtest sobrestima el rendimiento).'

function toLine(sim: { equityCurve: StrategyLine['equityCurve']; turnoverTotal: number }): StrategyLine {
  return { ...lineMetrics(sim.equityCurve), equityCurve: sim.equityCurve, turnoverTotal: sim.turnoverTotal }
}

export function runBacktest(input: RunBacktestInput): BacktestResult {
  const { config, priceSeries, benchmarkSeries, benchmarkTicker, stockEtfTickers, cryptoTickers } = input
  const weights = normalizeWeights(config.targetWeights)

  const dates = tradingDates(priceSeries, stockEtfTickers, cryptoTickers, config.from, config.to)
  if (dates.length < 2) throw new Error('el rango no tiene suficientes fechas operativas')

  const rebal = rebalanceDates(dates, config.frequency)
  const rebalanced = toLine(simulateLine(dates, priceSeries, weights, rebal, config.initialCapital))
  const buyHold = toLine(simulateLine(dates, priceSeries, weights, [], config.initialCapital))

  let benchmark: StrategyLine | null = null
  let benchmarkError: string | null = null
  if (benchmarkSeries && benchmarkSeries.length > 0) {
    try {
      const benchMap: PriceSeriesByTicker = new Map([[benchmarkTicker, benchmarkSeries]])
      benchmark = toLine(simulateLine(dates, benchMap, { [benchmarkTicker]: 1 }, [], config.initialCapital))
    } catch {
      benchmarkError = `benchmark ${benchmarkTicker} sin datos en el rango`
    }
  } else {
    benchmarkError = `benchmark ${benchmarkTicker} no disponible`
  }

  const warnings: string[] = []
  for (const t of cryptoTickers) {
    const first = priceSeries.get(t)?.[0]?.date
    if (first && first > config.from) warnings.push(`histórico de ${t} empieza en ${first} (recortado)`)
  }
  if (config.weightsFromCurrent) warnings.push(HINDSIGHT_WARNING)

  const vsBenchmark = benchmark
    ? {
        geometric: geometricExcess(rebalanced.totalReturn, benchmark.totalReturn),
        cagrSpread: rebalanced.cagr != null && benchmark.cagr != null ? rebalanced.cagr - benchmark.cagr : null,
      }
    : { geometric: null, cagrSpread: null }

  return { lines: { rebalanced, buyHold, benchmark }, vsBenchmark, warnings, benchmarkError }
}
