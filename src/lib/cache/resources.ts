// src/lib/cache/resources.ts
//
// La instancia del caché que usa la app, y el mapa de qué escritura ensucia qué
// lectura. Esa relación no puede salir de una librería genérica: depende de cómo
// se conectan los endpoints de este proyecto en particular.

import { createStore, type Store } from './store'

// 30 s: de sobra para deduplicar una navegación completa entre páginas, y corto
// para que un cambio hecho fuera de la app —otra pestaña, un cron— no se quede
// rancio mucho rato. La invalidación explícita cubre los cambios propios; el TTL
// es sólo la red de seguridad para los ajenos.
export const resources: Store = createStore({ ttlMs: 30_000 })

// Qué prefijos hay que borrar tras cada tipo de mutación. Por prefijo, no por
// clave exacta: `/api/analytics` alcanza a todas sus combinaciones de período y
// benchmark de una sola vez, y `/api/prices` alcanza también a `/api/prices/status`.
export const INVALIDATES = {
  // Crear, silenciar, reactivar o borrar una alerta. No toca la cartera.
  alerts: ['/api/alerts'],

  // Refrescar, backfillear, o registrar un precio manual. Incluye `/api/alerts`
  // porque `/api/prices/refresh` corre `evaluateAndPersist` al final y puede
  // dejar alertas disparadas que el badge del sidebar tiene que reflejar.
  prices: ['/api/positions', '/api/analytics', '/api/prices', '/api/alerts'],

  // Alta o baja de un activo o una transacción: cambia holdings, y con ellos
  // todo lo que se derive de la cartera.
  portfolio: ['/api/positions', '/api/analytics', '/api/transactions', '/api/assets'],
} as const

export type MutationKind = keyof typeof INVALIDATES

// Separado de la instancia global para poder probarlo contra un store limpio.
export function createInvalidator(store: Store) {
  return (kind: MutationKind): void => {
    for (const prefix of INVALIDATES[kind]) store.invalidate(prefix)
  }
}

/** Llamar después de cada mutación exitosa. */
export const invalidateAfter = createInvalidator(resources)
