// src/app/api/alerts/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { alertInputSchema } from '@/lib/validation/schemas'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('alerts')
    .select('id, alert_type, threshold, status, triggered_at, assets(ticker)')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const alerts = (data ?? []).map((r: any) => ({
    id: r.id,
    ticker: r.assets?.ticker ?? '',
    alertType: r.alert_type,
    threshold: Number(r.threshold),
    status: r.status,
    triggeredAt: r.triggered_at,
  }))
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return NextResponse.json({ alerts })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = alertInputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const { alertType, assetId, threshold } = parsed.data

  const { data, error } = await supabase
    .from('alerts')
    .insert({ user_id: user.id, asset_id: assetId, alert_type: alertType, threshold, status: 'active' })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
