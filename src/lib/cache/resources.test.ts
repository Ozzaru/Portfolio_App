// src/lib/cache/resources.test.ts
//
// El mapa de invalidación: qué escritura ensucia qué lectura.
//
// Es la parte del caché que no puede salir de una librería genérica, porque
// depende de cómo se relacionan los endpoints de ESTA app. Vive como dato puro
// para que haya un solo lugar donde mirar cuando algo se vea rancio.

import { describe, it, expect, beforeEach } from 'vitest'
import { INVALIDATES, createInvalidator } from './resources'
import { createStore } from './store'

const TTL = 30_000

describe('INVALIDATES', () => {
  it('una compra o venta ensucia posiciones, analítica, transacciones y activos', () => {
    expect(INVALIDATES.portfolio).toEqual(
      expect.arrayContaining(['/api/positions', '/api/analytics', '/api/transactions', '/api/assets']),
    )
  })

  it('refrescar precios TAMBIÉN ensucia las alertas', () => {
    // No es obvio: /api/prices/refresh corre `evaluateAndPersist` al final, así
    // que puede dejar alertas disparadas que el badge del sidebar debe reflejar.
    expect(INVALIDATES.prices).toContain('/api/alerts')
  })

  it('tocar alertas NO ensucia posiciones ni analítica', () => {
    // Crear o silenciar una alerta no cambia la cartera. Invalidar de más
    // costaría justo los viajes que este caché existe para evitar.
    expect(INVALIDATES.alerts).not.toContain('/api/positions')
    expect(INVALIDATES.alerts).not.toContain('/api/analytics')
  })
})

describe('invalidador sobre un store real', () => {
  let store: ReturnType<typeof createStore>
  let invalidate: ReturnType<typeof createInvalidator>

  beforeEach(() => {
    store = createStore({ ttlMs: TTL })
    invalidate = createInvalidator(store)
  })

  it('una mutación de portafolio limpia analítica de TODOS los períodos', () => {
    store.set('/api/analytics?period=1M&benchmark=SPY', 'a')
    store.set('/api/analytics?period=1Y&benchmark=QQQ', 'b')

    invalidate('portfolio')

    expect(store.get('/api/analytics?period=1M&benchmark=SPY')).toBeUndefined()
    expect(store.get('/api/analytics?period=1Y&benchmark=QQQ')).toBeUndefined()
  })

  it('el prefijo /api/prices alcanza también a /api/prices/status', () => {
    // Depende de que la invalidación sea por prefijo y no por clave exacta.
    store.set('/api/prices', 'lista')
    store.set('/api/prices/status', 'estado')

    invalidate('prices')

    expect(store.get('/api/prices')).toBeUndefined()
    expect(store.get('/api/prices/status')).toBeUndefined()
  })

  it('una mutación de alertas deja intacto el resto', () => {
    store.set('/api/positions', 'posiciones')
    store.set('/api/alerts', 'alertas')

    invalidate('alerts')

    expect(store.get('/api/alerts')).toBeUndefined()
    expect(store.get('/api/positions')).toBe('posiciones')
  })
})
