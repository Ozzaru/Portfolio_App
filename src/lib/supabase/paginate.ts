// src/lib/supabase/paginate.ts
// Paginación robusta sobre PostgREST/Supabase: un `select` sin `.range()` queda
// limitado al "Max rows" del servidor (1000 por defecto), truncando resultados en
// silencio. Este helper pide páginas de `pageSize` con `.range(from, to)` hasta que
// una página llega corta (o vacía), garantizando que se traen todas las filas.

interface PageResult<T> {
  data: T[] | null
  error: { message: string } | null
}

export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const page = data ?? []
    all.push(...page)
    if (page.length < pageSize) break
  }
  return all
}
