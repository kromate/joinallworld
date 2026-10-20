/**
 * OWNER: scenes
 * A page address can force the rain for the evidence harness and for looking: `?wet=1` makes every scene wet, `?wet=0` makes it dry. Anything
 * else (or no address) leaves the city's own weather alone. Read-only: it changes nothing but the `wet` flag a scene has just worked out, and
 * nothing is stored or sent. Tiny and static on purpose: the scene hosts need the answer before they decide to fetch the weather chunk
 * (src/scene/fx/weather.ts re-exports it).
 */
export function wetFromQuery(search: string | undefined = (globalThis as { location?: { search?: string } }).location?.search): boolean | null {
  const match = /[?&]wet=([01])(?:&|$)/.exec(search ?? '')
  return match ? match[1] === '1' : null
}

/** The conditions with `wet` forced by the address, if it says so; the same object when it does not. */
export function withWetQuery<T extends { wet: boolean }>(look: T, search?: string): T {
  const forced = wetFromQuery(search)
  return forced === null || forced === look.wet ? look : { ...look, wet: forced }
}

/** `?outage=1` makes the district's power cut (lamps, windows and signs dark), `?outage=0` keeps the lights on; anything else leaves the grid alone. For the evidence harness and for looking. */
export function outageFromQuery(search: string | undefined = (globalThis as { location?: { search?: string } }).location?.search): boolean | null {
  const match = /[?&]outage=([01])(?:&|$)/.exec(search ?? '')
  return match ? match[1] === '1' : null
}

/** The conditions with `outage` forced by the address, if it says so; the same object when it does not. */
export function withOutageQuery<T extends { outage: boolean }>(look: T, search?: string): T {
  const forced = outageFromQuery(search)
  return forced === null || forced === look.outage ? look : { ...look, outage: forced }
}
