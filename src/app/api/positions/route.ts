// src/app/api/positions/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { computeHoldings, type Transaction } from '@/lib/portfolio/holdings'
import { valuePositions, portfolioTotals } from '@/lib/portfolio/valuation'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [txRes, priceRes] = await Promise.all([
    supabase
      .from('transactions')
      .select('asset_id, side, quantity, price, fees, executed_at, assets(ticker)'),
    supabase
      .from('price_cache')
      .select('ticker, price, price_date')
      .order('price_date', { ascending: false }),
  ])
  if (txRes.error) return NextResponse.json({ error: txRes.error.message }, { status: 500 })
  if (priceRes.error) return NextResponse.json({ error: priceRes.error.message }, { status: 500 })

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
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // priceRes viene ordenado por fecha desc: primera aparición = último precio,
  // segunda = precio anterior (para P&L del día)
  const latest = new Map<string, number>()
  const previous = new Map<string, number>()
  for (const p of priceRes.data ?? []) {
    if (!latest.has(p.ticker)) latest.set(p.ticker, Number(p.price))
    else if (!previous.has(p.ticker)) previous.set(p.ticker, Number(p.price))
  }

  const holdings = computeHoldings(transactions)
  const quotes = [...latest].map(([ticker, price]) => ({ ticker, price }))
  const positions = valuePositions(holdings, quotes)
  const totals = portfolioTotals(positions)

  const dailyPnl = positions.reduce((sum, pos) => {
    const last = latest.get(pos.ticker)
    const prev = previous.get(pos.ticker)
    return last !== undefined && prev !== undefined ? sum + pos.quantity * (last - prev) : sum
  }, 0)

  return NextResponse.json({ positions, totals: { ...totals, dailyPnl } })
}
