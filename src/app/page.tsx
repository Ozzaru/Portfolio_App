import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// La raíz manda al dashboard del primer portafolio.
//
// "Primero" es por `created_at`, no alfabético: el destino no debe cambiar
// porque alguien renombre un portafolio. Si no hay sesión, el proxy ya redirige
// a /login antes de llegar acá; si hay sesión pero ningún portafolio (base sin
// migrar), se cae a /settings, que es global y siempre existe.
export default async function Home() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('portfolios')
    .select('slug')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  redirect(data ? `/${data.slug}/dashboard` : '/settings')
}
