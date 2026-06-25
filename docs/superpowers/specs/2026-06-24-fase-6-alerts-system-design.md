# Fase 6 — Alerts System · Diseño (MVP)

**Fecha:** 2026-06-24
**Estado:** diseño aprobado, pendiente de plan de implementación
**Depende de:** Fase 2 (market data / `price_cache`)
**Roadmap:** Fase 6 de 6 (última). Ver [ROADMAP.md](../plans/ROADMAP.md).

## 1. Propósito y alcance

El Alerts System vigila la cartera y avisa cuando un activo cruza un umbral, sin que el
usuario tenga que estar mirando. Cierra el ciclo del producto (posiciones → precios →
analítica → backtesting → escenarios → **alertas**).

### Dentro del MVP
- **3 tipos de alerta** (reusan la tabla `alerts` de la Fase 1): `price_above`, `price_below`,
  `pct_change` (movimiento absoluto del día, ±X%).
- **Notificación in-app:** la alerta disparada se marca en DB (`status='triggered'`,
  `triggered_at`) y se ve en `/alerts` + un **badge** con el nº de disparadas en el shell.
- **Evaluación on-demand, cron-ready:** un motor que lee **solo `price_cache`** (cero
  llamadas a APIs externas) disparado (1) **automáticamente al refrescar precios** y (2) por
  un botón **"Revisar ahora"** en `/alerts`.
- **CRUD de alertas** en `/alerts` (crear, listar, reactivar/silenciar, borrar).

### Fuera del MVP (fast-follow)
- **`rebalance_drift`** (el 4º tipo del esquema): requiere persistir una asignación objetivo
  (tabla/UI nueva) + cálculo de drift; se empareja con el "rebalanceo simulado" diferido de
  la Fase 5.
- **Notificación por email:** requiere proveedor (Resend/SendGrid/SMTP) + API key + plantilla.
  Cuando llegue, la página **`/settings`** alojará dirección y preferencias. Hasta entonces
  `/settings` **queda como placeholder** (con in-app no hay nada que configurar — YAGNI).
- **Auto-rearm diario de `pct_change`** (ver Decisión 2).
- **Cron real** (pg_cron / Vercel cron) pegando al endpoint de evaluación.

### No persiste estructura nueva
**Sin migraciones.** La tabla `alerts` ya existe con todo lo necesario y su RLS
(`own alerts`).

## 2. Decisiones de comportamiento

### Decisión 1 — Ciclo de estado
`active` → si se cumple la condición pasa a `triggered` (+`triggered_at = now()`). Una alerta
`triggered` **no se re-evalúa** (one-shot) hasta que el usuario la **reactiva**
(`status='active'`) o la borra. `active ⇄ disabled` permite silenciar sin borrar. La
evaluación **solo mira las `active`**.

**Reactivación:** el modelo one-shot **acota el re-disparo a UNO** — si reactivas una alerta
cuya condición sigue cumpliéndose (p. ej. `price_above@150` con el precio en 155), la
siguiente evaluación la vuelve a `triggered`; no hay bucle infinito. Para evitar esa UX
inútil, al reactivar una alerta **ya satisfecha** la UI **avisa**: *"el precio actual ($155)
ya cumple el umbral ($150); ajústalo o espera a que cruce de vuelta"* (Opción A de la
revisión, sin máquina de estados `armed_waiting_reset`).

### Decisión 2 — Fricción de `pct_change` (limitación documentada del MVP)
El ciclo one-shot encaja con cruces de precio (eventos únicos), pero la volatilidad es
velocidad, no estado: una `pct_change` que dispara hoy queda `triggered` y **no vuelve a
avisar** de un movimiento mañana hasta reactivarla a mano. **Limitación conocida del MVP.**
Fast-follow: **auto-rearm diario** — al evaluar, las `pct_change` con `triggered_at` de un día
anterior se reabren a `active` automáticamente.

### Decisión 3 — Semántica por tipo (sobre precio CRUDO)
Sea `spot` = precio actual y `prevClose` = cierre del día hábil anterior (ver Decisión 4):
- `price_above`: dispara si `spot > threshold` (estricto).
- `price_below`: dispara si `spot < threshold` (estricto).
- `pct_change`: dispara si `|spot / prevClose − 1| × 100 ≥ threshold`.

