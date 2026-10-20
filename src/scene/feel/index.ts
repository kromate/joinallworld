/**
 * OWNER: scenes
 * FEEL: one call for the moment a reward lands. feel('goal-done') plays the tier's sound (when given a way to), throws its confetti, pops the chip you
 * hand it and (large tier only) tells the scene host to nudge its camera, all together. Routine actions never call this.
 *
 * Kept out of the first download: only src/scene/reward.ts (a lazy chunk of the scene host) imports it.
 * Reduced motion, or the "Reduce shake and flashes" choice (src/scene/first-person/preferences.ts), means no shake and shorter pops.
 * Hit-stop is not fired from here: the arena fight owns its clock (./hitstop.ts) and asks feelFor('fight-hit') for the time.
 */
import { confetti } from './burst.ts'
import { popElement } from './pop.ts'
import { shakeReduced } from './reduce.ts'
import { SHAKE_EVENT } from './shake.ts'
import { TIERS, createTierGate, feelFor } from './tiers.ts'
import type { Feel, FeelEvent } from './tiers.ts'

export { feelFor } from './tiers.ts'
export { shakeReduced } from './reduce.ts'
export type { FeelEvent } from './tiers.ts'

export interface FeelOptions {
  /** Where the confetti flies from (viewport px); under the top bar by default. */
  at?: { x: number; y: number }
  /** Where the confetti goes in the page (the body by default). */
  parent?: Element | null | undefined
  /** A chip, a coin or a purse to pop. */
  pop?: Element | null | undefined
  /** How to play the tier's sound (pass `play` from src/audio/play.ts). Left out when the moment already has its own sound (a finished goal, money). It is a parameter, not an import, so this chunk does not pull the audio hook out of the first download's chunk. */
  sound?: (name: string) => void
  /** False to leave the confetti out (a pay chip on its own). Default true. */
  burst?: boolean
}

const gate = createTierGate()

/** Fire a moment's feel. Returns what it was played as (a second large moment within 2 s is played as medium). */
export function feel(event: FeelEvent, options: FeelOptions = {}): Feel {
  const asked = feelFor(event)
  const tier = gate(asked.tier, globalThis.performance?.now() ?? Date.now())
  const spec: Feel = { ...asked, ...TIERS[tier], tier }
  const reduced = shakeReduced()
  options.sound?.(spec.sound)
  if (options.burst !== false) confetti(options.parent ?? globalThis.document?.body, spec.burst, options.at)
  if (options.pop) popElement(options.pop, spec.pop, reduced)
  if (!reduced && spec.trauma > 0) globalThis.window?.dispatchEvent(new CustomEvent(SHAKE_EVENT, { detail: { trauma: spec.trauma } }))
  return spec
}
