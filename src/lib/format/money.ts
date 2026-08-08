// src/lib/format/money.ts

// Decimales por moneda. El peso chileno no se fracciona; el resto usa 2.
const DECIMALS: Record<string, number> = { CLP: 0 }

export function formatMoney(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const digits = DECIMALS[currency] ?? 2
  try {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value)
  } catch {
    // El CHECK de la BD solo exige 3 caracteres en mayúsculas (no que sea un
    // código ISO real), así que `currency` puede ser un valor que Intl rechaza
    // con RangeError. Esto se usa en el render de páginas cliente: degradar a
    // un número simple con el código al lado es aceptable, tumbar la página no.
    const num = new Intl.NumberFormat('es-CL', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value)
    return `${num} ${currency}`
  }
}
