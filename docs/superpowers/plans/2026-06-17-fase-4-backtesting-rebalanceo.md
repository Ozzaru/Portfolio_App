# Fase 4 — Backtesting Engine (Rebalanceo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backtesting portfolio-céntrico sobre la cartera real del usuario con la estrategia de Rebalanceo periódico, comparando rebalanceado vs buy & hold vs S&P 500, con métricas (Retorno Total, CAGR, Sharpe, Max Drawdown, exceso geométrico vs SPY) y gráfica de equity.

**Architecture:** Motor puro y testeable en `src/lib/backtest/` que opera en **espacio de capital** (factores de retorno, sin "acciones" sintéticas). Reutiliza `analytics/riskMetrics` (sharpe, maxDrawdown), `analytics/series` (tradingDates, priceAsOf), `portfolio/holdings` (computeHoldings) y `supabase/paginate` (fetchAllRows). Un Route Handler `POST /api/backtest` hace toda la IO (auth, carga de `price_cache`, auto-backfill) y delega al motor. Una página `'use client'` consume el API con recharts.

**Tech Stack:** Next.js 16 (App Router, route group `(app)`), TypeScript, Supabase (`@supabase/ssr`), zod, recharts, Vitest. Dev server: `npm run dev` (webpack).

**Spec:** [docs/superpowers/specs/2026-06-17-fase-4-backtesting-rebalanceo-design.md](../specs/2026-06-17-fase-4-backtesting-rebalanceo-design.md)

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/lib/backtest/types.ts` | Tipos: `BacktestConfig`, `StrategyLine`, `VsBenchmark`, `BacktestResult`, `EquityPoint`, `RebalanceFrequency`, `RunBacktestInput` |
| `src/lib/backtest/weights.ts` | `equalWeights` (1/N), `normalizeWeights`, `validateWeights` |
| `src/lib/backtest/schedule.ts` | `rebalanceDates` (mensual/trimestral sobre fechas operativas) |
| `src/lib/backtest/metrics.ts` | `dailyReturns`, `totalReturn`, `cagr`, `geometricExcess`, `lineMetrics` (REUSA riskMetrics) |
| `src/lib/backtest/rebalance.ts` | `simulateLine` (evolución de capital de una línea + turnover) |
| `src/lib/backtest/engine.ts` | `runBacktest` (orquestador puro: config + series → BacktestResult) |
| `src/lib/validation/schemas.ts` | (modificar) añadir `backtestConfigSchema` |
| `src/app/api/backtest/route.ts` | `POST`: auth, holdings, auto-backfill, carga price_cache, llama engine |
| `src/app/(app)/backtest/page.tsx` | (reemplazar placeholder) formulario + resultados |

Tareas 1–6 son motor puro con TDD. Tareas 7–8 son IO/UI (sin test unitario, igual que el resto de route handlers/páginas del proyecto: se verifican a mano). Tarea 9 cierra docs.

---

### Task 1: Tipos + módulo de pesos (`weights.ts`)

**Files:**
- Create: `src/lib/backtest/types.ts`
- Create: `src/lib/backtest/weights.ts`
- Test: `src/lib/backtest/weights.test.ts`

- [ ] **Step 1: Crear los tipos (scaffolding, sin test — solo declaraciones)**

`src/lib/backtest/types.ts`:
```typescript
// src/lib/backtest/types.ts
export type RebalanceFrequency = 'monthly' | 'quarterly'

export interface EquityPoint {
  date: string // YYYY-MM-DD
  value: number // valor del portafolio en $ ese día
}

export interface BacktestConfig {
  targetWeights: Record<string, number> // ticker -> peso (se normaliza)
  frequency: RebalanceFrequency
  from: string // YYYY-MM-DD
  to: string // YYYY-MM-DD
  initialCapital: number
  weightsFromCurrent?: boolean // true si el usuario usó "Mis pesos actuales" (banner de sesgo)
}

export interface StrategyLine {
  equityCurve: EquityPoint[]
  totalReturn: number
  cagr: number | null
  sharpe: number | null
  maxDrawdown: number | null
  turnoverTotal: number // turnover acumulado (one-way); 0 para buy & hold y benchmark
}

export interface VsBenchmark {
  geometric: number | null // (1+Rt_línea)/(1+Rt_bench) − 1
  cagrSpread: number | null // cagr_línea − cagr_bench
}

export interface BacktestResult {
  lines: {
    rebalanced: StrategyLine
    buyHold: StrategyLine
    benchmark: StrategyLine | null
  }
  vsBenchmark: VsBenchmark
  warnings: string[]
  benchmarkError: string | null
}
```

- [ ] **Step 2: Escribir el test que falla**

`src/lib/backtest/weights.test.ts`:
```typescript
// src/lib/backtest/weights.test.ts
import { describe, it, expect } from 'vitest'
import { equalWeights, normalizeWeights, validateWeights } from './weights'

describe('equalWeights', () => {
  it('reparte 1/N entre N tickers', () => {
    expect(equalWeights(['A', 'B', 'C', 'D'])).toEqual({ A: 0.25, B: 0.25, C: 0.25, D: 0.25 })
  })
  it('lista vacía → objeto vacío', () => {
    expect(equalWeights([])).toEqual({})
  })
})

