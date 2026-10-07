// The generator in a player's room: how much petrol it holds, what petrol costs and how long a litre runs it. Plain numbers, no clock and no state:
// the home system (src/game/systems/home.ts) settles the fuel against the outages of ./conditions.ts. Every value is an original beta value.

/** Naira for a litre of petrol, delivered. */
export const LITRE_PRICE = 900
/** How long a litre runs the small generator, in seconds (40 minutes). */
export const LITRE_SECONDS = 2400
/** What the tank holds, in litres, and in seconds of running. */
export const TANK_LITRES = 20
export const TANK_SECONDS = TANK_LITRES * LITRE_SECONDS

/** What lights the room: the grid when it is on, else the inverter, else a generator with petrol in it, else nothing. */
export type PowerSource = 'grid' | 'inverter' | 'generator' | 'none'

/** Seconds of running left, read as litres to one decimal. */
export const litresOf = (seconds: number): number => Math.round((seconds / LITRE_SECONDS) * 10) / 10
