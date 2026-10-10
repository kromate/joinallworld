/**
 * Shared test fixtures: persisted household state shaped like the durable layout, two real
 * stores (the Node file store and the Worker SQLite store), and same-transaction trusted readers.
 * The Worker store here is the real createSqliteStore over a node:sqlite database, not workerd.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { createStore } from '../store.ts'
import { createOnce } from '../routes/once.ts'
import { createSqliteStore } from '../../deploy/sqlite-store.ts'
import { testStorage } from '../testing/sqliteStorage.ts'
import { createLife } from '../../src/life.ts'
import { loadCityContent } from '../../src/game/cities/registry.ts'
import { createHouseholdCollection, householdPoint, type HouseholdCollection } from './durableStorage.ts'
import { parseLifeIdentity, parseLifeLocator } from './lifeIdentity.ts'
import { LIMITS, PERMISSIONS, id as isId, type Authority, type CharacterId, type HomeId, type Household, type HouseholdId, type Id, type Identity, type Invite, type InviteId, type LifeId, type Member, type MembershipId, type PairFact, type Point } from './records.ts'
import type { ConsentReadTransaction, ConsentViewLoad } from './consentView.ts'
import type { HomeAuthorityFact, LifeAuthorityFact, PairAuthorityFact, TrustedConsentAuthority, TrustedPoint } from './durableReads.ts'
import type { ConsentServicePorts } from './durableService.ts'
import type { Db, SessionRecord, Store } from '../types.ts'

await loadCityContent('lagos')

export const NOW = 1_800_000_000_000
export const SECRET = '00000000-0000-4000-8000-0000000000a1'
export const PUBLIC_ID = '00000000-0000-4000-8000-0000000000a2'
const uid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
function brand<K extends string>(n: number): Id<K> {
  const value = uid(n)
  if (!isId<K>(value)) throw new Error('invalid fixture id')
  return value
}
export const characterId = (n: number): CharacterId => brand<'character'>(n)
export const lifeId = (n: number): LifeId => brand<'life'>(n)
const homeId = (n: number): HomeId => brand<'home'>(n)
const householdId = (n: number): HouseholdId => brand<'household'>(n)
const inviteId = (n: number): InviteId => brand<'invite'>(n)
const membershipId = (n: number): MembershipId => brand<'membership'>(n)
const who = (n: number): Identity => ({ character: characterId(n), life: lifeId(n) })

/** People: 1 owner, 2 pending invitee, 3 active member, 4 a person not yet invited. */
export const people = Object.freeze({ owner: who(1), invitee: who(2), member: who(3), stranger: who(4) })
export const rowIds = Object.freeze({
  home: homeId(10), household: householdId(11),
  acceptedInvite: inviteId(12), pendingInvite: inviteId(13), newInvite: inviteId(14),
  membership: membershipId(15), newMembership: membershipId(16),
  otherKeyInvite: inviteId(17),
  request: uid(99),
})

export const pairKeyOf = (a: Identity, b: Identity): string => [a.character, b.character].sort().join(':')

export function locatorFor(person: Identity, revision = 1) {
  const parsed = parseLifeLocator({
    kind: 'located', lifeId: person.life, characterId: person.character, revision,
    location: { kind: 'session', sessionKey: SECRET, slot: { kind: 'city', city: 'lagos' } },
  })
  if (!parsed.ok) throw new Error('invalid fixture locator')
  return parsed.value
}
export function lifeFactFor(person: Identity, mutable: { revision?: number; recordUpdatedAt?: number; locationRevision?: number; locatorRevision?: number } = {}): LifeAuthorityFact {
  return {
    id: person.life, revision: mutable.revision ?? 1, who: person, state: 'available',
    locator: locatorFor(person, mutable.locatorRevision ?? 1),
    recordUpdatedAt: mutable.recordUpdatedAt ?? NOW, locationRevision: mutable.locationRevision ?? 1,
  }
}
export const homeFact = (): HomeAuthorityFact => ({
  id: rowIds.home, revision: 1, owner: people.owner, epoch: 1, state: 'available',
  residenceIncarnation: 'incarnation-0001', city: 'lagos', address: 'plot:1', originalHome: true,
  lifecycleRevision: 1, sceneRevision: 0,
})
export const pairFactFor = (a: Identity, b: Identity, flags: { friends: boolean; blocked: boolean }): PairAuthorityFact => ({
  a, b, revision: 1, friends: flags.friends, blocked: flags.blocked, sourceARevision: 1, sourceBRevision: 1,
})

