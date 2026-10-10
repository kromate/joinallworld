/** Bounded same-transaction reads and an adapter-owned exact read set. */
import type { Db } from '../types.ts'
import { identity, isHome, isLifeFact, isPair, oneOf, point, record, type Authority, type Home, type Identity, type InviteId, type LifeFact, type PairFact, type Point } from './records.ts'
import { householdPoint, type HouseholdMapName, type StoredPoint } from './durableStorage.ts'
import type { ConsentReadTransaction } from './consentView.ts'
import { parseLifeLocator, type LifeLocator } from './lifeIdentity.ts'

type Tracked = Readonly<{ map: HouseholdMapName; key: string; fingerprint: string | null; revision: number | null }>
export type TrustedPoint<T = unknown> = Readonly<{ point: Point<T>; verifyReadSet(): boolean }>
export type HomeAuthorityFact = Home & Readonly<{ residenceIncarnation: string; city: string; address: string; originalHome: boolean; lifecycleRevision: number; sceneRevision: number }>
export type LifeAuthorityFact = LifeFact & Readonly<{ locator: LifeLocator; recordUpdatedAt: number; locationRevision: number }>
export type PairAuthorityFact = PairFact & Readonly<{ sourceARevision: number; sourceBRevision: number }>
export type TrustedConsentAuthority = Readonly<{
  /** Must resolve the exact already-active life from host session authority in this transaction. */
  sessionLife(): Promise<TrustedPoint<LifeAuthorityFact>>
  /** Only a same-transaction lifecycle/social handler may provide system authority. */
  systemAuthority(): Promise<TrustedPoint<Authority>>
  /** These same-transaction readers must verify canonical source rows and their revisions. */
  home(id: string): Promise<TrustedPoint<HomeAuthorityFact>>
  lifeFact(id: string): Promise<TrustedPoint<LifeAuthorityFact>>
  pairFact(a: Identity, b: Identity): Promise<TrustedPoint<PairAuthorityFact>>
}>
export type DurableConsentReads = Readonly<{
  transaction: ConsentReadTransaction
  verifyReadSet(): boolean
}>

export type SafeSnapshot = Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false }>
export function snapshotConsentValue(input: unknown): SafeSnapshot {
  let nodes = 2048, stringUnits = 16384
  const visit = (value: unknown, depth: number, ancestors: WeakSet<object>): SafeSnapshot => {
    if (value === null || typeof value === 'boolean' || typeof value === 'number') return { ok: true, value }
    if (typeof value === 'string') {
      if (value.length > 4096 || stringUnits < value.length) return { ok: false }
      stringUnits -= value.length
      return { ok: true, value }
    }
    if (typeof value !== 'object' || depth > 12 || nodes-- <= 0 || ancestors.has(value)) return { ok: false }
    ancestors.add(value)
    try {
      if (Array.isArray(value)) {
        const length = Object.getOwnPropertyDescriptor(value, 'length')
        if (Object.getPrototypeOf(value) !== Array.prototype || !length || !Object.hasOwn(length, 'value') || typeof length.value !== 'number' || !Number.isSafeInteger(length.value) || length.value > 64 || Reflect.ownKeys(value).length !== length.value + 1) return { ok: false }
        const result: unknown[] = []
        for (let index = 0; index < length.value; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
          if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return { ok: false }
          const child = visit(descriptor.value, depth + 1, ancestors)
          if (!child.ok) return child
          result.push(child.value)
        }
        return { ok: true, value: Object.freeze(result) }
      }
      const prototype = Object.getPrototypeOf(value)
      if (prototype !== Object.prototype && prototype !== null) return { ok: false }
      const keys = Reflect.ownKeys(value)
      if (keys.length > 64) return { ok: false }
      const result: Record<string, unknown> = {}
      for (const key of keys) {
        if (typeof key !== 'string' || key.length > 4096 || stringUnits < key.length) return { ok: false }
        stringUnits -= key.length
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return { ok: false }
        const child = visit(descriptor.value, depth + 1, ancestors)
        if (!child.ok) return child
        Object.defineProperty(result, key, { value: child.value, enumerable: true, writable: false, configurable: false })
      }
      return { ok: true, value: Object.freeze(result) }
    } catch {
      return { ok: false }
    } finally {
      ancestors.delete(value)
    }
  }
  return visit(input, 0, new WeakSet())
}

