import type { JsonFetcher } from './types'

// Único punto de red real. Un User-Agent de navegador evita bloqueos de Yahoo.
export const defaultFetcher: JsonFetcher = async (url) => {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (portfolio-app)' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} al pedir ${new URL(url).host}`)
  return res.json()
}
