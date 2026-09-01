# Proyecto 3.1 — Contabilidad de caja · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada portafolio tenga un saldo líquido real: las ventas depositan, las compras retiran, los abonos y retiros de capital se registran, y el efectivo entra en el patrimonio y en los flujos de la analítica.

**Architecture:** El esquema ya está en pie (migración 0009, aplicada y verificada). Dos tablas guardan sólo lo que ninguna transacción registra —`cash_movements` y `fx_transfers`— y la vista `cash_ledger` proyecta la pata de caja de cada trade desde la propia transacción, así que no hay nada que sincronizar. El código se construye de adentro hacia afuera: primero los schemas y las rutas que escriben el libro, después la UI que lo carga, y sólo al final los dos consumidores que cambian de número (valorización y flujos). Ese orden deja el árbol compilando y los tests verdes después de **cada** tarea.

**Tech Stack:** Next.js 16 (App Router) · TypeScript · Zod 4 · Vitest 4 · Supabase (PostgREST + RLS) · Tailwind 4 · Recharts

**Spec:** [2026-08-31-proyecto-3-1-contabilidad-de-caja-design.md](../specs/2026-08-31-proyecto-3-1-contabilidad-de-caja-design.md)

---

## Contexto que el ingeniero necesita

**El proyecto es una app personal de gestión de portafolio**, con dos portafolios por usuario: `nacional` (mide en CLP) e `internacional` (mide en USD). Node ≥ 18.18, `npm install` ya corrido.

| Comando | Qué hace |
|---|---|
| `npm test` | Vitest, entorno `node` (sin jsdom: **no hay tests de componentes React**) |
| `npm run lint` | ESLint |
| `npm run build` | Build de producción — es el único chequeo de tipos de extremo a extremo |
| `npm run dev` | Dev server en :3000 |

**Línea base medida el 2026-09-01:** `npm test` → **32 archivos, 227 tests, todos verdes.** Cada tarea indica el conteo esperado después de ejecutarla. Si no coincide, algo se rompió — no seguir.

**Rama:** el trabajo va en `feat/contabilidad-de-caja`, que ya existe y ya contiene el spec y la migración 0009. Verificar con `git branch --show-current`.

**Alias de imports:** `@/` → `src/`. Dentro de `src/lib/analytics/` y `src/lib/portfolio/` la convención es **rutas relativas** (`./series`, `./holdings`); desde fuera de esos directorios se usa `@/lib/...`.

### Lo que ya existe y hay que reusar

- **`requirePortfolio(supabase, searchParams)`** (`src/lib/portfolio/context.ts`) — traduce `?portfolio=nacional` a `{ id, slug, name, baseCurrency, feeStructure }`, o devuelve un `NextResponse` de error listo para retornar. **Toda ruta nueva la usa**, igual que las existentes.
- **`useResource<T>(key)`** (`src/lib/hooks/use-resource.ts`) — lectura por el caché compartido. La UI nunca hace `fetch` para leer.
- **`invalidateAfter(kind)`** (`src/lib/cache/resources.ts`) — se llama después de cada mutación exitosa.
- **`formatMoney(value, currency)`** (`src/lib/format/money.ts`) — CLP sin decimales, el resto con 2.
- **`fxAsOf(fxSeries, date)`** y **`loadFxSeries(supabase, fromISO?)`** — tipo de cambio con forward-fill.

### El esquema que la 0009 ya dejó

```
cash_movements(id, user_id, portfolio_id, currency, movement_type, amount, occurred_at, note, created_at)
    movement_type ∈ ('deposit','withdrawal');  el CHECK exige amount > 0 para deposit y < 0 para withdrawal

fx_transfers(id, user_id, from_portfolio_id, from_currency, from_amount,
                          to_portfolio_id,   to_currency,   to_amount, occurred_at, note, created_at)
    ambos montos POSITIVOS; el signo lo pone la proyección

cash_ledger        (vista) → user_id, portfolio_id, currency, movement_type, amount, occurred_at, source, source_id
    movement_type ∈ ('deposit','withdrawal','trade_buy','trade_sell','fx_out','fx_in')
    NO tiene columna `id` (un traspaso emite dos filas)

cash_balances      (vista) → user_id, portfolio_id, currency, balance, last_movement_at
fx_transfers_audit (vista) → columnas de fx_transfers + clp_por_usd, clp_por_usd_mercado, costo_spread_clp
```

### Tres cosas que NO son obvias

1. **`cash_balances` no tiene fila para un portafolio sin movimientos.** "Sin fila" significa saldo 0. Todo consumidor tiene que tratarlo así en vez de asumir una fila por portafolio.
2. **`total_value` incluye la caja, pero `totalPnl` NO.** Tener plata en la cuenta no es una ganancia. Ver la Tarea 8, donde esto se implementa.
3. **Hoy nadie LEE la tabla `snapshots`.** Su único escritor es `/api/prices/refresh` y su único lector sería un consumidor futuro; el gráfico del dashboard se calcula desde transacciones y precios, no desde snapshots. La Tarea 7 existe para que la tabla no acumule una segunda generación de datos incompletos, no porque haya una pantalla esperándola.

---

## Estructura de archivos

### Se crea

| Archivo | Responsabilidad |
|---|---|
| `src/app/api/cash/movements/route.ts` | GET lista y POST alta de abonos/retiros del portafolio |
| `src/app/api/cash/movements/[id]/route.ts` | DELETE de un movimiento |
| `src/app/api/cash/transfers/route.ts` | GET lista (con auditoría del spread) y POST alta de conversiones |
| `src/app/api/cash/transfers/[id]/route.ts` | DELETE de un traspaso — se lleva sus dos patas |
| `src/app/api/cash/balances/route.ts` | GET de saldos por moneda; sin lógica, lee la vista |
| `src/components/cash-section.tsx` | Sección de efectivo: saldos, formularios de abono/retiro y conversión, y el libro |
| `supabase/migrations/0010_snapshots_incluyen_caja.sql` | Columna `includes_cash` + backfill del histórico |

### Se modifica

| Archivo | Cambio | Tarea |
|---|---|---|
| `src/lib/validation/schemas.ts` | `cashMovementInputSchema`, `fxTransferInputSchema` | 1 |
| `src/lib/validation/schemas.test.ts` | Tests de ambos schemas | 1 |
| `src/lib/cache/resources.ts` | Nueva clave de invalidación `cash` | 4 |
| `src/lib/cache/resources.test.ts` | Test de la clave nueva | 4 |
| `src/app/(app)/[portfolio]/portfolio/page.tsx` | Monta `<CashSection />` | 5 |
| `src/lib/portfolio/valuation.ts` | `portfolioTotals` recibe el saldo; `PortfolioTotals` gana 2 campos | 8 |
| `src/lib/portfolio/valuation.test.ts` | Tests de la caja en los totales | 8 |
| `src/lib/portfolio/snapshot.ts` | `computeSnapshotValue` recibe el saldo | 9 |
| `src/lib/portfolio/snapshot.test.ts` | Test del snapshot con caja | 9 |
| `src/app/api/positions/route.ts` | Lee `cash_balances` y lo pasa a la valorización | 10 |
| `src/app/api/prices/refresh/route.ts` | El snapshot incluye la caja y marca `includes_cash` | 11 |
| `src/app/(app)/[portfolio]/dashboard/page.tsx` | KPI de efectivo + aviso de saldo negativo | 12 |
| `src/lib/fx/convert.ts` | `flowsToBaseCurrency` | 13 |
| `src/lib/fx/convert.test.ts` | Tests de la conversión de flujos | 13 |
| `src/lib/analytics/types.ts` | Tipo `ExternalFlow` | 14 |
| `src/lib/analytics/engine.ts` | `netFlows` lee flujos en vez de inferirlos | 14 |
| `src/lib/analytics/engine.test.ts` | 5 llamadas + tests nuevos de flujos | 14 |
| `src/lib/analytics/windowing.test.ts` | 1 llamada | 14 |
| `src/lib/fx/calendar-protection.test.ts` | 1 llamada | 14 |
| `src/app/api/analytics/route.ts` | Consulta el libro y provee los flujos al motor | 15 |
| `README.md` · `docs/superpowers/plans/ROADMAP.md` | Documentar la caja | 16 |

---

# Rebanada 2 — API y validación

## Task 1: Schemas de validación

El signo del monto lo deriva el schema, no el cliente. Si el cliente enviara el monto ya firmado, el tipo y el signo serían dos fuentes de verdad para lo mismo: un `withdrawal` con monto positivo lo rechazaría el CHECK de la base con un 500 opaco en vez de un 400 legible.

**Files:**
- Modify: `src/lib/validation/schemas.ts`
- Test: `src/lib/validation/schemas.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

Añadir al final de `src/lib/validation/schemas.test.ts`:

```ts
describe('cashMovementInputSchema', () => {
  it('un retiro sale con monto NEGATIVO aunque se envíe la magnitud positiva', () => {
    const r = cashMovementInputSchema.parse({
      movementType: 'withdrawal',
      amount: '50000',
      currency: 'clp',
      occurredAt: '2026-06-10',
    })
    expect(r.amount).toBe(-50000)
    expect(r.currency).toBe('CLP')
    expect(r.note).toBe('')
  })

  it('un abono conserva el signo positivo', () => {
    const r = cashMovementInputSchema.parse({
      movementType: 'deposit',
      amount: 950000,
      currency: 'CLP',
      occurredAt: '2026-06-10',
    })
    expect(r.amount).toBe(950000)
  })

  it('rechaza monto cero: un movimiento que no mueve nada no significa nada', () => {
    expect(
      cashMovementInputSchema.safeParse({
        movementType: 'deposit', amount: 0, currency: 'CLP', occurredAt: '2026-06-10',
      }).success
    ).toBe(false)
  })

  it('rechaza monto negativo: el signo lo pone el tipo, no el cliente', () => {
    expect(
      cashMovementInputSchema.safeParse({
        movementType: 'withdrawal', amount: -50000, currency: 'CLP', occurredAt: '2026-06-10',
      }).success
    ).toBe(false)
  })

  it('rechaza un tipo que la base no admite', () => {
    expect(
      cashMovementInputSchema.safeParse({
        movementType: 'dividend', amount: 100, currency: 'CLP', occurredAt: '2026-06-10',
      }).success
    ).toBe(false)
  })
})

