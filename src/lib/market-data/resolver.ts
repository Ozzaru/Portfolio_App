export type QuoteSource = 'yahoo' | 'coingecko'

export function quoteSourceFor(assetType: string): QuoteSource | null {
  if (assetType === 'stock' || assetType === 'etf') return 'yahoo'
  if (assetType === 'crypto') return 'coingecko'
  return null
}
