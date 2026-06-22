# Fase 5 — Scenario Simulator (Stress Test) · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir un stress test de la cartera: un shock de mercado (S&P 500) propagado por beta vs benchmark + overrides por activo, con impacto total, desglose/ranking por activo, comparación vs S&P y gráfica de barras.

**Architecture:** Motor de dominio puro en `src/lib/scenarios/` (types, beta, stress, engine), reusando `analytics/series`, `analytics/riskMetrics`, `portfolio/holdings` y `supabase/paginate`. `POST /api/scenarios` (espejo de `/api/backtest`) + página cliente `/scenarios`. Sin persistencia ni migraciones.

**Tech Stack:** Next.js 16 (App Router, dev con `--webpack`), TypeScript, Zod, Vitest (TDD), recharts.

**Spec:** [docs/superpowers/specs/2026-06-22-fase-5-scenario-simulator-design.md](../specs/2026-06-22-fase-5-scenario-simulator-design.md)

---

## File structure

| Archivo | Responsabilidad |
|---|---|
| `src/lib/scenarios/types.ts` | Tipos del dominio (`ScenarioConfig`, `ScenarioHolding`, `AssetStress`, `StressResult`, `RunScenarioInput`, `AssetType`) |
| `src/lib/scenarios/beta.ts` | `alignedAdjReturns`, `computeBeta` (pura), `resolveBeta` (histórica o fallback por `asset_type`), constantes |
| `src/lib/scenarios/stress.ts` | `stressAsset`: aplica el shock a una posición valuada a precio crudo |
| `src/lib/scenarios/engine.ts` | `runScenario`: orquesta betas → stress → agregación bottom-up + ranking + warnings |
| `src/lib/validation/schemas.ts` | Añadir `scenarioConfigSchema` (Zod) |
| `src/app/api/scenarios/route.ts` | `POST`: auth, holdings, precios actuales + histórico, corre el motor |
| `src/app/(app)/scenarios/page.tsx` | Reemplaza el placeholder: inputs + resultados + gráfica |

Tests: `beta.test.ts`, `stress.test.ts`, `engine.test.ts` junto a cada módulo; `scenarioConfigSchema` se añade a `schemas.test.ts`. Ruta y página se validan con lint + build + e2e (igual que la Fase 4).

---

## Task 1: Tipos del dominio

**Files:**
- Create: `src/lib/scenarios/types.ts`

Solo declaraciones de tipos — no hay test (sin comportamiento).

- [ ] **Step 1: Crear `src/lib/scenarios/types.ts`**

```typescript
// src/lib/scenarios/types.ts
import type { PricePointAdj, PriceSeriesByTicker } from '@/lib/analytics/types'

// Refleja el enum real del esquema (0001_init.sql).
export type AssetType = 'stock' | 'etf' | 'crypto' | 'cash' | 'other'

export interface ScenarioConfig {
  marketShock: number // fracción con signo, ej. -0.20 = -20%
  overrides: Record<string, number> // ticker -> shock en fracción
}

export interface ScenarioHolding {
  ticker: string
  assetType: AssetType
  quantity: number
  currentPrice: number | null // precio crudo actual; null si falta
}

export interface AssetStress {
  ticker: string
  beta: number
  betaFallback: boolean
  shockApplied: number // fracción aplicada (override o beta·marketShock)
  valueBefore: number
  valueAfter: number
  lossContribAbs: number // valueAfter - valueBefore (negativo = pérdida)
}

export interface StressResult {
  portfolio: {
    valueBefore: number
    valueAfter: number
    pnlAbs: number
    pnlPct: number // bottom-up: Σ after / Σ before − 1
    aggregateBeta: number // descriptiva: Σ wᵢ·βᵢ (peso por valor crudo)
  }
  vsBenchmark: {
    marketShock: number // el S&P cae exactamente esto
    portfolioPct: number // = portfolio.pnlPct
  }
  perAsset: AssetStress[] // ordenado por lossContribAbs asc (peor primero)
  warnings: string[]
}

export interface RunScenarioInput {
  config: ScenarioConfig
  holdings: ScenarioHolding[]
  priceSeries: PriceSeriesByTicker // histórico de la cartera (para betas)
  benchmarkSeries: PricePointAdj[] | null
  benchmarkTicker: string
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/scenarios/types.ts
git commit -m "feat(scenarios): tipos del dominio del stress test"
```

