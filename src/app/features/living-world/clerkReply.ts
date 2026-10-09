import type { ClerkPracticeStep, ClerkPracticeView } from '../../../game/living-world/clerk.ts'
import type { ApiEnvelope } from '../../../types/protocol.ts'
import type { ClerkResponse as ClerkResponseBody } from '../../../types/living-world-clerk.ts'

export type ClerkReply = ClerkResponseBody & ApiEnvelope
type Evidence = ClerkPracticeView['evidence'][number]
type Choice = ClerkPracticeView['choices'][number]
type Result = NonNullable<ClerkPracticeView['result']>

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  try { const own = Reflect.ownKeys(value); return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key)) }
  catch { return false }
}
const safeString = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max
const safeRevision = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const stepOrder: readonly ClerkPracticeStep[] = ['inspect_receipt', 'inspect_dispatch', 'compare_discrepancy', 'choose_outcome', 'complete']

function readPractice(value: unknown): ClerkPracticeView | null | undefined {
  if (value === null) return null
  if (!isObject(value) || !exact(value, ['scenarioVersion', 'title', 'narrative', 'step', 'prompt', 'evidence', 'choices', 'result'])
    || value.scenarioVersion !== 1 || !safeString(value.title, 120) || !safeString(value.narrative, 700)
    || !stepOrder.includes(value.step as ClerkPracticeStep) || !safeString(value.prompt, 240)
    || !Array.isArray(value.evidence) || value.evidence.length > 4 || !Array.isArray(value.choices) || value.choices.length > 5) return undefined
  const evidence: Evidence[] = [], evidenceIds = new Set<string>()
  for (const item of value.evidence) {
    if (!isObject(item) || !exact(item, ['id', 'label', 'text']) || !safeString(item.id, 80)
      || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,79}$/.test(item.id) || evidenceIds.has(item.id)
      || !safeString(item.label, 120) || !safeString(item.text, 500)) return undefined
    evidenceIds.add(item.id)
    evidence.push({ id: item.id, label: item.label, text: item.text })
  }
  const choices: Choice[] = [], choiceIds = new Set<string>()
  for (const item of value.choices) {
    if (!isObject(item) || !exact(item, ['id', 'label']) || !safeString(item.id, 80)
      || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,79}$/.test(item.id) || choiceIds.has(item.id)
      || !safeString(item.label, 200)) return undefined
    choiceIds.add(item.id); choices.push({ id: item.id, label: item.label })
  }
  let result: Result | null = null
  if (value.result !== null) {
    if (!isObject(value.result) || !exact(value.result, ['finding', 'outcome', 'explanation'])
      || !safeString(value.result.finding, 240) || !safeString(value.result.outcome, 240)
      || !safeString(value.result.explanation, 500)) return undefined
    result = { finding: value.result.finding, outcome: value.result.outcome, explanation: value.result.explanation }
  }
  if ((value.step === 'complete') !== (result !== null)) return undefined
  return { scenarioVersion: 1, title: value.title, narrative: value.narrative, step: value.step as ClerkPracticeStep,
    prompt: value.prompt, evidence, choices, result }
}

/** Strictly reads the public API projection; private saved actor-bound state is never a UI reply. */
export function readClerkReply(value: unknown): ClerkReply | null {
  if (!isObject(value)) return null
  const required = ['serverTime', 'ok', 'code', 'practice', 'revision', 'claimed', 'reward']
  const allowed = [...required, 'storage', 'reason', 'duplicate']
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key))
    || required.some(key => !Object.prototype.hasOwnProperty.call(value, key))
    || !safeRevision(value.serverTime) || (value.storage !== undefined && value.storage !== 'failing')
    || value.storage === 'failing' || typeof value.ok !== 'boolean' || !safeString(value.code, 80)
    || (value.reason !== undefined && !safeString(value.reason, 500)) || (value.duplicate !== undefined && value.duplicate !== true)
    || typeof value.claimed !== 'boolean' || value.reward !== 75) return null
  const saved = readPractice(value.practice)
  if (saved === undefined || (saved === null ? value.revision !== null || value.claimed
    : !safeRevision(value.revision) || value.revision !== stepOrder.indexOf(saved.step) || (value.claimed && saved.step !== 'complete'))) return null
  return { serverTime: value.serverTime, ...(value.storage === 'failing' ? { storage: 'failing' as const } : {}),
    ok: value.ok, code: value.code, ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
    ...(value.duplicate === true ? { duplicate: true as const } : {}), practice: saved, revision: value.revision as number | null,
    claimed: value.claimed, reward: 75 }
}
