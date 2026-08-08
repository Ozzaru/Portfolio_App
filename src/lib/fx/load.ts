// src/lib/fx/load.ts
import { fetchAllRows } from '@/lib/supabase/paginate'
import type { PricePointAdj } from '@/lib/analytics/types'
import { FX_TICKER } from './constants'

type FxRow = { price: number; price_date: string }

// Serie histórica del tipo de cambio, ordenada ascendente (lo exige `priceAsOf`).
// Paginado obligatorio: un select sin `.range()` queda topado al "Max rows" de
// Supabase (1000) y con 5 años de historia diaria se truncaría en silencio —
// el mismo gotcha de las Fases 3-4.
// El FX no tiene cierre ajustado: adjPrice = price.
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function loadFxSeries(supabase: any, fromISO?: string): Promise<PricePointAdj[]> {
  const rows = await fetchAllRows<FxRow>((from, to) => {
    let q = supabase.from('price_cache').select('price, price_date').eq('ticker', FX_TICKER)
    if (fromISO) q = q.gte('price_date', fromISO)
    return q
      .order('price_date', { ascending: true })
      .order('source', { ascending: true })
      .range(from, to)
  })
  return rows.map((r) => {
    const price = Number(r.price)
    return { date: r.price_date, price, adjPrice: price }
  })
}
/* eslint-enable @typescript-eslint/no-explicit-any */
