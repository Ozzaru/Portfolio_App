// src/lib/validation/schemas.ts
import { z } from 'zod'

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

// `fees` no se recibe del cliente: es una columna generada por Postgres
// (commission + iva), así la suma no depende de la coma flotante de JS.
// No se valida que el IVA sea exactamente 19% de la comisión: los brokers
// redondean (Zesty cobra 6 sobre 5,51) y difieren entre sí.
export const transactionInputSchema = z.object({
  assetId: z.string().uuid(),
  side: z.enum(['buy', 'sell']),
  quantity: z.coerce.number().positive(),
  price: z.coerce.number().nonnegative(),
  commission: z.coerce.number().nonnegative().default(0),
  iva: z.coerce.number().nonnegative().default(0),
  executedAt: z.iso.date('formato esperado YYYY-MM-DD'),
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
  priceDate: z.iso.date('formato esperado YYYY-MM-DD'),
})
export type PriceInput = z.infer<typeof priceInputSchema>

export const alertInputSchema = z.object({
  alertType: z.enum(['price_above', 'price_below', 'pct_change']),
  assetId: z.string().uuid(),
  threshold: z.coerce.number().positive(),
})
export type AlertInput = z.infer<typeof alertInputSchema>

// Movimiento de capital externo: abono o retiro.
//
// El cliente envía SIEMPRE una magnitud positiva y el tipo; el signo lo deriva
// el transform. Si el cliente mandara el monto ya firmado, el tipo y el signo
// serían dos fuentes de verdad para lo mismo y podrían contradecirse — el CHECK
// `cash_movements_signo` lo rechazaría con un 500 opaco en vez de un 400 que
// explique qué está mal.
export const cashMovementInputSchema = z
  .object({
    movementType: z.enum(['deposit', 'withdrawal']),
    amount: z.coerce.number().positive(),
    currency: z
      .string()
      .trim()
      .length(3)
      .transform((c) => c.toUpperCase()),
    occurredAt: z.iso.date('formato esperado YYYY-MM-DD'),
    note: z.string().trim().max(200).default(''),
  })
  .transform((m) => ({
    ...m,
    amount: m.movementType === 'withdrawal' ? -m.amount : m.amount,
  }))
export type CashMovementInput = z.infer<typeof cashMovementInputSchema>

// Conversión de divisa entre portafolios. El portafolio de ORIGEN no viaja en el
// body: es el del contexto (`?portfolio=`), igual que en todas las demás rutas.
//
// No hay campo de tasa: `fromAmount / toAmount` la da exacta, y una tercera
// columna podría contradecir a las otras dos (Decisión 5 del spec).
export const fxTransferInputSchema = z.object({
  toPortfolioId: z.string().uuid(),
  fromCurrency: z
    .string()
    .trim()
    .length(3)
    .transform((c) => c.toUpperCase()),
  fromAmount: z.coerce.number().positive(),
  toCurrency: z
    .string()
    .trim()
    .length(3)
    .transform((c) => c.toUpperCase()),
  toAmount: z.coerce.number().positive(),
  occurredAt: z.iso.date('formato esperado YYYY-MM-DD'),
  note: z.string().trim().max(200).default(''),
})
export type FxTransferInput = z.infer<typeof fxTransferInputSchema>
