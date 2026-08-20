# Limpieza — Eliminar Backtest y Escenarios · Diseño

**Fecha:** 2026-08-19
**Estado:** diseño aprobado, pendiente de plan de implementación
**Depende de:** nada (primer proyecto del ciclo post-MVP)
**Ciclo:** Proyecto 1 de 6. Ver §10 para el orden completo.

## 1. Propósito y alcance

Backtest y Escenarios no se usan y no aportan al caso de uso real (gestionar la cartera
personal, no hacer análisis profundo ad-hoc). Este proyecto los elimina como funcionalidad
visible y **rescata el núcleo reutilizable** hacia `analytics/`, donde el Proyecto 4
(multi-benchmark) lo va a necesitar.

Es el primero del ciclo **a propósito**: reduce la superficie de código antes de que los
proyectos siguientes toquen el motor de analítica. Optimizar, reestructurar por moneda y
agregar benchmarks sobre un árbol más chico es más barato y menos riesgoso.

### Dentro del alcance
- Borrar las páginas `/backtest` y `/scenarios` y sus rutas API.
- Borrar `src/lib/scenarios/` completo y la orquestación de `src/lib/backtest/`.
- Rescatar hacia `src/lib/analytics/`: el simulador de carteras hipotéticas y el cálculo de beta.
- Actualizar `sidebar.tsx`, `README.md` y `ROADMAP.md`.

### Fuera del alcance
- **Cualquier cambio de rendimiento** — es el Proyecto 2, con su propio spec.
- **Mostrar la beta en pantalla** — es el Proyecto 4. Acá solo se deja la función disponible
  y su contrato documentado.
- **Usar el simulador para generar benchmarks sintéticos** — también Proyecto 4.
- **Dropear la tabla `strategies`** — ver Decisión 5.

### Sin cambios de comportamiento
Dashboard, portafolio, analítica, alertas y fuentes de datos deben quedar **idénticos**. Este
proyecto no altera ningún cálculo ni ninguna pantalla que el usuario use hoy.

### Sin migraciones
No se toca el esquema. Ver Decisión 5.

## 2. Inventario

### 2.1 Se rescata

| Origen | Destino | Qué es |
|---|---|---|
| `backtest/rebalance.ts` → `simulateLine` | `analytics/synthetic/simulate.ts` | Simula una cartera ponderada en espacio de capital |
| `backtest/weights.ts` | `analytics/synthetic/weights.ts` | `equalWeights`, `normalizeWeights`, `validateWeights` |
| `backtest/schedule.ts` → `rebalanceDates` | `analytics/synthetic/schedule.ts` | Calendario de rebalanceo mensual/trimestral |
| `backtest/types.ts` → `EquityPoint`, `RebalanceFrequency` | `analytics/synthetic/types.ts` | Solo esos dos tipos; el resto se borra |
| `scenarios/beta.ts` → `alignedAdjReturns`, `computeBeta` | `analytics/beta.ts` | Beta histórica vs. benchmark |
| 3 tests de `backtest/` (`rebalance`, `schedule`, `weights`) | `analytics/synthetic/` | Se mueven sin modificar |
| `scenarios/beta.test.ts` | `analytics/beta.test.ts` | Podado (ver Decisión 3) |

### 2.2 Se borra

| Ruta | Motivo |
|---|---|
| `src/app/(app)/backtest/page.tsx` | Funcionalidad eliminada |
| `src/app/(app)/scenarios/page.tsx` | Funcionalidad eliminada |
| `src/app/api/backtest/route.ts` | Funcionalidad eliminada |
| `src/app/api/scenarios/route.ts` | Funcionalidad eliminada |
| `src/lib/backtest/engine.ts` + test | Orquestación específica de la página |
| `src/lib/backtest/metrics.ts` + test | `cagr`, `totalReturn`, `geometricExcess`, `lineMetrics`. Wrappers finos sobre `analytics/riskMetrics`; el Proyecto 4 normaliza con `analytics/returns.normalizeToBase` y no los necesita |
| `src/lib/scenarios/engine.ts`, `stress.ts`, `types.ts` + tests | El stress test es lo que efectivamente no se usa |
| `sidebar.tsx` líneas 13-14 | Los 2 links del nav |

