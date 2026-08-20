# Limpieza — Eliminar Backtest y Escenarios · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar Backtest y Escenarios como funcionalidad visible, rescatando hacia `src/lib/analytics/` el simulador de carteras hipotéticas y el cálculo de beta, sin alterar el comportamiento de ninguna pantalla en uso.

**Architecture:** Se borra de afuera hacia adentro. Primero las páginas y rutas API (que son los únicos consumidores externos de ambas librerías), lo que deja `src/lib/backtest/` y `src/lib/scenarios/` sin nadie que los importe. Recién entonces se mueve el código rescatable a `analytics/` y se borra el resto. Este orden mantiene el árbol compilando y los tests verdes después de **cada** tarea, en vez de pasar por un estado intermedio roto.

**Tech Stack:** Next.js 16 (App Router) · TypeScript · Vitest · ESLint · Tailwind 4

**Spec:** [2026-08-19-limpieza-backtest-escenarios-design.md](../specs/2026-08-19-limpieza-backtest-escenarios-design.md)

---

## Contexto que el ingeniero necesita

**El proyecto es una app personal de gestión de portafolio.** Node ≥ 18.18, `npm install` ya corrido. Comandos: `npm test` (Vitest), `npm run lint` (ESLint), `npm run build` (build de producción), `npm run dev` (dev server en :3000).

**Línea base medida el 2026-08-19:** `npm test` → **31 archivos, 212 tests, todos verdes.** Cada tarea de este plan indica el conteo exacto esperado después de ejecutarla. Si el número no coincide, algo se movió mal — no seguir a la tarea siguiente.

**Alias de imports:** el proyecto usa `@/` → `src/` (ver `tsconfig.json`). Dentro de `src/lib/analytics/` la convención establecida es **importar con rutas relativas** (`./series`, `./types`), no con `@/lib/analytics/...`. Los archivos que se muevan a `analytics/` deben seguir esa convención.

**Por qué no hay TDD en las tareas 1-3 y 5:** son borrados y movimientos de archivos, no comportamiento nuevo. Los tests existentes viajan con el código y siguen siendo la red de seguridad. La única lógica nueva del plan es la función `beta()` de la Tarea 4, y esa **sí** se hace con TDD estricto.

**Rama:** el trabajo va en `limpieza/backtest-escenarios`, que ya existe y ya contiene el spec. Verificar con `git branch --show-current` antes de empezar.

---

## Estructura de archivos

### Se crea

| Archivo | Responsabilidad |
|---|---|
| `src/lib/analytics/synthetic/simulate.ts` | Simula una cartera de pesos fijos con reanclaje periódico. Devuelve curva de capital + turnover |
| `src/lib/analytics/synthetic/weights.ts` | Construcción y validación de vectores de pesos (`equalWeights`, `normalizeWeights`, `validateWeights`) |
| `src/lib/analytics/synthetic/schedule.ts` | Calendario de fechas de rebalanceo (mensual / trimestral) |
| `src/lib/analytics/synthetic/types.ts` | `EquityPoint` y `RebalanceFrequency` |
| `src/lib/analytics/beta.ts` | Beta histórica vs. benchmark: alineación, cálculo y umbral mínimo de observaciones |

### Se modifica

| Archivo | Cambio |
|---|---|
| `src/components/sidebar.tsx` | Quitar 2 entradas del array `links` |
| `README.md` | 8 pasajes que describen funcionalidad que deja de existir |
| `docs/superpowers/plans/ROADMAP.md` | Marcar Fases 4 y 5 como eliminadas + agregar el ciclo post-MVP |

### Se borra

`src/app/(app)/backtest/` · `src/app/(app)/scenarios/` · `src/app/api/backtest/` · `src/app/api/scenarios/` · `src/lib/backtest/` · `src/lib/scenarios/`

---

## Task 1: Borrar la UI de Escenarios

Se empieza por acá porque `src/app/api/scenarios/route.ts` es el **único** consumidor externo de `src/lib/scenarios/`. Al borrarlo, esa librería queda aislada y la Tarea 4 puede podarla sin romper nada.

**Files:**
- Delete: `src/app/(app)/scenarios/page.tsx`
- Delete: `src/app/api/scenarios/route.ts`
- Modify: `src/components/sidebar.tsx:14`

