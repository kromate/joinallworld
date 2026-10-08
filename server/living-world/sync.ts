/**
 * OWNER: living-world integration boundary.
 * Internal milestone observation queue only. This module defines no route, remote
 * operation, credential handling, commerce behavior, or game reward path.
 */

export const MILESTONE_SYNC = Object.freeze({ version: 1, maximumEntries: 128, maximumId: 160, maximumEvidenceRef: 160, leaseMs: 30000 })
export type GameMilestoneKind = 'driving.qualification-earned' | 'delivery.completed' | 'barber.service-completed' | 'mission.completed'

export type GameMilestoneObservation = {
  id: string
  kind: GameMilestoneKind
  schemaVersion: 1
  aggregateVersion: number
  completionAt: number
  gameEvidenceRef: string
}

export type MilestoneSyncBinding = {
  accountId: string
  workspaceId: string
  installationId: string
  generation: number
  contractVersion: string | null
  status: 'active' | 'revoked'
}

export type MilestoneSyncEntry = {
  observation: GameMilestoneObservation
  generation: number
  /** Persisted CAS token. It increases on every lease and fences late responses. */
  attemptVersion: number
  enqueuedAt: number
  state: 'queued' | 'leased' | 'uncertain' | 'acknowledged' | 'cancelled'
  leaseUntil?: number
  receiptId?: string
}

export type MilestoneSyncState = { v: 1; binding: MilestoneSyncBinding | null; outbox: MilestoneSyncEntry[] }
export type VerifiedMilestoneContract = { version: string; sourceSha: string; verified: true }
export type SyncResult = { ok: true; state: MilestoneSyncState; entry: MilestoneSyncEntry; duplicate?: true } | { ok: false; state: MilestoneSyncState; code: 'unconsented' | 'stale_consent' | 'invalid_observation' | 'invalid_publisher_result' | 'payload_conflict' | 'outbox_full' | 'unknown_contract' | 'not_dispatchable' }

export type MilestonePublishResult =
  | { status: 'unavailable'; reason: 'integration-disabled' }
  | { status: 'accepted'; receiptId: string }
  | { status: 'mock-only'; label: 'fixture-only'; receiptId: string }

export interface MilestonePublisher {
  readonly mode: 'disabled' | 'test-mock'
  readonly label?: 'fixture-only'
  publish(observation: GameMilestoneObservation, binding: MilestoneSyncBinding): Promise<MilestonePublishResult>
}

/** Explicit, side-effect-free production default. It performs no I/O and never claims success. */
export const disabledMilestonePublisher: MilestonePublisher = Object.freeze({
  mode: 'disabled' as const,
  async publish(): Promise<MilestonePublishResult> { return { status: 'unavailable', reason: 'integration-disabled' } },
})

/** Missing data in an older save means disabled and unconsented. */
export function emptyMilestoneSync(): MilestoneSyncState { return { v: 1, binding: null, outbox: [] } }
export function readMilestoneSync(value: unknown): MilestoneSyncState {
  if (value === undefined || value === null) return emptyMilestoneSync()
  // Invalid saved data must be caught by the save boundary and presented as unavailable;
  // callers must never repair malformed data into active consent.
  if (!isRecord(value) || value.v !== 1 || !Array.isArray(value.outbox)) throw new Error('Milestone sync state is invalid')
  const binding = value.binding === null ? null : parseBinding(value.binding)
  if (value.outbox.length > MILESTONE_SYNC.maximumEntries) throw new Error('Milestone sync outbox is too large')
  const outbox = value.outbox.map(parseEntry).map(entry => {
    if (!binding || binding.status !== 'active' || entry.generation !== binding.generation) {
      return entry.state === 'queued' ? { ...entry, state: 'cancelled' as const }
        : entry.state === 'leased' ? { ...entry, state: 'uncertain' as const, leaseUntil: undefined } : entry
    }
    return entry
  })
  if (new Set(outbox.map(entry => entry.observation.id)).size !== outbox.length) throw new Error('Milestone sync outbox contains duplicate IDs')
  if (outbox.some((entry, index) => outbox.slice(0, index).some(previous => sameSource(previous.observation, entry.observation)))) throw new Error('Milestone sync outbox contains duplicate source observations')
  return { v: 1, binding, outbox }
}

