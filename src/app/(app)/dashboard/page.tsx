// src/app/(app)/dashboard/page.tsx
'use client'

import { useEffect, useState } from 'react'
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts'
import { PeriodSelector } from '@/components/period-selector'
import { usePeriod, useBenchmark } from '@/lib/hooks/use-prefs'

interface Position {
  assetId: string
  ticker: string
  quantity: number
  costBasis: number
  avgCost: number
  currentPrice: number | null
  marketValue: number | null
  unrealizedPnl: number | null
  unrealizedPnlPct: number | null
}

interface Totals {
  totalValue: number
  totalCost: number
  totalPnl: number
  totalPnlPct: number
  assetCount: number
  dailyPnl: number
}

interface SeriesPoint {
  date: string
  portfolio: number
  benchmark: number | null
}

const COLORS = ['#3b82f6', '#22c55e', '#f97316', '#818cf8', '#ec4899', '#14b8a6', '#eab308', '#f43f5e']

const fmt = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

function KpiCard({ label, value, accent }: { label: string; value: string; accent?: 'up' | 'down' }) {
  const color = accent === 'up' ? 'text-green-400' : accent === 'down' ? 'text-red-400' : 'text-slate-100'
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${color}`}>{value}</div>
    </div>
  )
}

export default function DashboardPage() {
  const [positions, setPositions] = useState<Position[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)

  useEffect(() => {
    fetch('/api/positions')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setPositions(data.positions)
          setTotals(data.totals)
        }
      })
  }, [])

  const [period, setPeriod] = usePeriod()
  const [benchmark] = useBenchmark()
  const [series, setSeries] = useState<SeriesPoint[]>([])

  useEffect(() => {
    let active = true
    fetch(`/api/analytics?period=${period}&benchmark=${benchmark}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (active && data) setSeries(data.series as SeriesPoint[])
      })
    return () => {
      active = false
    }
  }, [period, benchmark])

  const allocation = positions
    .filter((p) => p.marketValue !== null)
    .map((p) => ({ name: p.ticker, value: p.marketValue as number }))

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-slate-100">Dashboard</h1>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Valor Total" value={totals ? fmt(totals.totalValue) : '—'} />
        <KpiCard
          label="P&L Hoy"
          value={totals ? fmt(totals.dailyPnl) : '—'}
          accent={totals ? (totals.dailyPnl >= 0 ? 'up' : 'down') : undefined}
        />
        <KpiCard
          label="Retorno Total"
          value={totals ? `${totals.totalPnlPct.toFixed(1)}%` : '—'}
          accent={totals ? (totals.totalPnl >= 0 ? 'up' : 'down') : undefined}
        />
        <KpiCard label="Activos" value={totals ? String(totals.assetCount) : '—'} />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-3 text-lg font-semibold text-slate-200">Distribución de activos</h2>
          {allocation.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">
              Registra transacciones y precios para ver la distribución.
            </p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={allocation} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90}>
                    {allocation.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => fmt(Number(v))} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-3 text-lg font-semibold text-slate-200">Posiciones</h2>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs uppercase text-slate-500">
                <th className="py-2">Ticker</th>
                <th className="text-right">Cantidad</th>
                <th className="text-right">Costo prom.</th>
                <th className="text-right">Precio</th>
                <th className="text-right">Valor</th>
                <th className="text-right">P&L</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.assetId} className="border-b border-slate-900">
                  <td className="py-2 font-semibold">{p.ticker}</td>
                  <td className="text-right">{p.quantity}</td>
                  <td className="text-right">{p.avgCost.toFixed(2)}</td>
                  <td className="text-right">{p.currentPrice?.toFixed(2) ?? '—'}</td>
                  <td className="text-right">{p.marketValue !== null ? fmt(p.marketValue) : '—'}</td>
                  <td
                    className={`text-right ${
                      p.unrealizedPnl === null
                        ? 'text-slate-500'
                        : p.unrealizedPnl >= 0
                          ? 'text-green-400'
                          : 'text-red-400'
                    }`}
                  >
                    {p.unrealizedPnl !== null
                      ? `${fmt(p.unrealizedPnl)} (${p.unrealizedPnlPct?.toFixed(1)}%)`
                      : '—'}
                  </td>
                </tr>
              ))}
              {positions.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-slate-500">Sin posiciones abiertas.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>

      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-200">Rendimiento</h2>
          <PeriodSelector value={period} onChange={setPeriod} />
        </div>
        {series.length < 2 ? (
          <p className="py-10 text-center text-sm text-slate-500">
            Registra transacciones y corre el backfill de históricos en{' '}
            <a href="/data-sources" className="text-blue-400 underline">
              Fuentes de datos
            </a>{' '}
            para ver el rendimiento.
          </p>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} minTickGap={40} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} domain={['auto', 'auto']} />
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', color: '#e2e8f0' }}
                />
                <Legend />
                <Line type="monotone" dataKey="portfolio" name="Portafolio" stroke="#3b82f6" dot={false} />
                <Line type="monotone" dataKey="benchmark" name="Benchmark" stroke="#22c55e" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </div>
  )
}
