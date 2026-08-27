// src/lib/fx/convert.ts
import { priceAsOf } from '@/lib/analytics/series'
import type { PricePointAdj, PriceSeriesByTicker } from '@/lib/analytics/types'
import type { Transaction } from '@/lib/portfolio/holdings'
import { FX_TICKER } from './constants'

// Tipo de cambio vigente en `date` con forward-fill: un feriado en Chile con
// mercado abierto en EE.UU. usa el último FX publicado (Decisión 7).
// Reusa `priceAsOf` para no duplicar la semántica de forward-fill del proyecto.
export function fxAsOf(fxSeries: PricePointAdj[], date: string): number | null {
  const point = priceAsOf(fxSeries, date)
  return point && point.price > 0 ? point.price : null
}

// Convierte una serie a la moneda base. Tres reglas invariantes (Decisión 7):
//   1. NUNCA agrega fechas — solo multiplica puntos existentes. Esto protege el
//      `realAdj.has(d)` del que depende la intersección de la correlación en
//      analytics/engine.ts; rellenar fechas rompería esa protección en silencio.
//   2. La moneda base pasa directo, sin lookup ni multiplicación.
//   3. Si falta FX para una fecha, el punto se DESCARTA. Dejarlo pasar sin
//      convertir inyectaría un error de ~950x indetectable en un gráfico
//      normalizado; descartar encoge la muestra de forma visible y conservadora,
//      y respeta la regla 1 porque solo quita fechas.
// `baseCurrency` es OBLIGATORIO y sin default a propósito. Un default sería la
// misma trampa que originó el Proyecto 3: el IVA se aplicaba a operaciones en
// dólares porque tenía un 19% silencioso que nadie revisaba. Si un llamador no
// sabe en qué moneda está midiendo, tiene que detenerse a averiguarlo — no
// heredar una suposición que convierte mal sin avisar.
export function convertSeries(
  points: PricePointAdj[],
  currency: string,
  fxSeries: PricePointAdj[],
  baseCurrency: string
): PricePointAdj[] {
  if (currency === baseCurrency) return points
  // Solo existe el par USD → CLP. El portafolio internacional mide en USD y sus
  // activos y benchmarks ya cotizan en USD, así que nunca necesita conversión;
  // y los activos en pesos viven en el portafolio en pesos. Implementar la
  // matemática inversa sin un caso de uso real es cómo se introducen errores
  // silenciosos: si algún día hace falta, este throw lo dice con claridad en
  // vez de dividir mal.
  if (!(currency === 'USD' && baseCurrency === 'CLP')) {
    throw new Error(`conversión no soportada: ${currency} → ${baseCurrency}`)
  }
  const out: PricePointAdj[] = []
  // Ambas series vienen ordenadas por fecha, así que se recorren con un cursor
  // en tiempo lineal. Llamar a `fxAsOf` por punto sería O(puntos × puntosFX):
  // `priceAsOf` rebobina la serie FX completa en cada llamada, y con 5 años de
  // historia diaria eso son millones de comparaciones por request.
  //
  // PRECONDICIÓN: `points` debe venir ordenado ascendente por fecha (igual que
  // `fxSeries`, exigido ya por `priceAsOf`/`loadFxSeries`). Es el contrato
  // documentado de `PriceSeriesByTicker` y lo cumple su constructor real
  // (la ruta de analytics, `ORDER BY price_date asc`).
  // Si se rompe, el cursor NO retrocede y esta función da resultados
  // incorrectos en silencio — ver test "asume orden ascendente" en
  // convert.test.ts, que fija ese comportamiento a propósito.
  let cursor = 0
  let rate: number | null = null
  for (const p of points) {
    while (cursor < fxSeries.length && fxSeries[cursor].date <= p.date) {
      const candidate = fxSeries[cursor]
      rate = candidate.price > 0 ? candidate.price : null
      cursor++
    }
    if (rate === null) continue
    out.push({ date: p.date, price: p.price * rate, adjPrice: p.adjPrice * rate })
  }
  return out
}

// Normaliza todas las series de un mapa a la moneda base. Este es el punto
// ÚNICO de conversión: aguas abajo los motores ven una sola moneda y no se
// modifican (Decisión 2).
// Un ticker sin moneda declarada se asume USD, que es el default del esquema
// (`assets.currency default 'USD'`) y cubre al benchmark, que no tiene fila
// en `assets`.
export function toBaseCurrency(
  series: PriceSeriesByTicker,
  currencyByTicker: Map<string, string>,
  fxSeries: PricePointAdj[],
  baseCurrency: string
): PriceSeriesByTicker {
  const out: PriceSeriesByTicker = new Map()
  for (const [ticker, points] of series) {
    out.set(ticker, convertSeries(points, currencyByTicker.get(ticker) ?? 'USD', fxSeries, baseCurrency))
  }
  return out
}

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
  fxSeries: PricePointAdj[],
  baseCurrency: string
): Transaction[] {
  return transactions.map((tx) => {
    const currency = currencyByTicker.get(tx.ticker) ?? 'USD'
    if (currency === baseCurrency) return tx
    if (!(currency === 'USD' && baseCurrency === 'CLP')) {
      throw new Error(`conversión no soportada: ${currency} → ${baseCurrency}`)
    }
    const rate = fxAsOf(fxSeries, tx.executedAt)
    if (rate === null) {
      // El histórico de Yahoo llega hasta 5 años atrás (su adaptador pide
      // `range=5y` fijo), así que para una transacción más antigua el backfill
      // no puede resolver nada: el mensaje debe decir el rango real en vez de
      // sugerir un remedio imposible.
      const earliest = fxSeries.length > 0 ? fxSeries[0].date : null
      throw new Error(
        earliest
          ? `falta tipo de cambio ${FX_TICKER} para ${tx.executedAt}: el histórico disponible empieza en ${earliest}`
          : `falta el histórico de ${FX_TICKER}; corre el backfill en Fuentes de datos`
      )
    }
    return { ...tx, price: tx.price * rate, fees: tx.fees * rate }
  })
}
