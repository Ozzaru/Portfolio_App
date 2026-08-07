// src/app/api/transactions/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { transactionInputSchema } from '@/lib/validation/schemas'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('transactions')
    .select('id, asset_id, side, quantity, price, fees, commission, iva, executed_at, assets(ticker, currency)')
    .order('executed_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = transactionInputSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { assetId, side, quantity, price, commission, iva, executedAt } = parsed.data
  // `fees` no se envía: es una columna generada (commission + iva) que calcula
  // Postgres, para que la suma no dependa de la coma flotante de JS.

  // RLS filtra assets ajenos: si no aparece, no es de este usuario
  const { data: asset } = await supabase.from('assets').select('id').eq('id', assetId).maybeSingle()
  if (!asset) return NextResponse.json({ error: 'Asset no encontrado' }, { status: 404 })

  const { data, error } = await supabase
    .from('transactions')
    .insert({
      user_id: user.id,
      asset_id: assetId,
      side,
      quantity,
      price,
      commission,
      iva,
      executed_at: executedAt,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
