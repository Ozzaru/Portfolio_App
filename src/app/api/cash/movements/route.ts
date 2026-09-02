// src/app/api/cash/movements/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cashMovementInputSchema } from '@/lib/validation/schemas'
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
    .from('cash_movements')
    .select('id, currency, movement_type, amount, occurred_at, note, created_at')
    .eq('portfolio_id', ctx.id)
    // `occurred_at` es un date: dos movimientos del mismo día empatan y Postgres
    // puede devolverlos en cualquier orden, reordenando la lista entre renders.
    // Al digitar una cartola se cargan varios abonos con la misma fecha, así que
    // el empate es el caso normal, no el raro.
    .order('occurred_at', { ascending: false })
    .order('created_at', { ascending: false })
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

  const parsed = cashMovementInputSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { movementType, amount, currency, occurredAt, note } = parsed.data

  const { data, error } = await supabase
    .from('cash_movements')
    .insert({
      user_id: user.id,
      portfolio_id: ctx.id,
      currency,
      movement_type: movementType,
      // Ya viene con signo desde el schema; el CHECK de la base es la red para
      // quien escriba sin pasar por acá.
      amount,
      occurred_at: occurredAt,
      note,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
