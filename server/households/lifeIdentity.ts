import type { ArchivedLife, CityLifeRecord, SessionRecord } from '../types.ts'
import { id as validId, type CharacterId, type LifeId } from './records.ts'

export type { CharacterId, LifeId } from './records.ts'
export type LifeIdentity = Readonly<{ version: 1; lifeId: LifeId }>
export type IdentifiedLifeRecord = CityLifeRecord & { readonly identity: LifeIdentity }
export type LifeSlot = Readonly<{ kind: 'city'; city: string } | { kind: 'legacy'; key: string; city: string }>
export type LifeLocation = Readonly<
  | { kind: 'session'; sessionKey: string; slot: LifeSlot }
  | { kind: 'archive'; publicId: CharacterId; slot: LifeSlot }
>
export type LifeLocator = Readonly<
  | { kind: 'located'; lifeId: LifeId; characterId: CharacterId; revision: number; location: LifeLocation }
  | { kind: 'erased'; lifeId: LifeId; characterId: CharacterId; revision: number }
>
export type LocatedLife = Extract<LifeLocator, { kind: 'located' }>

// The adapter supplies one container read in its transaction. This does not validate a full game save.
export type LifeContainer =
  | Readonly<{ kind: 'session'; key: string; record: SessionRecord }>
  | Readonly<{ kind: 'archive'; key: string; record: ArchivedLife }>
export type SlotInput = Readonly<{ characterId: unknown; location: unknown; container: LifeContainer | undefined }>
export type InspectInput = SlotInput & Readonly<{ expectedLifeId?: unknown; locator: unknown }>
export type IdentityFailure = Readonly<{ kind: 'corrupt'; reason: string }>
export type RecordExpectation = Readonly<{
  recordReference: object
  stateReference: object
  updatedAt: number
  salt: string
  identity: 'absent' | LifeId
}>
export type SlotSnapshot = Readonly<{
  characterId: CharacterId
  location: LifeLocation
  identity: LifeIdentity | null
  expectedRecord: RecordExpectation
}>
export type LifeInspection =
  | Readonly<{ kind: 'existing-unidentified'; slot: SlotSnapshot }>
  | Readonly<{ kind: 'identified'; slot: SlotSnapshot; locator: LocatedLife }>
  | Readonly<{ kind: 'missing'; characterId: CharacterId; location: LifeLocation }>
  | Readonly<{ kind: 'erased'; locator: Extract<LifeLocator, { kind: 'erased' }> }>
  | IdentityFailure

type Parse<T> = Readonly<{ ok: true; value: T } | { ok: false; reason: string }>
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const salt = /^[A-Za-z0-9_-]{16,64}$/
const legacyKey = /^[a-z][a-z0-9-]{0,63}:[1-9][0-9]{0,15}$/
const absentField = Symbol('absent_field')
const invalidField = Symbol('invalid_field')
const record = (value: unknown): value is Record<string, unknown> => {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch { return false }
}
const own = (value: object, key: string): unknown => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor) return absentField
    return Object.hasOwn(descriptor, 'value') ? descriptor.value : invalidField
  } catch { return invalidField }
}
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  try {
    const actual = Reflect.ownKeys(value)
    return actual.length === keys.length && actual.every((key) => {
      if (typeof key !== 'string' || !keys.includes(key)) return false
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return descriptor !== undefined && descriptor.enumerable === true && Object.hasOwn(descriptor, 'value')
    })
  } catch { return false }
}
const city = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value)
const revision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const bad = (reason: string): IdentityFailure => Object.freeze({ kind: 'corrupt', reason })
const no = (reason: string): Parse<never> => ({ ok: false, reason })

