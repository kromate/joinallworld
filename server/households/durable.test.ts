import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createStore } from '../store.ts'
import { createOnce } from '../routes/once.ts'
import { createSqliteStore } from '../../deploy/sqlite-store.ts'
import { testStorage } from '../testing/sqliteStorage.ts'
import { createHouseholdCollection, householdPoint } from './durableStorage.ts'
import { executeConsentCommand } from './durableService.ts'
import type { Db, SessionRecord, Store } from '../types.ts'
import type { HomeAuthorityFact, LifeAuthorityFact, TrustedConsentAuthority, TrustedPoint } from './durableReads.ts'
import type { Point } from './records.ts'
import { parseLifeIdentity, parseLifeLocator } from './lifeIdentity.ts'
import { parseCommand } from './records.ts'
import { createLife } from '../../src/life.ts'
import { loadCityContent } from '../../src/game/cities/registry.ts'

await loadCityContent('lagos')

const NOW = 1_800_000_000_000
const ids = Object.freeze({
  home: '00000000-0000-4000-8000-000000000001',
  household: '00000000-0000-4000-8000-000000000002',
  life: '00000000-0000-4000-8000-000000000003',
  character: '00000000-0000-4000-8000-000000000004',
  secret: '00000000-0000-4000-8000-000000000005',
  publicId: '00000000-0000-4000-8000-000000000006',
  request: '00000000-0000-4000-8000-000000000007',
})

function fixtureData() {
  const parsedLocator = parseLifeLocator({
    kind: 'located', lifeId: ids.life, characterId: ids.character, revision: 1,
    location: { kind: 'session', sessionKey: ids.secret, slot: { kind: 'city', city: 'lagos' } },
  })
  const parsedCommand = parseCommand({ op: 'register', householdId: ids.household, homeId: ids.home, epoch: 1 })
  if (!parsedLocator.ok || !parsedCommand || parsedCommand.op !== 'register') throw new Error('invalid durable fixture identity')
  const locator = parsedLocator.value
  const identity = parseLifeIdentity({ version: 1, lifeId: locator.lifeId })
  if (!identity.ok) throw new Error('invalid durable fixture session identity')
  const life: LifeAuthorityFact = {
    id: locator.lifeId, revision: 1, who: { character: locator.characterId, life: locator.lifeId }, state: 'available',
    locator, recordUpdatedAt: NOW, locationRevision: 1,
  }
  const home: HomeAuthorityFact = {
    id: parsedCommand.homeId, revision: 1, owner: life.who, epoch: 1, state: 'available',
    residenceIncarnation: 'incarnation-0001', city: 'lagos', address: 'plot:1', originalHome: true,
    lifecycleRevision: 1, sceneRevision: 0,
  }
  const households = createHouseholdCollection()
  households.homes[home.id] = home
  households.lifeFacts[life.id] = life
  const session: SessionRecord = {
    secret: ids.secret, publicId: ids.publicId, name: 'Test Person', expiresAt: NOW + 60_000,
    cities: { lagos: { state: createLife({ name: 'Test Person' }), updatedAt: NOW, salt: 'abcdefghijklmnop', identity: identity.value } },
    actions: {},
  }
  return { households, session, life, home }
}

function portsFor(counters: { homeReads: number }) {
  const track = <T>(db: Db, map: 'lifeFacts' | 'homes', key: string, check: (value: unknown) => value is T): TrustedPoint<T> => {
    const first = householdPoint(db, map, key)
    const point: Point<T> = first.state === 'present' && check(first.value)
      ? { state: 'present', value: first.value }
      : first.state === 'absent' ? { state: 'absent' } : { state: 'not-loaded' }
    return {
      point,
      verifyReadSet: () => {
        const next = householdPoint(db, map, key)
        return next.state === first.state && (next.state !== 'present' || first.state === 'present' && JSON.stringify(next.value) === JSON.stringify(first.value))
      },
    }
  }
  return {
    resolveSession(current: Db): SessionRecord | undefined {
      const value = current.sessions[ids.secret]
      return value?.secret === ids.secret && value.expiresAt > NOW ? value : undefined
    },
    authority(current: Db, session: SessionRecord): TrustedConsentAuthority {
      return {
        sessionLife: () => Promise.resolve(session.cities.lagos?.identity?.lifeId === ids.life
          ? track(current, 'lifeFacts', ids.life, (value): value is LifeAuthorityFact => value !== null && typeof value === 'object' && 'locator' in value && 'recordUpdatedAt' in value)
          : { point: { state: 'not-loaded' }, verifyReadSet: () => false }),
        systemAuthority: () => Promise.resolve({ point: { state: 'not-loaded' }, verifyReadSet: () => true }),
        home: id => { counters.homeReads += 1; return Promise.resolve(track(current, 'homes', id, (value): value is HomeAuthorityFact => value !== null && typeof value === 'object' && 'residenceIncarnation' in value)) },
        lifeFact: id => Promise.resolve(track(current, 'lifeFacts', id, (value): value is LifeAuthorityFact => value !== null && typeof value === 'object' && 'locator' in value && 'recordUpdatedAt' in value)),
        pairFact: () => Promise.resolve({ point: { state: 'not-loaded' }, verifyReadSet: () => true }),
      }
    },
  }
}

