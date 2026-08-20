import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Estado por fuente derivado de price_cache: última fecha y nº de tickers distintos.
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Un viaje: Postgres agrega (max + count distinct) leyendo la tabla localmente.
  // Antes se traían las ~11.800 filas por la red, en 12 páginas secuenciales, para
  // calcular en JavaScript un máximo y un conteo de distintos.
  type StatusRow = { source: string; last_date: string; ticker_count: number }
  const { data, error } = await supabase.rpc('price_cache_status')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const status = ((data ?? []) as StatusRow[]).map((r) => ({
    source: r.source,
    lastDate: r.last_date,
    tickerCount: Number(r.ticker_count),
  }))
  return NextResponse.json(status)
}
