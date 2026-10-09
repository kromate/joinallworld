import type { JusticePracticeView } from '../../../game/living-world/justice-practice.ts'
import { JUSTICE_PRACTICE_MAX_RECEIPTS } from '../../../game/living-world/justice-practice.ts'
import type { ApiEnvelope } from '../../../types/protocol.ts'
import type { JusticePracticeResponse } from '../../../types/living-world-justice.ts'

export type JusticeReply = JusticePracticeResponse & ApiEnvelope
type Phase = JusticePracticeView['phase']
const phases: readonly Phase[] = ['inspect-initial', 'initial-decision', 'serve-notice', 'inspect-review', 'review-decision', 'complete']
const evidenceOrder = ['dispatch-copy', 'arrival-receipt', 'seal-log', 'npc-recount'] as const
const initialChoices = ['pause-and-reconcile', 'accept-receipt', 'assign-responsibility'] as const
const reviewChoices = ['correct-duplicate-entry', 'keep-hold', 'assign-responsibility'] as const

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  try { const own = Reflect.ownKeys(value); return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key)) }
  catch { return false }
}
const safeInt = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const safeText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max

function readView(value: unknown): JusticePracticeView | null | undefined {
  if (value === null) return null
  if (!record(value) || !exact(value, ['caseId', 'title', 'disclaimer', 'summary', 'phase', 'revision', 'prompt', 'evidence', 'reviewedEvidenceIds', 'initialChoices', 'reviewChoices', 'serviceNotice', 'npcReviewRequest', 'trainingComplete'])
    || value.caseId !== 'fictional-shipment-review-01' || !safeText(value.title, 120) || !safeText(value.disclaimer, 240)
    || !safeText(value.summary, 500) || typeof value.phase !== 'string' || !phases.includes(value.phase as Phase)
    || !safeInt(value.revision) || !safeText(value.prompt, 300) || !Array.isArray(value.evidence) || value.evidence.length > 4
    || !Array.isArray(value.reviewedEvidenceIds) || value.reviewedEvidenceIds.length > 4
    || !Array.isArray(value.initialChoices) || value.initialChoices.length > 3 || !Array.isArray(value.reviewChoices) || value.reviewChoices.length > 3
    || !(value.serviceNotice === null || safeText(value.serviceNotice, 400))
    || !(value.npcReviewRequest === null || safeText(value.npcReviewRequest, 400)) || typeof value.trainingComplete !== 'boolean') return undefined

  const phase = value.phase as Phase
  const expectedEvidence = phase === 'inspect-review' || phase === 'review-decision' || phase === 'complete' ? evidenceOrder : evidenceOrder.slice(0, 3)
  const evidence: JusticePracticeView['evidence'][number][] = []
  for (let index = 0; index < value.evidence.length; index++) {
    const item = value.evidence[index]
    if (!record(item) || !exact(item, ['id', 'label', 'text']) || item.id !== expectedEvidence[index]
      || !safeText(item.label, 100) || !safeText(item.text, 500)) return undefined
    evidence.push({ id: item.id as typeof evidenceOrder[number], label: item.label, text: item.text })
  }
  if (evidence.length !== expectedEvidence.length) return undefined
  const reviewed: JusticePracticeView['reviewedEvidenceIds'][number][] = []
  for (const id of value.reviewedEvidenceIds) {
    if (typeof id !== 'string' || !expectedEvidence.includes(id as typeof evidenceOrder[number]) || reviewed.includes(id as typeof evidenceOrder[number])) return undefined
    reviewed.push(id as typeof evidenceOrder[number])
  }
  const reviewedCount = phase === 'initial-decision' || phase === 'serve-notice' || phase === 'inspect-review' ? 3
    : phase === 'review-decision' || phase === 'complete' ? 4 : null
  if ((reviewedCount !== null && reviewed.length !== reviewedCount)
    || (phase === 'inspect-initial' && (reviewed.length > 2 || reviewed.includes('npc-recount')))) return undefined
  const phaseActions: Record<Phase, number> = {
    'inspect-initial': 0, 'initial-decision': 0, 'serve-notice': 1, 'inspect-review': 2, 'review-decision': 2, complete: 3,
  }
  if (value.revision < reviewed.length + phaseActions[phase] || value.revision > JUSTICE_PRACTICE_MAX_RECEIPTS) return undefined

  const expectedInitial = phase === 'initial-decision' ? initialChoices : []
  const expectedReview = phase === 'review-decision' ? reviewChoices : []
  const readChoices = (raw: unknown[], expected: readonly string[]): { id: string; label: string }[] | null => {
    const choices: { id: string; label: string }[] = []
    if (raw.length !== expected.length) return null
    for (let index = 0; index < raw.length; index++) {
      const item = raw[index]
      if (!record(item) || !exact(item, ['id', 'label']) || item.id !== expected[index] || !safeText(item.label, 160)) return null
      choices.push({ id: item.id, label: item.label })
    }
    return choices
  }
  const initial = readChoices(value.initialChoices, expectedInitial), review = readChoices(value.reviewChoices, expectedReview)
  const noticeExpected = phase === 'serve-notice' || phase === 'inspect-review' || phase === 'review-decision' || phase === 'complete'
  const reviewExpected = phase === 'inspect-review' || phase === 'review-decision' || phase === 'complete'
  if (!initial || !review || (value.serviceNotice !== null) !== noticeExpected || (value.npcReviewRequest !== null) !== reviewExpected
    || value.trainingComplete !== (phase === 'complete')) return undefined
  return { caseId: 'fictional-shipment-review-01', title: value.title, disclaimer: value.disclaimer, summary: value.summary,
    phase, revision: value.revision, prompt: value.prompt, evidence, reviewedEvidenceIds: reviewed, initialChoices: initial as JusticePracticeView['initialChoices'],
    reviewChoices: review as JusticePracticeView['reviewChoices'], serviceNotice: value.serviceNotice, npcReviewRequest: value.npcReviewRequest,
    trainingComplete: value.trainingComplete }
}

/** Strict reader for the public domain projection plus the real HTTP envelope. */
export function readJusticeReply(value: unknown): JusticeReply | null {
  if (!record(value)) return null
  const required = ['serverTime', 'ok', 'code', 'practice', 'revision']
  const allowed = [...required, 'storage', 'feedback', 'duplicate']
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key))
    || required.some(key => !Object.prototype.hasOwnProperty.call(value, key)) || !safeInt(value.serverTime)
    || Object.hasOwn(value, 'storage') && value.storage !== 'failing' || value.storage === 'failing'
    || typeof value.ok !== 'boolean' || !safeText(value.code, 100) || !/^[a-z][a-z0-9_]{0,99}$/.test(value.code)
    || value.feedback !== undefined && !safeText(value.feedback, 500)
    || value.duplicate !== undefined && value.duplicate !== true) return null
  const practice = readView(value.practice)
  if (practice === undefined || (practice === null ? value.revision !== null
    : !safeInt(value.revision) || value.revision !== practice.revision)) return null
  return { serverTime: value.serverTime, ok: value.ok, code: value.code,
    ...(typeof value.feedback === 'string' ? { feedback: value.feedback } : {}),
    ...(value.duplicate === true ? { duplicate: true as const } : {}), practice, revision: value.revision as number | null }
}
