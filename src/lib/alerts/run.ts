// src/lib/alerts/run.ts
import { fetchAllRows } from '@/lib/supabase/paginate'
import { deriveCurrentAndPrevClose, type PriceRow } from './prices'
import { evaluateAlerts } from './evaluate'
import type { AlertRow, AlertTrigger, AlertType } from './types'

// Carga alertas active del usuario (RLS), deriva spot/cierre-anterior de price_cache
// (paginado, solo caché → cero llamadas externas), evalúa y marca las disparadas con
// lock optimista (AND status='active'). Devuelve las recién disparadas.
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function evaluateAndPersist(supabase: any): Promise<AlertTrigger[]> {
  const { data: alertRows, error: aErr } = await supabase
    .from('alerts')
    .select('id, alert_type, threshold, status, assets(ticker)')
    .eq('status', 'active')
  if (aErr) throw new Error(aErr.message)

  const alerts: AlertRow[] = (alertRows ?? [])
    .map((r: any) => ({
      id: r.id,
      ticker: r.assets?.ticker ?? '',
      alertType: r.alert_type as AlertType,
      threshold: Number(r.threshold),
      status: r.status,
    }))
    .filter((a: AlertRow) => a.ticker !== '')
  if (alerts.length === 0) return []

  const wanted = [...new Set(alerts.map((a) => a.ticker))]
  const priceRows = await fetchAllRows<PriceRow>((from, to) =>
    supabase
      .from('price_cache')
      .select('ticker, price, price_date')
      .in('ticker', wanted)
      .order('price_date', { ascending: false })
      .order('source', { ascending: true })
      .range(from, to),
  )
  const { current, prevClose } = deriveCurrentAndPrevClose(priceRows)

  const triggers = evaluateAlerts(alerts, current, prevClose)
  if (triggers.length === 0) return []

  const { error: upErr } = await supabase
    .from('alerts')
    .update({ status: 'triggered', triggered_at: new Date().toISOString() })
    .in('id', triggers.map((t) => t.id))
    .eq('status', 'active')
  if (upErr) throw new Error(upErr.message)
  return triggers
}
/* eslint-enable @typescript-eslint/no-explicit-any */
