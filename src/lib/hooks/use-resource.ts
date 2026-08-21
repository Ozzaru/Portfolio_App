// src/lib/hooks/use-resource.ts
'use client'

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { resources } from '@/lib/cache/resources'

// Envoltura delgada del store sobre `useSyncExternalStore`. Es la ÚNICA parte
// del caché sin cobertura de tests —este proyecto no tiene jsdom ni
// testing-library—, y por eso se mantiene sin lógica propia: todo lo que puede
// salir mal (dedup, TTL, invalidación, carreras) vive en `cache/store.ts`, que
// sí está probado.
//
// El mismo patrón de suscripción que ya usa `use-prefs.ts`.

async function fetchJson<T>(key: string): Promise<T> {
  const res = await fetch(key)
  if (!res.ok) throw new Error(`${key} respondió ${res.status}`)
  return res.json() as Promise<T>
}

export interface Resource<T> {
  data: T | undefined
  loading: boolean
  error: Error | null
}

/**
 * Lee un endpoint a través del caché compartido.
 *
 * `key === null` deja la lectura en pausa: sirve para dependencias que aún no
 * están listas, sin romper el orden de los hooks.
 */
export function useResource<T>(key: string | null): Resource<T> {
  // El fallo se guarda JUNTO A SU CLAVE y el error se deriva comparándolas, en
  // vez de limpiarlo con un setState al inicio del effect: eso último viola
  // `react-hooks/set-state-in-effect`. Mismo idiom que `analytics/page.tsx`.
  // Efecto secundario deseable: al cambiar de clave el error caduca solo.
  const [failure, setFailure] = useState<{ key: string; error: Error } | null>(null)

  const subscribe = useCallback((onChange: () => void) => resources.subscribe(onChange), [])

  // `store.get` devuelve el objeto cacheado POR REFERENCIA. Es un requisito de
  // `useSyncExternalStore`, no una optimización: un objeto nuevo en cada llamada
  // haría que React re-renderice sin parar. Hay un test que lo fija.
  const getSnapshot = useCallback(() => (key === null ? undefined : resources.get<T>(key)), [key])
  const getServerSnapshot = useCallback(() => undefined, [])

  const data = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  // Depende de `data`, no sólo de `key`. Cuando una mutación invalida la clave,
  // `data` pasa a `undefined` y esto vuelve a disparar la carga: sin esa
  // dependencia la vista se vaciaría y se quedaría vacía hasta desmontar.
  //
  // No hay bucle: al resolver, `data` deja de ser `undefined` y la guarda corta.
  // Si falla, `data` sigue `undefined` pero las dependencias no cambian, así que
  // el efecto no se vuelve a ejecutar. Y varios consumidores de la misma clave
  // reaccionando a la vez comparten un solo viaje, por el dedup del store.
  useEffect(() => {
    if (key === null || data !== undefined) return
    let active = true
    resources.load<T>(key, fetchJson).catch((e: unknown) => {
      if (active) setFailure({ key, error: e instanceof Error ? e : new Error(String(e)) })
    })
    return () => {
      active = false
    }
  }, [key, data])

  const error = failure !== null && failure.key === key ? failure.error : null

  return { data, loading: data === undefined && error === null, error }
}