---

## Task 2: Módulo de beta

**Files:**
- Create: `src/lib/scenarios/beta.ts`
- Test: `src/lib/scenarios/beta.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```typescript
// src/lib/scenarios/beta.test.ts
import { describe, it, expect } from 'vitest'
import { alignedAdjReturns, computeBeta, resolveBeta, FALLBACK_BETA_BY_TYPE } from './beta'
import type { PricePointAdj } from '@/lib/analytics/types'

const mk = (rows: [string, number][]): PricePointAdj[] =>
  rows.map(([date, v]) => ({ date, price: v, adjPrice: v }))

describe('alignedAdjReturns', () => {
  it('calcula retornos ajustados sobre fechas comunes consecutivas', () => {
    const a = mk([['2026-06-10', 100], ['2026-06-11', 110], ['2026-06-12', 121]])
    const b = mk([['2026-06-11', 200], ['2026-06-12', 210]]) // solo 06-11 y 06-12 son comunes
    const { rA, rB } = alignedAdjReturns(a, b)
    expect(rA).toHaveLength(1)
    expect(rA[0]).toBeCloseTo(121 / 110 - 1)
    expect(rB[0]).toBeCloseTo(210 / 200 - 1)
  })
})

describe('computeBeta', () => {
  it('beta = 2 cuando el activo se mueve el doble que el benchmark', () => {
    const rB = [0.01, -0.02, 0.03, -0.01, 0.02]
    const rA = rB.map((x) => 2 * x)
    expect(computeBeta(rA, rB)).toBeCloseTo(2)
  })
  it('null con menos de 2 observaciones', () => {
    expect(computeBeta([0.01], [0.02])).toBeNull()
  })
  it('null si la varianza del benchmark es 0', () => {
    expect(computeBeta([0.01, 0.02], [0, 0])).toBeNull()
  })
})

describe('resolveBeta', () => {
  it('usa la beta histórica cuando hay suficientes observaciones', () => {
    const dates = Array.from({ length: 25 }, (_, i) => `2026-05-${String(i + 1).padStart(2, '0')}`)
    const vals: [string, number][] = dates.map((d, i) => [d, 100 + (i % 2)]) // 100,101,100,101…
    const series = mk(vals)
    const r = resolveBeta(series, series, 'crypto') // serie idéntica → beta 1
    expect(r.fallback).toBe(false)
    expect(r.beta).toBeCloseTo(1) // 1, no el 1.5 de fallback de crypto → probó la rama histórica
  })
  it('fallback por asset_type cuando el histórico es insuficiente', () => {
    const short = mk([['2026-06-15', 10], ['2026-06-16', 11]]) // 1 retorno < MIN_BETA_OBS
    expect(resolveBeta(short, short, 'crypto')).toEqual({ beta: 1.5, fallback: true })
    expect(resolveBeta(short, short, 'cash')).toEqual({ beta: 0, fallback: true })
    expect(resolveBeta(short, short, 'stock')).toEqual({ beta: 1, fallback: true })
  })
})

describe('FALLBACK_BETA_BY_TYPE', () => {
  it('cash 0, crypto 1.5, resto 1', () => {
    expect(FALLBACK_BETA_BY_TYPE.cash).toBe(0)
    expect(FALLBACK_BETA_BY_TYPE.crypto).toBe(1.5)
    expect(FALLBACK_BETA_BY_TYPE.etf).toBe(1)
  })
})
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `npx vitest run src/lib/scenarios/beta.test.ts`
Expected: FAIL — `beta.ts` no existe / exports indefinidos.

- [ ] **Step 3: Implementar `src/lib/scenarios/beta.ts`**

