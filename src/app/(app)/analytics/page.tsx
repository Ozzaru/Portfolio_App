// src/app/(app)/analytics/page.tsx
'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { PeriodSelector } from '@/components/period-selector'
import { BenchmarkSelector } from '@/components/benchmark-selector'
import { usePeriod, useBenchmark } from '@/lib/hooks/use-prefs'

interface AnalyticsData {
  series: { date: string; portfolio: number; benchmark: number | null }[]
  summary: {
    portfolioTwr: number | null
    benchmarkTwr: number | null
    absolutePnl: number | null
    volatility: number | null
    sharpe: number | null
    maxDrawdown: number | null
  }
  perAsset: { ticker: string; return: number | null }[]
  correlation: { tickers: string[]; matrix: (number | null)[][] }
  benchmarkError: string | null
}

const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(1)}%`)
const usd = (n: number | null) =>
  n === null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const num = (n: number | null) => (n === null ? '—' : n.toFixed(2))

function MetricCard({ label, value, accent }: { label: string; value: string; accent?: 'up' | 'down' }) {
  const color = accent === 'up' ? 'text-green-400' : accent === 'down' ? 'text-red-400' : 'text-slate-100'
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-bold ${color}`}>{value}</div>
    </div>
  )
}

// Verde = se mueven juntos (+1), rojo = opuestos (−1); interpola rojo→gris→verde.
function corrTextClass(v: number | null): string {
  return v === null ? 'text-slate-500' : 'text-white'
}
function corrStyle(v: number | null): CSSProperties {
  if (v === null) return {}
  const g = v > 0 ? Math.round(120 * v) : 0
  const r = v < 0 ? Math.round(120 * -v) : 0
  return { backgroundColor: `rgb(${30 + r}, ${30 + g}, 40)` }
}

export default function AnalyticsPage() {
  const [period, setPeriod] = usePeriod()
  const [benchmark, setBenchmark] = useBenchmark()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loadedKey, setLoadedKey] = useState<string>('')

  const key = `${period}|${benchmark}`
  useEffect(() => {
    let active = true
    fetch(`/api/analytics?period=${period}&benchmark=${benchmark}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!active) return
        setData(d)
        setLoadedKey(key)
      })
    return () => {
      active = false
    }
  }, [period, benchmark, key])

  // loading derivado: la clave cargada aún no coincide con la actual (evita setState
  // síncrono en el effect; ver regla react-hooks/set-state-in-effect).
  const loading = loadedKey !== key
  const s = data?.summary
  const hasSeries = (data?.series.length ?? 0) >= 2

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-100">Analítica</h1>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodSelector value={period} onChange={setPeriod} />
          <BenchmarkSelector value={benchmark} onChange={setBenchmark} />
        </div>
      </div>

      {data?.benchmarkError && (
        <p className="rounded border border-amber-900 bg-amber-950 px-3 py-2 text-sm text-amber-300">
          Benchmark no disponible: {data.benchmarkError}
        </p>
      )}

      {loading && <p className="text-sm text-slate-500">Calculando…</p>}

      {!loading && !hasSeries && (
        <p className="py-10 text-center text-sm text-slate-500">
          No hay suficientes datos. Registra transacciones y corre el backfill de históricos en{' '}
          <a href="/data-sources" className="text-blue-400 underline">
            Fuentes de datos
          </a>
          .
        </p>
      )}

      {!loading && hasSeries && data && s && (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <MetricCard
              label="Retorno (TWR)"
              value={pct(s.portfolioTwr)}
              accent={s.portfolioTwr === null ? undefined : s.portfolioTwr >= 0 ? 'up' : 'down'}
            />
            <MetricCard label="Benchmark (TWR)" value={pct(s.benchmarkTwr)} />
            <MetricCard
              label="P&L del período"
              value={usd(s.absolutePnl)}
              accent={s.absolutePnl === null ? undefined : s.absolutePnl >= 0 ? 'up' : 'down'}
            />
            <MetricCard label="Volatilidad" value={pct(s.volatility)} />
            <MetricCard label="Sharpe" value={num(s.sharpe)} />
            <MetricCard
              label="Máx. drawdown"
              value={pct(s.maxDrawdown)}
              accent={s.maxDrawdown === null ? undefined : 'down'}
            />
          </section>

          <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-3 text-lg font-semibold text-slate-200">Rendimiento vs benchmark</h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} minTickGap={40} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', color: '#e2e8f0' }} />
                  <Legend />
                  <Line type="monotone" dataKey="portfolio" name="Portafolio" stroke="#3b82f6" dot={false} />
                  <Line type="monotone" dataKey="benchmark" name="Benchmark" stroke="#22c55e" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <h2 className="mb-3 text-lg font-semibold text-slate-200">Retorno por activo</h2>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-xs uppercase text-slate-500">
                    <th className="py-2">Ticker</th>
                    <th className="text-right">Retorno</th>
                  </tr>
                </thead>
                <tbody>
                  {data.perAsset.map((a) => (
                    <tr key={a.ticker} className="border-b border-slate-900">
                      <td className="py-2 font-semibold">{a.ticker}</td>
                      <td
                        className={`text-right ${
                          a.return === null ? 'text-slate-500' : a.return >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}
                      >
                        {pct(a.return)}
                      </td>
                    </tr>
                  ))}
                  {data.perAsset.length === 0 && (
                    <tr>
                      <td colSpan={2} className="py-4 text-slate-500">
                        Sin posiciones abiertas.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>

            <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <h2 className="mb-3 text-lg font-semibold text-slate-200">Correlaciones</h2>
              {data.correlation.tickers.length < 2 ? (
                <p className="py-6 text-center text-sm text-slate-500">
                  Se necesitan al menos 2 activos para la matriz de correlaciones.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="text-sm">
                    <thead>
                      <tr>
                        <th className="p-2"></th>
                        {data.correlation.tickers.map((t) => (
                          <th key={t} className="p-2 text-xs text-slate-400">
                            {t}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.correlation.matrix.map((row, i) => (
                        <tr key={data.correlation.tickers[i]}>
                          <td className="p-2 text-xs font-semibold text-slate-400">
                            {data.correlation.tickers[i]}
                          </td>
                          {row.map((v, j) => (
                            <td
                              key={j}
                              className={`p-2 text-center text-xs ${corrTextClass(v)}`}
                              style={corrStyle(v)}
                            >
                              {v === null ? '—' : v.toFixed(2)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
