// src/app/api/assets/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { assetInputSchema } from '@/lib/validation/schemas'
import { resolvePortfolio, isLegacyConsolidated } from '@/lib/portfolio/context'

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const ctx = await resolvePortfolio(supabase, searchParams.get('portfolio'))
  if (!ctx) return NextResponse.json({ error: 'portafolio no encontrado' }, { status: 404 })

  let query = supabase.from('assets').select('*').order('ticker')
  if (!isLegacyConsolidated(ctx)) query = query.eq('portfolio_id', ctx.id)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const ctx = await resolvePortfolio(supabase, searchParams.get('portfolio'))
  if (!ctx) return NextResponse.json({ error: 'portafolio no encontrado' }, { status: 404 })

  const parsed = assetInputSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { ticker, name, assetType, currency } = parsed.data

  // El activo va al portafolio EN EL QUE ESTÁS, no al que le tocaría por su
  // moneda. Sin esto manda el trigger de la 0006 (reparto por moneda) y un
  // activo en dólares creado desde el portafolio local aterrizaría en el
  // internacional, desapareciendo de la vista sin explicación.
  // En el camino legacy (sin portafolio) se omite y el trigger decide, que es
  // exactamente el comportamiento anterior.
  const row = {
    user_id: user.id,
    ticker,
    name,
    asset_type: assetType,
    currency,
    ...(isLegacyConsolidated(ctx) ? {} : { portfolio_id: ctx.id }),
  }
  const { data, error } = await supabase
    .from('assets')
    .insert(row)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