describe('fxTransferInputSchema', () => {
  const base = {
    toPortfolioId: UUID,
    fromCurrency: 'clp',
    fromAmount: '950000',
    toCurrency: 'usd',
    toAmount: '1000',
    occurredAt: '2026-06-12',
  }

  it('acepta strings de formulario y normaliza ambas monedas', () => {
    const r = fxTransferInputSchema.parse(base)
    expect(r.fromCurrency).toBe('CLP')
    expect(r.toCurrency).toBe('USD')
    expect(r.fromAmount).toBe(950000)
    expect(r.toAmount).toBe(1000)
  })

  it('rechaza montos no positivos en cualquiera de las dos patas', () => {
    expect(fxTransferInputSchema.safeParse({ ...base, fromAmount: 0 }).success).toBe(false)
    expect(fxTransferInputSchema.safeParse({ ...base, toAmount: -1 }).success).toBe(false)
  })

  it('rechaza una fecha que no sea YYYY-MM-DD', () => {
    expect(fxTransferInputSchema.safeParse({ ...base, occurredAt: '12/06/2026' }).success).toBe(false)
  })
})
```

Y ampliar el import del principio del archivo:

```ts
import {
  assetInputSchema,
  transactionInputSchema,
  priceInputSchema,
  alertInputSchema,
  cashMovementInputSchema,
  fxTransferInputSchema,
} from '@/lib/validation/schemas'
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test -- schemas`
Expected: FAIL — `cashMovementInputSchema is not exported` / no está definido.

- [ ] **Step 3: Implementar los schemas**

Añadir al final de `src/lib/validation/schemas.ts`:

```ts
// Movimiento de capital externo: abono o retiro.
//
// El cliente envía SIEMPRE una magnitud positiva y el tipo; el signo lo deriva
// el transform. Si el cliente mandara el monto ya firmado, el tipo y el signo
// serían dos fuentes de verdad para lo mismo y podrían contradecirse — el CHECK
// `cash_movements_signo` lo rechazaría con un 500 opaco en vez de un 400 que
// explique qué está mal.
export const cashMovementInputSchema = z
  .object({
    movementType: z.enum(['deposit', 'withdrawal']),
    amount: z.coerce.number().positive(),
    currency: z
      .string()
      .trim()
      .length(3)
      .transform((c) => c.toUpperCase()),
    occurredAt: z.string().regex(DATE_RE, 'formato esperado YYYY-MM-DD'),
    note: z.string().trim().max(200).default(''),
  })
  .transform((m) => ({
    ...m,
    amount: m.movementType === 'withdrawal' ? -m.amount : m.amount,
  }))
export type CashMovementInput = z.infer<typeof cashMovementInputSchema>

