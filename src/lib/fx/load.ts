// src/lib/fx/load.ts
import { fetchAllRows } from '@/lib/supabase/paginate'
import type { PricePointAdj } from '@/lib/analytics/types'
import { FX_TICKER } from './constants'

type FxRow = { price: number; price_date: string }

// Serie histórica del tipo de cambio, ordenada ascendente (lo exige `priceAsOf`).
// El FX no tiene cierre ajustado: adjPrice = price.
//
// Con `fromISO` usa `prices_windowed` (migración 0005), que devuelve la ventana
// MÁS una semilla anterior. La semilla no es opcional: el consumidor convierte
// el cost basis de cada compra al FX de SU fecha, y una compra puede caer en un
// día sin cotización — sin un punto ≤ esa fecha el forward-fill de `fxAsOf`
// falla y la conversión revienta. Es el mismo motivo por el que la ventana de
// precios la lleva (ver analytics/windowing.test.ts).
//
// Sin `fromISO` mantiene el paginado sobre la tabla: un select sin `.range()`
// queda topado al "Max rows" de Supabase (1000) y con 5 años de historia diaria
// se truncaría en silencio — el gotcha de las Fases 3-4.
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function loadFxSeries(supabase: any, fromISO?: string): Promise<PricePointAdj[]> {
  const toPoints = (rows: FxRow[]): PricePointAdj[] =>
    rows.map((r) => {
      const price = Number(r.price)
      return { date: r.price_date, price, adjPrice: price }
    })

  if (fromISO) {
    const { data, error } = await supabase.rpc('prices_windowed', {
      p_tickers: [FX_TICKER],
      p_from: fromISO,
    })
    if (error) throw new Error(error.message)
    return toPoints((data ?? []) as FxRow[])
  }

  const rows = await fetchAllRows<FxRow>((from, to) =>
    supabase
      .from('price_cache')
      .select('price, price_date')
      .eq('ticker', FX_TICKER)
      .order('price_date', { ascending: true })
      .order('source', { ascending: true })
      .range(from, to),
  )
  return toPoints(rows)
}
/* eslint-enable @typescript-eslint/no-explicit-any */
