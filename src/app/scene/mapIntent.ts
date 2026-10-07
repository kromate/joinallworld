const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
/** Two bounded intents: merged map controls and the most recent explicit atlas aim. */
export function createMapIntent() {
  const ui: Record<string, unknown> = {}
  let world: Record<string, unknown> | null = null
  return {
    take(value: unknown): void {
      if (!record(value)) return
      if (value.layer === 'world' && (typeof value.level === 'number' || typeof value.city === 'string')) {
        world = { ...value }
        for (const key of ['level', 'city', 'friends']) delete ui[key]
      }
      Object.assign(ui, value)
    },
    snapshot() { return { ui: { ...ui }, world: world ? { ...world } : null } },
  }
}
export const mapWanted = (wanted: boolean, mode: string): boolean => wanted || mode === 'map'
