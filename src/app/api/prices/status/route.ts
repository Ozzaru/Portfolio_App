import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Estado por fuente derivado de price_cache: última fecha y nº de tickers distintos.
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase.from('price_cache').select('ticker, price_date, source')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const bySource = new Map<string, { lastDate: string; tickers: Set<string> }>()
  for (const row of data ?? []) {
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
