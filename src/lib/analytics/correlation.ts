// src/lib/analytics/correlation.ts
import { mean } from './riskMetrics'

// Coeficiente de Pearson sobre dos series ALINEADAS (mismas fechas operativas).
// null si <2 puntos o si alguna serie no tiene varianza.
export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length)
  if (n < 2) return null
  const ma = mean(a.slice(0, n))
  const mb = mean(b.slice(0, n))
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma
    const y = b[i] - mb
    num += x * y
    da += x * x
    db += y * y
  }
  if (da === 0 || db === 0) return null
  return num / Math.sqrt(da * db)
}

// Matriz de correlaciones. Las series de retornos por ticker deben venir ya
// alineadas sobre las MISMAS fechas operativas (el engine se encarga). Diagonal = 1.
export function correlationMatrix(returnsByTicker: Map<string, number[]>): {
  tickers: string[]
  matrix: (number | null)[][]
} {
  const tickers = [...returnsByTicker.keys()]
  const matrix = tickers.map((ti) =>
    tickers.map((tj) => {
      if (ti === tj) return 1
      return pearson(returnsByTicker.get(ti)!, returnsByTicker.get(tj)!)
    })
  )
  return { tickers, matrix }
}
