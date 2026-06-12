# Fase 1: Fundación y Portfolio Manager — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicación Next.js funcional con autenticación Supabase, esquema de datos completo, shell de navegación con las 8 páginas, CRUD de activos y transacciones, entrada manual de precios, y un dashboard v1 con KPIs, distribución de activos y tabla de posiciones.

**Architecture:** Next.js App Router con Route Handlers (`/api/*`) como backend, Supabase (PostgreSQL + Auth) como persistencia con RLS por usuario. La lógica de dominio (cálculo de posiciones a partir de transacciones, valoración, totales) vive en funciones puras en `src/lib/portfolio/` testeadas con Vitest; los route handlers son capas finas de auth + validación zod + acceso a datos.

**Tech Stack:** Next.js 15 (App Router, TypeScript, Tailwind CSS 4) · Supabase (`@supabase/supabase-js`, `@supabase/ssr`) · Recharts · zod · Vitest

---

## Contexto para el ejecutor

- **Directorio del proyecto:** `c:\WorkSpace\10_Code\Portfolio_App` (en Git Bash: `/c/WorkSpace/10_Code/Portfolio_App`). Ya contiene `README.md` y `docs/` — **no borrarlos**.
- **Aún no es repo git** — la Tarea 1 lo inicializa.
- **Plataforma:** Windows 11. Los comandos de este plan usan sintaxis bash (Git Bash disponible).
- **Requisito previo:** Node.js ≥ 18.18 (`node --version` para verificar) y una cuenta en [supabase.com](https://supabase.com) (la Tarea 3 requiere que el usuario cree un proyecto — es el único paso que necesita intervención humana).
- **Posiciones derivadas:** no existe tabla `positions`; las posiciones se calculan desde `transactions` con método de costo promedio (`computeHoldings`).
- **Deuda conocida aceptada en Fase 1:** la API no impide vender más cantidad de la que se posee (el cálculo de holdings recorta la venta al saldo disponible). Se documentará y endurecerá en Fase 3.

## Estructura de archivos

```
src/
  middleware.ts                         # protege rutas: sin sesión → /login
  app/
    layout.tsx                          # generado por create-next-app (se ajusta título)
    globals.css                         # tema oscuro base
    page.tsx                            # redirect a /dashboard
    login/page.tsx                      # email/password (sign in + sign up)
    (app)/
      layout.tsx                        # sidebar + <main>
      dashboard/page.tsx                # KPIs + pie de distribución + tabla posiciones
      portfolio/page.tsx                # CRUD assets + transactions
      data-sources/page.tsx             # entrada manual de precios + caché
      analytics/page.tsx                # stub (Fase 3)
      backtest/page.tsx                 # stub (Fase 4)
      scenarios/page.tsx                # stub (Fase 5)
      alerts/page.tsx                   # stub (Fase 6)
      settings/page.tsx                 # stub (Fase 6)
    api/
      assets/route.ts                   # GET, POST
      assets/[id]/route.ts              # DELETE
      transactions/route.ts             # GET, POST
      transactions/[id]/route.ts        # DELETE
      prices/route.ts                   # GET (caché reciente), POST (precio manual)
      positions/route.ts                # GET (posiciones valoradas + totales + P&L hoy)
  components/
    sidebar.tsx                         # navegación 8 módulos + cerrar sesión
  lib/
    supabase/client.ts                  # browser client
    supabase/server.ts                  # server client (cookies)
    supabase/middleware.ts              # updateSession + redirect a /login
    portfolio/holdings.ts               # computeHoldings (dominio puro)
    portfolio/holdings.test.ts
    portfolio/valuation.ts              # valuePositions + portfolioTotals (dominio puro)
    portfolio/valuation.test.ts
    validation/schemas.ts               # zod: asset, transaction, price
    validation/schemas.test.ts
supabase/
  migrations/0001_init.sql              # esquema completo + RLS
vitest.config.ts
.env.local                              # credenciales Supabase (no se commitea)
.env.example
```

---

### Tarea 1: Inicializar git y scaffolding de Next.js

**Files:**
- Create: repo git, proyecto Next.js completo en la raíz

- [ ] **Step 1: Inicializar repo y commitear el diseño existente**

```bash
cd /c/WorkSpace/10_Code/Portfolio_App
git init -b main
git add README.md docs
git commit -m "docs: diseño inicial del brainstorming (arquitectura, backtest, UI review)"
```

- [ ] **Step 2: Apartar README.md y ejecutar create-next-app**

`create-next-app` rechaza directorios con `README.md` (pero permite `docs/` y `.git`), por eso se mueve temporalmente:

```bash
mv README.md docs/README.tmp.md
npx create-next-app@latest . --typescript --eslint --tailwind --app --src-dir --import-alias "@/*" --turbopack --use-npm --yes
rm README.md
mv docs/README.tmp.md README.md
```

Expected: scaffolding creado (`src/app/`, `package.json`, `tsconfig.json`, etc.) sin tocar `docs/design/` ni el README original.

- [ ] **Step 3: Instalar dependencias del proyecto**

```bash
npm install @supabase/supabase-js @supabase/ssr recharts zod
npm install -D vitest
```

- [ ] **Step 4: Verificar que el dev server arranca**

```bash
npm run dev &
sleep 8 && curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
```

Expected: `200`. Detener el server después (`kill %1` o Ctrl+C).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js 15 (TS, Tailwind, App Router) + dependencias"
```

---

### Tarea 2: Infraestructura de tests (Vitest)

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (scripts)
- Test: `src/lib/validation/schemas.test.ts` (placeholder mínimo, se expande en Tarea 9)

- [ ] **Step 1: Crear configuración de Vitest**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
})
```

- [ ] **Step 2: Añadir scripts en package.json**

En la sección `"scripts"` de `package.json`, añadir:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Crear un test trivial para verificar la tubería**

```ts
// src/lib/validation/schemas.test.ts
import { describe, it, expect } from 'vitest'

describe('infraestructura de tests', () => {
  it('vitest ejecuta y resuelve el alias @', () => {
    expect(1 + 1).toBe(2)
  })
})
```

(Este archivo se reemplaza con tests reales en la Tarea 9.)

- [ ] **Step 4: Ejecutar y verificar**

Run: `npm test`
Expected: `1 passed`

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts package.json package-lock.json src/lib/validation/schemas.test.ts
git commit -m "chore: configurar Vitest"
```

---

### Tarea 3: Esquema Supabase (migración SQL + entorno)

**Files:**
- Create: `supabase/migrations/0001_init.sql`
- Create: `.env.example`
- Create: `.env.local` (requiere credenciales del usuario)

- [ ] **Step 1: Escribir la migración con el esquema completo y RLS**

```sql
-- supabase/migrations/0001_init.sql
-- Esquema completo Portfolio App. Ejecutar en Supabase SQL Editor.

create table assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticker text not null,
  name text not null default '',
  asset_type text not null check (asset_type in ('stock','etf','crypto','cash','other')),
  currency text not null default 'USD' check (currency = upper(currency) and length(currency) = 3),
  created_at timestamptz not null default now(),
  unique (user_id, ticker)
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  side text not null check (side in ('buy','sell')),
  quantity numeric not null check (quantity > 0),
  price numeric not null check (price >= 0),
  fees numeric not null default 0 check (fees >= 0),
  executed_at date not null,
  created_at timestamptz not null default now()
);