`threshold` (numérico en la tabla): **precio** en above/below; **puntos porcentuales** en
pct_change (ej. `5` = 5%).

**Borde exacto:** desigualdad **estricta** — si `spot == threshold`, **no** dispara. (No se
redondea a decimales fijos: rompería activos de baja escala como cripto a `$0.00001234`; el
riesgo de coma flotante aplica a la igualdad `===`, no al orden `>`/`<`, que aquí es seguro.)

**Limitación — splits:** evaluar umbrales sobre el precio **nominal** (raw) es lo correcto
para una alerta de precio ("AAPL cruza $200" se refiere al precio real de mercado), pero un
split (ej. 4:1) hunde el nominal ~75% y puede detonar `price_below`/`pct_change` con un falso
positivo. **Limitación conocida del MVP**, no se corrige con adjusted close.

### Decisión 4 — "Cierre anterior" = día hábil previo, no "los dos rows más recientes"
`pct_change` debe comparar `spot` contra el **cierre del día hábil anterior**, NO contra "los
dos precios más recientes en `price_cache`". Motivo: `price_cache` tiene
`unique (ticker, price_date, source)` con `price_date` de tipo **DATE**, y puede haber
**varias fuentes para la misma fecha** (p. ej. AAPL con una fila `manual` y otra `yahoo` el
mismo día). Tomar "los dos rows más recientes" compararía dos precios del **mismo día** entre
fuentes → Δ% basura. (Nota: refrescos intra-día con la misma fuente hacen UPSERT sobre la
clave y **sobreescriben** la fila — no acumulan snapshots intra-horarios.)

**Regla:** por ticker, deduplicar a **un precio por `price_date`**; `spot` = precio de
`max(price_date)`; `prevClose` = precio del **mayor `price_date` estrictamente menor**. Esta
derivación vive en el caller (`run.ts`), no en la función pura.

### Decisión 5 — Hook de evaluación no bloqueante
La auto-evaluación al final de `/api/prices/refresh` va envuelta en `try/catch`: un fallo de
evaluación (o timeout de DB) **no** debe convertir el refresh en un 500. El trabajo primario
de esa ruta es escribir precios; la evaluación es un efecto secundario best-effort.

### Decisión 6 — Guard de robustez
Si `prevClose` es `0`, `null` o falta (activo recién listado, sin cierre previo), o falta el
`spot`, la alerta **se omite** (no dispara) — nunca se produce división por cero ni `NaN` que
rompa el UPDATE. Igual para una alerta sobre un activo sin precio en caché.

## 3. Arquitectura

### Motor puro (`src/lib/alerts/`, TDD)
- **`types.ts`** — `AlertType` (los 3), `AlertRow` (id, assetId, ticker, alertType, threshold,
  status), `AlertTrigger` (id, reason).
- **`evaluate.ts`** — `evaluateAlerts(alerts, currentPrices, previousClosePrices)`:
  recibe alertas `active` + **dos mapas estáticos** `Map<ticker, number>` y devuelve los
  `AlertTrigger[]` que deben pasar a `triggered`. Puro, sin DB, sin lógica de fechas.

### Integración server (`src/lib/alerts/run.ts`)
- **`evaluateAndPersist(supabase, userId)`** — carga alertas `active` (con ticker del asset) +
  `price_cache` (paginado, `fetchAllRows`), deriva `currentPrices`/`previousClosePrices` por la
  regla de la Decisión 4, llama a `evaluateAlerts`, y hace
  `UPDATE alerts SET status='triggered', triggered_at=now() WHERE id IN (…) AND status='active'`.
  El filtro **`AND status='active'` es un lock optimista**: si el botón "Revisar ahora" y el
  hook de `/api/prices/refresh` corren a la vez, el primero marca las filas y el segundo afecta
  0 (no re-machaca `triggered_at` ni dispara dos veces). Devuelve las recién disparadas. Lo
  llaman **ambos** triggers (DRY). Lee solo caché: **cero llamadas externas**.
  - **Derivación de spot/prevClose:** sigue el patrón ya establecido en `/api/positions`
    (`fetchAllRows` + derivar en JS), por consistencia. A escala, un **helper compartido**
    "último+anterior por ticker" optimizable con window functions (`ROW_NUMBER()/LAG()`)
    aplicado a `/api/positions` **y** alertas a la vez queda como fast-follow; no es necesario
    al tamaño actual (cartera de pocos tickers).

