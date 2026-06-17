// src/lib/supabase/paginate.test.ts
import { describe, it, expect } from 'vitest'
import { fetchAllRows } from './paginate'

// Simula el comportamiento de PostgREST: devuelve la franja [from, to] de un dataset.
function pageFetcher<T>(all: T[], pageSize: number, calls: Array<[number, number]> = []) {
  return (from: number, to: number) => {
    calls.push([from, to])
    // PostgREST limita además al máximo del servidor; emulamos ese tope con pageSize.
    const end = Math.min(to + 1, from + pageSize)
    return Promise.resolve({ data: all.slice(from, end), error: null })
  }
}

describe('fetchAllRows', () => {
  it('una sola página corta: una llamada y devuelve todo', async () => {
    const calls: Array<[number, number]> = []
    const rows = await fetchAllRows(pageFetcher([1, 2, 3], 1000, calls), 1000)
    expect(rows).toEqual([1, 2, 3])
    expect(calls).toEqual([[0, 999]])
  })

  it('pagina hasta una página corta y concatena en orden', async () => {
    const all = Array.from({ length: 2500 }, (_, i) => i)
    const calls: Array<[number, number]> = []
    const rows = await fetchAllRows(pageFetcher(all, 1000, calls), 1000)
    expect(rows).toEqual(all)
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
  })

  it('última página exactamente llena: pide una más que vuelve vacía y para', async () => {
    const all = Array.from({ length: 2000 }, (_, i) => i)
    const calls: Array<[number, number]> = []
    const rows = await fetchAllRows(pageFetcher(all, 1000, calls), 1000)
    expect(rows).toEqual(all)
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
  })

  it('sin filas: una llamada y devuelve []', async () => {
    const calls: Array<[number, number]> = []
    const rows = await fetchAllRows(pageFetcher([], 1000, calls), 1000)
    expect(rows).toEqual([])
    expect(calls).toEqual([[0, 999]])
  })

  it('propaga el error de la fuente', async () => {
    const failing = () => Promise.resolve({ data: null, error: { message: 'boom' } })
    await expect(fetchAllRows(failing, 1000)).rejects.toThrow('boom')
  })
})
