import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Lista de portafolios del usuario, para el selector del sidebar y para el
// redirect desde la raíz. Orden por `created_at` para que el "primero" sea
// estable: el selector no debe reordenarse al renombrar un portafolio.
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('portfolios')
    .select('id, slug, name, base_currency, fee_structure_type')
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(
    (data ?? []).map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      baseCurrency: p.base_currency,
      feeStructure: p.fee_structure_type,
    }))
  )
}
