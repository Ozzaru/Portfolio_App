# Proyecto 3.1 — Contabilidad de caja · Diseño

**Fecha:** 2026-08-31
**Estado:** diseño aprobado, sin implementar
**Depende de:** Proyecto 3 — Portafolios CLP/USD (migraciones 0006, 0007, 0008)
**Ciclo:** post-MVP, Proyecto 3.1

## 1. Propósito y alcance

### 1.1 El agujero

Hoy una venta reduce la cantidad del activo y ajusta su costo, y **el dinero producto de esa
venta desaparece del modelo**. Las compras se financian contra un fondo infinito imaginario.
No existe efectivo en ninguna moneda, a pesar de que `assets.asset_type` contempla `'cash'`
desde la 0001 y el formulario de `/[portfolio]/portfolio` lo ofrece en su selector.

Cuatro consecuencias medibles, no teóricas:

| # | Síntoma | Dónde |
|---|---|---|
| 1 | Cada compra se cuenta como flujo externo positivo y cada venta como negativo | `analytics/engine.ts:44` |
| 2 | Al cerrar una posición completa `costBasis` se resetea a 0 y la ganancia realizada no queda en ningún lado | `portfolio/holdings.ts:44` |
| 3 | El *cash drag* —la dilución del retorno por liquidez inmovilizada— es invisible en toda métrica | `analytics/returns.ts` |
| 4 | El spread cambiario (8 CLP/USD en horario de mercado, 10 fuera) es un costo real que no se registra | — |

El **1** es el más grave porque está *enmascarado*: `netFlows()` es coherente consigo mismo y
produce un número plausible. Contablemente, comprar un activo es un canje de liquidez por
patrimonio y el valor total no cambia en el instante de la orden. Al no existir la caja, cada
compra "crea" patrimonio de la nada y el TWR y el P&L absoluto pierden validez matemática.

Es el mismo patrón que originó el Proyecto 3 —el IVA autocalculado que *parecía* cubrir el caso
internacional—: un cálculo que se ve bien y miente.

### 1.2 Dentro del alcance

- Tabla `cash_movements` — capital externo: abonos y retiros.
- Tabla `fx_transfers` — conversión de divisa entre portafolios, como **un hecho con dos efectos**.
- Vistas `cash_ledger`, `cash_balances`, `fx_transfers_audit`.
- API y UI para cargar los tres tipos de hecho.
- **Reconstrucción completa del histórico** desde la primera transacción (junio 2026).
- `total_value` pasa a incluir el efectivo; KPI de caja en el dashboard.
- `netFlows()` deja de inferir flujos y los lee del libro.
- Backfill de `snapshots` sumando la caja de cada fecha.

### 1.3 Fuera del alcance

- **P&L realizado por activo.** La caja corrige el P&L *agregado* (Decisión 11); el hueco de
  `holdings.ts:44` por activo sigue abierto y es su propio proyecto.
- **Dividendos, intereses y costos de custodia.** Ver Decisión 9.
- **Prohibir el saldo negativo.** Ver Decisión 8.
- **Tabla materializada de saldos.** Ver Decisión 3.
- **Vista consolidada multi-portafolio.** Cada portafolio mide su caja por separado, igual que
  mide su valor desde el Proyecto 3.
- **Traspaso de activos entre portafolios** (mover AAPL de un bróker a otro). No ocurre hoy.

### 1.4 Sin cambios en el esquema existente

La migración 0009 no toca ninguna tabla, columna, política ni trigger que ya exista. Ver
Decisión 13 — es lo que la hace segura de aplicar sin coordinar con un despliegue.

## 2. Decisiones de comportamiento

### Decisión 1 — La caja NO es una fila en `assets`

Modelarla como un activo más (`asset_type = 'cash'`, `ticker = 'CLP'`) reutilizaría holdings,
valorización, snapshots y RLS sin escribir nada. Se descarta por tres razones, en orden de peso:

1. **No resuelve el requisito, lo duplica.** Que una compra de AAPL retire de la caja exigiría
   *dos* filas en `transactions` —la compra y una "venta" de USD— sin nada en el esquema que las
   ate. Podrían editarse por separado y quedar descuadradas. Es exactamente el patrón que la
   0008 fue a eliminar.
2. **El tipo deja de describir el hecho.** Un abono de $500.000 se codificaría
   `side='buy', quantity=500000, price=1`. Pasa todos los CHECK y es mentira.