### 2.3 El grafo de dependencias permite el borrado

Verificado por inspección: `backtest/` y `scenarios/` **importan de** `analytics/`, y **nada
dentro de `analytics/` importa de ellos**. La dependencia siempre fue unidireccional. Por eso
borrarlos no puede afectar dashboard, portafolio, analítica ni alertas.

Los únicos consumidores externos de ambos módulos son sus propias páginas y rutas API, que se
borran en el mismo commit.

## 3. Decisiones de diseño

### Decisión 1 — Rescatar el núcleo de simulación en vez de borrarlo

`simulateLine` es, sin modificar una línea, el motor del benchmark **equiponderado** que el
Proyecto 4 necesita:

```ts
simulateLine(dates, prices, equalWeights(tickers), rebalanceDates(dates, 'quarterly'), capital)
```

Su contrato —pesos objetivo fijos, reanclaje del capital en cada fecha de rebalanceo, y
`turnoverTotal` acumulado— es exactamente lo que hace falta, incluida la métrica de turnover
que permite juzgar cuánto trading asumió la línea.

**No** sirve para el buy & hold definido en §9.2: `simulateLine` asigna todo el capital en
`dates[0]`, que es precisamente la variante descartada. Ese benchmark sale de primitivas que ya
viven en `analytics/series.ts` y no requiere rescatar nada (ver §9.2).

Son ~110 líneas ya testeadas. Borrarlas para reescribir el equiponderado en dos proyectos más
sería churn, no YAGNI: el requerimiento ya está confirmado, no es especulación.

La alternativa de dejar `src/lib/backtest/` intacto y borrar solo la página se descartó porque
el objetivo incluye que "backtest" **desaparezca como concepto**; una librería muerta con ese
nombre lo mantiene vivo en el modelo mental.

### Decisión 2 — `rebalance.ts` pasa a llamarse `simulate.ts`

En su casa original el archivo describía la mitad de lo que hace: `simulateLine` simula
cualquier cartera ponderada, con rebalanceo o sin él (`rebalanceDates = []` es buy & hold). En
`analytics/synthetic/` el nombre `simulate.ts` es el que corresponde al contrato real.

### Decisión 3 — Podar el fallback de beta; el umbral pasa a ser parámetro

De `scenarios/beta.ts` se rescatan `alignedAdjReturns` y `computeBeta`. Se **descartan**
`resolveBeta` y `FALLBACK_BETA_BY_TYPE`.

Esa tabla de betas por tipo de activo (`crypto: 1.5`, `cash: 0`, resto `1.0`) existía porque el
stress test **siempre** necesitaba un número que multiplicar por el shock de mercado: sin beta
no había escenario. En una página de analítica el incentivo es el opuesto — mostrar `1.5` con
la etiqueta "beta" cuando nadie la midió es presentar una suposición como si fuera una
medición. **Si no hay datos suficientes, se muestra `—`.**

Pero `MIN_BETA_OBS` (el umbral de 20) vivía **dentro** de `resolveBeta`. Borrándolo sin más,
`computeBeta` solo protegería contra `n < 2` y devolvería betas calculadas sobre 3 observaciones
como si fueran fiables. Hay que reemplazar `resolveBeta` con una función que aplique el umbral:

```ts
// analytics/beta.ts
export const MIN_BETA_OBS = 20

/** Beta histórica del activo vs. benchmark. `null` si no hay observaciones suficientes. */
export function beta(
  assetSeries: PricePointAdj[],
  benchSeries: PricePointAdj[],
  minObs: number = MIN_BETA_OBS,
): number | null {
  const { rA, rB } = alignedAdjReturns(assetSeries, benchSeries)
  if (rA.length < minObs) return null
  const b = computeBeta(rA, rB)
  return b !== null && Number.isFinite(b) ? b : null
}
```

`minObs` queda **parametrizado** con default 20 para no atarse a un timeframe diario si en el
futuro se quiere calcular beta sobre retornos semanales o mensuales, donde 20 observaciones
representan un período mucho más largo y el umbral razonable sería otro.

