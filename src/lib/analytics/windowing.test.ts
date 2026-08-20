// src/lib/analytics/windowing.test.ts
//
// Contrato de la ventana por período (migración 0005, `prices_windowed`).
//
// `/api/analytics` dejó de pedir todo el histórico y ahora pide sólo la ventana
// del período MÁS una semilla anterior por ticker. Estos tests fijan las dos
// propiedades de las que depende que ese recorte sea seguro:
//
//   1. Recortar a ventana + semilla NO cambia ningún resultado del motor.
//   2. Sin la semilla, el P&L absoluto y el retorno por activo se rompen —
//      y se rompen EN SILENCIO, porque el gráfico sigue viéndose igual.
//
// El segundo test es el que importa a futuro: sin él, la semilla parece una
// complicación gratuita y el próximo que lea el SQL la borra.
//
// Todo corre sobre `computeAnalytics`, que es una función pura: no hace falta
// base de datos para probar que el recorte es lossless.

import { describe, it, expect } from 'vitest'
import { computeAnalytics } from './engine'
import { periodStartDate } from './dates'
import type { Period, PricePointAdj, PriceSeriesByTicker } from './types'
import type { Transaction } from '@/lib/portfolio/holdings'

// --- Fixture ---------------------------------------------------------------

const TODAY = '2024-03-18' // lunes