- [ ] **Step 1: Borrar la página y la ruta API**

```bash
git rm -r "src/app/(app)/scenarios" src/app/api/scenarios
```

- [ ] **Step 2: Quitar el link del sidebar**

En `src/components/sidebar.tsx`, borrar esta línea del array `links`:

```tsx
  { href: '/scenarios', label: 'Escenarios' },
```

El array queda así (nótese que `/backtest` **todavía sigue** — se va en la Tarea 2):

```tsx
const links = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/portfolio', label: 'Portafolio' },
  { href: '/analytics', label: 'Analítica' },
  { href: '/backtest', label: 'Backtest' },
  { href: '/alerts', label: 'Alertas' },
  { href: '/data-sources', label: 'Fuentes de datos' },
  { href: '/settings', label: 'Configuración' },
]
```

- [ ] **Step 3: Verificar que no quedaron referencias a la ruta**

Run: `grep -rn "href=\"/scenarios\"\|'/scenarios'" src`
Expected: sin resultados.

Este grep va contra el link entrecomillado, no contra la cadena `/scenarios` a secas: esa última aparecería en los comentarios de cabecera de `src/lib/scenarios/*.ts`, que todavía existen a esta altura y se borran en la Tarea 4. El grep de residuos general va en la Tarea 6.

- [ ] **Step 4: Correr los tests**

Run: `npm test`
Expected: **31 archivos, 212 tests, verdes.** El conteo NO cambia: `src/lib/scenarios/` sigue existiendo con sus 3 archivos de test (`beta`, `engine`, `stress`). Solo se borró la UI.

- [ ] **Step 5: Correr el build**

Run: `npm run build`
Expected: build exitoso. Es el paso que caza cualquier import colgante hacia la página o la ruta borradas.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: eliminar la UI de Escenarios (página, API y link)"
```

---

## Task 2: Borrar la UI de Backtest

Misma lógica: `src/app/api/backtest/route.ts` es el único consumidor externo de `src/lib/backtest/`.

**Files:**
- Delete: `src/app/(app)/backtest/page.tsx`
- Delete: `src/app/api/backtest/route.ts`
- Modify: `src/components/sidebar.tsx`

- [ ] **Step 1: Borrar la página y la ruta API**

```bash
git rm -r "src/app/(app)/backtest" src/app/api/backtest
```

- [ ] **Step 2: Quitar el link del sidebar**

En `src/components/sidebar.tsx`, borrar esta línea del array `links`:

```tsx
  { href: '/backtest', label: 'Backtest' },
```

El array queda en su forma final, con 6 entradas:

```tsx
const links = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/portfolio', label: 'Portafolio' },
  { href: '/analytics', label: 'Analítica' },
  { href: '/alerts', label: 'Alertas' },
  { href: '/data-sources', label: 'Fuentes de datos' },
  { href: '/settings', label: 'Configuración' },
]
```

- [ ] **Step 3: Correr los tests**

Run: `npm test`
Expected: **31 archivos, 212 tests, verdes.** Igual que antes, el conteo no cambia: `src/lib/backtest/` sigue intacto con sus 5 archivos de test.

- [ ] **Step 4: Correr el build**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 5: Verificar el sidebar en el navegador**

Run: `npm run dev`
Abrir http://localhost:3000/dashboard y confirmar que el sidebar muestra exactamente 6 links: Dashboard · Portafolio · Analítica · Alertas · Fuentes de datos · Configuración.

Detener el server con Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: eliminar la UI de Backtest (página, API y link)"
```

---

## Task 3: Rescatar el simulador a `analytics/synthetic/`

Ahora `src/lib/backtest/` no tiene consumidores externos. Se mueven las 3 piezas reutilizables + sus tests, se crea un `types.ts` podado, y se borra el resto.

**Files:**
- Create: `src/lib/analytics/synthetic/types.ts`
- Move: `src/lib/backtest/rebalance.ts` → `src/lib/analytics/synthetic/simulate.ts`
- Move: `src/lib/backtest/rebalance.test.ts` → `src/lib/analytics/synthetic/simulate.test.ts`
- Move: `src/lib/backtest/weights.ts` (+ `.test.ts`) → `src/lib/analytics/synthetic/`
- Move: `src/lib/backtest/schedule.ts` (+ `.test.ts`) → `src/lib/analytics/synthetic/`
- Delete: `src/lib/backtest/` (lo que queda: `engine.ts`, `metrics.ts`, `types.ts` y sus tests)

