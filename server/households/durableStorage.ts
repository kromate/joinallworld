/**
 * Versioned, point-addressed persistence boundary for the consent adapter.
 *
 * This module deliberately does not initialize storage while reading. It also does not
 * manufacture lifecycle, home, pair, or financial authority. Those facts must be supplied
 * by their canonical same-transaction writers before a caller can construct a consent view.
 */
import {
  isCharacterIndex, isHome, isHomeIndex, isHousehold, isInvite, isLifeFact,
  isLifeIndex, isMember, isPair, record,
  type CharacterIndex, type Home, type HomeIndex, type Household, type Invite,
  type LifeFact, type LifeIndex, type Member, type PairFact,
} from './records.ts'

export const HOUSEHOLD_SCHEMA_VERSION: 1 = 1
export type HouseholdMapName =
  | 'households' | 'invites' | 'members' | 'characterIndexes' | 'lifeIndexes'
  | 'homeIndexes' | 'homes' | 'lifeFacts' | 'pairFacts' | 'lifeLocations' | 'byCharacterLife'

/** The root contains only version metadata and explicitly keyed maps; no money or liability store. */
export interface HouseholdCollection {
  readonly version: typeof HOUSEHOLD_SCHEMA_VERSION
  households: Record<string, unknown>
  invites: Record<string, unknown>
  members: Record<string, unknown>
  characterIndexes: Record<string, unknown>
  lifeIndexes: Record<string, unknown>
  homeIndexes: Record<string, unknown>
  homes: Record<string, unknown>
  lifeFacts: Record<string, unknown>
  pairFacts: Record<string, unknown>
  lifeLocations: Record<string, unknown>
  byCharacterLife: Record<string, unknown>
}

export type HouseholdDb = { households?: unknown }
export type StoredPoint<T> =
  | { readonly state: 'absent' }
  | { readonly state: 'present'; readonly value: T }
  | { readonly state: 'invalid' }

const MAPS: readonly HouseholdMapName[] = Object.freeze([
  'households', 'invites', 'members', 'characterIndexes', 'lifeIndexes', 'homeIndexes',
  'homes', 'lifeFacts', 'pairFacts', 'lifeLocations', 'byCharacterLife',
])
const isMapName = (value: string): value is HouseholdMapName => MAPS.some(name => name === value)
const validators: Readonly<Partial<Record<HouseholdMapName, (value: unknown) => boolean>>> = Object.freeze({
  households: isHousehold,
  invites: isInvite,
  members: isMember,
  characterIndexes: isCharacterIndex,
  lifeIndexes: isLifeIndex,
  homeIndexes: isHomeIndex,
  homes: isHome,
  lifeFacts: isLifeFact,
  pairFacts: isPair,
})

function dataObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

export function isHouseholdCollection(value: unknown): value is HouseholdCollection {
  if (!dataObject(value)) return false
  const version = dataValue(value, 'version')
  if (!version.ok || !version.own || version.value !== HOUSEHOLD_SCHEMA_VERSION) return false
  for (const mapName of MAPS) {
    const map = dataValue(value, mapName)
    if (!map.ok || !map.own || !dataObject(map.value)) return false
  }
  try {
    const keys = Reflect.ownKeys(value)
    return keys.length === MAPS.length + 1 && keys.every(key => typeof key === 'string' && (key === 'version' || isMapName(key)))
  } catch {
    return false
  }
}

function dataValue(object: object, key: string): { readonly ok: true; readonly value: unknown; readonly own: boolean } | { readonly ok: false } {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(object, key)
    if (!descriptor) return { ok: true, value: undefined, own: false }
    if (!Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) return { ok: false }
    return { ok: true, value: descriptor.value, own: true }
  } catch {
    return { ok: false }
  }
}

function rootOf(db: HouseholdDb): HouseholdCollection | null | 'invalid' {
  const entry = dataValue(db, 'households')
  if (!entry.ok) return 'invalid'
  if (!entry.own) return null
  if (entry.value === undefined) return 'invalid'
  const rootValue = entry.value
  return isHouseholdCollection(rootValue) ? rootValue : 'invalid'
}

/**
 * A strictly bounded keyed lookup. The requested entry is fetched before descriptor checks;
 * this is required for Worker lazy maps. An own undefined value is corruption, not absence.
 */
export function householdPoint<K extends HouseholdMapName>(db: HouseholdDb, mapName: K, key: string): StoredPoint<unknown> {
  const root = rootOf(db)
  if (root === 'invalid') return { state: 'invalid' }
  if (root === null) return { state: 'absent' }
  const map = root[mapName]
  const before = dataValue(map, key)
  if (!before.ok) return { state: 'invalid' }
  const value = map[key]
  const descriptor = dataValue(map, key)
  if (!descriptor.ok) return { state: 'invalid' }
  if (!descriptor.own) return { state: 'absent' }
  if (descriptor.value === undefined || value === undefined) return { state: 'invalid' }
  return { state: 'present', value }
}

/** Use only after a command is known to have a successful durable write in the transaction. */
export function createHouseholdCollection(): HouseholdCollection {
  return {
    version: HOUSEHOLD_SCHEMA_VERSION,
    households: {},
    invites: {},
    members: {},
    characterIndexes: {},
    lifeIndexes: {},
    homeIndexes: {},
    homes: {},
    lifeFacts: {},
    pairFacts: {},
    lifeLocations: {},
    byCharacterLife: {},
  }
}

/** Validate a loaded reducer or authority row without consulting any other entry. */
export function validateStoredRow(mapName: HouseholdMapName, value: unknown): boolean {
  if (!record(value)) return false
  const check = validators[mapName]
  return check ? check(value) : false
}

export type ReducerStoredRow = Household | Invite | Member | CharacterIndex | LifeIndex | HomeIndex
export type AuthorityStoredRow = Home | LifeFact | PairFact
