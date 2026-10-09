import assert from 'node:assert/strict'
import test from 'node:test'
import { fixture, flakyDisk, snapshot } from '../test-fixture.ts'
import type { BarberSessionView } from '../../src/types/living-world-barber.ts'
import { ROUTE_MODULES } from '../routes/index.ts'
import livingWorldRoutes from '../routes/living-world.ts'
import type { RouteContext, RouteHandler, RouteKey, RouteModule } from '../types.ts'
import type { Look } from '../../src/types/life.ts'
import type { TimedId } from '../../src/types/protocol.ts'
import { BARBER_STARTER_TOOL_COST } from '../../src/game/living-world/barber-catalogue.ts'
import type { ParcelState } from '../../src/game/living-world/parcel.ts'
import { NPC_RESTOCK_CURRENCY, NPC_RESTOCK_POLICY } from '../../src/game/living-world/restock-policy.ts'
import { createBarberService } from './barber-service.ts'
import { createNpcRestockService } from './restock-service.ts'
import { createNpcRestockWageAdapter } from './restock-wage.ts'
import { deliveredNpcParcel as deliveredParcel } from './restock-fixture.ts'

const PATH = '/api/test/living-world/restock-wage'
const LOOK: Look = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }
type Player = { cookie: string; id: string }
type Reply = { ok: boolean; code: string; duplicate?: true; inventoryRevision: number | null; stock: number | null; error?: string }

const testRoutes: RouteModule = (ctx: RouteContext) => {
  const service = createNpcRestockService(ctx, createNpcRestockWageAdapter(ctx))
  const barber = createBarberService(ctx)
  return {
    [`POST ${PATH}/settle` as RouteKey]: (async request => ({ body: await service.settleDelivered(request, await request.json()), renew: true })) as RouteHandler,
    'POST /api/test/living-world/barber-upgrade': (async request => ({ body: await barber.upgrade(request, await request.json()), renew: true })) as RouteHandler,
  }
}

async function setup(t: Parameters<typeof fixture>[0], options: Parameters<typeof fixture>[1] = {}) {
  assert.ok(ROUTE_MODULES.includes(livingWorldRoutes))
  return fixture(t, { ...options, routes: [...ROUTE_MODULES, testRoutes] })
}
async function onboard(f: Awaited<ReturnType<typeof fixture>>, name: string): Promise<Player> {
  const created = await f.request('/api/session', { name, onboarding: true })
  assert.equal(created.status, 200)
  const body = await created.json() as { session?: { id?: string } }
  const player = { cookie: (created.headers.get('set-cookie') ?? '').split(';')[0] ?? '', id: body.session?.id ?? '' }
  assert.ok(player.cookie && player.id)
  assert.equal((await f.action(player.cookie, { type: 'onboarding.quick-start', payload: { look: LOOK } })).code, 'playing')
  return player
}
async function post(f: Awaited<ReturnType<typeof fixture>>, path: string, body: object, player: Player): Promise<{ status: number; body: Reply }> {
  const response = await f.request(path, body, player.cookie)
  return { status: response.status, body: await response.json() as Reply }
}
async function life(f: Awaited<ReturnType<typeof fixture>>, player: Player): Promise<{ cash: number; earned: number; ledger: unknown }> {
  await (await f.request('/api/life?city=lagos', null, player.cookie)).arrayBuffer()
  return f.server.store.read(db => {
    const state = Object.values(db.sessions).find(row => row.publicId === player.id)?.cities.lagos?.state
    return { cash: state?.cash ?? -1, earned: state?.social.earned ?? -1, ledger: snapshot(state?.ledger) }
  })
}
async function saveParcel(f: Awaited<ReturnType<typeof fixture>>, player: Player, parcel: ParcelState): Promise<void> {
  await f.server.store.transact(db => {
    const session = Object.values(db.sessions).find(row => row.publicId === player.id)
    assert.ok(session)
    const root = (db.livingWorld ??= {}) as { parcels?: Record<string, unknown> }
    root.parcels ??= {}
    root.parcels[player.id] = { v: 1, publicId: player.id, account: session.account ?? null, state: parcel }
  })
}
function settleBody(f: Awaited<ReturnType<typeof fixture>>, parcel: ParcelState) {
  return { cityId: 'lagos', requestId: f.id() as TimedId, parcelId: parcel.parcel!.id, revision: parcel.revision, generation: parcel.generation, inventoryRevision: 0 }
}