- [ ] **Step 1: Crear el directorio y mover los archivos**

`git mv` preserva el historial de cada archivo, cosa que `mv` + `git add` no garantiza.

```bash
mkdir -p src/lib/analytics/synthetic
git mv src/lib/backtest/rebalance.ts      src/lib/analytics/synthetic/simulate.ts
git mv src/lib/backtest/rebalance.test.ts src/lib/analytics/synthetic/simulate.test.ts
git mv src/lib/backtest/weights.ts        src/lib/analytics/synthetic/weights.ts
git mv src/lib/backtest/weights.test.ts   src/lib/analytics/synthetic/weights.test.ts
git mv src/lib/backtest/schedule.ts       src/lib/analytics/synthetic/schedule.ts
git mv src/lib/backtest/schedule.test.ts  src/lib/analytics/synthetic/schedule.test.ts
```

- [ ] **Step 2: Crear `synthetic/types.ts` con solo los dos tipos que sobreviven**

El `types.ts` original tenía 7 declaraciones; 5 eran contratos de la página de backtest (`BacktestConfig`, `StrategyLine`, `VsBenchmark`, `BacktestResult`, `RunBacktestInput`) y se van con ella.

Crear `src/lib/analytics/synthetic/types.ts`:

```ts
// src/lib/analytics/synthetic/types.ts
// Tipos de las carteras sintéticas (benchmarks hipotéticos sobre la cartera real).

export type RebalanceFrequency = 'monthly' | 'quarterly'

export interface EquityPoint {
  date: string // YYYY-MM-DD
  value: number // valor de la cartera simulada ese día
}
```

- [ ] **Step 3: Arreglar la cabecera y los imports de `simulate.ts`**

En `src/lib/analytics/synthetic/simulate.ts`, reemplazar las 4 primeras líneas:

```ts
// src/lib/backtest/rebalance.ts
import { priceAsOf } from '@/lib/analytics/series'
import type { PriceSeriesByTicker } from '@/lib/analytics/types'
import type { EquityPoint } from './types'
```

por:

```ts
// src/lib/analytics/synthetic/simulate.ts
import { priceAsOf } from '../series'
import type { PriceSeriesByTicker } from '../types'
import type { EquityPoint } from './types'
```

El resto del archivo (`adjAt` y `simulateLine`) **no se toca**.

- [ ] **Step 4: Arreglar la cabecera y los imports de `simulate.test.ts`**

Reemplazar las 4 primeras líneas:

```ts
// src/lib/backtest/rebalance.test.ts
import { describe, it, expect } from 'vitest'
import { simulateLine } from './rebalance'
import type { PriceSeriesByTicker } from '@/lib/analytics/types'
```

por:

```ts
// src/lib/analytics/synthetic/simulate.test.ts
import { describe, it, expect } from 'vitest'
import { simulateLine } from './simulate'
import type { PriceSeriesByTicker } from '../types'
```

El resto del archivo **no se toca**.

- [ ] **Step 5: Arreglar las cabeceras de `weights.ts`, `schedule.ts` y sus tests**

Solo cambia el comentario de la primera línea de cada archivo — los imports de estos cuatro ya son correctos (`./weights`, `./schedule`, `./types` siguen resolviendo igual en el directorio nuevo).

En `weights.ts`, reemplazar las 3 primeras líneas:

```ts
// src/lib/backtest/weights.ts
// Pesos objetivo del backtest. El default 1/N evita el sesgo de retrospectiva
// (ver Decisión 1b del spec); "Mis pesos actuales" se calcula en la UI.
```

por:

```ts
// src/lib/analytics/synthetic/weights.ts
// Pesos objetivo de una cartera sintética. `equalWeights` es la base del
// benchmark equiponderado (ver §9.1 del spec de limpieza).
```

En `schedule.ts`, reemplazar la primera línea `// src/lib/backtest/schedule.ts` por `// src/lib/analytics/synthetic/schedule.ts`.

