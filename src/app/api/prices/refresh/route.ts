import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { defaultFetcher } from '@/lib/market-data/http'
import { createYahooAdapter } from '@/lib/market-data/yahoo'
import { createCoinGeckoAdapter } from '@/lib/market-data/coingecko'
import { refreshQuotes, type AssetRef } from '@/lib/market-data/refresh'
import { computeHoldings, type Transaction } from '@/lib/portfolio/holdings'
import { computeSnapshotValue } from '@/lib/portfolio/snapshot'

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: assets, error: aErr } = await supabase.from('assets').select('ticker, asset_type')
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 })

  const adapters = {
    yahoo: createYahooAdapter(defaultFetcher),
    coingecko: createCoinGeckoAdapter(defaultFetcher),
  }
  const { quotes, results } = await refreshQuotes((assets ?? []) as AssetRef[], adapters)

  // Upsert de cada cotización de hoy en price_cache (idempotente por la unique).
  if (quotes.length > 0) {
    const rows = quotes.map((q) => ({
      ticker: q.ticker,
      price: q.price,
      price_date: q.date,
      source: sourceOf(q.ticker, assets ?? []),
    }))
    const { error: upErr } = await supabase
      .from('price_cache')
      .upsert(rows, { onConflict: 'ticker,price_date,source' })
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  // Snapshot de hoy (idempotente por unique(user_id, snapshot_date)).
  const snapshotValue = await takeSnapshot(supabase, user.id, quotes)

  return NextResponse.json({ results, quotes: quotes.length, snapshotValue })
}

// Determina la fuente (yahoo/coingecko) según el tipo del activo del ticker.
/* eslint-disable @typescript-eslint/no-explicit-any */
function sourceOf(ticker: string, assets: any[]): string {
  const a = assets.find((x) => x.ticker === ticker)
  return a?.asset_type === 'crypto' ? 'coingecko' : 'yahoo'
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* eslint-disable @typescript-eslint/no-explicit-any */
async function takeSnapshot(supabase: any, userId: string, quotes: { ticker: string; price: number }[]) {
  const { data: txRows, error } = await supabase
    .from('transactions')
    .select('asset_id, side, quantity, price, fees, executed_at, assets(ticker)')
  if (error) {
    console.error('snapshot: no se pudieron leer transactions:', error.message)
    return null
  }
  const transactions: Transaction[] = (txRows ?? []).map((row: any) => ({
    assetId: row.asset_id,
    ticker: row.assets?.ticker ?? '',
    side: row.side,
    quantity: Number(row.quantity),
    price: Number(row.price),
    fees: Number(row.fees),
    executedAt: row.executed_at,
  }))
  if (computeHoldings(transactions).length === 0) return null
  const totalValue = computeSnapshotValue(transactions, quotes)
  const today = new Date().toISOString().slice(0, 10)
  const { error: snapErr } = await supabase
    .from('snapshots')
    .upsert(
      { user_id: userId, snapshot_date: today, total_value: totalValue },
      { onConflict: 'user_id,snapshot_date' }
    )
  if (snapErr) {
    console.error('snapshot: no se pudo guardar:', snapErr.message)
    return null
  }
  return totalValue
}
/* eslint-enable @typescript-eslint/no-explicit-any */