```typescript
// src/lib/scenarios/beta.ts
import type { PricePointAdj } from '@/lib/analytics/types'
import { mean } from '@/lib/analytics/riskMetrics'
import type { AssetType } from './types'

// Mínimo de observaciones diarias comunes para fiarse de la beta histórica.
export const MIN_BETA_OBS = 20

// Beta de fallback por tipo de activo (Decisión 3 del spec). cash no co-mueve con el
// mercado; crypto es alta beta sistémica (heurística tuneable); equity-ish = neutral.
export const FALLBACK_BETA_BY_TYPE: Record<AssetType, number> = {
  stock: 1.0,
  etf: 1.0,
  other: 1.0,
  crypto: 1.5,
  cash: 0.0,
}

// Retornos diarios de cierre AJUSTADO sobre las fechas comunes (consecutivas) de ambas series.
export function alignedAdjReturns(
  a: PricePointAdj[],
  b: PricePointAdj[]
): { rA: number[]; rB: number[] } {
  const bByDate = new Map(b.map((p) => [p.date, p.adjPrice]))
  const common: { date: string; a: number; b: number }[] = []
  for (const p of a) {
    const bp = bByDate.get(p.date)
    if (bp !== undefined) common.push({ date: p.date, a: p.adjPrice, b: bp })
  }
  common.sort((x, y) => x.date.localeCompare(y.date))
  const rA: number[] = []
  const rB: number[] = []
  for (let i = 1; i < common.length; i++) {
    const pa = common[i - 1].a
    const pb = common[i - 1].b
    if (pa > 0 && pb > 0) {
      rA.push(common[i].a / pa - 1)
      rB.push(common[i].b / pb - 1)
    }
  }
  return { rA, rB }
}

// Beta = cov(rA,rB) / var(rB). La normalización 1/(n-1) se cancela, así que se usan sumas.
// null si hay < 2 observaciones o var(rB) = 0. Función pura sobre arrays alineados.
export function computeBeta(rA: number[], rB: number[]): number | null {
  const n = Math.min(rA.length, rB.length)
  if (n < 2) return null
  const ma = mean(rA.slice(0, n))
  const mb = mean(rB.slice(0, n))
  let cov = 0
  let varB = 0
  for (let i = 0; i < n; i++) {
    cov += (rA[i] - ma) * (rB[i] - mb)
    varB += (rB[i] - mb) ** 2
  }
  if (varB === 0) return null
  return cov / varB
}

// Beta efectiva del activo: histórica si hay >= MIN_BETA_OBS obs comunes y es finita;
// si no, fallback por asset_type (Decisión 3).
export function resolveBeta(
  assetSeries: PricePointAdj[],
  benchSeries: PricePointAdj[],
  assetType: AssetType
): { beta: number; fallback: boolean } {
  const { rA, rB } = alignedAdjReturns(assetSeries, benchSeries)
  if (rA.length >= MIN_BETA_OBS) {
    const b = computeBeta(rA, rB)
    if (b !== null && Number.isFinite(b)) return { beta: b, fallback: false }
  }
  return { beta: FALLBACK_BETA_BY_TYPE[assetType], fallback: true }
}
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `npx vitest run src/lib/scenarios/beta.test.ts`
Expected: PASS (todos verdes, sin warnings).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scenarios/beta.ts src/lib/scenarios/beta.test.ts
git commit -m "feat(scenarios): beta (cov/var ajustado) + fallback por asset_type"
```

---

## Task 3: Módulo de stress por activo

**Files:**
- Create: `src/lib/scenarios/stress.ts`
- Test: `src/lib/scenarios/stress.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```typescript
// src/lib/scenarios/stress.test.ts
import { describe, it, expect } from 'vitest'
import { stressAsset } from './stress'
import type { ScenarioHolding } from './types'

const h: ScenarioHolding = { ticker: 'AAPL', assetType: 'stock', quantity: 10, currentPrice: 100 }

describe('stressAsset', () => {
  it('aplica beta·marketShock a precio crudo', () => {
    const a = stressAsset(h, 1.2, false, { marketShock: -0.2, overrides: {} })
    expect(a?.valueBefore).toBe(1000)
    expect(a?.shockApplied).toBeCloseTo(-0.24) // 1.2 × -0.2
    expect(a?.valueAfter).toBeCloseTo(760)
    expect(a?.lossContribAbs).toBeCloseTo(-240)
    expect(a?.betaFallback).toBe(false)
  })

  it('el override tiene precedencia sobre la beta', () => {
    const a = stressAsset(h, 1.2, false, { marketShock: -0.2, overrides: { AAPL: -0.5 } })
    expect(a?.shockApplied).toBe(-0.5)
    expect(a?.valueAfter).toBeCloseTo(500)
  })

  it('sin precio actual → null (no valuable)', () => {
    const a = stressAsset({ ...h, currentPrice: null }, 1, false, { marketShock: -0.2, overrides: {} })
    expect(a).toBeNull()
  })
})
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `npx vitest run src/lib/scenarios/stress.test.ts`
Expected: FAIL — `stress.ts` no existe.

