// Regulars talking to each other (REALISM R12). One exchange is two short lines: one regular says something, the other answers.
// Wording only: an exchange never changes game state, and nothing here is a real person or business. Pure (no DOM, no network).
import type { SceneKind } from '../../types/content.ts'
import type { TimeBand } from '../world-time.ts'

/** The language of an exchange. English is the default; every other one, Nigerian Pidgin included, waits for a native speaker's review. */
export type ChatterLang = 'en' | 'pcm' | 'ha' | 'yo' | 'ig' | 'efi'
/** Languages whose lines are marked beta (docs/REALISM.md, design rule 3). */
export const BETA_CHATTER_LANGS: readonly ChatterLang[] = Object.freeze(['pcm', 'ha', 'yo', 'ig', 'efi'] as const)

export interface Exchange {
  /** Stable and unique, `scope-number`. Append to the end of a bank; never reorder or reuse a number. */
  id: string
  /** [what the first regular says, what the second answers]. */
  lines: readonly [string, string]
  /** Scene kinds it fits. Omitted = any kind. */
  placeKinds?: readonly SceneKind[]
  /** Cities it belongs to (city catalogue ids). Omitted = every city. */
  cityIds?: readonly string[]
  /** Parts of the Lagos day it fits. Omitted = all day. */
  bands?: readonly TimeBand[]
  /** How early in its cycle it tends to come (a line for this kind of place outweighs one for anywhere). */
  weight: number
  lang: ChatterLang
  /** Unreviewed wording. Always true for a line in a language other than English. */
  beta: boolean
}

/** The little of a regular the picker needs. */
export interface Regular { id: string; name: string }

/** Where the talk happens: the venue's scene kind. */
export interface ChatterPlace { kind: string }

export interface ChatterContext {
  cityId: string
  /** The venue id (state.location). */
  venueId: string
  place: ChatterPlace
  /** The regulars standing in the scene right now. Fewer than two means nobody talks. */
  regulars: readonly Regular[]
}

export interface Spoken { npcId: string; name: string; text: string }

/** One exchange that is due: who says what, and when it starts (epoch ms). */
export interface Chosen {
  slot: number
  startsAt: number
  exchangeId: string
  beta: boolean
  first: Spoken
  second: Spoken
}
