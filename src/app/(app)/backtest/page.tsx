// src/app/(app)/backtest/page.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Line,
  LineChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts'
import { equalWeights } from '@/lib/backtest/weights'
import type { BacktestResult, RebalanceFrequency } from '@/lib/backtest/types'
import { BASE_CURRENCY } from '@/lib/fx/constants'

// /api/positions devuelve { positions: PositionView[], totals }; marketValue puede ser null.
interface Position {
  ticker: string
  marketValue: number | null
}

const inputCls = 'rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200'
const btnCls =
  'rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50'
const ghostBtn = 'rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800'

const pct = (x: number | null) => (x == null ? '—' : `${(x * 100).toFixed(2)}%`)
const num = (x: number | null) => (x == null ? '—' : x.toFixed(2))
const todayISO = () => new Date().toISOString().slice(0, 10)
const fiveYearsAgoISO = () => {
  const d = new Date()
  d.setFullYear(d.getFullYear() - 5)
  return d.toISOString().slice(0, 10)
}

export default function BacktestPage() {
  const [tickers, setTickers] = useState<string[]>([])
  const [currentWeights, setCurrentWeights] = useState<Record<string, number>>({})
  const [weights, setWeights] = useState<Record<string, number>>({})
  const [weightsFromCurrent, setWeightsFromCurrent] = useState(false)
  const [frequency, setFrequency] = useState<RebalanceFrequency>('monthly')
  const [from, setFrom] = useState(fiveYearsAgoISO())
  const [to, setTo] = useState(todayISO())
  const [capital, setCapital] = useState(10000)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BacktestResult | null>(null)

  const loadPositions = useCallback(() => {
    fetch('/api/positions')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { positions: Position[] } | null) => {
        if (!data) return
        const ps = data.positions ?? []
        const ts = ps.map((p) => p.ticker)
        setTickers(ts)
        const total = ps.reduce((a, p) => a + (p.marketValue ?? 0), 0)
        const cur: Record<string, number> = {}
        for (const p of ps) cur[p.ticker] = total > 0 ? (p.marketValue ?? 0) / total : 0
        setCurrentWeights(cur)
        setWeights(equalWeights(ts)) // default 1/N (evita sesgo de retrospectiva)
      })
  }, [])

  useEffect(() => {
    loadPositions()
  }, [loadPositions])

  function useEqual() {
    setWeights(equalWeights(tickers))
    setWeightsFromCurrent(false)
  }
  function useCurrent() {
    setWeights({ ...currentWeights })
    setWeightsFromCurrent(true)
  }

  async function run() {
    setBusy(true)
    setError(null)
    setResult(null)
    const res = await fetch('/api/backtest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetWeights: weights, frequency, from, to, initialCapital: capital, weightsFromCurrent }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'el backtest falló')
      return
    }
    setResult(await res.json())
  }

  const chartData =
    result == null
      ? []
      : result.lines.rebalanced.equityCurve.map((p, i) => ({
          date: p.date,
          rebalanceado: p.value,
          buyHold: result.lines.buyHold.equityCurve[i]?.value ?? null,
          sp500: result.lines.benchmark?.equityCurve[i]?.value ?? null,
        }))

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-slate-100">Backtest — Rebalanceo</h1>

      {/* Definir */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-300">Pesos objetivo</span>
          <button className={ghostBtn} onClick={useEqual}>
            Equiponderado (1/N)
          </button>
          <button className={ghostBtn} onClick={useCurrent}>
            Mis pesos actuales
          </button>
        </div>

        {weightsFromCurrent && (
          <p className="rounded border border-amber-700 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
            ⚠️ Estos pesos reflejan la composición de HOY, no tu tesis de inversión de hace años. Usarlos como
            objetivo histórico introduce sesgo de retrospectiva: el backtest sobrestimará el rendimiento.
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          {tickers.map((t) => (
            <label key={t} className="flex items-center gap-2 text-sm text-slate-300">
              <span className="w-16 font-semibold">{t}</span>
              <input
                type="number"
                step="any"
                min="0"
                className={`${inputCls} w-24`}
                value={weights[t] ?? 0}
                onChange={(e) => setWeights({ ...weights, [t]: Number(e.target.value) })}
              />
            </label>
          ))}
          {tickers.length === 0 && <p className="text-sm text-slate-500">Tu cartera está vacía.</p>}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-slate-400">
            Frecuencia
            <select
              className={`${inputCls} mt-1 block`}
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as RebalanceFrequency)}
            >
              <option value="monthly">Mensual</option>
              <option value="quarterly">Trimestral</option>
            </select>
          </label>
          <label className="text-sm text-slate-400">
            Desde
            <input type="date" className={`${inputCls} mt-1 block`} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-sm text-slate-400">
            Hasta
            <input type="date" className={`${inputCls} mt-1 block`} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="text-sm text-slate-400">
            Capital inicial ({BASE_CURRENCY})
            <input
              type="number"
              step="any"
              min="0"
              className={`${inputCls} mt-1 block w-32`}
              value={capital}
              onChange={(e) => setCapital(Number(e.target.value))}
            />
          </label>
          <button className={btnCls} disabled={busy || tickers.length === 0} onClick={run}>
            {busy ? 'Ejecutando…' : 'Ejecutar'}
          </button>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </section>

      {/* Resultados */}
      {result && (
        <section className="space-y-6">
          {result.warnings.length > 0 && (
            <div className="rounded border border-amber-700 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
              {result.warnings.map((w, i) => (
                <p key={i}>⚠️ {w}</p>
              ))}
            </div>
          )}

          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs uppercase text-slate-500">
                <th className="py-2">Línea</th>
                <th className="px-4 text-right">Retorno Total</th>
                <th className="px-4 text-right">CAGR</th>
                <th className="px-4 text-right">Sharpe</th>
                <th className="px-4 text-right">Max Drawdown</th>
                <th className="px-4 text-right">Turnover</th>
              </tr>
            </thead>
            <tbody>
              {([
                ['Rebalanceado', result.lines.rebalanced],
                ['Buy & Hold', result.lines.buyHold],
                ['S&P 500', result.lines.benchmark],
              ] as const).map(([label, line]) => (
                <tr key={label} className="border-b border-slate-900">
                  <td className="py-2 font-semibold">{label}</td>
                  <td className="px-4 text-right">{line ? pct(line.totalReturn) : '—'}</td>
                  <td className="px-4 text-right">{line ? pct(line.cagr) : '—'}</td>
                  <td className="px-4 text-right">{line ? num(line.sharpe) : '—'}</td>
                  <td className="px-4 text-right">{line ? pct(line.maxDrawdown) : '—'}</td>
                  <td className="px-4 text-right">{line ? pct(line.turnoverTotal) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="text-sm text-slate-300">
            <span className="font-semibold">Rebalanceado vs S&P 500:</span>{' '}
            {pct(result.vsBenchmark.geometric)} (exceso geométrico)
            {result.vsBenchmark.cagrSpread != null && ` · ${pct(result.vsBenchmark.cagrSpread)} CAGR`}
          </p>
          <p className="text-xs text-slate-500">
            El retorno no descuenta costos de transacción (spread/comisiones) del rebalanceo; el Sharpe del
            rebalanceo está optimista frente a Buy & Hold.
          </p>

          <div className="h-80 w-full">
            <ResponsiveContainer>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 11 }} minTickGap={40} />
                <YAxis stroke="#64748b" tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} />
                <Legend />
                <Line type="monotone" dataKey="rebalanceado" stroke="#3b82f6" dot={false} name="Rebalanceado" />
                <Line type="monotone" dataKey="buyHold" stroke="#a78bfa" dot={false} name="Buy & Hold" />
                <Line type="monotone" dataKey="sp500" stroke="#64748b" dot={false} name="S&P 500" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}
    </div>
  )
}
