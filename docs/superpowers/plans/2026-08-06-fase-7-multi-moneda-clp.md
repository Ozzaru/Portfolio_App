# Fase 7 — Soporte Multi-Moneda (base CLP) · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidar el portafolio en **CLP** (acciones chilenas vía Zesty + activos en USD) convirtiendo en la frontera de datos, con cost basis al FX histórico, comisión/IVA desglosados y migración del histórico de snapshots.

**Architecture:** Módulo puro `src/lib/fx/` normaliza series de precios y transacciones a CLP **antes** de que cualquier motor las vea. Los motores (`analytics/engine`, `backtest/*`, `scenarios/*`, `correlation`, `riskMetrics`) **no se modifican**: siguen operando sobre una sola moneda. El tipo de cambio `USDCLP=X` se cachea en `price_cache` como un ticker más.

**Tech Stack:** Next.js 16 (App Router, dev `--webpack`), TypeScript, Zod, Vitest (TDD), Supabase (PostgreSQL + RLS).

**Spec:** [docs/superpowers/specs/2026-08-06-fase-7-multi-moneda-clp-design.md](../specs/2026-08-06-fase-7-multi-moneda-clp-design.md)

---

## File structure

| Archivo | Responsabilidad |
|---|---|
| `src/lib/fx/constants.ts` | `BASE_CURRENCY`, `FX_TICKER`, `IVA_RATE` |
| `src/lib/fx/convert.ts` | Puro: `fxAsOf`, `convertSeries`, `toBaseCurrency`, `transactionsToBaseCurrency` |
| `src/lib/fx/load.ts` | Server: `loadFxSeries(supabase)` desde `price_cache` |
| `src/lib/format/money.ts` | `formatMoney(valor, moneda)` |
| `supabase/migrations/0003_multi_currency.sql` | `commission`/`iva`, `snapshots.currency` + backfill atómico |
| `src/lib/validation/schemas.ts` | `transactionInputSchema` con `commission`/`iva` |
| `src/lib/portfolio/holdings.ts` | Fix: comisiones de venta |
| `src/lib/portfolio/valuation.ts` | `nativeCurrency` / `nativePrice` en `PositionView` |
| `src/app/api/positions\|analytics\|backtest\|scenarios/route.ts` | Cableado de la frontera |
| `src/app/api/prices/{refresh,backfill}/route.ts` | Ingesta de `USDCLP=X` + `snapshots.currency` |
| `src/app/api/transactions/route.ts` | Deriva `fees = commission + iva` |
| `src/app/(app)/*/page.tsx` | UI: formato CLP, precio nativo, etiquetas |

Tests nuevos: `src/lib/fx/convert.test.ts`, `src/lib/fx/calendar-protection.test.ts`, `src/lib/format/money.test.ts`. Tests modificados: `holdings.test.ts`, `valuation.test.ts`, `schemas.test.ts`. Rutas y páginas se validan con lint + build + e2e (igual que Fases 4-6).

**Orden:** dominio puro (Tasks 1-7) → server/DB (8-12) → dominio con cambios de firma (13-14) → cableado (15-19) → UI (20-25) → verificación (26).

---

## Task 1: Constantes del módulo FX

**Files:**
- Create: `src/lib/fx/constants.ts`

Solo declaraciones — sin test.

- [ ] **Step 1: Crear `src/lib/fx/constants.ts`**

```typescript
// src/lib/fx/constants.ts

// Moneda base de toda la valorización. Constante deliberada, no setting:
// ver Decisión 3 del spec (YAGNI — cartera personal radicada en Chile).
export const BASE_CURRENCY = 'CLP'

// Símbolo canónico del tipo de cambio en Yahoo, cacheado en `price_cache`
// como un ticker más. Su valor son CLP por 1 USD (≈ 950) — Decisión 5.
export const FX_TICKER = 'USDCLP=X'

// IVA chileno sobre la comisión de corretaje. Solo alimenta el autocálculo
// del formulario; el valor guardado es siempre el que el usuario confirma.
export const IVA_RATE = 0.19
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/fx/constants.ts
git commit -m "$(cat <<'EOF'
feat(fx): constantes del módulo (BASE_CURRENCY, FX_TICKER, IVA_RATE)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `fxAsOf` — tipo de cambio con forward-fill

**Files:**
- Create: `src/lib/fx/convert.ts`
- Test: `src/lib/fx/convert.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```typescript
// src/lib/fx/convert.test.ts
import { describe, it, expect } from 'vitest'
import type { PricePointAdj } from '@/lib/analytics/types'
import { fxAsOf } from './convert'

const fx = (date: string, price: number): PricePointAdj => ({ date, price, adjPrice: price })

const FX_SERIES: PricePointAdj[] = [
  fx('2026-01-05', 900),
  fx('2026-01-06', 910),
  fx('2026-01-09', 950),
]

describe('fxAsOf', () => {
  it('devuelve el valor de la fecha exacta', () => {
    expect(fxAsOf(FX_SERIES, '2026-01-06')).toBe(910)
  })

  it('hace forward-fill: usa el último publicado si no hay dato ese día', () => {
    // 07 y 08 sin publicación (feriado/fin de semana) → arrastra el del 06.
    expect(fxAsOf(FX_SERIES, '2026-01-08')).toBe(910)
  })

  it('devuelve null antes del inicio de la serie', () => {
    expect(fxAsOf(FX_SERIES, '2026-01-02')).toBeNull()
  })

  it('devuelve null si el tipo de cambio no es positivo', () => {
    expect(fxAsOf([fx('2026-01-05', 0)], '2026-01-05')).toBeNull()
  })

  it('devuelve null con serie vacía', () => {
    expect(fxAsOf([], '2026-01-05')).toBeNull()
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run src/lib/fx/convert.test.ts`
Expected: FAIL — `Failed to resolve import "./convert"`

- [ ] **Step 3: Implementación mínima**

```typescript
// src/lib/fx/convert.ts
import { priceAsOf } from '@/lib/analytics/series'
import type { PricePointAdj } from '@/lib/analytics/types'

// Tipo de cambio vigente en `date` con forward-fill: un feriado en Chile con
// mercado abierto en EE.UU. usa el último FX publicado (Decisión 7).
// Reusa `priceAsOf` para no duplicar la semántica de forward-fill del proyecto.
export function fxAsOf(fxSeries: PricePointAdj[], date: string): number | null {
  const point = priceAsOf(fxSeries, date)
  return point && point.price > 0 ? point.price : null
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run src/lib/fx/convert.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/fx/convert.ts src/lib/fx/convert.test.ts
git commit -m "$(cat <<'EOF'
feat(fx): fxAsOf con forward-fill sobre la serie USDCLP=X

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2b: `convertSeries` — la primitiva de conversión

**Files:**
- Modify: `src/lib/fx/convert.ts`
- Test: `src/lib/fx/convert.test.ts`

Implementa las **tres reglas invariantes** de la Decisión 7 del spec.

- [ ] **Step 1: Añadir los tests que fallan al final de `src/lib/fx/convert.test.ts`**

```typescript
describe('convertSeries', () => {
  const usdPoints: PricePointAdj[] = [
    { date: '2026-01-05', price: 100, adjPrice: 90 },
    { date: '2026-01-06', price: 200, adjPrice: 180 },
  ]

  it('multiplica price y adjPrice por el FX del día (dirección: CLP por 1 USD)', () => {
    const out = convertSeries(usdPoints, 'USD', FX_SERIES)
    // Blindaje de la Decisión 5: invertir la dirección daría 100/900 ≈ 0,11.
    expect(out[0]).toEqual({ date: '2026-01-05', price: 90_000, adjPrice: 81_000 })
    expect(out[1]).toEqual({ date: '2026-01-06', price: 182_000, adjPrice: 163_800 })
  })

  it('deja los valores en CLP sin modificar (pasa directo, sin redondeo)', () => {
    const clpPoints: PricePointAdj[] = [{ date: '2026-01-05', price: 79.68, adjPrice: 79.68 }]
    expect(convertSeries(clpPoints, 'CLP', FX_SERIES)).toEqual(clpPoints)
  })

  it('descarta el punto si falta FX para su fecha (nunca lo deja pasar sin convertir)', () => {
    const points: PricePointAdj[] = [
      { date: '2026-01-02', price: 100, adjPrice: 100 }, // antes del inicio del FX
      { date: '2026-01-05', price: 100, adjPrice: 100 },
    ]
    const out = convertSeries(points, 'USD', FX_SERIES)
    expect(out).toHaveLength(1)
    expect(out[0].date).toBe('2026-01-05')
  })

  it('nunca agrega fechas: la salida es subconjunto de la entrada', () => {
    const out = convertSeries(usdPoints, 'USD', FX_SERIES)
    const input = new Set(usdPoints.map((p) => p.date))
    for (const p of out) expect(input.has(p.date)).toBe(true)
  })

  it('lanza ante una moneda no soportada en vez de convertirla mal', () => {
    expect(() => convertSeries(usdPoints, 'EUR', FX_SERIES)).toThrow(/no soportada/)
  })
})
```

Actualiza el import de la primera línea del archivo:

```typescript
import { fxAsOf, convertSeries } from './convert'
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run src/lib/fx/convert.test.ts`
Expected: FAIL — `convertSeries is not a function`

- [ ] **Step 3: Añadir la implementación a `src/lib/fx/convert.ts`**

```typescript
// Convierte una serie a la moneda base. Tres reglas invariantes (Decisión 7):
//   1. NUNCA agrega fechas — solo multiplica puntos existentes. Esto protege el
//      `realAdj.has(d)` del que depende la intersección de la correlación en
//      analytics/engine.ts; rellenar fechas rompería esa protección en silencio.
//   2. La moneda base pasa directo, sin lookup ni multiplicación.
//   3. Si falta FX para una fecha, el punto se DESCARTA. Dejarlo pasar sin
//      convertir inyectaría un error de ~950x indetectable en un gráfico
//      normalizado; descartar encoge la muestra de forma visible y conservadora,
//      y respeta la regla 1 porque solo quita fechas.
export function convertSeries(
  points: PricePointAdj[],
  currency: string,
  fxSeries: PricePointAdj[]
): PricePointAdj[] {
  if (currency === BASE_CURRENCY) return points
  if (currency !== 'USD') {
    throw new Error(`moneda no soportada: ${currency} (solo USD y ${BASE_CURRENCY})`)
  }
  const out: PricePointAdj[] = []
  for (const p of points) {
    const rate = fxAsOf(fxSeries, p.date)
    if (rate === null) continue
    out.push({ date: p.date, price: p.price * rate, adjPrice: p.adjPrice * rate })
  }
  return out
}
```

Añade el import de la constante en la cabecera del archivo:

```typescript
import { BASE_CURRENCY } from './constants'
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run src/lib/fx/convert.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/fx/convert.ts src/lib/fx/convert.test.ts
git commit -m "$(cat <<'EOF'
feat(fx): convertSeries con las tres reglas invariantes

