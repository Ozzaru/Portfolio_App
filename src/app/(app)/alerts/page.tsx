// src/app/(app)/alerts/page.tsx
'use client'

import { useCallback, useMemo, useState } from 'react'
import { useResource } from '@/lib/hooks/use-resource'
import { invalidateAfter } from '@/lib/cache/resources'
import type { AlertType } from '@/lib/alerts/types'
import { formatMoney } from '@/lib/format/money'

interface Asset {
  id: string
  ticker: string
  currency: string
}
interface Position {
  ticker: string
  currentPrice: number | null
  nativePrice: number | null
  nativeCurrency: string
}
interface AlertView {
  id: string
  ticker: string
  alertType: AlertType
  threshold: number
  status: 'active' | 'triggered' | 'disabled'
  triggeredAt: string | null
}

const inputCls = 'rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200'
const btnCls =
  'rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50'
const ghostBtn = 'rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800'

const TYPE_LABEL: Record<AlertType, string> = {
  price_above: 'Precio por encima de',
  price_below: 'Precio por debajo de',
  pct_change: 'Movimiento del día ≥ (%)',
}
const STATUS_LABEL: Record<AlertView['status'], string> = {
  active: 'Activa',
  triggered: 'Disparada',
  disabled: 'Silenciada',
}
// Los precios de alertas son NATIVOS: `price_cache` guarda la moneda de origen,
// así que un umbral de ENELCHILE.SN son pesos y uno de AAPL son dólares. Se
// formatean con la moneda del activo, nunca con la base.
const money = (x: number | null, currency: string) => formatMoney(x, currency)

