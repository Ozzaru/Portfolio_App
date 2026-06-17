import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchAllRows } from '@/lib/supabase/paginate'

// Estado por fuente derivado de price_cache: última fecha y nº de tickers distintos.
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Paginado: sin .range() Supabase tope a 1000 filas y el status sub-reportaría
  // tickers/última fecha tras un backfill grande. Orden por id (PK) determinista.
  type StatusRow = { ticker: string; price_date: string; source: string }
  let data: StatusRow[]
  try {
    data = await fetchAllRows<StatusRow>((from, to) =>
      supabase.from('price_cache').select('ticker, price_date, source').order('id', { ascending: true }).range(from, to),
    )
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'price_cache error' }, { status: 500 })
  }

  const bySource = new Map<string, { lastDate: string; tickers: Set<string> }>()
  for (const row of data) {
    const s = bySource.get(row.source) ?? { lastDate: '', tickers: new Set<string>() }
    if (row.price_date > s.lastDate) s.lastDate = row.price_date
    s.tickers.add(row.ticker)
    bySource.set(row.source, s)
  }

  const status = [...bySource].map(([source, v]) => ({
    source,
    lastDate: v.lastDate,
    tickerCount: v.tickers.size,
  }))
  return NextResponse.json(status)
}
