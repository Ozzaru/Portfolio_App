# Fase 7 — Soporte Multi-Moneda (base CLP) · Diseño

**Fecha:** 2026-08-06
**Estado:** diseño aprobado, pendiente de plan de implementación
**Depende de:** Fase 1 (`assets.currency`, `transactions`), Fase 2 (`price_cache`, backfill), Fase 3 (motor de analítica)
**Roadmap:** primera fase post-MVP. Ver [ROADMAP.md](../plans/ROADMAP.md).

## 1. Propósito y alcance

El usuario compra acciones chilenas en CLP a través de **Zesty** (ej. `ENELCHILE.SN`) además de
sus activos en USD. Hoy `assets.currency` existe en el esquema pero es **metadata muerta**:
[`valuation.ts`](../../../src/lib/portfolio/valuation.ts) suma `marketValue` de todas las
posiciones sin mirar la moneda, y lo mismo ocurre en analytics, dashboard, backtest y
scenarios. Cargar ENELCHILE a CLP$79,68 junto a activos en USD produciría un "Valor Total" que
suma pesos con dólares como si fueran la misma unidad.

Esta fase convierte la app en **multi-moneda real con base CLP**, y modela los costos de
transacción del comprobante de Zesty (comisión + IVA).

### Dentro del alcance
- **Ingesta y caché del tipo de cambio** `USDCLP=X` reusando `price_cache`.
- **`toBaseCurrency`**: normalización de series de precios y transacciones a CLP en la
  **frontera de datos**, dejando los motores agnósticos a la moneda.
- **Cost basis al FX histórico** de cada transacción (Decisión 4).
- **Comisión e IVA** como columnas separadas en `transactions`.
- **Benchmark convertido a CLP** en Analytics; **Backtest y Scenarios** en base CLP.
- **Migración de `snapshots`**: columna `currency` + backfill de los históricos en USD.
- **Alertas en moneda nativa** (sin cambios de motor) y **formato monetario** por moneda.

### Fuera del alcance (fast-follow)
- **Volatilidad y Sharpe individuales por activo** con intersección estricta. Hoy
  [`perAsset.ts`](../../../src/lib/analytics/perAsset.ts) solo calcula retorno punto-a-punto;
  añadir desviación estándar por ticker es **feature nueva**, no un requisito de corrección
  multi-moneda. Se difiere para acotar el alcance del refactor.
- **Moneda base configurable** por UI (ver Decisión 3).
- **Shock cambiario en escenarios** (ver Decisión 11).
- Monedas distintas de USD y CLP. El diseño no las impide, pero no se implementan ni testean.

## 2. Decisiones de comportamiento

### Decisión 1 — Consolidación por moneda base, no portafolios separados
Todo se valoriza en **CLP**. Cada posición conserva y muestra su precio en su **moneda
nativa**, pero el Valor Total, la distribución de activos, el P&L y toda la analítica operan en
CLP. Es la única opción en que el retorno porcentual total, los pesos por activo y el backtest
mantienen sentido matemático: sumar valores en monedas distintas no es una operación válida, y
sin un total consolidado no se puede calcular ningún peso ni ninguna correlación de cartera.

### Decisión 2 — La conversión vive en la frontera de datos, no en los motores
Una única función normaliza las series **antes** de que cualquier motor las vea. En
consecuencia **`metrics.ts`, `engine.ts`, `correlation.ts`, `riskMetrics.ts` y `scenarios/` no
se modifican**: siguen recibiendo una sola moneda, exactamente como hoy.

La alternativa (convertir *on-the-fly* dentro de cada motor) es inviable en el punto donde más
haría falta: [`backtest/metrics.ts`](../../../src/lib/backtest/metrics.ts) recibe
`EquityPoint[]` = `{date, value}`, un escalar agregado por fecha. Ahí ya se perdió qué parte del
valor venía de cada activo, así que no queda nada que convertir. Además replicaría la lógica de
conversión en N motores = N superficies de error y N sets de tests.