3. **Contamina la analítica.** `computeHoldings` devolvería `CLP` como posición;
   `perAssetReturns` y la matriz de correlación la tratarían como instrumento; `priceAsOf`
   necesitaría filas sintéticas de precio 1 en `price_cache` todos los días para siempre; y el
   trigger `assert_fee_structure` de la 0008 se dispararía sobre movimientos de efectivo.

La restricción `unique (user_id, ticker)` de la 0001 —que obligaría a migrar a
`(user_id, portfolio_id, ticker)` para admitir `'USD'` en dos portafolios— es la objeción
*menor*, y desaparece sola al no tomar este camino.

### Decisión 2 — La pata de caja de un trade es una proyección, no una fila

El instinto es un `cash_ledger` más un trigger sobre `transactions` que inserte la
contrapartida. Funciona y crea el problema de siempre: dos representaciones del mismo hecho que
hay que mantener sincronizadas en `insert`, `update` y `delete`.

**Una compra ya contiene su efecto en caja** — `−(quantity × price + fees)`. No hay que
almacenarlo, hay que leerlo. La tabla guarda sólo lo que la transacción no dice ya, y una vista
une ambas cosas.

Consecuencias, todas gratis:

- Editar la transacción cambia la pata de caja sola.
- Borrarla la elimina sola.
- No puede divergir porque no existe por separado.
- Nadie puede escribir media operación a mano: `trade_buy` y `trade_sell` no son valores
  admitidos en ninguna tabla.

Además corrige una asimetría existente en `engine.ts:47`: hoy la compra suma `fees` y la venta
no los resta. En la proyección, las fees siempre reducen la caja.

### Decisión 3 — `cash_balances` es una vista, no una tabla

Un saldo materializado es una caché del libro, y una caché que puede desviarse de su fuente es
el mismo error de este proyecto a menor escala. Con cientos de filas `sum()` es gratis. Si algún
día no lo es, la respuesta es un índice, y sólo después una tabla — nunca al revés.

### Decisión 4 — El traspaso cambiario es una entidad, no dos filas enlazadas

Un `linked_transfer_id` entre dos filas de `cash_movements` falla en cuatro puntos:

- **Huevo y gallina al insertar.** A referencia a B y B a A: no se puede insertar ninguna primero
  sin dejar la FK nullable y hacer un `UPDATE` después. Entre las dos sentencias hay una pata
  huérfana.
- **Nada obliga a la simetría.** A puede apuntar a B mientras B apunta a C. Detectarlo exige leer
  otra fila, o sea un CHECK que no puede serlo → vuelve el trigger que la Decisión 2 evitó.
- **Nada obliga a que los montos se correspondan.**
- **La tasa almacenada puede contradecir a los montos.**

Una conversión **no son dos movimientos que se referencian: es un hecho con dos efectos**. Sube a
entidad propia (`fx_transfers`) y `cash_ledger` proyecta sus dos patas, igual que proyecta la del
trade. La pata huérfana pasa a ser imposible por construcción, no improbable por vigilancia.

### Decisión 5 — La tasa efectiva no se almacena, se deriva

`from_amount / to_amount` da la tasa exacta. Una columna de tasa sería un tercer número capaz de
contradecir a los otros dos — el mismo motivo por el que `fees` es columna generada desde la
0003.

Los 8 y 10 pesos de spread tampoco van en el esquema: son la tarifa de un bróker en un momento
dado, y la 0006 ya fijó el criterio de que **el esquema no versiona la tabla de tarifas de
nadie**. Se calculan contra `price_cache` en `fx_transfers_audit`.

### Decisión 6 — `security_invoker = true` en las tres vistas

En PostgreSQL una vista corre con los permisos de su dueño y **saltea el RLS de las tablas
subyacentes**. Sin `with (security_invoker = true)` (PG15+, que es lo que corre Supabase),
`cash_ledger` expondría el libro de todos los usuarios a cualquier usuario autenticado.

Es una línea fácil de omitir y falla en silencio hacia el lado inseguro: la vista funciona, sólo
que devuelve de más. Queda anotada acá porque no es descubrible leyendo el resultado de una
consulta propia.

### Decisión 7 — Reconstrucción completa del histórico

Tres caminos posibles para el punto de partida:

| | Qué es | Veredicto |
|---|---|---|
| A | Saldo de apertura con fecha de hoy | Descartada: la serie de efectivo no existiría antes del corte |
| B | **Registrar los abonos y retiros reales desde junio** | **Elegida** |
| C | Apertura calculada hacia atrás para que hoy cuadre | Descartada |

**C se descarta por la misma razón que la 0008 borró el trigger de compatibilidad:** un número
sintético que hace cuadrar el presente mintiendo sobre el pasado es un default silencioso que
anula la garantía que dice ofrecer.