function isHomeAuthority(value: unknown): value is HomeAuthorityFact {
  if (!record(value)) return false
  const incarnation = value.residenceIncarnation, city = value.city, address = value.address
  const originalHome = value.originalHome, lifecycleRevision = value.lifecycleRevision, sceneRevision = value.sceneRevision
  return isHome(value) && typeof incarnation === 'string' && incarnation.length >= 8 && incarnation.length <= 128
    && typeof city === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(city)
    && typeof address === 'string' && address.length > 0 && address.length <= 512
    && typeof originalHome === 'boolean' && Number.isSafeInteger(lifecycleRevision) && typeof lifecycleRevision === 'number' && lifecycleRevision > 0
    && Number.isSafeInteger(sceneRevision) && typeof sceneRevision === 'number' && sceneRevision >= 0
}
export function isTrustedLifeAuthority(value: unknown): value is LifeAuthorityFact {
  if (!record(value)) return false
  const recordUpdatedAt = value.recordUpdatedAt, locationRevision = value.locationRevision, rawLocator = value.locator
  if (!isLifeFact(value) || !Number.isSafeInteger(recordUpdatedAt) || typeof recordUpdatedAt !== 'number' || recordUpdatedAt < 0 || !Number.isSafeInteger(locationRevision) || typeof locationRevision !== 'number' || locationRevision < 0) return false
  const locator = parseLifeLocator(rawLocator)
  return locator.ok && locator.value.lifeId === value.id && locator.value.characterId === value.who.character
    && (value.state === 'erased' ? locator.value.kind === 'erased' : locator.value.kind === 'located')
}
function isPairAuthority(value: unknown): value is PairAuthorityFact {
  if (!record(value)) return false
  const sourceARevision = value.sourceARevision, sourceBRevision = value.sourceBRevision
  return isPair(value) && Number.isSafeInteger(sourceARevision) && typeof sourceARevision === 'number' && sourceARevision > 0
    && Number.isSafeInteger(sourceBRevision) && typeof sourceBRevision === 'number' && sourceBRevision > 0
}
function isSafeAuthority(value: unknown): value is Authority {
  if (!record(value)) return false
  if (value.kind === 'actor') return isTrustedLifeAuthority(value.actor) && point(value.pair, isPairAuthority)
  if (value.kind !== 'system' || !identity(value.subject) || !oneOf(value.cause, ['blocked','unfriended','member_life_changed','owner_life_changed','character_erased','home_retired']) || !record(value.evidence)) return false
  if (value.evidence.kind === 'home') return true
  if (value.evidence.kind === 'life') return isTrustedLifeAuthority(value.evidence.value)
  return value.evidence.kind === 'pair' && isPairAuthority(value.evidence.value)
}
function isSystemAuthority(value: unknown): value is Extract<Authority, { readonly kind: 'system' }> {
  return isSafeAuthority(value) && value.kind === 'system'
}

