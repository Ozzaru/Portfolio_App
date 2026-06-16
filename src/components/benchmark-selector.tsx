// src/components/benchmark-selector.tsx
'use client'

import { BENCHMARK_PRESETS } from '@/lib/analytics/benchmarks'

export function BenchmarkSelector({ value, onChange }: { value: string; onChange: (b: string) => void }) {
  return (
    <select
      aria-label="Benchmark de comparación"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-200"
    >
      {BENCHMARK_PRESETS.map((b) => (
        <option key={b.ticker} value={b.ticker}>
          {b.label} ({b.ticker})
        </option>
      ))}
    </select>
  )
}
