// src/components/sidebar.tsx
'use client'

import Link from 'next/link'
import { usePathname, useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useResource } from '@/lib/hooks/use-resource'

interface Portfolio {
  id: string
  slug: string
  name: string
  baseCurrency: string
}

// Enlaces que viven DENTRO de un portafolio: su href se construye con el slug
// actual. Un segmento no se puede "olvidar" al navegar, a diferencia de un
// query param, que estos mismos enlaces absolutos habrían descartado en
// silencio dejando al usuario en otro portafolio sin avisar.
const scopedLinks = [
  { path: 'dashboard', label: 'Dashboard' },
  { path: 'portfolio', label: 'Portafolio' },
  { path: 'analytics', label: 'Analítica' },
]

// Enlaces globales: no dependen del portafolio.
//
// Las alertas quedan acá a propósito. Una alerta existe para interrumpir tu
// atención cuando se cumple una condición de mercado; esconderla porque estás
// parado en el otro portafolio derrota su propósito. El badge cuenta todas.
const globalLinks = [
  { href: '/alerts', label: 'Alertas' },
  { href: '/data-sources', label: 'Fuentes de datos' },
  { href: '/settings', label: 'Configuración' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const params = useParams()
  const router = useRouter()

  // `undefined` en las rutas globales, que no tienen segmento de portafolio.
  const current = typeof params.portfolio === 'string' ? params.portfolio : undefined

  const { data: portfolios } = useResource<Portfolio[]>('/api/portfolios')
  const { data: alertsData } = useResource<{ alerts: { status: string }[] }>('/api/alerts')
  const triggered = (alertsData?.alerts ?? []).filter((a) => a.status === 'triggered').length

  // Estando en una ruta global no hay portafolio en la URL, pero el usuario
  // igual tiene que poder volver a uno: se usa el primero como destino.
  const target = current ?? portfolios?.[0]?.slug
  const activePortfolio = portfolios?.find((p) => p.slug === current)

  function switchTo(slug: string) {
    // Conserva la sección: cambiar de portafolio desde Analítica te deja en la
    // Analítica del otro, no te devuelve al dashboard.
    const section = scopedLinks.find((l) => pathname.startsWith(`/${current}/${l.path}`))?.path
    router.push(`/${slug}/${section ?? 'dashboard'}`)
  }

  const itemCls = (isActive: boolean) =>
    `flex items-center justify-between rounded px-3 py-2 text-sm ${
      isActive ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
    }`

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-950 p-4">
      <div className="mb-4 text-lg font-bold text-slate-100">Portfolio App</div>

      {/* Selector de portafolio */}
      <select
        aria-label="Portafolio"
        className="mb-5 rounded border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
        value={current ?? ''}
        onChange={(e) => switchTo(e.target.value)}
      >
        {current === undefined && <option value="">— vista global —</option>}
        {(portfolios ?? []).map((p) => (
          <option key={p.slug} value={p.slug}>
            {p.name}
          </option>
        ))}
      </select>

      <nav className="flex flex-1 flex-col gap-1">
        {scopedLinks.map((l) => {
          const href = `/${target ?? ''}/${l.path}`
          const isActive = current !== undefined && pathname.startsWith(`/${current}/${l.path}`)
          return (
            <Link
              key={l.path}
              href={target ? href : '/'}
              aria-current={isActive ? 'page' : undefined}
              className={itemCls(isActive)}
            >
              <span>{l.label}</span>
            </Link>
          )
        })}

        <div className="my-2 border-t border-slate-800" />

        {globalLinks.map((l) => {
          const isActive = pathname === l.href || pathname.startsWith(l.href + '/')
          return (
            <Link key={l.href} href={l.href} aria-current={isActive ? 'page' : undefined} className={itemCls(isActive)}>
              <span>{l.label}</span>
              {l.href === '/alerts' && triggered > 0 && (
                <span className="ml-2 rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white">
                  {triggered}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* slate-400, no 600: sobre `bg-slate-950` el 600 da ~2.5:1 de contraste
          —por debajo del mínimo legible— y en `text-xs` desaparece del todo. */}
      {activePortfolio && (
        <p className="mt-4 text-xs text-slate-400">Midiendo en {activePortfolio.baseCurrency}</p>
      )}

      <button
        onClick={async () => {
          const supabase = createClient()
          await supabase.auth.signOut()
          router.push('/login')
          router.refresh()
        }}
        className="mt-2 rounded px-3 py-2 text-left text-sm text-slate-400 hover:bg-slate-800"
      >
        Cerrar sesión
      </button>
    </aside>
  )
}
