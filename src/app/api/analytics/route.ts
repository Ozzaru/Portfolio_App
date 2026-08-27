// src/app/api/analytics/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { defaultFetcher } from '@/lib/market-data/http'
import { createYahooAdapter } from '@/lib/market-data/yahoo'
import { createCoinGeckoAdapter } from '@/lib/market-data/coingecko'
import { createAlphaVantageAdapter } from '@/lib/market-data/alpha-vantage'
import { backfillHistory, type AssetRef } from '@/lib/market-data/refresh'
import { isoYearsAgo } from '@/lib/market-data/dates'
import { computeAnalytics } from '@/lib/analytics/engine'
import { periodStartDate } from '@/lib/analytics/dates'
import { benchmarkPreset } from '@/lib/analytics/benchmarks'
import type { Period, PricePointAdj, PriceSeriesByTicker } from '@/lib/analytics/types'
import type { Transaction } from '@/lib/portfolio/holdings'
import { loadFxSeries } from '@/lib/fx/load'
import { fxFloor } from '@/lib/fx/floor'
import { resolvePortfolio, isLegacyConsolidated } from '@/lib/portfolio/context'
import { toBaseCurrency, convertSeries, transactionsToBaseCurrency } from '@/lib/fx/convert'
import { FX_TICKER } from '@/lib/fx/constants'

