// The shape of one ambient moment: a single line of local colour for a place, such as a danfo conductor shouting or the call to
// prayer. A moment never changes game state; it is wording, plus an optional presentation hint that the sound and light lanes can read.
import type { SceneKind } from '../types/content.ts'
import type { TimeBand } from '../game/world-time.ts'

/** What language the line is in. Omitted is English or Nigerian Pidgin. Every other language is unreviewed, so the line must be `beta`. */
export type MomentLang = 'en' | 'pcm' | 'ha' | 'yo' | 'ig' | 'efi'
/** Languages that wait for a native speaker's review (docs/REALISM.md, design rule 3). */
export const BETA_LANGS: readonly MomentLang[] = Object.freeze(['ha', 'yo', 'ig', 'efi'] as const)

/** A hint for presentation (a light flicker, a sound cue, a haze), never for rules. Nothing reads it yet. */
export type MomentFx = 'power-on' | 'power-off' | 'dust' | 'rain' | 'crowd' | 'music' | 'prayer' | 'horn' | 'hush' | 'laugh'

/**
 * A named condition of the city at this moment ('power-cut', 'power-restored', 'rain', 'go-slow', 'match-night'). A moment with `cond`
 * is only eligible when the caller says the condition is active (PickOptions.conditions); the city-conditions lane (REALISM.md, feature 8) supplies them.
 */
export type MomentCondition = 'power-cut' | 'power-restored' | 'rain' | 'go-slow' | 'match-night'

export interface Moment {
  /** Stable and unique, `scope-number`. Append new lines to the end of a bank; never reorder or reuse a number. */
  id: string
  /** One line, short enough for the venue card's single ambient line. */
  text: string
  /** Scene kinds it fits (venue.scene.kind). Omitted = any kind. Together with `cityIds`, both must match. */
  placeKinds?: readonly SceneKind[]
  /** Cities it belongs to (city catalogue ids). Omitted = every city. */
  cityIds?: readonly string[]
  /** Scene variants it fits (worship: 'church' | 'mosque'). Omitted = any variant of the kind. */
  variants?: readonly string[]
  /** Parts of the Lagos day it fits. Omitted = all day. */
  bands?: readonly TimeBand[]
  /** Season it needs, from citySeason: `wet: true` only in the rainy season, `harmattan: true` only in harmattan months. */
  season?: { wet?: boolean; harmattan?: boolean }
  cond?: MomentCondition
  /** How early in its cycle a line tends to come: a weight of 3 usually plays before a weight of 1. Never zero. */
  weight: number
  lang?: MomentLang
  /** Unreviewed local language or local detail. Always true for a Hausa, Yoruba, Igbo or Efik line. */
  beta?: boolean
  fx?: MomentFx
}