async function completeBasicBarberLesson(f: Awaited<ReturnType<typeof fixture>>, player: Player): Promise<void> {
  const start = await post(f, '/api/living-world/barber/start', { cityId: 'lagos', lessonId: 'basic', requestId: f.id() }, player)
  assert.equal(start.status, 200)
  let session = (start.body as unknown as { session: BarberSessionView }).session
  for (const [tool, y, xs] of [
    ['comb', 0.4, [0.25, 0.4, 0.55]],
    ['clippers', 0.69, [0.25, 0.4, 0.55]],
    ['brush', 0.47, [0.4, 0.55, 0.7]],
  ] as const) {
    const frames = xs.map(x => ({ tool, x, y, pressed: true }))
    f.advance(frames.length * 100)
    const response = await f.request('/api/living-world/barber/input', { cityId: 'lagos', sessionId: session.sessionId,
      revision: session.revision, sequence: session.nextSequence, frames }, player.cookie)
    const value = await response.json() as { ok: boolean; code: string; session?: BarberSessionView }
    assert.equal(value.ok, true, value.code)
    assert.ok(value.session)
    session = value.session
  }
  assert.equal((await f.request('/api/living-world/barber/claim', { cityId: 'lagos', lessonId: 'basic', sessionId: session.sessionId,
    requestId: f.id() }, player.cookie)).status, 200)
}

test('fixed restock wage is one simulated wallet credit, and its amount pays the existing barber tool price', async t => {
  const f = await setup(t), player = await onboard(f, 'Zero cash driver'), stranger = await onboard(f, 'Other driver')
  await completeBasicBarberLesson(f, player)
  await f.server.store.transact(db => {
    const owner = Object.values(db.sessions).find(row => row.publicId === player.id)
    assert.ok(owner?.cities.lagos)
    owner.cities.lagos.state.cash = 0
  })
  const before = await life(f, player), strangerBefore = await life(f, stranger)
  assert.equal(before.cash, 0)
  const parcel = deliveredParcel(player.id, f.now())
  await saveParcel(f, player, parcel)
  const body = settleBody(f, parcel)
  const foreign = await post(f, `${PATH}/settle`, body, stranger)
  assert.deepEqual([foreign.status, foreign.body.ok, foreign.body.code], [200, false, 'parcel_unavailable'])
  assert.deepEqual(await life(f, stranger), strangerBefore)
  const [first, retry] = await Promise.all([post(f, `${PATH}/settle`, body, player), post(f, `${PATH}/settle`, body, player)])
  assert.deepEqual([first.status, first.body.ok, first.body.code], [200, true, 'restocked'])
  assert.equal([first.body.duplicate, retry.body.duplicate].filter(Boolean).length, 1)
  const after = await life(f, player)
  assert.equal(after.cash, NPC_RESTOCK_POLICY.wage)
  assert.equal(after.cash, BARBER_STARTER_TOOL_COST, 'the fixed work wage covers the authored one-time tool upgrade')
  assert.equal(after.earned, before.earned + NPC_RESTOCK_POLICY.wage)
  assert.equal((after.ledger as unknown[]).length, (before.ledger as unknown[]).length + 1)
  const journal = await f.server.store.read(db => snapshot(db.walletEffects ?? [])) as Array<{ publicId: string; operationId: string | null; amount: number; reason: string }>
  assert.equal(journal.filter(row => row.publicId === player.id && row.operationId === body.requestId
    && row.amount === NPC_RESTOCK_POLICY.wage && /NPC restock delivery wage/.test(row.reason)).length, 1)

  const upgrade = await post(f, '/api/test/living-world/barber-upgrade', { cityId: 'lagos', requestId: f.id() }, player)
  assert.equal(upgrade.status, 200)
  assert.deepEqual([upgrade.body.ok, (upgrade.body as unknown as { starterTool?: boolean }).starterTool], [true, true])
  assert.equal((await life(f, player)).cash, 0, 'the exact earned wage funds the real fixed-cost game upgrade')
  const freshId = await post(f, `${PATH}/settle`, { ...body, requestId: f.id() }, player)
  assert.deepEqual([freshId.body.ok, freshId.body.code], [true, 'already_restocked'])
  assert.equal((await life(f, player)).cash, 0, 'a new receipt id cannot pay the same delivered parcel twice')
  assert.deepEqual(await life(f, stranger), strangerBefore)
  assert.equal((await f.action(player.cookie, { type: 'living-world.server', payload: { op: 'npc-restock-wage' } })).code, 'server_only')
  assert.equal(NPC_RESTOCK_CURRENCY, 'simulated-life-cash')
})

