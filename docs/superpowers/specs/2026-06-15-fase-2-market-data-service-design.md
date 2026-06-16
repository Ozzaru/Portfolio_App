# Fase 2 — Market Data Service · Diseño

> Fecha: 2026-06-15 · Estado: aprobado, listo para plan de implementación
> Roadmap: [ROADMAP.md](../plans/ROADMAP.md) · Depende de: Fase 1 (implementada y verificada e2e)

## Contexto

La Fase 1 dejó funcionando el Portfolio Manager: CRUD de activos/transacciones,
entrada **manual** de precios en `price_cache`, y un dashboard que deriva
posiciones de `transactions` por costo promedio. Los precios hoy se ingresan a
mano. La Fase 2 automatiza la obtención de precios desde APIs externas y empieza
a registrar el valor diario del portafolio (`snapshots`).

El esquema completo ya existe desde Fase 1 (`price_cache`, `snapshots`). Esta fase
no requiere migraciones nuevas.

## Decisiones tomadas (con fundamento)

1. **Modelo de ejecución: híbrido on-demand, "cron-ready".**
   Los jobs corren bajo la sesión del usuario autenticado en Route Handlers (sin
   `service_role`), coherente con la nota de diseño de Fase 1. La actualización de
   precios y el snapshot del día se disparan **a demanda** (botón / al usar la app).
   La lógica vive en funciones puras para que añadir un cron al desplegar sea un
   envoltorio delgado, no una reescritura. **No** se construye el cron en esta fase.

2. **Alcance de datos: con backfill de históricos (Opción B).**
   Además de la cotización actual, se backfillean series históricas de precios para
   alimentar Analytics/Backtest (Fases 3/4).

3. **Profundidad del backfill: ventana fija ~5 años.**
   Equilibrio entre contexto de un ciclo de mercado y volumen de datos/peticiones.
   Acciones/ETF traen 5 años vía Yahoo; **crypto queda limitada a ~1 año** por el
   límite del plan gratuito de CoinGecko (se documenta en la UI).

4. **Snapshots hacia adelante; los históricos viven como *precios*, no como
   snapshots reconstruidos.**
   El backfill llena `price_cache` con precios históricos. La serie histórica del
   *valor* del portafolio NO se pre-guarda en `snapshots`; la deriva Analytics
   (Fase 3) desde `price_cache` + `transactions`, igual que hoy las posiciones se
   derivan de `transactions` (decisión "sin tabla `positions`"). Evita guardar datos
   derivables que se desincronizan. `snapshots` queda como registro diario hacia
   adelante (idempotente por `unique(user_id, snapshot_date)`).

## Arquitectura

Sigue el patrón establecido en Fase 1: **lógica de dominio pura en `src/lib/`
(testeada con Vitest) + Route Handlers autenticados que validan con Zod y hacen
upsert a Supabase**. No se depende de `service_role`.

### Estructura de módulos

```
src/lib/market-data/
  types.ts          # MarketDataAdapter, Quote, PricePoint
  yahoo.ts          # acciones/ETF: cotización actual + histórico (sin clave)
  coingecko.ts      # crypto: actual + histórico ~1 año (sin clave)
  alpha-vantage.ts  # respaldo histórico de acciones (clave opcional)
  resolver.ts       # asset_type → adaptador
  refresh.ts        # orquesta: agrupa tickers, llama adaptadores, normaliza + estado por fuente
  *.test.ts
src/lib/portfolio/
  snapshot.ts       # computeSnapshotValue(transactions, preciosDeEsaFecha) — puro, reusa holdings/valuation
  snapshot.test.ts
```

### Interfaz de adaptador

```ts
interface MarketDataAdapter {
  id: 'yahoo' | 'coingecko' | 'alpha-vantage'
  supports(assetType: string): boolean
  fetchQuotes(tickers: string[]): Promise<Quote[]>             // actual (batch)
  fetchHistory(ticker: string, from: string): Promise<PricePoint[]>  // 5 años
}
```

- El **parseo es puro** (JSON de la API → filas normalizadas) y se testea inyectando
  respuestas de ejemplo. La llamada de red es una función fina separada (fetcher
  inyectable) para mockear en tests.
- **Aislamiento por fuente**: una fuente que falla reporta ERROR y no tumba a las
  demás.
- Routing por tipo de activo (`resolver.ts`): `stock`/`etf` → Yahoo; `crypto` →
  CoinGecko. Alpha Vantage entra **solo** en el backfill histórico de un ticker de
  acción/ETF cuando Yahoo falla o no devuelve datos para ese ticker **y** la clave
  está configurada; nunca para la cotización actual.

## Flujo de datos

### On-demand (se construye en esta fase)