- [ ] **Step 3: Implementar `src/lib/scenarios/stress.ts`**

```typescript
// src/lib/scenarios/stress.ts
import type { AssetStress, ScenarioConfig, ScenarioHolding } from './types'

// Aplica el shock a una posición valuada a precio CRUDO (Decisión 6).
// shock = override ?? beta·marketShock. Devuelve null si no hay precio actual.
export function stressAsset(
  holding: ScenarioHolding,
  beta: number,
  betaFallback: boolean,
  config: ScenarioConfig
): AssetStress | null {
  if (holding.currentPrice === null) return null
  const valueBefore = holding.quantity * holding.currentPrice
  const override = config.overrides[holding.ticker]
  const shockApplied = override !== undefined ? override : beta * config.marketShock
  const valueAfter = valueBefore * (1 + shockApplied)
  return {
    ticker: holding.ticker,
    beta,
    betaFallback,
    shockApplied,
    valueBefore,
    valueAfter,
    lossContribAbs: valueAfter - valueBefore,
  }
}
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `npx vitest run src/lib/scenarios/stress.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scenarios/stress.ts src/lib/scenarios/stress.test.ts
git commit -m "feat(scenarios): stress por activo a precio crudo (override > beta)"
```

---

## Task 4: Motor (orquestador)

**Files:**
- Create: `src/lib/scenarios/engine.ts`
- Test: `src/lib/scenarios/engine.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```typescript
// src/lib/scenarios/engine.test.ts
import { describe, it, expect } from 'vitest'
import { runScenario } from './engine'
import type { PriceSeriesByTicker } from '@/lib/analytics/types'
import type { ScenarioHolding } from './types'

const holdings: ScenarioHolding[] = [
  { ticker: 'AAPL', assetType: 'stock', quantity: 10, currentPrice: 100 }, // 1000
  { ticker: 'SPCX', assetType: 'etf', quantity: 5, currentPrice: 200 }, // 1000
]

describe('runScenario', () => {
  it('P&L bottom-up cuadra con la suma de las partes (incluso con override)', () => {
    // Sin histórico → betas por fallback (stock 1.0, etf 1.0). marketShock -0.20, override AAPL -0.50.
    const r = runScenario({
      config: { marketShock: -0.2, overrides: { AAPL: -0.5 } },
      holdings,
      priceSeries: new Map() as PriceSeriesByTicker,
      benchmarkSeries: null,
      benchmarkTicker: 'SPY',
    })
    // AAPL 1000 → 500 (override). SPCX 1000 → 800 (beta 1 × -0.2). Total 2000 → 1300.
    expect(r.portfolio.valueBefore).toBe(2000)
    expect(r.portfolio.valueAfter).toBeCloseTo(1300)
    expect(r.portfolio.pnlPct).toBeCloseTo(-0.35) // bottom-up
    // aggregateBeta = 0.5·1 + 0.5·1 = 1 → si se usara betaAgregada×shock daría -0.20 (incorrecto)
    expect(r.portfolio.aggregateBeta).toBeCloseTo(1)
    expect(r.vsBenchmark.marketShock).toBe(-0.2)
  })

  it('ordena perAsset por contribución a la pérdida (peor primero)', () => {
    const r = runScenario({
      config: { marketShock: -0.2, overrides: { AAPL: -0.5 } },
      holdings,
      priceSeries: new Map() as PriceSeriesByTicker,
      benchmarkSeries: null,
      benchmarkTicker: 'SPY',
    })
    expect(r.perAsset[0].ticker).toBe('AAPL') // -500 peor que -200
    expect(r.perAsset[1].ticker).toBe('SPCX')
  })

  it('warning de benchmark ausente y de betas por fallback', () => {
    const r = runScenario({
      config: { marketShock: -0.2, overrides: {} },
      holdings,
      priceSeries: new Map() as PriceSeriesByTicker,
      benchmarkSeries: null,
      benchmarkTicker: 'SPY',
    })
    expect(r.warnings.some((w) => /SPY/.test(w))).toBe(true)
    expect(r.warnings.some((w) => /AAPL/.test(w))).toBe(true)
  })

  it('activo sin precio actual → excluido del total con warning', () => {
    const r = runScenario({
      config: { marketShock: -0.2, overrides: {} },
      holdings: [{ ticker: 'X', assetType: 'stock', quantity: 1, currentPrice: null }],
      priceSeries: new Map() as PriceSeriesByTicker,
      benchmarkSeries: null,
      benchmarkTicker: 'SPY',
    })
    expect(r.perAsset).toHaveLength(0)
    expect(r.warnings.some((w) => /X/.test(w))).toBe(true)
  })
})
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `npx vitest run src/lib/scenarios/engine.test.ts`
Expected: FAIL — `engine.ts` no existe.

- [ ] **Step 3: Implementar `src/lib/scenarios/engine.ts`**

```typescript
// src/lib/scenarios/engine.ts
import { resolveBeta } from './beta'
import { stressAsset } from './stress'
import type { AssetStress, RunScenarioInput, StressResult } from './types'

