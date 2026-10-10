/**
 * Hostile-input tests for the consent loader and the household storage edge: accessors (own and
 * inherited), proxies, polluted prototypes, throwing values and an abort during a load.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHouseholdCollection, householdPoint } from './durableStorage.ts'
import { applyConsentPatch } from './durableApply.ts'
import {
  NOW, hostKinds, loaderUnderTest, openHost, people, rowIds, worldCollection,
} from './runtimeFixtures.ts'
import type { ConsentReadTransaction } from './consentView.ts'
import type { Authority, Household, Point, Result } from './records.ts'
import type { Db } from '../types.ts'

const register = { op: 'register', householdId: rowIds.household, homeId: rowIds.home, epoch: 1 }
const plain = worldCollection({ registered: false })
const present = (value: unknown): Point<unknown> => ({ state: 'present', value })
const absent: Point<unknown> = { state: 'absent' }

/** A transaction over plain in-memory rows for the register operation; any read can be replaced. */
function fakeTx(overrides: Partial<ConsentReadTransaction> = {}): ConsentReadTransaction & { reads: string[] } {
  const reads: string[] = []
  const note = <T>(name: string, value: T): Promise<T> => { reads.push(name); return Promise.resolve(value) }
  const tx: ConsentReadTransaction = {
    now: () => NOW,
    sessionLife: () => note('sessionLife', present({ id: people.owner.life, revision: 1, who: people.owner, state: 'available' })),
    systemAuthority: () => note('systemAuthority', absent) as Promise<Point<Authority>>,
    home: () => note('home', present({ id: rowIds.home, revision: 1, owner: people.owner, epoch: 1, state: 'available' })),
    homeIndex: () => note('homeIndex', absent),
    household: () => note('household', absent),
    characterIndex: () => note('characterIndex', absent),
    lifeIndex: () => note('lifeIndex', absent),
    lifeFact: () => note('lifeFact', absent),
    pairFact: () => note('pairFact', absent),
    invite: () => note('invite', absent),
    member: () => note('member', absent),
    protectInviteRead: () => note('protect', undefined),
    ...overrides,
  }
  return Object.assign(tx, { reads })
}
const homeRow = () => ({ id: rowIds.home, revision: 1, owner: people.owner, epoch: 1, state: 'available' })

test('baseline: the plain in-memory transaction loads a register view', async () => {
  const load = await loaderUnderTest()
  const out = await load(register, fakeTx())
  assert.equal(out.ok, true)
  assert.ok(plain.homes[rowIds.home])
})

test('command: own and inherited getters, throwing and lying proxies are refused without running anything', async () => {
  const load = await loaderUnderTest()
  let hits = 0
  const own = { ...register }
  Object.defineProperty(own, 'householdId', { enumerable: true, get() { hits += 1; return rowIds.household } })
  const inherited = Object.create({ get householdId() { hits += 1; return rowIds.household } }, {
    op: { value: 'register', enumerable: true }, homeId: { value: rowIds.home, enumerable: true }, epoch: { value: 1, enumerable: true },
  })
  const throwing = new Proxy({ ...register }, { ownKeys() { hits += 1; throw new Error('trap') } })
  const lying = new Proxy({ ...register }, {
    get() { hits += 1; return rowIds.household },
    getOwnPropertyDescriptor() { return { configurable: true, enumerable: true, get() { hits += 1; return rowIds.household } } },
  })
  for (const hostile of [own, inherited, lying]) {
    const tx = fakeTx()
    const out = await load(hostile, tx)
    assert.equal(out.ok, false)
    assert.equal('view' in out, false, 'no partial view may escape')
    assert.deepEqual(tx.reads, [], 'no storage read may happen for an unparsed command')
  }
  const thrown = await load(throwing, fakeTx())
  assert.equal(thrown.ok, false)
  assert.equal(hits, 1, 'only the throwing proxy trap ran; no getter and no get trap')
})