- **`POST /api/prices/refresh`** — sesión autenticada. Carga los activos del usuario
  → agrupa por adaptador → batch fetch de cotización de hoy → upsert en `price_cache`
  con `source='yahoo'|'coingecko'` (`onConflict: ticker,price_date,source`) → toma el
  snapshot de hoy (idempotente) → devuelve estado por fuente (OK/ERROR + conteo).
- **`POST /api/prices/backfill`** — igual, pero histórico de 5 años por ticker.
  Idempotente: no re-descarga lo ya cacheado.

El upsert + auth viven en el Route Handler; `src/lib/market-data/*` queda puro.

### Cron-ready (NO se construye aún)

La lógica de refresco/snapshot son funciones puras. Al desplegar, el cron será un
`POST /api/cron/snapshot` delgado, protegido por `CRON_SECRET`, reutilizando las
mismas funciones. Fuera del alcance de esta fase.

## Snapshots

`src/lib/portfolio/snapshot.ts` expone `computeSnapshotValue(transactions,
quotesAsOf)` que reusa `computeHoldings` + `valuation`. El refresco on-demand
calcula el valor de hoy y hace upsert en `snapshots` (idempotente por
`unique(user_id, snapshot_date)`). Forward-accumulating; no reconstruye pasado.

## UI — página `/data-sources`

Evoluciona la página actual:
- Las 3 tarjetas de fuentes muestran estado: **OK** (verde) · **ERROR** (rojo, con
  mensaje) · **No configurada** (gris). Más "última actualización" (último
  `price_date` por `source`) y nº de tickers cubiertos.
- Dos botones con estado de carga y resumen: **"Actualizar precios"**
  (`/api/prices/refresh`) y **"Backfill históricos (5 años)"** (`/api/prices/backfill`).
- Se conserva el formulario de **entrada manual** (`source='manual'`).
- Nota visible: "histórico de crypto limitado a ~1 año en plan gratuito".

El estado por fuente se **deriva** de `price_cache` (última fecha + conteo por
`source`) + el resultado del refresco. No se crea tabla de estado nueva.

## Configuración y variables de entorno

| Fuente | Clave | Si falta |
|--------|-------|----------|
| Yahoo Finance | Ninguna | Funciona |
| CoinGecko | Ninguna (free/demo) | Funciona |
| Alpha Vantage | `ALPHA_VANTAGE_API_KEY` (gratis, opcional) | Tarjeta "No configurada", se omite |
| (futuro cron) | `CRON_SECRET` | No aplica aún |

Alpha Vantage es **solo respaldo** y opcional: Fase 2 se completa sin esa clave.
Se añade a `.env.example`.

## Testing (TDD, Vitest)

Todo lo de red mockeado; cero llamadas reales:
- Parsers de cada adaptador: JSON de ejemplo (incl. respuesta de error / dato
  faltante) → filas normalizadas.
- Resolver `asset_type → adaptador`.
- `computeSnapshotValue` (reusa dominio probado).
- Orquestación de `refresh` con adaptadores mockeados: agregación de estado OK/ERROR
  y que una fuente caída no rompe a las otras.

## Manejo de errores y rate limits

- **Aislamiento por fuente**: fallo de una no produce 500 global; reporta ERROR.
- **Batching**: Yahoo multi-símbolo y CoinGecko multi-id en una petición; Alpha
  Vantage solo respaldo, espaciado (≤5/min, 25/día).
- **Idempotencia**: `unique(ticker, price_date, source)` evita duplicados y
  re-descargas.
- **Crypto histórico capado a ~1 año** en plan gratuito (documentado en UI).

## Fuera de alcance (Fase 2)

- Cron / scheduling real y despliegue (se deja "cron-ready").
- Reconstrucción de snapshots históricos (los históricos viven como precios).
- Gráfica de rendimiento histórico y selector de período (Fase 3).
- Conversión multi-moneda / FX: se asume una moneda base (USD); los activos hoy usan
  `currency` con default USD.

## Criterios de aceptación

1. Con activos `stock`/`etf` y `crypto`, "Actualizar precios" llena `price_cache`
   con la cotización de hoy por fuente y el dashboard muestra valores reales sin
   entrada manual.
2. "Backfill históricos" llena `price_cache` con ~5 años (acciones/ETF) y ~1 año
   (crypto) de precios; re-ejecutar no duplica.
3. Al actualizar, se crea/actualiza el snapshot del día (uno por día).
4. `/data-sources` muestra estado OK/ERROR/No configurada por fuente y última
   actualización.
5. Una fuente caída no impide que las demás actualicen.
6. Lint, build y tests Vitest pasan; la lógica de adaptadores y snapshot tiene tests
   con red mockeada.