export function runScenario(input: RunScenarioInput): StressResult {
  const { config, holdings, priceSeries, benchmarkSeries, benchmarkTicker } = input
  const warnings: string[] = []
  const benchSeries = benchmarkSeries ?? []
  if (benchSeries.length === 0) {
    warnings.push(`benchmark ${benchmarkTicker} no disponible: betas por fallback`)
  }

  const perAsset: AssetStress[] = []
  for (const h of holdings) {
    if (h.currentPrice === null) {
      warnings.push(`${h.ticker} sin precio actual: excluido del escenario`)
      continue
    }
    const { beta, fallback } = resolveBeta(priceSeries.get(h.ticker) ?? [], benchSeries, h.assetType)
    if (fallback) {
      warnings.push(`beta de ${h.ticker} por fallback (${h.assetType}): histórico insuficiente`)
    }
    const a = stressAsset(h, beta, fallback, config)
    if (a) perAsset.push(a)
  }

  const valueBefore = perAsset.reduce((s, a) => s + a.valueBefore, 0)
  const valueAfter = perAsset.reduce((s, a) => s + a.valueAfter, 0)
  const pnlAbs = valueAfter - valueBefore
  const pnlPct = valueBefore > 0 ? valueAfter / valueBefore - 1 : 0
  // Descriptiva: peso por valor crudo. NUNCA se usa como base del P&L (Decisión 5).
  const aggregateBeta =
    valueBefore > 0 ? perAsset.reduce((s, a) => s + (a.valueBefore / valueBefore) * a.beta, 0) : 0

  perAsset.sort((x, y) => x.lossContribAbs - y.lossContribAbs) // más negativo (peor) primero

  return {
    portfolio: { valueBefore, valueAfter, pnlAbs, pnlPct, aggregateBeta },
    vsBenchmark: { marketShock: config.marketShock, portfolioPct: pnlPct },
    perAsset,
    warnings,
  }
}
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `npx vitest run src/lib/scenarios/engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scenarios/engine.ts src/lib/scenarios/engine.test.ts
git commit -m "feat(scenarios): motor runScenario (bottom-up, ranking, warnings)"
```

---

## Task 5: Schema de validación

**Files:**
- Modify: `src/lib/validation/schemas.ts` (añadir al final)
- Test: `src/lib/validation/schemas.test.ts` (añadir bloque)

- [ ] **Step 1: Añadir el test que falla a `schemas.test.ts`**

Añade al final del archivo (e importa `scenarioConfigSchema` en el import existente de `@/lib/validation/schemas`):

```typescript
describe('scenarioConfigSchema', () => {
  it('coacciona marketShock y normaliza overrides a mayúsculas', () => {
    const r = scenarioConfigSchema.parse({ marketShock: '-0.2', overrides: { aapl: '-0.5' } })
    expect(r.marketShock).toBe(-0.2)
    expect(r.overrides).toEqual({ AAPL: -0.5 })
  })
  it('overrides ausente → {} por defecto', () => {
    const r = scenarioConfigSchema.parse({ marketShock: -0.1 })
    expect(r.overrides).toEqual({})
  })
  it('rechaza marketShock no numérico', () => {
    expect(scenarioConfigSchema.safeParse({ marketShock: 'abc' }).success).toBe(false)
  })
})
```

