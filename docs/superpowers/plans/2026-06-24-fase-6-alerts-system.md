# Fase 6 — Alerts System · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alertas in-app de precio (`price_above`, `price_below`, `pct_change`) que se evalúan leyendo solo `price_cache`, con CRUD en `/alerts`, auto-evaluación al refrescar precios y un badge de disparadas en el shell.

**Architecture:** Motor puro en `src/lib/alerts/` (types, evaluate, prices) reusando `supabase/paginate`. Integración `evaluateAndPersist` en `run.ts`. Rutas `/api/alerts*`, hook no bloqueante en `/api/prices/refresh`, página `/alerts` y badge en el sidebar. Reusa la tabla `alerts` existente — **sin migraciones**.

**Tech Stack:** Next.js 16 (App Router, dev `--webpack`), TypeScript, Zod, Vitest (TDD), Supabase.

**Spec:** [docs/superpowers/specs/2026-06-24-fase-6-alerts-system-design.md](../specs/2026-06-24-fase-6-alerts-system-design.md)

---

## File structure

| Archivo | Responsabilidad |
|---|---|
| `src/lib/alerts/types.ts` | `AlertType`, `AlertRow`, `AlertTrigger` |
| `src/lib/alerts/evaluate.ts` | `evaluateAlerts(alerts, current, prevClose)` — puro, decide qué dispara |
| `src/lib/alerts/prices.ts` | `deriveCurrentAndPrevClose(rows)` — puro, spot + cierre del día previo (Decisión 4) |
| `src/lib/alerts/run.ts` | `evaluateAndPersist(supabase)` — carga, evalúa y persiste (lock optimista) |
| `src/lib/validation/schemas.ts` | añadir `alertInputSchema` |
| `src/app/api/alerts/route.ts` | `GET` (listar) + `POST` (crear) |
| `src/app/api/alerts/[id]/route.ts` | `PATCH` (estado) + `DELETE` |
| `src/app/api/alerts/evaluate/route.ts` | `POST` (evaluar ahora) |
| `src/app/api/prices/refresh/route.ts` | hook no bloqueante a `evaluateAndPersist` |
| `src/app/(app)/alerts/page.tsx` | UI: crear, listar, acciones, "Revisar ahora", aviso al reactivar |
| `src/components/sidebar.tsx` | badge con nº de alertas `triggered` |

Tests: `evaluate.test.ts`, `prices.test.ts`, y `alertInputSchema` en `schemas.test.ts`. Rutas/página/sidebar se validan con lint + build + e2e.

---

## Task 1: Tipos del dominio

**Files:**
- Create: `src/lib/alerts/types.ts`

Solo declaraciones — sin test.

- [ ] **Step 1: Crear `src/lib/alerts/types.ts`**

```typescript
// src/lib/alerts/types.ts
export type AlertType = 'price_above' | 'price_below' | 'pct_change'

export interface AlertRow {
  id: string
  ticker: string
  alertType: AlertType
  threshold: number
  status: 'active' | 'triggered' | 'disabled'
}

export interface AlertTrigger {
  id: string
  reason: string
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/alerts/types.ts
git commit -m "$(cat <<'EOF'
feat(alerts): tipos del dominio

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Motor de evaluación (puro)

**Files:**
- Create: `src/lib/alerts/evaluate.ts`
- Test: `src/lib/alerts/evaluate.test.ts`

- [ ] **Step 1: Escribir el test que falla — `src/lib/alerts/evaluate.test.ts`**

```typescript
// src/lib/alerts/evaluate.test.ts
import { describe, it, expect } from 'vitest'
import { evaluateAlerts } from './evaluate'
import type { AlertRow } from './types'

const m = (entries: [string, number][]) => new Map(entries)

