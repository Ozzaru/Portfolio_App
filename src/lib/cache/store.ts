// src/lib/cache/store.ts
//
// Caché en memoria de las lecturas del cliente, con deduplicación de peticiones
// en vuelo. Existe porque navegar entre páginas repetía peticiones idénticas:
// `/api/analytics` con la misma clave desde el dashboard y desde analítica,
// `/api/positions` desde dos páginas, y `/api/alerts` desde la página de alertas
// y el sidebar AL MISMO TIEMPO.
//
// Ese último caso es la razón de cachear la PROMESA y no el dato: cuando ambos
// montan, ninguno tiene dato todavía, así que un `Map<clave, dato>` no evitaría
// los dos viajes.
//
// ─────────────────────────────────────────────────────────────────────────────
// ESTE STORE **NO** HACE, A PROPÓSITO:
//
//   · revalidación al enfocar la ventana   · polling por intervalo
//   · revalidación al reconectar            · paginación
//   · updates optimistas con rollback       · reintentos con backoff
//   · persistencia entre recargas
//
// No son omisiones: son el límite que mantiene esto en ~60 líneas testeables en
// vez de convertirlo en un SWR peor. La revalidación al enfocar sería además
// contraproducente acá — dispararía `/api/analytics`, la ruta más cara, cada vez
// que el usuario vuelve a la pestaña, cuando los precios sólo cambian si él los
// refresca.
//
// SI ALGUNA DE ESAS SE VUELVE NECESARIA, LA RESPUESTA ES INSTALAR SWR —
// NO HACER CRECER ESTE ARCHIVO.
// ─────────────────────────────────────────────────────────────────────────────

interface Entry {
  data: unknown
  at: number
}

export interface Store {
  /** Dato fresco, o `undefined` si falta o expiró. Referencia estable. */
  get<T>(key: string): T | undefined
  set(key: string, data: unknown): void
  /** Devuelve el dato cacheado, la petición ya en vuelo, o dispara una nueva. */
  load<T>(key: string, fetcher: (key: string) => Promise<T>): Promise<T>
  /** Borra toda clave que empiece con `prefix` y descarta lo que esté en vuelo. */
  invalidate(prefix: string): void
  subscribe(listener: () => void): () => void
}

export function createStore(opts: { ttlMs: number; now?: () => number }): Store {
  const cache = new Map<string, Entry>()
  const inflight = new Map<string, Promise<unknown>>()
  const listeners = new Set<() => void>()
  // Contador por clave: una invalidación lo incrementa, y una petición que
  // arrancó antes descubre al resolver que su generación quedó obsoleta y no
  // escribe. Sin esto, apretar "Refrescar precios" mientras el dashboard carga
  // dejaría datos pre-refresh encima del caché recién invalidado.
  const generation = new Map<string, number>()

  const now = opts.now ?? Date.now
  const emit = () => {
    for (const l of listeners) l()
  }
  const genOf = (key: string) => generation.get(key) ?? 0

  const get = <T,>(key: string): T | undefined => {
    const entry = cache.get(key)
    if (!entry) return undefined
    if (now() - entry.at > opts.ttlMs) {
      cache.delete(key)
      return undefined
    }
    return entry.data as T
  }

  const set = (key: string, data: unknown): void => {
    cache.set(key, { data, at: now() })
    emit()
  }

  return {
    get,
    set,

    load<T>(key: string, fetcher: (key: string) => Promise<T>): Promise<T> {
      const fresh = get<T>(key)
      if (fresh !== undefined) return Promise.resolve(fresh)

      const running = inflight.get(key) as Promise<T> | undefined
      if (running) return running

      const startedAt = genOf(key)
      const promise = fetcher(key)
        .then((data) => {
          // Sólo escribe si nadie invalidó esta clave mientras la petición volaba.
          if (genOf(key) === startedAt) set(key, data)
          return data
        })
        .finally(() => {
          // También en rechazo: un error no debe quedar cacheado ni bloquear el
          // siguiente intento.
          inflight.delete(key)
        })

      inflight.set(key, promise)
      return promise
    },

    invalidate(prefix: string): void {
      for (const key of cache.keys()) {
        if (key.startsWith(prefix)) cache.delete(key)
      }
      for (const key of inflight.keys()) {
        if (key.startsWith(prefix)) generation.set(key, genOf(key) + 1)
      }
      emit()
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