Y actualiza el import del bloque superior para incluir `scenarioConfigSchema`:

```typescript
import {
  assetInputSchema,
  transactionInputSchema,
  priceInputSchema,
  backtestConfigSchema,
  scenarioConfigSchema,
} from '@/lib/validation/schemas'
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `npx vitest run src/lib/validation/schemas.test.ts`
Expected: FAIL — `scenarioConfigSchema` no existe.

- [ ] **Step 3: Añadir el schema a `schemas.ts`**

Añade al final de `src/lib/validation/schemas.ts`:

```typescript
export const scenarioConfigSchema = z.object({
  marketShock: z.coerce.number(),
  overrides: z
    .record(z.string(), z.coerce.number())
    .default({})
    .transform((o) => {
      const out: Record<string, number> = {}
      for (const [t, v] of Object.entries(o)) out[t.trim().toUpperCase()] = v
      return out
    }),
})
export type ScenarioConfigInput = z.infer<typeof scenarioConfigSchema>
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `npx vitest run src/lib/validation/schemas.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation/schemas.ts src/lib/validation/schemas.test.ts
git commit -m "feat(validation): scenarioConfigSchema"
```

---

## Task 6: Route handler `POST /api/scenarios`

**Files:**
- Create: `src/app/api/scenarios/route.ts`

No lleva test unitario (integración con Supabase) — se valida con lint + build aquí y e2e en la Task 8, igual que `/api/backtest`.

- [ ] **Step 1: Crear `src/app/api/scenarios/route.ts`**

```typescript
// src/app/api/scenarios/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { computeHoldings, type Transaction } from '@/lib/portfolio/holdings'
import { scenarioConfigSchema } from '@/lib/validation/schemas'
import { runScenario } from '@/lib/scenarios/engine'
import type { AssetType, ScenarioHolding } from '@/lib/scenarios/types'
import type { PriceSeriesByTicker, PricePointAdj } from '@/lib/analytics/types'

const BENCHMARK_TICKER = 'SPY'

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = scenarioConfigSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'config inválida', detail: parsed.error.issues }, { status: 400 })
  const config = parsed.data

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
  const assetTypeByTicker = new Map<string, AssetType>()
  for (const row of (txRows ?? []) as any[]) {
    if (row.assets?.ticker) assetTypeByTicker.set(row.assets.ticker, (row.assets.asset_type ?? 'other') as AssetType)
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const holdings = computeHoldings(transactions)
  const portfolioTickers = holdings.map((h) => h.ticker)
  if (portfolioTickers.length === 0) return NextResponse.json({ error: 'tu cartera está vacía' }, { status: 400 })

  const unknown = Object.keys(config.overrides).filter((t) => !portfolioTickers.includes(t))
  if (unknown.length > 0) return NextResponse.json({ error: `overrides fuera de tu cartera: ${unknown.join(', ')}` }, { status: 400 })

  // Histórico (lookback ~2 años) de la cartera + SPY para las betas; paginado (gotcha Fases 3-4).
  const lookbackFrom = (() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() - 2)
    return d.toISOString().slice(0, 10)
  })()
  const wanted = [...new Set([...portfolioTickers, BENCHMARK_TICKER])]
  type Row = { ticker: string; price: number; adj_price: number | null; price_date: string }
  let priceRows: Row[]
  try {
    priceRows = await fetchAllRows<Row>((from, to) =>
      supabase
        .from('price_cache')
        .select('ticker, price, adj_price, price_date')
        .in('ticker', wanted)
        .gte('price_date', lookbackFrom)
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

  // Precio crudo ACTUAL = último de la serie (el lookback incluye lo reciente).
  const scenarioHoldings: ScenarioHolding[] = holdings.map((h) => {
    const series = byTicker.get(h.ticker) ?? []
    const currentPrice = series.length ? series[series.length - 1].price : null
    return {
      ticker: h.ticker,
      assetType: assetTypeByTicker.get(h.ticker) ?? 'other',
      quantity: h.quantity,
      currentPrice,
    }
  })

  try {
    const result = runScenario({
      config,
      holdings: scenarioHoldings,
      priceSeries,
      benchmarkSeries,
      benchmarkTicker: BENCHMARK_TICKER,
    })
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'fallo en el escenario' }, { status: 400 })
  }
}
```