export type WorldOptions = Readonly<{
  /** false: the home exists but nothing has been registered on it. */
  registered?: boolean
  /** When the pending invitation was created. */
  pendingCreatedAt?: number
  /** Whether owner and invitee are friends in the stored pair facts. */
  pairs?: Readonly<{ invitee?: 'friends' | 'blocked' | 'unqueried-absent'; stranger?: 'friends' | 'absent' }>
}>

/** Persisted household collection shaped like real durable state. */
export function worldCollection(options: WorldOptions = {}): HouseholdCollection {
  const c = createHouseholdCollection()
  const registered = options.registered ?? true
  const { owner, invitee, member, stranger } = people
  c.homes[rowIds.home] = homeFact()
  for (const person of [owner, invitee, member, stranger]) c.lifeFacts[person.life] = lifeFactFor(person)
  const pairs = options.pairs ?? {}
  const inviteePair = pairs.invitee ?? 'friends'
  if (inviteePair !== 'unqueried-absent') c.pairFacts[pairKeyOf(owner, invitee)] = pairFactFor(owner, invitee, { friends: inviteePair === 'friends', blocked: inviteePair === 'blocked' })
  if ((pairs.stranger ?? 'friends') === 'friends') c.pairFacts[pairKeyOf(owner, stranger)] = pairFactFor(owner, stranger, { friends: true, blocked: false })
  if (!registered) return c
  const createdAt = NOW - 700_000_000
  const lastEventAt = NOW - 60_000
  const acceptedInviteCreated = NOW - 690_000_000
  const household: Household = {
    id: rowIds.household, revision: 3, state: 'open', homeId: rowIds.home, epoch: 1, owner,
    createdAt, lastEventAt, active: [rowIds.membership], pending: [rowIds.pendingInvite],
  }
  const accepted: Invite = {
    id: rowIds.acceptedInvite, revision: 1, state: 'accepted', householdId: rowIds.household, homeId: rowIds.home, epoch: 1,
    owner, recipient: member, permissions: PERMISSIONS, createdAt: acceptedInviteCreated, expiresAt: acceptedInviteCreated + LIMITS.inviteMs,
    answeredAt: acceptedInviteCreated + 100, membershipId: rowIds.membership,
  }
  const pendingCreated = options.pendingCreatedAt ?? NOW - 1_000_000
  const pending: Invite = {
    id: rowIds.pendingInvite, revision: 0, state: 'pending', householdId: rowIds.household, homeId: rowIds.home, epoch: 1,
    owner, recipient: invitee, permissions: PERMISSIONS, createdAt: pendingCreated, expiresAt: pendingCreated + LIMITS.inviteMs,
  }
  const membership: Member = {
    id: rowIds.membership, revision: 0, state: 'active', householdId: rowIds.household, homeId: rowIds.home, epoch: 1,
    inviteId: rowIds.acceptedInvite, owner, member, permissions: PERMISSIONS, acceptedAt: acceptedInviteCreated + 100,
  }
  c.households[household.id] = household
  c.invites[accepted.id] = accepted
  c.invites[pending.id] = pending
  c.members[membership.id] = membership
  c.homeIndexes[rowIds.home] = { id: rowIds.home, revision: 1, householdId: rowIds.household }
  c.characterIndexes[owner.character] = { id: owner.character, revision: 2, hosted: [rowIds.household], joined: [], incoming: [] }
  c.characterIndexes[invitee.character] = { id: invitee.character, revision: 1, hosted: [], joined: [], incoming: [rowIds.pendingInvite] }
  c.characterIndexes[member.character] = { id: member.character, revision: 1, hosted: [], joined: [rowIds.membership], incoming: [] }
  c.lifeIndexes[member.life] = { id: member.life, revision: 1, joined: [rowIds.membership] }
  return c
}

