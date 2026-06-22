# Fase 5 — Scenario Simulator (Stress Test) · Diseño (MVP)

**Fecha:** 2026-06-22
**Estado:** diseño aprobado, pendiente de plan de implementación
**Depende de:** Fase 2 (histórico de precios) y Fase 3 (Analytics: retornos, series, riesgo)
**Roadmap:** Fase 5 de 6. Ver [ROADMAP.md](../plans/ROADMAP.md).

## 1. Propósito y alcance

El Scenario Simulator responde a la pregunta de gestión de riesgo prospectiva de un
gestor de cartera personal (estilo PORT/PRTU de Bloomberg): **"¿cuánto pierdo si pasa X?"**.

El MVP implementa **una sola capacidad: stress test de la cartera actual por shocks**.
El usuario define un **shock de mercado** (movimiento del S&P 500) que se propaga a cada
activo según su **beta** vs benchmark, con **overrides idiosincráticos** opcionales por
activo. El resultado muestra el impacto sobre la cartera de **hoy**.

Misma disciplina que la Fase 4: una capacidad enfocada, portfolio-céntrica, que degrada
con gracia ante carteras con activos sin histórico suficiente (p. ej. una IPO reciente).

### Dentro del MVP
- Shock de mercado único (% sobre el S&P 500) propagado por beta.
- Overrides idiosincráticos por activo (reemplazan el shock derivado de beta).
- Outputs: impacto total ($ y %), desglose por activo, ranking de peores activos,
  cartera vs S&P estresado, gráfica de barras.
- Degradación con gracia: activos con histórico insuficiente caen a una beta de fallback
  según su `asset_type` (Decisión 3) + warning.

### Fuera del MVP (fast-follow)
- What-if de composición (agregar/quitar posiciones, cambiar pesos hipotéticamente).
- Rebalanceo simulado forward-looking (drift vs objetivo + trades). Nota: el "drift de
  rebalanceo" también lo contempla la Fase 6 (Alerts); coordinar para no duplicar.
- Replay de escenarios históricos con nombre (COVID feb-mar 2020, selloff 2022).
- Guardar/nombrar escenarios.

### No persiste
Ad-hoc como el backtest de la Fase 4. **Sin migraciones, sin tablas nuevas.**

## 2. Metodología del shock (decisiones)

### Decisión 1 — Propagación por beta + overrides
El input del escenario es:
- `marketShock`: movimiento del S&P 500 en porcentaje (ej. `-0.20` = −20%).
- `overrides`: mapa opcional `ticker -> shock` (ej. `{ AAPL: -0.30 }`).

El shock aplicado a cada activo:
```
shock_i = override_i  (si el usuario lo fijó)
        = beta_i × marketShock  (en caso contrario)
```

### Decisión 2 — Cálculo de beta
`beta_i = cov(r_i, r_bench) / var(r_bench)` sobre **retornos diarios de cierre ajustado**
en las fechas **comunes** entre el activo y el benchmark (SPY), reusando `assetReturn` /
`priceAsOf` de `analytics/series`. Benchmark = **SPY** (S&P 500), consistente con Fase 3/4.

- **Firma pura:** `computeBeta(assetReturns, benchReturns)` opera sobre **arrays de
  retornos ya alineados**. El **ventaneo es responsabilidad del caller** (motor/ruta), que
  corta los retornos a la ventana deseada antes de llamar. No se bakean fechas dentro de
  la función pura: el fast-follow de replay histórico solo tendrá que pasar los retornos
  de la ventana pre-shock, sin acoplar `computeBeta` a lógica de fechas.
- **Ventana:** todo el histórico común disponible que cargue la ruta (lookback acotado,
  ver §4). No se introduce un parámetro de ventana en el MVP.
- **Sin clamp** de betas extremas en el MVP (se muestran tal cual). Nota para fast-follow:
  podría acotarse a un rango razonable.
- **Limitación de régimen (documentada):** la beta histórica se calibra sobre el lookback
  reciente; si ese tramo fue de baja volatilidad, las betas subestiman el riesgo de cola
  de un evento extremo. No se corrige en el MVP (se mitiga con el disclaimer de la
  Decisión 7); el fast-follow de replay histórico permitirá estimar la beta en la ventana
  previa al shock concreto (2020/2008).

### Decisión 3 — Fallback por cobertura insuficiente (consciente del tipo de activo)
Si un activo tiene **menos de `MIN_BETA_OBS = 20`** retornos diarios comunes con el
benchmark, su beta histórica es poco fiable. En vez de asumir `beta = 1.0` para todo (lo
que haría que una posición de **`cash`** "perdiera" 20% en un crash — absurdo), el
fallback usa el `asset_type` real del enum del esquema (`stock`, `etf`, `crypto`, `cash`,
`other`):