export function parseLifeId(value: unknown): Parse<LifeId> {
  return validId<'life'>(value) ? { ok: true, value } : no('invalid_life_id')
}
export function parseCharacterId(value: unknown): Parse<CharacterId> {
  return validId<'character'>(value) ? { ok: true, value } : no('invalid_character_id')
}
export function parseLifeIdentity(value: unknown): Parse<LifeIdentity> {
  if (!record(value) || !exactKeys(value, ['version', 'lifeId']) || own(value, 'version') !== 1) return no('invalid_identity')
  const id = parseLifeId(own(value, 'lifeId'))
  return id.ok ? { ok: true, value: Object.freeze({ version: 1, lifeId: id.value }) } : id
}
export function parseLifeLocation(value: unknown): Parse<LifeLocation> {
  if (!record(value)) return no('invalid_location')
  const rawSlot = own(value, 'slot')
  if (!record(rawSlot)) return no('invalid_slot')
  const slotCity = own(rawSlot, 'city'), slotKind = own(rawSlot, 'kind'), key = own(rawSlot, 'key')
  if (!city(slotCity)) return no('invalid_slot_city')
  let slot: LifeSlot
  if (slotKind === 'city' && exactKeys(rawSlot, ['kind', 'city'])) slot = Object.freeze({ kind: 'city', city: slotCity })
  else if (slotKind === 'legacy' && typeof key === 'string' && legacyKey.test(key) && exactKeys(rawSlot, ['kind', 'key', 'city'])) slot = Object.freeze({ kind: 'legacy', key, city: slotCity })
  else return no('invalid_slot')
  const kind = own(value, 'kind'), sessionKey = own(value, 'sessionKey')
  if (kind === 'session' && typeof sessionKey === 'string' && uuid.test(sessionKey) && exactKeys(value, ['kind', 'sessionKey', 'slot'])) return { ok: true, value: Object.freeze({ kind, sessionKey, slot }) }
  if (kind === 'archive') {
    const id = parseCharacterId(own(value, 'publicId'))
    if (id.ok && exactKeys(value, ['kind', 'publicId', 'slot'])) return { ok: true, value: Object.freeze({ kind, publicId: id.value, slot }) }
  }
  return no('invalid_location')
}
export function parseLifeLocator(value: unknown): Parse<LifeLocator> {
  if (!record(value)) return no('invalid_locator')
  const id = parseLifeId(own(value, 'lifeId')), owner = parseCharacterId(own(value, 'characterId')), rev = own(value, 'revision')
  if (!id.ok || !owner.ok || !revision(rev)) return no('invalid_locator')
  const kind = own(value, 'kind')
  if (kind === 'erased') return exactKeys(value, ['kind', 'lifeId', 'characterId', 'revision'])
    ? { ok: true, value: Object.freeze({ kind, lifeId: id.value, characterId: owner.value, revision: rev }) }
    : no('invalid_locator')
  if (kind !== 'located') return no('invalid_locator_kind')
  if (!exactKeys(value, ['kind', 'lifeId', 'characterId', 'revision', 'location'])) return no('invalid_locator')
  const location = parseLifeLocation(own(value, 'location'))
  if (!location.ok) return location
  if (location.value.kind === 'archive' && location.value.publicId !== owner.value) return no('archive_owner_mismatch')
  return { ok: true, value: Object.freeze({ kind, lifeId: id.value, characterId: owner.value, revision: rev, location: location.value }) }
}
export function sameLifeLocation(a: LifeLocation, b: LifeLocation): boolean {
  if (a.kind !== b.kind || a.slot.kind !== b.slot.kind || a.slot.city !== b.slot.city) return false
  if (a.kind === 'session' && b.kind === 'session' && a.sessionKey !== b.sessionKey) return false
  if (a.kind === 'archive' && b.kind === 'archive' && a.publicId !== b.publicId) return false
  return a.slot.kind !== 'legacy' || b.slot.kind === 'legacy' && a.slot.key === b.slot.key
}

