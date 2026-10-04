// What the goal chip (HUD) says and does, worked out from view.goals. Pure, so it is tested
// without a browser. All rules live in src/game/systems/goals.js.
import type { GoalChip, GoalsView } from '../../../types/view.ts'

/** What tapping the chip does: open a panel, walk somewhere, or (a guide with neither) open the community. */
export type ChipAction =
  | { kind: 'open'; id: string; params?: Record<string, unknown> }
  | { kind: 'go'; venue: string; spot?: string }
  | { kind: 'community' }

export function chipAction(step: GoalChip): ChipAction {
  if (step.kind === 'create') return { kind: 'open', id: step.open }
  if (step.open) return { kind: 'open', id: step.open, ...(step.kind === 'goal' && step.params ? { params: step.params } : {}) }
  if (step.go) return { kind: 'go', venue: step.go[0], ...(step.go[1] ? { spot: step.go[1] } : {}) }
  return { kind: 'community' }
}

/** The chip's text alternative. */
export const chipLabel = (step: Pick<GoalChip, 'kind' | 'title' | 'hint'>): string => `${step.kind === 'goal' ? 'Current goal' : 'Next step'}: ${step.title}. ${step.hint}`

/** The Lagos day number of a server time. */
export const lagosDay = (ms: number): number => Math.floor((ms + 3600000) / 86400000)

/** The feed entries newer than the last one seen: each is toasted once. */
export const newFeed = (feed: GoalsView['feed'], lastSeq: number | null): GoalsView['feed'] => feed.filter((item) => lastSeq !== null && item.n > lastSeq)

/** The sequence to remember: the first connected look, or a different life (a lower number), starts from the current one. */
export const rememberSeq = (seq: number, lastSeq: number | null): number | null => (lastSeq === null || seq < lastSeq ? seq : lastSeq)
