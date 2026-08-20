// src/lib/analytics/synthetic/weights.ts
// Pesos objetivo de una cartera sintética. `equalWeights` es la base del
// benchmark equiponderado (ver §9.1 del spec de limpieza).

export function equalWeights(tickers: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  if (tickers.length === 0) return out
  const w = 1 / tickers.length
  for (const t of tickers) out[t] = w
  return out
}

export function normalizeWeights(weights: Record<string, number>): Record<string, number> {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0)
  const out: Record<string, number> = {}
  for (const [t, w] of Object.entries(weights)) out[t] = sum > 0 ? w / sum : 0
  return out
}

export function validateWeights(weights: Record<string, number>): { ok: boolean; error?: string } {
  const entries = Object.entries(weights)
  if (entries.length === 0) return { ok: false, error: 'sin activos con peso' }
  if (entries.some(([, w]) => w < 0)) return { ok: false, error: 'los pesos no pueden ser negativos' }
  const sum = entries.reduce((a, [, w]) => a + w, 0)
  if (sum <= 0) return { ok: false, error: 'la suma de pesos debe ser > 0' }
  return { ok: true }
}