create table snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_date date not null,
  total_value numeric not null,
  created_at timestamptz not null default now(),
  unique (user_id, snapshot_date)
);

create table strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  strategy_type text not null check (strategy_type in ('momentum','rebalance','dca','stop_loss')),
  params jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid references assets(id) on delete cascade,
  alert_type text not null check (alert_type in ('price_above','price_below','pct_change','rebalance_drift')),
  threshold numeric not null,
  status text not null default 'active' check (status in ('active','triggered','disabled')),
  created_at timestamptz not null default now(),
  triggered_at timestamptz
);

-- Caché de precios compartida entre usuarios (los precios de mercado no son privados)
create table price_cache (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  price_date date not null,
  price numeric not null check (price > 0),
  source text not null,
  created_at timestamptz not null default now(),
  unique (ticker, price_date, source)
);

create index idx_transactions_user_asset on transactions(user_id, asset_id);
create index idx_price_cache_ticker_date on price_cache(ticker, price_date desc);

-- RLS: cada usuario solo ve sus filas
-- Nota de diseño: los jobs de Fase 2 (market data, snapshots) se ejecutan en
-- Route Handlers bajo la sesión del usuario (rol authenticated), por lo que las
-- políticas siguientes los cubren; no se depende del bypass de service_role.
-- Se permite UPDATE retroactivo en price_cache: corregir un precio manual
-- histórico es un caso de uso legítimo en una app personal.
alter table assets enable row level security;
alter table transactions enable row level security;
alter table snapshots enable row level security;
alter table strategies enable row level security;
alter table alerts enable row level security;
alter table price_cache enable row level security;

create policy "own assets" on assets for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own transactions" on transactions for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from assets a where a.id = asset_id and a.user_id = auth.uid())
  );
create policy "own snapshots" on snapshots for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own strategies" on strategies for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own alerts" on alerts for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (asset_id is null
         or exists (select 1 from assets a where a.id = asset_id and a.user_id = auth.uid()))
  );

create policy "read prices" on price_cache for select to authenticated using (true);
create policy "write prices" on price_cache for insert to authenticated with check (true);
create policy "update prices" on price_cache for update to authenticated using (true);
```

- [ ] **Step 2: Crear .env.example**

```bash
# .env.example — copiar a .env.local y rellenar desde Supabase → Settings → API
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-public-key>
```

- [ ] **Step 3: ⚠️ PASO MANUAL — configurar el proyecto Supabase (pedir al usuario si no hay credenciales)**

1. Crear proyecto en [supabase.com/dashboard](https://supabase.com/dashboard) (plan gratuito).
2. SQL Editor → pegar el contenido de `supabase/migrations/0001_init.sql` → Run.
3. Authentication → Sign In / Up → Email → desactivar **Confirm email** (app personal; evita el flujo de confirmación).
4. Settings → API → copiar URL y anon key a `.env.local` con el formato de `.env.example`.

Si el ejecutor es un agente sin credenciales: crear `.env.local` con placeholders, avisar al usuario y continuar (el código compila sin credenciales reales; el flujo de login se verifica en la Tarea 16).

- [ ] **Step 4: Verificar que .env.local está ignorado por git**

Run: `git check-ignore .env.local && echo IGNORED`
Expected: `IGNORED` (create-next-app ya incluye `.env*` en `.gitignore`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0001_init.sql .env.example
git commit -m "feat: esquema Supabase completo (6 tablas + RLS) y plantilla de entorno"
```

---

### Tarea 4: Clientes Supabase y middleware de sesión

**Files:**
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/middleware.ts`
- Create: `src/middleware.ts`

- [ ] **Step 1: Cliente de navegador**

```ts
// src/lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

- [ ] **Step 2: Cliente de servidor (cookies de Next 15 son async)**

```ts
// src/lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // llamado desde un Server Component: el middleware refresca la sesión
          }
        },
      },
    }
  )
}
```

- [ ] **Step 3: Lógica de refresco de sesión + protección de rutas**

```ts
// src/lib/supabase/middleware.ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user && !request.nextUrl.pathname.startsWith('/login')) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
```

- [ ] **Step 4: Registrar el middleware**

```ts
// src/middleware.ts
import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

- [ ] **Step 5: Verificar compilación y commit**

Run: `npx tsc --noEmit`
Expected: sin errores.

```bash
git add src/lib/supabase src/middleware.ts
git commit -m "feat: clientes Supabase (browser/server) y middleware de sesión"
```

---

### Tarea 5: Página de login

**Files:**
- Create: `src/app/login/page.tsx`

- [ ] **Step 1: Implementar login (sign in + sign up con email/password)**

```tsx
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
```

- [ ] **Step 2: Verificar compilación y commit**

Run: `npx tsc --noEmit`
Expected: sin errores.

```bash
git add src/app/login
git commit -m "feat: página de login con Supabase Auth (email/password)"
```

---

### Tarea 6: Shell de la app — tema oscuro, sidebar y 8 páginas

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx` (solo `metadata`)
- Modify: `src/app/page.tsx` (redirect)
- Create: `src/components/sidebar.tsx`
- Create: `src/app/(app)/layout.tsx`
- Create: `src/app/(app)/{dashboard,portfolio,analytics,backtest,scenarios,alerts,data-sources,settings}/page.tsx` (stubs; dashboard/portfolio/data-sources se reemplazan en Tareas 13–15)