En `weights.test.ts`, reemplazar `// src/lib/backtest/weights.test.ts` por `// src/lib/analytics/synthetic/weights.test.ts`.

En `schedule.test.ts`, reemplazar `// src/lib/backtest/schedule.test.ts` por `// src/lib/analytics/synthetic/schedule.test.ts`.

- [ ] **Step 6: Borrar lo que queda de `src/lib/backtest/`**

```bash
git rm -r src/lib/backtest
```

Esto se lleva `engine.ts` (+9 tests), `metrics.ts` (+7 tests) y el `types.ts` original.

- [ ] **Step 7: Verificar que no quedan referencias**

Run: `grep -rn "lib/backtest" src`
Expected: sin resultados.

- [ ] **Step 8: Correr los tests**

Run: `npm test`
Expected: **29 archivos, 196 tests, verdes.**
Aritmética: 31 − 2 archivos borrados (`engine.test.ts`, `metrics.test.ts`) = 29. 212 − 9 − 7 = 196. Los 3 tests movidos no alteran el conteo.

- [ ] **Step 9: Correr lint y build**

Run: `npm run lint`
Expected: limpio.

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "refactor: rescatar el simulador de carteras a analytics/synthetic"
```

---

## Task 4: Rescatar beta con poda y agregar `beta()` (TDD)

Esta es la única tarea con lógica nueva. Se rescatan `alignedAdjReturns` y `computeBeta`; se descartan `resolveBeta` y `FALLBACK_BETA_BY_TYPE` (Decisión 3 del spec: una beta inventada por tipo de activo presentaría una suposición como si fuera una medición). Como el umbral `MIN_BETA_OBS` vivía **dentro** de `resolveBeta`, hay que reemplazarlo por una función `beta()` que lo aplique — y ese umbral queda parametrizado.

**Files:**
- Create: `src/lib/analytics/beta.ts`
- Create: `src/lib/analytics/beta.test.ts`
- Delete: `src/lib/scenarios/`

- [ ] **Step 1: Crear `beta.ts` con solo lo rescatado, SIN la función nueva**

Crear `src/lib/analytics/beta.ts`. Es el contenido de `src/lib/scenarios/beta.ts` menos `resolveBeta`, menos `FALLBACK_BETA_BY_TYPE` y menos el import de `AssetType`:

```ts
// src/lib/analytics/beta.ts
import type { PricePointAdj } from './types'
import { mean } from './riskMetrics'

// Mínimo de observaciones diarias comunes para fiarse de la beta histórica.
// ~1 mes operativo. Ver §5 del spec de limpieza para la semántica exacta.
export const MIN_BETA_OBS = 20

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
```

- [ ] **Step 2: Crear `beta.test.ts` con los tests rescatados + los 3 tests fallidos de `beta()`**

Crear `src/lib/analytics/beta.test.ts`. Los primeros 4 casos vienen tal cual de `src/lib/scenarios/beta.test.ts`; el bloque `describe('beta', ...)` es nuevo y **debe fallar** porque `beta` todavía no existe:

```ts
// src/lib/analytics/beta.test.ts
import { describe, it, expect } from 'vitest'
import { alignedAdjReturns, computeBeta, beta, MIN_BETA_OBS } from './beta'
import type { PricePointAdj } from './types'

const mk = (rows: [string, number][]): PricePointAdj[] =>
  rows.map(([date, v]) => ({ date, price: v, adjPrice: v }))

// 25 fechas alternando 100/101 → 24 retornos, por encima de MIN_BETA_OBS.
const longSeries = (): PricePointAdj[] => {
  const rows: [string, number][] = Array.from(
    { length: 25 },
    (_, i) => [`2026-05-${String(i + 1).padStart(2, '0')}`, 100 + (i % 2)] as [string, number]
  )
  return mk(rows)
}

// 3 fechas → 2 retornos, por debajo de MIN_BETA_OBS pero suficiente para computeBeta.
const shortSeries = (): PricePointAdj[] =>
  mk([['2026-06-15', 10], ['2026-06-16', 11], ['2026-06-17', 12]])

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