**B es viable porque el historial arranca en junio de 2026** y las cartolas del bróker están
disponibles. El costo es data entry; el beneficio es que la serie de capital, los flujos netos y
las métricas de rentabilidad son exactas desde el día uno.

No existe el tipo `opening_balance`: con reconstrucción completa no hace falta, y un tipo que
nunca se usa es superficie que hay que explicar.

### Decisión 8 — El saldo negativo se permite y se advierte

No hay restricción de no-negatividad en la base. Dos razones:

1. **Es información, no corrupción.** Un saldo negativo significa "te falta registrar un abono" o
   "el bróker te dio margen". Prohibirlo obligaría a fabricar un depósito para que un insert
   pase — la misma fabricación de dato plausible que la Decisión 7 descarta.
2. **Es caro y no lo suficientemente correcto.** Validarlo de verdad exige calcular el saldo
   corriente en *cada instante posterior* a la fila insertada, no sólo el final: un retiro con
   fecha atrasada puede dejar el saldo negativo en una ventana y positivo después.

El criterio general: la base impone los invariantes cuyo incumplimiento vuelve el dato *sin
significado* (un trade sin pata de caja, media conversión), no los que lo vuelven *sorprendente*.
Lo sorprendente lo señala la UI.

Durante la reconstrucción (Rebanada 3) los estados intermedios serán negativos de forma
rutinaria, porque las transacciones ya están cargadas y los abonos aún no. Una restricción dura
haría imposible el orden natural de digitación.

### Decisión 9 — Sólo `deposit` y `withdrawal`

Dividendos, intereses y costos de custodia son hechos de caja reales, pero no ocurrieron en el
período a reconstruir. Agregar tipos que nunca se usan es superficie muerta. **El criterio de
detección es la Rebanada 3:** si al cuadrar contra la cartola sobra o falta plata que no explica
ningún trade, abono ni retiro, ahí aparece el tipo que falta y se agrega con evidencia.

### Decisión 10 — `from_portfolio_id` es NOT NULL

El flujo real es secuencial: transferencia bancaria a la billetera local en pesos (portafolio
nacional) y, desde ese saldo, orden de conversión a dólares. Los pesos **sí** tocan la cuenta
chilena, aunque sea por minutos.

Un fondeo que llegara ya convertido se modelaría como dos hechos del mismo día —un `deposit` en
CLP al nacional y un `fx_transfer` al internacional—. Como el saldo se calcula por fecha, `+X` y
`−X` el mismo día se anulan y ninguna serie diaria se distorsiona. La columna nunca necesita ser
nullable.

### Decisión 11 — El efectivo entra en `total_value`

`total_value = valor de mercado de los activos + saldo de caja`.

Es la decisión que cierra el modelo. Sus consecuencias son deliberadas:

- **Una compra deja de mover el valor total** (caja → activo es interno), que es lo correcto
  contablemente y lo que hace válido el TWR.
- **El TWR baja** cuando hay liquidez inmovilizada. No es un defecto del cálculo: tener un millón
  quieto tres semanas efectivamente bajó la rentabilidad. Hoy ese costo es invisible.
- **Los snapshots históricos hay que recalcularlos** (Rebanada 6).

La alternativa —caja como KPI aparte, `total_value` sólo instrumentos— dejaría el modelo a medio
camino: las compras seguirían creando patrimonio de la nada y `netFlows()` tendría que seguir
contándolas.

### Decisión 12 — Los flujos externos se leen del libro

`netFlows()` deja de inferir y consulta:

```sql
select coalesce(sum(amount), 0) from cash_ledger
where portfolio_id = $1 and occurred_at > $2 and occurred_at <= $3
  and movement_type in ('deposit','withdrawal','fx_in','fx_out');
```

Un `fx_out` desde el nacional **sí** es flujo externo *de ese portafolio* —la plata se fue de
ahí— aunque a nivel consolidado sea un traspaso interno. Como la analítica ya es por portafolio
desde el Proyecto 3, eso sale correcto sin ningún caso especial: las patas de trade quedan
excluidas por la misma regla que las define.

**El `absolutePnl` de `/analytics` va a cambiar de valor.** Es una corrección, no una regresión, y
se anota acá para que no se descubra mirando la pantalla.

### Decisión 13 — La migración 0009 es puramente aditiva

No toca ninguna tabla, columna, política ni trigger existente, y nada del código actual lee las
tablas nuevas. A diferencia de la 0006→0008 —donde había una ventana con un lado roto se hiciera
en el orden que se hiciera— la 0009 se puede aplicar en cualquier momento, sin desplegar código,
y la app sigue funcionando igual sin enterarse.

