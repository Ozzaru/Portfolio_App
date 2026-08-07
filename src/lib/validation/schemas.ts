// src/lib/validation/schemas.ts
import { z } from 'zod'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export const assetInputSchema = z.object({
  ticker: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .transform((t) => t.toUpperCase()),
  name: z.string().trim().max(100).default(''),
  assetType: z.enum(['stock', 'etf', 'crypto', 'cash', 'other']),
  currency: z
    .string()
    .trim()
    .length(3)
    .default('USD')
    .transform((c) => c.toUpperCase()),
})
export type AssetInput = z.infer<typeof assetInputSchema>

// `fees` no se recibe del cliente: la ruta lo deriva como commission + iva,
// que es el invariante que el CHECK `fees_breakdown` garantiza en la BD.
// No se valida que el IVA sea exactamente 19% de la comisión: los brokers
// redondean (Zesty cobra 6 sobre 5,51) y difieren entre sí.
export const transactionInputSchema = z.object({
  assetId: z.string().uuid(),
  side: z.enum(['buy', 'sell']),
  quantity: z.coerce.number().positive(),
  price: z.coerce.number().nonnegative(),
  commission: z.coerce.number().nonnegative().default(0),
  iva: z.coerce.number().nonnegative().default(0),
  executedAt: z.string().regex(DATE_RE, 'formato esperado YYYY-MM-DD'),
})
export type TransactionInput = z.infer<typeof transactionInputSchema>

export const priceInputSchema = z.object({
  ticker: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .transform((t) => t.toUpperCase()),
  price: z.coerce.number().positive(),
  priceDate: z.string().regex(DATE_RE, 'formato esperado YYYY-MM-DD'),
})
export type PriceInput = z.infer<typeof priceInputSchema>

export const backtestConfigSchema = z.object({
  targetWeights: z
    .record(z.string(), z.coerce.number())
    .refine((w) => Object.keys(w).length > 0, 'targetWeights no puede estar vacío')
    .transform((w) => {
      const out: Record<string, number> = {}
      for (const [t, v] of Object.entries(w)) out[t.trim().toUpperCase()] = v
      return out
    }),
  frequency: z.enum(['monthly', 'quarterly']),
  from: z.string().regex(DATE_RE, 'formato esperado YYYY-MM-DD'),
  to: z.string().regex(DATE_RE, 'formato esperado YYYY-MM-DD'),
  initialCapital: z.coerce.number().positive(),
  weightsFromCurrent: z.coerce.boolean().default(false),
})
export type BacktestConfigInput = z.infer<typeof backtestConfigSchema>

export const scenarioConfigSchema = z.object({
  marketShock: z.coerce.number(),
  overrides: z
    .record(z.string(), z.coerce.number())
    .default({})
    .transform((o) => {
      const out: Record<string, number> = {}
      for (const [t, v] of Object.entries(o)) out[t.trim().toUpperCase()] = v
      return out
    }),
})
export type ScenarioConfigInput = z.infer<typeof scenarioConfigSchema>

export const alertInputSchema = z.object({
  alertType: z.enum(['price_above', 'price_below', 'pct_change']),
  assetId: z.string().uuid(),
  threshold: z.coerce.number().positive(),
})
export type AlertInput = z.infer<typeof alertInputSchema>
