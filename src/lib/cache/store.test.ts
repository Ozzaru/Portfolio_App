// src/lib/cache/store.test.ts
//
// Contrato del caché de lecturas del cliente.
//
// Un recorrido dashboard → analítica → alertas dispara ~9 peticiones, de las
// cuales ~5 son duplicados exactos: `/api/analytics` con la misma clave desde
// dos páginas, `/api/positions` desde dos páginas, y `/api/alerts` desde la
// página de alertas Y el sidebar AL MISMO TIEMPO.
//
// Ese último es el caso que un `Map<clave, dato>` ingenuo NO resuelve: cuando
// ambos montan, ninguno tiene dato todavía, así que ambos salen a la red. Por
// eso el store cachea la PROMESA, no el dato.
//
// Todo acá es TypeScript puro sobre un fetcher falso: sin React, sin jsdom, sin
// red. Es la razón de haber elegido store propio sobre SWR — la lógica de
// concurrencia queda cubierta por tests que corren en milisegundos.

import { describe, it, expect, vi } from 'vitest'
import { createStore } from './store'

// Promesa controlable desde fuera: permite tener dos `load` simultáneos con la
// petición todavía sin resolver, que es justo el escenario a probar.
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const TTL = 30_000

describe('deduplicación en vuelo', () => {
  it('dos load concurrentes con la misma clave hacen UNA sola petición', async () => {
    const store = createStore({ ttlMs: TTL })
    const d = deferred<string>()
    const fetcher = vi.fn(() => d.promise)

    // Ambos arrancan antes de que la primera petición resuelva.
    const a = store.load('/api/alerts', fetcher)
    const b = store.load('/api/alerts', fetcher)

    d.resolve('datos')
    expect(await a).toBe('datos')
    expect(await b).toBe('datos')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('claves distintas no se deduplican entre sí', async () => {
    const store = createStore({ ttlMs: TTL })
    const fetcher = vi.fn(async (k: string) => k)

    await Promise.all([store.load('/api/alerts', fetcher), store.load('/api/positions', fetcher)])
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('tras resolver, una lectura posterior sale del caché', async () => {
    const store = createStore({ ttlMs: TTL })
    const fetcher = vi.fn(async () => 'datos')

    await store.load('/api/alerts', fetcher)
    await store.load('/api/alerts', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe('TTL', () => {
  it('vuelve a pedir cuando el dato expiró', async () => {
    let clock = 1_000
    const store = createStore({ ttlMs: TTL, now: () => clock })
    const fetcher = vi.fn(async () => 'datos')

    await store.load('/api/alerts', fetcher)
    clock += TTL + 1
    await store.load('/api/alerts', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('no vuelve a pedir mientras siga fresco', async () => {
    let clock = 1_000
    const store = createStore({ ttlMs: TTL, now: () => clock })
    const fetcher = vi.fn(async () => 'datos')

    await store.load('/api/alerts', fetcher)
    clock += TTL - 1
    await store.load('/api/alerts', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe('errores', () => {
  it('un fallo NO se cachea: la siguiente lectura reintenta', async () => {
    const store = createStore({ ttlMs: TTL })
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('red caída'))
      .mockResolvedValueOnce('datos')

    await expect(store.load('/api/alerts', fetcher)).rejects.toThrow('red caída')
    expect(await store.load('/api/alerts', fetcher)).toBe('datos')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('el rechazo llega a TODOS los que estaban esperando', async () => {
    const store = createStore({ ttlMs: TTL })
    const d = deferred<string>()
    const fetcher = vi.fn(() => d.promise)

    const a = store.load('/api/alerts', fetcher)
    const b = store.load('/api/alerts', fetcher)
    d.reject(new Error('red caída'))

    await expect(a).rejects.toThrow('red caída')
    await expect(b).rejects.toThrow('red caída')
  })
})

describe('invalidate', () => {
  it('borra por prefijo: alcanza todas las variantes de query', async () => {
    const store = createStore({ ttlMs: TTL })
    const fetcher = vi.fn(async (k: string) => k)

    await store.load('/api/analytics?period=1M&benchmark=SPY', fetcher)
    await store.load('/api/analytics?period=1Y&benchmark=QQQ', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(2)

    // Una compra nueva ensucia el análisis de TODOS los períodos, no solo el
    // que el usuario tiene abierto.
    store.invalidate('/api/analytics')

    await store.load('/api/analytics?period=1M&benchmark=SPY', fetcher)
    await store.load('/api/analytics?period=1Y&benchmark=QQQ', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('no toca claves de otro prefijo', async () => {
    const store = createStore({ ttlMs: TTL })
    const fetcher = vi.fn(async (k: string) => k)

    await store.load('/api/positions', fetcher)
    store.invalidate('/api/alerts')
    await store.load('/api/positions', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('descarta el resultado de una petición que ya estaba en vuelo', async () => {
    // El caso de carrera real: el usuario aprieta "Refrescar precios" mientras
    // el dashboard todavía está cargando posiciones. La petición vieja resuelve
    // DESPUÉS de la mutación y, sin protección, escribiría datos pre-refresh
    // encima del caché recién invalidado.
    const store = createStore({ ttlMs: TTL })
    const d = deferred<string>()

    const enVuelo = store.load('/api/positions', () => d.promise)
    store.invalidate('/api/positions')
    d.resolve('datos viejos')
    await enVuelo

    expect(store.get('/api/positions')).toBeUndefined()
  })
})

describe('suscripción', () => {
  it('notifica en set y en invalidate, y deja de notificar al desuscribirse', () => {
    const store = createStore({ ttlMs: TTL })
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    store.set('/api/alerts', 'datos')
    expect(listener).toHaveBeenCalledTimes(1)

    store.invalidate('/api/alerts')
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    store.set('/api/alerts', 'otros')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('get devuelve una referencia ESTABLE entre llamadas', () => {
    // Requisito de `useSyncExternalStore`: si getSnapshot devolviera un objeto
    // nuevo cada vez, React entraría en un bucle infinito de renders. El store
    // guarda el objeto parseado y lo devuelve por referencia.
    const store = createStore({ ttlMs: TTL })
    store.set('/api/alerts', { alerts: [] })
    expect(store.get('/api/alerts')).toBe(store.get('/api/alerts'))
  })
})
