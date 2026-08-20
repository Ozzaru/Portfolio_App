// src/app/api/positions/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { computeHoldings, type Transaction } from '@/lib/portfolio/holdings'
import { valuePositions, portfolioTotals, type NativeQuote } from '@/lib/portfolio/valuation'
import { loadFxSeries } from '@/lib/fx/load'
import { fxAsOf, transactionsToBaseCurrency } from '@/lib/fx/convert'
import { BASE_CURRENCY } from '@/lib/fx/constants'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const txPromise = supabase
    .from('transactions')
    .select('asset_id, side, quantity, price, fees, executed_at, assets(ticker, currency)')

  // El FX se carga en paralelo con las transacciones: no depende de ellas. Los
  // precios sí — hay que saber qué tickers pedir —, así que van después.
  let txRes: Awaited<typeof txPromise>
  let fxSeries: Awaited<ReturnType<typeof loadFxSeries>>
  try {
    ;[txRes, fxSeries] = await Promise.all([txPromise, loadFxSeries(supabase)])
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'price_cache error' }, { status: 500 })
  }
  if (txRes.error) return NextResponse.json({ error: txRes.error.message }, { status: 500 })

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const transactions: Transaction[] = (txRes.data ?? []).map((row: any) => ({
    assetId: row.asset_id,
    ticker: row.assets?.ticker ?? '',
    side: row.side,
    quantity: Number(row.quantity),
    price: Number(row.price),
    fees: Number(row.fees),
    executedAt: row.executed_at,
  }))
  const currencyByTicker = new Map<string, string>()
  for (const row of (txRes.data ?? []) as any[]) {
    if (row.assets?.ticker) currencyByTicker.set(row.assets.ticker, row.assets.currency ?? 'USD')
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Solo los 2 precios más recientes de los tickers que el usuario realmente
  // tiene: ~26 filas en 1 viaje, en vez de las ~11.800 de la tabla completa que
  // se traían en 12 páginas secuenciales. El colapso a una fila por día y la
  // precedencia de fuentes (gana `manual`) los resuelve la función SQL.
  type LatestPriceRow = { ticker: string; price: number; price_date: string; source: string }
  const userTickers = [...currencyByTicker.keys()]
  let priceRows: LatestPriceRow[] = []
  if (userTickers.length > 0) {
    const { data, error } = await supabase.rpc('latest_prices', { p_tickers: userTickers })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    priceRows = (data ?? []) as LatestPriceRow[]
  }

  // Por ticker llegan hasta 2 filas ordenadas por fecha desc: la primera es el
  // precio actual, la segunda el cierre anterior (para el P&L del día).
  const latest = new Map<string, number>()
  const previous = new Map<string, number>()
  for (const p of priceRows) {
    if (!latest.has(p.ticker)) latest.set(p.ticker, Number(p.price))
    else if (!previous.has(p.ticker)) previous.set(p.ticker, Number(p.price))
  }

  // Frontera: precios y transacciones pasan a CLP antes de tocar el dominio.
  // El valor de mercado usa el FX de hoy; el costo, el FX de cada compra
  // (Decisión 4) — de eso se encarga transactionsToBaseCurrency.
  const today = new Date().toISOString().slice(0, 10)
  const fxToday = fxAsOf(fxSeries, today)
  const toBase = (ticker: string, nativePrice: number): number | null => {
    if ((currencyByTicker.get(ticker) ?? 'USD') === BASE_CURRENCY) return nativePrice
    return fxToday !== null ? nativePrice * fxToday : null
  }

  let baseTransactions: Transaction[]
  try {
    baseTransactions = transactionsToBaseCurrency(transactions, currencyByTicker, fxSeries)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error de conversión' }, { status: 500 })
  }

  const holdings = computeHoldings(baseTransactions)

  const quotes: { ticker: string; price: number }[] = []
  const native = new Map<string, NativeQuote>()
  for (const [ticker, nativePrice] of latest) {
    native.set(ticker, { currency: currencyByTicker.get(ticker) ?? 'USD', price: nativePrice })
    const basePrice = toBase(ticker, nativePrice)
    if (basePrice !== null) quotes.push({ ticker, price: basePrice })
  }

  const positions = valuePositions(holdings, quotes, native)
  const totals = portfolioTotals(positions)

  // P&L del día en base: ambos extremos convertidos con el MISMO FX, así que
  // mide movimiento de precio, no ruido cambiario intradía.
  const dailyPnl = positions.reduce((sum, pos) => {
    const last = latest.get(pos.ticker)
    const prev = previous.get(pos.ticker)
    if (last === undefined || prev === undefined) return sum
    const lastBase = toBase(pos.ticker, last)
    const prevBase = toBase(pos.ticker, prev)
    if (lastBase === null || prevBase === null) return sum
    return sum + pos.quantity * (lastBase - prevBase)
  }, 0)

  return NextResponse.json({ positions, totals: { ...totals, dailyPnl }, baseCurrency: BASE_CURRENCY })
}
