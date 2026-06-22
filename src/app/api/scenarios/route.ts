// src/app/api/scenarios/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { computeHoldings, type Transaction } from '@/lib/portfolio/holdings'
import { scenarioConfigSchema } from '@/lib/validation/schemas'
import { runScenario } from '@/lib/scenarios/engine'
import type { AssetType, ScenarioHolding } from '@/lib/scenarios/types'
import type { PriceSeriesByTicker, PricePointAdj } from '@/lib/analytics/types'

const BENCHMARK_TICKER = 'SPY'

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = scenarioConfigSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'config inválida', detail: parsed.error.issues }, { status: 400 })
  const config = parsed.data

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
  const assetTypeByTicker = new Map<string, AssetType>()
  for (const row of (txRows ?? []) as any[]) {
    if (row.assets?.ticker) assetTypeByTicker.set(row.assets.ticker, (row.assets.asset_type ?? 'other') as AssetType)
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const holdings = computeHoldings(transactions)
  const portfolioTickers = holdings.map((h) => h.ticker)
  if (portfolioTickers.length === 0) return NextResponse.json({ error: 'tu cartera está vacía' }, { status: 400 })

  const unknown = Object.keys(config.overrides).filter((t) => !portfolioTickers.includes(t))
  if (unknown.length > 0) return NextResponse.json({ error: `overrides fuera de tu cartera: ${unknown.join(', ')}` }, { status: 400 })

  // Histórico (lookback ~2 años) de la cartera + SPY para las betas; paginado (gotcha Fases 3-4).
  const lookbackFrom = (() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() - 2)
    return d.toISOString().slice(0, 10)
  })()
  const wanted = [...new Set([...portfolioTickers, BENCHMARK_TICKER])]
  type Row = { ticker: string; price: number; adj_price: number | null; price_date: string }
  let priceRows: Row[]
  try {
    priceRows = await fetchAllRows<Row>((from, to) =>
      supabase
        .from('price_cache')
        .select('ticker, price, adj_price, price_date')
        .in('ticker', wanted)
        .gte('price_date', lookbackFrom)
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

  // Precio crudo ACTUAL = último de la serie (el lookback incluye lo reciente).
  const scenarioHoldings: ScenarioHolding[] = holdings.map((h) => {
    const series = byTicker.get(h.ticker) ?? []
    const currentPrice = series.length ? series[series.length - 1].price : null
    return {
      ticker: h.ticker,
      assetType: assetTypeByTicker.get(h.ticker) ?? 'other',
      quantity: h.quantity,
      currentPrice,
    }
  })

  try {
    const result = runScenario({
      config,
      holdings: scenarioHoldings,
      priceSeries,
      benchmarkSeries,
      benchmarkTicker: BENCHMARK_TICKER,
    })
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'fallo en el escenario' }, { status: 400 })
  }
}