export function sessionRecord(): SessionRecord {
  const identity = parseLifeIdentity({ version: 1, lifeId: people.owner.life })
  if (!identity.ok) throw new Error('invalid fixture session identity')
  return {
    secret: SECRET, publicId: PUBLIC_ID, name: 'Test Person', expiresAt: NOW + 60_000,
    cities: { lagos: { state: createLife({ name: 'Test Person' }), updatedAt: NOW, salt: 'abcdefghijklmnop', identity: identity.value } },
    actions: {},
  }
}

export type HostKind = 'node-file-store' | 'worker-sqlite-store (node:sqlite, not workerd)'
export interface Host {
  readonly kind: HostKind
  store: Store
  /** Close and open the same persisted data again. */
  reopen(): Promise<Store>
  /** The stored once receipts of the session, as stable text. */
  receipts(): Promise<string>
  /** Everything persisted under households, as stable text. */
  households(): Promise<string>
  cleanup(): Promise<void>
}
const text = (value: unknown): string => JSON.stringify(value)

export async function openHost(kind: HostKind, seed: HouseholdCollection | null): Promise<Host> {
  const session = sessionRecord()
  if (kind === 'node-file-store') {
    const directory = await mkdtemp(join(tmpdir(), 'household-runtime-node-'))
    await writeFile(join(directory, 'devices.json'), JSON.stringify({ version: 1, sessions: { [SECRET]: session }, ...(seed ? { households: seed } : {}) }))
    const open = (): Promise<Store> => createStore(directory, { layout: 'entries', now: () => NOW, log: () => {} })
    const host: Host = {
      kind, store: await open(),
      async reopen() { await host.store.close?.(); host.store = await open(); return host.store },
      async receipts() { await host.store.close?.(); const doc: unknown = JSON.parse(await readFile(join(directory, 'devices.json'), 'utf8')); host.store = await open(); return text(onceOf(doc)) },
      async households() { await host.store.close?.(); const doc: unknown = JSON.parse(await readFile(join(directory, 'devices.json'), 'utf8')); host.store = await open(); return text(householdsOf(doc)) },
      async cleanup() { await host.store.close?.(); await rm(directory, { recursive: true, force: true }) },
    }
    return host
  }
  const directory = await mkdtemp(join(tmpdir(), 'household-runtime-worker-'))
  let database = new DatabaseSync(join(directory, 'worker.sqlite'))
  const open = (): Store => createSqliteStore(testStorage(database).storage, { layout: 'entries' })
  const store = open()
  await store.transact(draft => { draft.sessions[SECRET] = session; if (seed) draft.households = seed })
  const host: Host = {
    kind, store,
    async reopen() { database.close(); database = new DatabaseSync(join(directory, 'worker.sqlite')); host.store = open(); return host.store },
    async receipts() { return text(database.prepare('SELECT * FROM once_receipts ORDER BY 1, 2').all()) },
    async households() { return text(database.prepare("SELECT * FROM entries WHERE coll = 'households' ORDER BY 1, 2, 3").all()) },
    async cleanup() { database.close(); await rm(directory, { recursive: true, force: true }) },
  }
  return host
}
const rec = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object'
function onceOf(doc: unknown): unknown {
  if (!rec(doc) || !rec(doc['sessions'])) return null
  const session = doc['sessions'][SECRET]
  return rec(session) ? session['once'] ?? null : null
}
function householdsOf(doc: unknown): unknown { return rec(doc) ? doc['households'] ?? null : null }

export const hostKinds: readonly HostKind[] = ['node-file-store', 'worker-sqlite-store (node:sqlite, not workerd)']

export function onceContext(store: Store) {
  const once = createOnce({ now: () => NOW, windowMs: 86_400_000 })
  return { store, once: once.once, onceId: once.onceId, now: () => NOW }
}
export const requestId = (n = 1): `${number}:${string}` => `${NOW}:${uid(900 + n)}`

type Tracker = { reads: number; pairReads: number; homeReads: number }
export const newTracker = (): Tracker => ({ reads: 0, pairReads: 0, homeReads: 0 })