- [ ] **Step 1: Tema oscuro base**

Reemplazar el contenido de `src/app/globals.css` por:

```css
@import "tailwindcss";

body {
  background-color: #0a0f1a;
  color: #e2e8f0;
}
```

- [ ] **Step 2: Título de la app**

En `src/app/layout.tsx`, reemplazar el objeto `metadata` generado por:

```ts
export const metadata: Metadata = {
  title: 'Portfolio App',
  description: 'Gestión de portafolio personal: posiciones, analítica, backtesting, escenarios y alertas',
}
```

- [ ] **Step 3: Redirect de la raíz**

Reemplazar el contenido de `src/app/page.tsx` por:

```tsx
import { redirect } from 'next/navigation'

export default function Home() {
  redirect('/dashboard')
}
```

- [ ] **Step 4: Sidebar con los 6 módulos + utilidades**

```tsx
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
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded px-3 py-2 text-sm ${
              pathname.startsWith(l.href)
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            {l.label}
          </Link>
        ))}
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
```

- [ ] **Step 5: Layout del grupo de rutas autenticadas**

```tsx
// src/app/(app)/layout.tsx
import Sidebar from '@/components/sidebar'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-x-auto p-8">{children}</main>
    </div>
  )
}
```

- [ ] **Step 6: Crear las 8 páginas stub**

Mismo patrón para las 8 rutas, cambiando título y fase. Ejemplo para `analytics`:

```tsx
// src/app/(app)/analytics/page.tsx
export default function AnalyticsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-100">Analítica</h1>
      <p className="mt-2 text-sm text-slate-500">Disponible en la Fase 3 (Analytics Engine).</p>
    </div>
  )
}
```

| Ruta | Componente | Título | Nota de fase |
|------|-----------|--------|--------------|
| `(app)/dashboard/page.tsx` | `DashboardPage` | Dashboard | "Se implementa en la Tarea 15." |
| `(app)/portfolio/page.tsx` | `PortfolioPage` | Portafolio | "Se implementa en la Tarea 13." |
| `(app)/data-sources/page.tsx` | `DataSourcesPage` | Fuentes de datos | "Se implementa en la Tarea 14." |
| `(app)/analytics/page.tsx` | `AnalyticsPage` | Analítica | "Disponible en la Fase 3 (Analytics Engine)." |
| `(app)/backtest/page.tsx` | `BacktestPage` | Backtest | "Disponible en la Fase 4 (Backtesting Engine)." |
| `(app)/scenarios/page.tsx` | `ScenariosPage` | Escenarios | "Disponible en la Fase 5 (Scenario Simulator)." |
| `(app)/alerts/page.tsx` | `AlertsPage` | Alertas | "Disponible en la Fase 6 (Alerts System)." |
| `(app)/settings/page.tsx` | `SettingsPage` | Configuración | "Disponible en la Fase 6." |

- [ ] **Step 7: Verificar build y commit**

Run: `npm run build`
Expected: build exitoso, rutas `/dashboard`, `/portfolio`, etc. listadas.

```bash
git add -A
git commit -m "feat: shell de la app — tema oscuro, sidebar de módulos y 8 páginas"
```

---

### Tarea 7: Dominio — computeHoldings (TDD)

**Files:**
- Create: `src/lib/portfolio/holdings.ts`
- Test: `src/lib/portfolio/holdings.test.ts`

- [ ] **Step 1: Escribir los tests (fallarán)**

```ts
// src/lib/portfolio/holdings.test.ts
import { describe, it, expect } from 'vitest'
import { computeHoldings, type Transaction } from '@/lib/portfolio/holdings'

function tx(partial: Partial<Transaction> & Pick<Transaction, 'side' | 'quantity' | 'price'>): Transaction {
  return {
    assetId: partial.assetId ?? 'a1',
    ticker: partial.ticker ?? 'AAPL',
    fees: partial.fees ?? 0,
    executedAt: partial.executedAt ?? '2026-01-15',
    ...partial,
  } as Transaction
}

describe('computeHoldings', () => {
  it('devuelve lista vacía sin transacciones', () => {
    expect(computeHoldings([])).toEqual([])
  })

  it('acumula una compra incluyendo comisiones en el costo', () => {
    const [h] = computeHoldings([tx({ side: 'buy', quantity: 10, price: 100, fees: 5 })])
    expect(h.quantity).toBe(10)
    expect(h.costBasis).toBe(1005)
    expect(h.avgCost).toBeCloseTo(100.5)
  })

  it('reduce a costo promedio en venta parcial', () => {
    const [h] = computeHoldings([
      tx({ side: 'buy', quantity: 10, price: 100 }),
      tx({ side: 'sell', quantity: 4, price: 150, executedAt: '2026-02-01' }),
    ])
    expect(h.quantity).toBe(6)
    expect(h.costBasis).toBe(600)
    expect(h.avgCost).toBe(100)
  })

  it('elimina posiciones totalmente vendidas', () => {
    const result = computeHoldings([
      tx({ side: 'buy', quantity: 10, price: 100 }),
      tx({ side: 'sell', quantity: 10, price: 120, executedAt: '2026-02-01' }),
    ])
    expect(result).toEqual([])
  })

  it('recorta ventas que exceden el saldo disponible', () => {
    const result = computeHoldings([
      tx({ side: 'buy', quantity: 5, price: 100 }),
      tx({ side: 'sell', quantity: 99, price: 120, executedAt: '2026-02-01' }),
    ])
    expect(result).toEqual([])
  })

  it('mantiene activos independientes', () => {
    const result = computeHoldings([
      tx({ side: 'buy', quantity: 10, price: 100 }),
      tx({ assetId: 'a2', ticker: 'BTC', side: 'buy', quantity: 0.5, price: 60000 }),
    ])
    expect(result).toHaveLength(2)
    const btc = result.find((h) => h.ticker === 'BTC')!
    expect(btc.quantity).toBe(0.5)
    expect(btc.costBasis).toBe(30000)
  })

  it('procesa transacciones desordenadas por fecha', () => {
    const [h] = computeHoldings([
      tx({ side: 'sell', quantity: 4, price: 150, executedAt: '2026-03-01' }),
      tx({ side: 'buy', quantity: 10, price: 100, executedAt: '2026-01-01' }),
    ])
    expect(h.quantity).toBe(6)
    expect(h.costBasis).toBe(600)
  })
})
```

