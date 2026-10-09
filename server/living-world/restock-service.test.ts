import assert from 'node:assert/strict'
import test from 'node:test'
import { fixture, flakyDisk } from '../test-fixture.ts'
import { ROUTE_MODULES } from '../routes/index.ts'
import type { RouteContext, RouteHandler, RouteKey, RouteModule } from '../types.ts'
import { claimsFor, fakeProvider, makeKey, signToken } from '../accounts/test-tokens.ts'
import type { ParcelState } from '../../src/game/living-world/parcel.ts'
import { deliveredNpcParcel } from './restock-fixture.ts'
import { createNpcRestockService, type ApplyNpcRestockWage, type NpcRestockSettlement } from './restock-service.ts'

const PATH = '/api/test/living-world/restock'
type Player = { cookie: string; id: string }
type Reply = NpcRestockSettlement & { error?: string }
type WageSpy = { calls: Array<{ actor: string; parcel: string; amount: number; at: number; requestId: string }>; fail: boolean }
const PROJECT = 'restock-fixture-project'
const ACCOUNT_ENV = { ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT, ACCOUNTS_FIREBASE_API_KEY: 'restock-fixture-api-key-0000000000000000000000' }

/** The injected callback is only a boundary spy: these tests do not emulate or claim real wallet integration. */
const testRoutes = (spy: WageSpy): RouteModule => (ctx: RouteContext) => {
  const apply: ApplyNpcRestockWage = (_db, session, effect, at, requestId) => {
    spy.calls.push({ actor: session.publicId, parcel: effect.parcelId, amount: effect.wage, at, requestId })
    if (spy.fail) throw new Error('injected fixed wage failure')
    return 'credited'
  }
  const service = createNpcRestockService(ctx, apply)
  return {
    [`POST ${PATH}/settle` as RouteKey]: (async request => ({
      body: await service.settleDelivered(request, await request.json()), renew: true,
    })) as RouteHandler,
  }
}

async function setup(t: Parameters<typeof fixture>[0], options: Parameters<typeof fixture>[1] = {}) {
  const spy: WageSpy = { calls: [], fail: false }
  const f = await fixture(t, { ...options, routes: [...ROUTE_MODULES, testRoutes(spy)] })
  return { f, spy }
}

