// src/lib/alerts/types.ts
export type AlertType = 'price_above' | 'price_below' | 'pct_change'

export interface AlertRow {
  id: string
  ticker: string
  alertType: AlertType
  threshold: number
  status: 'active' | 'triggered' | 'disabled'
}

export interface AlertTrigger {
  id: string
  reason: string
}