No agrega fechas (protege la intersección de la correlación), CLP pasa
directo y la falta de FX descarta el punto en vez de dejarlo sin convertir.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `toBaseCurrency` — envoltorio a nivel de mapa

**Files:**
- Modify: `src/lib/fx/convert.ts`
- Test: `src/lib/fx/convert.test.ts`

- [ ] **Step 1: Añadir los tests que fallan**

```typescript
describe('toBaseCurrency', () => {
  it('convierte los USD y deja los CLP intactos, en el mismo mapa', () => {
    const series: PriceSeriesByTicker = new Map([
      ['AAPL', [{ date: '2026-01-05', price: 100, adjPrice: 100 }]],
      ['ENELCHILE.SN', [{ date: '2026-01-05', price: 79.68, adjPrice: 79.68 }]],
    ])
    const currencies = new Map([
      ['AAPL', 'USD'],
      ['ENELCHILE.SN', 'CLP'],
    ])
    const out = toBaseCurrency(series, currencies, FX_SERIES)
    expect(out.get('AAPL')![0].price).toBe(90_000)
    expect(out.get('ENELCHILE.SN')![0].price).toBe(79.68)
  })

  it('asume USD cuando el ticker no tiene moneda declarada (default del esquema)', () => {
    const series: PriceSeriesByTicker = new Map([
      ['SPY', [{ date: '2026-01-05', price: 100, adjPrice: 100 }]],
    ])
    const out = toBaseCurrency(series, new Map(), FX_SERIES)
    expect(out.get('SPY')![0].price).toBe(90_000)
  })
})
```

Actualiza los imports de la cabecera del test:

```typescript
import type { PricePointAdj, PriceSeriesByTicker } from '@/lib/analytics/types'
import { fxAsOf, convertSeries, toBaseCurrency } from './convert'
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run src/lib/fx/convert.test.ts`
Expected: FAIL — `toBaseCurrency is not a function`

- [ ] **Step 3: Añadir la implementación a `src/lib/fx/convert.ts`**

```typescript
// Normaliza todas las series de un mapa a la moneda base. Este es el punto
// ÚNICO de conversión: aguas abajo los motores ven una sola moneda y no se
// modifican (Decisión 2).
// Un ticker sin moneda declarada se asume USD, que es el default del esquema
// (`assets.currency default 'USD'`) y cubre al benchmark, que no tiene fila
// en `assets`.
export function toBaseCurrency(
  series: PriceSeriesByTicker,
  currencyByTicker: Map<string, string>,
  fxSeries: PricePointAdj[]
): PriceSeriesByTicker {
  const out: PriceSeriesByTicker = new Map()
  for (const [ticker, points] of series) {
    out.set(ticker, convertSeries(points, currencyByTicker.get(ticker) ?? 'USD', fxSeries))
  }
  return out
}
```

Actualiza el import de tipos en la cabecera de `convert.ts`:

```typescript
import type { PricePointAdj, PriceSeriesByTicker } from '@/lib/analytics/types'
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run src/lib/fx/convert.test.ts`
Expected: PASS — 12 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/fx/convert.ts src/lib/fx/convert.test.ts
git commit -m "$(cat <<'EOF'
feat(fx): toBaseCurrency — normaliza el mapa de series a CLP

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `transactionsToBaseCurrency` — cost basis al FX histórico

**Files:**
- Modify: `src/lib/fx/convert.ts`
- Test: `src/lib/fx/convert.test.ts`

Implementa la Decisión 4 (el hallazgo que cambia el P&L) y la Decisión 10 (fallar ruidosamente).

- [ ] **Step 1: Añadir los tests que fallan**

```typescript
describe('transactionsToBaseCurrency', () => {
  const buy = (ticker: string, executedAt: string): Transaction => ({
    assetId: 'a1',
    ticker,
    side: 'buy',
    quantity: 10,
    price: 100,
    fees: 5,
    executedAt,
  })
  const currencies = new Map([
    ['AAPL', 'USD'],
    ['ENELCHILE.SN', 'CLP'],
  ])

  it('usa el FX de executedAt, NO el de hoy', () => {
    // Compra el 05 (FX 900), no el último de la serie (950). Si usara el FX de
    // hoy el precio saldría 95.000 y se borraría la ganancia cambiaria real.
    const [tx] = transactionsToBaseCurrency([buy('AAPL', '2026-01-05')], currencies, FX_SERIES)
    expect(tx.price).toBe(90_000)
    expect(tx.fees).toBe(4_500)
  })

  it('convierte cada transacción con el FX de SU propia fecha', () => {
    const out = transactionsToBaseCurrency(
      [buy('AAPL', '2026-01-05'), buy('AAPL', '2026-01-09')],
      currencies,
      FX_SERIES
    )
    expect(out[0].price).toBe(90_000)
    expect(out[1].price).toBe(95_000)
  })

  it('deja las transacciones en CLP intactas', () => {
    const tx = buy('ENELCHILE.SN', '2026-01-05')
    expect(transactionsToBaseCurrency([tx], currencies, FX_SERIES)[0]).toEqual(tx)
  })

  it('LANZA si falta FX: descartar una compra falsearía la cartera', () => {
    expect(() =>
      transactionsToBaseCurrency([buy('AAPL', '2026-01-02')], currencies, FX_SERIES)
    ).toThrow(/USDCLP=X para 2026-01-02/)
  })
})
```

Añade el import del tipo en la cabecera del test:

```typescript
import type { Transaction } from '@/lib/portfolio/holdings'
import { fxAsOf, convertSeries, toBaseCurrency, transactionsToBaseCurrency } from './convert'
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run src/lib/fx/convert.test.ts`
Expected: FAIL — `transactionsToBaseCurrency is not a function`

- [ ] **Step 3: Añadir la implementación a `src/lib/fx/convert.ts`**

```typescript
// Convierte transacciones a la moneda base usando el FX de SU fecha de
// ejecución, no el de hoy (Decisión 4). Comprar AAPL a US$100 con el dólar a
// 800 costó CLP$80.000; valorar ese costo al dólar de hoy borraría la ganancia
// cambiaria, que para un inversor en pesos es ganancia real.
//
// A diferencia de las series de precios, la falta de FX aquí LANZA en vez de
// descartar (Decisión 10): perder un punto de precio solo encoge la muestra,
// pero perder una compra alteraría los holdings y mostraría una cartera
// silenciosamente incorrecta.
export function transactionsToBaseCurrency(
  transactions: Transaction[],
  currencyByTicker: Map<string, string>,
  fxSeries: PricePointAdj[]
): Transaction[] {
  return transactions.map((tx) => {
    const currency = currencyByTicker.get(tx.ticker) ?? 'USD'
    if (currency === BASE_CURRENCY) return tx
    if (currency !== 'USD') {
      throw new Error(`moneda no soportada: ${currency} (solo USD y ${BASE_CURRENCY})`)
    }
    const rate = fxAsOf(fxSeries, tx.executedAt)
    if (rate === null) {
      throw new Error(
        `falta tipo de cambio ${FX_TICKER} para ${tx.executedAt}; ejecuta el backfill de precios`
      )
    }
    return { ...tx, price: tx.price * rate, fees: tx.fees * rate }
  })
}
```

Actualiza los imports de la cabecera de `convert.ts`:

```typescript
import type { Transaction } from '@/lib/portfolio/holdings'
import { BASE_CURRENCY, FX_TICKER } from './constants'
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run src/lib/fx/convert.test.ts`
Expected: PASS — 16 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/fx/convert.ts src/lib/fx/convert.test.ts
git commit -m "$(cat <<'EOF'
feat(fx): transactionsToBaseCurrency — cost basis al FX de la compra

Convierte con el FX de executedAt (no el de hoy) para capturar la ganancia
cambiaria real. La falta de FX lanza: descartar una compra falsearía la cartera.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Test de integración — la protección de la correlación sobrevive a la conversión

**Files:**
- Create: `src/lib/fx/calendar-protection.test.ts`

Verifica la Decisión 8: un feriado chileno **no** inyecta un retorno 0 en la matriz de correlación después de convertir. No requiere código nuevo — es una red de seguridad sobre la interacción entre `toBaseCurrency` y `buildCorrelation`.

- [ ] **Step 1: Escribir el test**