### Decisión 4 — `AssetType` se borra; la fuente de verdad ya vive en `schemas.ts`

`AssetType` (`'stock' | 'etf' | 'crypto' | 'cash' | 'other'`) sale de `scenarios/types.ts` y
solo existía para tipar `FALLBACK_BETA_BY_TYPE`. Al irse el fallback, se va con él.

**Escaneo global previo al borrado** (`grep -rn "AssetType" src`): el tipo aparece en 4
ubicaciones, **todas dentro de lo que se borra** — `scenarios/types.ts`, `scenarios/beta.ts` y
`api/scenarios/route.ts`. **Ningún componente visual lo importa**, ni directa ni indirectamente:
no hay re-exports en `src/lib` que lo encadenen, y la UI no renderiza íconos ni colores según el
tipo de activo. La única referencia a tipo de activo en pantalla es `portfolio/page.tsx:182`,
que imprime `{a.asset_type}` como texto plano y está tipada como `string` suelto en la línea 11.
El `<select>` de creación de activos usa literales string en el markup, no el tipo.

**Hallazgo relevante:** el mismo enum está duplicado en un tercer lugar que **sobrevive** —
`validation/schemas.ts:14`, `z.enum(['stock','etf','crypto','cash','other'])`, que es el que
realmente valida el POST de activos. `AssetType` nunca fue la fuente de verdad, era una copia
manual que podía divergir. Si un proyecto futuro necesita el tipo, debe derivarlo del schema
(`z.infer<typeof assetInputSchema>['assetType']`) en vez de reescribir la unión a mano. **No se
hace ahora**: nada lo necesita, y agregarlo sería alcance especulativo.

### Decisión 5 — La tabla `strategies` NO se dropea

Queda huérfana (ningún código la referencia; solo existe en `0001_init.sql:36` con su RLS),
pero se **deja tal cual**. Está vacía, no cuesta nada, y es lo único de este proyecto que git no
puede deshacer: el código borrado se recupera del historial, una tabla dropeada no.

Si se decide eliminarla, que sea una migración explícita en un proyecto que ya toque el esquema
(el Proyecto 3, multi-portafolio, es el candidato natural).

### Decisión 6 — La documentación histórica se conserva

Los specs y planes de las Fases 4 y 5 en `docs/superpowers/` y los `.html` de `docs/design/`
**se mantienen**. Son el registro de cómo se construyó el proyecto, no código muerto: explican
decisiones (como el enfoque portfolio-céntrico o el sesgo de retrospectiva) que siguen siendo
válidas aunque la funcionalidad ya no esté.

Lo que sí se actualiza, porque describe el presente y quedaría mintiendo:
- **`README.md`** — menciona backtest y escenarios en 8 lugares (línea 3, tabla de módulos
  52-53, tabla de tablas 58, texto 71, lista de páginas 80, 83, sección completa 85-91, y 101).
- **`ROADMAP.md`** — agregar el ciclo post-MVP.

## 4. Contrato de `beta()` y manejo de `null`

`beta()` devuelve `number | null`. Devuelve `null` en tres casos:

1. Menos de `minObs` observaciones comunes entre las dos series.
2. Varianza del benchmark = 0 (serie plana; la división no está definida).
3. Resultado no finito.

**En este proyecto no hay consumidores**: la beta no se renderiza en ninguna pantalla hasta el
Proyecto 4. El contrato se documenta acá para que el Proyecto 4 lo herede sin redescubrirlo.

Cuando llegue ese consumidor, el idiom ya existe en la página de analítica: los helpers
`pct()`, `money()` y `num()` (`analytics/page.tsx:35-37`) devuelven `'—'` ante `null`, y las
métricas que ya pueden ser nulas (`sharpe`, `volatility`, `maxDrawdown`) pasan por ahí. La beta
usa `num()` y se comporta igual que sus vecinas sin código nuevo de manejo de nulos.

## 5. Semántica de las observaciones

Las observaciones de `alignedAdjReturns` son **retornos diarios de cierre ajustado**, calculados
sobre las fechas en que **ambas** series tienen precio (intersección estricta, no forward-fill).
`MIN_BETA_OBS = 20` significa entonces **20 retornos diarios**, aproximadamente un mes operativo.

