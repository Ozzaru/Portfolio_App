import { computeHoldings, type Transaction } from './holdings'
import { valuePositions, portfolioTotals, type Quote } from './valuation'

// Valor total del portafolio dado un conjunto de cotizaciones. Reusa el dominio
// de Fase 1; devuelve el número que se guarda en snapshots.total_value.
export function computeSnapshotValue(transactions: Transaction[], quotes: Quote[]): number {
  const holdings = computeHoldings(transactions)
  const positions = valuePositions(holdings, quotes)
  return portfolioTotals(positions).totalValue
}