```typescript
// src/lib/fx/calendar-protection.test.ts
import { describe, it, expect } from 'vitest'
import { computeAnalytics } from '@/lib/analytics/engine'
import type { PricePointAdj, PriceSeriesByTicker } from '@/lib/analytics/types'
import type { Transaction } from '@/lib/portfolio/holdings'
import { toBaseCurrency, transactionsToBaseCurrency } from './convert'

const pt = (date: string, price: number): PricePointAdj => ({ date, price, adjPrice: price })

describe('protección de calendario tras convertir a CLP', () => {
  it('un feriado chileno no diluye la correlación (intersección, no forward-fill)', () => {
    // AAPL cotiza los 4 días; ENELCHILE.SN no cotiza el 07 (feriado en Chile).
    // En las fechas COMPARTIDAS ambos se mueven idéntico → correlación exacta 1.
    // Si el motor usara la unión con forward-fill, ENELCHILE tendría un retorno
    // 0 artificial el 07 y la correlación caería por debajo de 1.
    const series: PriceSeriesByTicker = new Map([
      ['AAPL', [pt('2026-01-05', 100), pt('2026-01-06', 110), pt('2026-01-07', 105), pt('2026-01-08', 115.5)]],
      ['ENELCHILE.SN', [pt('2026-01-05', 80), pt('2026-01-06', 88), pt('2026-01-08', 92.4)]],
    ])
    // FX constante: aísla el efecto del calendario del efecto cambiario.
    const fxSeries: PricePointAdj[] = [pt('2026-01-01', 900)]
    const currencies = new Map([
      ['AAPL', 'USD'],
      ['ENELCHILE.SN', 'CLP'],
    ])

    const transactions: Transaction[] = [
      { assetId: 'a1', ticker: 'AAPL', side: 'buy', quantity: 1, price: 100, fees: 0, executedAt: '2026-01-05' },
      { assetId: 'a2', ticker: 'ENELCHILE.SN', side: 'buy', quantity: 1, price: 80, fees: 0, executedAt: '2026-01-05' },
    ]

    const result = computeAnalytics({
      transactions: transactionsToBaseCurrency(transactions, currencies, fxSeries),
      priceSeries: toBaseCurrency(series, currencies, fxSeries),
      benchmarkSeries: null,
      benchmarkTicker: 'SPY',
      assetTypeByTicker: new Map([
        ['AAPL', 'stock'],
        ['ENELCHILE.SN', 'stock'],
      ]),
      period: 'ALL',
      today: '2026-01-08',
    })

    const i = result.correlation.tickers.indexOf('AAPL')
    const j = result.correlation.tickers.indexOf('ENELCHILE.SN')
    expect(result.correlation.matrix[i][j]).toBeCloseTo(1, 10)
  })

  it('convertir no altera el conjunto de fechas de cada ticker', () => {
    const series: PriceSeriesByTicker = new Map([
      ['AAPL', [pt('2026-01-05', 100), pt('2026-01-06', 110)]],
      ['ENELCHILE.SN', [pt('2026-01-05', 80)]],
    ])
    const fxSeries: PricePointAdj[] = [pt('2026-01-01', 900)]
    const out = toBaseCurrency(
      series,
      new Map([
        ['AAPL', 'USD'],
        ['ENELCHILE.SN', 'CLP'],
      ]),
      fxSeries
    )
    expect(out.get('AAPL')!.map((p) => p.date)).toEqual(['2026-01-05', '2026-01-06'])
    expect(out.get('ENELCHILE.SN')!.map((p) => p.date)).toEqual(['2026-01-05'])
  })
})
```

- [ ] **Step 2: Correr el test**

Run: `npx vitest run src/lib/fx/calendar-protection.test.ts`
Expected: PASS — 2 tests. Si el primero falla con un valor < 1, la intersección de `buildCorrelation` se rompió: revisa que `convertSeries` no esté agregando fechas.

- [ ] **Step 3: Commit**

```bash
git add src/lib/fx/calendar-protection.test.ts
git commit -m "$(cat <<'EOF'
test(fx): la conversión a CLP no rompe la intersección de la correlación

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `formatMoney`

**Files:**
- Create: `src/lib/format/money.ts`
- Test: `src/lib/format/money.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```typescript
// src/lib/format/money.test.ts
import { describe, it, expect } from 'vitest'
import { formatMoney } from './money'

// Las aserciones usan `toContain` a propósito: la salida exacta de Intl
// (símbolo, espacios no separables) varía entre versiones de ICU/Node y haría
// el test frágil. Lo que importa es la agrupación y los decimales.
describe('formatMoney', () => {
  it('formatea CLP sin decimales y con separador de miles', () => {
    expect(formatMoney(19442, 'CLP')).toContain('19.442')
    expect(formatMoney(19442, 'CLP')).not.toContain(',')
  })

  it('formatea USD con dos decimales', () => {
    expect(formatMoney(293.08, 'USD')).toContain('293,08')
  })

  it('redondea CLP al peso entero', () => {
    expect(formatMoney(19441.92, 'CLP')).toContain('19.442')
  })

  it('devuelve — para null', () => {
    expect(formatMoney(null, 'CLP')).toBe('—')
  })

  it('devuelve — para valores no finitos', () => {
    expect(formatMoney(Number.NaN, 'CLP')).toBe('—')
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run src/lib/format/money.test.ts`
Expected: FAIL — `Failed to resolve import "./money"`

- [ ] **Step 3: Implementación mínima**

```typescript
// src/lib/format/money.ts

// Decimales por moneda. El peso chileno no se fracciona; el resto usa 2.
const DECIMALS: Record<string, number> = { CLP: 0 }

export function formatMoney(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const digits = DECIMALS[currency] ?? 2
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run src/lib/format/money.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/format/money.ts src/lib/format/money.test.ts
git commit -m "$(cat <<'EOF'
feat(format): formatMoney por moneda (CLP sin decimales, USD con dos)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Loader de la serie FX desde `price_cache`

**Files:**
- Create: `src/lib/fx/load.ts`

Integración con Supabase — se valida con lint + build + e2e, igual que el resto de `run.ts`/rutas de las Fases 4-6.

- [ ] **Step 1: Crear `src/lib/fx/load.ts`**

```typescript
// src/lib/fx/load.ts
import { fetchAllRows } from '@/lib/supabase/paginate'
import type { PricePointAdj } from '@/lib/analytics/types'
import { FX_TICKER } from './constants'

type FxRow = { price: number; price_date: string }

// Serie histórica del tipo de cambio, ordenada ascendente (lo exige `priceAsOf`).
// Paginado obligatorio: un select sin `.range()` queda topado al "Max rows" de
// Supabase (1000) y con 5 años de historia diaria se truncaría en silencio —
// el mismo gotcha de las Fases 3-4.
// El FX no tiene cierre ajustado: adjPrice = price.
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function loadFxSeries(supabase: any, fromISO?: string): Promise<PricePointAdj[]> {
  const rows = await fetchAllRows<FxRow>((from, to) => {
    let q = supabase.from('price_cache').select('price, price_date').eq('ticker', FX_TICKER)
    if (fromISO) q = q.gte('price_date', fromISO)
    return q
      .order('price_date', { ascending: true })
      .order('source', { ascending: true })
      .range(from, to)
  })
  return rows.map((r) => {
    const price = Number(r.price)
    return { date: r.price_date, price, adjPrice: price }
  })
}
/* eslint-enable @typescript-eslint/no-explicit-any */
```

- [ ] **Step 2: Verificar que compila**

Run: `npm run lint`
Expected: sin errores nuevos

- [ ] **Step 3: Commit**

```bash
git add src/lib/fx/load.ts
git commit -m "$(cat <<'EOF'
feat(fx): loadFxSeries — serie USDCLP=X desde price_cache (paginada)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Ingesta de `USDCLP=X` en backfill y refresh

**Files:**
- Modify: `src/app/api/prices/backfill/route.ts:17-28`
- Modify: `src/app/api/prices/refresh/route.ts:18-25`

El FX no tiene fila en `assets`, así que `quoteSourceFor` nunca lo enrutaría. Se añade como `AssetRef` sintético con `asset_type: 'stock'` para que caiga en Yahoo.

- [ ] **Step 1: Modificar `src/app/api/prices/backfill/route.ts`**

Añade el import tras la línea 8:

```typescript
import { FX_TICKER } from '@/lib/fx/constants'
```

Reemplaza la línea 28:

```typescript
  const { rows, results } = await backfillHistory((assets ?? []) as AssetRef[], fromISO, adapters)
```

por:

```typescript
  // El tipo de cambio se trata como un ticker más de Yahoo. No tiene fila en
  // `assets`, así que se inyecta como AssetRef sintético: `asset_type: 'stock'`
  // lo enruta a Yahoo vía quoteSourceFor.
  const refs: AssetRef[] = [
    ...((assets ?? []) as AssetRef[]),
    { ticker: FX_TICKER, asset_type: 'stock' },
  ]
  const { rows, results } = await backfillHistory(refs, fromISO, adapters)
```

- [ ] **Step 2: Modificar `src/app/api/prices/refresh/route.ts`**

Añade el import tras la línea 9:

```typescript
import { FX_TICKER } from '@/lib/fx/constants'
```

Reemplaza la línea 25:

```typescript
  const { quotes, results } = await refreshQuotes((assets ?? []) as AssetRef[], adapters)
```

por:

```typescript
  // Igual que en el backfill: el FX entra como AssetRef sintético hacia Yahoo.
  const refs: AssetRef[] = [
    ...((assets ?? []) as AssetRef[]),
    { ticker: FX_TICKER, asset_type: 'stock' },
  ]
  const { quotes, results } = await refreshQuotes(refs, adapters)
```

`sourceOf()` ya devuelve `'yahoo'` para cualquier ticker que no esté en `assets`, así que la fila del FX se guarda con la fuente correcta sin cambios adicionales.

- [ ] **Step 3: Verificar lint y build**

Run: `npm run lint && npm run build`
Expected: sin errores

- [ ] **Step 4: Commit**

```bash
git add src/app/api/prices/backfill/route.ts src/app/api/prices/refresh/route.ts
git commit -m "$(cat <<'EOF'
feat(market-data): ingesta de USDCLP=X en backfill y refresh

El FX no tiene fila en assets: entra como AssetRef sintético para enrutarse
a Yahoo y se cachea en price_cache como un ticker más.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Migración SQL — costos desglosados y moneda de snapshots

**Files:**
- Create: `supabase/migrations/0003_multi_currency.sql`

⚠️ **Prerrequisito antes de EJECUTARLA** (no antes de escribirla): correr el backfill de precios en `/data-sources` para que `USDCLP=X` cubra el rango de `snapshot_date`. La Guarda B aborta si falta.

- [ ] **Step 1: Crear `supabase/migrations/0003_multi_currency.sql`**

```sql
-- supabase/migrations/0003_multi_currency.sql
-- Fase 7 — Soporte multi-moneda con base CLP.
-- Ejecutar COMPLETO en el SQL Editor de Supabase. PostgreSQL tiene DDL
-- transaccional: si una guarda falla, revierte TODO (columnas incluidas) y la
-- base queda exactamente como estaba. No hay estado intermedio posible.
--
-- PRERREQUISITO: `USDCLP=X` backfilleado en price_cache cubriendo el rango de
-- snapshot_date. La Guarda B lo verifica.