function context(store: Store) {
  const once = createOnce({ now: () => NOW, windowMs: 86_400_000 })
  return { store, once: once.once, onceId: once.onceId, now: () => NOW }
}

function descriptor(): { id: `${number}:${string}`; kind: string; fingerprint: string } {
  return { id: `${NOW}:${ids.request}`, kind: 'external-untrusted-kind', fingerprint: '' }
}
const command = () => ({ op: 'register', householdId: ids.household, homeId: ids.home, epoch: 1 })
const object = (value: unknown): value is object => value !== null && typeof value === 'object'

test('storage edge rejects accessors without invoking them and propagates point-read faults', () => {
  const root = createHouseholdCollection()
  let getterCalls = 0
  Object.defineProperty(root.households, ids.household, {
    enumerable: true,
    get: () => { getterCalls += 1; return { id: ids.household } },
  })
  assert.deepEqual(householdPoint({ households: root }, 'households', ids.household), { state: 'invalid' })
  assert.equal(getterCalls, 0)

  const faultyRows = new Proxy<Record<string, unknown>>({}, {
    getOwnPropertyDescriptor(_target, key) {
      if (key === ids.household) throw new Error('injected point storage fault')
      return undefined
    },
  })
  const faultyRoot = createHouseholdCollection()
  faultyRoot.households = faultyRows
  assert.throws(() => householdPoint({ households: faultyRoot }, 'households', ids.household), /injected point storage fault/)
})