// Días hábiles (lun-vie): el mercado no cotiza los fines de semana, que es
// justamente lo que hace necesaria la semilla.
function weekdays(fromISO: string, toISO: string): string[] {
  const out: string[] = []
  const d = new Date(`${fromISO}T00:00:00Z`)
  const end = new Date(`${toISO}T00:00:00Z`)
  while (d <= end) {
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

// Precio oscilante y determinista: evita que volatilidad y correlación queden
// degeneradas, sin introducir aleatoriedad.
function priceCurve(dates: string[], base: number, phase: number): PricePointAdj[] {
  return dates.map((date, i) => {
    const v = base * (1 + 0.02 * Math.sin((i + phase) / 3))
    return { date, price: v, adjPrice: v }
  })
}

const DATES = weekdays('2024-01-01', TODAY)

const fullSeries: PriceSeriesByTicker = new Map([
  ['AAPL', priceCurve(DATES, 100, 0)],
  ['MSFT', priceCurve(DATES, 300, 5)],
])
const fullBenchmark = priceCurve(DATES, 400, 2)

const txs: Transaction[] = [
  { assetId: 'a1', ticker: 'AAPL', side: 'buy', quantity: 10, price: 100, fees: 0, executedAt: '2024-01-05' },
  { assetId: 'a2', ticker: 'MSFT', side: 'buy', quantity: 4, price: 300, fees: 0, executedAt: '2024-01-19' },
]

const assetTypeByTicker = new Map([
  ['AAPL', 'stock'],
  ['MSFT', 'stock'],
])

function analyticsWith(
  priceSeries: PriceSeriesByTicker,
  benchmarkSeries: PricePointAdj[] | null,
  period: Period,
) {
  return computeAnalytics({
    transactions: txs,
    priceSeries,
    benchmarkSeries,
    benchmarkTicker: 'SPY',
    assetTypeByTicker,
    period,
    today: TODAY,
  })
}

// --- Simulación de lo que devuelve el SQL ----------------------------------

// Réplica de `prices_windowed`: la ventana, más TODAS las filas de la última
// fecha anterior a ella. La serie viene ordenada ascendente.
function windowWithSeed(points: PricePointAdj[], from: string): PricePointAdj[] {
  const inWindow = points.filter((p) => p.date >= from)
  const before = points.filter((p) => p.date < from)
  if (before.length === 0) return inWindow
  const seedDate = before[before.length - 1].date
  return [...before.filter((p) => p.date === seedDate), ...inWindow]
}

// La versión "simplificada" que alguien podría escribir borrando el `union all`
// de la migración: sólo la ventana, sin nada anterior.
function windowStrict(points: PricePointAdj[], from: string): PricePointAdj[] {
  return points.filter((p) => p.date >= from)
}

function applyToSeries(
  series: PriceSeriesByTicker,
  from: string,
  fn: (p: PricePointAdj[], from: string) => PricePointAdj[],
): PriceSeriesByTicker {
  return new Map([...series].map(([ticker, points]) => [ticker, fn(points, from)]))
}

const firstTx = '2024-01-05'
const startFor = (period: Period) => periodStartDate(period, firstTx, TODAY)

// --- Tests -----------------------------------------------------------------

describe('ventana + semilla', () => {
  const periods: Period[] = ['1W', '1M', '3M', '1Y', 'ALL']

  it.each(periods)('período %s: recortar a ventana + semilla no cambia ningún resultado', (period) => {
    const from = startFor(period)
    const windowed = applyToSeries(fullSeries, from, windowWithSeed)
    const windowedBench = windowWithSeed(fullBenchmark, from)

    expect(analyticsWith(windowed, windowedBench, period)).toEqual(
      analyticsWith(fullSeries, fullBenchmark, period),
    )
  })

  it('la ventana recorta de verdad (si no, el test de equivalencia sería vacío)', () => {
    const aapl = fullSeries.get('AAPL')!
    expect(aapl).toHaveLength(56) // días hábiles entre 2024-01-01 y 2024-03-18
    expect(windowWithSeed(aapl, startFor('1W'))).toHaveLength(7)
    expect(windowWithSeed(aapl, startFor('1M'))).toHaveLength(22)
    // 3M, 1Y y ALL colapsan a la primera transacción con este fixture: la ventana
    // es casi todo el histórico. Es el caso degenerado, y también debe pasar.
    expect(windowWithSeed(aapl, startFor('ALL'))).toHaveLength(53)
  })

  it('el inicio de 1M cae en domingo: la semilla es del viernes anterior', () => {
    const from = startFor('1M')
    expect(from).toBe('2024-02-18')
    expect(new Date(`${from}T00:00:00Z`).getUTCDay()).toBe(0) // domingo

    const seeded = windowWithSeed(fullSeries.get('AAPL')!, from)
    expect(seeded[0].date).toBe('2024-02-16') // viernes
    expect(seeded[0].date < from).toBe(true)
  })
})

describe('sin la semilla', () => {
  const period: Period = '1M' // su inicio cae en domingo
  const from = startFor(period)

  const strict = applyToSeries(fullSeries, from, windowStrict)
  const strictBench = windowStrict(fullBenchmark, from)

  const full = analyticsWith(fullSeries, fullBenchmark, period)
  const broken = analyticsWith(strict, strictBench, period)

  it('rompe el P&L absoluto: el valor inicial del portafolio se lee como 0', () => {
    expect(full.summary.absolutePnl).not.toBeNull()
    expect(broken.summary.absolutePnl).not.toBeCloseTo(full.summary.absolutePnl!)

    // Sin semilla, `portfolioRawValue(holdings, series, start)` no encuentra
    // precio y devuelve 0, así que el P&L pasa a ser el VALOR TOTAL de la
    // cartera en vez de su variación en el período. Con este fixture el error
    // es de dos órdenes de magnitud — y en pantalla se vería perfectamente
    // plausible, que es lo peligroso.
    expect(broken.summary.absolutePnl! / full.summary.absolutePnl!).toBeGreaterThan(50)
  })

  it('rompe el retorno por activo: sin precio en la fecha de inicio devuelve null', () => {
    for (const row of full.perAsset) expect(row.return).not.toBeNull()
    for (const row of broken.perAsset) expect(row.return).toBeNull()
  })

  it('y lo rompe EN SILENCIO: la serie del gráfico es idéntica', () => {
    // Ésta es la razón por la que el bug pasaría desapercibido. Las fechas
    // operativas salen de los precios DENTRO de la ventana, así que la semilla
    // no agrega ninguna; el gráfico se ve bien mientras las métricas ancladas
    // al inicio del período están mal.
    expect(broken.series).toEqual(full.series)
    expect(broken.summary.portfolioTwr).toBeCloseTo(full.summary.portfolioTwr!)
  })
})