### Decisión 3 — Moneda base como constante, no como setting (YAGNI)
`BASE_CURRENCY = 'CLP'` es una **constante de módulo**. Hacerla configurable exigiría plomería
de parámetros por cinco rutas de API más UI en `/settings`, para una cartera personal radicada
en Chile. La columna `currency` en `snapshots` (Decisión 9) deja el dato **autodescriptivo**,
de modo que volverla configurable en el futuro no obliga a re-migrar nada.

### Decisión 4 — Valor de mercado a FX de hoy; **cost basis a FX de la fecha de compra**
El valor de mercado usa el FX actual. El **costo** de cada transacción se convierte con el FX de
su `executedAt`.

Ejemplo: comprar AAPL a US$100 con el dólar a $800 costó **CLP$80.000**. Convertir ese costo al
dólar de hoy (~$950) diría CLP$95.000 y **borraría CLP$15.000 de ganancia cambiaria** — que es
ganancia real para un inversor cuyo patrimonio se mide en pesos. La diferencia entre valor de
mercado (FX hoy) y costo (FX histórico) es el P&L total en CLP, e incluye correctamente el
componente cambiario. Sin esta regla el P&L queda mal de forma sistemática y silenciosa.

### Decisión 5 — Convención FX explícita y blindada con test
Símbolo canónico **`USDCLP=X`**. Su valor son **CLP por 1 USD** (≈ 950).

Conversión: `valorCLP = valorUSD × fx(fecha)`.

Invertir la dirección produce un error de **seis órdenes de magnitud** que en un gráfico
normalizado a base 100 se ve perfectamente plausible. Por eso la convención lleva un test
dedicado con números concretos (`100 USD × 950 = 95.000 CLP`), no solo una nota en un comentario.

### Decisión 6 — `price_cache` almacena **siempre precios nativos**
La conversión ocurre **en memoria, al leer**. El caché nunca guarda valores convertidos.

Tres consecuencias buscadas: (a) el caché sigue siendo una fuente de verdad limpia y comparable
con el broker; (b) las **alertas funcionan en moneda nativa sin tocar el motor** (Decisión 12);
(c) cambiar la moneda base en el futuro no invalida años de caché acumulado.