describe('evaluateAlerts', () => {
  it('price_above dispara solo si spot > threshold (estricto)', () => {
    const alerts: AlertRow[] = [{ id: 'a', ticker: 'AAPL', alertType: 'price_above', threshold: 150, status: 'active' }]
    expect(evaluateAlerts(alerts, m([['AAPL', 151]]), new Map())).toHaveLength(1)
    expect(evaluateAlerts(alerts, m([['AAPL', 150]]), new Map())).toHaveLength(0) // borde exacto: no dispara
    expect(evaluateAlerts(alerts, m([['AAPL', 149]]), new Map())).toHaveLength(0)
  })

  it('price_below dispara solo si spot < threshold (estricto)', () => {
    const alerts: AlertRow[] = [{ id: 'a', ticker: 'AAPL', alertType: 'price_below', threshold: 150, status: 'active' }]
    expect(evaluateAlerts(alerts, m([['AAPL', 149]]), new Map())).toHaveLength(1)
    expect(evaluateAlerts(alerts, m([['AAPL', 150]]), new Map())).toHaveLength(0)
  })

  it('pct_change dispara con |Δ%| ≥ threshold en ambos sentidos', () => {
    const alerts: AlertRow[] = [{ id: 'a', ticker: 'X', alertType: 'pct_change', threshold: 5, status: 'active' }]
    expect(evaluateAlerts(alerts, m([['X', 106]]), m([['X', 100]]))).toHaveLength(1) // +6%
    expect(evaluateAlerts(alerts, m([['X', 94]]), m([['X', 100]]))).toHaveLength(1) // -6%
    expect(evaluateAlerts(alerts, m([['X', 105]]), m([['X', 100]]))).toHaveLength(1) // exacto 5% → dispara (≥)
    expect(evaluateAlerts(alerts, m([['X', 103]]), m([['X', 100]]))).toHaveLength(0) // +3%
  })

  it('pct_change se omite si falta prevClose o es 0 (sin NaN ni división por cero)', () => {
    const alerts: AlertRow[] = [{ id: 'a', ticker: 'X', alertType: 'pct_change', threshold: 5, status: 'active' }]
    expect(evaluateAlerts(alerts, m([['X', 100]]), new Map())).toHaveLength(0) // sin prev
    expect(evaluateAlerts(alerts, m([['X', 100]]), m([['X', 0]]))).toHaveLength(0) // prev 0
  })

  it('omite alertas cuyo ticker no tiene spot', () => {
    const alerts: AlertRow[] = [{ id: 'a', ticker: 'AAPL', alertType: 'price_above', threshold: 150, status: 'active' }]
    expect(evaluateAlerts(alerts, new Map(), new Map())).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run para verlo fallar**

Run: `npm test -- src/lib/alerts/evaluate.test.ts`
Expected: FAIL — `evaluate.ts` no existe.

- [ ] **Step 3: Implementar `src/lib/alerts/evaluate.ts`**

```typescript
// src/lib/alerts/evaluate.ts
import type { AlertRow, AlertTrigger } from './types'

// Decide qué alertas (ya filtradas a `active` por el caller) deben pasar a `triggered`.
// Función pura sobre dos mapas estáticos ticker -> precio. Desigualdad ESTRICTA en
// above/below (spot == threshold NO dispara); pct_change usa ≥. Omite (no dispara) si
// falta el spot, o si para pct_change falta/es 0 el cierre anterior (sin NaN ni div/0).
export function evaluateAlerts(
  alerts: AlertRow[],
  currentPrices: Map<string, number>,
  previousClosePrices: Map<string, number>
): AlertTrigger[] {
  const triggers: AlertTrigger[] = []
  for (const a of alerts) {
    const spot = currentPrices.get(a.ticker)
    if (spot === undefined || !Number.isFinite(spot)) continue

    if (a.alertType === 'price_above') {
      if (spot > a.threshold) triggers.push({ id: a.id, reason: `${a.ticker} ${spot} > ${a.threshold}` })
    } else if (a.alertType === 'price_below') {
      if (spot < a.threshold) triggers.push({ id: a.id, reason: `${a.ticker} ${spot} < ${a.threshold}` })
    } else {
      // pct_change
      const prev = previousClosePrices.get(a.ticker)
      if (prev === undefined || !Number.isFinite(prev) || prev === 0) continue
      const movePct = Math.abs(spot / prev - 1) * 100
      if (movePct >= a.threshold) {
        triggers.push({ id: a.id, reason: `${a.ticker} movió ${movePct.toFixed(2)}% ≥ ${a.threshold}%` })
      }
    }
  }
  return triggers
}
```

- [ ] **Step 4: Run para verlo pasar**

Run: `npm test -- src/lib/alerts/evaluate.test.ts`
Expected: PASS (5 verdes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/alerts/evaluate.ts src/lib/alerts/evaluate.test.ts
git commit -m "$(cat <<'EOF'
feat(alerts): motor evaluateAlerts (estricto, pct_change ±, guard NaN)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Derivación spot / cierre anterior (puro, Decisión 4)

**Files:**
- Create: `src/lib/alerts/prices.ts`
- Test: `src/lib/alerts/prices.test.ts`

- [ ] **Step 1: Escribir el test que falla — `src/lib/alerts/prices.test.ts`**

```typescript
// src/lib/alerts/prices.test.ts
import { describe, it, expect } from 'vitest'
import { deriveCurrentAndPrevClose, type PriceRow } from './prices'

describe('deriveCurrentAndPrevClose', () => {
  it('current = fecha máxima; prevClose = fecha previa distinta', () => {
    const rows: PriceRow[] = [
      { ticker: 'AAPL', price: 100, price_date: '2026-06-16' },
      { ticker: 'AAPL', price: 98, price_date: '2026-06-15' },
      { ticker: 'AAPL', price: 95, price_date: '2026-06-12' },
    ]
    const { current, prevClose } = deriveCurrentAndPrevClose(rows)
    expect(current.get('AAPL')).toBe(100)
    expect(prevClose.get('AAPL')).toBe(98)
  })

  it('varias fuentes el mismo día NO se usan como prevClose (Decisión 4)', () => {
    const rows: PriceRow[] = [
      { ticker: 'AAPL', price: 100, price_date: '2026-06-16' },
      { ticker: 'AAPL', price: 101, price_date: '2026-06-16' }, // mismo día, otra fuente
      { ticker: 'AAPL', price: 98, price_date: '2026-06-15' },
    ]
    const { current, prevClose } = deriveCurrentAndPrevClose(rows)
    expect([100, 101]).toContain(current.get('AAPL')) // una del 06-16
    expect(prevClose.get('AAPL')).toBe(98) // NO la otra del 06-16
  })

  it('un solo día → sin prevClose', () => {
    const rows: PriceRow[] = [{ ticker: 'X', price: 10, price_date: '2026-06-16' }]
    const { current, prevClose } = deriveCurrentAndPrevClose(rows)
    expect(current.get('X')).toBe(10)
    expect(prevClose.has('X')).toBe(false)
  })
})
```

- [ ] **Step 2: Run para verlo fallar**

Run: `npm test -- src/lib/alerts/prices.test.ts`
Expected: FAIL — `prices.ts` no existe.

- [ ] **Step 3: Implementar `src/lib/alerts/prices.ts`**

```typescript
// src/lib/alerts/prices.ts
export interface PriceRow {
  ticker: string
  price: number
  price_date: string // YYYY-MM-DD
}

// Deriva spot (precio de la fecha máxima) y cierre del día hábil anterior (fecha previa
// DISTINTA), por ticker. Deduplica a un precio por fecha (primera aparición gana), evitando
// usar otra fuente del mismo día como "cierre anterior" (Decisión 4). No asume orden de entrada.
export function deriveCurrentAndPrevClose(rows: PriceRow[]): {
  current: Map<string, number>
  prevClose: Map<string, number>
} {
  const byTicker = new Map<string, Map<string, number>>()
  for (const r of rows) {
    const m = byTicker.get(r.ticker) ?? new Map<string, number>()
    if (!m.has(r.price_date)) m.set(r.price_date, Number(r.price))
    byTicker.set(r.ticker, m)
  }
  const current = new Map<string, number>()
  const prevClose = new Map<string, number>()
  for (const [ticker, m] of byTicker) {
    const dates = [...m.keys()].sort((a, b) => b.localeCompare(a)) // fecha desc
    if (dates.length >= 1) current.set(ticker, m.get(dates[0])!)
    if (dates.length >= 2) prevClose.set(ticker, m.get(dates[1])!)
  }
  return { current, prevClose }
}
```

- [ ] **Step 4: Run para verlo pasar**

Run: `npm test -- src/lib/alerts/prices.test.ts`
Expected: PASS (3 verdes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/alerts/prices.ts src/lib/alerts/prices.test.ts
git commit -m "$(cat <<'EOF'
feat(alerts): deriveCurrentAndPrevClose (cierre del día previo, dedup por fecha)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Schema de validación

**Files:**
- Modify: `src/lib/validation/schemas.ts` (añadir al final)
- Test: `src/lib/validation/schemas.test.ts` (añadir bloque + import)

- [ ] **Step 1: Añadir el test que falla a `schemas.test.ts`**

Añade `alertInputSchema` al import existente del bloque superior:

```typescript
import {
  assetInputSchema,
  transactionInputSchema,
  priceInputSchema,
  backtestConfigSchema,
  scenarioConfigSchema,
  alertInputSchema,
} from '@/lib/validation/schemas'
```

Y añade este bloque al final del archivo:

```typescript
describe('alertInputSchema', () => {
  const UUID2 = '11111111-1111-4111-8111-111111111111'
  it('acepta una alerta válida y coacciona threshold string', () => {
    const r = alertInputSchema.parse({ alertType: 'price_above', assetId: UUID2, threshold: '150.5' })
    expect(r.alertType).toBe('price_above')
    expect(r.threshold).toBe(150.5)
  })
  it('rechaza tipo desconocido', () => {
    expect(alertInputSchema.safeParse({ alertType: 'rebalance_drift', assetId: UUID2, threshold: 1 }).success).toBe(false)
  })
  it('rechaza threshold no positivo', () => {
    expect(alertInputSchema.safeParse({ alertType: 'price_above', assetId: UUID2, threshold: 0 }).success).toBe(false)
  })
  it('rechaza assetId no-uuid', () => {
    expect(alertInputSchema.safeParse({ alertType: 'price_above', assetId: 'x', threshold: 1 }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run para verlo fallar**

Run: `npm test -- src/lib/validation/schemas.test.ts`
Expected: FAIL — `alertInputSchema` no existe.

- [ ] **Step 3: Añadir el schema al final de `src/lib/validation/schemas.ts`**

```typescript
export const alertInputSchema = z.object({
  alertType: z.enum(['price_above', 'price_below', 'pct_change']),
  assetId: z.string().uuid(),
  threshold: z.coerce.number().positive(),
})
export type AlertInput = z.infer<typeof alertInputSchema>
```

- [ ] **Step 4: Run para verlo pasar**

Run: `npm test -- src/lib/validation/schemas.test.ts`
Expected: PASS (incluye los 4 nuevos; sin romper los existentes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation/schemas.ts src/lib/validation/schemas.test.ts
git commit -m "$(cat <<'EOF'
feat(validation): alertInputSchema

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Integración `evaluateAndPersist`

**Files:**
- Create: `src/lib/alerts/run.ts`

Integración con Supabase — sin test unitario (la lógica pura ya está cubierta en Tasks 2-3). Se valida con lint + build. `userId` no es parámetro: las RLS (`own alerts`) ya acotan las filas a la sesión del usuario.

- [ ] **Step 1: Crear `src/lib/alerts/run.ts`**

```typescript
// src/lib/alerts/run.ts
import { fetchAllRows } from '@/lib/supabase/paginate'
import { deriveCurrentAndPrevClose, type PriceRow } from './prices'
import { evaluateAlerts } from './evaluate'
import type { AlertRow, AlertTrigger, AlertType } from './types'

// Carga alertas active del usuario (RLS), deriva spot/cierre-anterior de price_cache
// (paginado, solo caché → cero llamadas externas), evalúa y marca las disparadas con
// lock optimista (AND status='active'). Devuelve las recién disparadas.
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function evaluateAndPersist(supabase: any): Promise<AlertTrigger[]> {
  const { data: alertRows, error: aErr } = await supabase
    .from('alerts')
    .select('id, alert_type, threshold, status, assets(ticker)')
    .eq('status', 'active')
  if (aErr) throw new Error(aErr.message)

  const alerts: AlertRow[] = (alertRows ?? [])
    .map((r: any) => ({
      id: r.id,
      ticker: r.assets?.ticker ?? '',
      alertType: r.alert_type as AlertType,
      threshold: Number(r.threshold),
      status: r.status,
    }))
    .filter((a: AlertRow) => a.ticker !== '')
  if (alerts.length === 0) return []

  const wanted = [...new Set(alerts.map((a) => a.ticker))]
  const priceRows = await fetchAllRows<PriceRow>((from, to) =>
    supabase
      .from('price_cache')
      .select('ticker, price, price_date')
      .in('ticker', wanted)
      .order('price_date', { ascending: false })
      .order('source', { ascending: true })
      .range(from, to),
  )
  const { current, prevClose } = deriveCurrentAndPrevClose(priceRows)

  const triggers = evaluateAlerts(alerts, current, prevClose)
  if (triggers.length === 0) return []

  const { error: upErr } = await supabase
    .from('alerts')
    .update({ status: 'triggered', triggered_at: new Date().toISOString() })
    .in('id', triggers.map((t) => t.id))
    .eq('status', 'active')
  if (upErr) throw new Error(upErr.message)
  return triggers
}
/* eslint-enable @typescript-eslint/no-explicit-any */
```

- [ ] **Step 2: Lint**

Run: `npx eslint src/lib/alerts/run.ts`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/alerts/run.ts
git commit -m "$(cat <<'EOF'
feat(alerts): evaluateAndPersist (lee caché, lock optimista al disparar)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Rutas de la API + hook de refresh

**Files:**
- Create: `src/app/api/alerts/route.ts`
- Create: `src/app/api/alerts/[id]/route.ts`
- Create: `src/app/api/alerts/evaluate/route.ts`
- Modify: `src/app/api/prices/refresh/route.ts`

Integración — se valida con lint + build.

- [ ] **Step 1: Crear `src/app/api/alerts/route.ts`**

```typescript
// src/app/api/alerts/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { alertInputSchema } from '@/lib/validation/schemas'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('alerts')
    .select('id, alert_type, threshold, status, triggered_at, assets(ticker)')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const alerts = (data ?? []).map((r: any) => ({
    id: r.id,
    ticker: r.assets?.ticker ?? '',
    alertType: r.alert_type,
    threshold: Number(r.threshold),
    status: r.status,
    triggeredAt: r.triggered_at,
  }))
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return NextResponse.json({ alerts })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = alertInputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const { alertType, assetId, threshold } = parsed.data

  const { data, error } = await supabase
    .from('alerts')
    .insert({ user_id: user.id, asset_id: assetId, alert_type: alertType, threshold, status: 'active' })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
```

- [ ] **Step 2: Crear `src/app/api/alerts/[id]/route.ts`**

```typescript
// src/app/api/alerts/[id]/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const status = body?.status
  // Solo se permite reactivar (active) o silenciar (disabled); 'triggered' lo pone el motor.
  if (status !== 'active' && status !== 'disabled') {
    return NextResponse.json({ error: "status debe ser 'active' o 'disabled'" }, { status: 400 })
  }

  const { error } = await supabase.from('alerts').update({ status }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return new NextResponse(null, { status: 204 })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase.from('alerts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return new NextResponse(null, { status: 204 })
}
```

- [ ] **Step 3: Crear `src/app/api/alerts/evaluate/route.ts`**

```typescript
// src/app/api/alerts/evaluate/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { evaluateAndPersist } from '@/lib/alerts/run'

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const triggered = await evaluateAndPersist(supabase)
    return NextResponse.json({ triggered })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'fallo al evaluar' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Hook no bloqueante en `src/app/api/prices/refresh/route.ts`**

Añade el import junto a los demás (tras la línea `import { computeSnapshotValue } from '@/lib/portfolio/snapshot'`):

```typescript
import { evaluateAndPersist } from '@/lib/alerts/run'
```

Y justo **antes** del `return NextResponse.json({ results, quotes: quotes.length, snapshotValue })`, añade:

```typescript
  // Auto-evaluación de alertas tras refrescar precios (best-effort, no bloquea el refresh).
  try {
    await evaluateAndPersist(supabase)
  } catch (e) {
    console.error('alertas: evaluación tras refresh falló:', e instanceof Error ? e.message : e)
  }

```

- [ ] **Step 5: Lint + build**

Run: `npx eslint && npx next build`
Expected: lint exit 0; build compila `ƒ /api/alerts`, `ƒ /api/alerts/[id]`, `ƒ /api/alerts/evaluate` sin errores de tipo.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/alerts src/app/api/prices/refresh/route.ts
git commit -m "$(cat <<'EOF'
feat(api): /api/alerts (CRUD + evaluate) + auto-evaluación al refrescar precios

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Página `/alerts`

**Files:**
- Modify (reemplazo total): `src/app/(app)/alerts/page.tsx`

Recuerda el lint `react-hooks/set-state-in-effect`: en funciones llamadas desde `useEffect` usa `.then(setState)` (como `loadAll`); en handlers de evento el `await` es válido.

- [ ] **Step 1: Reemplazar `src/app/(app)/alerts/page.tsx`**

```tsx
// src/app/(app)/alerts/page.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AlertType } from '@/lib/alerts/types'

interface Asset {
  id: string
  ticker: string
}
interface Position {
  ticker: string
  currentPrice: number | null
}
interface AlertView {
  id: string
  ticker: string
  alertType: AlertType
  threshold: number
  status: 'active' | 'triggered' | 'disabled'
  triggeredAt: string | null
}

const inputCls = 'rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200'
const btnCls =
  'rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50'
const ghostBtn = 'rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800'

const TYPE_LABEL: Record<AlertType, string> = {
  price_above: 'Precio por encima de',
  price_below: 'Precio por debajo de',
  pct_change: 'Movimiento del día ≥ (%)',
}
const STATUS_LABEL: Record<AlertView['status'], string> = {
  active: 'Activa',
  triggered: 'Disparada',
  disabled: 'Silenciada',
}
const money = (x: number | null) =>
  x == null ? '—' : x.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export default function AlertsPage() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [pricesByTicker, setPricesByTicker] = useState<Record<string, number>>({})
  const [alerts, setAlerts] = useState<AlertView[]>([])
  const [alertType, setAlertType] = useState<AlertType>('price_below')
  const [assetId, setAssetId] = useState('')
  const [threshold, setThreshold] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)

  const loadAll = useCallback(() => {
    fetch('/api/assets')
      .then((r) => (r.ok ? r.json() : []))
      .then((d: Asset[]) => setAssets(d ?? []))
    fetch('/api/positions')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { positions: Position[] } | null) => {
        const map: Record<string, number> = {}
        for (const p of d?.positions ?? []) if (p.currentPrice != null) map[p.ticker] = p.currentPrice
        setPricesByTicker(map)
      })
    fetch('/api/alerts')
      .then((r) => (r.ok ? r.json() : { alerts: [] }))
      .then((d: { alerts: AlertView[] }) => setAlerts(d?.alerts ?? []))
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  async function create() {
    setError(null)
    const res = await fetch('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alertType, assetId, threshold: Number(threshold) }),
    })
    if (!res.ok) {
      setError('no se pudo crear la alerta (revisa activo y umbral)')
      return
    }
    setThreshold('')
    loadAll()
  }

  async function patchStatus(id: string, status: 'active' | 'disabled') {
    await fetch(`/api/alerts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    loadAll()
  }

  function reactivate(a: AlertView) {
    const price = pricesByTicker[a.ticker]
    const holds =
      price !== undefined &&
      ((a.alertType === 'price_above' && price > a.threshold) ||
        (a.alertType === 'price_below' && price < a.threshold))
    if (holds) {
      const ok = window.confirm(
        `El precio actual (${money(price)}) ya cumple el umbral (${a.threshold}); se volverá a disparar en la próxima evaluación. ¿Reactivar de todos modos?`
      )
      if (!ok) return
    }
    patchStatus(a.id, 'active')
  }

  async function remove(id: string) {
    await fetch(`/api/alerts/${id}`, { method: 'DELETE' })
    loadAll()
  }

  async function evaluateNow() {
    setBanner(null)
    const res = await fetch('/api/alerts/evaluate', { method: 'POST' })
    const body = await res.json().catch(() => ({}))
    const n = res.ok ? (body.triggered?.length ?? 0) : 0
    setBanner(res.ok ? `Evaluación completada: ${n} alerta(s) disparada(s).` : 'la evaluación falló')
    loadAll()
  }

  const unit = alertType === 'pct_change' ? '%' : 'precio'

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-slate-100">Alertas</h1>

      {/* Crear */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-slate-400">
            Tipo
            <select className={`${inputCls} mt-1 block`} value={alertType} onChange={(e) => setAlertType(e.target.value as AlertType)}>
              <option value="price_below">{TYPE_LABEL.price_below}</option>
              <option value="price_above">{TYPE_LABEL.price_above}</option>
              <option value="pct_change">{TYPE_LABEL.pct_change}</option>
            </select>
          </label>
          <label className="text-sm text-slate-400">
            Activo
            <select className={`${inputCls} mt-1 block`} value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              <option value="">—</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.ticker}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-400">
            Umbral ({unit})
            <input
              type="number"
              step="any"
              min="0"
              className={`${inputCls} mt-1 block w-32`}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </label>
          <button className={btnCls} disabled={!assetId || threshold === ''} onClick={create}>
            Crear alerta
          </button>
          <button className={ghostBtn} onClick={evaluateNow}>
            Revisar ahora
          </button>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {banner && <p className="text-sm text-amber-300">{banner}</p>}
      </section>

      {/* Lista */}
      <section>
        {alerts.length === 0 ? (
          <p className="text-sm text-slate-500">No tienes alertas. Crea una arriba.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs uppercase text-slate-500">
                <th className="py-2">Activo</th>
                <th className="px-4">Tipo</th>
                <th className="px-4 text-right">Umbral</th>
                <th className="px-4 text-right">Precio actual</th>
                <th className="px-4">Estado</th>
                <th className="px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id} className="border-b border-slate-900">
                  <td className="py-2 font-semibold">{a.ticker}</td>
                  <td className="px-4">{TYPE_LABEL[a.alertType]}</td>
                  <td className="px-4 text-right">{a.threshold}{a.alertType === 'pct_change' ? '%' : ''}</td>
                  <td className="px-4 text-right">{money(pricesByTicker[a.ticker] ?? null)}</td>
                  <td className="px-4">{STATUS_LABEL[a.status]}</td>
                  <td className="px-4 text-right">
                    <div className="flex justify-end gap-2">
                      {a.status === 'active' ? (
                        <button className={ghostBtn} onClick={() => patchStatus(a.id, 'disabled')}>
                          Silenciar
                        </button>
                      ) : (
                        <button className={ghostBtn} onClick={() => reactivate(a)}>
                          Reactivar
                        </button>
                      )}
                      <button className={ghostBtn} onClick={() => remove(a.id)}>
                        Borrar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Lint + build**

Run: `npx eslint "src/app/(app)/alerts/page.tsx" && npx next build`
Expected: lint exit 0 (sin `react-hooks/set-state-in-effect`); build compila `○ /alerts`.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/alerts/page.tsx"
git commit -m "$(cat <<'EOF'
feat(ui): página /alerts — crear/listar/gestionar, revisar ahora, aviso al reactivar

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Badge de alertas disparadas en el shell

**Files:**
- Modify (reemplazo total): `src/components/sidebar.tsx`

- [ ] **Step 1: Reemplazar `src/components/sidebar.tsx`**

```tsx
// src/components/sidebar.tsx
'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const links = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/portfolio', label: 'Portafolio' },
  { href: '/analytics', label: 'Analítica' },
  { href: '/backtest', label: 'Backtest' },
  { href: '/scenarios', label: 'Escenarios' },
  { href: '/alerts', label: 'Alertas' },
  { href: '/data-sources', label: 'Fuentes de datos' },
  { href: '/settings', label: 'Configuración' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [triggered, setTriggered] = useState(0)

  useEffect(() => {
    fetch('/api/alerts')
      .then((r) => (r.ok ? r.json() : { alerts: [] }))
      .then((d: { alerts: { status: string }[] }) =>
        setTriggered((d?.alerts ?? []).filter((a) => a.status === 'triggered').length)
      )
  }, [pathname])

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-950 p-4">
      <div className="mb-6 text-lg font-bold text-slate-100">Portfolio App</div>
      <nav className="flex flex-1 flex-col gap-1">
        {links.map((l) => {
          const isActive = pathname === l.href || pathname.startsWith(l.href + '/')
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center justify-between rounded px-3 py-2 text-sm ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <span>{l.label}</span>
              {l.href === '/alerts' && triggered > 0 && (
                <span className="ml-2 rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white">
                  {triggered}
                </span>
              )}
            </Link>
          )
        })}
      </nav>
      <button
        onClick={signOut}
        className="mt-4 rounded px-3 py-2 text-left text-sm text-slate-400 hover:bg-slate-800"
      >
        Cerrar sesión
      </button>
    </aside>
  )
}
```

- [ ] **Step 2: Lint + build**

Run: `npx eslint src/components/sidebar.tsx && npx next build`
Expected: lint exit 0; build OK.

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar.tsx
git commit -m "$(cat <<'EOF'
feat(ui): badge de alertas disparadas en el sidebar

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Verificación final y docs

**Files:**
- Modify: `docs/superpowers/plans/ROADMAP.md` (Fase 6 → Implementada)
- Modify: `README.md` (sección Alerts)

- [ ] **Step 1: Suite completa + lint + build**

Run: `npx vitest run && npx eslint && npx next build`
Expected: todos los tests verdes (incluye los ~12 nuevos de alerts + schema), lint exit 0, build OK con `ƒ /api/alerts`, `ƒ /api/alerts/[id]`, `ƒ /api/alerts/evaluate`, `○ /alerts`.

- [ ] **Step 2: Verificación e2e en navegador (requiere login del usuario)**

Arrancar `npm run dev` (webpack). En `/alerts`:
1. Crear una alerta `price_below` sobre AAPL con un umbral **por encima** del precio actual (para que dispare) y otra `price_above` con umbral **muy alto** (para que NO dispare).
2. Pulsar **"Revisar ahora"** → el banner indica nº de disparadas; la `price_below` pasa a **Disparada**; el **badge** del sidebar muestra el conteo.
3. **Reactivar** la disparada cuya condición sigue cumpliéndose → debe aparecer el **aviso** ("el precio actual ya cumple el umbral…").
4. Crear una `pct_change` (ej. 1%) y **Revisar ahora** para ver si dispara según el movimiento del día.
5. **Silenciar** y **Borrar** una alerta; refrescar precios en `/data-sources` y confirmar que la auto-evaluación corre (sin 500).

- [ ] **Step 3: Actualizar ROADMAP y README**

En `docs/superpowers/plans/ROADMAP.md`, fila de la Fase 6: estado **Implementada (MVP)** + enlaces a spec y plan. En `README.md`, la tabla de capacidades / sección Alerts: alertas in-app de precio (above/below/pct_change), evaluación que lee solo `price_cache`, auto al refrescar, badge en el shell; `rebalance_drift`, email y `/settings` = fast-follow.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/ROADMAP.md README.md
git commit -m "$(cat <<'EOF'
docs(roadmap): Fase 6 Alerts System MVP implementada

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Notas de implementación

- **Dev server con webpack:** `npm run dev` ya fija `--webpack` (Turbopack rompe `src/proxy.ts` en Next 16).
- **Sin migraciones:** la tabla `alerts` y su RLS ya existen (Fase 1). Se usan 3 de los 4 tipos del CHECK.
- **`evaluateAndPersist` lee solo `price_cache`** → cero llamadas a APIs externas, sin impacto en rate limits.
- **Lock optimista:** el `UPDATE ... .eq('status','active')` evita doble disparo si el botón y el hook de refresh corren a la vez.
- **`react-hooks/set-state-in-effect`:** en funciones llamadas desde `useEffect` usar `.then(setState)`; en handlers de evento el `await` es válido.
- **Paginación:** todo `select` sobre `price_cache` usa `fetchAllRows`.