const lifeGuard = (value: unknown): value is LifeAuthorityFact => rec(value) && 'locator' in value && 'recordUpdatedAt' in value
const homeGuard = (value: unknown): value is HomeAuthorityFact => rec(value) && 'residenceIncarnation' in value
const pairGuard = (value: unknown): value is PairAuthorityFact => rec(value) && 'sourceARevision' in value

function trackPoint<T>(db: Db, map: 'lifeFacts' | 'homes' | 'pairFacts', key: string, check: (value: unknown) => value is T): TrustedPoint<T> {
  const first = householdPoint(db, map, key)
  const point: Point<T> = first.state === 'present' && check(first.value)
    ? { state: 'present', value: first.value }
    : first.state === 'absent' ? { state: 'absent' } : { state: 'not-loaded' }
  return {
    point,
    verifyReadSet: () => {
      const next = householdPoint(db, map, key)
      return next.state === first.state && (next.state !== 'present' || text(next.value) === text(first.value))
    },
  }
}

export type SystemSpec = Readonly<{ kind: 'system'; subject: Identity; cause: 'blocked' | 'home_retired'; evidence: 'home' | 'pair' }>

/** Trusted same-transaction readers over the genuine store; the session life is the given person. */
export function trustedFor(db: Db, actor: Identity, tracker: Tracker, options: { system?: SystemSpec; pairNotLoaded?: boolean } = {}): TrustedConsentAuthority {
  return {
    sessionLife: () => Promise.resolve(trackPoint(db, 'lifeFacts', actor.life, lifeGuard)),
    systemAuthority: () => {
      const spec = options.system
      if (!spec) return Promise.resolve({ point: { state: 'absent' }, verifyReadSet: () => true })
      const evidence = spec.evidence === 'home'
        ? { kind: 'home' as const }
        : { kind: 'pair' as const, value: pairFactFor(people.owner, spec.subject, { friends: false, blocked: true }) }
      const value: Authority = { kind: 'system', subject: spec.subject, cause: spec.cause, evidence }
      return Promise.resolve({ point: { state: 'present', value }, verifyReadSet: () => true })
    },
    home: key => { tracker.homeReads += 1; return Promise.resolve(trackPoint(db, 'homes', key, homeGuard)) },
    lifeFact: key => Promise.resolve(trackPoint(db, 'lifeFacts', key, lifeGuard)),
    pairFact: (a, b) => {
      tracker.pairReads += 1
      if (options.pairNotLoaded) return Promise.resolve({ point: { state: 'not-loaded' }, verifyReadSet: () => true })
      return Promise.resolve(trackPoint(db, 'pairFacts', pairKeyOf(a, b), pairGuard))
    },
  }
}

export function portsFor(tracker: Tracker, actor: Identity = people.owner): ConsentServicePorts {
  return {
    resolveSession(db: Db): SessionRecord | undefined {
      const value = db.sessions[SECRET]
      return value?.secret === SECRET && value.expiresAt > NOW ? value : undefined
    },
    authority: (db: Db) => trustedFor(db, actor, tracker),
  }
}

export type PairView = PairFact

type LoadFn = (raw: unknown, tx: ConsentReadTransaction) => Promise<ConsentViewLoad>
const isLoad = (value: unknown): value is ConsentViewLoad => rec(value) && typeof value['ok'] === 'boolean'
/**
 * The loader under test. Set HOUSEHOLD_LOADER_UNDER_TEST to a module path to run the same tests
 * against a different copy of the loader, for comparison with an older revision.
 */
export async function loaderUnderTest(): Promise<LoadFn> {
  const override = process.env['HOUSEHOLD_LOADER_UNDER_TEST']
  const module: unknown = await import(override ? pathToFileURL(resolve(override)).href : './consentView.ts')
  const fn: unknown = rec(module) ? module['loadConsentView'] : undefined
  if (typeof fn !== 'function') throw new Error('loader module has no loadConsentView')
  return async (raw, tx) => {
    const out: unknown = await Reflect.apply(fn, undefined, [raw, tx])
    if (!isLoad(out)) throw new Error('loader returned a malformed result')
    return out
  }
}
