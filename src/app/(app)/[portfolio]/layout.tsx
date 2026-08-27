import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// Valida el segmento de portafolio UNA vez, acá, en vez de en cada página.
//
// Es lo que hace que `/dashboard` —una URL vieja, sin portafolio— dé un 404
// limpio en lugar de renderizar una página que luego pide `?portfolio=dashboard`
// y muestra tarjetas vacías sin explicar por qué. El slug inválido se detecta
// antes de dibujar nada.
//
// También cubre el caso de un slug que existió y se renombró: la URL guardada
// deja de resolver y el usuario ve un 404, no datos de otro portafolio.
export default async function PortfolioLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ portfolio: string }>
}) {
  const { portfolio } = await params
  const supabase = await createClient()

  const { data } = await supabase.from('portfolios').select('id').eq('slug', portfolio).maybeSingle()
  if (!data) notFound()

  return <>{children}</>
}
