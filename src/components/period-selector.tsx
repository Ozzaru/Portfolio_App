// src/components/period-selector.tsx
'use client'

import type { Period } from '@/lib/analytics/types'

const OPTIONS: { value: Period; label: string }[] = [
  { value: '1W', label: '1S' },
  { value: '1M', label: '1M' },
  { value: '3M', label: '3M' },
  { value: '1Y', label: '1A' },
  { value: 'ALL', label: 'Todo' },
]

export function PeriodSelector({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-800 bg-slate-900 p-1">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded px-3 py-1 text-sm font-medium transition ${
            value === o.value ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
