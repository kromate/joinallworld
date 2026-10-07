// Authoring helper for the moment banks. A bank is a list of lines that share a scope: a line is a bare string or [text, what is
// different about it]. The helper numbers them (`scope-1`, `scope-2`, … in order: append, never reorder), applies the shared
// conditions, and marks every Hausa, Yoruba, Igbo or Efik line beta.
import { BETA_LANGS } from './types.ts'
import type { Moment } from './types.ts'
import type { SceneKind } from '../types/content.ts'

type Extra = Partial<Omit<Moment, 'id' | 'text'>>
export type Entry = string | readonly [text: string, extra: Extra]

/** @param scope the id prefix, unique across all banks @param base what every line of the bank shares (place kinds, cities, weight) */
export function bank(scope: string, base: Extra, entries: readonly Entry[]): Moment[] {
  return entries.map((entry, index) => {
    const [text, extra] = typeof entry === 'string' ? [entry, {}] as const : entry
    const merged: Extra = { weight: 1, ...base, ...extra }
    const local = merged.lang !== undefined && BETA_LANGS.includes(merged.lang)
    return { ...merged, weight: merged.weight ?? 1, ...(local ? { beta: true } : {}), id: `${scope}-${index + 1}`, text }
  })
}

/** The shared part of a bank for one place kind: its kind, and a weight that lets it come before the all-places lines. */
export const here = (kind: SceneKind): { weight: number; placeKinds: SceneKind[] } => ({ weight: 2, placeKinds: [kind] })

/** Day parts, as shorthand for `bands`. */
export const DAWN = Object.freeze({ bands: ['dawn'] } as const)
export const MORNING = Object.freeze({ bands: ['morning'] } as const)
export const DAYTIME = Object.freeze({ bands: ['morning', 'afternoon'] } as const)
export const AFTERNOON = Object.freeze({ bands: ['afternoon'] } as const)
export const EVENING = Object.freeze({ bands: ['evening'] } as const)
export const NIGHT = Object.freeze({ bands: ['night'] } as const)
export const LATE = Object.freeze({ bands: ['evening', 'night'] } as const)
