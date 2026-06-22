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
- Degradación con gracia: activos con histórico insuficiente caen a `beta = 1.0` + warning.

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

- **Ventana:** todo el histórico común disponible que cargue la ruta (lookback acotado,
  ver §4). No se introduce un parámetro de ventana en el MVP.
- **Sin clamp** de betas extremas en el MVP (se muestran tal cual). Nota para fast-follow:
  podría acotarse a un rango razonable.

### Decisión 3 — Fallback por cobertura insuficiente
Si un activo tiene **menos de `MIN_BETA_OBS = 20`** retornos diarios comunes con el
benchmark, su beta es poco fiable → **`beta_i = 1.0`** (se mueve como el mercado) y se
emite un **warning** nombrando el activo. Esto cubre el caso de una IPO reciente (p. ej.
SPCX con ~5 días de histórico), mismo patrón de degradación con gracia que la Fase 4.
Un override del usuario sobre ese activo tiene precedencia sobre el fallback.

### Decisión 4 — Comparación vs S&P estresado
Por definición el escenario fija el movimiento del S&P en `marketShock`, así que el S&P
estresado cae exactamente `marketShock`. Se muestra "tu cartera −X% vs S&P −Y%", donde
−X% es el impacto total de la cartera y la **beta agregada** `Σ wᵢ·betaᵢ` explica la
diferencia. No requiere datos adicionales; cae del propio cálculo.

### Decisión 5 — Convención de signo
Shocks en fracción decimal con signo: `-0.20` = caída del 20%, `+0.10` = subida del 10%.
La UI acepta porcentajes y convierte.

## 3. Arquitectura

### Motor (dominio puro, `src/lib/scenarios/`)
- **`types.ts`** — `ScenarioConfig` (`marketShock`, `overrides`), `AssetStress`
  (ticker, weight, beta, betaFallback, shockApplied, valueBefore, valueAfter,
  lossContribAbs), `StressResult` (portfolio totals, vsBenchmark, perAsset[], warnings[]).
- **`beta.ts`** — `computeBeta(assetReturns, benchReturns)` y la lógica de fallback
  (`MIN_BETA_OBS`). Reusa los retornos de `analytics/series`.
- **`stress.ts`** — aplica el shock a cada posición valuada: `shock_i = override ?? beta·marketShock`,
  calcula `valueAfter` y `lossContribAbs`.
- **`engine.ts`** — `runScenario(input)`: betas → stress por activo → agrega valor nuevo,
  P&L ($ y %), beta agregada de cartera, ranking por contribución a la pérdida, junta
  warnings.

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
- `beta.ts`: cálculo correcto vs caso conocido; fallback bajo `MIN_BETA_OBS`.
- `stress.ts`: precedencia de override sobre beta; valor después y contribución.
- `engine.ts`: agregación (valor/P&L), beta agregada y comparación vs S&P, ranking por
  pérdida, ensamblado de warnings (fallback + precio faltante).
- Validación: `scenarioConfigSchema` rechaza configs inválidas.

Lint y build verdes antes de cerrar la fase. Verificación e2e en navegador (requiere
login) como cierre, igual que en la Fase 4.

## 6. Decisiones clave (resumen)
1. MVP = solo stress test por shocks (what-if / rebalanceo simulado / replay = fast-follow).
2. Shock de mercado propagado por beta + overrides idiosincráticos.
3. Beta = cov/var sobre retornos de cierre ajustado vs SPY; sin clamp en MVP.
4. Fallback `beta = 1.0` + warning si < 20 obs comunes (cubre IPOs recientes como SPCX).
5. vs S&P estresado cae del cálculo (S&P cae `marketShock`; beta agregada explica la diferencia).
6. Sin persistencia, sin migraciones; ad-hoc como el backtest.