describe('normalizeWeights', () => {
  it('normaliza a que sumen 1', () => {
    expect(normalizeWeights({ A: 60, B: 40 })).toEqual({ A: 0.6, B: 0.4 })
  })
  it('ya normalizado se mantiene', () => {
    const r = normalizeWeights({ A: 0.5, B: 0.5 })
    expect(r.A).toBeCloseTo(0.5)
    expect(r.B).toBeCloseTo(0.5)
  })
})

describe('validateWeights', () => {
  it('acepta pesos positivos', () => {
    expect(validateWeights({ A: 0.6, B: 0.4 })).toEqual({ ok: true })
  })
  it('rechaza peso negativo', () => {
    expect(validateWeights({ A: 1.2, B: -0.2 }).ok).toBe(false)
  })
  it('rechaza si todo es 0', () => {
    expect(validateWeights({ A: 0, B: 0 }).ok).toBe(false)
  })
  it('rechaza objeto vacío', () => {
    expect(validateWeights({}).ok).toBe(false)
  })
})
```

- [ ] **Step 3: Verificar que el test falla**

Run: `npx vitest run src/lib/backtest/weights.test.ts`
Expected: FAIL con `Cannot find module './weights'`.

- [ ] **Step 4: Implementación mínima**

`src/lib/backtest/weights.ts`:
```typescript
// src/lib/backtest/weights.ts
// Pesos objetivo del backtest. El default 1/N evita el sesgo de retrospectiva
// (ver Decisión 1b del spec); "Mis pesos actuales" se calcula en la UI.

export function equalWeights(tickers: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  if (tickers.length === 0) return out
  const w = 1 / tickers.length
  for (const t of tickers) out[t] = w
  return out
}

export function normalizeWeights(weights: Record<string, number>): Record<string, number> {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0)
  const out: Record<string, number> = {}
  for (const [t, w] of Object.entries(weights)) out[t] = sum > 0 ? w / sum : 0
  return out
}

export function validateWeights(weights: Record<string, number>): { ok: boolean; error?: string } {
  const entries = Object.entries(weights)
  if (entries.length === 0) return { ok: false, error: 'sin activos con peso' }
  if (entries.some(([, w]) => w < 0)) return { ok: false, error: 'los pesos no pueden ser negativos' }
  const sum = entries.reduce((a, [, w]) => a + w, 0)
  if (sum <= 0) return { ok: false, error: 'la suma de pesos debe ser > 0' }
  return { ok: true }
}
```

- [ ] **Step 5: Verificar que pasa**

Run: `npx vitest run src/lib/backtest/weights.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/backtest/types.ts src/lib/backtest/weights.ts src/lib/backtest/weights.test.ts
git commit -m "feat(backtest): tipos + módulo de pesos (1/N, normalización, validación)"
```

---

### Task 2: Fechas de rebalanceo (`schedule.ts`)

**Files:**
- Create: `src/lib/backtest/schedule.ts`
- Test: `src/lib/backtest/schedule.test.ts`

- [ ] **Step 1: Escribir el test que falla**

`src/lib/backtest/schedule.test.ts`:
```typescript
// src/lib/backtest/schedule.test.ts
import { describe, it, expect } from 'vitest'
import { rebalanceDates } from './schedule'