type SlotRead = Readonly<{ kind: 'present'; slot: SlotSnapshot } | { kind: 'missing'; characterId: CharacterId; location: LifeLocation }> | IdentityFailure
function readSlot(input: SlotInput): SlotRead {
  if (!record(input)) return bad('invalid_slot_request')
  const owner = parseCharacterId(own(input, 'characterId')), location = parseLifeLocation(own(input, 'location'))
  if (!owner.ok || !location.ok) return bad('invalid_slot_request')
  const at = location.value
  if (at.kind === 'archive' && at.publicId !== owner.value) return bad('archive_owner_mismatch')
  const container = own(input, 'container')
  if (container === undefined) return { kind: 'missing', characterId: owner.value, location: at }
  if (!record(container)) return bad('invalid_container')
  const held = own(container, 'record')
  if (!record(held)) return bad('invalid_container')
  if (own(held, 'publicId') !== owner.value || own(container, 'kind') !== at.kind) return bad('container_owner_mismatch')
  if (at.kind === 'session' && (own(container, 'key') !== at.sessionKey || own(held, 'secret') !== at.sessionKey)) return bad('session_key_mismatch')
  if (at.kind === 'archive' && own(container, 'key') !== at.publicId) return bad('archive_key_mismatch')
  const slotKey = at.slot.kind === 'city' ? at.slot.city : at.slot.key
  if (at.slot.kind === 'legacy') {
    const origins = own(held, 'legacyLifeCities')
    if (origins !== absentField && origins !== undefined) {
      if (!record(origins)) return bad('invalid_legacy_origins')
      const origin = own(origins, slotKey)
      if (origin !== absentField && origin !== at.slot.city) return bad('legacy_city_mismatch')
    }
  }
  const map = own(held, at.slot.kind === 'city' ? 'cities' : 'legacyLives')
  if ((map === absentField || map === undefined) && at.slot.kind === 'legacy') return { kind: 'missing', characterId: owner.value, location: at }
  if (!record(map)) return bad('invalid_slot_map')
  const entry = own(map, slotKey)
  if (entry === absentField) return { kind: 'missing', characterId: owner.value, location: at }
  if (!record(entry)) return bad('invalid_life_record')
  const entryState = own(entry, 'state'), entryUpdatedAt = own(entry, 'updatedAt'), entrySalt = own(entry, 'salt')
  if (!record(entryState) || !timestamp(entryUpdatedAt) || typeof entrySalt !== 'string' || !salt.test(entrySalt)) return bad('invalid_life_record')
  const state = entryState
  const estate = own(state, 'estate')
  if (!record(estate) || own(estate, 'city') !== at.slot.city) return bad('slot_city_mismatch')
  let identity: LifeIdentity | null = null
  const rawIdentity = own(entry, 'identity')
  if (rawIdentity !== absentField) {
    const parsed = parseLifeIdentity(rawIdentity)
    if (!parsed.ok) return bad(parsed.reason)
    identity = parsed.value
  }
  const expectedRecord: RecordExpectation = Object.freeze({
    recordReference: entry,
    stateReference: state,
    updatedAt: entryUpdatedAt,
    salt: entrySalt,
    identity: identity?.lifeId ?? 'absent',
  })
  return { kind: 'present', slot: Object.freeze({ characterId: owner.value, location: at, identity, expectedRecord }) }
}

export function inspectLifeIdentity(input: InspectInput): LifeInspection {
  const slot = readSlot(input)
  if (slot.kind === 'corrupt') return slot
  const expectedRaw = own(input, 'expectedLifeId')
  const expected = expectedRaw === absentField || expectedRaw === undefined ? undefined : parseLifeId(expectedRaw)
  if (expected && !expected.ok) return bad(expected.reason)
  const rawLocator = own(input, 'locator')
  if (rawLocator === undefined) {
    if (slot.kind === 'missing') return slot
    if (slot.slot.identity || expected) return bad('locator_missing')
    return { kind: 'existing-unidentified', slot: slot.slot }
  }
  const parsed = parseLifeLocator(rawLocator)
  if (!parsed.ok) return bad(parsed.reason)
  const locator = parsed.value, owner = slot.kind === 'present' ? slot.slot.characterId : slot.characterId
  if (locator.characterId !== owner || expected?.ok && locator.lifeId !== expected.value) return bad('locator_identity_mismatch')
  if (locator.kind === 'erased') return slot.kind === 'missing' ? { kind: 'erased', locator } : bad('erased_record_present')
  const at = slot.kind === 'present' ? slot.slot.location : slot.location
  if (!sameLifeLocation(locator.location, at)) return bad('locator_location_mismatch')
  if (slot.kind === 'missing') return bad('located_record_missing')
  if (!slot.slot.identity || slot.slot.identity.lifeId !== locator.lifeId) return bad('record_identity_mismatch')
  return { kind: 'identified', slot: slot.slot, locator }
}

