// src/lib/analytics/benchmarks.test.ts
//
// Qué benchmarks se mantienen frescos automáticamente.
//
// Ni `/api/prices/refresh` ni `/api/prices/backfill` incluían los benchmarks:
// ambos leen `select ticker from assets`, y SPY no tiene fila ahí porque no es
// una posición del usuario. Su único escritor era `downloadSeries` dentro de
// `/api/analytics`, que sólo dispara cuando el ticker no tiene NINGUNA fila.
// Resultado: tras el primer backfill, los datos del benchmark se congelaban
// para siempre (SPY quedó detenido en 2026-06-16) y la línea del gráfico salía
// plana sin que nada lo reportara.
//
// La decisión de negocio que estos tests fijan: SPY y QQQ se refrescan siempre,
// para que cambiar de benchmark en la UI sea instantáneo contra caché. BTC NO,
// porque la cuota de CoinGecko no se justifica para un benchmark que no se usa.

import { describe, it, expect } from 'vitest'
import { BENCHMARK_PRESETS, benchmarkPreset, benchmarkRefsToRefresh } from './benchmarks'
import { quoteSourceFor } from '@/lib/market-data/resolver'

describe('benchmarkRefsToRefresh', () => {
  it('incluye los índices tradicionales: SPY y Nasdaq 100', () => {
    const tickers = benchmarkRefsToRefresh([]).map((r) => r.ticker)
    expect(tickers).toContain('SPY')
    expect(tickers).toContain('QQQ')
  })

  it('NO incluye BTC: su cuota de CoinGecko no se justifica', () => {
    // Decisión deliberada, no un descuido. Si alguien "normaliza" el filtro a
    // todos los presets, este test falla y obliga a justificar el gasto.
    expect(benchmarkRefsToRefresh([]).map((r) => r.ticker)).not.toContain('BTC')
  })

  it('BTC sigue siendo un benchmark seleccionable en la UI', () => {
    // No refrescarlo automáticamente no es lo mismo que quitarlo: si el usuario
    // lo elige, `/api/analytics` lo descarga bajo demanda como siempre.
    expect(benchmarkPreset('BTC')).toBeDefined()
  })

  it('excluye un benchmark que el usuario ya tiene como activo propio', () => {
    // Si posees SPY, ya viene en `assets` y el refresh lo va a pedir igual.
    // Inyectarlo duplicaría la llamada a Yahoo para el mismo ticker.
    const tickers = benchmarkRefsToRefresh(['TXN', 'SPY']).map((r) => r.ticker)
    expect(tickers).not.toContain('SPY')
    expect(tickers).toContain('QQQ')
  })

  it('la deduplicación no depende de mayúsculas', () => {
    expect(benchmarkRefsToRefresh(['spy']).map((r) => r.ticker)).not.toContain('SPY')
  })

  it('los refs se enrutan a Yahoo, que es lo que los hace descargables', () => {
    // El `asset_type` no es decorativo: `refreshQuotes` agrupa por
    // `quoteSourceFor(asset_type)`. Un tipo mal puesto haría que el ticker se
    // inyecte y nunca se pida.
    for (const ref of benchmarkRefsToRefresh([])) {
      expect(quoteSourceFor(ref.asset_type)).toBe('yahoo')
    }
  })

  it('todo preset declara explícitamente si se auto-refresca', () => {
    for (const p of BENCHMARK_PRESETS) expect(typeof p.autoRefresh).toBe('boolean')
  })
})
