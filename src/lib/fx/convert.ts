// src/lib/fx/convert.ts
import { priceAsOf } from '@/lib/analytics/series'
import type { PricePointAdj, PriceSeriesByTicker } from '@/lib/analytics/types'
import { BASE_CURRENCY } from './constants'

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
export function convertSeries(
  points: PricePointAdj[],
  currency: string,
  fxSeries: PricePointAdj[]
): PricePointAdj[] {
  if (currency === BASE_CURRENCY) return points
  if (currency !== 'USD') {
    throw new Error(`moneda no soportada: ${currency} (solo USD y ${BASE_CURRENCY})`)
  }
  const out: PricePointAdj[] = []
  for (const p of points) {
    const rate = fxAsOf(fxSeries, p.date)
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
  fxSeries: PricePointAdj[]
): PriceSeriesByTicker {
  const out: PriceSeriesByTicker = new Map()
  for (const [ticker, points] of series) {
    out.set(ticker, convertSeries(points, currencyByTicker.get(ticker) ?? 'USD', fxSeries))
  }
  return out
}
