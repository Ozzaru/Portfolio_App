// src/lib/format/money.ts

// Decimales por moneda. El peso chileno no se fracciona; el resto usa 2.
const DECIMALS: Record<string, number> = { CLP: 0 }

export function formatMoney(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const digits = DECIMALS[currency] ?? 2
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}
