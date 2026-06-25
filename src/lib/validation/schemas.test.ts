// src/lib/validation/schemas.test.ts
import { describe, it, expect } from 'vitest'
import {
  assetInputSchema,
  transactionInputSchema,
  priceInputSchema,
  backtestConfigSchema,
  scenarioConfigSchema,
  alertInputSchema,
} from '@/lib/validation/schemas'

const UUID = '00000000-0000-4000-8000-000000000000'

describe('assetInputSchema', () => {
  it('normaliza ticker y moneda a mayúsculas', () => {
    const r = assetInputSchema.parse({ ticker: ' aapl ', assetType: 'stock', currency: 'usd' })
    expect(r.ticker).toBe('AAPL')
    expect(r.currency).toBe('USD')
    expect(r.name).toBe('')
  })

  it('rechaza ticker vacío', () => {
    expect(assetInputSchema.safeParse({ ticker: '  ', assetType: 'stock' }).success).toBe(false)
  })

  it('rechaza tipo de activo desconocido', () => {
    expect(assetInputSchema.safeParse({ ticker: 'AAPL', assetType: 'bond' }).success).toBe(false)
  })
})

describe('transactionInputSchema', () => {
  it('acepta números como string (inputs de formulario) y aplica fees=0 por defecto', () => {
    const r = transactionInputSchema.parse({
      assetId: UUID,
      side: 'buy',
      quantity: '10',
      price: '99.5',
      executedAt: '2026-01-15',
    })
    expect(r.quantity).toBe(10)
    expect(r.price).toBe(99.5)
    expect(r.fees).toBe(0)
  })

  it('rechaza cantidad cero o negativa', () => {
    const base = { assetId: UUID, side: 'sell', price: '10', executedAt: '2026-01-15' }
    expect(transactionInputSchema.safeParse({ ...base, quantity: '0' }).success).toBe(false)
    expect(transactionInputSchema.safeParse({ ...base, quantity: '-1' }).success).toBe(false)
  })

  it('rechaza fecha mal formada', () => {
    const r = transactionInputSchema.safeParse({
      assetId: UUID,
      side: 'buy',
      quantity: '1',
      price: '10',
      executedAt: '15/01/2026',
    })
    expect(r.success).toBe(false)
  })
})

describe('priceInputSchema', () => {
  it('normaliza ticker y convierte el precio', () => {
    const r = priceInputSchema.parse({ ticker: 'btc', price: '64000.5', priceDate: '2026-06-10' })
    expect(r.ticker).toBe('BTC')
    expect(r.price).toBe(64000.5)
  })

  it('rechaza precio cero o negativo', () => {
    expect(priceInputSchema.safeParse({ ticker: 'BTC', price: '0', priceDate: '2026-06-10' }).success).toBe(false)
  })
})

describe('backtestConfigSchema', () => {
  const base = {
    targetWeights: { AAPL: 0.6, SPCX: 0.4 },
    frequency: 'monthly',
    from: '2021-06-17',
    to: '2026-06-17',
    initialCapital: 10000,
  }
  it('acepta una config válida y normaliza tickers a mayúsculas', () => {
    const r = backtestConfigSchema.parse({ ...base, targetWeights: { aapl: 0.6, spcx: 0.4 } })
    expect(r.targetWeights).toEqual({ AAPL: 0.6, SPCX: 0.4 })
    expect(r.weightsFromCurrent).toBe(false)
  })
  it('coacciona capital string (input de formulario)', () => {
    const r = backtestConfigSchema.parse({ ...base, initialCapital: '10000' })
    expect(r.initialCapital).toBe(10000)
  })
  it('rechaza frecuencia desconocida', () => {
    expect(backtestConfigSchema.safeParse({ ...base, frequency: 'weekly' }).success).toBe(false)
  })
  it('rechaza targetWeights vacío', () => {
    expect(backtestConfigSchema.safeParse({ ...base, targetWeights: {} }).success).toBe(false)
  })
  it('rechaza fecha mal formada', () => {
    expect(backtestConfigSchema.safeParse({ ...base, from: '06/2021' }).success).toBe(false)
  })
})

describe('scenarioConfigSchema', () => {
  it('coacciona marketShock y normaliza overrides a mayúsculas', () => {
    const r = scenarioConfigSchema.parse({ marketShock: '-0.2', overrides: { aapl: '-0.5' } })
    expect(r.marketShock).toBe(-0.2)
    expect(r.overrides).toEqual({ AAPL: -0.5 })
  })
  it('overrides ausente → {} por defecto', () => {
    const r = scenarioConfigSchema.parse({ marketShock: -0.1 })
    expect(r.overrides).toEqual({})
  })
  it('rechaza marketShock no numérico', () => {
    expect(scenarioConfigSchema.safeParse({ marketShock: 'abc' }).success).toBe(false)
  })
})

describe('alertInputSchema', () => {
  const UUID2 = '11111111-1111-4111-8111-111111111111'
  it('acepta una alerta válida y coacciona threshold string', () => {
    const r = alertInputSchema.parse({ alertType: 'price_above', assetId: UUID2, threshold: '150.5' })
    expect(r.alertType).toBe('price_above')
    expect(r.threshold).toBe(150.5)
  })
  it('rechaza tipo desconocido', () => {
    expect(alertInputSchema.safeParse({ alertType: 'rebalance_drift', assetId: UUID2, threshold: 1 }).success).toBe(false)
  })
  it('rechaza threshold no positivo', () => {
    expect(alertInputSchema.safeParse({ alertType: 'price_above', assetId: UUID2, threshold: 0 }).success).toBe(false)
  })
  it('rechaza assetId no-uuid', () => {
    expect(alertInputSchema.safeParse({ alertType: 'price_above', assetId: 'x', threshold: 1 }).success).toBe(false)
  })
})
