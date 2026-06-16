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
import { benchmarkPreset } from '@/lib/analytics/benchmarks'
import type { Period, PricePointAdj, PriceSeriesByTicker } from '@/lib/analytics/types'
import type { Transaction } from '@/lib/portfolio/holdings'

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

  // Transacciones + tipos de activo del usuario.
  const { data: txRows, error: txErr } = await supabase
    .from('transactions')
    .select('asset_id, side, quantity, price, fees, executed_at, assets(ticker, asset_type)')
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
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const userTickers = [...assetTypeByTicker.keys()]
  const today = new Date().toISOString().slice(0, 10)

  // Auto-gestión del benchmark: descargar su histórico si falta.
  let benchmarkError: string | null = null
  if (preset) {
    try {
      const benchCount = await countBenchmarkRows(supabase, benchmarkTicker)
      if (benchCount < 2) {
        await downloadBenchmark(supabase, preset.ticker, preset.assetType)
      }
    } catch (e) {
      benchmarkError = e instanceof Error ? e.message : 'benchmark no disponible'
    }
  } else {
    benchmarkError = `benchmark "${benchmarkTicker}" no reconocido`
  }

  // Cargar price_cache de los tickers del usuario + el benchmark.
  const wantedTickers = [...new Set([...userTickers, benchmarkTicker])]
  const priceSeries: PriceSeriesByTicker = new Map()
  let benchmarkSeries: PricePointAdj[] | null = null
  if (wantedTickers.length > 0) {
    const { data: priceRows, error: pErr } = await supabase
      .from('price_cache')
      .select('ticker, price, adj_price, price_date')
      .in('ticker', wantedTickers)
      .order('price_date', { ascending: true })
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })

    const byTicker = new Map<string, PricePointAdj[]>()
    for (const row of priceRows ?? []) {
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

  const result = computeAnalytics({
    transactions,
    priceSeries,
    benchmarkSeries,
    benchmarkTicker,
    assetTypeByTicker,
    period,
    today,
  })

  return NextResponse.json({ ...result, benchmarkError: benchmarkError ?? result.benchmarkError })
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function countBenchmarkRows(supabase: any, ticker: string): Promise<number> {
  const { count, error } = await supabase
    .from('price_cache')
    .select('id', { count: 'exact', head: true })
    .eq('ticker', ticker)
  if (error) throw new Error(error.message)
  return count ?? 0
}

async function downloadBenchmark(supabase: any, ticker: string, assetType: 'etf' | 'crypto') {
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