test('command: a __proto__ key does not pollute and does not become authority', async () => {
  const load = await loaderUnderTest()
  const command: unknown = JSON.parse(`{"op":"register","householdId":"${rowIds.household}","homeId":"${rowIds.home}","epoch":1,"__proto__":{"polluted":true,"op":"close"}}`)
  const out = await load(command, fakeTx())
  assert.equal(Reflect.get(Object.prototype, 'polluted'), undefined)
  assert.equal(Reflect.get({}, 'op'), undefined)
  if (out.ok) assert.equal(out.command.op, 'register')
})

test('storage rows: getters, inherited getters, proxies and polluted prototypes are refused without running them', async () => {
  const load = await loaderUnderTest()
  let hits = 0
  const getterRow = { ...homeRow() }
  Object.defineProperty(getterRow, 'id', { enumerable: true, get() { hits += 1; return rowIds.home } })
  const inheritedRow = Object.create({ get id() { hits += 1; return rowIds.home } }, {
    revision: { value: 1, enumerable: true }, owner: { value: people.owner, enumerable: true }, epoch: { value: 1, enumerable: true }, state: { value: 'available', enumerable: true },
  })
  const nestedGetter = { ...homeRow(), owner: Object.defineProperty({ character: people.owner.character }, 'life', { enumerable: true, get() { hits += 1; return people.owner.life } }) }
  const lyingProxy = new Proxy(homeRow(), {
    get() { hits += 1; return rowIds.home },
    getOwnPropertyDescriptor() { return { configurable: true, enumerable: true, get() { hits += 1; return rowIds.home } } },
  })
  const throwingProxy = new Proxy(homeRow(), { getOwnPropertyDescriptor() { throw new Error('trap fault') } })
  const getterPoint = Object.defineProperty({ state: 'present' }, 'value', { enumerable: true, get() { hits += 1; return homeRow() } })
  for (const hostile of [getterRow, inheritedRow, nestedGetter, lyingProxy, throwingProxy, present(getterPoint)]) {
    const out = await load(register, fakeTx({ home: () => Promise.resolve((hostile === getterPoint ? getterPoint : present(hostile)) as Point<unknown>) as never }))
    assert.equal(out.ok, false)
    assert.equal('view' in out, false)
  }
  const out = await load(register, fakeTx({ home: (() => Promise.resolve(getterPoint)) as never }))
  assert.equal(out.ok, false)
  assert.equal(hits, 0, 'no getter or get trap ran')

  Object.defineProperty(Object.prototype, 'state', { value: 'absent', configurable: true, writable: true })
  try {
    // An empty row must not read an inherited absent state from a polluted prototype.
    const polluted = await load(register, fakeTx({ household: () => Promise.resolve({}) as unknown as Promise<Point<unknown>> }))
    assert.equal(polluted.ok, false)
  } finally { delete (Object.prototype as Record<string, unknown>)['state'] }
})

test('a storage fault or an abort during the load rejects the load and is never read as absence', async () => {
  const load = await loaderUnderTest()
  const fault = new Error('injected storage fault')
  await assert.rejects(load(register, fakeTx({ household: () => Promise.reject(fault) })), (error: unknown) => error === fault)
  await assert.rejects(load(register, fakeTx({ homeIndex: () => { throw fault } })), (error: unknown) => error === fault)

  const controller = new AbortController()
  const tx = fakeTx()
  const waiting = fakeTx({
    household: () => new Promise<Point<unknown>>((_resolve, reject) => {
      tx.reads.push('household')
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
    }),
    homeIndex: tx.homeIndex,
    home: tx.home,
  })
  const pending = load(register, { ...waiting, sessionLife: () => { tx.reads.push('sessionLife'); return tx.sessionLife() } })
  setTimeout(() => controller.abort(new DOMException('aborted mid-load', 'AbortError')), 5)
  await assert.rejects(pending, (error: unknown) => error instanceof DOMException && error.name === 'AbortError')
  assert.ok(!tx.reads.includes('sessionLife'), 'no read is started after the abort rejected the load')
})

