// src/lib/hooks/use-prefs.ts
'use client'

import { useCallback, useSyncExternalStore } from 'react'
import type { Period } from '@/lib/analytics/types'

const PERIOD_KEY = 'pa.period'
const BENCHMARK_KEY = 'pa.benchmark'

// Suscripción a localStorage: el evento `storage` sincroniza entre pestañas; el
// evento custom `pa:prefs` sincroniza en la MISMA pestaña (storage no se dispara
// para el propio tab que escribe).
function subscribe(callback: () => void): () => void {
  window.addEventListener('storage', callback)
  window.addEventListener('pa:prefs', callback)
  return () => {
    window.removeEventListener('storage', callback)
    window.removeEventListener('pa:prefs', callback)
  }
}

function usePref(key: string, fallback: string): [string, (v: string) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => window.localStorage.getItem(key) ?? fallback, // snapshot en cliente
    () => fallback // snapshot en servidor (SSR)
  )
  const update = useCallback(
    (v: string) => {
      window.localStorage.setItem(key, v)
      window.dispatchEvent(new Event('pa:prefs'))
    },
    [key]
  )
  return [value, update]
}

export function usePeriod(): [Period, (p: Period) => void] {
  const [value, set] = usePref(PERIOD_KEY, '1Y')
  return [value as Period, set as (p: Period) => void]
}

export function useBenchmark(): [string, (b: string) => void] {
  return usePref(BENCHMARK_KEY, 'SPY')
}
