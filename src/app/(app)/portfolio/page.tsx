// src/app/(app)/portfolio/page.tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { IVA_RATE } from '@/lib/fx/constants'

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
  commission: number
  iva: number
  executed_at: string
  assets: { ticker: string; currency: string } | null
}

const inputCls =
  'rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200'
const btnCls =
  'rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500'

export default function PortfolioPage() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [txs, setTxs] = useState<Tx[]>([])
  const [error, setError] = useState<string | null>(null)
  const [txAssetId, setTxAssetId] = useState('')
  const [commission, setCommission] = useState('')
  const [iva, setIva] = useState('')
  const [ticker, setTicker] = useState('')
  // Espejo de currencyRef.current.value: el campo de moneda sigue siendo no
  // controlado (para no tocar su comportamiento), pero necesitamos su valor
  // en cada render para decidir si mostrar el aviso de sufijo .SN.
  const [currencyValue, setCurrencyValue] = useState('')
  const currencyRef = useRef<HTMLInputElement | null>(null)
  // true mientras el contenido de `currencyRef` fue puesto por el
  // autocompletado del ticker (no por el usuario). Necesario para poder
  // deshacer la sugerencia: ver el onChange de "ticker" más abajo.
  const autofilledRef = useRef(false)
  // Bolsa de Santiago en Yahoo exige el sufijo .SN (ENELCHILE.SN, no
  // ENELCHILE); sin él, la API responde 404 y el activo nunca cotiza. Es un
  // aviso, no un bloqueo: puede haber activos en CLP fuera de la Bolsa de
  // Santiago, o con precios cargados a mano.
  const needsSnSuffixWarning =
    ticker.trim() !== '' &&
    !ticker.trim().toUpperCase().endsWith('.SN') &&
    currencyValue.trim().toUpperCase() === 'CLP'

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
        <h2 className="mb-1 text-lg font-semibold text-slate-200">Activos</h2>
        <p className="mb-3 text-xs text-slate-500">
          Define el instrumento (ticker, tipo y moneda). El precio no va aquí: se registra al comprar o vender en{' '}
          <span className="text-slate-400">Transacciones</span>.
        </p>
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
            if (ok) {
              form.reset()
              setTicker('')
              setCurrencyValue('')
              autofilledRef.current = false
            }
          }}
        >
          <input
            name="ticker"
            placeholder="Ticker (AAPL o ENELCHILE.SN)"
            required
            className={inputCls}
            value={ticker}
            onChange={(e) => {
              setTicker(e.target.value)
              // La Bolsa de Santiago usa el sufijo .SN en Yahoo y cotiza en pesos.
              // Sugerencia, no imposición: el campo sigue siendo editable. Pero la
              // sugerencia debe poder DESHACERSE: si el usuario escribe
              // ENELCHILE.SN (autocompleta CLP) y luego corrige el ticker a AAPL
              // sin tocar la moneda a mano, dejar CLP puesto produce una
              // subvaluación de ~950x completamente silenciosa. Por eso solo
              // tocamos el campo si está vacío o si su contenido actual lo puso
              // este mismo autocompletado — nunca si el usuario lo editó a mano.
              const el = currencyRef.current
              if (el && (el.value === '' || autofilledRef.current)) {
                const isCl = e.target.value.trim().toUpperCase().endsWith('.SN')
                el.value = isCl ? 'CLP' : ''
                autofilledRef.current = isCl
                setCurrencyValue(el.value)
              }
            }}
          />
          <input name="name" placeholder="Nombre (opcional)" className={inputCls} />
          <select name="assetType" required className={inputCls} defaultValue="stock">
            <option value="stock">Acción</option>
            <option value="etf">ETF</option>
            <option value="crypto">Crypto</option>
            <option value="cash">Efectivo</option>
            <option value="other">Otro</option>
          </select>
          <input
            name="currency"
            placeholder="Moneda (USD)"
            maxLength={3}
            className={inputCls}
            ref={currencyRef}
            onChange={(e) => {
              // El usuario está editando la moneda a mano: el autocompletado
              // deja de tener autoridad sobre este campo.
              autofilledRef.current = false
              setCurrencyValue(e.target.value)
            }}
          />
          <button type="submit" className={btnCls}>Añadir activo</button>
        </form>
        {needsSnSuffixWarning && (
          <p className="mb-3 text-xs text-amber-400">
            ⚠️ Los tickers de la Bolsa de Santiago necesitan el sufijo <strong>.SN</strong> en Yahoo (ej.{' '}
            <code>ENELCHILE.SN</code>). Sin él no se podrán descargar precios.
          </p>
        )}
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
        <h2 className="mb-1 text-lg font-semibold text-slate-200">Transacciones</h2>
        <p className="mb-3 text-xs text-slate-500">
          Registra una compra o venta: cantidad, <span className="text-slate-400">precio por unidad</span> y fecha,
          en la <span className="text-slate-400">moneda del activo</span>. El IVA se calcula solo (19% de la
          comisión) y puedes ajustarlo si el broker redondeó distinto.
        </p>
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
              commission: commission || 0,
              iva: iva || 0,
              executedAt: fd.get('executedAt'),
            })
            if (ok) {
              form.reset()
              setCommission('')
              setIva('')
              setTxAssetId('')
            }
          }}
        >
          <select
            name="assetId"
            required
            className={inputCls}
            value={txAssetId}
            onChange={(e) => setTxAssetId(e.target.value)}
          >
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
          <input name="price" type="number" step="any" min="0" placeholder="Precio (ej. 293.08)" required className={inputCls} />
          <input
            name="commission"
            type="number"
            step="any"
            min="0"
            placeholder="Comisión"
            className={inputCls}
            value={commission}
            onChange={(e) => {
              const v = e.target.value
              setCommission(v)
              // Autocálculo del IVA (19% sobre la comisión), redondeado según la
              // moneda: Zesty cobra en pesos enteros (19% de 29 = 5,51 → 6).
              const n = Number(v)
              if (v.trim() === '' || !Number.isFinite(n)) {
                setIva('')
                return
              }
              const isClp =
                assets.find((a) => a.id === txAssetId)?.currency?.toUpperCase() === 'CLP'
              const raw = n * IVA_RATE
              setIva(String(isClp ? Math.round(raw) : Math.round(raw * 100) / 100))
            }}
          />
          <input
            name="iva"
            type="number"
            step="any"
            min="0"
            placeholder="IVA"
            title="Autocalculado como 19% de la comisión; editable porque el broker redondea"
            className={inputCls}
            value={iva}
            onChange={(e) => setIva(e.target.value)}
          />
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
              <th className="text-right">IVA</th>
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
                <td className="text-right">
                  {Number(t.price).toLocaleString('es-CL')}{' '}
                  <span className="text-xs text-slate-500">{t.assets?.currency ?? ''}</span>
                </td>
                <td className="text-right">{Number(t.commission ?? 0).toLocaleString('es-CL')}</td>
                <td className="text-right">{Number(t.iva ?? 0).toLocaleString('es-CL')}</td>
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
                <td colSpan={8} className="py-4 text-slate-500">Sin transacciones todavía.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
