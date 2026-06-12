// src/app/login/page.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleAuth(mode: 'signin' | 'signup') {
    setError(null)
    setLoading(true)
    const supabase = createClient()
    const { error } =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          handleAuth('signin')
        }}
        className="w-80 rounded-lg border border-slate-800 bg-slate-900 p-6"
      >
        <h1 className="mb-4 text-xl font-bold text-slate-100">Portfolio App</h1>
        <label className="mb-1 block text-xs text-slate-400">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-3 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
        />
        <label className="mb-1 block text-xs text-slate-400">Contraseña</label>
        <input
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-4 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
        />
        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="mb-2 w-full rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
        >
          Iniciar sesión
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => handleAuth('signup')}
          className="w-full rounded border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          Crear cuenta
        </button>
      </form>
    </div>
  )
}