describe('beta', () => {
  it('calcula la beta histórica cuando hay observaciones suficientes', () => {
    const s = longSeries()
    expect(beta(s, s)).toBeCloseTo(1) // serie contra sí misma → beta exactamente 1
  })

  it('null cuando hay menos de MIN_BETA_OBS observaciones', () => {
    const s = shortSeries() // 2 retornos < 20
    expect(beta(s, s)).toBeNull()
  })

  it('respeta un minObs explícito más bajo', () => {
    const s = shortSeries()
    expect(beta(s, s, 2)).toBeCloseTo(1)
    expect(MIN_BETA_OBS).toBe(20) // el default no se ve afectado por el override
  })
})
```

- [ ] **Step 3: Correr los tests nuevos para verificar que FALLAN**

Run: `npx vitest run src/lib/analytics/beta.test.ts`
Expected: **FAIL.** El error es de TypeScript/import: `beta` no está exportado por `./beta`. Los 4 tests de `alignedAdjReturns` y `computeBeta` no llegan a correr porque el import falla primero.

Si este paso PASA, algo está mal: significa que `beta()` ya existe y no se está probando lo que se cree.

- [ ] **Step 4: Implementar `beta()`**

Agregar al final de `src/lib/analytics/beta.ts`:

```ts
// Beta histórica del activo vs. benchmark. Devuelve null —y la UI muestra "—"— cuando
// no hay evidencia suficiente: por debajo de `minObs` observaciones comunes, con varianza
// nula en el benchmark, o si el resultado no es finito. Nunca inventa un valor por
// defecto: una beta supuesta presentada como medición engaña más que un guion.
//
// `minObs` es parámetro (no constante) porque MIN_BETA_OBS asume retornos DIARIOS; sobre
// retornos semanales o mensuales el umbral razonable es otro (§5 del spec de limpieza).
export function beta(
  assetSeries: PricePointAdj[],
  benchSeries: PricePointAdj[],
  minObs: number = MIN_BETA_OBS
): number | null {
  const { rA, rB } = alignedAdjReturns(assetSeries, benchSeries)
  if (rA.length < minObs) return null
  const b = computeBeta(rA, rB)
  return b !== null && Number.isFinite(b) ? b : null
}
```

- [ ] **Step 5: Correr los tests para verificar que PASAN**

Run: `npx vitest run src/lib/analytics/beta.test.ts`
Expected: **PASS — 7 tests** (1 de `alignedAdjReturns` + 3 de `computeBeta` + 3 de `beta`).

- [ ] **Step 6: Borrar `src/lib/scenarios/` completo**

```bash
git rm -r src/lib/scenarios
```

Esto se lleva `beta.ts` y `beta.test.ts` originales (ya reemplazados), `engine.ts` (+4 tests), `stress.ts` (+3 tests) y `types.ts` — que es donde vivía `AssetType`.

- [ ] **Step 7: Verificar que `AssetType` y `lib/scenarios` desaparecieron**

Run: `grep -rn "lib/scenarios" src`
Expected: sin resultados.

Run: `grep -rn "AssetType" src`
Expected: sin resultados.

Este segundo grep es el chequeo que confirma la Decisión 4 del spec: `AssetType` solo vivía dentro de lo que se borró, y el enum canónico sigue intacto en `src/lib/validation/schemas.ts:14` (`z.enum([...])`), que es el que valida el POST de activos.

Run: `grep -n "z.enum" src/lib/validation/schemas.ts`
Expected: la línea 14 con `assetType: z.enum(['stock', 'etf', 'crypto', 'cash', 'other']),` sigue presente.

- [ ] **Step 8: Correr la suite completa**

Run: `npm test`
Expected: **27 archivos, 189 tests, verdes.**
Aritmética: 29 − 2 archivos borrados (`scenarios/engine.test.ts`, `scenarios/stress.test.ts`) = 27. 196 − 4 − 3 = 189. `beta.test.ts` no altera el conteo: perdió 3 casos (2 de `resolveBeta`, 1 de `FALLBACK_BETA_BY_TYPE`) y ganó 3 de `beta()`.

- [ ] **Step 9: Correr lint y build**

Run: `npm run lint`
Expected: limpio.

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: rescatar beta a analytics/ con umbral parametrizable

Se descartan resolveBeta y FALLBACK_BETA_BY_TYPE: esa tabla existía porque
el stress test siempre necesitaba un número que multiplicar. En analítica,
mostrar una beta inventada por tipo de activo presentaría una suposición
como si fuera una medición. Sin datos suficientes se devuelve null y la UI
muestra un guion.

MIN_BETA_OBS vivía dentro de resolveBeta; se reemplaza por beta(), que
aplica el umbral y lo acepta como parámetro para no atarse a retornos
diarios.

AssetType se va con el fallback. El enum canónico ya vive en
validation/schemas.ts."
```

