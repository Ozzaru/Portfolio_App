import type { JsonFetcher } from './types'

const TIMEOUT_MS = 15_000

// Único punto de red real. Un User-Agent de navegador evita bloqueos de Yahoo.
// Timeout vía AbortController: estas APIs externas se llaman desde Route Handlers
// y un upstream colgado bloquearía la petición indefinidamente.
export const defaultFetcher: JsonFetcher = async (url) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (portfolio-app)' },
      signal: controller.signal,
    })
    // Se reporta solo el host (no la URL completa) a propósito: las URLs de
    // Alpha Vantage llevan la API key en el query string y no debe filtrarse.
    if (!res.ok) throw new Error(`HTTP ${res.status} al pedir ${new URL(url).host}`)
    return res.json()
  } finally {
    clearTimeout(timer)
  }
}
