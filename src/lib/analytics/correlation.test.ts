// src/lib/analytics/correlation.test.ts
import { describe, it, expect } from 'vitest'
import { pearson, correlationMatrix } from './correlation'

describe('pearson', () => {
  it('correlación perfecta positiva = 1', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1)
  })
  it('correlación perfecta negativa = -1', () => {
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1)
  })
  it('null con menos de 2 puntos', () => {
    expect(pearson([1], [2])).toBeNull()
  })
  it('null si una serie no tiene varianza', () => {
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull()
  })
})

describe('correlationMatrix', () => {
  it('diagonal = 1 y simétrica', () => {
    const r = new Map([
      ['AAPL', [0.01, 0.02, -0.01, 0.0]],
      ['BTC', [0.02, 0.01, 0.0, -0.02]],
    ])
    const { tickers, matrix } = correlationMatrix(r)
    expect(tickers).toEqual(['AAPL', 'BTC'])
    expect(matrix[0][0]).toBe(1)
    expect(matrix[1][1]).toBe(1)
    expect(matrix[0][1]).toBeCloseTo(matrix[1][0] as number)
  })
  it('un solo ticker → matriz 1×1', () => {
    const { tickers, matrix } = correlationMatrix(new Map([['AAPL', [0.01, 0.02]]]))
    expect(tickers).toEqual(['AAPL'])
    expect(matrix).toEqual([[1]])
  })
})