-- 1. Costos de transacción desglosados (comisión + IVA del comprobante Zesty).
alter table transactions add column commission numeric not null default 0 check (commission >= 0);
alter table transactions add column iva        numeric not null default 0 check (iva >= 0);

-- Histórico: antes de esta fase no había IVA, todo el `fees` era comisión.
-- Esto hace que el invariante se cumpla universalmente y permita el CHECK.
update transactions set commission = fees, iva = 0;

alter table transactions add constraint fees_breakdown check (fees = commission + iva);

-- 2. Moneda del snapshot: nullable primero, el bloque de abajo la rellena.
alter table snapshots add column currency text;

-- 3. Guardas + conversión del histórico, atómico.
do $$
declare
  mixed_assets int;
  missing_fx   int;
begin
  -- Guarda A: el histórico debe ser USD puro. Si ya hubiera un activo en otra
  -- moneda dentro del rango, multiplicar el total en bloque falsearía el
  -- patrimonio histórico.
  select count(*) into mixed_assets
  from assets a
  where a.currency <> 'USD'
    and exists (select 1 from transactions t
                where t.asset_id = a.id
                  and t.executed_at <= (select max(snapshot_date) from snapshots));

  if mixed_assets > 0 then
    raise exception
      'Abortado: % activo(s) no-USD con transacciones dentro del rango de snapshots. '
      'El histórico no es USD puro; convertirlo en bloque falsearía el patrimonio.', mixed_assets;
  end if;

  -- Guarda B: debe existir FX para cada snapshot a convertir.
  select count(*) into missing_fx
  from snapshots s
  where s.currency is null
    and not exists (select 1 from price_cache pc
                    where pc.ticker = 'USDCLP=X' and pc.price_date <= s.snapshot_date);

  if missing_fx > 0 then
    raise exception
      'Abortado: % snapshot(s) sin USDCLP=X disponible a su fecha. '
      'Ejecuta primero el backfill de precios en /data-sources.', missing_fx;
  end if;

  -- Conversión idempotente: solo filas sin moneda, marcadas al convertirlas.
  -- Correrlo dos veces no puede doble-convertir. Forward-fill del FX vía
  -- `order by price_date desc limit 1` (cubre snapshots de fin de semana).
  update snapshots s
  set total_value = s.total_value * (
        select pc.price from price_cache pc
        where pc.ticker = 'USDCLP=X' and pc.price_date <= s.snapshot_date
        order by pc.price_date desc limit 1),
      currency = 'CLP'
  where s.currency is null;
end $$;