test('Node file Store: durable register receipt reopens and duplicate avoids current home loading', async t => {
  const data = fixtureData()
  const directory = await mkdtemp(join(tmpdir(), 'household-durable-node-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(join(directory, 'devices.json'), JSON.stringify({ version: 1, sessions: { [ids.secret]: data.session }, households: data.households }))
  const store = await createStore(directory, { layout: 'entries', now: () => NOW, log: () => {} })
  const counters = { homeReads: 0 }
  const ports = portsFor(counters)
  const first = await executeConsentCommand(context(store), {
    ...ports,
  }, descriptor(), command())
  assert.equal(first.ok, true)
  if (!first.ok) return
  assert.equal(first.duplicate, false)
  assert.equal(first.events[0]?.kind, 'household-opened')
  const persisted: unknown = JSON.parse(await readFile(join(directory, 'devices.json'), 'utf8'))
  if (!object(persisted)) throw new Error('persisted store document is malformed')
  const stored = Reflect.get(persisted, 'households')
  if (!object(stored)) throw new Error('persisted household collection is missing')
  const rows = Reflect.get(stored, 'households')
  if (!object(rows)) throw new Error('persisted household rows are missing')
  const storedHousehold = Reflect.get(rows, ids.household)
  if (!object(storedHousehold)) throw new Error('persisted household row is missing')
  assert.equal(Reflect.get(storedHousehold, 'state'), 'open')
  const sessions = Reflect.get(persisted, 'sessions')
  if (!object(sessions)) throw new Error('persisted sessions are missing')
  const storedSession = Reflect.get(sessions, ids.secret)
  if (!object(storedSession)) throw new Error('persisted session is missing')
  const receipts = Reflect.get(storedSession, 'once')
  if (!object(receipts)) throw new Error('persisted once receipts are missing')
  assert.ok(Reflect.get(receipts, descriptor().id))
  await store.close?.()

  const reopened = await createStore(directory, { layout: 'entries', now: () => NOW, log: () => {} })
  counters.homeReads = 0
  const replay = await executeConsentCommand(context(reopened), {
    ...ports,
  }, descriptor(), command())
  assert.equal(replay.ok, true)
  if (!replay.ok) return
  assert.equal(replay.duplicate, true)
  assert.equal(counters.homeReads, 0)
  const reopenedHousehold = await reopened.read(db => db.households?.households[ids.household])
  if (!object(reopenedHousehold)) throw new Error('reopened Node household row is missing')
  assert.equal(Reflect.get(reopenedHousehold, 'state'), 'open')
  await reopened.close?.()
})

test('Node file Store: a failed durable write rejects without household or once receipt', async t => {
  const data = fixtureData()
  const directory = await mkdtemp(join(tmpdir(), 'household-durable-node-failure-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(join(directory, 'devices.json'), JSON.stringify({ version: 1, sessions: { [ids.secret]: data.session }, households: data.households }))
  const store = await createStore(directory, {
    layout: 'entries', now: () => NOW, log: () => {},
    io: { writeFile: async () => { throw new Error('injected durable file failure') } },
  })
  const result = executeConsentCommand(context(store), portsFor({ homeReads: 0 }), descriptor(), command())
  await assert.rejects(result, /storage_unavailable|injected durable file failure/)
  assert.equal(await store.read(db => db.households?.households[ids.household]), undefined)
  assert.equal(await store.read(db => db.sessions[ids.secret]?.once?.[descriptor().id]), undefined)
  await store.close()
})

test('Worker SQLite Store: entries commit and close/reopen receipt replay share the real transaction layer', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'household-durable-worker-'))
  let database = new DatabaseSync(join(directory, 'worker.sqlite'))
  t.after(async () => { database.close(); await rm(directory, { recursive: true, force: true }) })
  const underlying = testStorage(database)
  const data = fixtureData()
  const store = createSqliteStore(underlying.storage, { layout: 'entries' })
  await store.transact(draft => {
    draft.sessions[ids.secret] = data.session
    draft.households = data.households
  })
  const counters = { homeReads: 0 }
  const first = await executeConsentCommand(context(store), portsFor(counters), descriptor(), command())
  assert.equal(first.ok, true)
  if (!first.ok) return
  assert.equal(first.duplicate, false)
  assert.equal(first.events[0]?.kind, 'household-opened')
  const entryCount = database.prepare('SELECT COUNT(*) AS n FROM entries WHERE coll = ?').get('households')
  const receiptCount = database.prepare('SELECT COUNT(*) AS n FROM once_receipts').get()
  if (!object(entryCount) || !object(receiptCount)) throw new Error('Worker SQLite count query returned no row')
  assert.equal(Number(Reflect.get(entryCount, 'n')) > 0, true)
  const receiptRows = Number(Reflect.get(receiptCount, 'n'))
  assert.equal(receiptRows, 1)

  database.close()
  database = new DatabaseSync(join(directory, 'worker.sqlite'))
  const reopened = createSqliteStore(testStorage(database).storage, { layout: 'entries' })
  counters.homeReads = 0
  const replay = await executeConsentCommand(context(reopened), portsFor(counters), descriptor(), command())
  assert.equal(replay.ok, true)
  if (!replay.ok) return
  assert.equal(replay.duplicate, true)
  assert.equal(counters.homeReads, 0)
  const reopenedHousehold = await reopened.read(draft => draft.households?.households[ids.household])
  if (!object(reopenedHousehold)) throw new Error('reopened Worker household row is missing')
  assert.equal(Reflect.get(reopenedHousehold, 'state'), 'open')
})

test('Worker SQLite Store: SQL entry failure rolls back the household row and once receipt', async t => {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  const underlying = testStorage(db)
  const data = fixtureData()
  const store = createSqliteStore(underlying.storage, { layout: 'entries' })
  await store.transact(draft => {
    draft.sessions[ids.secret] = data.session
    draft.households = data.households
  })
  db.exec("CREATE TRIGGER fail_household_entry BEFORE INSERT ON entries WHEN NEW.coll = 'households' BEGIN SELECT RAISE(ABORT, 'injected household entry failure'); END")
  const result = executeConsentCommand(context(store), portsFor({ homeReads: 0 }), descriptor(), command())
  await assert.rejects(result)
  assert.equal(await store.read(draft => draft.households?.households[ids.household]), undefined)
  assert.equal(await store.read(draft => draft.sessions[ids.secret]?.once?.[descriptor().id]), undefined)
})