- [ ] **Step 2: Verificar que fallan**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/portfolio/holdings'` (o similar).

- [ ] **Step 3: Implementar**

```ts
// src/lib/portfolio/holdings.ts
export interface Transaction {
  assetId: string
  ticker: string
  side: 'buy' | 'sell'
  quantity: number
  price: number
  fees: number
  executedAt: string // YYYY-MM-DD
}

export interface Holding {
  assetId: string
  ticker: string
  quantity: number
  costBasis: number // costo total de la posición abierta (método de costo promedio)
  avgCost: number
}

const EPSILON = 1e-9

export function computeHoldings(transactions: Transaction[]): Holding[] {
  const sorted = [...transactions].sort((a, b) => a.executedAt.localeCompare(b.executedAt))
  const byAsset = new Map<string, Holding>()

  for (const tx of sorted) {
    const h = byAsset.get(tx.assetId) ?? {
      assetId: tx.assetId,
      ticker: tx.ticker,
      quantity: 0,
      costBasis: 0,
      avgCost: 0,
    }
    if (tx.side === 'buy') {
      h.costBasis += tx.quantity * tx.price + tx.fees
      h.quantity += tx.quantity
    } else {
      const sellQty = Math.min(tx.quantity, h.quantity)
      h.costBasis -= sellQty * h.avgCost
      h.quantity -= sellQty
    }
    h.avgCost = h.quantity > EPSILON ? h.costBasis / h.quantity : 0
    byAsset.set(tx.assetId, h)
  }

  return [...byAsset.values()].filter((h) => h.quantity > EPSILON)
}
```

- [ ] **Step 4: Verificar que pasan**

Run: `npm test`
Expected: PASS — 7 tests de holdings + 1 placeholder.

- [ ] **Step 5: Commit**

```bash
git add src/lib/portfolio/holdings.ts src/lib/portfolio/holdings.test.ts
git commit -m "feat: cálculo de posiciones desde transacciones (costo promedio)"
```

---

### Tarea 8: Dominio — valoración y totales (TDD)

**Files:**
- Create: `src/lib/portfolio/valuation.ts`
- Test: `src/lib/portfolio/valuation.test.ts`

- [ ] **Step 1: Escribir los tests (fallarán)**

```ts
// src/lib/portfolio/valuation.test.ts
import { describe, it, expect } from 'vitest'
import { valuePositions, portfolioTotals, type Quote } from '@/lib/portfolio/valuation'
import type { Holding } from '@/lib/portfolio/holdings'

const holding = (over: Partial<Holding> = {}): Holding => ({
  assetId: 'a1',
  ticker: 'AAPL',
  quantity: 10,
  costBasis: 1000,
  avgCost: 100,
  ...over,
})

describe('valuePositions', () => {
  it('valora con el precio disponible', () => {
    const [p] = valuePositions([holding()], [{ ticker: 'AAPL', price: 120 }])
    expect(p.currentPrice).toBe(120)
    expect(p.marketValue).toBe(1200)
    expect(p.unrealizedPnl).toBe(200)
    expect(p.unrealizedPnlPct).toBeCloseTo(20)
  })

  it('marca null cuando no hay precio', () => {
    const [p] = valuePositions([holding()], [])
    expect(p.currentPrice).toBeNull()
    expect(p.marketValue).toBeNull()
    expect(p.unrealizedPnl).toBeNull()
    expect(p.unrealizedPnlPct).toBeNull()
  })
})

describe('portfolioTotals', () => {
  it('suma solo posiciones con precio para valor y P&L', () => {
    const quotes: Quote[] = [{ ticker: 'AAPL', price: 120 }]
    const positions = valuePositions(
      [holding(), holding({ assetId: 'a2', ticker: 'BTC', quantity: 1, costBasis: 50000, avgCost: 50000 })],
      quotes
    )
    const t = portfolioTotals(positions)
    expect(t.totalValue).toBe(1200)
    expect(t.totalCost).toBe(51000) // incluye también las no valoradas
    expect(t.totalPnl).toBe(200)
    expect(t.totalPnlPct).toBeCloseTo(20)
    expect(t.assetCount).toBe(2)
  })

  it('devuelve ceros con portafolio vacío', () => {
    const t = portfolioTotals([])
    expect(t).toEqual({ totalValue: 0, totalCost: 0, totalPnl: 0, totalPnlPct: 0, assetCount: 0 })
  })
})
```

- [ ] **Step 2: Verificar que fallan**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/portfolio/valuation'`.

- [ ] **Step 3: Implementar**

```ts
// src/lib/portfolio/valuation.ts
import type { Holding } from '@/lib/portfolio/holdings'

export interface Quote {
  ticker: string
  price: number
}

export interface PositionView extends Holding {
  currentPrice: number | null
  marketValue: number | null
  unrealizedPnl: number | null
  unrealizedPnlPct: number | null
}

export interface PortfolioTotals {
  totalValue: number
  totalCost: number
  totalPnl: number
  totalPnlPct: number
  assetCount: number
}

export function valuePositions(holdings: Holding[], quotes: Quote[]): PositionView[] {
  const priceMap = new Map(quotes.map((q) => [q.ticker, q.price]))
  return holdings.map((h) => {
    const price = priceMap.get(h.ticker) ?? null
    const marketValue = price !== null ? h.quantity * price : null
    const unrealizedPnl = marketValue !== null ? marketValue - h.costBasis : null
    const unrealizedPnlPct =
      unrealizedPnl !== null && h.costBasis > 0 ? (unrealizedPnl / h.costBasis) * 100 : null
    return { ...h, currentPrice: price, marketValue, unrealizedPnl, unrealizedPnlPct }
  })
}

export function portfolioTotals(positions: PositionView[]): PortfolioTotals {
  const valued = positions.filter((p) => p.marketValue !== null)
  const totalValue = valued.reduce((s, p) => s + (p.marketValue ?? 0), 0)
  const totalCost = positions.reduce((s, p) => s + p.costBasis, 0)
  const valuedCost = valued.reduce((s, p) => s + p.costBasis, 0)
  const totalPnl = totalValue - valuedCost
  const totalPnlPct = valuedCost > 0 ? (totalPnl / valuedCost) * 100 : 0
  return { totalValue, totalCost, totalPnl, totalPnlPct, assetCount: positions.length }
}
```

