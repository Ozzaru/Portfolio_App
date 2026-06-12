// src/app/(app)/data-sources/page.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'

interface PriceRow {
  id: string
  ticker: string
  price: number
  price_date: string
  source: string
}

const inputCls =
  'rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200'

const apiSources = [
  { name: 'Yahoo Finance', note: 'Acciones y ETFs — Fase 2' },
  { name: 'CoinGecko', note: 'Criptomonedas — Fase 2' },
  { name: 'Alpha Vantage', note: 'Históricos extendidos — Fase 2' },
]

export default function DataSourcesPage() {
  const [prices, setPrices] = useState<PriceRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/prices')
    if (res.ok) setPrices(await res.json())
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-slate-100">Fuentes de datos</h1>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {apiSources.map((s) => (
          <div key={s.name} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200">{s.name}</span>
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-500">
                Pendiente
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">{s.note}</p>
          </div>
        ))}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-200">Entrada manual de precios</h2>
        {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
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
          <button
            type="submit"
            className="rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500"
          >
            Guardar precio
          </button>
        </form>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-xs uppercase text-slate-500">
              <th className="py-2">Ticker</th>
              <th className="text-right">Precio</th>
              <th>Fecha</th>
              <th>Fuente</th>
            </tr>
          </thead>
          <tbody>
            {prices.map((p) => (
              <tr key={p.id} className="border-b border-slate-900">
                <td className="py-2 font-semibold">{p.ticker}</td>
                <td className="text-right">{Number(p.price).toLocaleString()}</td>
                <td>{p.price_date}</td>
                <td className="text-slate-500">{p.source}</td>
              </tr>
            ))}
            {prices.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-slate-500">Sin precios cacheados todavía.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
