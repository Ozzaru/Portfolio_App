// src/lib/portfolio/context.ts
//
// Resolución del portafolio sobre el que opera una petición.
//
// El slug viaja en la URL de la UI (`/nacional/dashboard`) y llega a la API como
// `?portfolio=nacional`. Este módulo lo traduce a lo único que las rutas
// necesitan saber: qué activos filtrar, en qué moneda medir, y qué estructura de
// fees aplica.

export type FeeStructure = 'local_clp' | 'intl_usd'

export interface PortfolioCtx {
  id: string
  slug: string
  name: string
  baseCurrency: string
  feeStructure: FeeStructure
}

// Afordance de compatibilidad, TEMPORAL.
//
// Vive sólo entre la rebanada 2 (esta, que hace la API consciente del
// portafolio) y la rebanada 3 (que hace a la UI enviar el slug). Sin él la app
// quedaría rota entre ambas ramas, y es una app en uso diario.
//
// Reproduce EXACTAMENTE el comportamiento anterior: todos los activos del
// usuario, medidos en pesos. No es un default semántico escondido en la
// matemática de conversión —eso se rechazó a propósito en `convert.ts`— sino una
// rama explícita con fecha de muerte.
//
// LA REBANADA 4 BORRA ESTO y hace `?portfolio=` obligatorio.
export const LEGACY_CONSOLIDATED: PortfolioCtx = {
  id: '',
  slug: '',
  name: 'Consolidado (legacy)',
  baseCurrency: 'CLP',
  feeStructure: 'local_clp',
}

export function isLegacyConsolidated(ctx: PortfolioCtx): boolean {
  return ctx.id === ''
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Resuelve el portafolio del slug pedido.
 *
 * Devuelve `LEGACY_CONSOLIDATED` si el slug viene vacío o ausente (ver arriba),
 * y `null` si viene un slug que no existe — eso último es un 404, no un
 * fallback: pedir un portafolio inexistente es un error del llamador, y
 * responder con otro portafolio sería mostrar datos ajenos a lo pedido.
 */
export async function resolvePortfolio(
  supabase: any,
  slug: string | null
): Promise<PortfolioCtx | null> {
  if (!slug) return LEGACY_CONSOLIDATED

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
/* eslint-enable @typescript-eslint/no-explicit-any */
