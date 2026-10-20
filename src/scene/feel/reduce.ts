/**
 * OWNER: scenes
 * Whether shake and flashes are off right now: the player's "Reduce shake and flashes" choice, else the system's reduced-motion
 * setting. Small on purpose: the arena fight reads it without pulling in the rest of feel.
 */
import { readViewPreferences } from '../first-person/preferences.ts'
import type { ViewPreferences } from '../first-person/preferences.ts'

/** Whether shake and flashes are off: the player's own choice, else the system's reduced-motion setting. */
export const reduceShakeOn = (preferences: Pick<ViewPreferences, 'reduceShake'>, systemReduced: boolean): boolean => preferences.reduceShake ?? systemReduced

export function shakeReduced(): boolean {
  let system = false
  try { system = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true } catch { /* no media queries: not reduced */ }
  try { return reduceShakeOn(readViewPreferences(), system) } catch { return system }
}