async function onboard(f: Awaited<ReturnType<typeof fixture>>, name: string): Promise<Player> {
  const created = await f.request('/api/session', { name, onboarding: true })
  assert.equal(created.status, 200)
  const value = await created.json() as { session?: { id?: string } }
  const player = { cookie: (created.headers.get('set-cookie') ?? '').split(';')[0] ?? '', id: value.session?.id ?? '' }
  assert.ok(player.cookie && player.id)
  assert.equal((await f.action(player.cookie, { type: 'onboarding.quick-start', payload: {
    look: { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' },
  } })).code, 'playing')
  await f.request('/api/life?city=lagos', null, player.cookie)
  return player
}

const deliveredParcel = (actor: string, at: number): ParcelState => deliveredNpcParcel(actor, at, 'parcel-test')

async function saveParcel(f: Awaited<ReturnType<typeof fixture>>, player: Player, parcel: ParcelState): Promise<void> {
  await f.server.store.transact(db => {
    const row = Object.values(db.sessions).find(session => session.publicId === player.id)
    assert.ok(row)
    const root = (db.livingWorld ??= {}) as { parcels?: Record<string, unknown> }
    root.parcels ??= {}
    root.parcels[player.id] = { v: 1, publicId: player.id, account: row.account ?? null, state: parcel }
  })
}

function request(f: Awaited<ReturnType<typeof fixture>>, parcel: ParcelState, inventoryRevision = 0) {
  return { cityId: 'lagos', requestId: f.id(), parcelId: parcel.parcel!.id, revision: parcel.revision,
    generation: parcel.generation, inventoryRevision }
}
async function settle(f: Awaited<ReturnType<typeof fixture>>, player: Player, body: object): Promise<{ status: number; reply: Reply }> {
  const response = await f.request(`${PATH}/settle`, body, player.cookie)
  return { status: response.status, reply: await response.json() as Reply }
}
test('authenticated delivered-parcel settlement applies its fixed effect once and rejects changed receipts', async t => {
  const { f, spy } = await setup(t), player = await onboard(f, 'Parcel driver')
  const parcel = deliveredParcel(player.id, f.now())
  await saveParcel(f, player, parcel)
  const body = request(f, parcel)
  const [first, concurrent] = await Promise.all([settle(f, player, body), settle(f, player, body)])
  assert.deepEqual([first.status, first.reply.ok, first.reply.code, first.reply.inventoryRevision, first.reply.stock], [200, true, 'restocked', 1, 3])
  assert.deepEqual([concurrent.reply.ok, concurrent.reply.duplicate], [true, true])
  assert.deepEqual(spy.calls, [{ actor: player.id, parcel: 'parcel-test', amount: 120, at: f.now(), requestId: body.requestId }])

  const changed = await f.request(`${PATH}/settle`, { ...body, inventoryRevision: 1 }, player.cookie)
  assert.deepEqual([changed.status, (await changed.json() as { error?: string }).error], [409, 'client_id_conflict'])
  const freshId = await settle(f, player, { ...body, requestId: f.id() })
  assert.deepEqual([freshId.reply.ok, freshId.reply.code, freshId.reply.stock, spy.calls.length], [true, 'already_restocked', 3, 1])

})

test('the same actor retains its receipt across the real guest-to-account binding transition', async t => {
  const key = await makeKey('restock-account-key'), provider = fakeProvider([key])
  const { f, spy } = await setup(t, { env: ACCOUNT_ENV, fetch: (url, init) => provider.fetch(url, init as { body?: unknown }) })
  const player = await onboard(f, 'Account-bound parcel'), parcel = deliveredParcel(player.id, f.now())
  await saveParcel(f, player, parcel)
  const body = request(f, parcel)
  assert.equal((await settle(f, player, body)).reply.code, 'restocked')

  const accountState = await (await f.request('/api/account', undefined, player.cookie)).json() as { csrf?: string }
  assert.equal(typeof accountState.csrf, 'string')
  const token = await signToken(key, claimsFor(PROJECT, f.now(), { subject: 'RestockAccountOwner', email: 'restock@example.com' }))
  const linked = await fetch(`${f.base}/api/account/sign-in`, {
    method: 'POST',
    headers: { Origin: f.base, Cookie: player.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ csrf: accountState.csrf, idToken: token }),
  })
  assert.equal(linked.status, 200)
  const linkedBody = await linked.json() as { outcome?: string; character?: { id?: string } }
  assert.deepEqual([linkedBody.outcome, linkedBody.character?.id], ['linked', player.id])
  const accountCookie = linked.headers.get('set-cookie')?.split(';')[0] ?? ''
  assert.match(accountCookie, /^sid=[0-9a-f-]{36}$/)

  const replay = await f.request(`${PATH}/settle`, body, accountCookie)
  const reply = await replay.json() as Reply
  assert.deepEqual([replay.status, reply.ok, reply.duplicate, spy.calls.length],
    [200, true, true, 1], 'same-character adoption retains both parcel ownership and the once-only reward receipt')
  const newRequest = await settle(f, { ...player, cookie: accountCookie }, { ...body, requestId: f.id() })
  assert.deepEqual([newRequest.reply.code, spy.calls.length], ['already_restocked', 1])
  await f.server.store.transact(db => {
    const rows = (db.livingWorld as { parcels: Record<string, { account: string | null }> }).parcels
    rows[player.id]!.account = 'foreign-owner'
  })
  const foreignReplay = await settle(f, { ...player, cookie: accountCookie }, body)
  assert.deepEqual([foreignReplay.reply.ok, foreignReplay.reply.code, foreignReplay.reply.stock, spy.calls.length],
    [false, 'parcel_unavailable', null, 1], 'current ownership is checked before replaying retained success')
})

