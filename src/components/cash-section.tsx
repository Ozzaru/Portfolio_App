// src/components/cash-section.tsx
'use client'

import { useState } from 'react'
import { useResource } from '@/lib/hooks/use-resource'
import { invalidateAfter } from '@/lib/cache/resources'
import { formatMoney } from '@/lib/format/money'

interface Balance {
  currency: string
  balance: number
}

interface Movement {
  id: string
  currency: string
  movement_type: 'deposit' | 'withdrawal'
  amount: number
  occurred_at: string
  note: string
}

interface Transfer {
  id: string
  from_portfolio_id: string
  from_currency: string
  from_amount: number
  to_portfolio_id: string
  to_currency: string
  to_amount: number
  occurred_at: string
  note: string
  clp_por_usd: number | null
  clp_por_usd_mercado: number | null
  costo_spread_clp: number | null
}

interface PortfolioRef {
  id: string
  slug: string
  name: string
  baseCurrency: string
}

const inputCls = 'rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200'
const btnCls = 'rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500'

export function CashSection({ portfolio }: { portfolio: string }) {
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const { data: balancesData } = useResource<Balance[]>(`/api/cash/balances?portfolio=${portfolio}`)
  const { data: movementsData } = useResource<Movement[]>(`/api/cash/movements?portfolio=${portfolio}`)
  const { data: transfersData } = useResource<Transfer[]>(`/api/cash/transfers?portfolio=${portfolio}`)
  const { data: portfoliosData } = useResource<PortfolioRef[]>('/api/portfolios')

  const balances = balancesData ?? []
  const movements = movementsData ?? []
  const transfers = transfersData ?? []
  const portfolios = portfoliosData ?? []

  const current = portfolios.find((p) => p.slug === portfolio) ?? null
  const others = portfolios.filter((p) => p.slug !== portfolio)
  const baseCurrency = current?.baseCurrency ?? ''

  // La guarda de envío en vuelo NO es cosmética acá. Un doble click en "Registrar
  // movimiento" crea dos abonos idénticos, y un abono duplicado es INDISTINGUIBLE
  // de uno real: no infla ninguna posición, no rompe ninguna cuenta, sólo deja el
  // saldo silenciosamente mal. Un trade duplicado al menos se ve como una posición
  // del doble de tamaño. Es exactamente el "cálculo que se ve bien y miente" que
  // este proyecto vino a cerrar.
  //
  // No hay unique en la base a propósito: dos abonos reales de $50.000 el mismo
  // día son legítimos. La recuperación es borrar el sobrante desde el libro.
  async function post(url: string, body: unknown) {
    if (submitting) return false
    setSubmitting(true)
    setError(null)
    try {
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
      invalidateAfter('cash')
      return true
    } finally {
      setSubmitting(false)
    }
  }

  async function remove(url: string) {
    await fetch(url, { method: 'DELETE' })
    invalidateAfter('cash')
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-200">Efectivo</h2>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Saldos. Sin filas = saldo cero, no "sin datos". */}
      <div className="flex flex-wrap gap-3">
        {balances.length === 0 && (
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-500">
            Sin movimientos registrados: saldo {formatMoney(0, baseCurrency)}.
          </div>
        )}
        {balances.map((b) => (
          <div key={b.currency} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">Saldo {b.currency}</div>
            <div
              className={`mt-1 text-2xl font-bold ${b.balance < 0 ? 'text-amber-400' : 'text-slate-100'}`}
            >
              {formatMoney(b.balance, b.currency)}
            </div>
            {b.balance < 0 && (
              <p className="mt-2 max-w-xs text-xs text-amber-400">
                Saldo negativo: falta registrar un abono, o el bróker te dio margen. No es un
                error de la app — es plata que salió sin que entrara antes.
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Abono / retiro */}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          const form = e.currentTarget
          const fd = new FormData(form)
          const ok = await post(`/api/cash/movements?portfolio=${portfolio}`, {
            movementType: fd.get('movementType'),
            amount: fd.get('amount'),
            currency: fd.get('currency') || baseCurrency,
            occurredAt: fd.get('occurredAt'),
            note: fd.get('note') ?? '',
          })
          if (ok) form.reset()
        }}
      >
        <select name="movementType" required className={inputCls} defaultValue="deposit">
          <option value="deposit">Abono</option>
          <option value="withdrawal">Retiro</option>
        </select>
        <input
          name="amount"
          type="number"
          step="any"
          min="0"
          placeholder="Monto (siempre positivo)"
          title="Escribe la magnitud; el signo lo pone el tipo de movimiento"
          required
          className={inputCls}
        />
        {/* `<select>` y no texto libre. `cash_movements.currency` es libre a
            propósito en el esquema, pero un typo tipo `CPL` crearía un bucket
            fantasma permanente en `cash_balances` —que agrupa por moneda— y
            sólo se podría borrar con SQL a mano. Las opciones salen de las
            monedas base que el usuario realmente tiene. */}
        {/* `key` no es decoración: `defaultValue` sólo se aplica en el primer
            render, y `baseCurrency` llega asíncrono desde /api/portfolios. Sin
            el remonte, el select se quedaría en la primera opción de la lista
            —CLP— aunque estuvieras en el portafolio internacional. */}
        <select
          key={baseCurrency}
          name="currency"
          required
          className={inputCls}
          defaultValue={baseCurrency}
        >
          {[...new Set(portfolios.map((p) => p.baseCurrency))].map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <input name="occurredAt" type="date" required className={inputCls} />
        <input name="note" placeholder="Nota (opcional)" className={inputCls} />
        <button type="submit" disabled={submitting} className={btnCls}>Registrar movimiento</button>
      </form>

      {/* Conversión. Sólo tiene sentido si hay a dónde mandar la plata. */}
      {others.length > 0 && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            const form = e.currentTarget
            const fd = new FormData(form)
            const dest = portfolios.find((p) => p.id === fd.get('toPortfolioId'))
            const ok = await post(`/api/cash/transfers?portfolio=${portfolio}`, {
              toPortfolioId: fd.get('toPortfolioId'),
              fromCurrency: baseCurrency,
              fromAmount: fd.get('fromAmount'),
              toCurrency: dest?.baseCurrency ?? '',
              toAmount: fd.get('toAmount'),
              occurredAt: fd.get('occurredAt'),
              note: fd.get('note') ?? '',
            })
            if (ok) form.reset()
          }}
        >
          <input
            name="fromAmount"
            type="number"
            step="any"
            min="0"
            placeholder={`Sale (${baseCurrency})`}
            required
            className={inputCls}
          />
          <select name="toPortfolioId" required className={inputCls} defaultValue={others[0]?.id}>
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                → {p.name} ({p.baseCurrency})
              </option>
            ))}
          </select>
          <input
            name="toAmount"
            type="number"
            step="any"
            min="0"
            placeholder="Llega"
            required
            className={inputCls}
          />
          <input name="occurredAt" type="date" required className={inputCls} />
          <input name="note" placeholder="Nota (opcional)" className={inputCls} />
          <button type="submit" disabled={submitting} className={btnCls}>Registrar conversión</button>
        </form>
      )}

      {/* Conversiones con su spread */}
      {transfers.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-xs uppercase text-slate-500">
              <th className="py-2">Fecha</th>
              <th className="text-right">Sale</th>
              <th className="text-right">Llega</th>
              <th className="text-right">Tasa</th>
              <th className="text-right">Mercado</th>
              <th className="text-right">Costo spread</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {transfers.map((t) => (
              <tr key={t.id} className="border-b border-slate-900">
                <td className="py-2">{t.occurred_at}</td>
                <td className="text-right">{formatMoney(Number(t.from_amount), t.from_currency)}</td>
                <td className="text-right">{formatMoney(Number(t.to_amount), t.to_currency)}</td>
                <td className="text-right">
                  {t.clp_por_usd === null ? '—' : Number(t.clp_por_usd).toFixed(2)}
                </td>
                <td className="text-right text-slate-500">
                  {t.clp_por_usd_mercado === null ? '—' : Number(t.clp_por_usd_mercado).toFixed(2)}
                </td>
                <td className="text-right text-amber-400">
                  {t.costo_spread_clp === null ? '—' : formatMoney(Number(t.costo_spread_clp), 'CLP')}
                </td>
                <td className="text-right">
                  <button
                    onClick={() => remove(`/api/cash/transfers/${t.id}`)}
                    className="text-slate-600 hover:text-red-400"
                    title="Borrar la conversión y sus dos patas"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Abonos y retiros */}
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-xs uppercase text-slate-500">
            <th className="py-2">Fecha</th>
            <th>Tipo</th>
            <th className="text-right">Monto</th>
            <th>Nota</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {movements.map((m) => (
            <tr key={m.id} className="border-b border-slate-900">
              <td className="py-2">{m.occurred_at}</td>
              <td className={m.movement_type === 'deposit' ? 'text-green-400' : 'text-red-400'}>
                {m.movement_type === 'deposit' ? 'Abono' : 'Retiro'}
              </td>
              <td className="text-right">{formatMoney(Number(m.amount), m.currency)}</td>
              <td className="text-slate-500">{m.note}</td>
              <td className="text-right">
                <button
                  onClick={() => remove(`/api/cash/movements/${m.id}`)}
                  className="text-slate-600 hover:text-red-400"
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
          {movements.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-slate-500">Sin abonos ni retiros todavía.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )
}