/** Bounded JSON fingerprinting through data descriptors; accessors and exotic prototypes fail closed. */
function fingerprint(value: unknown): string | null {
  let budget = 2048
  const visit = (item: unknown, depth: number, ancestors: WeakSet<object>): string | null => {
    if (item === null) return 'null'
    if (typeof item === 'string') return item.length <= 4096 ? JSON.stringify(item) : null
    if (typeof item === 'number') return Number.isFinite(item) ? JSON.stringify(item) : null
    if (typeof item === 'boolean') return item ? 'true' : 'false'
    if (typeof item !== 'object' || depth > 12 || --budget < 0 || ancestors.has(item)) return null
    ancestors.add(item)
    try {
      if (Array.isArray(item)) {
        const length = Object.getOwnPropertyDescriptor(item, 'length')
        if (!length || !Object.hasOwn(length, 'value') || typeof length.value !== 'number' || !Number.isSafeInteger(length.value) || length.value > 64 || Object.getPrototypeOf(item) !== Array.prototype) return null
        const parts: string[] = []
        for (let index = 0; index < length.value; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index))
          if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) return null
          const part = visit(descriptor.value, depth + 1, ancestors)
          if (part === null) return null
          parts.push(part)
        }
        if (Reflect.ownKeys(item).length !== length.value + 1) return null
        return `[${parts.join(',')}]`
      }
      const prototype = Object.getPrototypeOf(item)
      if (prototype !== Object.prototype && prototype !== null) return null
      const keys = Reflect.ownKeys(item)
      if (keys.length > 64) return null
      const parts: string[] = []
      for (const key of keys) {
        if (typeof key !== 'string' || key.length > 256) return null
        const descriptor = Object.getOwnPropertyDescriptor(item, key)
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) return null
        const part = visit(descriptor.value, depth + 1, ancestors)
        if (part === null) return null
        parts.push(`${JSON.stringify(key)}:${part}`)
      }
      parts.sort()
      return `{${parts.join(',')}}`
    } catch {
      return null
    } finally {
      ancestors.delete(item)
    }
  }
  return visit(value, 0, new WeakSet())
}

function storedRevision(value: unknown): number | null {
  if (value === null || typeof value !== 'object') return null
  const descriptor = Object.getOwnPropertyDescriptor(value, 'revision')
  return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'number' ? descriptor.value : null
}

const asPoint = (stored: StoredPoint<unknown>): Point<unknown> => stored.state === 'invalid' ? { state: 'not-loaded' } : stored
const projectLife = (value: LifeFact): LifeFact => ({ id: value.id, revision: value.revision, who: { character: value.who.character, life: value.who.life }, state: value.state })
const projectPair = (value: PairFact): PairFact => ({ a: { character: value.a.character, life: value.a.life }, b: { character: value.b.character, life: value.b.life }, revision: value.revision, friends: value.friends, blocked: value.blocked })
const projectPoint = <T, U>(value: Point<T>, project: (item: T) => U): Point<U> => value.state === 'present' ? { state: 'present', value: project(value.value) } : value
function projectAuthority(value: Authority): Authority {
  if (value.kind === 'actor') return { kind: 'actor', actor: projectLife(value.actor), pair: projectPoint(value.pair, projectPair) }
  if (value.evidence.kind === 'life') return { ...value, evidence: { kind: 'life', value: projectLife(value.evidence.value) } }
  if (value.evidence.kind === 'pair') return { ...value, evidence: { kind: 'pair', value: projectPair(value.evidence.value) } }
  return { ...value, evidence: { kind: 'home' } }
}