test('actor, parcel revision, account envelope, and exact request schema fail closed', async t => {
  const { f, spy } = await setup(t), player = await onboard(f, 'Bound parcel')
  const parcel = deliveredParcel(player.id, f.now())
  await saveParcel(f, player, parcel)
  const body = request(f, parcel)
  assert.equal((await settle(f, player, { ...body, passed: true })).status, 400)
  assert.equal((await f.request(`${PATH}/settle`, body)).status, 401)
  const badRevision = await settle(f, player, { ...body, requestId: f.id(), revision: body.revision + 1 })
  assert.deepEqual([badRevision.reply.ok, badRevision.reply.code], [false, 'parcel_unavailable'])
  await f.server.store.transact(db => {
    const rows = (db.livingWorld as { parcels: Record<string, { account: string | null }> }).parcels
    rows[player.id]!.account = 'different-account'
  })
  const changedOwner = await settle(f, player, { ...body, requestId: f.id() })
  assert.deepEqual([changedOwner.reply.ok, changedOwner.reply.code, spy.calls.length], [false, 'parcel_unavailable', 0])
})

test('wage throw and durable storage failure roll back inventory and receipt before same-ID recovery', async t => {
  const disk = flakyDisk(), { f, spy } = await setup(t, { disk }), player = await onboard(f, 'Recoverable parcel')
  const parcel = deliveredParcel(player.id, f.now())
  await saveParcel(f, player, parcel)
  const body = request(f, parcel)
  spy.fail = true
  assert.equal((await settle(f, player, body)).status, 500)
  assert.equal(await f.server.store.read(db => Object.hasOwn(db.livingWorld ?? {}, 'npcInventory')), false)
  spy.fail = false
  const recovered = await settle(f, player, body)
  assert.deepEqual([recovered.reply.ok, recovered.reply.code, recovered.reply.stock], [true, 'restocked', 3])
  assert.equal(spy.calls.length, 2, 'the first callback threw and its transaction was not acknowledged')

  const nextPlayer = await onboard(f, 'Second parcel')
  f.advance(1)
  const nextParcel = deliveredParcel(nextPlayer.id, f.now())
  await saveParcel(f, nextPlayer, nextParcel)
  const next = request(f, nextParcel, 1)
  disk.fail = 'ENOSPC'
  assert.equal((await settle(f, nextPlayer, next)).status, 503)
  disk.fail = null
  const afterDiskRecovery = await settle(f, nextPlayer, next)
  assert.deepEqual([afterDiskRecovery.reply.ok, afterDiskRecovery.reply.code, afterDiskRecovery.reply.stock], [true, 'restocked', 6])
})

test('a fresh request with stale stock CAS cannot pay another actor and a new current request recovers', async t => {
  const { f, spy } = await setup(t), first = await onboard(f, 'First carrier'), second = await onboard(f, 'Second carrier')
  const firstParcel = deliveredParcel(first.id, f.now()), secondParcel = deliveredParcel(second.id, f.now())
  await saveParcel(f, first, firstParcel)
  await saveParcel(f, second, secondParcel)
  assert.equal((await settle(f, first, request(f, firstParcel))).reply.code, 'restocked')
  const stale = await settle(f, second, request(f, secondParcel, 0))
  assert.deepEqual([stale.reply.ok, stale.reply.code, stale.reply.stock, spy.calls.length], [false, 'revision_conflict', 3, 1])
  const current = await settle(f, second, request(f, secondParcel, 1))
  assert.deepEqual([current.reply.ok, current.reply.code, current.reply.stock, spy.calls.length], [true, 'restocked', 6, 2])
})

test('future or malformed inventory stays quarantined and is never projected as stock', async t => {
  const { f, spy } = await setup(t), player = await onboard(f, 'Quarantined outlet')
  const parcel = deliveredParcel(player.id, f.now())
  await saveParcel(f, player, parcel)
  const futureInventory = { version: 7, outlet: { revision: 8, stock: 24 } }
  await f.server.store.transact(db => {
    const root = db.livingWorld as Record<string, unknown>
    root.npcInventory = futureInventory
  })
  const before = await f.server.store.read(db => JSON.parse(JSON.stringify((db.livingWorld as Record<string, unknown>).npcInventory)) as unknown)
  const result = await settle(f, player, request(f, parcel, 8))
  assert.deepEqual([result.reply.ok, result.reply.code, result.reply.inventoryRevision, result.reply.stock],
    [false, 'inventory_quarantined', null, null])
  const after = await f.server.store.read(db => JSON.parse(JSON.stringify((db.livingWorld as Record<string, unknown>).npcInventory)) as unknown)
  assert.deepEqual(after, before)
  assert.equal(spy.calls.length, 0)
})
