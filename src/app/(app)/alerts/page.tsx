// src/app/(app)/alerts/page.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AlertType } from '@/lib/alerts/types'

interface Asset {
  id: string
  ticker: string
}
interface Position {
  ticker: string
  currentPrice: number | null
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
const money = (x: number | null) =>
  x == null ? '—' : x.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export default function AlertsPage() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [pricesByTicker, setPricesByTicker] = useState<Record<string, number>>({})
  const [alerts, setAlerts] = useState<AlertView[]>([])
  const [alertType, setAlertType] = useState<AlertType>('price_below')
  const [assetId, setAssetId] = useState('')
  const [threshold, setThreshold] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)

  const loadAll = useCallback(() => {
    fetch('/api/assets')
      .then((r) => (r.ok ? r.json() : []))
      .then((d: Asset[]) => setAssets(d ?? []))
    fetch('/api/positions')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { positions: Position[] } | null) => {
        const map: Record<string, number> = {}
        for (const p of d?.positions ?? []) if (p.currentPrice != null) map[p.ticker] = p.currentPrice
        setPricesByTicker(map)
      })
    fetch('/api/alerts')
      .then((r) => (r.ok ? r.json() : { alerts: [] }))
      .then((d: { alerts: AlertView[] }) => setAlerts(d?.alerts ?? []))
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

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
    loadAll()
  }

  async function patchStatus(id: string, status: 'active' | 'disabled') {
    await fetch(`/api/alerts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    loadAll()
  }

  function reactivate(a: AlertView) {
    const price = pricesByTicker[a.ticker]
    const holds =
      price !== undefined &&
      ((a.alertType === 'price_above' && price > a.threshold) ||
        (a.alertType === 'price_below' && price < a.threshold))
    if (holds) {
      const ok = window.confirm(
        `El precio actual (${money(price)}) ya cumple el umbral (${a.threshold}); se volverá a disparar en la próxima evaluación. ¿Reactivar de todos modos?`
      )
      if (!ok) return
    }
    patchStatus(a.id, 'active')
  }

  async function remove(id: string) {
    await fetch(`/api/alerts/${id}`, { method: 'DELETE' })
    loadAll()
  }

  async function evaluateNow() {
    setBanner(null)
    const res = await fetch('/api/alerts/evaluate', { method: 'POST' })
    const body = await res.json().catch(() => ({}))
    const n = res.ok ? (body.triggered?.length ?? 0) : 0
    setBanner(res.ok ? `Evaluación completada: ${n} alerta(s) disparada(s).` : 'la evaluación falló')
    loadAll()
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
                  <td className="px-4 text-right">{a.threshold}{a.alertType === 'pct_change' ? '%' : ''}</td>
                  <td className="px-4 text-right">{money(pricesByTicker[a.ticker] ?? null)}</td>
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
