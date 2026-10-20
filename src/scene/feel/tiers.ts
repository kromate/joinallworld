/**
 * OWNER: scenes
 * HOW BIG A MOMENT FEELS. Three tiers, and a table that says which game moment is which. Pure data and arithmetic, no browser,
 * so it runs under `node --test`.
 *
 *   small   a tick: a soft sound and a small pop. Never shakes.
 *   medium  a good moment: a brighter sound, a few pieces of confetti, a full pop. Never shakes either.
 *   large   a big moment: the fanfare, a full burst, a full pop and one nudge of the camera.
 *
 * Only the large tier moves the camera (the owner's rule: nothing shakes on a routine action). A large moment that comes less than
 * LARGE_GAP_MS after the last one is played as medium, so two goals in a row never shake twice in a breath.
 * Walking, tapping and other routine actions are not in the table on purpose: they get no feel at all.
 */

export type FeelTier = 'small' | 'medium' | 'large'
export type FeelEvent = 'goal-done' | 'pay-received' | 'level-up' | 'fight-hit' | 'football-goal' | 'danfo-stop' | 'election-won'

export interface TierSpec {
  /** A sound name for src/audio/play.ts (see EVENTS in src/audio/data.ts). */
  sound: string
  /** Pieces of confetti (0 = none). */
  burst: number
  /** How hard a chip or a coin pops, 0..1 (see ./pop.ts). */
  pop: number
  /** Trauma added to the camera shake, 0..1 (see ./shake.ts). */
  trauma: number
}

export const TIERS: Readonly<Record<FeelTier, Readonly<TierSpec>>> = Object.freeze({
  small: Object.freeze({ sound: 'toast', burst: 0, pop: 0.5, trauma: 0 }),
  medium: Object.freeze({ sound: 'success', burst: 10, pop: 0.8, trauma: 0 }),
  large: Object.freeze({ sound: 'goal', burst: 22, pop: 1, trauma: 0.6 }),
})

/** Which tier each moment is, and how long it freezes the picture (only a fight hit does). */
export const EVENT_TIERS: Readonly<Record<FeelEvent, Readonly<{ tier: FeelTier; hitStopMs: number }>>> = Object.freeze({
  'goal-done': Object.freeze({ tier: 'large', hitStopMs: 0 }),
  'pay-received': Object.freeze({ tier: 'medium', hitStopMs: 0 }),
  'level-up': Object.freeze({ tier: 'large', hitStopMs: 0 }),
  'fight-hit': Object.freeze({ tier: 'medium', hitStopMs: 70 }),
  'football-goal': Object.freeze({ tier: 'large', hitStopMs: 0 }),
  'danfo-stop': Object.freeze({ tier: 'small', hitStopMs: 0 }),
  'election-won': Object.freeze({ tier: 'large', hitStopMs: 0 }),
})

export interface Feel extends TierSpec { event: FeelEvent; tier: FeelTier; hitStopMs: number }

/** What a game moment feels like. */
export function feelFor(event: FeelEvent): Feel {
  const row = EVENT_TIERS[event]
  return { event, tier: row.tier, hitStopMs: row.hitStopMs, ...TIERS[row.tier] }
}

/** A large moment this soon after the last large one is played as medium. */
export const LARGE_GAP_MS = 2000

/** The tier actually played: remembers when the last large one was. `now` is any steadily rising clock, in ms. */
export function createTierGate(gapMs = LARGE_GAP_MS): (tier: FeelTier, now: number) => FeelTier {
  let lastLarge = -Infinity
  return (tier, now) => {
    if (tier !== 'large') return tier
    if (now - lastLarge < gapMs) return 'medium'
    lastLarge = now
    return 'large'
  }
}

/** How long a fight hit freezes the picture: a blocked hit not at all, a normal hit the table's 70 ms, a strong hit 90 ms. */
export const HIT_STOP_STRONG_MS = 90
export function fightHitStopMs(strong: boolean, blocked: boolean): number {
  if (blocked) return 0
  const base = EVENT_TIERS['fight-hit'].hitStopMs
  return strong ? Math.max(base, HIT_STOP_STRONG_MS) : base
}
