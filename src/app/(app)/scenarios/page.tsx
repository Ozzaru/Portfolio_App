// src/app/(app)/scenarios/page.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { StressResult } from '@/lib/scenarios/types'
import { formatMoney } from '@/lib/format/money'
import { BASE_CURRENCY } from '@/lib/fx/constants'

interface Position {
  ticker: string
}

const inputCls = 'rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200'
const btnCls =
  'rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50'
const ghostBtn = 'rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800'

const pct = (x: number | null) => (x == null ? '—' : `${(x * 100).toFixed(2)}%`)
const money = (x: number | null) => formatMoney(x, BASE_CURRENCY)

export default function ScenariosPage() {
  const [tickers, setTickers] = useState<string[]>([])
  const [marketShockPct, setMarketShockPct] = useState(-20)
  const [overridesPct, setOverridesPct] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<StressResult | null>(null)

  const loadPositions = useCallback(() => {
    fetch('/api/positions')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { positions: Position[] } | null) => {
        if (!data) return
        setTickers((data.positions ?? []).map((p) => p.ticker))
      })
  }, [])

  useEffect(() => {
    loadPositions()
  }, [loadPositions])

  async function run() {
    setBusy(true)
    setError(null)
    setResult(null)
    const overrides: Record<string, number> = {}
    for (const [t, v] of Object.entries(overridesPct)) {
      if (v.trim() !== '') overrides[t] = Number(v) / 100
    }
    const res = await fetch('/api/scenarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marketShock: marketShockPct / 100, overrides }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'el escenario falló')
      return
    }
    setResult(await res.json())
  }

  const chartData =
    result == null
      ? []
      : result.perAsset.map((a) => ({ ticker: a.ticker, Antes: a.valueBefore, Después: a.valueAfter }))

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-slate-100">Escenarios — Stress Test</h1>

      <p className="rounded border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-400">
        Los shocks se aplican sobre retornos en {BASE_CURRENCY} con el{' '}
        <span className="text-slate-300">tipo de cambio fijo</span>. En la realidad, un selloff global
        suele fortalecer el dólar frente al peso y amortiguar parcialmente la caída de la porción en
        USD: el escenario que ves es, en ese sentido, conservador.
      </p>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-slate-400">
            Shock de mercado (S&amp;P 500) %
            <input
              type="number"
              step="any"
              className={`${inputCls} mt-1 block w-32`}
              value={marketShockPct}
              onChange={(e) => setMarketShockPct(Number(e.target.value))}
            />
          </label>
          <div className="flex gap-2">
            {[-10, -20, -30, 10].map((v) => (
              <button key={v} className={ghostBtn} onClick={() => setMarketShockPct(v)}>
                {v > 0 ? `+${v}` : v}%
              </button>
            ))}
          </div>
          <button className={btnCls} disabled={busy || tickers.length === 0} onClick={run}>
            {busy ? 'Ejecutando…' : 'Ejecutar'}
          </button>
        </div>

        {tickers.length > 0 ? (
          <div className="space-y-2">
            <span className="text-sm font-semibold text-slate-300">
              Overrides por activo (%, en blanco = beta)
            </span>
            <div className="flex flex-wrap gap-3">
              {tickers.map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm text-slate-300">
                  <span className="w-16 font-semibold">{t}</span>
                  <input
                    type="number"
                    step="any"
                    placeholder="beta"
                    className={`${inputCls} w-24`}
                    value={overridesPct[t] ?? ''}
                    onChange={(e) => setOverridesPct({ ...overridesPct, [t]: e.target.value })}
                  />
                </label>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Tu cartera está vacía.</p>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </section>

      {result && (
        <section className="space-y-6">
          {result.warnings.length > 0 && (
            <div className="rounded border border-amber-700 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
              {result.warnings.map((w, i) => (
                <p key={i}>⚠️ {w}</p>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-6">
            <div>
              <p className="text-xs uppercase text-slate-500">Valor antes</p>
              <p className="text-lg font-semibold text-slate-100">{money(result.portfolio.valueBefore)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">Valor después</p>
              <p className="text-lg font-semibold text-slate-100">{money(result.portfolio.valueAfter)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">P&amp;L escenario</p>
              <p className="text-lg font-semibold text-slate-100">
                {money(result.portfolio.pnlAbs)} · {pct(result.portfolio.pnlPct)}
              </p>
            </div>
          </div>

          <p className="text-sm text-slate-300">
            <span className="font-semibold">Tu cartera vs S&amp;P estresado:</span>{' '}
            {pct(result.vsBenchmark.portfolioPct)} vs {pct(result.vsBenchmark.marketShock)} · beta agregada{' '}
            {result.portfolio.aggregateBeta.toFixed(2)}
          </p>

          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs uppercase text-slate-500">
                <th className="py-2">Activo</th>
                <th className="px-4 text-right">Shock aplicado</th>
                <th className="px-4 text-right">Valor antes</th>
                <th className="px-4 text-right">Valor después</th>
                <th className="px-4 text-right">Contribución</th>
              </tr>
            </thead>
            <tbody>
              {result.perAsset.map((a) => (
                <tr key={a.ticker} className="border-b border-slate-900">
                  <td className="py-2 font-semibold">
                    {a.ticker}
                    {a.betaFallback ? ' *' : ''}
                  </td>
                  <td className="px-4 text-right">{pct(a.shockApplied)}</td>
                  <td className="px-4 text-right">{money(a.valueBefore)}</td>
                  <td className="px-4 text-right">{money(a.valueAfter)}</td>
                  <td className="px-4 text-right">{money(a.lossContribAbs)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="text-xs text-slate-500">
            El simulador usa sensibilidad histórica promedio (beta). En colapsos severos las correlaciones
            tienden a aumentar, por lo que la pérdida real podría ser mayor. (* beta por fallback)
          </p>

          <div className="h-80 w-full">
            <ResponsiveContainer>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="ticker" stroke="#64748b" tick={{ fontSize: 11 }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} />
                <Legend />
                <Bar dataKey="Antes" fill="#64748b" />
                <Bar dataKey="Después" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}
    </div>
  )
}