| `asset_type` | fallback β | razón |
|---|---|---|
| `stock`, `etf`, `other` | 1.0 | proxy de mercado neutral |
| `crypto` | 1.5 | alta beta sistémica en risk-off |
| `cash` | 0.0 | no co-mueve con el mercado |

Se emite un **warning** nombrando el activo y la beta de fallback aplicada. El `1.5` de
crypto es una **heurística documentada y tuneable** (la beta crypto-S&P es inestable), no
un hecho; el **override** del usuario tiene precedencia sobre el fallback y es la válvula
de escape. Cubre el caso de IPO reciente (SPCX, ~5 días) con la beta del tipo de activo,
mismo patrón de degradación con gracia que la Fase 4. Las constantes viven en `beta.ts`
como una tabla `FALLBACK_BETA_BY_TYPE`.

### Decisión 4 — Comparación vs S&P estresado
Por definición el escenario fija el movimiento del S&P en `marketShock`, así que el S&P
estresado cae exactamente `marketShock`. Se muestra "tu cartera −X% vs S&P −Y%", donde
−X% es el impacto total de la cartera (calculado **bottom-up**, ver Decisión 6) y la
**beta agregada** `Σ wᵢ·betaᵢ` es una **estadística descriptiva** que ayuda a leer la
diferencia. La beta agregada **nunca** es la base del cálculo del P&L.

### Decisión 5 — Convención de signo
Shocks en fracción decimal con signo: `-0.20` = caída del 20%, `+0.10` = subida del 10%.
La UI acepta porcentajes y convierte.

### Decisión 6 — Valuación (raw vs adjusted) y P&L bottom-up
Para no reintroducir la paradoja raw/adjusted de la Fase 3, los planos quedan separados:
- **Beta** → sobre **retornos de cierre ajustado** (`adjPrice`), que aísla dividendos/splits
  del ruido de covarianza (Decisión 2).
- **Valuación en $** → sobre **precio crudo actual** (`price`) × cantidad cruda, igual que
  `portfolioRawValue` (Fase 3).

Flujo por activo:
```
valueBefore_i = price_crudo_actual_i × qty_i
shock_i       = override_i ?? (beta_i × marketShock)   // beta de retornos ajustados
valueAfter_i  = valueBefore_i × (1 + shock_i)
```

El **P&L del portafolio es bottom-up**, nunca `betaAgregada × marketShock`:
```
P&L%_portfolio = (Σ valueAfter_i / Σ valueBefore_i) − 1
```
Así, si el usuario fuerza un override (p. ej. AAPL −50% ignorando su beta), el total cuadra
exactamente con la suma de las partes. Los pesos `wᵢ` de la beta agregada también se
calculan sobre valor crudo (`valueBefore_i / Σ valueBefore`).

### Decisión 7 — Disclaimer de riesgo de cola (no toca el cálculo)
La beta mide co-movimiento promedio en condiciones normales; en colapsos severos las
correlaciones tienden a 1 y las betas reales suben. El banner de resultados incluye una
**nota estática**: *"El simulador usa sensibilidad histórica promedio (beta). En colapsos
severos las correlaciones tienden a aumentar, por lo que la pérdida real podría ser
mayor."* Es honestidad metodológica (mismo espíritu que las notas de fricción/Sharpe de la
Fase 4), no un cambio de modelo.

## 3. Arquitectura

### Motor (dominio puro, `src/lib/scenarios/`)
- **`types.ts`** — `ScenarioConfig` (`marketShock`, `overrides`), `AssetStress`
  (ticker, weight, beta, betaFallback, shockApplied, valueBefore, valueAfter,
  lossContribAbs), `StressResult` (portfolio totals, vsBenchmark, perAsset[], warnings[]).
- **`beta.ts`** — `computeBeta(assetReturns, benchReturns)` (pura, sobre arrays alineados)
  y la lógica de fallback: `MIN_BETA_OBS` + tabla `FALLBACK_BETA_BY_TYPE` por `asset_type`
  (Decisión 3). Reusa los retornos de `analytics/series`.
- **`stress.ts`** — aplica el shock a cada posición valuada a **precio crudo**:
  `valueBefore = price·qty`, `shock_i = override ?? beta·marketShock`,
  `valueAfter = valueBefore·(1+shock_i)`, `lossContribAbs` (Decisión 6).