- [ ] **Step 2: Lint + build**

Run: `npx eslint && npx next build`
Expected: lint exit 0; build compila incluyendo `ƒ /api/scenarios`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/scenarios/route.ts
git commit -m "feat(api): POST /api/scenarios — holdings, betas (lookback 2a), motor"
```

---

## Task 7: Página `/scenarios`

**Files:**
- Modify (reemplazo total): `src/app/(app)/scenarios/page.tsx`

Validación con lint + build aquí y e2e en la Task 8 (igual que la página de backtest). El link del sidebar a `/scenarios` ya existe.

- [ ] **Step 1: Reemplazar `src/app/(app)/scenarios/page.tsx`**

```tsx
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

interface Position {
  ticker: string
}

const inputCls = 'rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200'
const btnCls =
  'rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50'
const ghostBtn = 'rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800'

const pct = (x: number | null) => (x == null ? '—' : `${(x * 100).toFixed(2)}%`)
const money = (x: number | null) =>
  x == null ? '—' : x.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

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
```

- [ ] **Step 2: Lint + build**

Run: `npx eslint && npx next build`
Expected: lint exit 0; build compila `○ /scenarios` sin errores.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/scenarios/page.tsx"
git commit -m "feat(ui): página /scenarios — shock+overrides, resultados, barras"
```

---

## Task 8: Verificación final y docs

**Files:**
- Modify: `docs/superpowers/plans/ROADMAP.md` (Fase 5 → Implementada)
- Modify: `README.md` (sección Scenario Simulator)

- [ ] **Step 1: Suite completa + lint + build**

Run: `npx vitest run && npx eslint && npx next build`
Expected: todos los tests verdes (incluye los ~14 nuevos de scenarios + schema), lint exit 0, build OK.

- [ ] **Step 2: Verificación e2e en navegador (requiere login del usuario)**

Arrancar `npm run dev` (webpack). En `/scenarios`:
1. Cargar con la cartera real → aparecen los tickers con inputs de override en blanco.
2. Shock −20% (preset) → Ejecutar → ver: tarjetas de impacto, "cartera vs S&P estresado", tabla ordenada por pérdida, gráfica de barras (Antes/Después), nota de riesgo de cola.
3. Confirmar warning de beta por fallback en SPCX (IPO reciente, histórico < 20 días) marcado con `*`.
4. Probar un override (ej. AAPL −50%) → el total cuadra bottom-up.

- [ ] **Step 3: Actualizar ROADMAP y README**

En `docs/superpowers/plans/ROADMAP.md`, fila de la Fase 5: cambiar estado a **Implementada (MVP)** y enlazar spec + plan. En `README.md`, la tabla de capacidades y/o una sección breve: Scenario Simulator = stress test por shocks (beta + overrides), fallback por `asset_type`, vs S&P, gráfica de barras; what-if / rebalanceo simulado / replay = fast-follow.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/ROADMAP.md README.md
git commit -m "docs(roadmap): Fase 5 Scenario Simulator (Stress Test) MVP implementada"
```

---

## Notas de implementación

- **Dev server con webpack:** `npm run dev` ya fija `--webpack` (Turbopack rompe `src/proxy.ts` en Next 16). No usar `next dev` pelado.
- **Sin auto-backfill en el MVP:** si falta histórico de un ticker/SPY, la beta cae a fallback por `asset_type` + warning (degradación con gracia). Disparar backfill desde la ruta queda como fast-follow.
- **`react-hooks/set-state-in-effect`:** dentro de funciones llamadas desde `useEffect` usar `res.json().then(setState)` (como en `loadPositions`), no `setState(await ...)`. En handlers de evento (`run`) el `await` es válido.
- **Paginación:** todo `select` sobre `price_cache` usa `fetchAllRows` (tope de 1000 filas de Supabase).