export function setMilestoneConsent(state: MilestoneSyncState, binding: MilestoneSyncBinding): MilestoneSyncState {
  const next = parseBinding(binding)
  if (next.status !== 'active') throw new Error('New milestone consent must be active')
  if (state.binding && next.generation <= state.binding.generation) throw new Error('Consent generation must increase')
  return { v: 1, binding: next, outbox: state.outbox.map(entry => entry.state === 'queued' || entry.state === 'leased' ? { ...entry, state: entry.state === 'leased' ? 'uncertain' : 'cancelled', leaseUntil: undefined } : entry) }
}

export function revokeMilestoneConsent(state: MilestoneSyncState, now: number): MilestoneSyncState {
  if (!finiteTime(now)) throw new Error('Revocation time is invalid')
  const binding = state.binding
  return {
    v: 1,
    binding: binding ? { ...binding, status: 'revoked' } : null,
    outbox: state.outbox.map(entry => entry.state === 'queued' ? { ...entry, state: 'cancelled' } : entry.state === 'leased' ? { ...entry, state: 'uncertain', leaseUntil: undefined } : entry),
  }
}

export function enqueueMilestone(state: MilestoneSyncState, binding: MilestoneSyncBinding, observation: GameMilestoneObservation, now: number): SyncResult {
  const current = state.binding
  if (!current || current.status !== 'active') return { ok: false, state, code: 'unconsented' }
  if (!sameBinding(current, binding) || binding.status !== 'active') return { ok: false, state, code: 'stale_consent' }
  let safe: GameMilestoneObservation
  try { safe = parseObservation(observation) } catch { return { ok: false, state, code: 'invalid_observation' } }
  if (!finiteTime(now)) return { ok: false, state, code: 'invalid_observation' }
  const old = state.outbox.find(entry => entry.observation.id === safe.id)
  if (old) return sameObservation(old.observation, safe)
    ? { ok: true, state, entry: old, duplicate: true }
    : { ok: false, state, code: 'payload_conflict' }
  if (state.outbox.some(entry => sameSource(entry.observation, safe))) return { ok: false, state, code: 'payload_conflict' }
  if (state.outbox.length >= MILESTONE_SYNC.maximumEntries) return { ok: false, state, code: 'outbox_full' }
  const entry: MilestoneSyncEntry = { observation: safe, generation: current.generation, attemptVersion: 0, enqueuedAt: now, state: 'queued' }
  return { ok: true, state: { ...state, outbox: [...state.outbox, entry] }, entry }
}

/** Claims at most one item. A missing/mismatched operation contract can never reach a publisher. */
export function leaseNextMilestone(state: MilestoneSyncState, binding: MilestoneSyncBinding, contract: VerifiedMilestoneContract | null, now: number, leaseMs: number = MILESTONE_SYNC.leaseMs): SyncResult {
  const current = state.binding
  if (!current || current.status !== 'active' || !sameBinding(current, binding)) return { ok: false, state, code: 'stale_consent' }
  if (!current.contractVersion || !contract?.verified || !/^[a-f0-9]{40,64}$/.test(contract.sourceSha) || contract.version !== current.contractVersion) return { ok: false, state, code: 'unknown_contract' }
  if (!finiteTime(now) || !Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 120000) return { ok: false, state, code: 'not_dispatchable' }
  const index = state.outbox.findIndex(entry => entry.state === 'queued' && entry.generation === current.generation)
  if (index < 0) return { ok: false, state, code: 'not_dispatchable' }
  const leaseUntil = now + leaseMs, prior = state.outbox[index]!
  if (!Number.isSafeInteger(leaseUntil) || !Number.isSafeInteger(prior.attemptVersion + 1)) return { ok: false, state, code: 'not_dispatchable' }
  const entry = { ...prior, attemptVersion: prior.attemptVersion + 1, state: 'leased' as const, leaseUntil }
  const outbox = [...state.outbox]; outbox[index] = entry
  return { ok: true, state: { ...state, outbox }, entry }
}

/** A lost lease is ambiguous: hold it for reconciliation rather than risk a duplicate write. */
export function holdExpiredMilestoneLeases(state: MilestoneSyncState, now: number): MilestoneSyncState {
  if (!finiteTime(now)) throw new Error('Reconciliation time is invalid')
  return { ...state, outbox: state.outbox.map(entry => entry.state === 'leased' && (entry.leaseUntil ?? Infinity) <= now ? { ...entry, state: 'uncertain', leaseUntil: undefined } : entry) }
}