Esa propiedad es consecuencia directa de las Decisiones 1 y 2: dejar la caja estructuralmente
aislada de los instrumentos es lo que elimina la ventana.

### Decisión 14 — `cash_ledger` no expone una columna `id`

Un `fx_transfer` emite dos filas y ambas tendrían el mismo `id`. PostgREST publicaría una columna
que *parece* clave y no lo es. La identidad de una fila del libro es
`(source, source_id, movement_type)`.

### Decisión 15 — El backfill de snapshots va después de la reconstrucción

Sumar la caja a los snapshots históricos sólo es correcto si el libro está completo. Rebanada 6
depende de la 3, y su guarda es que la 3 haya cuadrado contra la cartola.

Los snapshots anteriores al Proyecto 3 siguen siendo el "consolidado legacy" que documentó la
0006: su `total_value` ya mezclaba ambas carteras. El backfill de caja no los arregla ni los
empeora; se aplica con la misma regla y la limitación sigue siendo la ya asumida.

## 3. Arquitectura

### 3.1 Esquema (`supabase/migrations/0009_cash_ledger.sql`)

```
cash_movements                     fx_transfers
├ user_id                          ├ user_id
├ portfolio_id                     ├ from_portfolio_id / from_currency / from_amount
├ currency                         ├ to_portfolio_id   / to_currency   / to_amount
├ movement_type                    └ occurred_at
│   deposit | withdrawal
├ amount (con signo)
└ occurred_at
```

- `cash_ledger` (vista) = `cash_movements` ∪ patas de `transactions` ∪ las dos patas de `fx_transfers`.
- `cash_balances` (vista) = `sum(amount)` de `cash_ledger` por `(portfolio_id, currency)`.
- `fx_transfers_audit` (vista) = `fx_transfers` + tasa efectiva + tasa de mercado + costo del spread.

### 3.2 Dónde vive cada garantía

| Riesgo | Cómo se impide |
|---|---|
| Una pata sin la otra | **Imposible por construcción** — no son filas |
| Patas con monto o fecha desalineados | **Imposible** — salen de la misma fila |
| Borrar una pata suelta | **Imposible** — sólo se borra el hecho completo |
| Escribir `fx_in` / `trade_buy` a mano | **Imposible** — no son valores admitidos en ninguna tabla |
| Tasa que contradice los montos | **Imposible** — la tasa no se almacena |
| Montos ≤ 0 | CHECK |
| Signo incoherente con el tipo | CHECK |
| Traspaso de una cuenta a sí misma | CHECK |
| Portafolio de otro usuario | RLS `with check` + `exists`, patrón de la 0008 |
| Fuga de datos entre usuarios vía vista | `security_invoker = true` |
| Saldo negativo | **No se impide** — se advierte en la UI (Decisión 8) |

### 3.3 API

Agrupadas bajo `/api/cash/` porque son tres y comparten contexto. Todas resuelven el portafolio
con `requirePortfolio`, igual que el resto desde el Proyecto 3.

| Ruta | Verbos | Nota |
|---|---|---|
| `/api/cash/movements` | GET, POST, DELETE | Abonos y retiros |
| `/api/cash/transfers` | GET, POST, DELETE | Conversiones; `POST` recibe ambas patas |
| `/api/cash/balances` | GET | Lee la vista; sin lógica |

Las rutas son delgadas a propósito: la base hace el trabajo. La lógica que sí se testea vive en
los schemas de Zod y en la integración de la caja con la valorización.

### 3.4 Cambios en código existente

| Archivo | Cambio | Rebanada |
|---|---|---|
| `lib/validation/schemas.ts` | `cashMovementInputSchema`, `fxTransferInputSchema` | 2 |
| `lib/portfolio/valuation.ts` | `portfolioTotals` recibe el saldo de caja | 4 |
| `lib/portfolio/snapshot.ts` | `computeSnapshotValue` suma la caja | 4 |
| `app/api/positions/route.ts` | Lee `cash_balances`, lo pasa a la valorización | 4 |
| `app/(app)/[portfolio]/dashboard/page.tsx` | KPI de efectivo + aviso de saldo negativo | 4 |
| `lib/analytics/engine.ts` | `netFlows()` lee el libro (Decisión 12) | 5 |
| `app/api/analytics/route.ts` | Provee los flujos al motor | 5 |

`holdings.ts` **no se toca**: la caja no es una posición.

### 3.5 UI