- **`engine.ts`** — `runScenario(input)`: betas → stress por activo → agrega **bottom-up**
  (`Σ valueAfter / Σ valueBefore − 1`), P&L ($ y %), beta agregada de cartera (descriptiva),
  ranking por contribución a la pérdida, junta warnings (fallbacks + precios faltantes).

**Reusa:** `analytics/series` (`assetReturn`, `priceAsOf`), `portfolio/holdings`
(`computeHoldings`), `supabase/paginate` (`fetchAllRows`).

### API — `POST /api/scenarios`
Espejo del patrón de `/api/backtest`:
1. Auth (`supabase.auth.getUser()`); 401 si no hay sesión.
2. Parseo/validación con `scenarioConfigSchema` (Zod) en `lib/validation/schemas`.
3. Holdings de la cartera real desde `transactions` (con ticker y tipo de activo).
4. Precios **actuales** (para valuar cada posición) + **histórico** de la cartera + SPY
   (vía `fetchAllRows`, paginado) para las betas.
5. Corre `runScenario` → devuelve `StressResult`.
6. Errores claros: cartera vacía → 400; tickers de override fuera de la cartera → 400.

### Página — `/scenarios` (reemplaza el placeholder)
Estilo `/backtest`:
- **Input:** shock de mercado (%) + botones rápidos (−10 / −20 / −30 / +10); inputs de
  override por activo (en blanco = usar beta). Botón **Ejecutar**.
- **Resultados:**
  - Tarjetas de impacto total: valor antes/después, P&L en $ y %.
  - Línea "cartera vs S&P estresado" (−X% vs −Y%, con beta agregada).
  - **Tabla por activo ordenada por contribución a la pérdida** (= ranking de peores):
    shock aplicado, valor antes/después, contribución en $.
  - **Gráfica de barras** (recharts `BarChart`): valor antes vs después por activo.
  - Banner ámbar de warnings (betas en fallback, precios faltantes).
  - **Nota estática de riesgo de cola** (Decisión 7) bajo los resultados.

## 4. Bordes y datos

- **Lookback de histórico:** la ruta carga un lookback acotado (p. ej. ~2 años) de
  `price_cache` para la cartera + SPY, suficiente para estimar betas sin traer todo.
  Cualquier `select` sobre tablas que crezcan usa `fetchAllRows`/`.range()` (gotcha
  reusable de Fases 3-4).
- **Activo sin precio actual** → no se puede valuar: se excluye del total con warning;
  no rompe el escenario.
- **Cartera vacía** → 400 con mensaje claro.
- **Override de un ticker que no está en la cartera** → 400 nombrando el ticker.

## 5. Testing (TDD, Vitest)

Dominio puro, mismo enfoque que Fases 3-4:
- `beta.ts`: cálculo correcto vs caso conocido; fallback por `asset_type` bajo
  `MIN_BETA_OBS` (`cash`→0, `crypto`→1.5, `stock`/`etf`/`other`→1.0).
- `stress.ts`: precedencia de override sobre beta; valuación a precio crudo; valor después
  y contribución.
- `engine.ts`: **P&L bottom-up cuadra con la suma de las partes incluso con un override**
  (guard de Decisión 6); beta agregada descriptiva y comparación vs S&P; ranking por
  pérdida; ensamblado de warnings (fallback + precio faltante).
- Validación: `scenarioConfigSchema` rechaza configs inválidas.

Lint y build verdes antes de cerrar la fase. Verificación e2e en navegador (requiere
login) como cierre, igual que en la Fase 4.

## 6. Decisiones clave (resumen)
1. MVP = solo stress test por shocks (what-if / rebalanceo simulado / replay = fast-follow).
2. Shock de mercado propagado por beta + overrides idiosincráticos.
3. Beta = cov/var sobre retornos de cierre ajustado vs SPY; `computeBeta` pura sobre arrays
   (ventaneo = responsabilidad del caller); sin clamp en MVP.
4. Fallback de beta **por `asset_type`** + warning si < 20 obs comunes: `cash`→0,
   `crypto`→1.5 (heurística), `stock`/`etf`/`other`→1.0. El override tiene precedencia.
5. Valuación a **precio crudo**; P&L del portafolio **bottom-up** (`Σ after/Σ before − 1`),
   no `betaAgregada × shock`. La beta agregada es solo descriptiva.
6. vs S&P estresado: el S&P cae `marketShock`; se compara con el P&L bottom-up de la cartera.
7. Disclaimer de riesgo de cola en la UI (correlaciones → 1 en crisis); no toca el cálculo.
8. Sin persistencia, sin migraciones; ad-hoc como el backtest.
