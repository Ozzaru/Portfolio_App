// src/app/api/prices/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { priceInputSchema } from '@/lib/validation/schemas'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('price_cache')
    .select('*')
    .order('price_date', { ascending: false })
    .limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = priceInputSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { ticker, price, priceDate } = parsed.data
  const { data, error } = await supabase
    .from('price_cache')
    .upsert(
      { ticker, price, price_date: priceDate, source: 'manual' },
      { onConflict: 'ticker,price_date,source' }
    )
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
