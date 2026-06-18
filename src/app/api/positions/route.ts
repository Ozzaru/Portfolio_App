// src/app/api/positions/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { computeHoldings, type Transaction } from '@/lib/portfolio/holdings'
import { valuePositions, portfolioTotals } from '@/lib/portfolio/valuation'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const txPromise = supabase
    .from('transactions')
    .select('asset_id, side, quantity, price, fees, executed_at, assets(ticker)')

  // Paginado: sin .range() Supabase tope el resultado al "Max rows" (1000) y,
  // con suficientes tickers/fechas, el penúltimo precio de un ticker (o incluso
  // el último) podría quedar fuera, corrompiendo dailyPnl en silencio — la misma
  // clase de bug que se arregló en /api/analytics y /api/prices/status (02b9828).
  // No se usa ventana por fecha porque los precios se refrescan a demanda: el
  // último precio de un ticker puede ser de hace semanas y se perdería. Orden
  // total determinista (price_date desc, ticker, source) para no perder ni
  // duplicar filas entre páginas; desc preserva "primera aparición = último".
  type PriceCacheRow = { ticker: string; price: number; price_date: string }
  let txRes: Awaited<typeof txPromise>
  let priceRows: PriceCacheRow[]
  try {
    ;[txRes, priceRows] = await Promise.all([
      txPromise,
      fetchAllRows<PriceCacheRow>((from, to) =>
        supabase
          .from('price_cache')
          .select('ticker, price, price_date')
          .order('price_date', { ascending: false })
          .order('ticker', { ascending: true })
          .order('source', { ascending: true })
          .range(from, to),
      ),
    ])
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
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // priceRows viene ordenado por fecha desc: primera aparición = último precio,
  // segunda = precio anterior (para P&L del día)
  const latest = new Map<string, number>()
  const previous = new Map<string, number>()
  for (const p of priceRows) {
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
