// The landing screen's decisions without a DOM: when a life is held for its look, what the screen
// says about the connection, and what a tap on Play does with the name and character on screen.
// (The name suggestions, the presets and the look rules are src/quick-start/look-model.ts, reached
// through startBoundary.ts; the server decides everything that counts.)
import type { Look } from '../../../types/life.ts'
import type { PanelView } from '../../types/panel.ts'
import { PRESETS, nameProblem, starterLook } from './startBoundary.ts'

export const LOOK_REFUSED = 'That character could not be used. Here is another — tap Play again.'
export { PLAY_HELD, held, quickStartRequired } from './startGate.ts'

/** The sentence under the lead: the server's refusal wins over the sheet's own error. */
export const shownError = (own: string, problem: { reason?: string } | null | undefined): string => own || problem?.reason || ''
/** The connection note shows only when there is nothing more important to say and the link is not simply new or still connecting. */
export const showsLinkNote = (words: object | null, error: string, link: string): boolean => Boolean(words) && !error && link !== 'new' && link !== 'connecting'

/** The problem the sheet was reopened with (the server's sentence and the name that was refused). */
export function problemOf(params: unknown): { reason?: string; name?: string } | null {
  const problem = params && typeof params === 'object' ? (params as { problem?: unknown }).problem : null
  if (!problem || typeof problem !== 'object') return null
  const { reason, name } = problem as { reason?: unknown; name?: unknown }
  return { ...(typeof reason === 'string' ? { reason } : {}), ...(typeof name === 'string' ? { name } : {}) }
}

export type PlayPlan =
  | { kind: 'name'; error: string }
  | { kind: 'look'; error: string }
  | { kind: 'go'; name: string; look: Look }
/** What tapping Play does: the name is checked first, then that the character is one a new Sim may wear. */
export function planPlay(typed: string, draftLook: Look): PlayPlan {
  const name = typed.trim()
  const wrong = nameProblem(name)
  if (wrong) return { kind: 'name', error: wrong }
  const look = starterLook(draftLook)
  if (!look) return { kind: 'look', error: LOOK_REFUSED }
  return { kind: 'go', name, look }
}
/** The first preset: the character offered instead of one that could not be used. */
export const fallbackPreset = (): { id: string } => PRESETS[0] ?? { id: '' }

/**
 * The name to put in the draft when the sheet is reopened with a refusal: the name that was refused, once, so the
 * player can correct it. null = nothing to do. After that the field shows the draft, so Shuffle, the dice and the
 * presets change what is on screen.
 */
export const refusedNameToKeep = (problem: { name?: string } | null | undefined, draftName: string): string | null => (problem?.name && problem.name !== draftName ? problem.name : null)