test('storage edge: root descriptors are never evaluated through getters, own or inherited', () => {
  let hits = 0
  const getterRoot = (): Record<string, unknown> => Object.defineProperty(createHouseholdCollection() as unknown as Record<string, unknown>, 'version', { enumerable: true, get() { hits += 1; return 1 } })
  const inheritedRoot = Object.create({ get households() { hits += 1; return createHouseholdCollection() } })
  const ownAccessorRoot = Object.defineProperty({}, 'households', { enumerable: true, get() { hits += 1; return createHouseholdCollection() } })
  const mapAccessor = Object.defineProperty(createHouseholdCollection(), 'invites', { enumerable: true, get() { hits += 1; return {} } })
  assert.deepEqual(householdPoint(inheritedRoot, 'households', rowIds.household), { state: 'absent' })
  assert.deepEqual(householdPoint(ownAccessorRoot, 'households', rowIds.household), { state: 'invalid' })
  assert.deepEqual(householdPoint({ households: getterRoot() }, 'households', rowIds.household), { state: 'invalid' })
  assert.deepEqual(householdPoint({ households: mapAccessor }, 'invites', rowIds.acceptedInvite), { state: 'invalid' })
  assert.equal(hits, 0)
})

const household: Household = {
  id: rowIds.household, revision: 0, state: 'open', homeId: rowIds.home, epoch: 1, owner: people.owner,
  createdAt: NOW, lastEventAt: NOW, active: [], pending: [],
}
const patch: Result = {
  ok: true, expected: [{ collection: 'households', id: rowIds.household, revision: null }],
  writes: [{ collection: 'households', value: household }], events: [], liabilities: [],
}

test('apply: an inherited root getter is not evaluated; a fresh own root is created only on an ordinary object', () => {
  let hits = 0
  const db = Object.create({ get households() { hits += 1; return createHouseholdCollection() } })
  assert.deepEqual(applyConsentPatch(db, patch), { ok: false, code: 'invalid_storage' })
  assert.equal(hits, 0)
  assert.equal(Object.hasOwn(db, 'households'), false)
  const ordinary = Object.create({ unrelated: 1 })
  assert.equal(applyConsentPatch(ordinary, patch).ok, true)
  assert.equal(householdPoint(ordinary, 'households', rowIds.household).state, 'present')

  const accessor = Object.defineProperty({}, 'households', { enumerable: true, get() { hits += 1; return createHouseholdCollection() } })
  const refused = applyConsentPatch(accessor, patch)
  assert.equal(refused.ok, false, 'an own accessor root is refused (the expectation read already reports it)')
  assert.equal(hits, 0)
})

for (const kind of hostKinds) {
  test(`${kind}: genuine keyed roots still work together with the absent-root rule`, async () => {
    // No household root at all: absent, and the first apply creates and persists it.
    const empty = await openHost(kind, null)
    try {
      const created = await empty.store.transact(db => {
        const before = householdPoint(db as Db, 'households', rowIds.household)
        return { before, applied: applyConsentPatch(db as Db, patch) }
      })
      assert.deepEqual(created.before, { state: 'absent' })
      assert.equal(created.applied.ok, true)
      const reopened = await empty.reopen()
      const row = await reopened.read(db => householdPoint(db as Db, 'households', rowIds.household).state)
      assert.equal(row, 'present')
    } finally { await empty.cleanup() }

    // An existing genuine root (keyed on the Worker, placeholder descriptor on Node): points read, new rows apply.
    const seeded = await openHost(kind, worldCollection())
    try {
      const out = await seeded.store.transact(db => {
        const existing = householdPoint(db as Db, 'households', rowIds.household).state
        const missing = householdPoint(db as Db, 'households', rowIds.newInvite).state
        const second: Result = {
          ok: true, expected: [{ collection: 'households', id: rowIds.newInvite, revision: null }],
          writes: [{ collection: 'households', value: { ...household, id: rowIds.newInvite as unknown as Household['id'] } }], events: [], liabilities: [],
        }
        return { existing, missing, applied: applyConsentPatch(db as Db, second).ok }
      })
      assert.deepEqual(out, { existing: 'present', missing: 'absent', applied: true })
    } finally { await seeded.cleanup() }
  })
}