---

## Task 5: Actualizar la documentación

El README describe funcionalidad que ya no existe en 8 pasajes. La documentación histórica (specs y planes de las Fases 4 y 5, y los `.html` de `docs/design/`) **se conserva** — Decisión 6 del spec.

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/ROADMAP.md`

- [ ] **Step 1: Actualizar la descripción y el estado del README**

Reemplazar la línea 3:

```markdown
App web de portafolio personal: gestión de posiciones, analítica, backtesting de estrategias, simulación de escenarios y alertas.
```

por:

```markdown
App web de portafolio personal: gestión de posiciones, analítica de cartera, benchmarks y alertas.
```

Reemplazar la línea 5:

```markdown
> **Estado:** MVP completo (6 fases) + **Fase 7 multi-moneda (base CLP)**. Tests, lint y build en verde. Roadmap, specs y planes de implementación en [docs/superpowers/](docs/superpowers/).
```

por:

```markdown
> **Estado:** MVP completo (6 fases) + **Fase 7 multi-moneda (base CLP)**. Backtest y Escenarios **eliminados** el 2026-08-19 (ver [spec de limpieza](docs/superpowers/specs/2026-08-19-limpieza-backtest-escenarios-design.md)). Tests, lint y build en verde. Roadmap, specs y planes de implementación en [docs/superpowers/](docs/superpowers/).
```

- [ ] **Step 2: Reducir la tabla de módulos de 6 a 4**

Reemplazar el encabezado `## Arquitectura — 6 módulos` por `## Arquitectura — 4 módulos`.

Borrar estas dos filas completas de la tabla:

```markdown
| Backtesting Engine | estrategias · históricos · métricas (Sharpe, Drawdown) |
| Scenario Simulator | **stress test** (shock de mercado × beta + overrides) · vs S&P estresado · what-if/rebalanceo = fast-follow |
```

- [ ] **Step 3: Anotar la tabla `strategies` como huérfana**

Reemplazar la línea de la sección "## Tablas":

```markdown
`assets` (ticker, tipo, moneda) · `transactions` (compra/venta, precio, fecha) · `snapshots` (valor diario) · `strategies` (reglas, parámetros) · `alerts` (condición, umbral, estado)
```

por:

```markdown
`assets` (ticker, tipo, moneda) · `transactions` (compra/venta, precio, fecha) · `snapshots` (valor diario) · `alerts` (condición, umbral, estado)

La tabla `strategies` existe en el esquema pero **ningún código la usa** desde la limpieza del 2026-08-19. Se dejó a propósito: dropear una tabla es lo único que git no puede deshacer (Decisión 5 del spec de limpieza).
```

- [ ] **Step 4: Corregir la mención en la sección de multi-moneda**

Reemplazar:

```markdown
- La conversión ocurre en la **frontera de datos**: los motores de analítica, backtest y escenarios
  reciben una sola moneda y son agnósticos a ella.
```

por:

```markdown
- La conversión ocurre en la **frontera de datos**: el motor de analítica recibe una sola
  moneda y es agnóstico a ella.
```

- [ ] **Step 5: Actualizar la lista de páginas**

Reemplazar:

```markdown
`/dashboard` · `/portfolio` · `/analytics` · `/backtest` · `/scenarios` · `/alerts` · `/data-sources` · `/settings`
```

por:

```markdown
`/dashboard` · `/portfolio` · `/analytics` · `/alerts` · `/data-sources` · `/settings`
```

Y borrar esta línea completa:

```markdown
- **Backtest y Scenarios:** páginas propias (son herramientas de análisis profundo, no widgets).
```

- [ ] **Step 6: Borrar la sección completa "Backtesting Engine — estrategias"**

