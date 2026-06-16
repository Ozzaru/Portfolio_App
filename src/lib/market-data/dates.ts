export function unixToISODate(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

export function msToISODate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function isoYearsAgo(years: number, base: Date = new Date()): string {
  const d = new Date(base)
  d.setUTCFullYear(d.getUTCFullYear() - years)
  return d.toISOString().slice(0, 10)
}
