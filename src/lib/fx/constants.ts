// src/lib/fx/constants.ts

// Moneda base de toda la valorización. Constante deliberada, no setting:
// ver Decisión 3 del spec (YAGNI — cartera personal radicada en Chile).
export const BASE_CURRENCY = 'CLP'

// Símbolo canónico del tipo de cambio en Yahoo, cacheado en `price_cache`
// como un ticker más. Su valor son CLP por 1 USD (≈ 950) — Decisión 5.
export const FX_TICKER = 'USDCLP=X'

// IVA chileno sobre la comisión de corretaje. Solo alimenta el autocálculo
// del formulario; el valor guardado es siempre el que el usuario confirma.
export const IVA_RATE = 0.19