describe('rebalanceDates', () => {
  it('mensual: primer día operativo de cada mes nuevo, excluyendo t0', () => {
    const dates = ['2024-01-31', '2024-02-01', '2024-02-15', '2024-03-04', '2024-03-05']
    expect(rebalanceDates(dates, 'monthly')).toEqual(['2024-02-01', '2024-03-04'])
  })

  it('trimestral: solo los límites de mes a +3, +6, … desde t0', () => {
    const dates = [
      '2024-01-15', // t0 (mes 0)
      '2024-02-01', // +1
      '2024-03-01', // +2
      '2024-04-01', // +3  ✓
      '2024-05-01', // +4
      '2024-06-03', // +5
      '2024-07-01', // +6  ✓
    ]
    expect(rebalanceDates(dates, 'quarterly')).toEqual(['2024-04-01', '2024-07-01'])
  })

  it('período dentro de un solo mes → sin rebalanceos', () => {
    expect(rebalanceDates(['2024-01-03', '2024-01-10', '2024-01-31'], 'monthly')).toEqual([])
  })

  it('lista vacía → []', () => {
    expect(rebalanceDates([], 'monthly')).toEqual([])
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/lib/backtest/schedule.test.ts`
Expected: FAIL con `Cannot find module './schedule'`.

- [ ] **Step 3: Implementación mínima**

`src/lib/backtest/schedule.ts`:
```typescript
// src/lib/backtest/schedule.ts
import type { RebalanceFrequency } from './types'

// Fechas de rebalanceo = primer día operativo de cada mes nuevo posterior a t0
// (trimestral: solo los que caen a +3, +6, … meses de t0). En t0 solo hay
// asignación inicial, no cuenta como rebalanceo (ver Decisión 5 del spec).
export function rebalanceDates(tradingDates: string[], frequency: RebalanceFrequency): string[] {
  if (tradingDates.length === 0) return []
  const ym = (d: string) => d.slice(0, 7) // "YYYY-MM"
  const monthsSince = (d: string, t0: string) => {
    const [y, m] = d.slice(0, 7).split('-').map(Number)
    const [y0, m0] = t0.slice(0, 7).split('-').map(Number)
    return (y - y0) * 12 + (m - m0)
  }
  const t0 = tradingDates[0]
  const out: string[] = []
  let prevKey = ym(t0)
  for (let i = 1; i < tradingDates.length; i++) {
    const d = tradingDates[i]
    const key = ym(d)
    if (key !== prevKey) {
      prevKey = key
      if (frequency === 'monthly' || monthsSince(d, t0) % 3 === 0) out.push(d)
    }
  }
  return out
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/lib/backtest/schedule.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/backtest/schedule.ts src/lib/backtest/schedule.test.ts
git commit -m "feat(backtest): fechas de rebalanceo mensual/trimestral"
```

---

### Task 3: Métricas (`metrics.ts`)

**Files:**
- Create: `src/lib/backtest/metrics.ts`
- Test: `src/lib/backtest/metrics.test.ts`

- [ ] **Step 1: Escribir el test que falla**

`src/lib/backtest/metrics.test.ts`:
```typescript
// src/lib/backtest/metrics.test.ts
import { describe, it, expect } from 'vitest'
import { dailyReturns, totalReturn, cagr, geometricExcess, lineMetrics } from './metrics'

describe('dailyReturns', () => {
  it('retornos día a día', () => {
    const r = dailyReturns([100, 110, 99])
    expect(r[0]).toBeCloseTo(0.1)
    expect(r[1]).toBeCloseTo(-0.1)
  })
})

describe('totalReturn', () => {
  it('último / primero − 1', () => {
    expect(totalReturn([100, 150])).toBeCloseTo(0.5)
  })
  it('serie de un punto → 0', () => {
    expect(totalReturn([100])).toBe(0)
  })
})

describe('cagr', () => {
  it('un año (252 días) duplicando → 100%', () => {
    const eq = Array.from({ length: 252 }, (_, i) => (i === 0 ? 100 : i === 251 ? 200 : 150))
    expect(cagr(eq)).toBeCloseTo(1.0, 6)
  })
  it('menos de 2 puntos → null', () => {
    expect(cagr([100])).toBeNull()
  })
})

describe('geometricExcess', () => {
  it('(1+0.5)/(1+0.2) − 1 = 0.25', () => {
    expect(geometricExcess(0.5, 0.2)).toBeCloseTo(0.25)
  })
})

describe('lineMetrics', () => {
  it('totalReturn y maxDrawdown sobre la curva de equity', () => {
    const curve = [
      { date: '2024-01-01', value: 100 },
      { date: '2024-01-02', value: 120 },
      { date: '2024-01-03', value: 90 },
      { date: '2024-01-04', value: 130 },
    ]
    const m = lineMetrics(curve)
    expect(m.totalReturn).toBeCloseTo(0.3) // 130/100 − 1
    expect(m.maxDrawdown).toBeCloseTo(-0.25) // 90/120 − 1
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/lib/backtest/metrics.test.ts`
Expected: FAIL con `Cannot find module './metrics'`.

- [ ] **Step 3: Implementación mínima**

`src/lib/backtest/metrics.ts`:
```typescript
// src/lib/backtest/metrics.ts
import { sharpe, maxDrawdown } from '@/lib/analytics/riskMetrics'
import type { EquityPoint } from './types'

const TRADING_DAYS = 252

export function dailyReturns(equity: number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1]
    out.push(prev !== 0 ? equity[i] / prev - 1 : 0)
  }
  return out
}

export function totalReturn(equity: number[]): number {
  if (equity.length < 2 || equity[0] === 0) return 0
  return equity[equity.length - 1] / equity[0] - 1
}

// CAGR = (V_fin/V_ini)^(252/N) − 1, N = nº de días operativos (= equity.length).
// 252 días hábiles/año, consistente con las fechas operativas (Decisión 4/7 del spec).
export function cagr(equity: number[]): number | null {
  const n = equity.length
  if (n < 2 || equity[0] <= 0) return null
  return (equity[n - 1] / equity[0]) ** (TRADING_DAYS / n) - 1
}

// Exceso GEOMÉTRICO, no resta aritmética (Decisión 7 del spec).
export function geometricExcess(rLine: number, rBench: number): number {
  return (1 + rLine) / (1 + rBench) - 1
}

export function lineMetrics(equityCurve: EquityPoint[]): {
  totalReturn: number
  cagr: number | null
  sharpe: number | null
  maxDrawdown: number | null
} {
  const values = equityCurve.map((p) => p.value)
  return {
    totalReturn: totalReturn(values),
    cagr: cagr(values),
    sharpe: sharpe(dailyReturns(values)),
    maxDrawdown: maxDrawdown(values),
  }
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/lib/backtest/metrics.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/backtest/metrics.ts src/lib/backtest/metrics.test.ts
git commit -m "feat(backtest): métricas (totalReturn, CAGR, exceso geométrico) reusando riskMetrics"
```

---

### Task 4: Simulación de una línea por evolución de capital (`rebalance.ts`)

**Files:**
- Create: `src/lib/backtest/rebalance.ts`
- Test: `src/lib/backtest/rebalance.test.ts`

- [ ] **Step 1: Escribir el test que falla**

`src/lib/backtest/rebalance.test.ts`:
```typescript
// src/lib/backtest/rebalance.test.ts
import { describe, it, expect } from 'vitest'
import { simulateLine } from './rebalance'
import type { PriceSeriesByTicker } from '@/lib/analytics/types'

// A se duplica en d1 y vuelve a 100 en d2; B plano. Precio raw = ajustado en el test.
function series(): PriceSeriesByTicker {
  const mk = (vals: number[]) =>
    ['d0', 'd1', 'd2'].map((date, i) => ({ date, price: vals[i], adjPrice: vals[i] }))
  return new Map([
    ['A', mk([100, 200, 100])],
    ['B', mk([100, 100, 100])],
  ])
}
const DATES = ['d0', 'd1', 'd2']
const W = { A: 0.5, B: 0.5 }

describe('simulateLine', () => {
  it('buy & hold (sin rebalanceo) deriva y turnover = 0', () => {
    const { equityCurve, turnoverTotal } = simulateLine(DATES, series(), W, [], 1000)
    expect(equityCurve.map((p) => p.value)).toEqual([1000, 1500, 1000])
    expect(turnoverTotal).toBe(0)
  })

  it('rebalanceado en d1 fija las ganancias y acumula turnover', () => {
    const { equityCurve, turnoverTotal } = simulateLine(DATES, series(), W, ['d1'], 1000)
    // d1: V=1500, se resetea a 750/750 (A@200, B@100); d2: A=750*100/200=375, B=750 → 1125
    expect(equityCurve.map((p) => p.value)).toEqual([1000, 1500, 1125])
    expect(turnoverTotal).toBeCloseTo(1 / 6) // ½·(|0.5−0.667|+|0.5−0.333|)
  })

  it('un solo activo: turnover 0 aunque haya fecha de rebalanceo', () => {
    const { turnoverTotal } = simulateLine(DATES, series(), { A: 1 }, ['d1'], 1000)
    expect(turnoverTotal).toBeCloseTo(0)
  })

  it('lanza error nombrando el ticker sin precio en una fecha', () => {
    const incompleta: PriceSeriesByTicker = new Map([['A', [{ date: 'd1', price: 1, adjPrice: 1 }]]])
    expect(() => simulateLine(DATES, incompleta, { A: 1 }, [], 1000)).toThrow(/A/)
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/lib/backtest/rebalance.test.ts`
Expected: FAIL con `Cannot find module './rebalance'`.

- [ ] **Step 3: Implementación mínima**

`src/lib/backtest/rebalance.ts`:
```typescript
// src/lib/backtest/rebalance.ts
import { priceAsOf } from '@/lib/analytics/series'
import type { PriceSeriesByTicker } from '@/lib/analytics/types'
import type { EquityPoint } from './types'

// Cierre ajustado as-of fecha (forward-fill). Lanza si no hay precio ≤ fecha.
function adjAt(priceSeries: PriceSeriesByTicker, ticker: string, date: string): number {
  const p = priceAsOf(priceSeries.get(ticker) ?? [], date)
  if (!p) throw new Error(`sin precio para ${ticker} en ${date}`)
  return p.adjPrice
}

// Simula UNA línea en espacio de capital (sin "acciones"): cada activo evoluciona por
// el factor adj(t)/adj(ancla); en cada fecha de rebalanceo se reancla el capital total
// a los pesos objetivo. turnover_k = ½·Σ|w_i − w_i^pre|, acumulado (Decisión 3 del spec).
export function simulateLine(
  dates: string[],
  priceSeries: PriceSeriesByTicker,
  weights: Record<string, number>,
  rebalanceDates: string[],
  initialCapital: number,
): { equityCurve: EquityPoint[]; turnoverTotal: number } {
  const tickers = Object.keys(weights)
  const rebal = new Set(rebalanceDates)
  const anchorCap: Record<string, number> = {}
  const anchorPrice: Record<string, number> = {}
  for (const t of tickers) {
    anchorCap[t] = initialCapital * weights[t]
    anchorPrice[t] = adjAt(priceSeries, t, dates[0])
  }

  const equityCurve: EquityPoint[] = []
  let turnoverTotal = 0

  for (const d of dates) {
    const cap: Record<string, number> = {}
    let V = 0
    for (const t of tickers) {
      cap[t] = anchorCap[t] * (adjAt(priceSeries, t, d) / anchorPrice[t])
      V += cap[t]
    }
    if (d !== dates[0] && rebal.has(d)) {
      let tv = 0
      for (const t of tickers) {
        const preW = V > 0 ? cap[t] / V : 0
        tv += Math.abs(weights[t] - preW)
      }
      turnoverTotal += 0.5 * tv
      for (const t of tickers) {
        anchorCap[t] = V * weights[t]
        anchorPrice[t] = adjAt(priceSeries, t, d)
      }
    }
    equityCurve.push({ date: d, value: V })
  }
  return { equityCurve, turnoverTotal }
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/lib/backtest/rebalance.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/backtest/rebalance.ts src/lib/backtest/rebalance.test.ts
git commit -m "feat(backtest): simulación de línea por evolución de capital + turnover"
```

---

### Task 5: Orquestador puro (`engine.ts`)

**Files:**
- Create: `src/lib/backtest/engine.ts`
- Test: `src/lib/backtest/engine.test.ts`

- [ ] **Step 1: Escribir el test que falla**

`src/lib/backtest/engine.test.ts`:
```typescript
// src/lib/backtest/engine.test.ts
import { describe, it, expect } from 'vitest'
import { runBacktest } from './engine'
import type { PriceSeriesByTicker, PricePointAdj } from '@/lib/analytics/types'
import type { RunBacktestInput } from './types'

const mk = (dates: string[], vals: number[]): PricePointAdj[] =>
  dates.map((date, i) => ({ date, price: vals[i], adjPrice: vals[i] }))
const DATES = ['2024-01-02', '2024-01-03', '2024-01-04']

function baseInput(over: Partial<RunBacktestInput> = {}): RunBacktestInput {
  const priceSeries: PriceSeriesByTicker = new Map([
    ['A', mk(DATES, [100, 200, 100])],
    ['B', mk(DATES, [100, 100, 100])],
  ])
  return {
    config: { targetWeights: { A: 0.5, B: 0.5 }, frequency: 'monthly', from: '2024-01-01', to: '2024-01-31', initialCapital: 1000 },
    priceSeries,
    benchmarkSeries: mk(DATES, [100, 110, 120]),
    benchmarkTicker: 'SPY',
    stockEtfTickers: ['A', 'B'],
    cryptoTickers: [],
    ...over,
  }
}

describe('runBacktest', () => {
  it('produce las tres líneas con métricas', () => {
    const r = runBacktest(baseInput())
    expect(r.lines.buyHold.equityCurve.map((p) => p.value)).toEqual([1000, 1500, 1000])
    expect(r.lines.rebalanced.turnoverTotal).toBe(0) // sin rebalanceo dentro de un mes
    expect(r.lines.benchmark?.equityCurve.at(-1)?.value).toBeCloseTo(1200) // 1000 * 120/100
    expect(r.lines.benchmark?.totalReturn).toBeCloseTo(0.2)
  })

  it('un solo activo: rebalanceado == buy & hold', () => {
    const input = baseInput({ config: { targetWeights: { A: 1 }, frequency: 'monthly', from: '2024-01-01', to: '2024-01-31', initialCapital: 1000 } })
    const r = runBacktest(input)
    expect(r.lines.rebalanced.equityCurve).toEqual(r.lines.buyHold.equityCurve)
  })

  it('vsBenchmark usa exceso geométrico, no resta', () => {
    const r = runBacktest(baseInput())
    const rt = r.lines.rebalanced.totalReturn
    expect(r.vsBenchmark.geometric).toBeCloseTo((1 + rt) / (1 + 0.2) - 1)
  })

  it('benchmark ausente → benchmarkError y línea null', () => {
    const r = runBacktest(baseInput({ benchmarkSeries: null }))
    expect(r.lines.benchmark).toBeNull()
    expect(r.benchmarkError).toMatch(/SPY/)
    expect(r.vsBenchmark.geometric).toBeNull()
  })

  it('warning de sesgo si weightsFromCurrent', () => {
    const r = runBacktest(baseInput({ config: { ...baseInput().config, weightsFromCurrent: true } }))
    expect(r.warnings.some((w) => /retrospectiva/i.test(w))).toBe(true)
  })

  it('activo del portafolio sin precio al inicio → lanza nombrando el ticker', () => {
    const priceSeries: PriceSeriesByTicker = new Map([
      ['A', mk(DATES, [100, 200, 100])],
      ['B', [{ date: '2024-01-04', price: 100, adjPrice: 100 }]], // empieza tarde
    ])
    expect(() => runBacktest(baseInput({ priceSeries }))).toThrow(/B/)
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/lib/backtest/engine.test.ts`
Expected: FAIL con `Cannot find module './engine'`.

- [ ] **Step 3: Implementación mínima**

Primero añadir `RunBacktestInput` a `src/lib/backtest/types.ts` (al final del archivo):
```typescript
// añade al final de src/lib/backtest/types.ts
import type { PriceSeriesByTicker, PricePointAdj } from '@/lib/analytics/types'

export interface RunBacktestInput {
  config: BacktestConfig
  priceSeries: PriceSeriesByTicker // series de los activos de la cartera
  benchmarkSeries: PricePointAdj[] | null
  benchmarkTicker: string
  stockEtfTickers: string[]
  cryptoTickers: string[]
}
```

`src/lib/backtest/engine.ts`:
```typescript
// src/lib/backtest/engine.ts
import { tradingDates } from '@/lib/analytics/series'
import type { PriceSeriesByTicker } from '@/lib/analytics/types'
import { normalizeWeights } from './weights'
import { rebalanceDates } from './schedule'
import { simulateLine } from './rebalance'
import { lineMetrics, geometricExcess } from './metrics'
import type { BacktestResult, RunBacktestInput, StrategyLine } from './types'

const HINDSIGHT_WARNING =
  'Pesos = composición actual: sesgo de retrospectiva (el backtest sobrestima el rendimiento).'

function toLine(sim: { equityCurve: StrategyLine['equityCurve']; turnoverTotal: number }): StrategyLine {
  return { ...lineMetrics(sim.equityCurve), equityCurve: sim.equityCurve, turnoverTotal: sim.turnoverTotal }
}

export function runBacktest(input: RunBacktestInput): BacktestResult {
  const { config, priceSeries, benchmarkSeries, benchmarkTicker, stockEtfTickers, cryptoTickers } = input
  const weights = normalizeWeights(config.targetWeights)

  const dates = tradingDates(priceSeries, stockEtfTickers, cryptoTickers, config.from, config.to)
  if (dates.length < 2) throw new Error('el rango no tiene suficientes fechas operativas')

  const rebal = rebalanceDates(dates, config.frequency)
  const rebalanced = toLine(simulateLine(dates, priceSeries, weights, rebal, config.initialCapital))
  const buyHold = toLine(simulateLine(dates, priceSeries, weights, [], config.initialCapital))

  let benchmark: StrategyLine | null = null
  let benchmarkError: string | null = null
  if (benchmarkSeries && benchmarkSeries.length > 0) {
    try {
      const benchMap: PriceSeriesByTicker = new Map([[benchmarkTicker, benchmarkSeries]])
      benchmark = toLine(simulateLine(dates, benchMap, { [benchmarkTicker]: 1 }, [], config.initialCapital))
    } catch {
      benchmarkError = `benchmark ${benchmarkTicker} sin datos en el rango`
    }
  } else {
    benchmarkError = `benchmark ${benchmarkTicker} no disponible`
  }

  const warnings: string[] = []
  for (const t of cryptoTickers) {
    const first = priceSeries.get(t)?.[0]?.date
    if (first && first > config.from) warnings.push(`histórico de ${t} empieza en ${first} (recortado)`)
  }
  if (config.weightsFromCurrent) warnings.push(HINDSIGHT_WARNING)

  const vsBenchmark = benchmark
    ? {
        geometric: geometricExcess(rebalanced.totalReturn, benchmark.totalReturn),
        cagrSpread: rebalanced.cagr != null && benchmark.cagr != null ? rebalanced.cagr - benchmark.cagr : null,
      }
    : { geometric: null, cagrSpread: null }

  return { lines: { rebalanced, buyHold, benchmark }, vsBenchmark, warnings, benchmarkError }
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/lib/backtest/engine.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Suite completa + lint**

Run: `npx vitest run && npm run lint`
Expected: todos los tests PASS (los previos + los nuevos), lint sin salida.

- [ ] **Step 6: Commit**

```bash
git add src/lib/backtest/engine.ts src/lib/backtest/types.ts src/lib/backtest/engine.test.ts
git commit -m "feat(backtest): orquestador runBacktest (3 líneas, vsBenchmark geométrico, warnings)"
```

---

### Task 6: Schema de validación (`backtestConfigSchema`)

**Files:**
- Modify: `src/lib/validation/schemas.ts`
- Test: `src/lib/validation/schemas.test.ts` (añadir bloque)

- [ ] **Step 1: Escribir el test que falla**

Añade al final de `src/lib/validation/schemas.test.ts`:
```typescript
import { backtestConfigSchema } from '@/lib/validation/schemas'

describe('backtestConfigSchema', () => {
  const base = {
    targetWeights: { AAPL: 0.6, SPCX: 0.4 },
    frequency: 'monthly',
    from: '2021-06-17',
    to: '2026-06-17',
    initialCapital: 10000,
  }
  it('acepta una config válida y normaliza tickers a mayúsculas', () => {
    const r = backtestConfigSchema.parse({ ...base, targetWeights: { aapl: 0.6, spcx: 0.4 } })
    expect(r.targetWeights).toEqual({ AAPL: 0.6, SPCX: 0.4 })
    expect(r.weightsFromCurrent).toBe(false)
  })
  it('coacciona capital string (input de formulario)', () => {
    const r = backtestConfigSchema.parse({ ...base, initialCapital: '10000' })
    expect(r.initialCapital).toBe(10000)
  })
  it('rechaza frecuencia desconocida', () => {
    expect(backtestConfigSchema.safeParse({ ...base, frequency: 'weekly' }).success).toBe(false)
  })
  it('rechaza targetWeights vacío', () => {
    expect(backtestConfigSchema.safeParse({ ...base, targetWeights: {} }).success).toBe(false)
  })
  it('rechaza fecha mal formada', () => {
    expect(backtestConfigSchema.safeParse({ ...base, from: '06/2021' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/lib/validation/schemas.test.ts`
Expected: FAIL con `backtestConfigSchema is not exported` / undefined.

- [ ] **Step 3: Implementación mínima**

Añade al final de `src/lib/validation/schemas.ts` (el archivo ya tiene `import { z } from 'zod'` y `const DATE_RE = /^\d{4}-\d{2}-\d{2}$/`):
```typescript
export const backtestConfigSchema = z.object({
  targetWeights: z
    .record(z.string(), z.coerce.number())
    .refine((w) => Object.keys(w).length > 0, 'targetWeights no puede estar vacío')
    .transform((w) => {
      const out: Record<string, number> = {}
      for (const [t, v] of Object.entries(w)) out[t.trim().toUpperCase()] = v
      return out
    }),
  frequency: z.enum(['monthly', 'quarterly']),
  from: z.string().regex(DATE_RE, 'formato esperado YYYY-MM-DD'),
  to: z.string().regex(DATE_RE, 'formato esperado YYYY-MM-DD'),
  initialCapital: z.coerce.number().positive(),
  weightsFromCurrent: z.coerce.boolean().default(false),
})
export type BacktestConfigInput = z.infer<typeof backtestConfigSchema>
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/lib/validation/schemas.test.ts`
Expected: PASS (los previos + 5 nuevos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation/schemas.ts src/lib/validation/schemas.test.ts
git commit -m "feat(validation): backtestConfigSchema"
```

---

### Task 7: Route Handler `POST /api/backtest`

**Files:**
- Create: `src/app/api/backtest/route.ts`

Sin test unitario (igual que `analytics`/`prices` routes: IO con Supabase + red; se verifica a mano). Reutiliza el patrón de auto-backfill de `src/app/api/analytics/route.ts`.

- [ ] **Step 1: Implementar el route handler**

`src/app/api/backtest/route.ts`:
```typescript
// src/app/api/backtest/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { defaultFetcher } from '@/lib/market-data/http'
import { createYahooAdapter } from '@/lib/market-data/yahoo'
import { createCoinGeckoAdapter } from '@/lib/market-data/coingecko'
import { createAlphaVantageAdapter } from '@/lib/market-data/alpha-vantage'
import { backfillHistory, type AssetRef } from '@/lib/market-data/refresh'
import { computeHoldings, type Transaction } from '@/lib/portfolio/holdings'
import { backtestConfigSchema } from '@/lib/validation/schemas'
import { validateWeights } from '@/lib/backtest/weights'
import { runBacktest } from '@/lib/backtest/engine'
import type { PriceSeriesByTicker, PricePointAdj } from '@/lib/analytics/types'

const BENCHMARK_TICKER = 'SPY'

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 1. Parseo/validación del body.
  const parsed = backtestConfigSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'config inválida', detail: parsed.error.issues }, { status: 400 })
  const config = parsed.data
  const wv = validateWeights(config.targetWeights)
  if (!wv.ok) return NextResponse.json({ error: wv.error }, { status: 400 })

  // 2. Cartera real del usuario: tickers + tipo de activo.
  const { data: txRows, error: txErr } = await supabase
    .from('transactions')
    .select('asset_id, side, quantity, price, fees, executed_at, assets(ticker, asset_type)')
  if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 })

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const transactions: Transaction[] = (txRows ?? []).map((row: any) => ({
    assetId: row.asset_id,
    ticker: row.assets?.ticker ?? '',
    side: row.side,
    quantity: Number(row.quantity),
    price: Number(row.price),
    fees: Number(row.fees),
    executedAt: row.executed_at,
  }))
  const assetTypeByTicker = new Map<string, string>()
  for (const row of (txRows ?? []) as any[]) {
    if (row.assets?.ticker) assetTypeByTicker.set(row.assets.ticker, row.assets.asset_type)
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const holdings = computeHoldings(transactions)
  const portfolioTickers = holdings.map((h) => h.ticker)
  if (portfolioTickers.length === 0) return NextResponse.json({ error: 'tu cartera está vacía' }, { status: 400 })

  const unknown = Object.keys(config.targetWeights).filter((t) => !portfolioTickers.includes(t))
  if (unknown.length > 0) return NextResponse.json({ error: `tickers fuera de tu cartera: ${unknown.join(', ')}` }, { status: 400 })

  // 3. Garantizar histórico (activos de la cartera + SPY) desde `from`.
  const refs: AssetRef[] = [
    ...holdings.map((h) => ({ ticker: h.ticker, asset_type: (assetTypeByTicker.get(h.ticker) ?? 'stock') as AssetRef['asset_type'] })),
    { ticker: BENCHMARK_TICKER, asset_type: 'etf' },
  ]
  try {
    await ensureHistory(supabase, refs, config.from)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'no se pudo descargar histórico' }, { status: 502 })
  }

  // 4. Cargar price_cache (paginado) de los tickers + benchmark.
  const wanted = [...new Set([...portfolioTickers, BENCHMARK_TICKER])]
  type Row = { ticker: string; price: number; adj_price: number | null; price_date: string }
  let priceRows: Row[]
  try {
    priceRows = await fetchAllRows<Row>((from, to) =>
      supabase
        .from('price_cache')
        .select('ticker, price, adj_price, price_date')
        .in('ticker', wanted)
        .gte('price_date', config.from)
        .lte('price_date', config.to)
        .order('price_date', { ascending: true })
        .order('ticker', { ascending: true })
        .order('source', { ascending: true })
        .range(from, to),
    )
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'price_cache error' }, { status: 500 })
  }

  const byTicker = new Map<string, PricePointAdj[]>()
  for (const row of priceRows) {
    const arr = byTicker.get(row.ticker) ?? []
    const price = Number(row.price)
    arr.push({ date: row.price_date, price, adjPrice: row.adj_price != null ? Number(row.adj_price) : price })
    byTicker.set(row.ticker, arr)
  }
  const priceSeries: PriceSeriesByTicker = new Map()
  for (const t of portfolioTickers) priceSeries.set(t, byTicker.get(t) ?? [])
  const benchmarkSeries = byTicker.get(BENCHMARK_TICKER) ?? null

  const stockEtfTickers = portfolioTickers.filter((t) => assetTypeByTicker.get(t) !== 'crypto')
  const cryptoTickers = portfolioTickers.filter((t) => assetTypeByTicker.get(t) === 'crypto')

  // 5. Ejecutar el motor puro.
  try {
    const result = runBacktest({
      config,
      priceSeries,
      benchmarkSeries,
      benchmarkTicker: BENCHMARK_TICKER,
      stockEtfTickers,
      cryptoTickers,
    })
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'fallo en el backtest' }, { status: 400 })
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Descarga histórico solo de los tickers que no tienen datos hasta `from`.
async function ensureHistory(supabase: any, refs: AssetRef[], from: string) {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY
  const adapters = {
    yahoo: createYahooAdapter(defaultFetcher),
    coingecko: createCoinGeckoAdapter(defaultFetcher),
    alphaVantage: apiKey ? createAlphaVantageAdapter(defaultFetcher, apiKey) : undefined,
  }
  for (const ref of refs) {
    const { data, error } = await supabase
      .from('price_cache')
      .select('price_date')
      .eq('ticker', ref.ticker)
      .order('price_date', { ascending: true })
      .limit(1)
    if (error) throw new Error(error.message)
    const earliest: string | undefined = data?.[0]?.price_date
    if (earliest && earliest <= from) continue // ya hay datos que cubren el inicio

    const { rows, results } = await backfillHistory([ref], from, adapters)
    const failed = results.find((r) => !r.ok)
    if (rows.length === 0 && failed) throw new Error(`${ref.ticker}: ${failed.error ?? 'sin datos'}`)
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500).map((r) => ({
        ticker: r.ticker,
        price: r.price,
        adj_price: r.adjPrice,
        price_date: r.date,
        source: r.source,
      }))
      const { error: upErr } = await supabase.from('price_cache').upsert(batch, { onConflict: 'ticker,price_date,source' })
      if (upErr) throw new Error(upErr.message)
    }
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
```

- [ ] **Step 2: Build (typecheck del route)**

Run: `npm run build`
Expected: build OK, `ƒ /api/backtest` aparece en la lista de rutas. Si hay error de tipos, corregir antes de seguir.

- [ ] **Step 3: Verificación manual (auth gate)**

Run (con el dev server arriba en otra terminal `npm run dev`):
`curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/backtest`
Expected: `401` (sin sesión).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/backtest/route.ts
git commit -m "feat(api): POST /api/backtest — holdings, auto-backfill, motor de rebalanceo"
```

---

### Task 8: Página `/backtest`

**Files:**
- Modify (reemplazar placeholder): `src/app/(app)/backtest/page.tsx`

Sin test unitario (página `'use client'`; se verifica a mano en el navegador). Sigue el patrón de `src/app/(app)/data-sources/page.tsx` y `analytics/page.tsx`.

- [ ] **Step 1: Implementar la página**

Reemplaza todo `src/app/(app)/backtest/page.tsx` por:
```tsx
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

  const loadPositions = useCallback(async () => {
    const res = await fetch('/api/positions')
    if (!res.ok) return
    const data: { positions: Position[] } = await res.json()
    const ps = data.positions ?? []
    const ts = ps.map((p) => p.ticker)
    setTickers(ts)
    const total = ps.reduce((a, p) => a + (p.marketValue ?? 0), 0)
    const cur: Record<string, number> = {}
    for (const p of ps) cur[p.ticker] = total > 0 ? (p.marketValue ?? 0) / total : 0
    setCurrentWeights(cur)
    setWeights(equalWeights(ts)) // default 1/N (evita sesgo de retrospectiva)
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
            Capital inicial
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
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build OK, `/backtest` aparece como ruta estática `○`.

- [ ] **Step 3: Verificación manual en navegador**

Con `npm run dev`: iniciar sesión → ir a `/backtest`. Verificar:
1. La tabla de pesos se prellena **1/N** (no pesos actuales).
2. "Mis pesos actuales" cambia los pesos y muestra el **banner ámbar de sesgo**.
3. "Ejecutar" devuelve resultados: tabla con 3 líneas (Retorno, CAGR, Sharpe, Drawdown, Turnover), línea "vs S&P 500" (exceso geométrico), nota de costos, y gráfica de 3 series.
4. DevTools → Network: `POST /api/backtest` responde **200**.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/backtest/page.tsx"
git commit -m "feat(ui): página /backtest — rebalanceo, 1/N vs pesos actuales, resultados + gráfica"
```

---

### Task 9: Cierre — docs y roadmap

**Files:**
- Modify: `README.md` (sección Backtesting)
- Modify: `docs/superpowers/plans/ROADMAP.md` (estado Fase 4)

- [ ] **Step 1: Actualizar el ROADMAP**

En `docs/superpowers/plans/ROADMAP.md`, cambiar la fila de la Fase 4: estado **Implementada (MVP)** y alcance acotado a *"Backtesting portfolio-céntrico: Rebalanceo periódico sobre la cartera real (rebalanceado vs buy&hold vs S&P 500), métricas (Retorno, CAGR, Sharpe, Max Drawdown) + gráfica. Momentum/SMA/DCA descartados/diferidos (ver spec)."* Añadir link al plan y al spec.

- [ ] **Step 2: Actualizar el README**

En `README.md`, en la sección "Backtesting Engine — estrategias", anotar que el MVP implementado es **Rebalanceo periódico portfolio-céntrico** y que las estrategias de señal-por-activo (SMA/RSI/ruptura/SL-TP) y DCA quedan fuera del MVP (fast-follow / diferidas), con referencia al spec `2026-06-17-fase-4-backtesting-rebalanceo-design.md`.

- [ ] **Step 3: Suite completa + lint + build (verificación final)**

Run: `npx vitest run && npm run lint && npm run build`
Expected: todos los tests PASS, lint sin salida, build OK con `/backtest` y `/api/backtest` en la lista de rutas.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/plans/ROADMAP.md
git commit -m "docs(roadmap): Fase 4 Backtesting (Rebalanceo) MVP implementada"
```

---

## Notas de implementación

- **Ejecución end-to-end real:** tras la Tarea 8, ejecutar un backtest sobre la cartera del usuario (AAPL/SPCX) con período 5 años y verificar que la línea rebalanceada, buy&hold y S&P 500 son coherentes. Esto requiere que el backfill de Fase 3 esté hecho (ya lo está).
- **Determinismo de paginación:** el SELECT de `price_cache` usa el mismo orden total `(price_date, ticker, source)` del fix de paginación de Fase 3.
- **Sin migraciones:** el MVP es ad-hoc; no se toca el esquema.
```
