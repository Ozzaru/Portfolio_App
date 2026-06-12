// src/components/sidebar.tsx
'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const links = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/portfolio', label: 'Portafolio' },
  { href: '/analytics', label: 'Analítica' },
  { href: '/backtest', label: 'Backtest' },
  { href: '/scenarios', label: 'Escenarios' },
  { href: '/alerts', label: 'Alertas' },
  { href: '/data-sources', label: 'Fuentes de datos' },
  { href: '/settings', label: 'Configuración' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-950 p-4">
      <div className="mb-6 text-lg font-bold text-slate-100">Portfolio App</div>
      <nav className="flex flex-1 flex-col gap-1">
        {links.map((l) => {
          const isActive = pathname === l.href || pathname.startsWith(l.href + '/')
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive ? 'page' : undefined}
              className={`rounded px-3 py-2 text-sm ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              {l.label}
            </Link>
          )
        })}
      </nav>
      <button
        onClick={signOut}
        className="mt-4 rounded px-3 py-2 text-left text-sm text-slate-400 hover:bg-slate-800"
      >
        Cerrar sesión
      </button>
    </aside>
  )
}
