import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { defaultFetcher } from '@/lib/market-data/http'
import { createYahooAdapter } from '@/lib/market-data/yahoo'
import { createCoinGeckoAdapter } from '@/lib/market-data/coingecko'
import { createAlphaVantageAdapter } from '@/lib/market-data/alpha-vantage'
import { backfillHistory, type AssetRef } from '@/lib/market-data/refresh'
import { isoYearsAgo } from '@/lib/market-data/dates'
import { FX_TICKER } from '@/lib/fx/constants'

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: assets, error: aErr } = await supabase.from('assets').select('ticker, asset_type')
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 })

  const apiKey = process.env.ALPHA_VANTAGE_API_KEY
  const adapters = {
    yahoo: createYahooAdapter(defaultFetcher),
    coingecko: createCoinGeckoAdapter(defaultFetcher),
    alphaVantage: apiKey ? createAlphaVantageAdapter(defaultFetcher, apiKey) : undefined,
  }

  const fromISO = isoYearsAgo(5)
  // El tipo de cambio se trata como un ticker más de Yahoo. No tiene fila en
  // `assets`, así que se inyecta como AssetRef sintético: `asset_type: 'stock'`
  // lo enruta a Yahoo vía quoteSourceFor.
  const refs: AssetRef[] = [
    ...((assets ?? []) as AssetRef[]),
    { ticker: FX_TICKER, asset_type: 'stock' },
  ]
  const { rows, results } = await backfillHistory(refs, fromISO, adapters)

  // Upsert por lotes (idempotente). Lotes de 500 para no exceder límites de payload.
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500).map((r) => ({
      ticker: r.ticker,
      price: r.price,
      adj_price: r.adjPrice,
      price_date: r.date,
      source: r.source,
    }))
    const { error: upErr } = await supabase
      .from('price_cache')
      .upsert(batch, { onConflict: 'ticker,price_date,source' })
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  return NextResponse.json({ results, inserted: rows.length })
}
