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
  // El destino es controlado —a diferencia del resto de los campos— para que el
  // placeholder del monto pueda nombrar su moneda. Cambiar el destino sin que el
  // campo diga en qué moneda se escribe es como se invierten los dos montos.
  const [toId, setToId] = useState('')

  const { data: balancesData, error: balancesError } = useResource<Balance[]>(`/api/cash/balances?portfolio=${portfolio}`)
  const { data: movementsData } = useResource<Movement[]>(`/api/cash/movements?portfolio=${portfolio}`)
  const { data: transfersData } = useResource<Transfer[]>(`/api/cash/transfers?portfolio=${portfolio}`)
  const { data: portfoliosData } = useResource<PortfolioRef[]>('/api/portfolios')

  const balances = balancesData ?? []
  const movements = movementsData ?? []
  const transfers = transfersData ?? []
  const portfolios = portfoliosData ?? []

  const current = portfolios.find((p) => p.slug === portfolio) ?? null
  const others = portfolios.filter((p) => p.slug !== portfolio)
  const dest = others.find((p) => p.id === toId) ?? others[0] ?? null
  const baseCurrency = current?.baseCurrency ?? ''
  // `[]` significa saldo cero SOLO si la lectura resolvió. Mientras carga, o si
  // falló, `balancesData` es undefined y afirmar "saldo $0" sería inventar un
  // número para un portafolio que puede tener plata de verdad. Y `baseCurrency`
  // llega de otra petición: sin ella no hay moneda con la que formatear.
  const balancesReady = balancesData !== undefined && baseCurrency !== ''

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
        // Las rutas devuelven `flatten()`, que es un objeto {fieldErrors, formErrors}.
        // Sin desarmarlo, cualquier fallo de validación se ve como un único
        // "Error de validación" sin decir qué campo — inservible digitando cartolas.
        const flat = data?.error
        if (typeof flat === 'string') setError(flat)
        else if (flat?.fieldErrors) {
          const campos = Object.entries(flat.fieldErrors as Record<string, string[]>)
            .map(([campo, msgs]) => `${campo}: ${msgs.join(', ')}`)
            .join(' · ')
          setError(campos || 'Error de validación')
        } else setError('Error de validación')
        return false
      }
      invalidateAfter('cash')
      return true
    } finally {
      setSubmitting(false)
    }
  }

  async function remove(url: string) {
    setError(null)
    const res = await fetch(url, { method: 'DELETE' })
    if (!res.ok) {
      setError('No se pudo borrar')
      return
    }
    invalidateAfter('cash')
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-200">Efectivo</h2>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Saldos. Sin filas = saldo cero, pero SÓLO si la lectura resolvió. */}
      {balancesError && (
        <p className="text-sm text-red-400">
          No se pudieron leer los saldos: {balancesError.message}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {!balancesError && !balancesReady && (
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-500">
            Cargando saldos…
          </div>
        )}
        {balancesReady && balances.length === 0 && (
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-500">
            Sin movimientos registrados: saldo {formatMoney(0, baseCurrency)}.
          </div>
        )}
        {balancesReady &&
          balances.map((b) => (
            <div key={b.currency} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">Saldo {b.currency}</div>
              <div className={`mt-1 text-2xl font-bold ${b.balance < 0 ? 'text-amber-400' : 'text-slate-100'}`}>
                {formatMoney(b.balance, b.currency)}
              </div>
              {b.balance < 0 && (
                <p className="mt-2 max-w-xs text-xs text-amber-400">
                  Faltan {formatMoney(-b.balance, b.currency)} por registrar. Agrega el abono que
                  corresponda, o ignóralo si es margen del broker.
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
          if (ok) {
            // La fecha se conserva: digitar una cartola son varias filas de la
            // misma fecha, y resetearla obliga a reescribirla en cada una.
            const keepDate = fd.get('occurredAt') as string
            form.reset()
            const dateInput = form.elements.namedItem('occurredAt') as HTMLInputElement | null
            if (dateInput) dateInput.value = keepDate
          }
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
          min="0.01"
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
          {[...new Set([...portfolios.map((p) => p.baseCurrency), ...balances.map((b) => b.currency)])].map(
            (c) => (
              <option key={c} value={c}>{c}</option>
            )
          )}
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
            const ok = await post(`/api/cash/transfers?portfolio=${portfolio}`, {
              toPortfolioId: dest?.id ?? '',
              fromCurrency: baseCurrency,
              fromAmount: fd.get('fromAmount'),
              toCurrency: dest?.baseCurrency ?? '',
              toAmount: fd.get('toAmount'),
              occurredAt: fd.get('occurredAt'),
              note: fd.get('note') ?? '',
            })
            if (ok) {
              // La fecha se conserva: digitar una cartola son varias filas de la
              // misma fecha, y resetearla obliga a reescribirla en cada una.
              const keepDate = fd.get('occurredAt') as string
              form.reset()
              const dateInput = form.elements.namedItem('occurredAt') as HTMLInputElement | null
              if (dateInput) dateInput.value = keepDate
            }
          }}
        >
          <input
            name="fromAmount"
            type="number"
            step="any"
            min="0.01"
            placeholder={`Sale (${baseCurrency})`}
            required
            className={inputCls}
          />
          {/* Controlado, a diferencia del resto de los campos: el placeholder del
              monto de llegada necesita leer la moneda del destino en cada render.
              Cambiar el destino sin que el campo diga en qué moneda se escribe es
              como se terminan invirtiendo los dos montos.
              NO lleva `key` como el de moneda: el gate `others.length > 0` impide
              que este select monte antes de que existan sus opciones. */}
          <select
            name="toPortfolioId"
            required
            className={inputCls}
            value={dest?.id ?? ''}
            onChange={(e) => setToId(e.target.value)}
          >
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
            min="0.01"
            placeholder={`Llega (${dest?.baseCurrency ?? ''})`}
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
              <th className="py-2"></th>
              <th>Fecha</th>
              <th className="text-right">Sale</th>
              <th className="text-right">Llega</th>
              <th className="text-right">Tasa (CLP/USD)</th>
              <th className="text-right">Mercado (CLP/USD)</th>
              <th className="text-right">Costo spread</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {transfers.map((t) => (
              <tr key={t.id} className="border-b border-slate-900">
                {/* De qué lado estás: la MISMA fila se ve desde los dos
                    portafolios, y sin esto un abono en dólares se lee como una
                    salida de pesos que en este portafolio nunca ocurrió. */}
                <td className="py-2">
                  {t.from_portfolio_id === current?.id ? (
                    <span className="text-red-400" title="Sale de este portafolio">↑</span>
                  ) : (
                    <span className="text-green-400" title="Entra a este portafolio">↓</span>
                  )}
                </td>
                <td>{t.occurred_at}</td>
                <td className="text-right">{formatMoney(Number(t.from_amount), t.from_currency)}</td>
                <td className="text-right">{formatMoney(Number(t.to_amount), t.to_currency)}</td>
                <td className="text-right">
                  {t.clp_por_usd === null ? '—' : Number(t.clp_por_usd).toFixed(2)}
                </td>
                <td className="text-right text-slate-500">
                  {t.clp_por_usd_mercado === null ? '—' : Number(t.clp_por_usd_mercado).toFixed(2)}
                </td>
                {/* Ámbar SÓLO cuando el broker te cobró. El valor es negativo si
                    convertiste mejor que el mercado, y pintar un ahorro como
                    advertencia gasta el único color que arriba significa "actúa". */}
                <td
                  className={`text-right ${
                    t.costo_spread_clp !== null && Number(t.costo_spread_clp) > 0
                      ? 'text-amber-400'
                      : 'text-slate-300'
                  }`}
                  title={
                    t.costo_spread_clp === null
                      ? 'Sin tipo de cambio de mercado para esa fecha — refresca precios en Fuentes de datos'
                      : undefined
                  }
                >
                  {t.costo_spread_clp === null ? '—' : formatMoney(Number(t.costo_spread_clp), 'CLP')}
                </td>
                <td className="text-right">
                  <button
                    onClick={() => remove(`/api/cash/transfers/${t.id}`)}
                    className="text-slate-600 hover:text-red-400"
                    title="Borrar la conversión y sus dos patas (afecta a ambos portafolios)"
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