**Matiz a tener presente:** los pares son consecutivos *dentro del conjunto común*, no
necesariamente en días calendario consecutivos. Si un feriado chileno deja a `ENELCHILE.SN` sin
fila mientras el benchmark sí opera, esa fecha se descarta y el par que cruza el hueco es un
retorno de dos días contado como una observación. Es el mismo criterio que ya usa
`analytics/correlation.ts` (intersección estricta), elegido en la Fase 7 justamente para que un
feriado no inyecte retornos 0 falsos. Se mantiene por consistencia: beta y correlación miden
co-movimiento y deben usar el mismo eje temporal.

Esta semántica es la razón por la que `minObs` es parámetro y no constante (Decisión 3): sobre
retornos semanales el mismo umbral cubriría casi medio año.

## 6. Estructura resultante

```
src/lib/analytics/
├── synthetic/              ← nuevo: carteras hipotéticas
│   ├── simulate.ts         ← era backtest/rebalance.ts
│   ├── weights.ts          ← era backtest/weights.ts
│   ├── schedule.ts         ← era backtest/schedule.ts
│   ├── types.ts            ← EquityPoint + RebalanceFrequency
│   └── simulate.test.ts · weights.test.ts · schedule.test.ts
├── beta.ts                 ← alignedAdjReturns + computeBeta + beta()
├── beta.test.ts
└── engine.ts · series.ts · returns.ts · riskMetrics.ts
    correlation.ts · perAsset.ts · dates.ts · benchmarks.ts · types.ts
```

`src/lib/backtest/` y `src/lib/scenarios/` dejan de existir.

## 7. Verificación

| Chequeo | Resultado esperado |
|---|---|
| `npm test` | **27 archivos**, **186 + N tests**, todos verdes |
| `npm run lint` | limpio |
| `npm run build` | verde — es lo que caza cualquier import colgante |
| `grep -rn "lib/backtest" src` y `grep -rn "lib/scenarios" src` | sin resultados |
| `grep -rn "AssetType" src` | sin resultados |
| Navegación manual | sidebar con 6 links; dashboard, portafolio, analítica y alertas idénticos |

**Aritmética de la línea base** (31 archivos / 212 tests, medida el 2026-08-19):

- −4 archivos de test borrados: `backtest/engine` (9), `backtest/metrics` (7),
  `scenarios/engine` (4), `scenarios/stress` (3) = **−23 tests** → 27 archivos, 189 tests.
- `beta.test.ts` pierde 3 casos (2 de `resolveBeta`, 1 de `FALLBACK_BETA_BY_TYPE`) → **186**.
- `beta.test.ts` gana **N ≥ 3** casos nuevos para `beta()`: devuelve `null` bajo el umbral,
  devuelve el valor sobre el umbral, y respeta un `minObs` explícito.
- Los 3 tests de `synthetic/` se mueven sin cambiar de contenido: no alteran el conteo.

Si el suite termina en menos de 186 tests o en otro número de archivos, algo se movió mal.

## 8. Riesgos

| Riesgo | Severidad | Mitigación |
|---|---|---|
| Import colgante no detectado | Baja | `npm run build` + `tsc` lo cazan antes de cualquier deploy |
| Extrañar el backtest más adelante | Muy baja | Está completo en el historial de git; se recupera con `git show` |
| Romper analítica al mover archivos | Muy baja | Grafo verificado unidireccional (§2.3); los tests de `analytics/` no se tocan |

Trabajo en rama con commits separados (borrado / rescate / documentación) para que revertir
cualquier pieza sea independiente.

## 9. Qué hereda el Proyecto 4

Definiciones **ya decididas** por el usuario (2026-08-19) que el Proyecto 4 hereda, más los
cabos sueltos que ese spec debe resolver.

### 9.1 Decidido — Equiponderado: 1/N rebalanceado trimestral

Se descarta 1/N fijo sin rebalanceo. Razones:

- **Sin rebalanceo deja de ser equiponderado.** Tras la deriva de precios la línea es
  "equiponderado en t0", una asignación arbitraria más; el nombre deja de describirla.
