// src/lib/portfolio/context.ts
//
// Resolución del portafolio sobre el que opera una petición.
//
// El slug viaja en la URL de la UI (`/nacional/dashboard`) y llega a la API como
// `?portfolio=nacional`. Este módulo lo traduce a lo único que las rutas
// necesitan saber: qué activos filtrar, en qué moneda medir, y qué estructura de
// fees aplica.

import { NextResponse } from 'next/server'

export type FeeStructure = 'local_clp' | 'intl_usd'

export interface PortfolioCtx {
  id: string
  slug: string
  name: string
  baseCurrency: string
  feeStructure: FeeStructure
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Resuelve el slug a un portafolio, o `null` si no existe.
 *
 * Un slug inexistente es 404, no un fallback: pedir un portafolio que no está y
 * recibir otro sería mostrar datos ajenos a lo pedido.
 */
export async function resolvePortfolio(supabase: any, slug: string): Promise<PortfolioCtx | null> {
  const { data, error } = await supabase
    .from('portfolios')
    .select('id, slug, name, base_currency, fee_structure_type')
    .eq('slug', slug)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return null

  return {
    id: data.id,
    slug: data.slug,
    name: data.name,
    baseCurrency: data.base_currency,
    feeStructure: data.fee_structure_type as FeeStructure,
  }
}

/**
 * Helper para rutas: exige `?portfolio=` y devuelve el contexto, o la respuesta
 * de error lista para retornar.
 *
 * Distingue los dos casos a propósito: falta el parámetro (400, error del
 * llamador que no lo mandó) frente a portafolio inexistente (404, lo mandó pero
 * no está). Colapsarlos en uno haría más difícil diagnosticar cuál de los dos
 * ocurrió desde el otro lado de la red.
 *
 * Hasta la rebanada 3 existía un afordance que trataba la ausencia del
 * parámetro como "todos los activos en pesos". Se eliminó junto con el trigger
 * de asignación automática de la 0006: ya no hay ningún camino en que la app
 * mida sin decir en qué moneda.
 */
export async function requirePortfolio(
  supabase: any,
  searchParams: URLSearchParams
): Promise<PortfolioCtx | NextResponse> {
  const slug = searchParams.get('portfolio')
  if (!slug) {
    return NextResponse.json({ error: 'falta el parámetro portfolio' }, { status: 400 })
  }
  const ctx = await resolvePortfolio(supabase, slug)
  if (!ctx) {
    return NextResponse.json({ error: 'portafolio no encontrado' }, { status: 404 })
  }
  return ctx
}
/* eslint-enable @typescript-eslint/no-explicit-any */
