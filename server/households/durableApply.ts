/** Applies a reducer patch to one owning Store transaction after exact point expectations pass. */
import {
  isCharacterIndex, isHomeIndex, isHousehold, isInvite, isLifeIndex, isMember,
  type Event, type Expectation, type Result, type Write,
} from './records.ts'
import {
  createHouseholdCollection, householdPoint, isHouseholdCollection,
  type HouseholdCollection, type HouseholdDb, type HouseholdMapName,
} from './durableStorage.ts'

export type ApplyFailure = 'refused' | 'readset_mismatch' | 'unconsumed_liability' | 'invalid_patch' | 'invalid_storage'
export type ApplyOutcome = { readonly ok: true; readonly events: readonly Event[] } | { readonly ok: false; readonly code: ApplyFailure }

const REVISION_MAPS: Readonly<Record<Expectation['collection'], HouseholdMapName>> = Object.freeze({
  households: 'households', invites: 'invites', members: 'members',
  characterIndexes: 'characterIndexes', lifeIndexes: 'lifeIndexes', homeIndexes: 'homeIndexes',
  homes: 'homes', lifeFacts: 'lifeFacts', pairFacts: 'pairFacts',
})

function rowRevision(value: unknown): number | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, 'revision')
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'number' || !Number.isSafeInteger(descriptor.value) || descriptor.value < 0) return undefined
  return descriptor.value
}

function checkExpectation(db: HouseholdDb, expectation: Expectation): boolean {
  const mapName = REVISION_MAPS[expectation.collection]
  const point = householdPoint(db, mapName, expectation.id)
  if (point.state === 'invalid') return false
  if (expectation.revision === null) return point.state === 'absent'
  if (point.state !== 'present') return false
  return rowRevision(point.value) === expectation.revision
}

function validWrite(write: Write): boolean {
  switch (write.collection) {
    case 'households':
      return isHousehold(write.value)
    case 'invites':
      return isInvite(write.value)
    case 'members':
      return isMember(write.value)
    case 'characterIndexes':
      return isCharacterIndex(write.value)
    case 'lifeIndexes':
      return isLifeIndex(write.value)
    case 'homeIndexes':
      return isHomeIndex(write.value)
  }
}

function applyWrite(root: HouseholdCollection, write: Write): void {
  switch (write.collection) {
    case 'households': root.households[write.value.id] = write.value; return
    case 'invites': root.invites[write.value.id] = write.value; return
    case 'members': root.members[write.value.id] = write.value; return
    case 'characterIndexes': root.characterIndexes[write.value.id] = write.value; return
    case 'lifeIndexes': root.lifeIndexes[write.value.id] = write.value; return
    case 'homeIndexes': root.homeIndexes[write.value.id] = write.value; return
  }
}

/**
 * Validate every reducer-declared revision before the first mutation, then apply synchronously.
 * The caller must additionally verify its adapter-owned read set (authority, life locator,
 * home provenance, pair sources and linked accepted invitations) immediately before this call.
 * No financial consumer is wired by this slice; any liability handoff therefore aborts.
 */
export function applyConsentPatch(db: HouseholdDb, result: Result): ApplyOutcome {
  if (!result.ok) return { ok: false, code: 'refused' }
  if (result.liabilities.length > 0) return { ok: false, code: 'unconsumed_liability' }
  if (result.expected.length > 128 || result.writes.length === 0 || result.writes.length > 128 || result.events.length > 32) return { ok: false, code: 'invalid_patch' }
  const seen = new Set<string>()
  for (const expected of result.expected) {
    const key = `${expected.collection}\u0000${expected.id}`
    if (seen.has(key) || !Number.isSafeInteger(expected.revision === null ? 0 : expected.revision) || !checkExpectation(db, expected)) return { ok: false, code: 'readset_mismatch' }
    seen.add(key)
  }
  const rootDescriptor = Object.getOwnPropertyDescriptor(db, 'households')
  if (rootDescriptor && !Object.hasOwn(rootDescriptor, 'value')) return { ok: false, code: 'invalid_storage' }
  // The Store view's top-level collection descriptor is a deliberate undefined placeholder;
  // read the fixed collection property to materialize its ordinary root value.
  const rootValue = db.households
  let root: HouseholdCollection
  if (rootValue === undefined && !rootDescriptor) {
    root = createHouseholdCollection()
  } else {
    if (!isHouseholdCollection(rootValue)) return { ok: false, code: 'invalid_storage' }
    root = rootValue
  }
  const writes = new Set<string>()
  for (const write of result.writes) {
    const key = `${write.collection}\u0000${write.value.id}`
    if (!validWrite(write) || writes.has(key) || !seen.has(key)) return { ok: false, code: 'invalid_patch' }
    writes.add(key)
  }
  for (const write of result.writes) applyWrite(root, write)
  if (!rootDescriptor) db.households = root
  return { ok: true, events: result.events }
}
