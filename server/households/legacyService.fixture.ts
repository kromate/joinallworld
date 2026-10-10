/**
 * Test fixture only: the service exactly as it was before request fingerprints were made stable.
 * Tests use it to create receipts in the old format with the real old code. Nothing imports it
 * outside tests, and it must not be changed.
 */
import type { Db, OnceDescriptor, RouteContext, SessionRecord } from '../types.ts'
import { oneOf, parseCommand, point, type Command, type Event } from './records.ts'
import { loadConsentView } from './consentView.ts'
import { reduceConsent } from './consent.ts'
import { applyConsentPatch } from './durableApply.ts'
import { createDurableConsentReads, isTrustedLifeAuthority, snapshotConsentValue, type LifeAuthorityFact, type TrustedConsentAuthority } from './durableReads.ts'

export type ConsentReceipt = Readonly<{
  ok: true
  operation: Command['op']
  householdId: string
  actorCharacterId: string
  actorLifeId: string
}>
export type ConsentServiceResult = Readonly<{
  ok: true
  duplicate: boolean
  receipt: ConsentReceipt
  /** Returned only after the owning Store transaction has durably resolved. */
  events: readonly Event[]
}> | Readonly<{ ok: false; code: string }>

export type ConsentServicePorts = Readonly<{
  /** Host-owned authentication, evaluated against this exact transaction's Db. */
  resolveSession(db: Db): SessionRecord | undefined
  /** Reads life, home, pair and system facts without mutation in this same transaction. */
  authority(db: Db, session: SessionRecord): TrustedConsentAuthority
}>

class ConsentAbort extends Error {
  readonly code: string
  constructor(code: string) { super(code); this.code = code }
}

function receiptFields(value: unknown): ConsentReceipt | null {
  if (value === null || typeof value !== 'object') return null
  const read = (key: string): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
  }
  const operation = read('operation'), householdId = read('householdId')
  const actorCharacterId = read('actorCharacterId'), actorLifeId = read('actorLifeId')
  if (read('ok') !== true || !oneOf(operation, ['register','invite','accept','decline','cancel','expire','terminate-invitation','leave','revoke','terminate','close']) || typeof householdId !== 'string' || typeof actorCharacterId !== 'string' || typeof actorLifeId !== 'string') return null
  return { ok: true, operation, householdId, actorCharacterId, actorLifeId }
}

function receiptFingerprint(command: Command, actor: LifeAuthorityFact): string {
  const payload = JSON.stringify([
    command,
    {
      actorCharacterId: actor.who.character, actorLifeId: actor.who.life, actorRevision: actor.revision,
      recordUpdatedAt: actor.recordUpdatedAt, locationRevision: actor.locationRevision, locatorRevision: actor.locator.revision,
    },
  ])
  return payload
}

const householdIdOf = (command: Command): string => command.householdId

/**
 * Run from an authenticated HTTP/service boundary. The session resolver and authority source
 * must be host-owned functions. This module intentionally registers no route or system endpoint.
 */
export async function executeConsentCommand(
  ctx: Pick<RouteContext, 'store' | 'once' | 'onceId' | 'now'>,
  ports: ConsentServicePorts,
  descriptor: OnceDescriptor,
  rawCommand: unknown,
): Promise<ConsentServiceResult> {
  ctx.onceId(descriptor.id)
  const safeCommand = snapshotConsentValue(rawCommand)
  if (!safeCommand.ok) return { ok: false, code: 'invalid_command' }
  const command = parseCommand(safeCommand.value)
  if (!command) return { ok: false, code: 'invalid_command' }
  const localDescriptor: OnceDescriptor = {
    id: descriptor.id,
    kind: `household.${command.op}`,
    fingerprint: '',
  }
  const replayProbe = Symbol('consent_replay_probe')
  try {
    return await ctx.store.transact(async db => {
      const session = ports.resolveSession(db)
      if (!session) throw new ConsentAbort('session_required')
      const trusted = ports.authority(db, session)
      const actorProof = await trusted.sessionLife()
      const actorSnapshot = snapshotConsentValue(actorProof.point)
      if (!actorProof.verifyReadSet() || !actorSnapshot.ok || !point(actorSnapshot.value, isTrustedLifeAuthority) || actorSnapshot.value.state !== 'present') throw new ConsentAbort('actor_life_unproven')
      const actor = actorSnapshot.value.value
      localDescriptor.fingerprint = receiptFingerprint(command, actor)

      let old: unknown
      try {
        old = ctx.once<ConsentReceipt>(db, session, localDescriptor, () => { throw replayProbe })
      } catch (error) {
        if (error !== replayProbe) throw error
      }
      if (old !== undefined) {
        const saved = receiptFields(old)
        if (!saved || saved.operation !== command.op || saved.householdId !== householdIdOf(command) || saved.actorCharacterId !== actor.who.character || saved.actorLifeId !== actor.who.life) throw new ConsentAbort('receipt_authority_mismatch')
        return { ok: true, duplicate: true, receipt: saved, events: [] }
      }

      const reads = createDurableConsentReads(db, ctx.now(), trusted, actorProof)
      const loaded = await loadConsentView(command, reads.transaction)
      if (!loaded.ok) throw new ConsentAbort(loaded.code)
      const result = reduceConsent(loaded.command, loaded.view)
      if (!result.ok) throw new ConsentAbort(result.code)
      if (result.liabilities.length > 0) throw new ConsentAbort('liability_consumer_unavailable')
      const receipt: ConsentReceipt = {
        ok: true,
        operation: loaded.command.op,
        householdId: householdIdOf(loaded.command),
        actorCharacterId: actor.who.character,
        actorLifeId: actor.who.life,
      }
      const saved = ctx.once(db, session, localDescriptor, () => {
        if (!actorProof.verifyReadSet() || !reads.verifyReadSet()) throw new ConsentAbort('readset_mismatch')
        const applied = applyConsentPatch(db, result)
        if (!applied.ok) throw new ConsentAbort(applied.code)
        return receipt
      })
      const savedReceipt = receiptFields(saved)
      if (!savedReceipt) throw new ConsentAbort('receipt_invalid')
      return { ok: true, duplicate: false, receipt: savedReceipt, events: result.events }
    })
  } catch (error) {
    if (error instanceof ConsentAbort) return { ok: false, code: error.code }
    throw error
  }
}
