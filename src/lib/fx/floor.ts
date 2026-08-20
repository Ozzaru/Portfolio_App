// src/lib/fx/floor.ts

// Fecha desde la que hay que cargar la serie de tipo de cambio.
//
// `convertSeries` DESCARTA todo punto para el que no encuentra FX (su Regla 3:
// dejarlo pasar sin convertir inyectaría un error de ~950x en un gráfico
// normalizado). Eso convierte el rango del FX en una precondición: si la serie
// FX empieza después del punto más antiguo que debe convertir, ese punto
// desaparece en silencio — y si era el único, la serie entera queda vacía.
//
// El piso NO puede ser la primera transacción a secas. El cost basis sí necesita
// FX desde esa fecha, pero las series de precios traen una SEMILLA anterior a la
// ventana del período (migración 0005) que no tiene cota inferior: un benchmark
// desactualizado puede aportar una semilla de meses atrás. Ese caso hizo
// desaparecer la línea del benchmark; ver floor.test.ts.
//
// La fecha correcta está disponible sin consultas extra: es el mínimo
// `price_date` de las filas que ya devolvió `prices_windowed`.
export function fxFloor(firstTxDate: string, priceDates: Iterable<string>): string {
  let floor = firstTxDate
  for (const d of priceDates) if (d < floor) floor = d
  return floor
}
