// src/app/api/backtest/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { defaultFetcher } from '@/lib/market-data/http'
import { createYahooAdapter } from '@/lib/market-data/yahoo'
import { createCoinGeckoAdapter } from '@/lib/market-data/coingecko'
import { createAlphaVantageAdapter } from '@/lib/market-data/alpha-vantage'
import { backfillHistory, type AssetRef } from '@/lib/market-data/refresh'
import { computeHoldings, type Transaction } from '@/lib/portfolio/holdings'
import { backtestConfigSchema } from '@/lib/validation/schemas'
import { validateWeights } from '@/lib/backtest/weights'
import { runBacktest } from '@/lib/backtest/engine'
import type { PriceSeriesByTicker, PricePointAdj } from '@/lib/analytics/types'
import { loadFxSeries } from '@/lib/fx/load'
import { toBaseCurrency, convertSeries } from '@/lib/fx/convert'
import { FX_TICKER } from '@/lib/fx/constants'

const BENCHMARK_TICKER = 'SPY'

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 1. Parseo/validación del body.
  const parsed = backtestConfigSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'config inválida', detail: parsed.error.issues }, { status: 400 })
  const config = parsed.data
  const wv = validateWeights(config.targetWeights)
  if (!wv.ok) return NextResponse.json({ error: wv.error }, { status: 400 })

  // 2. Cartera real del usuario: tickers + tipo de activo.
  const { data: txRows, error: txErr } = await supabase
    .from('transactions')
    .select('asset_id, side, quantity, price, fees, executed_at, assets(ticker, asset_type, currency)')
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

  const holdings = computeHoldings(transactions)
  const portfolioTickers = holdings.map((h) => h.ticker)
  if (portfolioTickers.length === 0) return NextResponse.json({ error: 'tu cartera está vacía' }, { status: 400 })

  const unknown = Object.keys(config.targetWeights).filter((t) => !portfolioTickers.includes(t))
  if (unknown.length > 0) return NextResponse.json({ error: `tickers fuera de tu cartera: ${unknown.join(', ')}` }, { status: 400 })

  // 3. Garantizar histórico (activos de la cartera + SPY) desde `from`.
  const refs: AssetRef[] = [
    ...holdings.map((h) => ({ ticker: h.ticker, asset_type: (assetTypeByTicker.get(h.ticker) ?? 'stock') as AssetRef['asset_type'] })),
    { ticker: BENCHMARK_TICKER, asset_type: 'etf' },
    // El backtest necesita FX diario cubriendo todo el período, igual que los precios.
    { ticker: FX_TICKER, asset_type: 'etf' },
  ]
  try {
    await ensureHistory(supabase, refs, config.from)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'no se pudo descargar histórico' }, { status: 502 })
  }

  // 4. Cargar price_cache (paginado) de los tickers + benchmark.
  const wanted = [...new Set([...portfolioTickers, BENCHMARK_TICKER])]
  type Row = { ticker: string; price: number; adj_price: number | null; price_date: string }
  let priceRows: Row[]
  try {
    priceRows = await fetchAllRows<Row>((from, to) =>
      supabase
        .from('price_cache')
        .select('ticker, price, adj_price, price_date')
        .in('ticker', wanted)
        .gte('price_date', config.from)
        .lte('price_date', config.to)
        .order('price_date', { ascending: true })
        .order('ticker', { ascending: true })
        .order('source', { ascending: true })
        .range(from, to),
    )
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'price_cache error' }, { status: 500 })
  }

  const byTicker = new Map<string, PricePointAdj[]>()
  for (const row of priceRows) {
    const arr = byTicker.get(row.ticker) ?? []
    const price = Number(row.price)
    arr.push({ date: row.price_date, price, adjPrice: row.adj_price != null ? Number(row.adj_price) : price })
    byTicker.set(row.ticker, arr)
  }
  const priceSeries: PriceSeriesByTicker = new Map()
  for (const t of portfolioTickers) priceSeries.set(t, byTicker.get(t) ?? [])
  const benchmarkSeries = byTicker.get(BENCHMARK_TICKER) ?? null

  const stockEtfTickers = portfolioTickers.filter((t) => assetTypeByTicker.get(t) !== 'crypto')
  const cryptoTickers = portfolioTickers.filter((t) => assetTypeByTicker.get(t) === 'crypto')

  // Frontera: series en CLP; el motor de backtest no cambia.
  const fxSeries = await loadFxSeries(supabase, config.from)

  // 5. Ejecutar el motor puro.
  try {
    const result = runBacktest({
      config,
      priceSeries: toBaseCurrency(priceSeries, currencyByTicker, fxSeries),
      benchmarkSeries: benchmarkSeries ? convertSeries(benchmarkSeries, 'USD', fxSeries) : null,
      benchmarkTicker: BENCHMARK_TICKER,
      stockEtfTickers,
      cryptoTickers,
    })
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'fallo en el backtest' }, { status: 400 })
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Descarga histórico solo de los tickers que no tienen datos hasta `from`.
async function ensureHistory(supabase: any, refs: AssetRef[], from: string) {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY
  const adapters = {
    yahoo: createYahooAdapter(defaultFetcher),
    coingecko: createCoinGeckoAdapter(defaultFetcher),
    alphaVantage: apiKey ? createAlphaVantageAdapter(defaultFetcher, apiKey) : undefined,
  }
  for (const ref of refs) {
    const { data, error } = await supabase
      .from('price_cache')
      .select('price_date')
      .eq('ticker', ref.ticker)
      .order('price_date', { ascending: true })
      .limit(1)
    if (error) throw new Error(error.message)
    const earliest: string | undefined = data?.[0]?.price_date
    if (earliest && earliest <= from) continue // ya hay datos que cubren el inicio

    const { rows, results } = await backfillHistory([ref], from, adapters)
    const failed = results.find((r) => !r.ok)
    if (rows.length === 0 && failed) throw new Error(`${ref.ticker}: ${failed.error ?? 'sin datos'}`)
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500).map((r) => ({
        ticker: r.ticker,
        price: r.price,
        adj_price: r.adjPrice,
        price_date: r.date,
        source: r.source,
      }))
      const { error: upErr } = await supabase.from('price_cache').upsert(batch, { onConflict: 'ticker,price_date,source' })
      if (upErr) throw new Error(upErr.message)
    }
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