export function recordMilestoneResult(state: MilestoneSyncState, id: string, generation: number, attemptVersion: number, result: unknown): SyncResult {
  const index = state.outbox.findIndex(entry => entry.observation.id === id)
  if (index < 0) return { ok: false, state, code: 'not_dispatchable' }
  const entry = state.outbox[index]!
  if (entry.state !== 'leased' || entry.generation !== generation || entry.attemptVersion !== attemptVersion || state.binding?.generation !== generation || state.binding.status !== 'active') return { ok: false, state, code: 'stale_consent' }
  const safeResult = parsePublisherResult(result)
  if (!safeResult) return { ok: false, state, code: 'invalid_publisher_result' }
  let next: MilestoneSyncEntry
  if (safeResult.status === 'unavailable') next = { ...entry, state: 'queued', leaseUntil: undefined }
  else if (safeResult.status === 'accepted') next = { ...entry, state: 'acknowledged', leaseUntil: undefined, receiptId: safeResult.receiptId }
  else if (safeResult.status === 'mock-only') next = { ...entry, state: 'acknowledged', leaseUntil: undefined, receiptId: `fixture-only:${safeResult.receiptId}` }
  else return { ok: false, state, code: 'invalid_observation' }
  const outbox = [...state.outbox]; outbox[index] = next
  return { ok: true, state: { ...state, outbox }, entry: next }
}

