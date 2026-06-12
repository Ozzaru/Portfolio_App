import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  // OJO: no setear headers sobre supabaseResponse antes de getUser():
  // el callback setAll puede reasignarla con NextResponse.next({ request })
  // y descartar lo que se haya escrito. Añadir headers después de getUser().
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

  const pathname = request.nextUrl.pathname

  // Las rutas /api devuelven su propio 401 JSON; aquí solo se refresca la sesión.
  if (!user && !pathname.startsWith('/login') && !pathname.startsWith('/api/')) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return redirectPreservingCookies(url, supabaseResponse)
  }

  if (user && pathname.startsWith('/login')) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return redirectPreservingCookies(url, supabaseResponse)
  }

  return supabaseResponse
}

// Un NextResponse.redirect nuevo no hereda las cookies de sesión que Supabase
// pudo refrescar durante getUser(); sin copiarlas, el token renovado se pierde
// y la sesión puede entrar en un loop de refresco.
function redirectPreservingCookies(url: URL, sessionResponse: NextResponse) {
  const redirectResponse = NextResponse.redirect(url)
  sessionResponse.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie)
  })
  return redirectResponse
}