export type AssignmentPlan = Readonly<{
  kind: 'assign'; characterId: CharacterId; location: LifeLocation
  expected: Readonly<{ record: RecordExpectation; locator: 'absent'; characterIndex: 'absent' }>
  patch: Readonly<{
    recordIdentity: Readonly<{ kind: 'insert'; value: LifeIdentity }>
    locator: Readonly<{ kind: 'insert'; value: LocatedLife }>
    characterIndex: Readonly<{ kind: 'insert'; characterId: CharacterId; lifeId: LifeId }>
  }>
}>
export type MutationAuthority = Readonly<{ kind: 'durable-household-mutation' }>
export type AssignmentResult = AssignmentPlan | Readonly<{ kind: 'already-assigned'; identity: LifeIdentity; locator: LocatedLife }> | IdentityFailure
export type LocatorPointRead = Readonly<{ kind: 'absent' } | { kind: 'present'; value: unknown }>
export function planLifeIdentityAssignment(input: InspectInput, authority: MutationAuthority, source: Readonly<{
  newLifeId(): unknown
  // Must be a transaction-local point lookup, including erased/tombstone IDs.
  locatorAt(id: LifeId): LocatorPointRead
}>): AssignmentResult {
  if (!record(authority) || own(authority, 'kind') !== 'durable-household-mutation') return bad('mutation_authority_required')
  const inspected = inspectLifeIdentity(input)
  if (inspected.kind === 'identified') return { kind: 'already-assigned', identity: Object.freeze({ version: 1, lifeId: inspected.locator.lifeId }), locator: inspected.locator }
  if (inspected.kind !== 'existing-unidentified') return inspected.kind === 'corrupt' ? inspected : bad(`cannot_assign_${inspected.kind}`)
  const id = parseLifeId(source.newLifeId())
  if (!id.ok) return bad(id.reason)
  const collision = source.locatorAt(id.value)
  if (!record(collision) || (own(collision, 'kind') !== 'absent' && own(collision, 'kind') !== 'present')) return bad('collision_lookup_unproven')
  if (own(collision, 'kind') === 'present') {
    if (!exactKeys(collision, ['kind', 'value'])) return bad('collision_lookup_unproven')
    const located = parseLifeLocator(own(collision, 'value'))
    return bad(located.ok && located.value.lifeId === id.value ? 'life_id_collision' : 'collision_lookup_corrupt')
  }
  if (!exactKeys(collision, ['kind'])) return bad('collision_lookup_unproven')
  const identity: LifeIdentity = Object.freeze({ version: 1, lifeId: id.value })
  const locator: LocatedLife = Object.freeze({ kind: 'located', lifeId: id.value, characterId: inspected.slot.characterId, revision: 1, location: inspected.slot.location })
  return Object.freeze({ kind: 'assign', characterId: inspected.slot.characterId, location: inspected.slot.location,
    expected: Object.freeze({ record: inspected.slot.expectedRecord, locator: 'absent', characterIndex: 'absent' }),
    patch: Object.freeze({
      recordIdentity: Object.freeze({ kind: 'insert', value: identity }),
      locator: Object.freeze({ kind: 'insert', value: locator }),
      characterIndex: Object.freeze({ kind: 'insert', characterId: inspected.slot.characterId, lifeId: id.value }),
    }),
  })
}

export type MovePlan = Readonly<{
  kind: 'move'
  expected: Readonly<{
    source: RecordExpectation
    destination: 'empty'
    locator: LocatedLife
    sourceRemoval: 'same-transaction'
  }>
  patch: Readonly<{
    record: Readonly<{
      kind: 'move-whole-record'
      from: LifeLocation
      to: LifeLocation
      preserve: readonly ['state', 'updatedAt', 'salt', 'identity']
    }>
    locator: Readonly<{ kind: 'replace'; before: LocatedLife; after: LocatedLife }>
  }>
}>
export function planLifeIdentityMove(source: InspectInput, destination: SlotInput): MovePlan | IdentityFailure {
  const from = inspectLifeIdentity(source)
  if (from.kind !== 'identified') return from.kind === 'corrupt' ? from : bad('identified_source_required')
  const to = readSlot(destination)
  if (to.kind === 'corrupt') return to
  if (to.kind !== 'missing') return bad('destination_occupied')
  if (from.slot.characterId !== to.characterId) return bad('move_changes_owner')
  if (from.slot.location.slot.city !== to.location.slot.city) return bad('move_changes_city')
  if (sameLifeLocation(from.slot.location, to.location)) return bad('same_location_move')
  if (from.locator.revision === Number.MAX_SAFE_INTEGER) return bad('locator_revision_exhausted')
  const after: LocatedLife = Object.freeze({ ...from.locator, revision: from.locator.revision + 1, location: to.location })
  const preserve: readonly ['state', 'updatedAt', 'salt', 'identity'] = Object.freeze(['state', 'updatedAt', 'salt', 'identity'])
  return Object.freeze({
    kind: 'move',
    expected: Object.freeze({ source: from.slot.expectedRecord, destination: 'empty', locator: from.locator, sourceRemoval: 'same-transaction' }),
    patch: Object.freeze({
      record: Object.freeze({ kind: 'move-whole-record', from: from.slot.location, to: to.location, preserve }),
      locator: Object.freeze({ kind: 'replace', before: from.locator, after }),
    }),
  })
}
