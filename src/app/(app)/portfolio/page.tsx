// src/app/(app)/portfolio/page.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'

interface Asset {
  id: string
  ticker: string
  name: string
  asset_type: string
  currency: string
}

interface Tx {
  id: string
  asset_id: string
  side: 'buy' | 'sell'
  quantity: number
  price: number
  fees: number
  executed_at: string
  assets: { ticker: string } | null
}

const inputCls =
  'rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200'
const btnCls =
  'rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500'

export default function PortfolioPage() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [txs, setTxs] = useState<Tx[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [aRes, tRes] = await Promise.all([fetch('/api/assets'), fetch('/api/transactions')])
    if (aRes.ok) aRes.json().then(setAssets)
    if (tRes.ok) tRes.json().then(setTxs)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function post(url: string, body: unknown) {
    setError(null)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setError(typeof data?.error === 'string' ? data.error : 'Error de validación')
      return false
    }
    await load()
    return true
  }

  async function remove(url: string) {
    await fetch(url, { method: 'DELETE' })
    await load()
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-slate-100">Portafolio</h1>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-200">Activos</h2>
        <form
          className="mb-4 flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            const form = e.currentTarget
            const fd = new FormData(form)
            const ok = await post('/api/assets', {
              ticker: fd.get('ticker'),
              name: fd.get('name'),
              assetType: fd.get('assetType'),
              currency: fd.get('currency') || 'USD',
            })
            if (ok) form.reset()
          }}
        >
          <input name="ticker" placeholder="Ticker (AAPL)" required className={inputCls} />
          <input name="name" placeholder="Nombre (opcional)" className={inputCls} />
          <select name="assetType" required className={inputCls} defaultValue="stock">
            <option value="stock">Acción</option>
            <option value="etf">ETF</option>
            <option value="crypto">Crypto</option>
            <option value="cash">Efectivo</option>
            <option value="other">Otro</option>
          </select>
          <input name="currency" placeholder="USD" maxLength={3} className={inputCls} />
          <button type="submit" className={btnCls}>Añadir activo</button>
        </form>
        <ul className="flex flex-wrap gap-2">
          {assets.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded border border-slate-800 bg-slate-900 px-3 py-1 text-sm"
            >
              <span className="font-semibold text-slate-200">{a.ticker}</span>
              <span className="text-xs text-slate-500">{a.asset_type} · {a.currency}</span>
              <button
                onClick={() => remove(`/api/assets/${a.id}`)}
                className="text-slate-600 hover:text-red-400"
                title="Eliminar activo y sus transacciones"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-200">Transacciones</h2>
        <form
          className="mb-4 flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            const form = e.currentTarget
            const fd = new FormData(form)
            const ok = await post('/api/transactions', {
              assetId: fd.get('assetId'),
              side: fd.get('side'),
              quantity: fd.get('quantity'),
              price: fd.get('price'),
              fees: fd.get('fees') || 0,
              executedAt: fd.get('executedAt'),
            })
            if (ok) form.reset()
          }}
        >
          <select name="assetId" required className={inputCls}>
            <option value="">Activo…</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>{a.ticker}</option>
            ))}
          </select>
          <select name="side" required className={inputCls} defaultValue="buy">
            <option value="buy">Compra</option>
            <option value="sell">Venta</option>
          </select>
          <input name="quantity" type="number" step="any" min="0" placeholder="Cantidad" required className={inputCls} />
          <input name="price" type="number" step="any" min="0" placeholder="Precio" required className={inputCls} />
          <input name="fees" type="number" step="any" min="0" placeholder="Comisión" className={inputCls} />
          <input name="executedAt" type="date" required className={inputCls} />
          <button type="submit" className={btnCls}>Registrar</button>
        </form>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-xs uppercase text-slate-500">
              <th className="py-2">Fecha</th>
              <th>Activo</th>
              <th>Tipo</th>
              <th className="text-right">Cantidad</th>
              <th className="text-right">Precio</th>
              <th className="text-right">Comisión</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {txs.map((t) => (
              <tr key={t.id} className="border-b border-slate-900">
                <td className="py-2">{t.executed_at}</td>
                <td className="font-semibold">{t.assets?.ticker ?? '—'}</td>
                <td className={t.side === 'buy' ? 'text-green-400' : 'text-red-400'}>
                  {t.side === 'buy' ? 'Compra' : 'Venta'}
                </td>
                <td className="text-right">{Number(t.quantity)}</td>
                <td className="text-right">{Number(t.price).toLocaleString()}</td>
                <td className="text-right">{Number(t.fees)}</td>
                <td className="text-right">
                  <button
                    onClick={() => remove(`/api/transactions/${t.id}`)}
                    className="text-slate-600 hover:text-red-400"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {txs.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-slate-500">Sin transacciones todavía.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
