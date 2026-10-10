/**
 * Test support for the Justice practice save-compatibility checks. It builds the practice rows that the earlier
 * transition wrote: the inspected-evidence list in the order the learner opened the records, not in authored order.
 * Everything else in those rows (receipts, revisions, decisions) is exactly what the current reducer writes.
 */
import { applyJusticePractice, createJusticePractice } from '../../src/game/living-world/justice-practice.ts'
import type { JusticeEvidenceId, JusticePracticeAction, JusticePracticeState } from '../../src/game/living-world/justice-practice.ts'

const AUTHORED: readonly JusticeEvidenceId[] = ['dispatch-copy', 'arrival-receipt', 'seal-log', 'npc-recount']
export type InitialEvidenceId = 'dispatch-copy' | 'arrival-receipt' | 'seal-log'

/** Every order in which the three initial records can be opened. */
export const INITIAL_ORDERS: readonly (readonly InitialEvidenceId[])[] = (() => {
  const ids: InitialEvidenceId[] = ['dispatch-copy', 'arrival-receipt', 'seal-log']
  const out: InitialEvidenceId[][] = []
  for (const a of ids) for (const b of ids) for (const c of ids) if (new Set([a, b, c]).size === 3) out.push([a, b, c])
  return out
})()

/** The full authored journey for one opening order, as the actions a learner sends. */
export function journey(order: readonly InitialEvidenceId[]): JusticePracticeAction[] {
  return [
    ...order.map((evidenceId): JusticePracticeAction => ({ kind: 'inspect', evidenceId })),
    { kind: 'initial-decision', choiceId: 'pause-and-reconcile', reasonEvidenceIds: ['dispatch-copy', 'arrival-receipt'] },
    { kind: 'send-service-notice' },
    { kind: 'inspect-review' },
    { kind: 'review-decision', choiceId: 'correct-duplicate-entry', reasonEvidenceIds: ['dispatch-copy', 'npc-recount'] },
  ]
}

/**
 * The states the earlier code could have saved along the journey (index 0 is the fresh practice), written in its shape:
 * inspected evidence in opening order. The earlier reader refused any saved list that was out of authored order, so the
 * first such state is the last one that was ever written; the list stops there.
 */
export function legacyStates(order: readonly InitialEvidenceId[]): JusticePracticeState[] {
  const opened: readonly JusticeEvidenceId[] = [...order, 'npc-recount']
  const out: JusticePracticeState[] = [createJusticePractice()]
  let state = createJusticePractice(), stuck = false
  journey(order).forEach((action, index) => {
    const result = applyJusticePractice(state, { requestId: `legacy-${index}`, expectedRevision: state.revision, action })
    if (result.outcome.code !== 'advanced' && result.outcome.code !== 'complete') throw new Error(`step ${index} did not advance`)
    state = result.state
    if (stuck) return
    const list = opened.filter(id => state.inspectedEvidenceIds.includes(id))
    out.push({ ...state, inspectedEvidenceIds: list })
    stuck = list.some((id, i) => i > 0 && AUTHORED.indexOf(id) < AUTHORED.indexOf(list[i - 1]!))
  })
  return out
}
