// src/app/api/assets/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { assetInputSchema } from '@/lib/validation/schemas'
import { requirePortfolio } from '@/lib/portfolio/context'

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const ctx = await requirePortfolio(supabase, searchParams)
  if (ctx instanceof NextResponse) return ctx

  const { data, error } = await supabase
    .from('assets')
    .select('*')
    .eq('portfolio_id', ctx.id)
    .order('ticker')
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
  const ctx = await requirePortfolio(supabase, searchParams)
  if (ctx instanceof NextResponse) return ctx

  const parsed = assetInputSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { ticker, name, assetType, currency } = parsed.data

  // El activo va al portafolio EN EL QUE ESTÁS, no al que le tocaría por su
  // moneda. Sin esto manda el trigger de la 0006 (reparto por moneda) y un
  // activo en dólares creado desde el portafolio local aterrizaría en el
  // internacional, desapareciendo de la vista sin explicación.
  const row = {
    user_id: user.id,
    ticker,
    name,
    asset_type: assetType,
    currency,
    portfolio_id: ctx.id,
  }
  const { data, error } = await supabase
    .from('assets')
    .insert(row)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