export default function AlertsPage() {
  const [alertType, setAlertType] = useState<AlertType>('price_below')
  const [assetId, setAssetId] = useState('')
  const [threshold, setThreshold] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)

  // Las tres lecturas salen del caché compartido. `/api/positions` la comparte
  // con el dashboard y `/api/alerts` con el sidebar — y ese último se pide
  // simultáneamente al montar, así que es el dedup en vuelo lo que evita el
  // segundo viaje, no el caché de datos.
  const { data: assetsData } = useResource<Asset[]>('/api/assets')
  const { data: positionsData } = useResource<{ positions: Position[] }>('/api/positions')
  const { data: alertsData } = useResource<{ alerts: AlertView[] }>('/api/alerts')

  // Memoizado porque `currencyFor` lo lleva en sus dependencias: un `?? []`
  // suelto devolvería un array nuevo en cada render y lo recrearía siempre.
  const assets = useMemo(() => assetsData ?? [], [assetsData])
  const alerts = alertsData?.alerts ?? []

  const pricesByTicker = useMemo(() => {
    const map: Record<string, { price: number; currency: string }> = {}
    for (const p of positionsData?.positions ?? []) {
      if (p.nativePrice != null) map[p.ticker] = { price: p.nativePrice, currency: p.nativeCurrency }
    }
    return map
  }, [positionsData])

  // Tras una mutación no hace falta recargar a mano: invalidar deja las claves
  // sin dato y los consumidores montados —esta página y el badge del sidebar—
  // vuelven a pedir, compartiendo un solo viaje.
  const reload = useCallback(() => invalidateAfter('alerts'), [])

  // La moneda de un ticker sale de /api/assets (fuente de verdad: existe para
  // todo activo, vendido o no, tenga o no precio cacheado). `pricesByTicker`
  // viene de /api/positions, que solo cubre posiciones ABIERTAS con precio en
  // caché — usarlo como fuente principal reintroduciría el mismo error de
  // etiquetado (mostrar en USD un umbral que es en pesos) que esto arregla.
  // 'USD' es el último recurso, igual que el default del esquema.
  const currencyFor = useCallback(
    (ticker: string) => assets.find((a) => a.ticker === ticker)?.currency ?? pricesByTicker[ticker]?.currency ?? 'USD',
    [assets, pricesByTicker]
  )

  async function create() {
    setError(null)
    const res = await fetch('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alertType, assetId, threshold: Number(threshold) }),
    })
    if (!res.ok) {
      setError('no se pudo crear la alerta (revisa activo y umbral)')
      return
    }
    setThreshold('')
    reload()
  }

  async function patchStatus(id: string, status: 'active' | 'disabled') {
    await fetch(`/api/alerts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    reload()
  }

  function reactivate(a: AlertView) {
    const quote = pricesByTicker[a.ticker]
    const holds =
      quote !== undefined &&
      ((a.alertType === 'price_above' && quote.price > a.threshold) ||
        (a.alertType === 'price_below' && quote.price < a.threshold))
    if (holds) {
      const ok = window.confirm(
        `El precio actual (${money(quote.price, quote.currency)}) ya cumple el umbral (${money(a.threshold, quote.currency)}); se volverá a disparar en la próxima evaluación. ¿Reactivar de todos modos?`
      )
      if (!ok) return
    }
    patchStatus(a.id, 'active')
  }

  async function remove(id: string) {
    await fetch(`/api/alerts/${id}`, { method: 'DELETE' })
    reload()
  }

  async function evaluateNow() {
    setBanner(null)
    const res = await fetch('/api/alerts/evaluate', { method: 'POST' })
    const body = await res.json().catch(() => ({}))
    const n = res.ok ? (body.triggered?.length ?? 0) : 0
    setBanner(res.ok ? `Evaluación completada: ${n} alerta(s) disparada(s).` : 'la evaluación falló')
    reload()
  }

  const unit = alertType === 'pct_change' ? '%' : 'precio'

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-slate-100">Alertas</h1>

      {/* Crear */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-slate-400">
            Tipo
            <select className={`${inputCls} mt-1 block`} value={alertType} onChange={(e) => setAlertType(e.target.value as AlertType)}>
              <option value="price_below">{TYPE_LABEL.price_below}</option>
              <option value="price_above">{TYPE_LABEL.price_above}</option>
              <option value="pct_change">{TYPE_LABEL.pct_change}</option>
            </select>
          </label>
          <label className="text-sm text-slate-400">
            Activo
            <select className={`${inputCls} mt-1 block`} value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              <option value="">—</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.ticker}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-400">
            Umbral ({unit})
            <input
              type="number"
              step="any"
              min="0"
              className={`${inputCls} mt-1 block w-32`}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </label>
          <button className={btnCls} disabled={!assetId || threshold === ''} onClick={create}>
            Crear alerta
          </button>
          <button className={ghostBtn} onClick={evaluateNow}>
            Revisar ahora
          </button>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {banner && <p className="text-sm text-amber-300">{banner}</p>}
      </section>

      {/* Lista */}
      <section>
        {alerts.length === 0 ? (
          <p className="text-sm text-slate-500">No tienes alertas. Crea una arriba.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs uppercase text-slate-500">
                <th className="py-2">Activo</th>
                <th className="px-4">Tipo</th>
                <th className="px-4 text-right">Umbral</th>
                <th className="px-4 text-right">Precio actual</th>
                <th className="px-4">Estado</th>
                <th className="px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id} className="border-b border-slate-900">
                  <td className="py-2 font-semibold">{a.ticker}</td>
                  <td className="px-4">{TYPE_LABEL[a.alertType]}</td>
                  <td className="px-4 text-right">
                    {a.alertType === 'pct_change'
                      ? `${a.threshold}%`
                      : money(a.threshold, currencyFor(a.ticker))}
                  </td>
                  <td className="px-4 text-right">
                    {pricesByTicker[a.ticker]
                      ? money(pricesByTicker[a.ticker].price, pricesByTicker[a.ticker].currency)
                      : '—'}
                  </td>
                  <td className="px-4">{STATUS_LABEL[a.status]}</td>
                  <td className="px-4 text-right">
                    <div className="flex justify-end gap-2">
                      {a.status === 'active' ? (
                        <button className={ghostBtn} onClick={() => patchStatus(a.id, 'disabled')}>
                          Silenciar
                        </button>
                      ) : (
                        <button className={ghostBtn} onClick={() => reactivate(a)}>
                          Reactivar
                        </button>
                      )}
                      <button className={ghostBtn} onClick={() => remove(a.id)}>
                        Borrar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