-- 4. Cierre: a partir de aquí todo snapshot nace autodescriptivo.
alter table snapshots alter column currency set default 'CLP';
alter table snapshots alter column currency set not null;
```

- [ ] **Step 2: Ejecutar el backfill de precios**

Arranca la app (`npm run dev`), entra a [http://localhost:3000/data-sources](http://localhost:3000/data-sources) y pulsa **Backfill**.
Expected: el resultado incluye la fuente `yahoo` con `ok: true`. Verifica en el SQL Editor:

```sql
select count(*), min(price_date), max(price_date) from price_cache where ticker = 'USDCLP=X';
```
Expected: count > 0 y `min(price_date)` anterior al snapshot más antiguo.

- [ ] **Step 3: Ejecutar la migración**

Pega el archivo completo en el SQL Editor de Supabase y ejecútalo.
Expected: `Success. No rows returned`. Si aparece `Abortado: …`, lee el mensaje — nada se modificó y la base quedó intacta.

- [ ] **Step 4: Verificar el resultado**

```sql
select snapshot_date, total_value, currency from snapshots order by snapshot_date desc limit 5;
select fees, commission, iva from transactions limit 5;
```
Expected: `currency = 'CLP'` en todos los snapshots, `total_value` ~950x mayor que antes, y `fees = commission + iva` en todas las transacciones.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0003_multi_currency.sql
git commit -m "$(cat <<'EOF'
feat(db): migración 0003 — commission/iva y snapshots.currency

Guardas A y B dentro de un bloque DO con RAISE EXCEPTION: si una precondición
falla, el DDL transaccional revierte la migración completa.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `transactionInputSchema` con comisión e IVA

**Files:**
- Modify: `src/lib/validation/schemas.ts:24-32`
- Test: `src/lib/validation/schemas.test.ts`

- [ ] **Step 1: Añadir los tests que fallan a `src/lib/validation/schemas.test.ts`**

```typescript
describe('transactionInputSchema — comisión e IVA', () => {
  const base = {
    assetId: '11111111-1111-4111-8111-111111111111',
    side: 'buy',
    quantity: '244',
    price: '79.68',
    executedAt: '2026-08-05',
  }

  it('acepta comisión e IVA como strings de formulario', () => {
    const r = transactionInputSchema.parse({ ...base, commission: '29', iva: '6' })
    expect(r.commission).toBe(29)
    expect(r.iva).toBe(6)
  })

  it('ambos por defecto 0 cuando no vienen', () => {
    const r = transactionInputSchema.parse(base)
    expect(r.commission).toBe(0)
    expect(r.iva).toBe(0)
  })

  it('rechaza comisión negativa', () => {
    expect(transactionInputSchema.safeParse({ ...base, commission: '-1' }).success).toBe(false)
  })

  it('rechaza IVA negativo', () => {
    expect(transactionInputSchema.safeParse({ ...base, iva: '-1' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run src/lib/validation/schemas.test.ts`
Expected: FAIL — `r.commission` es `undefined`

- [ ] **Step 3: Reemplazar `transactionInputSchema` en `src/lib/validation/schemas.ts`**

```typescript
// `fees` no se recibe del cliente: la ruta lo deriva como commission + iva,
// que es el invariante que el CHECK `fees_breakdown` garantiza en la BD.
// No se valida que el IVA sea exactamente 19% de la comisión: los brokers
// redondean (Zesty cobra 6 sobre 5,51) y difieren entre sí.
export const transactionInputSchema = z.object({
  assetId: z.string().uuid(),
  side: z.enum(['buy', 'sell']),
  quantity: z.coerce.number().positive(),
  price: z.coerce.number().nonnegative(),
  commission: z.coerce.number().nonnegative().default(0),
  iva: z.coerce.number().nonnegative().default(0),
  executedAt: z.string().regex(DATE_RE, 'formato esperado YYYY-MM-DD'),
})
export type TransactionInput = z.infer<typeof transactionInputSchema>
```

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run src/lib/validation/schemas.test.ts`
Expected: PASS. Si algún test previo usaba `fees`, actualízalo a `commission`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation/schemas.ts src/lib/validation/schemas.test.ts
git commit -m "$(cat <<'EOF'
feat(validation): transactionInputSchema con commission e iva

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Ruta de transacciones — derivar `fees`

**Files:**
- Modify: `src/app/api/transactions/route.ts:13-18,32-50`

- [ ] **Step 1: Ampliar el `select` del GET (línea 15)**

```typescript
    .select('id, asset_id, side, quantity, price, fees, commission, iva, executed_at, assets(ticker, currency)')
```

- [ ] **Step 2: Derivar `fees` en el POST**

Reemplaza la línea 32:

```typescript
  const { assetId, side, quantity, price, fees, executedAt } = parsed.data
```

por:

```typescript
  const { assetId, side, quantity, price, commission, iva, executedAt } = parsed.data
  // Invariante del esquema (CHECK `fees_breakdown`): fees es el total.
  const fees = commission + iva
```

Y en el `.insert({...})` (líneas 40-48) añade las dos columnas nuevas:

```typescript
    .insert({
      user_id: user.id,
      asset_id: assetId,
      side,
      quantity,
      price,
      fees,
      commission,
      iva,
      executed_at: executedAt,
    })
```

- [ ] **Step 3: Verificar lint y build**

Run: `npm run lint && npm run build`
Expected: sin errores

- [ ] **Step 4: Commit**

```bash
git add src/app/api/transactions/route.ts
git commit -m "$(cat <<'EOF'
feat(api): transactions deriva fees = commission + iva

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Fix — las comisiones de venta dejan de evaporarse

**Files:**
- Modify: `src/lib/portfolio/holdings.ts:34-43`
- Test: `src/lib/portfolio/holdings.test.ts`

- [ ] **Step 1: Añadir el test que falla a `src/lib/portfolio/holdings.test.ts`**

```typescript
describe('comisiones de venta (Decisión 14)', () => {
  it('capitaliza los fees de venta en el costo de la posición restante', () => {
    const [h] = computeHoldings([
      { assetId: 'a', ticker: 'AAPL', side: 'buy', quantity: 10, price: 100, fees: 5, executedAt: '2026-01-05' },
      { assetId: 'a', ticker: 'AAPL', side: 'sell', quantity: 5, price: 120, fees: 3, executedAt: '2026-01-06' },
    ])
    // Compra: costBasis = 10*100 + 5 = 1005, avgCost = 100.5
    // Venta:  1005 − 5*100.5 + 3 = 505.5 sobre 5 acciones → avgCost 101.1
    expect(h.quantity).toBe(5)
    expect(h.costBasis).toBeCloseTo(505.5, 10)
    expect(h.avgCost).toBeCloseTo(101.1, 10)
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run src/lib/portfolio/holdings.test.ts`
Expected: FAIL — `expected 502.5 to be close to 505.5`

- [ ] **Step 3: Modificar el bloque `else` de `computeHoldings` (líneas 37-41)**

```typescript
    } else {
      const sellQty = Math.min(tx.quantity, h.quantity)
      h.costBasis -= sellQty * h.avgCost
      // La comisión de venta es un costo real de la operación: se capitaliza en
      // la posición restante, igual que las comisiones de compra. Antes se
      // descartaba en silencio.
      // Limitación conocida: en una venta TOTAL la posición se filtra al final
      // (quantity = 0) y el fee no queda registrado en ningún lado — este modelo
      // solo sigue posiciones abiertas, no P&L realizado.
      h.costBasis += tx.fees
      h.quantity -= sellQty
    }
```

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run src/lib/portfolio/`
Expected: PASS. Si algún test previo de venta asumía que los fees se descartaban, actualiza su valor esperado sumando el fee.

- [ ] **Step 5: Commit**

```bash
git add src/lib/portfolio/holdings.ts src/lib/portfolio/holdings.test.ts
git commit -m "$(cat <<'EOF'
fix(portfolio): las comisiones de venta ya no se descartan

Se capitalizan en la posición restante, igual que las de compra.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: `PositionView` con moneda y precio nativos

**Files:**
- Modify: `src/lib/portfolio/valuation.ts:1-34`
- Test: `src/lib/portfolio/valuation.test.ts`

El tercer parámetro es opcional para que `computeSnapshotValue` y los tests existentes sigan compilando sin cambios.

- [ ] **Step 1: Añadir los tests que fallan a `src/lib/portfolio/valuation.test.ts`**

```typescript
describe('presentación en moneda nativa', () => {
  const holdings = [{ assetId: 'a', ticker: 'ENELCHILE.SN', quantity: 244, costBasis: 19477, avgCost: 79.82 }]

  it('expone moneda y precio nativos junto al valor en base', () => {
    const [p] = valuePositions(holdings, [{ ticker: 'ENELCHILE.SN', price: 80 }], new Map([
      ['ENELCHILE.SN', { currency: 'CLP', price: 80 }],
    ]))
    expect(p.nativeCurrency).toBe('CLP')
    expect(p.nativePrice).toBe(80)
    expect(p.marketValue).toBe(19520)
  })

  it('sin mapa nativo, cae a la moneda base y al precio en base', () => {
    const [p] = valuePositions(holdings, [{ ticker: 'ENELCHILE.SN', price: 80 }])
    expect(p.nativeCurrency).toBe('CLP')
    expect(p.nativePrice).toBe(80)
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run src/lib/portfolio/valuation.test.ts`
Expected: FAIL — `p.nativeCurrency` es `undefined`

- [ ] **Step 3: Modificar `src/lib/portfolio/valuation.ts`**

Añade el import en la línea 2 y reemplaza `PositionView` y `valuePositions`:

```typescript
// src/lib/portfolio/valuation.ts
import type { Holding } from '@/lib/portfolio/holdings'
import { BASE_CURRENCY } from '@/lib/fx/constants'

export interface Quote {
  ticker: string
  price: number // en moneda BASE (ya convertido en la frontera)
}

// Precio tal como lo publica el mercado de origen, para mostrarlo sin traducir.
export interface NativeQuote {
  currency: string
  price: number | null
}

export interface PositionView extends Holding {
  // Todos estos campos están en moneda BASE: reciben holdings y quotes ya
  // convertidos por el módulo fx (Decisión 2).
  currentPrice: number | null
  marketValue: number | null
  unrealizedPnl: number | null
  unrealizedPnlPct: number | null
  // Solo para presentación: el precio que el usuario ve en su broker.
  nativeCurrency: string
  nativePrice: number | null
}

export function valuePositions(
  holdings: Holding[],
  quotes: Quote[],
  native: Map<string, NativeQuote> = new Map()
): PositionView[] {
  const priceMap = new Map(quotes.map((q) => [q.ticker, q.price]))
  return holdings.map((h) => {
    const price = priceMap.get(h.ticker) ?? null
    const marketValue = price !== null ? h.quantity * price : null
    const unrealizedPnl = marketValue !== null ? marketValue - h.costBasis : null
    const unrealizedPnlPct =
      unrealizedPnl !== null && h.costBasis > 0 ? (unrealizedPnl / h.costBasis) * 100 : null
    const n = native.get(h.ticker)
    return {
      ...h,
      currentPrice: price,
      marketValue,
      unrealizedPnl,
      unrealizedPnlPct,
      nativeCurrency: n?.currency ?? BASE_CURRENCY,
      nativePrice: n?.price ?? price,
    }
  })
}
```

`portfolioTotals` no cambia: sigue operando sobre una sola moneda.

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run src/lib/portfolio/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/portfolio/valuation.ts src/lib/portfolio/valuation.test.ts
git commit -m "$(cat <<'EOF'
feat(portfolio): PositionView expone nativeCurrency y nativePrice

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Cablear la frontera en `/api/positions`

**Files:**
- Modify: `src/app/api/positions/route.ts`

- [ ] **Step 1: Añadir imports tras la línea 6**

```typescript
import { loadFxSeries } from '@/lib/fx/load'
import { fxAsOf, transactionsToBaseCurrency } from '@/lib/fx/convert'
import { BASE_CURRENCY } from '@/lib/fx/constants'
import type { NativeQuote } from '@/lib/portfolio/valuation'
```

- [ ] **Step 2: Ampliar el select de transacciones (línea 17)**

```typescript
    .select('asset_id, side, quantity, price, fees, executed_at, assets(ticker, currency)')
```

- [ ] **Step 3: Cargar el FX junto al resto (reemplaza el bloque `try` de las líneas 30-42)**

```typescript
  let txRes: Awaited<typeof txPromise>
  let priceRows: PriceCacheRow[]
  let fxSeries: Awaited<ReturnType<typeof loadFxSeries>>
  try {
    ;[txRes, priceRows, fxSeries] = await Promise.all([
      txPromise,
      fetchAllRows<PriceCacheRow>((from, to) =>
        supabase
          .from('price_cache')
          .select('ticker, price, price_date')
          .order('price_date', { ascending: false })
          .order('ticker', { ascending: true })
          .order('source', { ascending: true })
          .range(from, to),
      ),
      loadFxSeries(supabase),
    ])
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'price_cache error' }, { status: 500 })
  }
```

- [ ] **Step 4: Construir el mapa de monedas junto a las transacciones (tras la línea 57)**

```typescript
  const currencyByTicker = new Map<string, string>()
  for (const row of (txRes.data ?? []) as any[]) {
    if (row.assets?.ticker) currencyByTicker.set(row.assets.ticker, row.assets.currency ?? 'USD')
  }
```

Este bloque va **dentro** del `/* eslint-disable @typescript-eslint/no-explicit-any */` existente (líneas 48-58), junto al `.map()` de transacciones.

- [ ] **Step 5: Convertir y valorizar (reemplaza las líneas 69-78)**

```typescript
  // Frontera: precios y transacciones pasan a CLP antes de tocar el dominio.
  // El valor de mercado usa el FX de hoy; el costo, el FX de cada compra
  // (Decisión 4) — de eso se encarga transactionsToBaseCurrency.
  const today = new Date().toISOString().slice(0, 10)
  const fxToday = fxAsOf(fxSeries, today)
  const toBase = (ticker: string, nativePrice: number): number | null => {
    if ((currencyByTicker.get(ticker) ?? 'USD') === BASE_CURRENCY) return nativePrice
    return fxToday !== null ? nativePrice * fxToday : null
  }

  let baseTransactions: Transaction[]
  try {
    baseTransactions = transactionsToBaseCurrency(transactions, currencyByTicker, fxSeries)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error de conversión' }, { status: 500 })
  }

  const holdings = computeHoldings(baseTransactions)

  const quotes: { ticker: string; price: number }[] = []
  const native = new Map<string, NativeQuote>()
  for (const [ticker, nativePrice] of latest) {
    native.set(ticker, { currency: currencyByTicker.get(ticker) ?? 'USD', price: nativePrice })
    const basePrice = toBase(ticker, nativePrice)
    if (basePrice !== null) quotes.push({ ticker, price: basePrice })
  }

  const positions = valuePositions(holdings, quotes, native)
  const totals = portfolioTotals(positions)

  // P&L del día en base: ambos extremos convertidos con el MISMO FX, así que
  // mide movimiento de precio, no ruido cambiario intradía.
  const dailyPnl = positions.reduce((sum, pos) => {
    const last = latest.get(pos.ticker)
    const prev = previous.get(pos.ticker)
    if (last === undefined || prev === undefined) return sum
    const lastBase = toBase(pos.ticker, last)
    const prevBase = toBase(pos.ticker, prev)
    if (lastBase === null || prevBase === null) return sum
    return sum + pos.quantity * (lastBase - prevBase)
  }, 0)
```

- [ ] **Step 6: Devolver también la moneda base (línea 80)**

```typescript
  return NextResponse.json({ positions, totals: { ...totals, dailyPnl }, baseCurrency: BASE_CURRENCY })
```

- [ ] **Step 7: Verificar lint y build**

Run: `npm run lint && npm run build`
Expected: sin errores

- [ ] **Step 8: Commit**

```bash
git add src/app/api/positions/route.ts
git commit -m "$(cat <<'EOF'
feat(api): /api/positions valoriza en CLP

Precios al FX de hoy, cost basis al FX de cada compra.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Cablear la frontera en `/api/analytics`

**Files:**
- Modify: `src/app/api/analytics/route.ts`

- [ ] **Step 1: Añadir imports tras la línea 14**

```typescript
import { loadFxSeries } from '@/lib/fx/load'
import { toBaseCurrency, convertSeries, transactionsToBaseCurrency } from '@/lib/fx/convert'
import { FX_TICKER } from '@/lib/fx/constants'
```

- [ ] **Step 2: Ampliar el select (línea 35)**

```typescript
    .select('asset_id, side, quantity, price, fees, executed_at, assets(ticker, asset_type, currency)')
```

- [ ] **Step 3: Construir el mapa de monedas (tras la línea 51, dentro del bloque eslint-disable)**

```typescript
  const currencyByTicker = new Map<string, string>()
  for (const row of (txRows ?? []) as any[]) {
    if (row.assets?.ticker) currencyByTicker.set(row.assets.ticker, row.assets.currency ?? 'USD')
  }
```

- [ ] **Step 4: Renombrar `downloadBenchmark` → `downloadSeries` y garantizar el histórico del FX**

Renombra la función de la línea 136 (`async function downloadBenchmark(`) a `downloadSeries(`, ya que ahora también descarga el FX.

Después del bloque `if (preset) { … } else { … }` (líneas 59-70), añade:

```typescript
  // El FX es un ticker más: si no hay historia, se descarga como el benchmark.
  try {
    if ((await countBenchmarkRows(supabase, FX_TICKER)) < 2) {
      await downloadSeries(supabase, FX_TICKER, 'etf') // 'etf' lo enruta a Yahoo
    }
  } catch (e) {
    benchmarkError = benchmarkError ?? (e instanceof Error ? e.message : 'FX no disponible')
  }
```

Y actualiza la llamada de la línea 63 a `await downloadSeries(supabase, preset.ticker, preset.assetType)`.

- [ ] **Step 5: Convertir antes de llamar al motor (reemplaza las líneas 113-121)**

```typescript
  // Frontera: todo pasa a CLP antes del motor, que permanece agnóstico.
  const fxSeries = await loadFxSeries(supabase)
  let baseTransactions
  try {
    baseTransactions = transactionsToBaseCurrency(transactions, currencyByTicker, fxSeries)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error de conversión' }, { status: 500 })
  }

  const result = computeAnalytics({
    transactions: baseTransactions,
    priceSeries: toBaseCurrency(priceSeries, currencyByTicker, fxSeries),
    // Los benchmarks del preset (SPY, BTC) cotizan en USD. Compararlos sin
    // convertir contra una cartera en CLP no significaría nada.
    benchmarkSeries: benchmarkSeries ? convertSeries(benchmarkSeries, 'USD', fxSeries) : null,
    benchmarkTicker,
    assetTypeByTicker,
    period,
    today,
  })
```

- [ ] **Step 6: Verificar lint y build**

Run: `npm run lint && npm run build`
Expected: sin errores

- [ ] **Step 7: Commit**

```bash
git add src/app/api/analytics/route.ts
git commit -m "$(cat <<'EOF'
feat(api): /api/analytics en base CLP, benchmark incluido

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Cablear la frontera en `/api/backtest`

**Files:**
- Modify: `src/app/api/backtest/route.ts`

- [ ] **Step 1: Añadir imports tras la línea 14**

```typescript
import { loadFxSeries } from '@/lib/fx/load'
import { toBaseCurrency, convertSeries } from '@/lib/fx/convert'
import { FX_TICKER } from '@/lib/fx/constants'
```

- [ ] **Step 2: Ampliar el select (línea 35) y construir el mapa de monedas**

```typescript
    .select('asset_id, side, quantity, price, fees, executed_at, assets(ticker, asset_type, currency)')
```

Tras la línea 51, dentro del bloque eslint-disable:

```typescript
  const currencyByTicker = new Map<string, string>()
  for (const row of (txRows ?? []) as any[]) {
    if (row.assets?.ticker) currencyByTicker.set(row.assets.ticker, row.assets.currency ?? 'USD')
  }
```

- [ ] **Step 3: Incluir el FX en `ensureHistory` (líneas 62-65)**

```typescript
  const refs: AssetRef[] = [
    ...holdings.map((h) => ({ ticker: h.ticker, asset_type: (assetTypeByTicker.get(h.ticker) ?? 'stock') as AssetRef['asset_type'] })),
    { ticker: BENCHMARK_TICKER, asset_type: 'etf' },
    // El backtest necesita FX diario cubriendo todo el período, igual que los precios.
    { ticker: FX_TICKER, asset_type: 'etf' },
  ]
```

- [ ] **Step 4: Convertir antes del motor (reemplaza las líneas 108-116)**

```typescript
  // Frontera: series en CLP; el motor de backtest no cambia.
  const fxSeries = await loadFxSeries(supabase, config.from)
  try {
    const result = runBacktest({
      config,
      priceSeries: toBaseCurrency(priceSeries, currencyByTicker, fxSeries),
      benchmarkSeries: benchmarkSeries ? convertSeries(benchmarkSeries, 'USD', fxSeries) : null,
      benchmarkTicker: BENCHMARK_TICKER,
      stockEtfTickers,
      cryptoTickers,
    })
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'fallo en el backtest' }, { status: 400 })
  }
```

`config.initialCapital` pasa a interpretarse en CLP; la UI lo etiqueta en la Task 22.

- [ ] **Step 5: Verificar lint y build**

Run: `npm run lint && npm run build`
Expected: sin errores

- [ ] **Step 6: Commit**

```bash
git add src/app/api/backtest/route.ts
git commit -m "$(cat <<'EOF'
feat(api): /api/backtest en base CLP (capital inicial y benchmark)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Cablear la frontera en `/api/scenarios`

**Files:**
- Modify: `src/app/api/scenarios/route.ts`

- [ ] **Step 1: Añadir imports tras la línea 9**

```typescript
import { loadFxSeries } from '@/lib/fx/load'
import { toBaseCurrency, convertSeries, fxAsOf } from '@/lib/fx/convert'
import { BASE_CURRENCY } from '@/lib/fx/constants'
```

- [ ] **Step 2: Ampliar el select (línea 26) y construir el mapa de monedas**

```typescript
    .select('asset_id, side, quantity, price, fees, executed_at, assets(ticker, asset_type, currency)')
```

Tras la línea 42, dentro del bloque eslint-disable:

```typescript
  const currencyByTicker = new Map<string, string>()
  for (const row of (txRows ?? []) as any[]) {
    if (row.assets?.ticker) currencyByTicker.set(row.assets.ticker, row.assets.currency ?? 'USD')
  }
```

- [ ] **Step 3: Convertir series y precios actuales (reemplaza las líneas 84-107)**

```typescript
  const fxSeries = await loadFxSeries(supabase, lookbackFrom)
  const priceSeries: PriceSeriesByTicker = new Map()
  for (const t of portfolioTickers) priceSeries.set(t, byTicker.get(t) ?? [])
  const benchmarkSeries = byTicker.get(BENCHMARK_TICKER) ?? null

  // El resultado se expresa en CLP, así que el precio actual también.
  // El shock se aplica sobre retornos ya en CLP con el FX FIJO (Decisión 11).
  const today = new Date().toISOString().slice(0, 10)
  const fxToday = fxAsOf(fxSeries, today)
  const scenarioHoldings: ScenarioHolding[] = holdings.map((h) => {
    const series = byTicker.get(h.ticker) ?? []
    const nativePrice = series.length ? series[series.length - 1].price : null
    const currency = currencyByTicker.get(h.ticker) ?? 'USD'
    const currentPrice =
      nativePrice === null ? null : currency === BASE_CURRENCY ? nativePrice : fxToday !== null ? nativePrice * fxToday : null
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
      priceSeries: toBaseCurrency(priceSeries, currencyByTicker, fxSeries),
      benchmarkSeries: benchmarkSeries ? convertSeries(benchmarkSeries, 'USD', fxSeries) : null,
      benchmarkTicker: BENCHMARK_TICKER,
    })
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'fallo en el escenario' }, { status: 400 })
  }
```

- [ ] **Step 4: Verificar lint y build**

Run: `npm run lint && npm run build`
Expected: sin errores

- [ ] **Step 5: Commit**

```bash
git add src/app/api/scenarios/route.ts
git commit -m "$(cat <<'EOF'
feat(api): /api/scenarios en base CLP con FX fijo

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Snapshots en CLP

**Files:**
- Modify: `src/app/api/prices/refresh/route.ts:43,63-95`

- [ ] **Step 1: Añadir imports**

```typescript
import { loadFxSeries } from '@/lib/fx/load'
import { fxAsOf, transactionsToBaseCurrency } from '@/lib/fx/convert'
import { BASE_CURRENCY } from '@/lib/fx/constants'
```

- [ ] **Step 2: Reemplazar `takeSnapshot` completa (líneas 63-96)**

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
async function takeSnapshot(supabase: any, userId: string, quotes: { ticker: string; price: number }[]) {
  const { data: txRows, error } = await supabase
    .from('transactions')
    .select('asset_id, side, quantity, price, fees, executed_at, assets(ticker, currency)')
  if (error) {
    console.error('snapshot: no se pudieron leer transactions:', error.message)
    return null
  }
  const transactions: Transaction[] = (txRows ?? []).map((row: any) => ({
    assetId: row.asset_id,
    ticker: row.assets?.ticker ?? '',
    side: row.side,
    quantity: Number(row.quantity),
    price: Number(row.price),
    fees: Number(row.fees),
    executedAt: row.executed_at,
  }))
  const currencyByTicker = new Map<string, string>()
  for (const row of (txRows ?? []) as any[]) {
    if (row.assets?.ticker) currencyByTicker.set(row.assets.ticker, row.assets.currency ?? 'USD')
  }
  if (computeHoldings(transactions).length === 0) return null

  // El snapshot se guarda en moneda BASE y con la moneda explícita, para que el
  // histórico sea autodescriptivo y no vuelva a necesitar una migración.
  const today = new Date().toISOString().slice(0, 10)
  let totalValue: number
  try {
    const fxSeries = await loadFxSeries(supabase)
    const fxToday = fxAsOf(fxSeries, today)
    const baseQuotes = quotes.flatMap((q) => {
      const currency = currencyByTicker.get(q.ticker) ?? 'USD'
      if (currency === BASE_CURRENCY) return [q]
      return fxToday !== null ? [{ ticker: q.ticker, price: q.price * fxToday }] : []
    })
    totalValue = computeSnapshotValue(
      transactionsToBaseCurrency(transactions, currencyByTicker, fxSeries),
      baseQuotes
    )
  } catch (e) {
    console.error('snapshot: conversión a', BASE_CURRENCY, 'falló:', e instanceof Error ? e.message : e)
    return null
  }

  const { error: snapErr } = await supabase
    .from('snapshots')
    .upsert(
      { user_id: userId, snapshot_date: today, total_value: totalValue, currency: BASE_CURRENCY },
      { onConflict: 'user_id,snapshot_date' }
    )
  if (snapErr) {
    console.error('snapshot: no se pudo guardar:', snapErr.message)
    return null
  }
  return totalValue
}
/* eslint-enable @typescript-eslint/no-explicit-any */
```

- [ ] **Step 3: Verificar lint y build**

Run: `npm run lint && npm run build`
Expected: sin errores

- [ ] **Step 4: Commit**

```bash
git add src/app/api/prices/refresh/route.ts
git commit -m "$(cat <<'EOF'
feat(api): snapshots en CLP con la moneda explícita

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: UI de Portafolio — moneda automática y desglose de costos

**Files:**
- Modify: `src/app/(app)/portfolio/page.tsx`

- [ ] **Step 1: Añadir import y estado del formulario**

Tras la línea 4:

```typescript
import { IVA_RATE } from '@/lib/fx/constants'
```

Amplía la interfaz `Tx` (líneas 14-23) con las dos columnas nuevas:

```typescript
interface Tx {
  id: string
  asset_id: string
  side: 'buy' | 'sell'
  quantity: number
  price: number
  fees: number
  commission: number
  iva: number
  executed_at: string
  assets: { ticker: string; currency: string } | null
}
```

Dentro de `PortfolioPage`, junto a los otros `useState` (línea 33):

```typescript
  const [txAssetId, setTxAssetId] = useState('')
  const [commission, setCommission] = useState('')
  const [iva, setIva] = useState('')
```

- [ ] **Step 2: Autocompletar la moneda por sufijo `.SN` en el formulario de activo**

Reemplaza el input de moneda (línea 101) por una versión controlada por el ticker:

```typescript
          <input
            name="currency"
            placeholder="Moneda (USD)"
            maxLength={3}
            defaultValue=""
            className={inputCls}
            ref={(el) => {
              currencyRef.current = el
            }}
          />
```

Y el input de ticker (línea 92):

```typescript
          <input
            name="ticker"
            placeholder="Ticker (AAPL o ENELCHILE.SN)"
            required
            className={inputCls}
            onChange={(e) => {
              // La Bolsa de Santiago usa el sufijo .SN en Yahoo y cotiza en pesos.
              // Sugerencia, no imposición: el campo sigue siendo editable.
              const el = currencyRef.current
              if (el && !el.value) {
                if (e.target.value.trim().toUpperCase().endsWith('.SN')) el.value = 'CLP'
              }
            }}
          />
```

Declara la ref junto a los `useState`:

```typescript
  const currencyRef = useRef<HTMLInputElement | null>(null)
```

Y añade `useRef` al import de React de la línea 4:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react'
```

- [ ] **Step 3: Reemplazar el campo `fees` por Comisión + IVA en el formulario de transacción**

Reemplaza el `onSubmit` (líneas 131-144) para enviar los campos nuevos:

```typescript
          onSubmit={async (e) => {
            e.preventDefault()
            const form = e.currentTarget
            const fd = new FormData(form)
            const ok = await post('/api/transactions', {
              assetId: fd.get('assetId'),
              side: fd.get('side'),
              quantity: fd.get('quantity'),
              price: fd.get('price'),
              commission: commission || 0,
              iva: iva || 0,
              executedAt: fd.get('executedAt'),
            })
            if (ok) {
              form.reset()
              setCommission('')
              setIva('')
              setTxAssetId('')
            }
          }}
```

Haz el `select` de activo controlado (línea 146):

```typescript
          <select
            name="assetId"
            required
            className={inputCls}
            value={txAssetId}
            onChange={(e) => setTxAssetId(e.target.value)}
          >
```

Reemplaza el input de comisión (línea 158) por los dos campos:

```typescript
          <input
            name="commission"
            type="number"
            step="any"
            min="0"
            placeholder="Comisión"
            className={inputCls}
            value={commission}
            onChange={(e) => {
              const v = e.target.value
              setCommission(v)
              // Autocálculo del IVA (19% sobre la comisión), redondeado según la
              // moneda: Zesty cobra en pesos enteros (19% de 29 = 5,51 → 6).
              const n = Number(v)
              if (v.trim() === '' || !Number.isFinite(n)) {
                setIva('')
                return
              }
              const isClp =
                assets.find((a) => a.id === txAssetId)?.currency?.toUpperCase() === 'CLP'
              const raw = n * IVA_RATE
              setIva(String(isClp ? Math.round(raw) : Math.round(raw * 100) / 100))
            }}
          />
          <input
            name="iva"
            type="number"
            step="any"
            min="0"
            placeholder="IVA"
            title="Autocalculado como 19% de la comisión; editable porque el broker redondea"
            className={inputCls}
            value={iva}
            onChange={(e) => setIva(e.target.value)}
          />
```

- [ ] **Step 4: Mostrar el desglose y la moneda en la tabla**

Reemplaza la cabecera de comisión (línea 170) por dos columnas:

```typescript
              <th className="text-right">Comisión</th>
              <th className="text-right">IVA</th>
```

Reemplaza la celda de precio y la de fees (líneas 183-184):

```typescript
                <td className="text-right">
                  {Number(t.price).toLocaleString('es-CL')}{' '}
                  <span className="text-xs text-slate-500">{t.assets?.currency ?? ''}</span>
                </td>
                <td className="text-right">{Number(t.commission ?? 0).toLocaleString('es-CL')}</td>
                <td className="text-right">{Number(t.iva ?? 0).toLocaleString('es-CL')}</td>
```

Y actualiza el `colSpan` de la fila vacía (línea 197) de `7` a `8`.

Actualiza también el texto de ayuda (líneas 126-128):

```typescript
        <p className="mb-3 text-xs text-slate-500">
          Registra una compra o venta: cantidad, <span className="text-slate-400">precio por unidad</span> y fecha,
          en la <span className="text-slate-400">moneda del activo</span>. El IVA se calcula solo (19% de la
          comisión) y puedes ajustarlo si el broker redondeó distinto.
        </p>
```

- [ ] **Step 5: Verificar lint y build**

Run: `npm run lint && npm run build`
Expected: sin errores

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/portfolio/page.tsx"
git commit -m "$(cat <<'EOF'
feat(ui): portafolio con moneda automática .SN y desglose comisión/IVA

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 20: UI de Dashboard — formato CLP y precio nativo

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Reemplazar el formateador local por `formatMoney`**

Añade tras la línea 19:

```typescript
import { formatMoney } from '@/lib/format/money'
import { BASE_CURRENCY } from '@/lib/fx/constants'
```

Reemplaza las líneas 50-51:

```typescript
const fmt = (n: number) => formatMoney(n, BASE_CURRENCY)
```

- [ ] **Step 2: Ampliar la interfaz `Position` (líneas 21-31)**

```typescript
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
  nativeCurrency: string
  nativePrice: number | null
}
```

- [ ] **Step 3: Mostrar precio nativo en la tabla de posiciones**

Reemplaza la celda de precio (línea 160):

```typescript
                  <td className="text-right">
                    {p.nativePrice === null
                      ? '—'
                      : formatMoney(p.nativePrice, p.nativeCurrency)}
                  </td>
```

Y la de costo promedio (línea 159), que está en base:

```typescript
                  <td className="text-right">{fmt(p.avgCost)}</td>
```

- [ ] **Step 4: Etiquetar las columnas con su moneda (líneas 146-151)**

```typescript
                <th className="py-2">Ticker</th>
                <th className="text-right">Cantidad</th>
                <th className="text-right">Costo prom. ({BASE_CURRENCY})</th>
                <th className="text-right">Precio</th>
                <th className="text-right">Valor ({BASE_CURRENCY})</th>
                <th className="text-right">P&L ({BASE_CURRENCY})</th>
```

- [ ] **Step 5: Verificar lint y build**

Run: `npm run lint && npm run build`
Expected: sin errores

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/dashboard/page.tsx"
git commit -m "$(cat <<'EOF'
feat(ui): dashboard en CLP con precio en moneda nativa por posición

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 21: UI de Analytics — benchmark etiquetado en CLP

**Files:**
- Modify: `src/app/(app)/analytics/page.tsx`

- [ ] **Step 1: Usar `formatMoney`**

Añade tras la línea 17:

```typescript
import { formatMoney } from '@/lib/format/money'
import { BASE_CURRENCY } from '@/lib/fx/constants'
```

Reemplaza las líneas 35-36:

```typescript
const usd = (n: number | null) => formatMoney(n, BASE_CURRENCY)
```

Renombra la constante a `money` en su declaración y en todos sus usos del archivo (`usd(` → `money(`), ya que ya no formatea dólares.

- [ ] **Step 2: Etiquetar el benchmark (línea 123)**

```typescript
            <MetricCard label={`Benchmark (TWR, en ${BASE_CURRENCY})`} value={pct(s.benchmarkTwr)} />
```

- [ ] **Step 3: Etiquetar la línea del gráfico (línea 149)**

```typescript
                  <Line type="monotone" dataKey="benchmark" name={`Benchmark (${BASE_CURRENCY})`} stroke="#22c55e" dot={false} />
```

- [ ] **Step 4: Verificar lint y build**

Run: `npm run lint && npm run build`
Expected: sin errores

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/analytics/page.tsx"
git commit -m "$(cat <<'EOF'
feat(ui): analytics etiqueta el benchmark como medido en CLP

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 22: UI de Backtest — capital inicial en CLP

**Files:**
- Modify: `src/app/(app)/backtest/page.tsx:169`

- [ ] **Step 1: Etiquetar el campo**

Añade el import tras la línea 15 (junto a los demás imports de la página):

```typescript
import { BASE_CURRENCY } from '@/lib/fx/constants'
```

Reemplaza la línea 169:

```typescript
            Capital inicial ({BASE_CURRENCY})
```

- [ ] **Step 2: Verificar lint y build**

Run: `npm run lint && npm run build`
Expected: sin errores

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/backtest/page.tsx"
git commit -m "$(cat <<'EOF'
feat(ui): backtest etiqueta el capital inicial en CLP

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 23: UI de Scenarios — formato CLP y supuesto de FX fijo

**Files:**
- Modify: `src/app/(app)/scenarios/page.tsx`

- [ ] **Step 1: Usar `formatMoney`**

Añade tras la línea 19 (junto a los demás imports):

```typescript
import { formatMoney } from '@/lib/format/money'
import { BASE_CURRENCY } from '@/lib/fx/constants'
```

Reemplaza las líneas 27-28:

```typescript
const money = (x: number | null) => formatMoney(x, BASE_CURRENCY)
```

- [ ] **Step 2: Mostrar el supuesto (Decisión 11) bajo el título de la página**

Inserta este bloque justo después del `<h1>` de la página:

```typescript
      <p className="rounded border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-400">
        Los shocks se aplican sobre retornos en {BASE_CURRENCY} con el{' '}
        <span className="text-slate-300">tipo de cambio fijo</span>. En la realidad, un selloff global
        suele fortalecer el dólar frente al peso y amortiguar parcialmente la caída de la porción en
        USD: el escenario que ves es, en ese sentido, conservador.
      </p>
```

- [ ] **Step 3: Verificar lint y build**

Run: `npm run lint && npm run build`
Expected: sin errores

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/scenarios/page.tsx"
git commit -m "$(cat <<'EOF'
feat(ui): scenarios en CLP con el supuesto de FX fijo visible

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 24: UI de Alertas — moneda nativa junto al umbral

**Files:**
- Modify: `src/app/(app)/alerts/page.tsx`

Los umbrales se interpretan en la moneda **nativa** del activo (Decisión 12): `ENELCHILE.SN > 85` son pesos, `AAPL > 250` son dólares. El motor no cambia; solo se explicita en pantalla.

- [ ] **Step 1: Reemplazar el formateador local (líneas 39-40)**

Añade el import tras la línea 5:

```typescript
import { formatMoney } from '@/lib/format/money'
```

Reemplaza las líneas 39-40:

```typescript
// Los precios de alertas son NATIVOS: `price_cache` guarda la moneda de origen
// (Decisión 6), así que un umbral de ENELCHILE.SN son pesos y uno de AAPL son
// dólares. Se formatean con la moneda del activo, nunca con la base.
const money = (x: number | null, currency: string) => formatMoney(x, currency)
```

- [ ] **Step 2: Ampliar la interfaz `Position` (líneas 11-14)**

```typescript
interface Position {
  ticker: string
  currentPrice: number | null
  nativePrice: number | null
  nativeCurrency: string
}
```

- [ ] **Step 3: Cambiar el shape del estado de precios (línea 44)**

```typescript
  const [pricesByTicker, setPricesByTicker] = useState<Record<string, { price: number; currency: string }>>({})
```

- [ ] **Step 4: Poblar el nuevo shape en `loadAll` (reemplaza las líneas 56-62)**

```typescript
    fetch('/api/positions')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { positions: Position[] } | null) => {
        const map: Record<string, { price: number; currency: string }> = {}
        for (const p of d?.positions ?? []) {
          if (p.nativePrice != null) map[p.ticker] = { price: p.nativePrice, currency: p.nativeCurrency }
        }
        setPricesByTicker(map)
      })
```

- [ ] **Step 5: Adaptar `reactivate` al nuevo shape (reemplaza las líneas 96-109)**

```typescript
  function reactivate(a: AlertView) {
    const quote = pricesByTicker[a.ticker]
    const holds =
      quote !== undefined &&
      ((a.alertType === 'price_above' && quote.price > a.threshold) ||
        (a.alertType === 'price_below' && quote.price < a.threshold))
    if (holds) {
      const ok = window.confirm(
        `El precio actual (${money(quote.price, quote.currency)}) ya cumple el umbral (${money(a.threshold, quote.currency)}); se volverá a disparar en la próxima evaluación. ¿Reactivar de todos modos?`
      )
      if (!ok) return
    }
    patchStatus(a.id, 'active')
  }
```

- [ ] **Step 6: Mostrar moneda en umbral y precio de la tabla (reemplaza las líneas 196-197)**

```typescript
                  <td className="px-4 text-right">
                    {a.alertType === 'pct_change'
                      ? `${a.threshold}%`
                      : money(a.threshold, pricesByTicker[a.ticker]?.currency ?? 'USD')}
                  </td>
                  <td className="px-4 text-right">
                    {pricesByTicker[a.ticker]
                      ? money(pricesByTicker[a.ticker].price, pricesByTicker[a.ticker].currency)
                      : '—'}
                  </td>
```

- [ ] **Step 7: Verificar lint y build**

Run: `npm run lint && npm run build`
Expected: sin errores

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/alerts/page.tsx"
git commit -m "$(cat <<'EOF'
feat(ui): alertas muestran la moneda nativa del umbral

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 25: Verificación final y documentación

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/ROADMAP.md`

- [ ] **Step 1: Suite completa**

Run: `npm test && npm run lint && npm run build`
Expected: todos los tests en verde, sin errores de lint, build exitoso.

- [ ] **Step 2: Verificación e2e manual**

Con `npm run dev` corriendo:

1. `/data-sources` → **Backfill** → verifica que aparece `USDCLP=X` en el listado de precios.
2. `/portfolio` → crea el activo `ENELCHILE.SN` (el campo Moneda debe autocompletarse a `CLP`).
3. `/portfolio` → registra la compra del comprobante: cantidad `244`, precio `79.68`, comisión `29` (el IVA debe autocompletarse a `6`), fecha `2026-08-05`.
4. `/dashboard` → el Valor Total debe estar en pesos (`$…`), la posición de ENELCHILE debe mostrar precio nativo en CLP, y cualquier activo en USD debe mostrar su precio en `US$` pero su valor en CLP.
5. `/analytics` → la tarjeta de benchmark debe decir "Benchmark (TWR, en CLP)".
6. `/scenarios` → debe verse el aviso del tipo de cambio fijo.
7. `/alerts` → crea una alerta sobre ENELCHILE.SN y verifica que el umbral se muestra con `$` (CLP).

- [ ] **Step 3: Actualizar el README**

En [README.md:5](../../../README.md), reemplaza la línea de estado:

```markdown
> **Estado:** MVP completo (6 fases) + **Fase 7 multi-moneda (base CLP)**. Tests, lint y build en verde. Roadmap, specs y planes de implementación en [docs/superpowers/](docs/superpowers/).
```

En la sección "Cómo correr", paso 2, reemplaza la línea de migraciones:

```markdown
   - En **SQL Editor**, ejecuta en orden el contenido de [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql), [`0002_price_cache_adj_close.sql`](supabase/migrations/0002_price_cache_adj_close.sql) y [`0003_multi_currency.sql`](supabase/migrations/0003_multi_currency.sql). La migración 0003 exige que `USDCLP=X` ya esté en `price_cache`: corre el **Backfill** en `/data-sources` antes (aborta sola si falta).
```

En la tabla de módulos, reemplaza la fila de Portfolio Manager:

```markdown
| Portfolio Manager | CRUD posiciones · transacciones (comisión + IVA) · snapshots · **multi-moneda base CLP** |
```

Y añade esta sección completa justo después de la sección "Tablas (Supabase / PostgreSQL)":

```markdown
## Multi-moneda (base CLP)

La cartera se consolida en **pesos chilenos**. Cada posición muestra su precio en su moneda nativa
(`ENELCHILE.SN` en CLP, `AAPL` en USD), pero el valor total, la distribución y toda la analítica
operan en CLP.

- **Valor de mercado** al tipo de cambio de hoy; **cost basis al tipo de cambio de la fecha de cada
  compra**, de modo que el P&L incluye el retorno cambiario real.
- El tipo de cambio `USDCLP=X` se cachea en `price_cache` como un ticker más (CLP por 1 USD).
- La conversión ocurre en la **frontera de datos**: los motores de analítica, backtest y escenarios
  reciben una sola moneda y son agnósticos a ella.
- **Calendarios:** el NAV y el Sharpe del portafolio usan la unión de días hábiles con forward-fill;
  la correlación usa intersección estricta, para que un feriado chileno no inyecte retornos 0.

Ver [spec de Fase 7](docs/superpowers/specs/2026-08-06-fase-7-multi-moneda-clp-design.md).
```

- [ ] **Step 4: Actualizar el ROADMAP**

En [docs/superpowers/plans/ROADMAP.md](ROADMAP.md), añade esta fila al final de la tabla (tras la fila de la Fase 6):

```markdown
| 7 | [2026-08-06-fase-7-multi-moneda-clp.md](2026-08-06-fase-7-multi-moneda-clp.md) ([spec](../specs/2026-08-06-fase-7-multi-moneda-clp-design.md)) | Soporte **multi-moneda con base CLP** (acciones chilenas vía Zesty): `USDCLP=X` cacheado en `price_cache`, módulo `src/lib/fx/` que normaliza en la **frontera de datos** (motores sin cambios), **cost basis al FX de la fecha de compra**, comisión + IVA desglosados, benchmark y backtest en CLP, migración del histórico de snapshots. **Volatilidad individual por activo** diferida (ver spec). | **Implementada** |
```

Y reemplaza la línea de dependencias:

```markdown
**Dependencias:** 2 depende de 1 · 3 depende de 2 (necesita históricos y snapshots) · 4 depende de 2 · 5 depende de 3 · 6 depende de 2 · 7 depende de 1, 2 y 3.
```

- [ ] **Step 5: Commit**

```bash
git add README.md docs/superpowers/plans/ROADMAP.md
git commit -m "$(cat <<'EOF'
docs: Fase 7 multi-moneda implementada (README + roadmap)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Notas de implementación

**Orden crítico:** la Task 9 (migración) debe ejecutarse en Supabase **antes** de las Tasks 11 y 18, que escriben en `commission`, `iva` y `snapshots.currency`. El backfill de `USDCLP=X` (Task 8) debe estar corrido antes de la migración, o la Guarda B aborta.

**Si un test de `holdings` o `valuation` ya existente falla** tras las Tasks 12-13: es esperado si asumía que los fees de venta se descartaban o que `PositionView` no tenía campos nativos. Actualiza el valor esperado; no revierta el cambio de dominio.

**Si `npm run build` falla con un error de tipos en `assets(...)`:** Supabase tipa los joins como array o como objeto según la relación. Los mapeos de este plan usan `as any` dentro de los bloques `eslint-disable` ya existentes en cada ruta, siguiendo el patrón establecido en las Fases 3-6.
