const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The saved character's city wins over the older storage key after a trip. */
export function initialCity(raw: string | null, known: (id: unknown) => boolean): string {
  if (!raw) return 'lagos'
  try {
    const saved: unknown = JSON.parse(raw)
    if (!record(saved)) return 'lagos'
    const estate = record(saved.state) && record(saved.state.estate) ? saved.state.estate : null
    for (const value of [estate?.city, saved.cityId]) {
      if (typeof value === 'string' && known(value)) return value
    }
  } catch { /* An unreadable browser cache does not replace the server's saved life. */ }
  return 'lagos'
}
