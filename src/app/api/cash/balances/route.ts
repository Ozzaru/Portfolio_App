// src/app/api/cash/balances/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requirePortfolio } from '@/lib/portfolio/context'

// Lee la vista y ya. El saldo no se calcula acá ni en ninguna parte del código:
// es `sum(amount)` sobre `cash_ledger`, y un saldo materializado sería una caché
// del libro capaz de desviarse de él.
//
// OJO: un portafolio SIN movimientos no tiene fila. La respuesta es `[]`, y eso
// significa saldo cero — no "error" ni "sin datos".
//
// Regla de la casa: un passthrough CRUD devuelve la fila cruda (movements,
// transfers); una lectura agregada/derivada devuelve un DTO en camelCase (esta
// ruta, y positions, analytics, portfolios, alerts). Esta es del segundo tipo.
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
    .from('cash_balances')
    .select('currency, balance')
    .eq('portfolio_id', ctx.id)
    .order('currency')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(
    (data ?? []).map((r) => ({
      currency: r.currency as string,
      balance: Number(r.balance),
    }))
  )
}
