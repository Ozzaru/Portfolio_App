// src/lib/backtest/schedule.test.ts
import { describe, it, expect } from 'vitest'
import { rebalanceDates } from './schedule'

describe('rebalanceDates', () => {
  it('mensual: primer día operativo de cada mes nuevo, excluyendo t0', () => {
    const dates = ['2024-01-31', '2024-02-01', '2024-02-15', '2024-03-04', '2024-03-05']
    expect(rebalanceDates(dates, 'monthly')).toEqual(['2024-02-01', '2024-03-04'])
  })

  it('trimestral: solo los límites de mes a +3, +6, … desde t0', () => {
    const dates = [
      '2024-01-15', // t0 (mes 0)
      '2024-02-01', // +1
      '2024-03-01', // +2
      '2024-04-01', // +3  ✓
      '2024-05-01', // +4
      '2024-06-03', // +5
      '2024-07-01', // +6  ✓
    ]
    expect(rebalanceDates(dates, 'quarterly')).toEqual(['2024-04-01', '2024-07-01'])
  })

  it('período dentro de un solo mes → sin rebalanceos', () => {
    expect(rebalanceDates(['2024-01-03', '2024-01-10', '2024-01-31'], 'monthly')).toEqual([])
  })

  it('lista vacía → []', () => {
    expect(rebalanceDates([], 'monthly')).toEqual([])
  })
})