/** Only an explicit, authoritative reconciliation can release an uncertain item for another attempt. */
export function reconcileMilestone(state: MilestoneSyncState, id: string, attemptVersion: number, outcome: 'accepted' | 'not-accepted' | 'unknown', receiptId?: string): SyncResult {
  if (!['accepted', 'not-accepted', 'unknown'].includes(String(outcome))) return { ok: false, state, code: 'invalid_observation' }
  const index = state.outbox.findIndex(entry => entry.observation.id === id)
  if (index < 0) return { ok: false, state, code: 'not_dispatchable' }
  const entry = state.outbox[index]!
  if (entry.state !== 'uncertain' || entry.attemptVersion !== attemptVersion) return { ok: false, state, code: 'not_dispatchable' }
  if (state.binding?.status !== 'active' || state.binding.generation !== entry.generation) return { ok: false, state, code: 'stale_consent' }
  if (outcome === 'accepted' && !opaqueRef(receiptId, 200)) return { ok: false, state, code: 'invalid_observation' }
  const next = outcome === 'unknown' ? entry : outcome === 'accepted'
    ? { ...entry, state: 'acknowledged' as const, receiptId: boundedReceipt(receiptId!) }
    : state.binding?.status === 'active' && state.binding.generation === entry.generation
      ? { ...entry, state: 'queued' as const, leaseUntil: undefined }
      : { ...entry, state: 'cancelled' as const, leaseUntil: undefined }
  const outbox = [...state.outbox]; outbox[index] = next
  return { ok: true, state: { ...state, outbox }, entry: next }
}

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function nonempty(value: unknown, max: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max }
function finiteTime(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
function parseBinding(value: unknown): MilestoneSyncBinding {
  if (!isRecord(value) || !nonempty(value.accountId, 160) || !nonempty(value.workspaceId, 160) || !nonempty(value.installationId, 160) || typeof value.generation !== 'number' || !Number.isSafeInteger(value.generation) || value.generation < 1 || !(value.contractVersion === null || nonempty(value.contractVersion, 80)) || !['active', 'revoked'].includes(String(value.status))) throw new Error('Milestone sync binding is invalid')
  if (Object.keys(value).some(key => !['accountId', 'workspaceId', 'installationId', 'generation', 'contractVersion', 'status'].includes(key))) throw new Error('Milestone sync binding contains unsupported data')
  return { accountId: value.accountId, workspaceId: value.workspaceId, installationId: value.installationId, generation: Number(value.generation), contractVersion: value.contractVersion as string | null, status: value.status as MilestoneSyncBinding['status'] }
}
function parseObservation(value: unknown): GameMilestoneObservation {
  if (!isRecord(value) || !opaqueRef(value.id, MILESTONE_SYNC.maximumId) || !isMilestoneKind(value.kind) || value.schemaVersion !== 1 || typeof value.aggregateVersion !== 'number' || !Number.isSafeInteger(value.aggregateVersion) || value.aggregateVersion < 1 || !finiteTime(value.completionAt) || !opaqueRef(value.gameEvidenceRef, MILESTONE_SYNC.maximumEvidenceRef)) throw new Error('Game milestone observation is invalid')
  const keys = Object.keys(value)
  if (keys.some(key => !['id', 'kind', 'schemaVersion', 'aggregateVersion', 'completionAt', 'gameEvidenceRef'].includes(key))) throw new Error('Game milestone observation contains unsupported data')
  return { id: value.id, kind: value.kind, schemaVersion: 1, aggregateVersion: Number(value.aggregateVersion), completionAt: value.completionAt, gameEvidenceRef: value.gameEvidenceRef }
}
function parseEntry(value: unknown): MilestoneSyncEntry {
  if (!isRecord(value) || typeof value.generation !== 'number' || !Number.isSafeInteger(value.generation) || value.generation < 1 || typeof value.attemptVersion !== 'number' || !Number.isSafeInteger(value.attemptVersion) || value.attemptVersion < 0 || !finiteTime(value.enqueuedAt) || !['queued', 'leased', 'uncertain', 'acknowledged', 'cancelled'].includes(String(value.state))) throw new Error('Milestone sync entry is invalid')
  if (Object.keys(value).some(key => !['observation', 'generation', 'attemptVersion', 'enqueuedAt', 'state', 'leaseUntil', 'receiptId'].includes(key))) throw new Error('Milestone sync entry contains unsupported data')
  if (value.leaseUntil !== undefined && !finiteTime(value.leaseUntil)) throw new Error('Milestone sync lease is invalid')
  if (value.receiptId !== undefined && !opaqueRef(value.receiptId, 200)) throw new Error('Milestone sync receipt is invalid')
  const leased = value.state === 'leased'
  const acknowledged = value.state === 'acknowledged'
  if (leased !== (value.leaseUntil !== undefined) || (value.state === 'queued' && value.receiptId !== undefined) || (acknowledged !== (value.receiptId !== undefined))) throw new Error('Milestone sync entry fields do not match its state')
  return { observation: parseObservation(value.observation), generation: Number(value.generation), attemptVersion: Number(value.attemptVersion), enqueuedAt: value.enqueuedAt, state: value.state as MilestoneSyncEntry['state'], ...(value.leaseUntil === undefined ? {} : { leaseUntil: value.leaseUntil }), ...(value.receiptId === undefined ? {} : { receiptId: value.receiptId }) }
}
function sameBinding(a: MilestoneSyncBinding, b: MilestoneSyncBinding): boolean { return a.accountId === b.accountId && a.workspaceId === b.workspaceId && a.installationId === b.installationId && a.generation === b.generation && a.contractVersion === b.contractVersion && a.status === b.status }
function sameObservation(a: GameMilestoneObservation, b: GameMilestoneObservation): boolean { return a.id === b.id && a.kind === b.kind && a.schemaVersion === b.schemaVersion && a.aggregateVersion === b.aggregateVersion && a.completionAt === b.completionAt && a.gameEvidenceRef === b.gameEvidenceRef }
function sameSource(a: GameMilestoneObservation, b: GameMilestoneObservation): boolean { return a.gameEvidenceRef === b.gameEvidenceRef }
function boundedReceipt(value: string, max = 200): string { if (!opaqueRef(value, max)) throw new Error('Milestone receipt is invalid'); return value }
function opaqueRef(value: unknown, max: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) }
function isMilestoneKind(value: unknown): value is GameMilestoneKind { return value === 'driving.qualification-earned' || value === 'delivery.completed' || value === 'barber.service-completed' || value === 'mission.completed' }
function parsePublisherResult(value: unknown): MilestonePublishResult | null {
  if (!isRecord(value)) return null
  const keys = Object.keys(value)
  if (value.status === 'unavailable' && value.reason === 'integration-disabled' && keys.length === 2 && keys.every(key => key === 'status' || key === 'reason')) return { status: 'unavailable', reason: 'integration-disabled' }
  if (value.status === 'accepted' && keys.length === 2 && keys.every(key => key === 'status' || key === 'receiptId') && opaqueRef(value.receiptId, 200)) return { status: 'accepted', receiptId: value.receiptId }
  if (value.status === 'mock-only' && value.label === 'fixture-only' && keys.length === 3 && keys.every(key => key === 'status' || key === 'label' || key === 'receiptId') && opaqueRef(value.receiptId, 187)) return { status: 'mock-only', label: 'fixture-only', receiptId: value.receiptId }
  return null
}
