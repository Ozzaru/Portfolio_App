// src/app/api/cash/transfers/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fxTransferInputSchema } from '@/lib/validation/schemas'
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

  // Un traspaso le pertenece a AMBOS portafolios: aparece en el libro del que
  // manda y en el del que recibe. Filtrar sólo por origen lo escondería del
  // portafolio internacional, donde el abono en dólares es el hecho relevante.
  //
  // Se lee la vista de auditoría y no la tabla cruda: la tasa efectiva y el
  // costo del spread ya los calcula la base, y recalcularlos en el cliente
  // sería una segunda definición del mismo número.
  //
  // `ctx.id` no lo manda el llamador: sale de `resolvePortfolio`, que lo lee
  // de la columna `uuid` del portafolio resuelto por slug. Por eso es seguro
  // interpolarlo en la expresión de `.or()` sin escapar — no puede traer una
  // coma o un punto que reestructure el filtro. Este mismo patrón NO es seguro
  // con un valor que sí venga del caller.
  const { data, error } = await supabase
    .from('fx_transfers_audit')
    .select(
      'id, from_portfolio_id, from_currency, from_amount, to_portfolio_id, to_currency, to_amount, ' +
        'occurred_at, note, clp_por_usd, clp_por_usd_mercado, costo_spread_clp, created_at'
    )
    .or(`from_portfolio_id.eq.${ctx.id},to_portfolio_id.eq.${ctx.id}`)
    // `occurred_at` es un date: dos traspasos del mismo día empatan y Postgres
    // puede devolverlos en cualquier orden, reordenando la lista entre renders.
    // La reconstrucción histórica carga varias conversiones con la misma
    // fecha, así que el empate es el caso normal, no el raro. Mismo desempate
    // que `cash/movements/route.ts`.
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

  const parsed = fxTransferInputSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { toPortfolioId, fromCurrency, fromAmount, toCurrency, toAmount, occurredAt, note } = parsed.data

  // La RLS ya rechazaría un destino ajeno, pero con un error de política que no
  // dice nada útil. Comprobarlo antes convierte eso en un 404 explícito. La RLS
  // filtra la lectura, así que "no aparece" equivale a "no es tuyo".
  const { data: dest, error: destError } = await supabase
    .from('portfolios')
    .select('id')
    .eq('id', toPortfolioId)
    .maybeSingle()
  // Distinguir el fallo de infraestructura del "no existe": sin esto, una caida
  // de la base se reporta como "portafolio destino no encontrado" y manda al
  // usuario a buscar el problema equivocado.
  if (destError) return NextResponse.json({ error: destError.message }, { status: 500 })
  if (!dest) return NextResponse.json({ error: 'Portafolio destino no encontrado' }, { status: 404 })

  // El CHECK `fx_transfers_no_es_no_op` ya lo rechaza, pero como un 500 opaco.
  // El origen no viaja en el body —es el del contexto—, así que el schema no
  // puede detectarlo solo: la comprobación tiene que vivir acá.
  if (toPortfolioId === ctx.id && toCurrency === fromCurrency) {
    return NextResponse.json(
      { error: 'Origen y destino son la misma cuenta en la misma moneda' },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from('fx_transfers')
    .insert({
      user_id: user.id,
      from_portfolio_id: ctx.id,
      from_currency: fromCurrency,
      from_amount: fromAmount,
      to_portfolio_id: toPortfolioId,
      to_currency: toCurrency,
      to_amount: toAmount,
      occurred_at: occurredAt,
      note,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