test('balance refusal and ENOSPC leave parcel stock, wage, wallet effects, and once receipt uncommitted', async t => {
  const disk = flakyDisk(), f = await setup(t, { disk }), player = await onboard(f, 'Recover after write')
  await f.server.store.transact(db => {
    const owner = Object.values(db.sessions).find(row => row.publicId === player.id)
    assert.ok(owner?.cities.lagos)
    owner.cities.lagos.state.cash = Number.MAX_SAFE_INTEGER
    owner.cities.lagos.state.ledger = [{ at: f.now(), amount: Number.MAX_SAFE_INTEGER - 5000, reason: 'Test balance fixture', balance: Number.MAX_SAFE_INTEGER }]
  })
  await life(f, player)
  const parcel = deliveredParcel(player.id, f.now())
  await saveParcel(f, player, parcel)
  const body = settleBody(f, parcel)
  const before = await f.server.store.read(db => {
    const session = Object.values(db.sessions).find(row => row.publicId === player.id)!
    return snapshot({ wallet: session.cities.lagos?.state, inventory: (db.livingWorld as { npcInventory?: unknown } | undefined)?.npcInventory,
      effects: db.walletEffects ?? [], receipt: session.once?.[body.requestId] })
  })
  const balanceRefusal = await post(f, `${PATH}/settle`, body, player)
  assert.equal(balanceRefusal.status, 500, 'a refused fixed wallet action aborts the caller transaction')
  const afterRefusal = await f.server.store.read(db => {
    const session = Object.values(db.sessions).find(row => row.publicId === player.id)!
    return snapshot({ wallet: session.cities.lagos?.state, inventory: (db.livingWorld as { npcInventory?: unknown } | undefined)?.npcInventory,
      effects: db.walletEffects ?? [], receipt: session.once?.[body.requestId] })
  })
  assert.deepEqual(afterRefusal, before)

  await f.server.store.transact(db => {
    const owner = Object.values(db.sessions).find(row => row.publicId === player.id)
    assert.ok(owner?.cities.lagos)
    owner.cities.lagos.state.cash = 0
  })
  const retryBefore = await life(f, player)
  const beforeDiskFailure = await f.server.store.read(db => {
    const session = Object.values(db.sessions).find(row => row.publicId === player.id)!
    return snapshot({ wallet: session.cities.lagos?.state, inventory: (db.livingWorld as { npcInventory?: unknown } | undefined)?.npcInventory,
      effects: db.walletEffects ?? [], receipt: session.once?.[body.requestId] })
  })
  disk.fail = 'ENOSPC'
  const failedWrite = await post(f, `${PATH}/settle`, body, player)
  assert.deepEqual([failedWrite.status, failedWrite.body.error], [503, 'storage_unavailable'])
  disk.fail = null
  const afterDiskFailure = await f.server.store.read(db => {
    const session = Object.values(db.sessions).find(row => row.publicId === player.id)!
    return snapshot({ wallet: session.cities.lagos?.state, inventory: (db.livingWorld as { npcInventory?: unknown } | undefined)?.npcInventory,
      effects: db.walletEffects ?? [], receipt: session.once?.[body.requestId] })
  })
  assert.deepEqual(afterDiskFailure, beforeDiskFailure, 'ENOSPC acknowledges neither wallet nor stock nor once receipt')
  const recovered = await post(f, `${PATH}/settle`, body, player)
  assert.deepEqual([recovered.status, recovered.body.ok, recovered.body.code, recovered.body.stock], [200, true, 'restocked', 3])
  const final = await life(f, player)
  assert.equal(final.cash, NPC_RESTOCK_POLICY.wage)
  assert.equal(final.earned, retryBefore.earned + NPC_RESTOCK_POLICY.wage)
  assert.equal((final.ledger as unknown[]).length, (retryBefore.ledger as unknown[]).length + 1)
  const committed = await f.server.store.read(db => {
    const session = Object.values(db.sessions).find(row => row.publicId === player.id)!
    return { receipt: session.once?.[body.requestId], inventory: snapshot((db.livingWorld as { npcInventory?: unknown } | undefined)?.npcInventory), effects: snapshot(db.walletEffects ?? []) }
  })
  assert.ok(committed.receipt)
  assert.equal((committed.effects as Array<{ operationId: string | null }>).filter(effect => effect.operationId === body.requestId).length, 1)
})
