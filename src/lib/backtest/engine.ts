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

// Por debajo de ~1 mes operativo, anualizar (252/N) infla CAGR y Sharpe a valores absurdos.
const MIN_TRADING_DAYS_TO_ANNUALIZE = 21

function toLine(sim: { equityCurve: StrategyLine['equityCurve']; turnoverTotal: number }): StrategyLine {
  return { ...lineMetrics(sim.equityCurve), equityCurve: sim.equityCurve, turnoverTotal: sim.turnoverTotal }
}

export function runBacktest(input: RunBacktestInput): BacktestResult {
  const { config, priceSeries, benchmarkSeries, benchmarkTicker, stockEtfTickers, cryptoTickers } = input
  const weights = normalizeWeights(config.targetWeights)
  const tickers = Object.keys(weights)
  const warnings: string[] = []

  const allDates = tradingDates(priceSeries, stockEtfTickers, cryptoTickers, config.from, config.to)
  if (allDates.length < 2) throw new Error('el rango no tiene suficientes fechas operativas')

  // Recorte de cobertura: cada activo necesita precio en dates[0]. Un activo que arranca
  // después del inicio natural del eje (p. ej. una IPO reciente) recorta el inicio del
  // backtest a su primera fecha, en vez de hacer fallar todo. El recorte se mide contra
  // allDates[0] (primer día operativo), no contra config.from (fecha de calendario que
  // casi siempre cae en fin de semana/feriado).
  const naturalStart = allDates[0]
  let effectiveFrom = naturalStart
  for (const t of tickers) {
    const first = priceSeries.get(t)?.[0]?.date
    if (!first) throw new Error(`${t} no tiene datos en el rango seleccionado`)
    if (first > naturalStart) {
      warnings.push(`histórico de ${t} empieza en ${first}: backtest recortado a esa fecha`)
      if (first > effectiveFrom) effectiveFrom = first
    }
  }
  const dates = allDates.filter((d) => d >= effectiveFrom)
  if (dates.length < 2) throw new Error('el rango no tiene suficientes fechas operativas')

  if (dates.length < MIN_TRADING_DAYS_TO_ANNUALIZE) {
    warnings.push(
      `ventana de ${dates.length} días operativos: CAGR y Sharpe anualizados no son fiables (ventana < 1 mes).`
    )
  }

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

  if (config.weightsFromCurrent) warnings.push(HINDSIGHT_WARNING)

  const vsBenchmark = benchmark
    ? {
        geometric: geometricExcess(rebalanced.totalReturn, benchmark.totalReturn),
        cagrSpread: rebalanced.cagr != null && benchmark.cagr != null ? rebalanced.cagr - benchmark.cagr : null,
      }
    : { geometric: null, cagrSpread: null }

  return { lines: { rebalanced, buyHold, benchmark }, vsBenchmark, warnings, benchmarkError }
}