### Decisión 7 — Las tres reglas invariantes de `toBaseCurrency`
1. **Nunca agrega fechas.** Solo multiplica puntos que ya existen en la serie del ticker. Esto
   es lo que protege el `realAdj.has(d)` del que depende la intersección de la correlación
   ([`engine.ts:161`](../../../src/lib/analytics/engine.ts#L161)). Si la conversión rellenara
   fechas, rompería silenciosamente una protección ya existente.
2. **CLP pasa directo.** Sin lookup de FX, sin multiplicación, sin error de redondeo acumulado.
3. **Si falta FX para una fecha, el punto se descarta** — nunca se deja pasar sin convertir.
   Descartar encoge la intersección de forma conservadora y visible; dejar pasar sin convertir
   inyecta un error de 950x que contaminaría el NAV y el Max Drawdown sin señal alguna.
   Descartar además respeta la regla 1, porque solo **quita** fechas.

El FX se busca con **forward-fill** sobre la fecha del punto: un feriado en Chile con mercado
abierto en EE.UU. usa el último FX publicado.

### Decisión 8 — Bifurcación de calendarios según el tipo de métrica
Al incorporar activos de la Bolsa de Santiago, el calendario canónico de
[`tradingDates`](../../../src/lib/analytics/series.ts#L26) pasa a ser la **unión** de días
hábiles de NYSE y Santiago. Un feriado chileno hábil en EE.UU. (18 de septiembre) hace que
`priceAsOf` resuelva `prev` y `cur` al mismo precio rancio → **retorno exactamente 0**. El
tratamiento de esos ceros depende de la métrica:

| Métrica | Calendario | Estado |
|---|---|---|
| Equity curve / NAV, **Sharpe y volatilidad del portafolio**, Max Drawdown | **Unión + forward-fill** (serie continua) | Ya correcto — **no se toca** |
| **Correlación / covarianza** | **Intersección estricta**, sin forward-fill | Ya implementado ([`engine.ts:145`](../../../src/lib/analytics/engine.ts#L145)) |
| Volatilidad individual por activo | Intersección estricta | **Fuera de alcance** (§1) |

**Por qué el portafolio se queda en la serie continua:** en un feriado chileno ENELCHILE aporta
retorno 0, pero el patrimonio **sí fluctuó realmente**, impulsado por los activos en USD y por
el propio USDCLP. Descartar ese día subestimaría la volatilidad efectiva de la cartera y
rompería la continuidad del NAV.

**Por qué las métricas cross-asset usan intersección:** ahí el 0 no es un movimiento, es un
artefacto de mercado cerrado. Incluirlo **subestima la volatilidad individual y diluye las
correlaciones** entre activos chilenos y estadounidenses. El código ya lo resuelve así, con esa
justificación explícita (Decisión 4 del spec de Fase 3).

### Decisión 9 — Migración de snapshots: convertir el histórico, no descartarlo
`snapshots.total_value` es hoy un escalar **sin moneda**. Todos los snapshots existentes se
calcularon en USD implícito. Al pasar la base a CLP, históricos y nuevos dejan de ser
comparables y la gráfica de patrimonio mostraría un **salto artificial de ~950x**.

El script de migración multiplica cada `total_value` histórico por el `USDCLP=X` de su
`snapshot_date` (con forward-fill) y marca `currency = 'CLP'`, empalmando el historial con la
nueva arquitectura. Es **idempotente por construcción**: solo toca filas con `currency is null`
y las marca al convertirlas, así que correrlo dos veces no puede doble-convertir.

**Automatizado y atómico, no manual.** Las dos precondiciones se verifican **dentro** de un
bloque `DO $$ … END $$` y abortan con `RAISE EXCEPTION`. Como PostgreSQL tiene **DDL
transaccional**, la excepción revierte la migración **completa** —incluidos los `ALTER TABLE`
de las columnas nuevas— dejando la base exactamente como estaba. Seguridad y automatización sin
tener que elegir entre ambas: no hay estado intermedio posible en el que las columnas existan
pero el histórico esté a medio convertir.

### Decisión 10 — Transacciones sin FX: fallar ruidosamente (≠ series de precios)
La regla de descarte de la Decisión 7.3 aplica a **series de precios**, donde perder un punto
solo encoge la muestra. **No aplica a transacciones**: descartar una compra alteraría los
holdings y produciría una cartera incorrecta.

Si falta FX para el `executedAt` de una transacción, la conversión **lanza un error** con
mensaje accionable (`falta tipo de cambio USDCLP=X para <fecha>; ejecuta el backfill`). Fallar
ruidosamente es preferible a mostrar una cartera silenciosamente equivocada.

### Decisión 11 — Escenarios con tipo de cambio fijo (limitación documentada)
Los shocks se aplican sobre retornos ya expresados en CLP, **manteniendo el FX constante**.

En la realidad, un selloff global suele fortalecer el dólar contra el peso, amortiguando
parcialmente la caída para un tenedor chileno; el escenario modelado es por tanto
**conservador** (pesimista) para la porción en USD. Modelar el shock cambiario correlacionado
es otro proyecto. El supuesto se muestra **en la página `/scenarios`**, no enterrado en un
comentario del código.

### Decisión 12 — Alertas en moneda nativa, sin cambios de motor
Las alertas leen `price_cache`, que por la Decisión 6 contiene precios nativos. Por lo tanto
`ENELCHILE > 85` se interpreta en CLP y `AAPL > 250` en USD, que es exactamente lo que el
usuario ve en su broker. **El motor de alertas no se modifica**; solo la UI muestra la moneda
junto al umbral (`ENELCHILE > CLP$85`).

### Decisión 13 — `fees` sigue siendo el total; comisión e IVA son su desglose
`transactions` gana `commission` e `iva`. `fees` se mantiene como **total autoritativo** que
alimenta el cost basis, con el invariante `fees = commission + iva` garantizado por CHECK
constraint. Las filas heredadas se backfillean como `commission = fees, iva = 0` (antes de esta
fase no había IVA), de modo que el invariante se cumple universalmente y los motores que ya
leen `fees` **no cambian**.

El IVA chileno es **19% sobre la comisión**. El formulario lo autocalcula y lo deja
**editable**, porque Zesty redondea a peso entero: 19% × 29 = 5,51 → cobra **6**. Validado
contra el comprobante real:

| Línea | Valor | Verificación |
|---|---|---|
| 244 × CLP$79,68 | 19.441,92 | ≈ Sub total CLP$19.442 ✓ |
| Comisión | 29 | |
| IVA (19% × 29 = 5,51) | 6 | redondeo a entero ✓ |
| **Total** | **19.477** | 19.442 + 29 + 6 ✓ |

### Decisión 14 — Arreglo puntual: las comisiones de venta se evaporan
[`holdings.ts:38-40`](../../../src/lib/portfolio/holdings.ts#L38-L40) descarta los `fees` en las
ventas: solo resta `sellQty × avgCost` del cost basis y nunca contabiliza el costo de la
operación. Es una mejora acotada al archivo que esta fase ya modifica, no un refactor
oportunista. Las comisiones de venta pasan a reducir el resultado de la venta.

### Decisión 15 — El retorno cambiario queda **dentro** de los retornos (consecuencia aceptada)
Convertir a CLP significa que el retorno de un activo en USD incorpora el movimiento del
USDCLP. Es lo correcto para un inversor cuyo patrimonio se mide en pesos: ese **es** su retorno
real.

La consecuencia a tener presente es que **todos los activos en USD pasan a compartir un driver
común** —el tipo de cambio— por lo que la **correlación entre ellos sube** respecto de la
medida en moneda local, sin que las empresas se hayan movido más juntas. Es un efecto esperado
y aceptado, no un defecto; se documenta aquí para que no se diagnostique como bug al leer la
matriz de correlación. Ninguna cifra del código cambia por esta decisión, pero **los valores
numéricos de volatilidad, Sharpe y correlación sí cambiarán** respecto de los actuales, aun en
los motores que no se modifican.

## 3. Arquitectura

### Módulo FX puro (`src/lib/fx/`, TDD)
- **`constants.ts`** — `BASE_CURRENCY = 'CLP'`, `FX_TICKER = 'USDCLP=X'`, `IVA_RATE = 0.19`.
- **`convert.ts`** — funciones puras, sin DB:
  - `fxAsOf(fxSeries, date): number | null` — forward-fill; reusa la semántica de `priceAsOf`.
  - `convertSeries(points, currency, fxSeries): PricePointAdj[]` — primitiva sobre una serie
    suelta (la usa el benchmark). Convierte `price` **y** `adjPrice`. Aplica las tres reglas de
    la Decisión 7.
  - `toBaseCurrency(series, currencyByTicker, fxSeries): PriceSeriesByTicker` — envoltorio a
    nivel de mapa sobre `convertSeries`.
  - `transactionsToBaseCurrency(txs, currencyByTicker, fxSeries): Transaction[]` — convierte
    `price` y `fees` al FX de `executedAt` (Decisión 4); **lanza** si falta FX (Decisión 10).
- **`load.ts`** — integración server: carga la serie `USDCLP=X` desde `price_cache` con
  `fetchAllRows` (mismo patrón paginado que el resto de rutas).

### Formato (`src/lib/format/money.ts`)
- **`formatMoney(valor, moneda)`** — `Intl.NumberFormat('es-CL', { style: 'currency', … })`.
  CLP sin decimales (`$19.442`), USD con dos (`US$293,08`).

### Frontera: dónde se aplica la conversión
Las rutas que construyen `PriceSeriesByTicker` cargan además la serie FX y llaman a
`toBaseCurrency` **antes** de invocar cualquier motor: `/api/positions`, `/api/analytics`,
`/api/backtest`, `/api/scenarios`. Las transacciones crudas se conservan intactas para
mostrarlas en su moneda nativa en la tabla de Portafolio; los motores reciben la copia
convertida.

### Valorización (`src/lib/portfolio/valuation.ts`)
`PositionView` gana **`nativeCurrency`** y **`nativePrice`** para presentación. Los campos
existentes (`currentPrice`, `marketValue`, `costBasis`, `unrealizedPnl`) pasan a estar **todos
en CLP**, dado que reciben holdings y quotes ya convertidos. `portfolioTotals` no cambia: opera
sobre una sola moneda.

### Ingesta FX (`src/lib/market-data/`)
`USDCLP=X` se trata como un ticker más de Yahoo (Decisión: pseudo-ticker en `price_cache`, sin
tabla nueva). Reusa el backfill, el refresh y la deduplicación existentes
(`unique (ticker, price_date, source)`). Requiere una excepción explícita en la resolución de
fuente, porque `quoteSourceFor` devuelve `null` para lo que no es stock/etf/crypto: el FX se
enruta a Yahoo por símbolo, no por `asset_type` (no tiene fila en `assets`).

### Migración (`supabase/migrations/0003_multi_currency.sql`)

**Prerrequisito (único paso manual):** backfillear `USDCLP=X` en `price_cache` cubriendo todo el
rango de `snapshot_date` **antes** de ejecutar la migración. Va por el endpoint de backfill de
la app, no por SQL. La Guarda B lo verifica y aborta si falta, así que olvidarlo no puede
corromper nada.

```sql
-- supabase/migrations/0003_multi_currency.sql
-- Ejecutar COMPLETO en el SQL Editor. DDL transaccional: si una guarda falla,
-- revierte todo (columnas incluidas) y la base queda como estaba.

-- 1. Costos desglosados
alter table transactions add column commission numeric not null default 0 check (commission >= 0);
alter table transactions add column iva        numeric not null default 0 check (iva >= 0);
update transactions set commission = fees, iva = 0;          -- histórico: todo era comisión
alter table transactions add constraint fees_breakdown check (fees = commission + iva);

-- 2. Moneda del snapshot (nullable primero; el bloque de abajo la rellena)
alter table snapshots add column currency text;

-- 3. Guardas + conversión, atómico
do $$
declare
  mixed_assets int;
  missing_fx   int;
begin
  -- Guarda A: el histórico debe ser USD puro. Si ya hubiera un activo en otra
  -- moneda dentro del rango, multiplicar el total por el FX sería incorrecto.
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
      'Ejecuta primero el backfill de FX.', missing_fx;
  end if;

  -- Conversión idempotente: solo filas sin moneda; forward-fill del FX.
  update snapshots s
  set total_value = s.total_value * (
        select pc.price from price_cache pc
        where pc.ticker = 'USDCLP=X' and pc.price_date <= s.snapshot_date
        order by pc.price_date desc limit 1),
      currency = 'CLP'
  where s.currency is null;
end $$;

-- 4. Cierre
alter table snapshots alter column currency set default 'CLP';
alter table snapshots alter column currency set not null;
```

**Base vacía:** con `snapshots` sin filas, `max(snapshot_date)` es `NULL`, ambas guardas cuentan
`0`, el `update` afecta 0 filas y el `set not null` pasa. La migración es segura en una
instalación nueva.

### Validación (`src/lib/validation/schemas.ts`)
`transactionInputSchema` reemplaza `fees` por `commission` e `iva` (ambos
`coerce.number().nonnegative().default(0)`); la ruta deriva `fees = commission + iva`. No se
valida que el IVA sea exactamente 19% de la comisión: los brokers redondean y difieren entre sí.

### UI
- **`/portfolio`** — formulario de activo con **autocompletado de moneda**: un ticker terminado
  en `.SN` sugiere `CLP` (sugerencia cliente, editable). Formulario de transacción con campos
  **Comisión** e **IVA**, este último autocalculado como `19% × comisión` y redondeado según la
  moneda del activo (CLP a entero, resto a 2 decimales), editable. La tabla de transacciones
  muestra montos en **moneda nativa**.
- **`/dashboard`** — KPI cards, distribución y tabla en CLP vía `formatMoney`. La tabla de
  posiciones muestra **precio nativo** y **valor en CLP**.
- **`/analytics`** — benchmark convertido a CLP; el label pasa a **"S&P 500 (en CLP)"** para que
  el número no se lea como un bug.
- **`/backtest`** — `initialCapital` etiquetado **"Capital inicial (CLP)"**.
- **`/scenarios`** — nota visible con el supuesto de FX fijo (Decisión 11).
- **`/alerts`** — moneda junto al umbral (`ENELCHILE > CLP$85`).

## 4. Bordes y testing

**Tests puros (Vitest, TDD) — `src/lib/fx/convert.test.ts`:**
- **Dirección del FX** con números concretos: `100 USD × 950 → 95.000 CLP` (Decisión 5).
- `fxAsOf`: fecha exacta; fecha posterior sin publicación (forward-fill); fecha anterior al
  inicio de la serie → `null`.
- `convertSeries`: para CLP los valores salen **sin modificar** (ni multiplicación ni redondeo);
  para USD multiplica `price` y `adjPrice`; fecha sin FX → **punto descartado**.
- **Invariante "nunca agrega fechas"**: para toda entrada, el conjunto de fechas de salida es
  **subconjunto** del de entrada (Decisión 7.1).
- `transactionsToBaseCurrency`: usa el FX de `executedAt` y **no** el de hoy (test con dos FX
  distintos que discriminan ambos casos); convierte `price` y `fees`; **lanza** si falta FX
  (Decisión 10).

**Test de integración de la protección de correlación:**
- Convertir series y luego `buildCorrelation`: con un feriado chileno presente en la unión, la
  fecha **queda excluida** de la intersección y no inyecta un retorno 0 (Decisión 8).

**Otros:**
- `holdings.ts`: una venta con `fees > 0` los contabiliza (Decisión 14); test de regresión con
  compra → venta parcial → verificación de cost basis.
- `fees = commission + iva` en la ruta de transacciones; el CHECK rechaza escrituras
  inconsistentes.
- `formatMoney`: CLP sin decimales, USD con dos.
- Migración: **guardas A y B** abortan con `RAISE EXCEPTION` y revierten la transacción completa
  (verificar que las columnas **no** quedan creadas tras un fallo); **idempotencia** comprobada
  corriendo el bloque dos veces (la segunda afecta 0 filas); **base vacía** ejecuta sin error.
- Rutas, páginas y migración se validan con **lint + build + e2e**, igual que las Fases 4-6.

## 5. Decisiones clave (resumen)

1. Consolidación en **moneda base CLP** con FX; cada posición muestra su precio nativo.
2. La conversión vive en la **frontera de datos**; los motores no se modifican.
3. `BASE_CURRENCY = 'CLP'` como **constante**, no setting (YAGNI).
4. **Valor de mercado a FX de hoy; cost basis al FX de la fecha de compra** — captura el retorno
   cambiario real.
5. Convención `USDCLP=X` = **CLP por 1 USD**, blindada con test de dirección.
6. `price_cache` guarda **siempre precios nativos**; se convierte en memoria al leer.
7. `toBaseCurrency`: **nunca agrega fechas**, CLP pasa directo, falta de FX **descarta** el punto.
8. **Bifurcación de calendarios**: unión + ffill para NAV/Sharpe/vol del portafolio;
   intersección estricta para correlación y covarianza.
9. Snapshots: columna `currency` + backfill **idempotente** con dos guardas en un bloque
   `DO $$` que aborta con `RAISE EXCEPTION` y revierte la migración completa.
10. Falta de FX en **transacciones falla ruidosamente** (a diferencia de las series de precios).
11. Escenarios con **FX fijo**; supuesto visible en la página.
12. Alertas en **moneda nativa**, motor sin cambios.
13. `fees` sigue siendo el total (`= commission + iva`, con CHECK); IVA 19% autocalculado y
    editable por el redondeo de Zesty.
14. Arreglo puntual: las **comisiones de venta** dejan de evaporarse en `holdings.ts`.
15. El **retorno cambiario queda dentro de los retornos** (consecuencia aceptada): sube la
    correlación entre activos USD y cambian los valores de volatilidad y Sharpe.
