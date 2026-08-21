// src/app/(app)/data-sources/page.tsx
'use client'

import { useCallback, useState } from 'react'
import { useResource } from '@/lib/hooks/use-resource'
import { invalidateAfter } from '@/lib/cache/resources'

interface PriceRow {
  id: string
  ticker: string
  price: number
  price_date: string
  source: string
}
interface SourceStatus {
  source: string
  lastDate: string
  tickerCount: number
}
interface RefreshResult {
  source: string
  ok: boolean
  count: number
  error?: string
}

const inputCls =
  'rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200'
const btnCls =
  'rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50'

const apiSources = [
  { id: 'yahoo', name: 'Yahoo Finance', note: 'Acciones y ETFs' },
  { id: 'coingecko', name: 'CoinGecko', note: 'Criptomonedas — histórico 1 año (plan gratuito)' },
  { id: 'alpha-vantage', name: 'Alpha Vantage', note: 'Respaldo histórico (clave opcional)' },
]

export default function DataSourcesPage() {
  const [results, setResults] = useState<RefreshResult[]>([])
  const [busy, setBusy] = useState<null | 'refresh' | 'backfill'>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: pricesData } = useResource<PriceRow[]>('/api/prices')
  const { data: statusData } = useResource<SourceStatus[]>('/api/prices/status')
  const prices = pricesData ?? []
  const status = statusData ?? []

  // Refrescar precios es la mutación de mayor alcance: cambia posiciones,
  // analítica y la caché de precios, y además `/api/prices/refresh` corre
  // `evaluateAndPersist`, así que puede dejar alertas disparadas. El prefijo
  // `/api/prices` alcanza también a `/api/prices/status`.
  const load = useCallback(() => invalidateAfter('prices'), [])

  async function run(action: 'refresh' | 'backfill') {
    setBusy(action)
    setError(null)
    setResults([])
    const res = await fetch(`/api/prices/${action}`, { method: 'POST' })
    setBusy(null)
    if (!res.ok) {
      setError('La operación falló (revisa la consola del servidor)')
      return
    }
    const data = await res.json()
    setResults(data.results ?? [])
    await load()
  }

  function statusFor(id: string) {
    return status.find((s) => s.source === id)
  }
  function resultFor(id: string) {
    return results.find((r) => r.source === id)
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-slate-100">Fuentes de datos</h1>

      <div className="flex flex-wrap gap-2">
        <button className={btnCls} disabled={busy !== null} onClick={() => run('refresh')}>
          {busy === 'refresh' ? 'Actualizando…' : 'Actualizar precios'}
        </button>
        <button className={btnCls} disabled={busy !== null} onClick={() => run('backfill')}>
          {busy === 'backfill' ? 'Descargando históricos…' : 'Backfill históricos (5 años)'}
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {apiSources.map((s) => {
          const st = statusFor(s.id)
          const rs = resultFor(s.id)
          const badge = rs
            ? rs.ok
              ? rs.error
                // Fallo parcial: la fuente respondió (ok:true) pero algún ticker
                // concreto no trajo datos. Ni OK limpio ni ERROR total.
                ? { text: 'PARCIAL', cls: 'bg-amber-900 text-amber-300' }
                : { text: 'OK', cls: 'bg-green-900 text-green-300' }
              : { text: 'ERROR', cls: 'bg-red-900 text-red-300' }
            : st
              ? { text: 'OK', cls: 'bg-green-900 text-green-300' }
              : { text: 'Sin datos', cls: 'bg-slate-800 text-slate-500' }
          return (
            <div key={s.id} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">{s.name}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${badge.cls}`}>{badge.text}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">{s.note}</p>
              {st && (
                <p className="mt-2 text-xs text-slate-400">
                  {st.tickerCount} tickers · última: {st.lastDate}
                </p>
              )}
              {rs?.error && (
                <p className={`mt-1 text-xs ${rs.ok ? 'text-amber-400' : 'text-red-400'}`}>{rs.error}</p>
              )}
            </div>
          )
        })}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-200">Entrada manual de precios</h2>
        <form
          className="mb-4 flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            setError(null)
            const form = e.currentTarget
            const fd = new FormData(form)
            const res = await fetch('/api/prices', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ticker: fd.get('ticker'),
                price: fd.get('price'),
                priceDate: fd.get('priceDate'),
              }),
            })
            if (!res.ok) {
              setError('No se pudo guardar el precio (revisa los campos)')
              return
            }
            form.reset()
            await load()
          }}
        >
          <input name="ticker" placeholder="Ticker (AAPL)" required className={inputCls} />
          <input name="price" type="number" step="any" min="0" placeholder="Precio" required className={inputCls} />
          <input name="priceDate" type="date" required className={inputCls} />
          <button type="submit" className={btnCls}>
            Guardar precio
          </button>
        </form>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-xs uppercase text-slate-500">
              <th className="py-2">Ticker</th>
              <th className="px-4 text-right">Precio</th>
              <th className="px-4">Fecha</th>
              <th className="px-4">Fuente</th>
            </tr>
          </thead>
          <tbody>
            {prices.map((p) => (
              <tr key={p.id} className="border-b border-slate-900">
                <td className="py-2 font-semibold">{p.ticker}</td>
                <td className="px-4 text-right">{Number(p.price).toLocaleString()}</td>
                <td className="px-4">{p.price_date}</td>
                <td className="px-4 text-slate-500">{p.source}</td>
              </tr>
            ))}
            {prices.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-slate-500">
                  Sin precios cacheados todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