- [ ] **Step 4: Verificar que pasan**

Run: `npm test`
Expected: PASS — todos los tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/portfolio/valuation.ts src/lib/portfolio/valuation.test.ts
git commit -m "feat: valoración de posiciones y totales del portafolio"
```

---

### Tarea 9: Validación zod (TDD)

**Files:**
- Create: `src/lib/validation/schemas.ts`
- Test: `src/lib/validation/schemas.test.ts` (reemplaza el placeholder de la Tarea 2)

- [ ] **Step 1: Reemplazar el test placeholder con tests reales (fallarán)**

```ts
// src/lib/validation/schemas.test.ts
import { describe, it, expect } from 'vitest'
import {
  assetInputSchema,
  transactionInputSchema,
  priceInputSchema,
} from '@/lib/validation/schemas'

const UUID = '00000000-0000-4000-8000-000000000000'

describe('assetInputSchema', () => {
  it('normaliza ticker y moneda a mayúsculas', () => {
    const r = assetInputSchema.parse({ ticker: ' aapl ', assetType: 'stock', currency: 'usd' })
    expect(r.ticker).toBe('AAPL')
    expect(r.currency).toBe('USD')
    expect(r.name).toBe('')
  })

  it('rechaza ticker vacío', () => {
    expect(assetInputSchema.safeParse({ ticker: '  ', assetType: 'stock' }).success).toBe(false)
  })

  it('rechaza tipo de activo desconocido', () => {
    expect(assetInputSchema.safeParse({ ticker: 'AAPL', assetType: 'bond' }).success).toBe(false)
  })
})

describe('transactionInputSchema', () => {
  it('acepta números como string (inputs de formulario) y aplica fees=0 por defecto', () => {
    const r = transactionInputSchema.parse({
      assetId: UUID,
      side: 'buy',
      quantity: '10',
      price: '99.5',
      executedAt: '2026-01-15',
    })
    expect(r.quantity).toBe(10)
    expect(r.price).toBe(99.5)
    expect(r.fees).toBe(0)
  })

  it('rechaza cantidad cero o negativa', () => {
    const base = { assetId: UUID, side: 'sell', price: '10', executedAt: '2026-01-15' }
    expect(transactionInputSchema.safeParse({ ...base, quantity: '0' }).success).toBe(false)
    expect(transactionInputSchema.safeParse({ ...base, quantity: '-1' }).success).toBe(false)
  })

  it('rechaza fecha mal formada', () => {
    const r = transactionInputSchema.safeParse({
      assetId: UUID,
      side: 'buy',
      quantity: '1',
      price: '10',
      executedAt: '15/01/2026',
    })
    expect(r.success).toBe(false)
  })
})