### API
- `GET /api/alerts` — lista las alertas del usuario (join con ticker del asset).
- `POST /api/alerts` — crea (valida con `alertInputSchema` Zod; `assetId` debe ser del usuario).
- `PATCH /api/alerts/[id]` — cambia `status` (`active` para reactivar, `disabled` para silenciar).
- `DELETE /api/alerts/[id]` — borra.
- `POST /api/alerts/evaluate` — llama a `evaluateAndPersist`; devuelve las recién disparadas.
- **Hook:** al final de `/api/prices/refresh`, `try { await evaluateAndPersist(...) } catch {}`
  (Decisión 5).

### UI
- **Página `/alerts`** (reemplaza el placeholder): formulario de creación (tipo + activo +
  umbral, con etiqueta de unidad según el tipo), tabla de alertas con estado, **precio actual**
  del ticker (de `/api/positions`) y acciones (reactivar / silenciar / borrar), botón
  **"Revisar ahora"** (POST evaluate), banner de las recién disparadas. Al **reactivar** una
  alerta cuya condición ya se cumple, muestra el aviso de la Decisión 1.
- **Badge en el shell:** componente cliente en el sidebar junto a "Alertas" que consulta
  `GET /api/alerts` y muestra el nº de `triggered`.

### Validación (`src/lib/validation/schemas.ts`)
- **`alertInputSchema`** — `alertType` ∈ {price_above, price_below, pct_change}, `assetId`
  uuid, `threshold` numérico (> 0). Coacciona strings de formulario.

## 4. Bordes y testing

- **Activo sin precio en caché** / **`pct_change` sin `prevClose`** → omitir (Decisión 6).
- **Solo `active` se evalúa**; `triggered`/`disabled` se ignoran (Decisión 1).
- **Borrar un activo** elimina sus alertas (`asset_id ... on delete cascade`, ya en el esquema).
- **Tests (Vitest, TDD)** de `evaluate.ts`:
  - `price_above`/`price_below` disparan/no disparan; **borde exacto** (`spot == threshold` → no dispara).
  - `pct_change` dispara con `|Δ%| ≥ threshold`, en ambos sentidos (±); no dispara si está por debajo.
  - **`prevClose = 0` / `null` / ausente → omitido**, sin `NaN` ni división por cero.
  - ticker sin `spot` → omitido.
  - (las alertas que entran ya están filtradas a `active` por el caller).
- **`alertInputSchema`**: rechaza tipo desconocido, `threshold` no positivo, `assetId` no-uuid.
- Rutas, página y badge se validan con **lint + build + e2e** (igual que Fases 4-5).

## 5. Decisiones clave (resumen)
1. MVP = 3 alertas de precio (above/below/pct_change) + notificación **in-app**; rebalance_drift y email = fast-follow; `/settings` queda placeholder.
2. Ciclo `active → triggered` (one-shot) + reactivar/silenciar; fricción de `pct_change` documentada, auto-rearm diario = fast-follow.
3. Semántica sobre **precio crudo**, desigualdad **estricta** (sin redondeo; protege cripto); splits = limitación documentada.
4. `prevClose` = cierre del **día hábil anterior** (max `price_date` estrictamente menor, dedup por fecha), NO "los dos rows más recientes" (evita Δ% entre fuentes del mismo día).
5. Motor puro `evaluateAlerts(alerts, currentPrices, previousClosePrices)` con dos mapas estáticos; la lógica de fechas vive en `run.ts`.
6. Auto-evaluación al refrescar precios en `try/catch` **no bloqueante**; cron-ready; lee solo caché (sin coste de API externa).
7. Guard contra división por cero / `NaN`; sin migraciones.
8. Reactivación: el one-shot acota el re-disparo a uno; la UI **avisa** si la condición ya se cumple (sin máquina de estados extra).
9. `UPDATE` de disparo con **lock optimista** (`AND status='active'`) contra los dos triggers concurrentes (botón + hook de refresh).