Borrar desde el encabezado `## Backtesting Engine — estrategias` hasta la línea `**Métricas:** Retorno Total · CAGR · Sharpe Ratio · Max Drawdown · vs S&P 500 (exceso geométrico) · Turnover.` inclusive, junto con la línea en blanco que la sigue.

En su lugar, insertar esta sección corta (el código rescatado merece una línea, para que quien lea el repo sepa que existe y por qué):

```markdown
## Carteras sintéticas

`src/lib/analytics/synthetic/` simula carteras hipotéticas sobre los mismos activos
(pesos fijos, con o sin rebalanceo periódico). Es el motor del benchmark **equiponderado**
que el dashboard va a comparar contra la cartera real. Sobrevive de la Fase 4, cuya página
de backtest se eliminó.
```

- [ ] **Step 7: Anotar el `.html` histórico**

Reemplazar:

```markdown
[`docs/design/`](docs/design/) (`architecture.html`, `backtest-design.html`, `ui-review.html`).
```

por:

```markdown
[`docs/design/`](docs/design/) (`architecture.html`, `backtest-design.html` —histórico, la
funcionalidad se eliminó—, `ui-review.html`).
```

- [ ] **Step 8: Actualizar el ROADMAP**

En `docs/superpowers/plans/ROADMAP.md`, en la columna **Estado** de la tabla:

- Fila de la Fase 4: reemplazar `**Implementada (MVP)**` por `**Eliminada (2026-08-19)**`
- Fila de la Fase 5: reemplazar `**Implementada (MVP)**` por `**Eliminada (2026-08-19)**`

Cuidado: la Fase 6 también dice `**Implementada (MVP)**` y **NO se toca**. Editar por fila, no con un reemplazo global.

Luego, agregar al final del archivo:

```markdown

## Ciclo post-MVP (2026-08)

Cada proyecto lleva su propio spec y plan, igual que las fases.

| # | Proyecto | Alcance | Estado |
|---|---|---|---|
| 1 | [Limpieza](2026-08-19-limpieza-backtest-escenarios.md) ([spec](../specs/2026-08-19-limpieza-backtest-escenarios-design.md)) | Eliminar Backtest y Escenarios; rescatar el simulador de carteras y el cálculo de beta hacia `analytics/` | **Implementada** |
| 2 | Performance | Filtrar `price_cache` por ticker en `/api/positions`, Server Components, caché entre navegaciones | Pendiente |
| 3 | Portafolios CLP / USD | Separar la medición por moneda en vez de consolidar todo en CLP | Pendiente |
| 4 | Dashboard: multi-benchmark | Selector de benchmark en el dashboard, comparación simultánea (S&P 500, Nasdaq 100, buy & hold, equiponderado), fechas en dd/mm/aaaa | Pendiente |
| 5 | Deploy web + responsive | Publicar la app con acceso desde celular y PC; layout adaptable | Pendiente |
| 6 | Configuración + alertas automáticas | Poblar `/settings`; evaluación de alertas por cron sin intervención manual | Pendiente |

**Dependencias:** 4 depende de 1 (usa `analytics/synthetic/` y `analytics/beta.ts`) y de 3 (el benchmark se elige por portafolio) · 6 depende de 5 (el cron necesita un endpoint público al que pegarle).
```

- [ ] **Step 9: Corregir la descripción de la app en `layout.tsx`**

Detectado en la revisión de la Tarea 1. `src/app/layout.tsx:17` describe la app como algo que ya no es, y esa cadena es **visible para el usuario** (metadata de la página, no un comentario).

Reemplazar:

```ts
  description: 'Gestión de portafolio personal: posiciones, analítica, backtesting, escenarios y alertas',
```

por:

```ts
  description: 'Gestión de portafolio personal: posiciones, analítica, benchmarks y alertas',
```

- [ ] **Step 10: Corregir los comentarios de `src/lib/fx/` que cuentan tres constructores**

También detectado en la revisión de la Tarea 1. Dos comentarios afirman que hay **tres** rutas que construyen `PriceSeriesByTicker` con `ORDER BY price_date asc`. Tras esta limpieza queda **una** (`analytics`). Son comentarios que documentan una precondición real, así que dejarlos mintiendo es peor que no tenerlos.

En `src/lib/fx/convert.ts` (alrededor de la línea 41), reemplazar:

```ts
  // documentado de `PriceSeriesByTicker` y lo cumplen los tres constructores
  // reales (analytics/backtest/scenarios routes, `ORDER BY price_date asc`).
```

por:

```ts
  // documentado de `PriceSeriesByTicker` y lo cumple su constructor real
  // (la ruta de analytics, `ORDER BY price_date asc`).
```

En `src/lib/fx/convert.test.ts` (alrededor de la línea 77), reemplazar:

```ts
    // solo es correcto si `points` también avanza en el tiempo: los tres
    // constructores reales (analytics/backtest/scenarios routes) arman la
    // serie con `ORDER BY price_date ascending`, y `priceAsOf`/`loadFxSeries`
```

por:

```ts
    // solo es correcto si `points` también avanza en el tiempo: su constructor
    // real (la ruta de analytics) arma la serie con
    // `ORDER BY price_date ascending`, y `priceAsOf`/`loadFxSeries`
```

Correr `npm test` después de este paso: **27 archivos, 189 tests, verdes.** Son cambios de comentario, no de comportamiento — si algún test cambia de resultado, se editó código por error.

- [ ] **Step 11: Verificar que el README no menciona funcionalidad muerta**

Run: `grep -n -i "backtest\|escenario\|scenario" README.md`
Expected: solo 3 tipos de mención sobreviven, todas correctas:
- la línea de Estado, que dice que fueron eliminados
- la sección "Carteras sintéticas", que menciona la Fase 4 como origen histórico
- la línea de `docs/design/`, con `backtest-design.html` marcado como histórico

Cualquier otra mención es una que se escapó.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "docs: actualizar README y ROADMAP tras eliminar backtest y escenarios"
```

---

## Task 6: Verificación final

Todos los chequeos de la §7 del spec, corridos juntos sobre el estado final.

**Files:** ninguno (solo verificación)

- [ ] **Step 1: Suite completa**

Run: `npm test`
Expected: **27 archivos, 189 tests, verdes.**

Si el número de tests es menor a 186 o el de archivos no es 27, revisar contra la aritmética de la §7 del spec antes de continuar.

- [ ] **Step 2: Lint y build**

Run: `npm run lint`
Expected: limpio, sin warnings.

Run: `npm run build`
Expected: build exitoso. En la salida, la lista de rutas generadas **no** debe incluir `/backtest`, `/scenarios`, `/api/backtest` ni `/api/scenarios`.

- [ ] **Step 3: Greps de residuos**

```bash
grep -rn "lib/backtest" src
grep -rn "lib/scenarios" src
grep -rn "AssetType" src
```

Expected: los tres sin resultados.

- [ ] **Step 4: Verificación manual en el navegador**

Run: `npm run dev`

Recorrer y confirmar que **nada cambió** en lo que sí se usa:

| Página | Qué confirmar |
|---|---|
| `/dashboard` | KPI cards con valores, distribución de activos, tabla de posiciones y gráfica de rendimiento — todo igual que antes |
| `/portfolio` | Lista de activos y transacciones intacta |
| `/analytics` | Métricas (TWR, volatilidad, Sharpe, drawdown), gráfica, matriz de correlación y selector de benchmark funcionando |
| `/alerts` | Alertas listadas, badge del sidebar correcto |
| `/data-sources` | Estado de fuentes OK/ERROR |
| Sidebar | Exactamente 6 links, sin Backtest ni Escenarios |
| `/backtest` y `/scenarios` | Deben dar **404** |

Detener el server con Ctrl+C.

- [ ] **Step 5: Revisar el diff completo de la rama**

```bash
git diff main --stat
```

Expected: solo borrados, movimientos y los 3 archivos de documentación. **Ningún archivo de `src/lib/analytics/` preexistente** (`engine.ts`, `series.ts`, `returns.ts`, `riskMetrics.ts`, `correlation.ts`, `perAsset.ts`, `dates.ts`, `benchmarks.ts`, `types.ts`) debe aparecer modificado — si alguno aparece, se tocó algo que este proyecto no debía tocar.

- [ ] **Step 6: Reportar el resultado**

Informar el conteo real de `npm test`, el resultado de lint y build, y cualquier discrepancia contra los números esperados. No declarar la tarea completa sin haber corrido los tres comandos y visto su salida.