// Conversión de divisa entre portafolios. El portafolio de ORIGEN no viaja en el
// body: es el del contexto (`?portfolio=`), igual que en todas las demás rutas.
//
// No hay campo de tasa: `fromAmount / toAmount` la da exacta, y una tercera
// columna podría contradecir a las otras dos (Decisión 5 del spec).
export const fxTransferInputSchema = z.object({
  toPortfolioId: z.string().uuid(),
  fromCurrency: z
    .string()
    .trim()
    .length(3)
    .transform((c) => c.toUpperCase()),
  fromAmount: z.coerce.number().positive(),
  toCurrency: z
    .string()
    .trim()
    .length(3)
    .transform((c) => c.toUpperCase()),
  toAmount: z.coerce.number().positive(),
  occurredAt: z.string().regex(DATE_RE, 'formato esperado YYYY-MM-DD'),
  note: z.string().trim().max(200).default(''),
})
export type FxTransferInput = z.infer<typeof fxTransferInputSchema>
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: **32 archivos, 235 tests, todos verdes** (227 + 8 nuevos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation/schemas.ts src/lib/validation/schemas.test.ts
git commit -m "feat(validation): schemas de caja, con el signo derivado del tipo

El cliente manda magnitud + tipo y el schema deriva el signo. Si mandara el
monto firmado, el tipo y el signo podrian contradecirse y el CHECK de la base
rechazaria con un 500 opaco en vez de un 400 legible.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Rutas de movimientos de caja

**Files:**
- Create: `src/app/api/cash/movements/route.ts`
- Create: `src/app/api/cash/movements/[id]/route.ts`

No hay TDD acá: las rutas son envoltorios delgados sin lógica propia (la validación se probó en la Tarea 1, y las garantías las impone la base). El proyecto no tiene tests de rutas API en ninguna fase anterior.

- [ ] **Step 1: Crear `src/app/api/cash/movements/route.ts`**

```ts
// src/app/api/cash/movements/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cashMovementInputSchema } from '@/lib/validation/schemas'
import { requirePortfolio } from '@/lib/portfolio/context'

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const ctx = await requirePortfolio(supabase, searchParams)
  if (ctx instanceof NextResponse) return ctx

  const { data, error } = await supabase
    .from('cash_movements')
    .select('id, currency, movement_type, amount, occurred_at, note')
    .eq('portfolio_id', ctx.id)
    .order('occurred_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const ctx = await requirePortfolio(supabase, searchParams)
  if (ctx instanceof NextResponse) return ctx

  const parsed = cashMovementInputSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { movementType, amount, currency, occurredAt, note } = parsed.data

  const { data, error } = await supabase
    .from('cash_movements')
    .insert({
      user_id: user.id,
      portfolio_id: ctx.id,
      currency,
      movement_type: movementType,
      // Ya viene con signo desde el schema; el CHECK de la base es la red para
      // quien escriba sin pasar por acá.
      amount,
      occurred_at: occurredAt,
      note,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
```

- [ ] **Step 2: Crear `src/app/api/cash/movements/[id]/route.ts`**

Mismo patrón que `src/app/api/transactions/[id]/route.ts`: la RLS filtra las filas ajenas, así que un `id` de otro usuario simplemente no borra nada.

```ts
// src/app/api/cash/movements/[id]/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase.from('cash_movements').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return new NextResponse(null, { status: 204 })
}
```

- [ ] **Step 3: Verificar que compila y que los tests siguen verdes**

Run: `npm run build`
Expected: build exitoso, sin errores de tipos.

Run: `npm test`
Expected: 32 archivos, 235 tests, verdes (sin cambios respecto a la Tarea 1).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cash/movements
git commit -m "feat(api): alta, listado y baja de movimientos de caja

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Rutas de traspasos cambiarios

El GET lee `fx_transfers_audit` en vez de `fx_transfers`: trae las mismas columnas más la tasa efectiva y el costo del spread, que es justamente lo que la UI quiere mostrar. Leer la tabla cruda obligaría a recalcular en el cliente algo que la base ya sabe.

**Files:**
- Create: `src/app/api/cash/transfers/route.ts`
- Create: `src/app/api/cash/transfers/[id]/route.ts`

- [ ] **Step 1: Crear `src/app/api/cash/transfers/route.ts`**

```ts
// src/app/api/cash/transfers/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fxTransferInputSchema } from '@/lib/validation/schemas'
import { requirePortfolio } from '@/lib/portfolio/context'

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const ctx = await requirePortfolio(supabase, searchParams)
  if (ctx instanceof NextResponse) return ctx

  // Un traspaso le pertenece a AMBOS portafolios: aparece en el libro del que
  // manda y en el del que recibe. Filtrar sólo por origen lo escondería del
  // portafolio internacional, donde el abono en dólares es el hecho relevante.
  const { data, error } = await supabase
    .from('fx_transfers_audit')
    .select(
      'id, from_portfolio_id, from_currency, from_amount, to_portfolio_id, to_currency, to_amount, ' +
        'occurred_at, note, clp_por_usd, clp_por_usd_mercado, costo_spread_clp'
    )
    .or(`from_portfolio_id.eq.${ctx.id},to_portfolio_id.eq.${ctx.id}`)
    .order('occurred_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const ctx = await requirePortfolio(supabase, searchParams)
  if (ctx instanceof NextResponse) return ctx

  const parsed = fxTransferInputSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { toPortfolioId, fromCurrency, fromAmount, toCurrency, toAmount, occurredAt, note } = parsed.data

  // La RLS ya rechazaría un destino ajeno, pero con un error de política que no
  // dice nada útil. Comprobarlo antes convierte eso en un 404 explícito. La RLS
  // filtra la lectura, así que "no aparece" equivale a "no es tuyo".
  const { data: dest } = await supabase
    .from('portfolios')
    .select('id')
    .eq('id', toPortfolioId)
    .maybeSingle()
  if (!dest) return NextResponse.json({ error: 'Portafolio destino no encontrado' }, { status: 404 })

  const { data, error } = await supabase
    .from('fx_transfers')
    .insert({
      user_id: user.id,
      from_portfolio_id: ctx.id,
      from_currency: fromCurrency,
      from_amount: fromAmount,
      to_portfolio_id: toPortfolioId,
      to_currency: toCurrency,
      to_amount: toAmount,
      occurred_at: occurredAt,
      note,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
```

- [ ] **Step 2: Crear `src/app/api/cash/transfers/[id]/route.ts`**

```ts
// src/app/api/cash/transfers/[id]/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Borrar el traspaso se lleva sus DOS patas del libro, porque las patas no son
// filas: son una proyección de esta fila. No hay nada que limpiar aparte.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase.from('fx_transfers').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return new NextResponse(null, { status: 204 })
}
```

- [ ] **Step 3: Verificar compilación**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cash/transfers
git commit -m "feat(api): traspasos cambiarios, listados con su spread

El GET lee fx_transfers_audit y no la tabla cruda: la tasa efectiva y el costo
del spread ya los calcula la base. Y filtra por origen O destino, porque un
traspaso le pertenece a los dos portafolios.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Saldos e invalidación de caché

**Files:**
- Create: `src/app/api/cash/balances/route.ts`
- Modify: `src/lib/cache/resources.ts`
- Test: `src/lib/cache/resources.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Añadir dentro del `describe('INVALIDATES', ...)` de `src/lib/cache/resources.test.ts`:

```ts
it('un movimiento de caja ensucia el libro, las posiciones y la analítica', () => {
  // No es sólo el libro: el efectivo entra en `total_value` (posiciones) y los
  // abonos/retiros son los flujos externos con los que la analítica calcula el
  // P&L absoluto. Dejar esas dos fuera mostraría un saldo nuevo junto a un
  // patrimonio viejo.
  expect(INVALIDATES.cash).toEqual(
    expect.arrayContaining(['/api/cash', '/api/positions', '/api/analytics']),
  )
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- resources`
Expected: FAIL — `INVALIDATES.cash` es `undefined`.

- [ ] **Step 3: Añadir la clave**

En `src/lib/cache/resources.ts`, dentro del objeto `INVALIDATES`, después de la entrada `portfolio`:

```ts
  // Abono, retiro o conversión. El prefijo `/api/cash` alcanza de una vez a
  // movements, transfers y balances. Ensucia además posiciones y analítica: el
  // efectivo entra en el patrimonio y los movimientos externos son los flujos
  // con los que se calcula el P&L absoluto.
  cash: ['/api/cash', '/api/positions', '/api/analytics'],
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test`
Expected: **32 archivos, 236 tests, verdes.**

- [ ] **Step 5: Crear `src/app/api/cash/balances/route.ts`**

```ts
// src/app/api/cash/balances/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requirePortfolio } from '@/lib/portfolio/context'

// Lee la vista y ya. El saldo no se calcula acá ni en ninguna parte del código:
// es `sum(amount)` sobre `cash_ledger`, y un saldo materializado sería una caché
// del libro capaz de desviarse de él.
//
// OJO: un portafolio SIN movimientos no tiene fila. La respuesta es `[]`, y eso
// significa saldo cero — no "error" ni "sin datos".
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const ctx = await requirePortfolio(supabase, searchParams)
  if (ctx instanceof NextResponse) return ctx

  const { data, error } = await supabase
    .from('cash_balances')
    .select('currency, balance, last_movement_at')
    .eq('portfolio_id', ctx.id)
    .order('currency')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(
    (data ?? []).map((r) => ({
      currency: r.currency as string,
      balance: Number(r.balance),
      lastMovementAt: r.last_movement_at as string | null,
    }))
  )
}
```

- [ ] **Step 6: Verificar compilación**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/cash/balances src/lib/cache/resources.ts src/lib/cache/resources.test.ts
git commit -m "feat(api): saldos de caja y su clave de invalidacion

El saldo no se calcula en el codigo: la ruta lee cash_balances. Un portafolio
sin movimientos no tiene fila, y eso significa cero.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Rebanada 3 — UI y reconstrucción del histórico

## Task 5: Sección de efectivo

Va en un **componente propio** y no directo en `portfolio/page.tsx`, que ya tiene ~380 líneas con dos formularios y dos tablas. Una tercera sección con dos formularios más lo dejaría inmanejable.

**Files:**
- Create: `src/components/cash-section.tsx`
- Modify: `src/app/(app)/[portfolio]/portfolio/page.tsx`

No hay tests: el proyecto no tiene jsdom ni testing-library, y ningún componente está testeado. La lógica que sí se puede probar ya vive en los schemas (Tarea 1) y en el caché (Tarea 4).

- [ ] **Step 1: Crear `src/components/cash-section.tsx`**

```tsx
// src/components/cash-section.tsx
'use client'

import { useState } from 'react'
import { useResource } from '@/lib/hooks/use-resource'
import { invalidateAfter } from '@/lib/cache/resources'
import { formatMoney } from '@/lib/format/money'

interface Balance {
  currency: string
  balance: number
  lastMovementAt: string | null
}

interface Movement {
  id: string
  currency: string
  movement_type: 'deposit' | 'withdrawal'
  amount: number
  occurred_at: string
  note: string
}

interface Transfer {
  id: string
  from_portfolio_id: string
  from_currency: string
  from_amount: number
  to_portfolio_id: string
  to_currency: string
  to_amount: number
  occurred_at: string
  note: string
  clp_por_usd: number | null
  clp_por_usd_mercado: number | null
  costo_spread_clp: number | null
}

interface PortfolioRef {
  id: string
  slug: string
  name: string
  baseCurrency: string
}

const inputCls = 'rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200'
const btnCls = 'rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500'

export function CashSection({ portfolio }: { portfolio: string }) {
  const [error, setError] = useState<string | null>(null)

  const { data: balancesData } = useResource<Balance[]>(`/api/cash/balances?portfolio=${portfolio}`)
  const { data: movementsData } = useResource<Movement[]>(`/api/cash/movements?portfolio=${portfolio}`)
  const { data: transfersData } = useResource<Transfer[]>(`/api/cash/transfers?portfolio=${portfolio}`)
  const { data: portfoliosData } = useResource<PortfolioRef[]>('/api/portfolios')

  const balances = balancesData ?? []
  const movements = movementsData ?? []
  const transfers = transfersData ?? []
  const portfolios = portfoliosData ?? []

  const current = portfolios.find((p) => p.slug === portfolio) ?? null
  const others = portfolios.filter((p) => p.slug !== portfolio)
  const baseCurrency = current?.baseCurrency ?? ''

  async function post(url: string, body: unknown) {
    setError(null)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setError(typeof data?.error === 'string' ? data.error : 'Error de validación')
      return false
    }
    invalidateAfter('cash')
    return true
  }

  async function remove(url: string) {
    await fetch(url, { method: 'DELETE' })
    invalidateAfter('cash')
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-200">Efectivo</h2>
      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Saldos. Sin filas = saldo cero, no "sin datos". */}
      <div className="flex flex-wrap gap-3">
        {balances.length === 0 && (
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-500">
            Sin movimientos registrados: saldo {formatMoney(0, baseCurrency)}.
          </div>
        )}
        {balances.map((b) => (
          <div key={b.currency} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">Saldo {b.currency}</div>
            <div
              className={`mt-1 text-2xl font-bold ${b.balance < 0 ? 'text-amber-400' : 'text-slate-100'}`}
            >
              {formatMoney(b.balance, b.currency)}
            </div>
            {b.balance < 0 && (
              <p className="mt-2 max-w-xs text-xs text-amber-400">
                Saldo negativo: falta registrar un abono, o el bróker te dio margen. No es un
                error de la app — es plata que salió sin que entrara antes.
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Abono / retiro */}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          const form = e.currentTarget
          const fd = new FormData(form)
          const ok = await post(`/api/cash/movements?portfolio=${portfolio}`, {
            movementType: fd.get('movementType'),
            amount: fd.get('amount'),
            currency: fd.get('currency') || baseCurrency,
            occurredAt: fd.get('occurredAt'),
            note: fd.get('note') ?? '',
          })
          if (ok) form.reset()
        }}
      >
        <select name="movementType" required className={inputCls} defaultValue="deposit">
          <option value="deposit">Abono</option>
          <option value="withdrawal">Retiro</option>
        </select>
        <input
          name="amount"
          type="number"
          step="any"
          min="0"
          placeholder="Monto (siempre positivo)"
          title="Escribe la magnitud; el signo lo pone el tipo de movimiento"
          required
          className={inputCls}
        />
        <input
          name="currency"
          maxLength={3}
          placeholder={`Moneda (${baseCurrency || 'CLP'})`}
          defaultValue={baseCurrency}
          className={inputCls}
        />
        <input name="occurredAt" type="date" required className={inputCls} />
        <input name="note" placeholder="Nota (opcional)" className={inputCls} />
        <button type="submit" className={btnCls}>Registrar movimiento</button>
      </form>

      {/* Conversión. Sólo tiene sentido si hay a dónde mandar la plata. */}
      {others.length > 0 && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            const form = e.currentTarget
            const fd = new FormData(form)
            const dest = portfolios.find((p) => p.id === fd.get('toPortfolioId'))
            const ok = await post(`/api/cash/transfers?portfolio=${portfolio}`, {
              toPortfolioId: fd.get('toPortfolioId'),
              fromCurrency: baseCurrency,
              fromAmount: fd.get('fromAmount'),
              toCurrency: dest?.baseCurrency ?? '',
              toAmount: fd.get('toAmount'),
              occurredAt: fd.get('occurredAt'),
              note: fd.get('note') ?? '',
            })
            if (ok) form.reset()
          }}
        >
          <input
            name="fromAmount"
            type="number"
            step="any"
            min="0"
            placeholder={`Sale (${baseCurrency})`}
            required
            className={inputCls}
          />
          <select name="toPortfolioId" required className={inputCls} defaultValue={others[0]?.id}>
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                → {p.name} ({p.baseCurrency})
              </option>
            ))}
          </select>
          <input
            name="toAmount"
            type="number"
            step="any"
            min="0"
            placeholder="Llega"
            required
            className={inputCls}
          />
          <input name="occurredAt" type="date" required className={inputCls} />
          <input name="note" placeholder="Nota (opcional)" className={inputCls} />
          <button type="submit" className={btnCls}>Registrar conversión</button>
        </form>
      )}

      {/* Conversiones con su spread */}
      {transfers.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-xs uppercase text-slate-500">
              <th className="py-2">Fecha</th>
              <th className="text-right">Sale</th>
              <th className="text-right">Llega</th>
              <th className="text-right">Tasa</th>
              <th className="text-right">Mercado</th>
              <th className="text-right">Costo spread</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {transfers.map((t) => (
              <tr key={t.id} className="border-b border-slate-900">
                <td className="py-2">{t.occurred_at}</td>
                <td className="text-right">{formatMoney(Number(t.from_amount), t.from_currency)}</td>
                <td className="text-right">{formatMoney(Number(t.to_amount), t.to_currency)}</td>
                <td className="text-right">
                  {t.clp_por_usd === null ? '—' : Number(t.clp_por_usd).toFixed(2)}
                </td>
                <td className="text-right text-slate-500">
                  {t.clp_por_usd_mercado === null ? '—' : Number(t.clp_por_usd_mercado).toFixed(2)}
                </td>
                <td className="text-right text-amber-400">
                  {t.costo_spread_clp === null ? '—' : formatMoney(Number(t.costo_spread_clp), 'CLP')}
                </td>
                <td className="text-right">
                  <button
                    onClick={() => remove(`/api/cash/transfers/${t.id}`)}
                    className="text-slate-600 hover:text-red-400"
                    title="Borrar la conversión y sus dos patas"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Abonos y retiros */}
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-xs uppercase text-slate-500">
            <th className="py-2">Fecha</th>
            <th>Tipo</th>
            <th className="text-right">Monto</th>
            <th>Nota</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {movements.map((m) => (
            <tr key={m.id} className="border-b border-slate-900">
              <td className="py-2">{m.occurred_at}</td>
              <td className={m.movement_type === 'deposit' ? 'text-green-400' : 'text-red-400'}>
                {m.movement_type === 'deposit' ? 'Abono' : 'Retiro'}
              </td>
              <td className="text-right">{formatMoney(Number(m.amount), m.currency)}</td>
              <td className="text-slate-500">{m.note}</td>
              <td className="text-right">
                <button
                  onClick={() => remove(`/api/cash/movements/${m.id}`)}
                  className="text-slate-600 hover:text-red-400"
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
          {movements.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-slate-500">Sin abonos ni retiros todavía.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )
}
```

- [ ] **Step 2: Montarla en la página de portafolio**

En `src/app/(app)/[portfolio]/portfolio/page.tsx`, añadir el import junto a los demás:

```ts
import { CashSection } from '@/components/cash-section'
```

Y montar el componente **al final** del JSX, justo antes del `</div>` que cierra el contenedor raíz (después de la sección de Transacciones):

```tsx
      <CashSection portfolio={portfolio} />
    </div>
  )
}
```

- [ ] **Step 3: Verificar**

Run: `npm run build`
Expected: build exitoso.

Run: `npm run lint`
Expected: sin errores.

Run: `npm test`
Expected: 32 archivos, 236 tests, verdes.

- [ ] **Step 4: Verificar a mano en el navegador**

Run: `npm run dev` y abrir `http://localhost:3000/nacional/portfolio`.

Comprobar:
1. La sección "Efectivo" aparece al final, con el saldo actual (negativo, en ámbar, con el aviso).
2. Registrar un abono de prueba: el saldo cambia sin recargar la página.
3. Registrar una conversión hacia el internacional: aparece en la tabla con su tasa y su costo de spread.
4. Abrir `/internacional/portfolio`: la misma conversión aparece también ahí (es de los dos portafolios).
5. Borrar la conversión: desaparece de ambos portafolios y los dos saldos vuelven atrás.
6. Borrar el abono de prueba.

- [ ] **Step 5: Commit**

```bash
git add src/components/cash-section.tsx "src/app/(app)/[portfolio]/portfolio/page.tsx"
git commit -m "feat(ui): seccion de efectivo con saldos, abonos y conversiones

En componente propio: portfolio/page.tsx ya tenia dos formularios y dos tablas.

El formulario pide la MAGNITUD y el tipo; nunca un monto firmado. El saldo
negativo se muestra en ambar con una explicacion, no se bloquea: significa que
falta registrar un abono, y prohibirlo obligaria a inventar uno.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Reconstrucción del histórico

**No hay código en esta tarea.** Es digitación con las cartolas del bróker, y es el criterio de aceptación de toda la rebanada.

- [ ] **Step 1: Cargar los abonos y retiros reales desde junio de 2026**

En `/nacional/portfolio` y `/internacional/portfolio`, registrar **cada** transferencia bancaria hacia el bróker y cada retiro, con su fecha real.

- [ ] **Step 2: Cargar las conversiones CLP → USD**

Cada orden de conversión, con los pesos que salieron y los dólares que llegaron. La tasa y el spread los calcula la app.

- [ ] **Step 3: Cuadrar contra la cartola**

```sql
select p.slug, b.currency, b.balance
from cash_balances b join portfolios p on p.id = b.portfolio_id
order by p.slug, b.currency;
```

**Criterio de aceptación: estos números tienen que coincidir al peso con los que muestra la aplicación del bróker.**

Si no cuadran, falta un hecho. Revisar en este orden:
1. ¿Falta algún abono o retiro?
2. ¿Falta alguna conversión?
3. ¿Hay dinero que no explica ningún trade, abono ni retiro? Entonces apareció un tipo de movimiento que la Decisión 9 del spec dejó fuera a propósito —dividendo, interés, costo de custodia— y hay que agregarlo **con esa evidencia**, no por si acaso.

- [ ] **Step 4: Dejar constancia del resultado**

Anotar en el PR o en un comentario el saldo final de cada portafolio y confirmar que cuadra. **Las tareas 7 en adelante dependen de que este paso haya terminado**: el backfill de snapshots suma la caja de cada fecha, y sumar un libro incompleto es peor que no sumarlo.

---

# Rebanada 4 — El histórico de snapshots

## Task 7: Migración 0010 — los snapshots incluyen la caja

Va **antes** de que el escritor cambie (Tarea 11), no después. Con el escritor viejo todavía en producción, cada fila de `snapshots` está en un estado conocido —sin caja— y el backfill las cubre todas de una vez. Al revés habría filas nuevas ya con caja mezcladas con filas viejas sin ella, y distinguirlas dependería de la fecha de despliegue.

**Files:**
- Create: `supabase/migrations/0010_snapshots_incluyen_caja.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- supabase/migrations/0010_snapshots_incluyen_caja.sql
-- Proyecto 3.1, rebanada 4 — el histórico de patrimonio incluye el efectivo.
-- Ejecutar COMPLETO en el SQL Editor de Supabase.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ORDEN: DESPUÉS de la reconstrucción del histórico, ANTES de desplegar el
-- escritor nuevo.
--
--   · Después de la reconstrucción porque suma la caja de cada fecha, y sumar un
--     libro incompleto deja un histórico incorrecto que ya nadie va a revisar.
--   · Antes del escritor nuevo porque mientras el viejo siga corriendo, TODA
--     fila de `snapshots` está en el mismo estado —sin caja— y el backfill las
--     cubre de una vez. Al revés, distinguir cuáles ya la traen dependería de
--     recordar la fecha del despliegue.
--
-- CONTEXTO QUE CONVIENE SABER: hoy nadie LEE esta tabla. Su único escritor es
-- /api/prices/refresh y el gráfico del dashboard se calcula desde transacciones
-- y precios, no desde acá. Esta migración existe para que la tabla no acumule
-- una segunda generación de datos incompletos, no porque haya una pantalla
-- esperándola.
--
-- ATOMICIDAD: DDL transaccional. Si la guarda falla, revierte todo.
-- ─────────────────────────────────────────────────────────────────────────────


-- 1. La marca -----------------------------------------------------------------
--
-- Sin ella el backfill no sería re-ejecutable: correrlo dos veces sumaría la
-- caja dos veces, y el error no se vería en ninguna parte. Misma maniobra que la
-- 0003, que usó `currency is null` para no doble-convertir.
--
-- También deja legible la discontinuidad: las filas con `false` miden sólo
-- instrumentos y no son comparables con las que traen el patrimonio completo.

alter table snapshots add column includes_cash boolean not null default false;


-- 2. Guarda previa ------------------------------------------------------------
--
-- El backfill suma sólo la caja EN LA MISMA MONEDA del snapshot. Si existiera
-- efectivo en otra moneda haría falta convertirlo al FX de cada fecha, que es
-- trabajo que este proyecto no hizo. Abortar es mejor que sumar de menos en
-- silencio: un patrimonio subestimado es indistinguible de uno correcto.

do $$
declare
  caja_moneda_ajena int;
begin
  select count(*) into caja_moneda_ajena
  from cash_balances b
  join portfolios p on p.id = b.portfolio_id
  where b.currency <> p.base_currency;

  if caja_moneda_ajena > 0 then
    raise exception
      'Abortado: % saldo(s) en una moneda distinta a la base de su portafolio. '
      'El backfill sólo suma caja en la moneda del snapshot; convertir el resto '
      'exige el FX de cada fecha y no está implementado.', caja_moneda_ajena;
  end if;
end $$;


-- 3. El backfill --------------------------------------------------------------
--
-- Caja del portafolio a la fecha del snapshot = suma de todo el libro hasta esa
-- fecha inclusive. `coalesce` porque un portafolio sin movimientos previos no
-- devuelve fila, y eso significa cero.
--
-- NOTA sobre `cash_ledger`: es una vista `security_invoker`, así que corre con
-- los permisos de quien la consulta. Acá eso es `postgres` desde el SQL Editor,
-- que ve todas las filas — que es justo lo que un backfill necesita.

update snapshots s
set total_value = s.total_value + coalesce((
      select sum(l.amount)
      from cash_ledger l
      where l.portfolio_id = s.portfolio_id
        and l.currency = s.currency
        and l.occurred_at <= s.snapshot_date
    ), 0),
    includes_cash = true
where s.includes_cash = false;


-- 4. Guarda posterior ---------------------------------------------------------

do $$
declare
  sin_marcar int;
begin
  select count(*) into sin_marcar from snapshots where includes_cash = false;
  if sin_marcar > 0 then
    raise exception 'Abortado: % snapshot(s) quedaron sin marcar.', sin_marcar;
  end if;
end $$;


-- VERIFICACIÓN ---------------------------------------------------------------
--
-- Todas las filas marcadas, y ninguna con patrimonio negativo sin explicación:
--
--   select portfolio_id, count(*) as filas,
--          bool_and(includes_cash) as todas_con_caja,
--          min(total_value) as minimo
--   from snapshots group by portfolio_id;
--
-- Re-ejecutar el UPDATE de la sección 3 debe afectar 0 filas (es idempotente):
--
--   begin;
--   update snapshots s set total_value = s.total_value + 1 where s.includes_cash = false;
--   -- esperado: UPDATE 0
--   rollback;
```

- [ ] **Step 2: Aplicarla en el SQL Editor de Supabase**

Pegar el archivo completo y ejecutar.
Expected: `ALTER TABLE`, `DO`, `UPDATE n`, `DO` — sin excepciones.

Si aborta por la guarda de moneda ajena: hay efectivo en una moneda distinta a la base de su portafolio. Decidir si es un error de digitación (corregirlo) o un caso real (entonces el proyecto necesita conversión de caja, que es alcance nuevo y va a su propio spec).

- [ ] **Step 3: Correr la verificación**

Ejecutar las dos consultas del bloque VERIFICACIÓN.
Expected: `todas_con_caja = true` para cada portafolio, y el `UPDATE` de prueba afecta 0 filas.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0010_snapshots_incluyen_caja.sql
git commit -m "feat(db): los snapshots historicos incluyen la caja (migracion 0010)

Va antes del escritor nuevo, no despues: mientras el viejo siga corriendo toda
fila esta en el mismo estado y el backfill las cubre de una vez.

La columna includes_cash no es decoracion: sin ella el backfill no seria
re-ejecutable y correrlo dos veces sumaria la caja dos veces sin que se note.

Una guarda aborta si hay efectivo en una moneda distinta a la base de su
portafolio: sumar de menos en silencio es peor que fallar.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Rebanada 5 — El efectivo entra en el patrimonio

## Task 8: `portfolioTotals` con caja

La sutileza de toda la rebanada: **el efectivo entra en `totalValue` pero NO en `totalPnl`.** Tener plata en la cuenta es patrimonio, no ganancia. Si la caja entrara al P&L, un abono de un millón se vería como un millón de utilidad.

**Files:**
- Modify: `src/lib/portfolio/valuation.ts:36-95`
- Test: `src/lib/portfolio/valuation.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

Añadir dentro del `describe('portfolioTotals', ...)` de `src/lib/portfolio/valuation.test.ts`:

```ts
  it('la caja entra en el valor total pero NO en el P&L', () => {
    const positions = valuePositions(
      [{ assetId: 'a1', ticker: 'AAPL', quantity: 10, costBasis: 1000, avgCost: 100 }],
      [{ ticker: 'AAPL', price: 120 }],
      'CLP',
    )
    const t = portfolioTotals(positions, 5000)
    // 10 × 120 = 1200 de activos, más 5000 de caja.
    expect(t.assetsValue).toBe(1200)
    expect(t.cashBalance).toBe(5000)
    expect(t.totalValue).toBe(6200)
    // El P&L sigue midiendo las posiciones: 1200 − 1000. Un abono no es utilidad.
    expect(t.totalPnl).toBe(200)
    expect(t.totalPnlPct).toBeCloseTo(20)
  })

  it('sin caja el resultado es idéntico al anterior (el default es 0)', () => {
    const positions = valuePositions(
      [{ assetId: 'a1', ticker: 'AAPL', quantity: 10, costBasis: 1000, avgCost: 100 }],
      [{ ticker: 'AAPL', price: 120 }],
      'CLP',
    )
    expect(portfolioTotals(positions).totalValue).toBe(1200)
    expect(portfolioTotals(positions).cashBalance).toBe(0)
  })

  it('un saldo negativo resta del patrimonio y deja el P&L intacto', () => {
    const positions = valuePositions(
      [{ assetId: 'a1', ticker: 'AAPL', quantity: 10, costBasis: 1000, avgCost: 100 }],
      [{ ticker: 'AAPL', price: 120 }],
      'CLP',
    )
    const t = portfolioTotals(positions, -300)
    expect(t.totalValue).toBe(900)
    expect(t.totalPnl).toBe(200)
  })
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test -- valuation`
Expected: FAIL — `Expected 1 arguments, but got 2` en tiempo de tipos, y `t.assetsValue` es `undefined`.

- [ ] **Step 3: Implementar**

En `src/lib/portfolio/valuation.ts`, reemplazar la interfaz `PortfolioTotals` y la función `portfolioTotals` por:

```ts
export interface PortfolioTotals {
  // Patrimonio del portafolio: instrumentos + efectivo. Es el número que
  // responde "cuánto tengo acá".
  totalValue: number
  // Sólo los instrumentos. Se expone aparte porque es el que se compara contra
  // el costo: mezclarlo con la caja haría que un abono pareciera una ganancia.
  assetsValue: number
  cashBalance: number
  totalCost: number
  totalPnl: number
  totalPnlPct: number
  assetCount: number
}

// `cashBalance` viene ya en moneda BASE (lo convierte la frontera, igual que los
// precios) y puede ser NEGATIVO: significa que falta registrar un abono o que el
// bróker dio margen. No se satura a cero — eso escondería el hecho.
export function portfolioTotals(positions: PositionView[], cashBalance = 0): PortfolioTotals {
  const valued = positions.filter((p) => p.marketValue !== null)
  const assetsValue = valued.reduce((s, p) => s + (p.marketValue ?? 0), 0)
  const totalCost = positions.reduce((s, p) => s + p.costBasis, 0)
  const valuedCost = valued.reduce((s, p) => s + p.costBasis, 0)
  // El P&L compara instrumentos contra su costo. La caja queda FUERA a
  // propósito: es patrimonio, no utilidad.
  const totalPnl = assetsValue - valuedCost
  const totalPnlPct = valuedCost > 0 ? (totalPnl / valuedCost) * 100 : 0
  return {
    totalValue: assetsValue + cashBalance,
    assetsValue,
    cashBalance,
    totalCost,
    totalPnl,
    totalPnlPct,
    assetCount: positions.length,
  }
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: **32 archivos, 239 tests, verdes.** Los tests viejos de `portfolioTotals` siguen pasando sin cambios porque el default de `cashBalance` es 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/portfolio/valuation.ts src/lib/portfolio/valuation.test.ts
git commit -m "feat(portfolio): el efectivo entra en el patrimonio, no en el P&L

totalValue = instrumentos + caja. totalPnl sigue comparando instrumentos contra
su costo: si la caja entrara al P&L, un abono de un millon se veria como un
millon de utilidad.

El saldo negativo no se satura a cero: esconderia el hecho de que falta
registrar un abono.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: `computeSnapshotValue` con caja

**Files:**
- Modify: `src/lib/portfolio/snapshot.ts`
- Test: `src/lib/portfolio/snapshot.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Añadir dentro del `describe('computeSnapshotValue', ...)` de `src/lib/portfolio/snapshot.test.ts`:

```ts
  it('suma el saldo de caja al valor de los instrumentos', () => {
    expect(computeSnapshotValue(txs, [{ ticker: 'AAPL', price: 175 }], 'CLP', 250)).toBe(2000)
  })

  it('sin caja se comporta igual que antes', () => {
    expect(computeSnapshotValue(txs, [{ ticker: 'AAPL', price: 175 }], 'CLP')).toBe(1750)
  })
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- snapshot`
Expected: FAIL — `Expected 3 arguments, but got 4`.

- [ ] **Step 3: Implementar**

En `src/lib/portfolio/snapshot.ts`, reemplazar la función por:

```ts
// Valor total del portafolio dado un conjunto de cotizaciones y el saldo de
// caja. Reusa el dominio de Fase 1; devuelve el número que se guarda en
// snapshots.total_value.
//
// `cashBalance` en moneda BASE, igual que las cotizaciones.
export function computeSnapshotValue(
  transactions: Transaction[],
  quotes: Quote[],
  baseCurrency: string,
  cashBalance = 0
): number {
  const holdings = computeHoldings(transactions)
  const positions = valuePositions(holdings, quotes, baseCurrency)
  return portfolioTotals(positions, cashBalance).totalValue
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test`
Expected: **32 archivos, 241 tests, verdes.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/portfolio/snapshot.ts src/lib/portfolio/snapshot.test.ts
git commit -m "feat(portfolio): el snapshot incluye el saldo de caja

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: `/api/positions` lee los saldos

El saldo llega en la moneda en que está el efectivo, que puede no ser la base. Se convierte en la **frontera**, igual que los precios: el dominio sigue recibiendo una sola moneda.

**Files:**
- Modify: `src/app/api/positions/route.ts`

- [ ] **Step 1: Añadir la lectura de saldos al `Promise.all`**

En `src/app/api/positions/route.ts`, localizar el bloque que hoy dice:

```ts
  let txRes: Awaited<typeof txPromise>
  let fxSeries: Awaited<ReturnType<typeof loadFxSeries>>
  try {
    ;[txRes, fxSeries] = await Promise.all([
      txPromise,
      needsFx ? loadFxSeries(supabase) : Promise.resolve([]),
    ])
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'price_cache error' }, { status: 500 })
  }
  if (txRes.error) return NextResponse.json({ error: txRes.error.message }, { status: 500 })
```

y reemplazarlo por:

```ts
  // Los saldos viajan en el mismo viaje que las transacciones: son
  // independientes entre sí y esperar uno detrás del otro no aporta nada.
  const balancesPromise = supabase
    .from('cash_balances')
    .select('currency, balance')
    .eq('portfolio_id', ctx.id)

  let txRes: Awaited<typeof txPromise>
  let fxSeries: Awaited<ReturnType<typeof loadFxSeries>>
  let balancesRes: Awaited<typeof balancesPromise>
  try {
    ;[txRes, fxSeries, balancesRes] = await Promise.all([
      txPromise,
      needsFx ? loadFxSeries(supabase) : Promise.resolve([]),
      balancesPromise,
    ])
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'price_cache error' }, { status: 500 })
  }
  if (txRes.error) return NextResponse.json({ error: txRes.error.message }, { status: 500 })
  if (balancesRes.error) return NextResponse.json({ error: balancesRes.error.message }, { status: 500 })
```

- [ ] **Step 2: Convertir el saldo a moneda base y pasarlo a los totales**

Localizar:

```ts
  const positions = valuePositions(holdings, quotes, ctx.baseCurrency, native)
  const totals = portfolioTotals(positions)
```

y reemplazar por:

```ts
  // El saldo se convierte al FX de HOY, igual que el valor de mercado: es plata
  // que tienes ahora, no un costo histórico. Un saldo en una moneda sin FX
  // disponible se DESCARTA en vez de sumarse sin convertir — sumar dólares como
  // si fueran pesos inflaría el patrimonio ~950 veces en silencio.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const cashBalance = (balancesRes.data ?? []).reduce((sum: number, row: any) => {
    const amount = Number(row.balance)
    if (row.currency === ctx.baseCurrency) return sum + amount
    if (row.currency === 'USD' && ctx.baseCurrency === 'CLP' && fxToday !== null) {
      return sum + amount * fxToday
    }
    return sum
  }, 0)
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const positions = valuePositions(holdings, quotes, ctx.baseCurrency, native)
  const totals = portfolioTotals(positions, cashBalance)
```

`fxToday` ya está declarado más arriba en el archivo — no hay que crearlo.

- [ ] **Step 3: Verificar**

Run: `npm run build`
Expected: build exitoso.

Run: `npm test`
Expected: 32 archivos, 241 tests, verdes.

- [ ] **Step 4: Verificar a mano**

Run: `npm run dev`, abrir `http://localhost:3000/nacional/dashboard`.
Expected: el KPI "Valor Total" cambió respecto a antes — ahora incluye el saldo. "Retorno Total" **no** cambió.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/positions/route.ts
git commit -m "feat(api): las posiciones incluyen el saldo de caja en el patrimonio

El saldo se convierte al FX de hoy en la frontera, igual que el valor de
mercado. Un saldo en moneda sin FX se descarta en vez de sumarse sin convertir:
sumar dolares como pesos inflaria el patrimonio ~950 veces sin avisar.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 11: El escritor de snapshots incluye la caja

**Files:**
- Modify: `src/app/api/prices/refresh/route.ts:160-200`

- [ ] **Step 1: Leer el saldo dentro de `snapshotPortfolio`**

En `src/app/api/prices/refresh/route.ts`, dentro de la función `snapshotPortfolio`, después del bloque que lee `transactions` y antes de `if (computeHoldings(transactions).length === 0) return null`, insertar:

```ts
  const { data: balanceRows, error: balErr } = await supabase
    .from('cash_balances')
    .select('currency, balance')
    .eq('portfolio_id', portfolio.id)
  if (balErr) {
    console.error(`snapshot ${portfolio.slug}: no se pudieron leer saldos:`, balErr.message)
    return null
  }
```

- [ ] **Step 2: Cambiar la guarda de portafolio vacío**

Reemplazar:

```ts
  if (computeHoldings(transactions).length === 0) return null
```

por:

```ts
  // Un portafolio sin posiciones PERO con efectivo sigue teniendo patrimonio y
  // merece su punto en la serie. Antes bastaba con no tener holdings porque el
  // valor era cero por definición; ahora no lo es.
  const hasCash = (balanceRows ?? []).some((r: any) => Number(r.balance) !== 0)
  if (computeHoldings(transactions).length === 0 && !hasCash) return null
```

- [ ] **Step 3: Convertir el saldo y sumarlo al valor**

Reemplazar el bloque:

```ts
    totalValue = computeSnapshotValue(
      transactionsToBaseCurrency(transactions, currencyByTicker, fxSeries, base),
      baseQuotes,
      base
    )
```

por:

```ts
    // Mismo criterio que /api/positions: FX de hoy, y se descarta lo que no se
    // pueda convertir en vez de sumarlo sin convertir.
    const cashBalance = (balanceRows ?? []).reduce((sum: number, row: any) => {
      const amount = Number(row.balance)
      if (row.currency === base) return sum + amount
      if (row.currency === 'USD' && base === 'CLP' && fxToday !== null) return sum + amount * fxToday
      return sum
    }, 0)

    totalValue = computeSnapshotValue(
      transactionsToBaseCurrency(transactions, currencyByTicker, fxSeries, base),
      baseQuotes,
      base,
      cashBalance
    )
```

- [ ] **Step 4: Marcar la fila como completa**

En el `upsert` de snapshots, añadir el campo:

```ts
  const { error: snapErr } = await supabase.from('snapshots').upsert(
    {
      user_id: userId,
      portfolio_id: portfolio.id,
      snapshot_date: today,
      total_value: totalValue,
      currency: base,
      // La 0010 dejó el histórico marcado; desde acá toda fila nueva nace
      // con el patrimonio completo.
      includes_cash: true,
    },
    { onConflict: 'user_id,portfolio_id,snapshot_date' }
  )
```

- [ ] **Step 5: Verificar**

Run: `npm run build`
Expected: build exitoso.

Run: `npm test`
Expected: 32 archivos, 241 tests, verdes.

- [ ] **Step 6: Verificar a mano**

Run: `npm run dev`, ir a `/data-sources` y pulsar "Actualizar precios".

Luego, en el SQL Editor:

```sql
select p.slug, s.snapshot_date, s.total_value, s.currency, s.includes_cash
from snapshots s join portfolios p on p.id = s.portfolio_id
order by s.snapshot_date desc limit 4;
```

Expected: las filas de hoy tienen `includes_cash = true` y un `total_value` coherente con el patrimonio del dashboard.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/prices/refresh/route.ts
git commit -m "feat(api): el snapshot diario incluye la caja y se marca como completo

Ademas cambia la guarda de portafolio vacio: un portafolio sin posiciones pero
con efectivo tiene patrimonio y merece su punto en la serie. Antes no tenerlo
era correcto porque el valor era cero por definicion; ahora no lo es.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 12: El dashboard muestra el efectivo

**Files:**
- Modify: `src/app/(app)/[portfolio]/dashboard/page.tsx`

- [ ] **Step 1: Ampliar la interfaz `Totals`**

En `src/app/(app)/[portfolio]/dashboard/page.tsx`, reemplazar la interfaz `Totals` por:

```ts
interface Totals {
  totalValue: number
  assetsValue: number
  cashBalance: number
  totalCost: number
  totalPnl: number
  totalPnlPct: number
  assetCount: number
  dailyPnl: number
}
```

- [ ] **Step 2: Cambiar la fila de KPIs**

Reemplazar el bloque `<section className="grid grid-cols-2 gap-3 lg:grid-cols-4">…</section>` por:

```tsx
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Valor Total" value={totals ? fmt(totals.totalValue) : '—'} />
        <KpiCard
          label="Efectivo"
          value={totals ? fmt(totals.cashBalance) : '—'}
          accent={totals && totals.cashBalance < 0 ? 'down' : undefined}
        />
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

      {totals && totals.cashBalance < 0 && (
        <p className="rounded-lg border border-amber-900 bg-amber-950/40 px-4 py-3 text-sm text-amber-400">
          El saldo de efectivo es negativo. Significa que falta registrar un abono en{' '}
          <a href={`/${portfolio}/portfolio`} className="underline">Portafolio → Efectivo</a>, o que
          el bróker te dio margen. El patrimonio de arriba lo está descontando.
        </p>
      )}
```

**Nota sobre "Retorno Total":** sigue midiendo sólo los instrumentos contra su costo, mientras que "Valor Total" incluye la caja. No es incoherencia: es P&L no realizado de posiciones abiertas. El retorno que sí incluye el arrastre del efectivo es el TWR de `/analytics`.

- [ ] **Step 3: Verificar**

Run: `npm run build`
Expected: build exitoso.

Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 4: Verificar a mano**

Run: `npm run dev`, abrir `/nacional/dashboard` y `/internacional/dashboard`.
Expected: cinco KPI cards, "Efectivo" con el saldo real, y —si es negativo— el aviso ámbar con el enlace a la sección de efectivo.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/[portfolio]/dashboard/page.tsx"
git commit -m "feat(ui): KPI de efectivo y aviso de saldo negativo en el dashboard

Retorno Total sigue midiendo solo instrumentos contra su costo mientras Valor
Total incluye la caja. No es incoherencia: es P&L no realizado de posiciones
abiertas. El retorno que incluye el arrastre del efectivo es el TWR.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Rebanada 6 — Los flujos externos se leen del libro

## Task 13: `flowsToBaseCurrency`

**Files:**
- Modify: `src/lib/analytics/types.ts`
- Modify: `src/lib/fx/convert.ts`
- Test: `src/lib/fx/convert.test.ts`

- [ ] **Step 1: Crear el tipo `ExternalFlow`**

Va acá y no en la Tarea 14 porque esta tarea es la primera que lo necesita. Añadir al final de `src/lib/analytics/types.ts`:

```ts
// Movimiento de capital que ENTRA o SALE del portafolio, ya en moneda base.
// Positivo = entra (abono, o la pata de llegada de una conversión).
// Negativo = sale (retiro, o la pata de salida).
//
// Las compras y ventas NO son flujos externos: son canjes entre caja y activo
// dentro del mismo portafolio, y no mueven el patrimonio.
export interface ExternalFlow {
  occurredAt: string // YYYY-MM-DD
  amount: number
}
```

- [ ] **Step 2: Escribir los tests que fallan**

Añadir al final de `src/lib/fx/convert.test.ts`:

```ts
describe('flowsToBaseCurrency', () => {
  const fx = [
    { date: '2026-06-10', price: 900, adjPrice: 900 },
    { date: '2026-06-20', price: 950, adjPrice: 950 },
  ]

  it('un flujo ya en moneda base pasa intacto', () => {
    const out = flowsToBaseCurrency(
      [{ occurredAt: '2026-06-15', amount: 500000, currency: 'CLP' }],
      fx,
      'CLP',
    )
    expect(out).toEqual([{ occurredAt: '2026-06-15', amount: 500000 }])
  })

  it('convierte al FX de SU fecha, no al de hoy', () => {
    const out = flowsToBaseCurrency(
      [{ occurredAt: '2026-06-15', amount: 1000, currency: 'USD' }],
      fx,
      'CLP',
    )
    // Forward-fill: el 15 usa el último FX publicado (el del 10) = 900.
    expect(out[0].amount).toBe(900000)
  })

  it('conserva el signo de un retiro', () => {
    const out = flowsToBaseCurrency(
      [{ occurredAt: '2026-06-25', amount: -1000, currency: 'USD' }],
      fx,
      'CLP',
    )
    expect(out[0].amount).toBe(-950000)
  })

  it('LANZA si falta el FX de la fecha, en vez de descartar el flujo', () => {
    // Descartar un flujo no encoge la muestra: falsea el P&L absoluto, porque
    // un abono no contado se ve como ganancia. Mismo criterio que
    // `transactionsToBaseCurrency`.
    expect(() =>
      flowsToBaseCurrency([{ occurredAt: '2026-01-01', amount: 1000, currency: 'USD' }], fx, 'CLP'),
    ).toThrow(/tipo de cambio/)
  })

  it('rechaza un par de monedas no soportado', () => {
    expect(() =>
      flowsToBaseCurrency([{ occurredAt: '2026-06-15', amount: 10, currency: 'EUR' }], fx, 'CLP'),
    ).toThrow(/conversión no soportada/)
  })
})
```

Ampliar el import del principio del archivo para incluir `flowsToBaseCurrency`.

- [ ] **Step 3: Correr los tests y verificar que fallan**

Run: `npm test -- convert`
Expected: FAIL — `flowsToBaseCurrency is not a function`.

- [ ] **Step 4: Implementar**

Añadir al final de `src/lib/fx/convert.ts`:

```ts
// Flujos de caja externos a la moneda base, al FX de SU fecha — mismo criterio
// que `transactionsToBaseCurrency`: un abono de junio vale lo que valía en
// junio, no lo que valdría hoy.
//
// Y como allá, la falta de FX LANZA en vez de descartar. Descartar un punto de
// precio sólo encoge la muestra; descartar un flujo falsea el P&L absoluto,
// porque capital que entró y no se contó aparece como ganancia.
export function flowsToBaseCurrency(
  flows: { occurredAt: string; amount: number; currency: string }[],
  fxSeries: PricePointAdj[],
  baseCurrency: string
): ExternalFlow[] {
  return flows.map((f) => {
    if (f.currency === baseCurrency) return { occurredAt: f.occurredAt, amount: f.amount }
    if (!(f.currency === 'USD' && baseCurrency === 'CLP')) {
      throw new Error(`conversión no soportada: ${f.currency} → ${baseCurrency}`)
    }
    const rate = fxAsOf(fxSeries, f.occurredAt)
    if (rate === null) {
      throw new Error(`falta tipo de cambio ${FX_TICKER} para el flujo del ${f.occurredAt}`)
    }
    return { occurredAt: f.occurredAt, amount: f.amount * rate }
  })
}
```

Y ampliar el import del principio de `convert.ts`:

```ts
import type { PricePointAdj, PriceSeriesByTicker, ExternalFlow } from '@/lib/analytics/types'
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: **32 archivos, 246 tests, verdes.**

- [ ] **Step 6: Commit**

```bash
git add src/lib/fx/convert.ts src/lib/fx/convert.test.ts src/lib/analytics/types.ts
git commit -m "feat(fx): conversion de flujos de caja al FX de su fecha

Lanza si falta el FX en vez de descartar el flujo: descartar un punto de precio
encoge la muestra, descartar un flujo falsea el P&L absoluto porque capital que
entro y no se conto aparece como ganancia.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 14: `netFlows` lee flujos en vez de inferirlos

El corazón del proyecto. `externalFlows` es un campo **obligatorio** de `AnalyticsInput`, no opcional con default: un llamador que lo olvide produciría un P&L silenciosamente inflado, que es exactamente el fallo que este proyecto vino a cerrar.

**Files:**
- Modify: `src/lib/analytics/engine.ts:17-51,113-115`
- Test: `src/lib/analytics/engine.test.ts` (5 llamadas + tests nuevos)
- Test: `src/lib/analytics/windowing.test.ts:75` (1 llamada)
- Test: `src/lib/fx/calendar-protection.test.ts:32` (1 llamada)

- [ ] **Step 1: Escribir los tests que fallan**

Añadir al final de `src/lib/analytics/engine.test.ts`:

```ts
describe('flujos externos', () => {
  // Los mismos datos del resto del archivo: compra de 10 AAPL a 100 el 2024-01-02,
  // precio 121 el 2024-01-04. Valor final 1210, costo 1000.
  const args = {
    transactions: txs,
    priceSeries,
    benchmarkSeries: null,
    benchmarkTicker: 'SPY',
    assetTypeByTicker: new Map([['AAPL', 'stock']]),
    period: 'ALL' as const,
    today: '2024-01-04',
  }

  it('un abono dentro de la ventana NO cuenta como ganancia', () => {
    const res = computeAnalytics({
      ...args,
      externalFlows: [{ occurredAt: '2024-01-03', amount: 500 }],
    })
    // Sin el abono el P&L sería 210. El abono entró y salió del bolsillo, no del
    // mercado: (1210 − 1000) − 500 = −290.
    expect(res.summary.absolutePnl).toBeCloseTo(-290)
  })

  it('un retiro suma al P&L: el patrimonio bajó sin que el mercado lo hiciera', () => {
    const res = computeAnalytics({
      ...args,
      externalFlows: [{ occurredAt: '2024-01-03', amount: -300 }],
    })
    expect(res.summary.absolutePnl).toBeCloseTo(510)
  })

  it('la ventana es (from, to]: un flujo el día de inicio queda FUERA', () => {
    const res = computeAnalytics({
      ...args,
      externalFlows: [{ occurredAt: '2024-01-02', amount: 500 }],
    })
    // El 2024-01-02 es el inicio del período; su valor ya está en startValue.
    expect(res.summary.absolutePnl).toBeCloseTo(210)
  })

  it('un flujo el último día SÍ cuenta', () => {
    const res = computeAnalytics({
      ...args,
      externalFlows: [{ occurredAt: '2024-01-04', amount: 500 }],
    })
    expect(res.summary.absolutePnl).toBeCloseTo(-290)
  })

  it('las compras y ventas ya NO son flujos: sin movimientos externos el P&L es el de mercado', () => {
    // Esta es la corrección de fondo del proyecto. La compra de 10×100 está en
    // `txs` y antes se contaba como flujo externo; ahora es un canje de caja por
    // activo y no mueve el patrimonio.
    const res = computeAnalytics({ ...args, externalFlows: [] })
    expect(res.summary.absolutePnl).toBeCloseTo(210)
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test -- engine`
Expected: FAIL — `externalFlows` no existe en `AnalyticsInput`.

- [ ] **Step 3: Cambiar el motor**

El tipo `ExternalFlow` ya existe: lo creó la Tarea 13 en `src/lib/analytics/types.ts`.

En `src/lib/analytics/engine.ts`:

**(a)** Ampliar el import de tipos:

```ts
import type { AnalyticsResult, ExternalFlow, Period, PricePointAdj, PriceSeriesByTicker } from './types'
```

**(b)** Añadir el campo a `AnalyticsInput`, después de `transactions`:

```ts
export interface AnalyticsInput {
  transactions: Transaction[]
  // OBLIGATORIO, sin default. Un llamador que lo olvidara produciría un P&L
  // absoluto inflado —capital aportado contado como ganancia— y nada lo
  // delataría. Es exactamente el fallo silencioso que este proyecto cerró.
  externalFlows: ExternalFlow[]
  priceSeries: PriceSeriesByTicker
  benchmarkSeries: PricePointAdj[] | null
  benchmarkTicker: string
  assetTypeByTicker: Map<string, string>
  period: Period
  today: string
}
```

**(c)** Reemplazar la función `netFlows` completa:

```ts
// Flujos netos en (from, to]. Antes se INFERÍAN de las transacciones —cada
// compra contaba como capital que entraba— y sólo era correcto porque la caja no
// existía en el modelo. Ahora se leen del libro: los únicos flujos externos son
// abonos, retiros y las patas de las conversiones entre portafolios.
function netFlows(flows: ExternalFlow[], from: string, to: string): number {
  let sum = 0
  for (const f of flows) {
    if (f.occurredAt > from && f.occurredAt <= to) sum += f.amount
  }
  return sum
}
```

**(d)** Ampliar el destructuring de la primera línea de `computeAnalytics`:

```ts
  const { transactions, externalFlows, priceSeries, benchmarkSeries, assetTypeByTicker, period, today } = input
```

**(e)** Cambiar la llamada:

```ts
  const pnl = absolutePnl(startValue, endValue, netFlows(externalFlows, start, today))
```

- [ ] **Step 4: Actualizar los llamadores de test existentes**

Añadir `externalFlows: [],` a cada una de las 7 llamadas a `computeAnalytics` en tests:

- `src/lib/analytics/engine.test.ts` líneas ~30, ~47, ~78, ~113, ~130
- `src/lib/analytics/windowing.test.ts` línea ~75
- `src/lib/fx/calendar-protection.test.ts` línea ~32

En todas, insertar la línea justo después de `transactions: ...`. Los valores esperados de esos tests **no cambian**: en todos ellos las transacciones caen en el día de inicio del período, que la ventana `(from, to]` ya excluía, así que el `netFlows` viejo también daba 0.

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: **32 archivos, 251 tests, verdes.**

Si `engine.test.ts` falla en el test viejo "P&L absoluto en raw: valor final − capital neto aportado", revisar que se le pasó `externalFlows: []` — su valor esperado sigue siendo 210.

- [ ] **Step 6: Commit**

```bash
git add src/lib/analytics/engine.ts src/lib/analytics/engine.test.ts src/lib/analytics/windowing.test.ts src/lib/fx/calendar-protection.test.ts
git commit -m "fix(analytics): los flujos externos se leen, ya no se infieren de las compras

netFlows contaba cada compra como capital que entraba. Solo era correcto porque
la caja no existia en el modelo: sin ella una compra hace aparecer patrimonio de
la nada. Con caja, comprar es un canje y no mueve el total.

externalFlows es OBLIGATORIO y sin default a proposito. Un llamador que lo
olvidara produciria un P&L inflado sin que nada lo delatara, que es la misma
clase de fallo silencioso que origino el proyecto.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 15: `/api/analytics` provee los flujos

**Files:**
- Modify: `src/app/api/analytics/route.ts`

- [ ] **Step 1: Consultar el libro**

En `src/app/api/analytics/route.ts`, justo después del bloque que lee `transactions` y comprueba `txErr`, insertar:

```ts
  // Los flujos externos del portafolio. Las patas de trade quedan fuera por la
  // misma regla que las define: `trade_buy` y `trade_sell` son canjes internos
  // entre caja y activo.
  //
  // `fx_out` SÍ es flujo externo de este portafolio aunque a nivel consolidado
  // sea un traspaso interno: la plata se fue de acá.
  const { data: flowRows, error: flowErr } = await supabase
    .from('cash_ledger')
    .select('currency, amount, occurred_at')
    .eq('portfolio_id', ctx.id)
    .in('movement_type', ['deposit', 'withdrawal', 'fx_in', 'fx_out'])
  if (flowErr) return NextResponse.json({ error: flowErr.message }, { status: 500 })
```

- [ ] **Step 2: Convertirlos y pasarlos al motor**

Localizar el bloque:

```ts
  let baseTransactions: Transaction[]
  try {
    baseTransactions = transactionsToBaseCurrency(transactions, currencyByTicker, fxSeries, ctx.baseCurrency)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error de conversión' }, { status: 500 })
  }
```

y reemplazarlo por:

```ts
  let baseTransactions: Transaction[]
  let externalFlows: ExternalFlow[]
  try {
    baseTransactions = transactionsToBaseCurrency(transactions, currencyByTicker, fxSeries, ctx.baseCurrency)
    /* eslint-disable @typescript-eslint/no-explicit-any */
    externalFlows = flowsToBaseCurrency(
      (flowRows ?? []).map((r: any) => ({
        occurredAt: r.occurred_at,
        amount: Number(r.amount),
        currency: r.currency,
      })),
      fxSeries,
      ctx.baseCurrency
    )
    /* eslint-enable @typescript-eslint/no-explicit-any */
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error de conversión' }, { status: 500 })
  }
```

- [ ] **Step 3: Pasarlo a `computeAnalytics`**

En la llamada a `computeAnalytics`, añadir el campo justo después de `transactions`:

```ts
  const result = computeAnalytics({
    transactions: baseTransactions,
    externalFlows,
    priceSeries: toBaseCurrency(priceSeries, currencyByTicker, fxSeries, ctx.baseCurrency),
```

- [ ] **Step 4: Ampliar los imports**

```ts
import { toBaseCurrency, convertSeries, transactionsToBaseCurrency, flowsToBaseCurrency } from '@/lib/fx/convert'
import type { ExternalFlow, Period, PricePointAdj, PriceSeriesByTicker } from '@/lib/analytics/types'
```

- [ ] **Step 5: Verificar**

Run: `npm run build`
Expected: build exitoso.

Run: `npm test`
Expected: 32 archivos, 251 tests, verdes.

- [ ] **Step 6: Verificar a mano**

Run: `npm run dev`, abrir `/nacional/analytics` y `/internacional/analytics`.

Expected: **el "P&L Absoluto" cambió de valor respecto a antes.** Es la corrección, no una regresión: antes descontaba las compras como si fueran capital aportado; ahora descuenta el capital que de verdad aportaste. Comparar contra el saldo del bróker: el nuevo número debería tener sentido como "cuánto gané de verdad".

Si aparece un error de tipo de cambio faltante, es que hay un flujo en una fecha anterior al histórico de `USDCLP=X`: correr el backfill en `/data-sources`.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/analytics/route.ts
git commit -m "feat(api): la analitica lee los flujos externos del libro de caja

Filtra a deposit, withdrawal, fx_in y fx_out. Las patas de trade quedan fuera
por la misma regla que las define. Un fx_out cuenta como flujo externo de este
portafolio aunque a nivel consolidado sea un traspaso interno: la plata se fue.

El P&L absoluto de /analytics cambia de valor. Es la correccion.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 16: Documentación

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/ROADMAP.md`

- [ ] **Step 1: Añadir la sección de caja al README**

Insertar en `README.md`, después de la sección de multi-moneda y antes de "## Páginas":

```markdown
## Contabilidad de caja

Cada portafolio tiene un **saldo líquido real**. Las ventas depositan, las compras retiran, y
los abonos y retiros de capital se registran a mano.

- **La pata de caja de un trade no se almacena: se proyecta.** Una compra ya contiene su efecto
  en caja (`−(cantidad × precio + fees)`), así que la vista `cash_ledger` lo lee desde la propia
  transacción en vez de mantener una fila espejo sincronizada por un trigger. Editar la
  transacción mueve su pata sola; borrarla la elimina sola.
- **Una conversión de divisa es un hecho con dos efectos**, no dos filas enlazadas: `fx_transfers`
  guarda las dos patas en una fila, así que ninguna puede quedar huérfana. La tasa efectiva y el
  costo del spread se derivan (`fx_transfers_audit`), nunca se almacenan.
- **El efectivo entra en el patrimonio pero no en el P&L.** Tener plata en la cuenta no es una
  ganancia; el arrastre que produce (*cash drag*) sí aparece en el TWR.
- **El saldo negativo se permite y se advierte.** Significa que falta registrar un abono, o que el
  bróker dio margen — es información, no corrupción.

Ver [spec del Proyecto 3.1](docs/superpowers/specs/2026-08-31-proyecto-3-1-contabilidad-de-caja-design.md).
```

- [ ] **Step 2: Marcar el proyecto como implementado en el ROADMAP**

En `docs/superpowers/plans/ROADMAP.md`, en la fila `3.1` de la tabla del ciclo post-MVP, cambiar `**Pendiente**` por `**Implementada**` y añadir el enlace al plan junto al del spec:

```markdown
| 3.1 | Contabilidad de caja ([plan](2026-09-01-proyecto-3-1-contabilidad-de-caja.md), [spec](../specs/2026-08-31-proyecto-3-1-contabilidad-de-caja-design.md)) | Saldo líquido real por portafolio: `cash_movements` y `fx_transfers` como hechos, `cash_ledger` como proyección (sin triggers ni tablas duplicadas), reconstrucción del histórico desde junio, el efectivo entra en `total_value` y los flujos externos dejan de inferirse de las compras | **Implementada** |
```

- [ ] **Step 3: Verificación final completa**

Run: `npm test`
Expected: **32 archivos, 251 tests, verdes.**

Run: `npm run lint`
Expected: sin errores.

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/plans/ROADMAP.md
git commit -m "docs: la contabilidad de caja en el README y el ROADMAP

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Resumen de conteos de tests

| Después de la tarea | Archivos | Tests |
|---|---|---|
| (línea base) | 32 | 227 |
| 1 — schemas | 32 | 235 |
| 4 — invalidación | 32 | 236 |
| 8 — `portfolioTotals` | 32 | 239 |
| 9 — `computeSnapshotValue` | 32 | 241 |
| 13 — `flowsToBaseCurrency` | 32 | 246 |
| 14 — `netFlows` | 32 | 251 |

Las tareas 2, 3, 5, 6, 7, 10, 11, 12, 15 y 16 no añaden tests: son rutas API delgadas, UI (el proyecto no tiene jsdom), SQL, o documentación. Su verificación es `npm run build`, la comprobación manual indicada en cada una, y el bloque de verificación de la migración.
