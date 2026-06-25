// src/app/api/alerts/evaluate/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { evaluateAndPersist } from '@/lib/alerts/run'

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const triggered = await evaluateAndPersist(supabase)
    return NextResponse.json({ triggered })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'fallo al evaluar' }, { status: 500 })
  }
}