Una sección de efectivo en `/[portfolio]/portfolio`, junto a los formularios que ya existen:
saldo actual por moneda, formulario de abono/retiro, formulario de conversión, y el libro
filtrable. La conversión sólo aparece si el usuario tiene más de un portafolio.

El aviso de saldo negativo es visible pero no bloqueante (Decisión 8): dice qué significa
—"falta registrar un abono"— en vez de sólo pintar el número en rojo.

## 4. Bordes y testing

### 4.1 Verificable en SQL (Rebanada 1)

- Insertar un `fx_transfer` produce exactamente dos filas en `cash_ledger`, con signos opuestos y
  la misma fecha.
- Borrar el `fx_transfer` elimina ambas.
- `update` sobre una `transaction` mueve su pata de caja sin tocar nada más.
- Un `withdrawal` con `amount > 0` es rechazado por el CHECK de signo.
- Un traspaso con origen y destino idénticos es rechazado.
- Un traspaso hacia el portafolio de otro usuario es rechazado por RLS.
- Consultar `cash_ledger` como usuario A no devuelve filas de B (verifica `security_invoker`).

### 4.2 Tests unitarios (TDD, Rebanadas 4 y 5)

- `portfolioTotals` con caja positiva, cero y negativa.
- `computeSnapshotValue` con caja en moneda distinta a la base (requiere FX).
- `netFlows` distinguiendo patas de trade de flujos externos.
- `netFlows` contando `fx_out` como flujo externo del portafolio de origen.
- Ventana `(from, to]` — un movimiento exactamente en `from` no cuenta; en `to` sí.

### 4.3 El borde que no se testea automáticamente

**El criterio de aceptación de la Rebanada 3 es un número que sale del bróker.** `cash_balances`
para `nacional` e `internacional` tiene que cuadrar al peso con lo que muestra la aplicación del
bróker. Si no cuadra, falta un movimiento — y ahí aparece si hay un tipo que la Decisión 9 dejó
fuera.

### 4.4 Caja en moneda distinta a la base

`cash_movements.currency` es libre: un bróker chileno que guarde dólares es posible, y el
esquema no lo prohíbe (mismo criterio con que la 0006 separó `base_currency` de
`fee_structure_type`). En la práctica habrá una moneda por portafolio.

Cuando no la haya, el saldo se convierte a la moneda base con el mismo módulo `fx/` y la misma
regla que los activos: FX de hoy para el valor actual. `cash_balances` devuelve una fila por
moneda; la UI las muestra por separado y la valorización las suma convertidas.

## 5. Rebanadas

| # | Rebanada | Verificación |
|---|---|---|
| 1 | Migración 0009: tablas, vistas, RLS, índices, guardas | §4.1 en el SQL Editor |
| 2 | API + schemas de validación | Tests de schemas; CRUD manual |
| 3 | UI de carga + **reconstrucción del histórico** | §4.3 — cuadra contra la cartola |
| 4 | Caja en la valorización y en `total_value` | Tests §4.2 + dashboard |
| 5 | `netFlows()` lee el libro | Tests §4.2; `absolutePnl` cambia de valor |
| 6 | Backfill de snapshots | Depende de que la 3 haya cuadrado |

La 1 y la 2 son independientes del resto. La 3 tiene trabajo del usuario, no del código. La 6 no
puede empezar antes de que la 3 termine (Decisión 15).

## 6. Decisiones clave (resumen)

1. La caja no es un activo — evita duplicar el hecho y contaminar la analítica.
2. La pata de caja de un trade es una proyección — la desincronización es imposible, no vigilada.
3. `cash_balances` es vista, no tabla — un saldo materializado es una caché que puede desviarse.
4. El traspaso cambiario es una entidad — la pata huérfana es imposible por construcción.
5. La tasa se deriva, no se almacena — no puede contradecir a los montos.
6. `security_invoker = true` — sin eso la vista saltea RLS y filtra datos entre usuarios.
7. Reconstrucción completa del histórico — sin tapones sintéticos ni discontinuidades.
8. El saldo negativo se permite y se advierte — es información, no corrupción.
9. Sólo `deposit` y `withdrawal` — los demás tipos aparecen con evidencia, en la Rebanada 3.
10. `from_portfolio_id` NOT NULL — refleja el flujo real del bróker.
11. El efectivo entra en `total_value` — cierra el modelo y hace válido el TWR.
12. Los flujos externos se leen del libro — `fx_out` es flujo del portafolio de origen.
13. La 0009 es puramente aditiva — sin ventana rota, aplicable sin desplegar código.
14. El libro no expone `id` — un traspaso emite dos filas.
15. El backfill va después de la reconstrucción — sumar caja incompleta es peor que no sumarla.