/** Must be constructed inside the owner store's `transact` callback and discarded afterwards. */
export function createDurableConsentReads(
  db: Db,
  now: number,
  trusted: TrustedConsentAuthority,
  actorProof?: TrustedPoint<LifeAuthorityFact>,
): DurableConsentReads {
  const reads = new Map<string, Tracked>()
  const trustedReads: Array<() => boolean> = []
  if (actorProof) trustedReads.push(() => actorProof.verifyReadSet())
  const recordRead = (map: HouseholdMapName, key: string, stored: StoredPoint<unknown>): StoredPoint<unknown> => {
    const valueFingerprint = stored.state === 'present' ? fingerprint(stored.value) : null
    const revision = stored.state === 'present' ? storedRevision(stored.value) : null
    if (stored.state === 'present' && valueFingerprint === null) return { state: 'invalid' }
    const token = `${map}\u0000${key}`
    const next: Tracked = { map, key, fingerprint: valueFingerprint, revision }
    const prior = reads.get(token)
    if (prior && (prior.fingerprint !== next.fingerprint || prior.revision !== next.revision)) return { state: 'invalid' }
    reads.set(token, next)
    return stored
  }
  const read = (map: HouseholdMapName, key: string): Promise<Point<unknown>> => Promise.resolve(asPoint(recordRead(map, key, householdPoint(db, map, key))))
  const verifyReadSet = (): boolean => {
    for (const expected of reads.values()) {
      const current = householdPoint(db, expected.map, expected.key)
      if (current.state === 'invalid') return false
      if (expected.fingerprint === null) {
        if (current.state !== 'absent') return false
        continue
      }
      if (current.state !== 'present' || fingerprint(current.value) !== expected.fingerprint) return false
      if (storedRevision(current.value) !== expected.revision) return false
    }
    return true
  }
  const indexedCharacters = new Set<string>()
  const indexedLives = new Set<string>()
  const trustedPoint = async <T>(readTrusted: () => Promise<TrustedPoint<T>>, check: (value: unknown) => value is T): Promise<Point<T>> => {
    const result = await readTrusted()
    trustedReads.push(() => result.verifyReadSet())
    const safe = snapshotConsentValue(result.point)
    return safe.ok && point(safe.value, check) ? safe.value : { state: 'not-loaded' }
  }
  const transaction: ConsentReadTransaction = {
    now: () => now,
    sessionLife: async () => {
      const loaded = await trustedPoint(trusted.sessionLife, isTrustedLifeAuthority)
      if (actorProof) {
        const proofSnapshot = snapshotConsentValue(actorProof.point)
        const loadedSnapshot = snapshotConsentValue(loaded)
        if (!proofSnapshot.ok || !loadedSnapshot.ok || fingerprint(proofSnapshot.value) !== fingerprint(loadedSnapshot.value)) return { state: 'not-loaded' }
      }
      return projectPoint(loaded, projectLife)
    },
    systemAuthority: async () => projectPoint(await trustedPoint(trusted.systemAuthority, isSystemAuthority), projectAuthority),
    home: async id => {
      const home = await trustedPoint(() => trusted.home(id), isHomeAuthority)
      if (home.state === 'present' && home.value.id !== id) return { state: 'not-loaded' }
      return projectPoint(home, value => ({ id: value.id, revision: value.revision, owner: { character: value.owner.character, life: value.owner.life }, epoch: value.epoch, state: value.state }))
    },
    homeIndex: id => read('homeIndexes', id),
    household: id => read('households', id),
    characterIndex: id => { indexedCharacters.add(id); return read('characterIndexes', id) },
    lifeIndex: id => { indexedLives.add(id); return read('lifeIndexes', id) },
    lifeFact: async id => {
      const life = await trustedPoint(() => trusted.lifeFact(id), isTrustedLifeAuthority)
      if (life.state === 'present' && life.value.id !== id) return { state: 'not-loaded' }
      return projectPoint(life, projectLife)
    },
    pairFact: async (a, b) => {
      const pair = await trustedPoint(() => trusted.pairFact(a,b), isPairAuthority)
      if (pair.state !== 'present') return pair
      const forward = pair.value.a.character === a.character && pair.value.a.life === a.life && pair.value.b.character === b.character && pair.value.b.life === b.life
      const reverse = pair.value.a.character === b.character && pair.value.a.life === b.life && pair.value.b.character === a.character && pair.value.b.life === a.life
      return forward || reverse ? { state: 'present', value: projectPair(pair.value) } : { state: 'not-loaded' }
    },
    invite: id => read('invites', id),
    member: id => read('members', id),
    protectInviteRead: async (id: InviteId, revision: number): Promise<void> => {
      const token = `invites\u0000${id}`
      const prior = reads.get(token)
      if (!prior || prior.revision !== revision || prior.fingerprint === null) throw new Error('household_invite_readset_mismatch')
    },
  }
  return Object.freeze({ transaction, verifyReadSet: () => indexedCharacters.size <= 28 && indexedLives.size <= 11 && trustedReads.every(verify => verify()) && verifyReadSet() })
}