describe('priceInputSchema', () => {
  it('normaliza ticker y convierte el precio', () => {
    const r = priceInputSchema.parse({ ticker: 'btc', price: '64000.5', priceDate: '2026-06-10' })
    expect(r.ticker).toBe('BTC')
    expect(r.price).toBe(64000.5)
  })

  it('rechaza precio cero o negativo', () => {
    expect(priceInputSchema.safeParse({ ticker: 'BTC', price: '0', priceDate: '2026-06-10' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Verificar que fallan**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/validation/schemas'`.

- [ ] **Step 3: Implementar los esquemas**

```ts
// src/lib/validation/schemas.ts
import { z } from 'zod'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export const assetInputSchema = z.object({
  ticker: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .transform((t) => t.toUpperCase()),
  name: z.string().trim().max(100).default(''),
  assetType: z.enum(['stock', 'etf', 'crypto', 'cash', 'other']),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((c) => c.toUpperCase())
    .default('USD'),
})
export type AssetInput = z.infer<typeof assetInputSchema>

export const transactionInputSchema = z.object({
  assetId: z.string().uuid(),
  side: z.enum(['buy', 'sell']),
  quantity: z.coerce.number().positive(),
  price: z.coerce.number().nonnegative(),
  fees: z.coerce.number().nonnegative().default(0),
  executedAt: z.string().regex(DATE_RE, 'formato esperado YYYY-MM-DD'),
})
export type TransactionInput = z.infer<typeof transactionInputSchema>

export const priceInputSchema = z.object({
  ticker: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .transform((t) => t.toUpperCase()),
  price: z.coerce.number().positive(),
  priceDate: z.string().regex(DATE_RE, 'formato esperado YYYY-MM-DD'),
})
export type PriceInput = z.infer<typeof priceInputSchema>
```

Nota: si el proyecto instaló zod v4 y `.default('USD')` tras `.transform()` da error de tipos, mover el `.default()` antes del `.transform()`.

- [ ] **Step 4: Verificar que pasan**

Run: `npm test`
Expected: PASS — todos los tests del proyecto.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation
git commit -m "feat: esquemas de validación zod para assets, transactions y prices"
```

---

### Tarea 10: API — /api/assets

**Files:**
- Create: `src/app/api/assets/route.ts`
- Create: `src/app/api/assets/[id]/route.ts`

- [ ] **Step 1: GET y POST**

```ts
// src/app/api/assets/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { assetInputSchema } from '@/lib/validation/schemas'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase.from('assets').select('*').order('ticker')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = assetInputSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { ticker, name, assetType, currency } = parsed.data
  const { data, error } = await supabase
    .from('assets')
    .insert({ user_id: user.id, ticker, name, asset_type: assetType, currency })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
```

- [ ] **Step 2: DELETE (params es Promise en Next 15)**

```ts
// src/app/api/assets/[id]/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase.from('assets').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return new NextResponse(null, { status: 204 })
}
```

- [ ] **Step 3: Verificar compilación y commit**

Run: `npx tsc --noEmit && npm run build`
Expected: sin errores; rutas `/api/assets` y `/api/assets/[id]` listadas.

```bash
git add src/app/api/assets
git commit -m "feat: API de assets (GET, POST, DELETE)"
```

---

### Tarea 11: API — /api/transactions

**Files:**
- Create: `src/app/api/transactions/route.ts`
- Create: `src/app/api/transactions/[id]/route.ts`

- [ ] **Step 1: GET (con join al ticker) y POST (verifica propiedad del asset)**

```ts
// src/app/api/transactions/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { transactionInputSchema } from '@/lib/validation/schemas'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('transactions')
    .select('id, asset_id, side, quantity, price, fees, executed_at, assets(ticker)')
    .order('executed_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = transactionInputSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { assetId, side, quantity, price, fees, executedAt } = parsed.data

  // RLS filtra assets ajenos: si no aparece, no es de este usuario
  const { data: asset } = await supabase.from('assets').select('id').eq('id', assetId).maybeSingle()
  if (!asset) return NextResponse.json({ error: 'Asset no encontrado' }, { status: 404 })

  const { data, error } = await supabase
    .from('transactions')
    .insert({
      user_id: user.id,
      asset_id: assetId,
      side,
      quantity,
      price,
      fees,
      executed_at: executedAt,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
```

- [ ] **Step 2: DELETE**

```ts
// src/app/api/transactions/[id]/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase.from('transactions').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return new NextResponse(null, { status: 204 })
}
```

- [ ] **Step 3: Verificar compilación y commit**

Run: `npx tsc --noEmit && npm run build`
Expected: sin errores.

```bash
git add src/app/api/transactions
git commit -m "feat: API de transacciones (GET, POST, DELETE)"
```

---

### Tarea 12: API — /api/prices y /api/positions

**Files:**
- Create: `src/app/api/prices/route.ts`
- Create: `src/app/api/positions/route.ts`

- [ ] **Step 1: Precios — GET caché reciente, POST precio manual (upsert)**

```ts
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
```

- [ ] **Step 2: Posiciones — compone dominio puro + datos**

```ts
// src/app/api/positions/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { computeHoldings, type Transaction } from '@/lib/portfolio/holdings'
import { valuePositions, portfolioTotals } from '@/lib/portfolio/valuation'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [txRes, priceRes] = await Promise.all([
    supabase
      .from('transactions')
      .select('asset_id, side, quantity, price, fees, executed_at, assets(ticker)'),
    supabase
      .from('price_cache')
      .select('ticker, price, price_date')
      .order('price_date', { ascending: false }),
  ])
  if (txRes.error) return NextResponse.json({ error: txRes.error.message }, { status: 500 })
  if (priceRes.error) return NextResponse.json({ error: priceRes.error.message }, { status: 500 })

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const transactions: Transaction[] = (txRes.data ?? []).map((row: any) => ({
    assetId: row.asset_id,
    ticker: row.assets?.ticker ?? '',
    side: row.side,
    quantity: Number(row.quantity),
    price: Number(row.price),
    fees: Number(row.fees),
    executedAt: row.executed_at,
  }))
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // priceRes viene ordenado por fecha desc: primera aparición = último precio,
  // segunda = precio anterior (para P&L del día)
  const latest = new Map<string, number>()
  const previous = new Map<string, number>()
  for (const p of priceRes.data ?? []) {
    if (!latest.has(p.ticker)) latest.set(p.ticker, Number(p.price))
    else if (!previous.has(p.ticker)) previous.set(p.ticker, Number(p.price))
  }

  const holdings = computeHoldings(transactions)
  const quotes = [...latest].map(([ticker, price]) => ({ ticker, price }))
  const positions = valuePositions(holdings, quotes)
  const totals = portfolioTotals(positions)

  const dailyPnl = positions.reduce((sum, pos) => {
    const last = latest.get(pos.ticker)
    const prev = previous.get(pos.ticker)
    return last !== undefined && prev !== undefined ? sum + pos.quantity * (last - prev) : sum
  }, 0)

  return NextResponse.json({ positions, totals: { ...totals, dailyPnl } })
}
```

- [ ] **Step 3: Verificar compilación y commit**

Run: `npx tsc --noEmit && npm run build`
Expected: sin errores.

```bash
git add src/app/api/prices src/app/api/positions
git commit -m "feat: API de precios manuales y posiciones valoradas"
```

---

### Tarea 13: UI — /portfolio (gestión de activos y transacciones)

**Files:**
- Modify: `src/app/(app)/portfolio/page.tsx` (reemplaza el stub)

- [ ] **Step 1: Implementar la página completa**

```tsx
// src/app/(app)/portfolio/page.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'

interface Asset {
  id: string
  ticker: string
  name: string
  asset_type: string
  currency: string
}

interface Tx {
  id: string
  asset_id: string
  side: 'buy' | 'sell'
  quantity: number
  price: number
  fees: number
  executed_at: string
  assets: { ticker: string } | null
}

const inputCls =
  'rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200'
const btnCls =
  'rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500'

export default function PortfolioPage() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [txs, setTxs] = useState<Tx[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [aRes, tRes] = await Promise.all([fetch('/api/assets'), fetch('/api/transactions')])
    if (aRes.ok) setAssets(await aRes.json())
    if (tRes.ok) setTxs(await tRes.json())
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function post(url: string, body: unknown) {
    setError(null)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setError(typeof data?.error === 'string' ? data.error : 'Error de validación')
      return false
    }
    await load()
    return true
  }

  async function remove(url: string) {
    await fetch(url, { method: 'DELETE' })
    await load()
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-slate-100">Portafolio</h1>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-200">Activos</h2>
        <form
          className="mb-4 flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            const form = e.currentTarget
            const fd = new FormData(form)
            const ok = await post('/api/assets', {
              ticker: fd.get('ticker'),
              name: fd.get('name'),
              assetType: fd.get('assetType'),
              currency: fd.get('currency') || 'USD',
            })
            if (ok) form.reset()
          }}
        >
          <input name="ticker" placeholder="Ticker (AAPL)" required className={inputCls} />
          <input name="name" placeholder="Nombre (opcional)" className={inputCls} />
          <select name="assetType" required className={inputCls} defaultValue="stock">
            <option value="stock">Acción</option>
            <option value="etf">ETF</option>
            <option value="crypto">Crypto</option>
            <option value="cash">Efectivo</option>
            <option value="other">Otro</option>
          </select>
          <input name="currency" placeholder="USD" maxLength={3} className={inputCls} />
          <button type="submit" className={btnCls}>Añadir activo</button>
        </form>
        <ul className="flex flex-wrap gap-2">
          {assets.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded border border-slate-800 bg-slate-900 px-3 py-1 text-sm"
            >
              <span className="font-semibold text-slate-200">{a.ticker}</span>
              <span className="text-xs text-slate-500">{a.asset_type} · {a.currency}</span>
              <button
                onClick={() => remove(`/api/assets/${a.id}`)}
                className="text-slate-600 hover:text-red-400"
                title="Eliminar activo y sus transacciones"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-200">Transacciones</h2>
        <form
          className="mb-4 flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            const form = e.currentTarget
            const fd = new FormData(form)
            const ok = await post('/api/transactions', {
              assetId: fd.get('assetId'),
              side: fd.get('side'),
              quantity: fd.get('quantity'),
              price: fd.get('price'),
              fees: fd.get('fees') || 0,
              executedAt: fd.get('executedAt'),
            })
            if (ok) form.reset()
          }}
        >
          <select name="assetId" required className={inputCls}>
            <option value="">Activo…</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>{a.ticker}</option>
            ))}
          </select>
          <select name="side" required className={inputCls} defaultValue="buy">
            <option value="buy">Compra</option>
            <option value="sell">Venta</option>
          </select>
          <input name="quantity" type="number" step="any" min="0" placeholder="Cantidad" required className={inputCls} />
          <input name="price" type="number" step="any" min="0" placeholder="Precio" required className={inputCls} />
          <input name="fees" type="number" step="any" min="0" placeholder="Comisión" className={inputCls} />
          <input name="executedAt" type="date" required className={inputCls} />
          <button type="submit" className={btnCls}>Registrar</button>
        </form>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-xs uppercase text-slate-500">
              <th className="py-2">Fecha</th>
              <th>Activo</th>
              <th>Tipo</th>
              <th className="text-right">Cantidad</th>
              <th className="text-right">Precio</th>
              <th className="text-right">Comisión</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {txs.map((t) => (
              <tr key={t.id} className="border-b border-slate-900">
                <td className="py-2">{t.executed_at}</td>
                <td className="font-semibold">{t.assets?.ticker ?? '—'}</td>
                <td className={t.side === 'buy' ? 'text-green-400' : 'text-red-400'}>
                  {t.side === 'buy' ? 'Compra' : 'Venta'}
                </td>
                <td className="text-right">{Number(t.quantity)}</td>
                <td className="text-right">{Number(t.price).toLocaleString()}</td>
                <td className="text-right">{Number(t.fees)}</td>
                <td className="text-right">
                  <button
                    onClick={() => remove(`/api/transactions/${t.id}`)}
                    className="text-slate-600 hover:text-red-400"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {txs.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-slate-500">Sin transacciones todavía.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Verificar build y commit**

Run: `npm run build`
Expected: sin errores.

```bash
git add "src/app/(app)/portfolio"
git commit -m "feat: página de portafolio — CRUD de activos y transacciones"
```

---

### Tarea 14: UI — /data-sources (entrada manual de precios)

**Files:**
- Modify: `src/app/(app)/data-sources/page.tsx` (reemplaza el stub)

- [ ] **Step 1: Implementar la página**

```tsx
// src/app/(app)/data-sources/page.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'

interface PriceRow {
  id: string
  ticker: string
  price: number
  price_date: string
  source: string
}

const inputCls =
  'rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200'

const apiSources = [
  { name: 'Yahoo Finance', note: 'Acciones y ETFs — Fase 2' },
  { name: 'CoinGecko', note: 'Criptomonedas — Fase 2' },
  { name: 'Alpha Vantage', note: 'Históricos extendidos — Fase 2' },
]

export default function DataSourcesPage() {
  const [prices, setPrices] = useState<PriceRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/prices')
    if (res.ok) setPrices(await res.json())
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-slate-100">Fuentes de datos</h1>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {apiSources.map((s) => (
          <div key={s.name} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200">{s.name}</span>
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-500">
                Pendiente
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">{s.note}</p>
          </div>
        ))}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-200">Entrada manual de precios</h2>
        {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
        <form
          className="mb-4 flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            setError(null)
            const form = e.currentTarget
            const fd = new FormData(form)
            const res = await fetch('/api/prices', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ticker: fd.get('ticker'),
                price: fd.get('price'),
                priceDate: fd.get('priceDate'),
              }),
            })
            if (!res.ok) {
              setError('No se pudo guardar el precio (revisa los campos)')
              return
            }
            form.reset()
            await load()
          }}
        >
          <input name="ticker" placeholder="Ticker (AAPL)" required className={inputCls} />
          <input name="price" type="number" step="any" min="0" placeholder="Precio" required className={inputCls} />
          <input name="priceDate" type="date" required className={inputCls} />
          <button
            type="submit"
            className="rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500"
          >
            Guardar precio
          </button>
        </form>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-xs uppercase text-slate-500">
              <th className="py-2">Ticker</th>
              <th className="text-right">Precio</th>
              <th>Fecha</th>
              <th>Fuente</th>
            </tr>
          </thead>
          <tbody>
            {prices.map((p) => (
              <tr key={p.id} className="border-b border-slate-900">
                <td className="py-2 font-semibold">{p.ticker}</td>
                <td className="text-right">{Number(p.price).toLocaleString()}</td>
                <td>{p.price_date}</td>
                <td className="text-slate-500">{p.source}</td>
              </tr>
            ))}
            {prices.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-slate-500">Sin precios cacheados todavía.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Verificar build y commit**

Run: `npm run build`
Expected: sin errores.

```bash
git add "src/app/(app)/data-sources"
git commit -m "feat: página de fuentes de datos con entrada manual de precios"
```

---

### Tarea 15: UI — /dashboard v1 (KPIs + distribución + posiciones)

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx` (reemplaza el stub)

- [ ] **Step 1: Implementar el dashboard**

```tsx
// src/app/(app)/dashboard/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'

interface Position {
  assetId: string
  ticker: string
  quantity: number
  costBasis: number
  avgCost: number
  currentPrice: number | null
  marketValue: number | null
  unrealizedPnl: number | null
  unrealizedPnlPct: number | null
}

interface Totals {
  totalValue: number
  totalCost: number
  totalPnl: number
  totalPnlPct: number
  assetCount: number
  dailyPnl: number
}

const COLORS = ['#3b82f6', '#22c55e', '#f97316', '#818cf8', '#ec4899', '#14b8a6', '#eab308', '#f43f5e']

const fmt = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

function KpiCard({ label, value, accent }: { label: string; value: string; accent?: 'up' | 'down' }) {
  const color = accent === 'up' ? 'text-green-400' : accent === 'down' ? 'text-red-400' : 'text-slate-100'
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${color}`}>{value}</div>
    </div>
  )
}

export default function DashboardPage() {
  const [positions, setPositions] = useState<Position[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)

  useEffect(() => {
    fetch('/api/positions')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setPositions(data.positions)
          setTotals(data.totals)
        }
      })
  }, [])

  const allocation = positions
    .filter((p) => p.marketValue !== null)
    .map((p) => ({ name: p.ticker, value: p.marketValue as number }))

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-slate-100">Dashboard</h1>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Valor Total" value={totals ? fmt(totals.totalValue) : '—'} />
        <KpiCard
          label="P&L Hoy"
          value={totals ? fmt(totals.dailyPnl) : '—'}
          accent={totals ? (totals.dailyPnl >= 0 ? 'up' : 'down') : undefined}
        />
        <KpiCard
          label="Retorno Total"
          value={totals ? `${totals.totalPnlPct.toFixed(1)}%` : '—'}
          accent={totals ? (totals.totalPnl >= 0 ? 'up' : 'down') : undefined}
        />
        <KpiCard label="Activos" value={totals ? String(totals.assetCount) : '—'} />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-3 text-lg font-semibold text-slate-200">Distribución de activos</h2>
          {allocation.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">
              Registra transacciones y precios para ver la distribución.
            </p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={allocation} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90}>
                    {allocation.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => fmt(Number(v))} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-3 text-lg font-semibold text-slate-200">Posiciones</h2>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs uppercase text-slate-500">
                <th className="py-2">Ticker</th>
                <th className="text-right">Cantidad</th>
                <th className="text-right">Costo prom.</th>
                <th className="text-right">Precio</th>
                <th className="text-right">Valor</th>
                <th className="text-right">P&L</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.assetId} className="border-b border-slate-900">
                  <td className="py-2 font-semibold">{p.ticker}</td>
                  <td className="text-right">{p.quantity}</td>
                  <td className="text-right">{p.avgCost.toFixed(2)}</td>
                  <td className="text-right">{p.currentPrice?.toFixed(2) ?? '—'}</td>
                  <td className="text-right">{p.marketValue !== null ? fmt(p.marketValue) : '—'}</td>
                  <td
                    className={`text-right ${
                      p.unrealizedPnl === null
                        ? 'text-slate-500'
                        : p.unrealizedPnl >= 0
                          ? 'text-green-400'
                          : 'text-red-400'
                    }`}
                  >
                    {p.unrealizedPnl !== null
                      ? `${fmt(p.unrealizedPnl)} (${p.unrealizedPnlPct?.toFixed(1)}%)`
                      : '—'}
                  </td>
                </tr>
              ))}
              {positions.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-slate-500">Sin posiciones abiertas.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>

      <p className="text-xs text-slate-600">
        La gráfica de rendimiento histórico y el selector de período llegan en la Fase 3 (requieren snapshots de la Fase 2).
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Verificar build y commit**

Run: `npm run build`
Expected: sin errores.

```bash
git add "src/app/(app)/dashboard"
git commit -m "feat: dashboard v1 — KPIs, distribución de activos y tabla de posiciones"
```

---

### Tarea 16: Verificación final y actualización del README

**Files:**
- Modify: `README.md` (línea de estado)

- [ ] **Step 1: Suite completa de verificación**

```bash
npm test && npm run lint && npm run build
```

Expected: todos los tests PASS, lint sin errores, build exitoso.

- [ ] **Step 2: Verificación manual end-to-end (requiere credenciales Supabase en `.env.local`)**

```bash
npm run dev
```

Flujo a verificar en el navegador (`http://localhost:3000`):
1. Sin sesión → redirige a `/login`.
2. Crear cuenta → entra a `/dashboard` (KPIs en cero/—).
3. `/portfolio` → añadir activo `AAPL` (stock) → registrar compra de 10 @ 150 con fecha de hoy.
4. `/data-sources` → guardar precio manual `AAPL` 175 con fecha de hoy.
5. `/dashboard` → Valor Total $1,750 · Retorno Total +16.7% · Activos 1 · pie con AAPL · posición listada.
6. Cerrar sesión desde el sidebar → vuelve a `/login`.

Si no hay credenciales reales, dejar este paso documentado como pendiente para el usuario y no marcar la tarea como verificada end-to-end.

- [ ] **Step 3: Actualizar el estado en README.md**

Reemplazar la línea:

```
> **Estado:** diseño completo (fase de brainstorming). Sin código aún — próximo paso: plan de implementación + scaffolding.
```

por:

```
> **Estado:** Fase 1 implementada (fundación + Portfolio Manager). Roadmap en [docs/superpowers/plans/ROADMAP.md](docs/superpowers/plans/ROADMAP.md).
```

- [ ] **Step 4: Commit final**

```bash
git add README.md
git commit -m "docs: actualizar estado a Fase 1 implementada"
```