const PERIODS: Period[] = ['1W', '1M', '3M', '1Y', 'ALL']

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const period: Period = PERIODS.includes(searchParams.get('period') as Period)
    ? (searchParams.get('period') as Period)
    : '1Y'
  const benchmarkTicker = (searchParams.get('benchmark') ?? 'SPY').toUpperCase()
  const preset = benchmarkPreset(benchmarkTicker)

  const ctx = await resolvePortfolio(supabase, searchParams.get('portfolio'))
  if (!ctx) return NextResponse.json({ error: 'portafolio no encontrado' }, { status: 404 })

  // Transacciones + tipos de activo del portafolio. `!inner` fuerza el join para
  // poder filtrar por una columna del activo; sin portafolio (afordance legacy)
  // no se filtra y devuelve todo, como antes.
  let txQuery = supabase
    .from('transactions')
    .select('asset_id, side, quantity, price, fees, executed_at, assets!inner(ticker, asset_type, currency, portfolio_id)')
  if (!isLegacyConsolidated(ctx)) txQuery = txQuery.eq('assets.portfolio_id', ctx.id)
  const { data: txRows, error: txErr } = await txQuery
  if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 })

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const transactions: Transaction[] = (txRows ?? []).map((row: any) => ({
    assetId: row.asset_id,
    ticker: row.assets?.ticker ?? '',
    side: row.side,
    quantity: Number(row.quantity),
    price: Number(row.price),
    fees: Number(row.fees),
    executedAt: row.executed_at,
  }))
  const assetTypeByTicker = new Map<string, string>()
  for (const row of (txRows ?? []) as any[]) {
    if (row.assets?.ticker) assetTypeByTicker.set(row.assets.ticker, row.assets.asset_type)
  }
  const currencyByTicker = new Map<string, string>()
  for (const row of (txRows ?? []) as any[]) {
    if (row.assets?.ticker) currencyByTicker.set(row.assets.ticker, row.assets.currency ?? 'USD')
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const userTickers = [...assetTypeByTicker.keys()]
  const today = new Date().toISOString().slice(0, 10)

  // Ventana del período. `periodStartDate` necesita la primera transacción, así
  // que esto sólo puede calcularse una vez que llegaron: los precios dependen de
  // la query anterior, igual que en /api/positions. El motor recalcula el mismo
  // inicio internamente — es una función pura sobre los mismos argumentos, así
  // que no pueden divergir.
  const firstTx = transactions.map((t) => t.executedAt).sort()[0] ?? today
  const windowStart = periodStartDate(period, firstTx, today)

  const wantedTickers = [...new Set([...userTickers, benchmarkTicker])]

  // Sólo la ventana del período + una semilla anterior por ticker (migración
  // 0005). Antes se traía TODO el histórico en páginas secuenciales aunque el
  // usuario hubiera pedido "1 semana". La semilla es obligatoria: `windowStart`
  // suele caer en fin de semana y el forward-fill de `priceAsOf` necesita un
  // punto ≤ esa fecha (ver windowing.test.ts).
  type WindowedRow = { ticker: string; price: number; adj_price: number | null; price_date: string }
  const fetchWindowed = async (tickers: string[]): Promise<WindowedRow[]> => {
    if (tickers.length === 0) return []
    const { data, error } = await supabase.rpc('prices_windowed', {
      p_tickers: tickers,
      p_from: windowStart,
    })
    if (error) throw new Error(error.message)
    return (data ?? []) as WindowedRow[]
  }

  let priceRows: WindowedRow[]
  try {
    priceRows = await fetchWindowed(wantedTickers)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'price_cache error' }, { status: 500 })
  }

  // Auto-gestión del benchmark: si no volvió NINGUNA fila suya —ni siquiera la
  // semilla— es que no tiene histórico y hay que descargarlo. Antes esto costaba
  // un `count` por adelantado en cada request; ahora se decide con lo que ya
  // llegó, y en el camino común (el histórico existe) no cuesta ningún viaje.
  let benchmarkError: string | null = null
  if (!preset) {
    benchmarkError = `benchmark "${benchmarkTicker}" no reconocido`
  } else if (!priceRows.some((r) => r.ticker === benchmarkTicker)) {
    try {
      await downloadSeries(supabase, preset.ticker, preset.assetType)
      priceRows = await fetchWindowed(wantedTickers)
    } catch (e) {
      benchmarkError = e instanceof Error ? e.message : 'benchmark no disponible'
    }
  }

  const priceSeries: PriceSeriesByTicker = new Map()
  let benchmarkSeries: PricePointAdj[] | null = null
  {
    const byTicker = new Map<string, PricePointAdj[]>()
    for (const row of priceRows) {
      const arr = byTicker.get(row.ticker) ?? []
      const price = Number(row.price)
      arr.push({
        date: row.price_date,
        price,
        adjPrice: row.adj_price != null ? Number(row.adj_price) : price, // coalesce
      })
      byTicker.set(row.ticker, arr)
    }
    for (const t of userTickers) priceSeries.set(t, byTicker.get(t) ?? [])
    benchmarkSeries = byTicker.get(benchmarkTicker) ?? null
  }

  // Frontera: todo pasa a CLP antes del motor, que permanece agnóstico.
  //
  // El piso del FX no es la primera transacción a secas. El cost basis sí lo
  // necesita desde ahí (`transactionsToBaseCurrency` convierte cada compra al FX
  // de SU fecha), pero las series de precios traen una semilla anterior a la
  // ventana que no tiene cota inferior. Si el FX empieza después de esa semilla,
  // `convertSeries` la descarta en silencio — y con un benchmark desactualizado
  // eso vacía su serie entera y la línea desaparece. Ver fx/floor.test.ts.
  // El FX sólo hace falta si hay algo que convertir. El portafolio internacional
  // mide en USD y sus activos y benchmarks ya cotizan en USD: se salta el viaje
  // entero, y con él toda una clase de fallo (FX faltante, semilla, piso).
  const needsFx = ctx.baseCurrency === 'CLP'
  let fxSeries: Awaited<ReturnType<typeof loadFxSeries>> = []
  if (needsFx) {
    const floor = fxFloor(firstTx, priceRows.map((r) => r.price_date))
    fxSeries = await loadFxSeries(supabase, floor)
    if (fxSeries.length === 0) {
      // El FX es un ticker más: si no hay historia, se descarga como el benchmark.
      try {
        await downloadSeries(supabase, FX_TICKER, 'etf') // 'etf' lo enruta a Yahoo
        fxSeries = await loadFxSeries(supabase, floor)
      } catch (e) {
        benchmarkError = benchmarkError ?? (e instanceof Error ? e.message : 'FX no disponible')
      }
    }
  }
  let baseTransactions: Transaction[]
  try {
    baseTransactions = transactionsToBaseCurrency(transactions, currencyByTicker, fxSeries, ctx.baseCurrency)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error de conversión' }, { status: 500 })
  }

  const result = computeAnalytics({
    transactions: baseTransactions,
    priceSeries: toBaseCurrency(priceSeries, currencyByTicker, fxSeries, ctx.baseCurrency),
    // Los benchmarks del preset (SPY, BTC) cotizan en USD. Compararlos sin
    // convertir contra una cartera en CLP no significaría nada.
    benchmarkSeries: benchmarkSeries ? convertSeries(benchmarkSeries, 'USD', fxSeries, ctx.baseCurrency) : null,
    benchmarkTicker,
    assetTypeByTicker,
    period,
    today,
  })

  return NextResponse.json({
    ...result,
    benchmarkError: benchmarkError ?? result.benchmarkError,
    baseCurrency: ctx.baseCurrency,
  })
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function downloadSeries(supabase: any, ticker: string, assetType: 'etf' | 'crypto') {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY
  const adapters = {
    yahoo: createYahooAdapter(defaultFetcher),
    coingecko: createCoinGeckoAdapter(defaultFetcher),
    alphaVantage: apiKey ? createAlphaVantageAdapter(defaultFetcher, apiKey) : undefined,
  }
  const ref: AssetRef = { ticker, asset_type: assetType }
  const { rows, results } = await backfillHistory([ref], isoYearsAgo(5), adapters)
  const failed = results.find((r) => !r.ok)
  if (rows.length === 0 && failed) throw new Error(failed.error ?? 'no se pudo descargar el benchmark')
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500).map((r) => ({
      ticker: r.ticker,
      price: r.price,
      adj_price: r.adjPrice,
      price_date: r.date,
      source: r.source,
    }))
    const { error } = await supabase.from('price_cache').upsert(batch, { onConflict: 'ticker,price_date,source' })
    if (error) throw new Error(error.message)
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