- **Complementa al buy & hold en vez de duplicarlo.** El B&H de §9.2 ya es una línea pasiva;
  una segunda línea pasiva se movería igual y el gráfico cargaría información redundante. El
  rebalanceo periódico es sistemáticamente contrario (recorta ganadores, refuerza perdedores):
  un comportamiento genuinamente distinto.
- **Aísla el dimensionamiento de posiciones**, que es una decisión real del usuario: "¿sobre-
  ponderar ciertos activos agregó valor frente a repartir parejo y rebalancear?"
- **Trimestral, no mensual:** 12 rebalanceos al año no son ejecutables en una cartera personal
  e inflan el turnover. `rebalanceDates` soporta ambos; cambiarlo es un parámetro.

**Advertencia a documentar en la UI:** `simulateLine` rebalancea **sin costos** — no modela
comisión ni IVA, que la cartera real sí paga (columnas `commission` / `iva` de `transactions`).
La línea equiponderada queda ligeramente favorecida. Mostrar `turnoverTotal` junto a ella para
que el sesgo sea visible y cuantificable.

### 9.2 Decidido — Buy & Hold: compras reales, sin ventas

"Comprar y mantener", **no** invertir todo el día 1. Responde "¿cuánto valdría la cartera si
nunca hubiera vendido nada?", aislando una única decisión: *cuándo vender*.

**No usa `simulateLine`** (que asigna todo en `dates[0]`, la variante descartada). Sale de
primitivas ya existentes y testeadas en `analytics/series.ts`:

```ts
portfolioRawValue(holdingsAsOf(txs.filter(t => t.side === 'buy'), date), prices, date)
```

`holdingsAsOf` recorta por fecha y `computeHoldings` acumula; pasándole solo las compras, las
ventas nunca ocurren. Son ~5 líneas — **no hay nada que rescatar para este benchmark**.

**Cabo suelto:** al eliminar las ventas se ignora que su producto pudo haber financiado compras
posteriores. En rigor, esa variante "gasta" dinero que no se tenía. El Proyecto 4 debe decidir
si lo asume como simplificación documentada o si modela el efectivo.

### 9.3 Pendiente — Universo del equiponderado y sesgo de retrospectiva

Si el equiponderado arranca repartiendo entre **todos** los activos que el usuario llegó a
tener, se le otorga conocimiento que no tenía (un activo comprado en el año 3). El universo
debe ser el que se tenía **en cada fecha**, re-equiponderando cuando cambia — y ese cambio de
universo es en sí mismo un evento de rebalanceo que interactúa con la frecuencia trimestral.

Es el mismo problema que el spec de la Fase 4 marcaba con `HINDSIGHT_WARNING`. El Proyecto 4
debe resolver la mecánica.

### 9.4 Pendiente — Cobertura de precios en la fecha ancla

**`simulateLine` lanza si un ticker no tiene precio en la fecha ancla** (`adjAt` tira `Error`).
Un activo comprado a mitad del período rompería el cálculo. El motor de backtest lo resolvía
recortando el inicio al primer día con cobertura de todos los activos (`engine.ts:36-46`,
`effectiveFrom`). Interactúa directamente con §9.3: si el universo es dinámico, quizá no haga
falta recortar. Hay que decidir la política.

### 9.5 Pendiente — Otros

1. **`simulateLine` devuelve una curva en valores absolutos**, mientras que
   `AnalyticsResult.series` guarda valores normalizados. La conversión es
   `analytics/returns.normalizeToBase`, que ya existe.
2. **`alignedAdjReturns` probablemente se solapa con `analytics/correlation.ts`** — ambas
   alinean series por intersección estricta. Evaluar si se unifican al integrar la beta.

## 10. Orden del ciclo

| # | Proyecto | Estado |
|---|---|---|
| 1 | **Limpieza** (este spec) | diseño aprobado |
| 2 | Performance | pendiente |
| 3 | Portafolios CLP / USD | pendiente |
| 4 | Dashboard: multi-benchmark + formato de fecha | pendiente |
| 5 | Deploy web + responsive móvil | pendiente |
| 6 | Configuración + alertas automáticas | pendiente |
