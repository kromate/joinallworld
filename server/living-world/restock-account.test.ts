/** Account continuity for the internal NPC restock settlement seam. Parcels below are explicit
 * saved-fixture rows: these cases test account/privacy lifecycle, not a live mapped delivery. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { fixture, snapshot } from '../test-fixture.ts'
import type { FixtureOptions } from '../test-fixture.ts'
import { fakeProvider, makeKey, claimsFor, signToken } from '../accounts/test-tokens.ts'
import { ROUTE_MODULES } from '../routes/index.ts'
import type { RouteContext, RouteHandler, RouteKey, RouteModule } from '../types.ts'
import type { ParcelState } from '../../src/game/living-world/parcel.ts'
import { createNpcRestockService } from './restock-service.ts'
import { createNpcRestockWageAdapter } from './restock-wage.ts'
import { deliveredNpcParcel } from './restock-fixture.ts'

// accountsConfig requires a lowercase project ID of at most 30 characters.
const PROJECT = 'restock-account-fixture'
const ENV = {
  ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT,
  ACCOUNTS_FIREBASE_API_KEY: 'restock-account-test-api-key-0000000000000000000000',
  ACCOUNTS_GOOGLE_CLIENT_ID: '1234567890-restock-testclient.apps.googleusercontent.com',
}
const SETTLE = '/api/test/living-world/restock-account/settle'
type Json = Record<string, unknown>
type Player = { cookie: string; id: string; name: string }
type Settlement = { ok: boolean; code: string; duplicate?: true; inventoryRevision: number | null; stock: number | null }

const restockRoute: RouteModule = (ctx: RouteContext) => {
  const service = createNpcRestockService(ctx, createNpcRestockWageAdapter(ctx))
  return { [`POST ${SETTLE}` as RouteKey]: (async request => ({
    body: await service.settleDelivered(request, await request.json()), renew: true,
  })) as RouteHandler }
}

async function setup(t: Parameters<typeof fixture>[0], options: FixtureOptions = {}) {
  const key = await makeKey('restock-account-lifecycle-key')
  const provider = fakeProvider([key])
  const f = await fixture(t, {
    ...options,
    env: { ...ENV, ...options.env },
    fetch: options.fetch ?? ((url, init) => provider.fetch(url, init as { body?: unknown })),
    routes: [...ROUTE_MODULES, restockRoute],
  })
  const call = (path: string, body?: unknown, cookie?: string | null): Promise<Response> => fetch(f.base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: f.base,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  let tokenNumber = 0
  const token = (subject: string): Promise<string> => signToken(key, claimsFor(PROJECT, f.now(), {
    subject, email: `${subject.toLowerCase()}@example.com`, n: ++tokenNumber,
  }))
  const csrf = async (cookie: string): Promise<string> => {
    const value = await (await call('/api/account', undefined, cookie)).json() as { csrf?: string | null }
    assert.equal(typeof value.csrf, 'string')
    return value.csrf!
  }
  const change = (path: string, body: Json, cookie: string): Promise<Response> =>
    csrf(cookie).then(csrfToken => call(path, { ...body, csrf: csrfToken }, cookie))
  const proved = async (path: string, body: Json, cookie: string, subject: string): Promise<Response> =>
    change(path, { ...body, idToken: await token(subject) }, cookie)

  async function guest(name: string): Promise<Player> {
    const created = await f.request('/api/session', { name, onboarding: true })
    assert.equal(created.status, 200)
    const value = await created.json() as { session?: { id?: string } }
    const player = { cookie: (created.headers.get('set-cookie') ?? '').split(';')[0] ?? '', id: value.session?.id ?? '', name }
    assert.ok(player.cookie && player.id)
    const result = await f.action(player.cookie, { type: 'onboarding.quick-start', payload: {
      look: { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4',
        hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' },
    } })
    assert.equal(result.code, 'playing')
    await f.request('/api/life?city=lagos', null, player.cookie)
    return player
  }

  async function signIn(subject: string, cookie: string) {
    const response = await change('/api/account/sign-in', { idToken: await token(subject) }, cookie)
    return {
      status: response.status,
      body: await response.json() as Json & { outcome?: string; character?: { id?: string }; parked?: { id?: string } | null },
      cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
    }
  }

  async function saveParcel(player: Player, parcel: ParcelState): Promise<void> {
    await f.server.store.transact(db => {
      const session = Object.values(db.sessions).find(row => row.publicId === player.id)
      assert.ok(session)
      const root = (db.livingWorld ??= {}) as { parcels?: Record<string, unknown> }
      root.parcels ??= {}
      root.parcels[player.id] = { v: 1, publicId: player.id, account: session.account ?? null, state: parcel }
    })
  }

  async function settle(player: Player, parcel: ParcelState, inventoryRevision: number, requestId = f.id()) {
    const body = { cityId: 'lagos', requestId, parcelId: parcel.parcel!.id, revision: parcel.revision,
      generation: parcel.generation, inventoryRevision }
    const response = await f.request(SETTLE, body, player.cookie)
    return { status: response.status, body: await response.json() as Settlement, request: body }
  }

  async function wallet(player: Player) {
    await f.request('/api/life?city=lagos', null, player.cookie)
    return f.server.store.read(db => {
      const row = Object.values(db.sessions).find(session => session.publicId === player.id)
      return snapshot(row?.cities.lagos?.state)
    })
  }

  return { f, call, token, guest, signIn, proved, saveParcel, settle, wallet }
}

test('one parcel receipt survives adoption, parking, restore, expired archive recovery and keep-as-guest deletion', async t => {
  const a = await setup(t)
  const ada = await a.guest('Restock Ada'), bola = await a.guest('Restock Bola')
  const adaParcel = deliveredNpcParcel(ada.id, a.f.now(), 'ada-delivery')
  const bolaParcel = deliveredNpcParcel(bola.id, a.f.now(), 'bola-delivery')
  const adaBeforeWage = await a.wallet(ada)
  await a.saveParcel(ada, adaParcel)
  const adaFirst = await a.settle(ada, adaParcel, 0)
  assert.deepEqual([adaFirst.status, adaFirst.body.ok, adaFirst.body.code, adaFirst.body.stock], [200, true, 'restocked', 3])
  const adaWallet = await a.wallet(ada)
  assert.ok(adaBeforeWage && adaWallet)
  assert.equal(adaWallet.cash, adaBeforeWage.cash + 120, 'the delivered parcel credits exactly the fixed fictional wage')
  assert.equal(adaWallet.social.earned, adaBeforeWage.social.earned + 120, 'the fixed wage is counted once as earned work')
  const linked = await a.signIn('RestockOwner', ada.cookie)
  assert.deepEqual([linked.status, linked.body.outcome, linked.body.character?.id], [200, 'linked', ada.id])
  assert.ok(linked.cookie)
  const owner = await a.f.server.store.read(db => Object.values(db.accounts ?? {}).find(row => row.subject === 'RestockOwner')?.id)
  assert.ok(owner)
  assert.equal(await a.f.server.store.read(db => (db.livingWorld as { parcels: Record<string, { account: string | null }> }).parcels[ada.id]!.account), owner)
  // Sign-in can independently apply the normal launch bonus. Capture after that
  // legitimate lifecycle settlement and before replay, so duplicate wage credit cannot hide in the baseline.
  const adaAfterSignIn = await a.wallet({ ...ada, cookie: linked.cookie })
  assert.ok(adaAfterSignIn)
  assert.ok(adaAfterSignIn.cash >= adaWallet.cash)
  const adoptedReplay = await a.settle({ ...ada, cookie: linked.cookie }, adaParcel, 0, adaFirst.request.requestId)
  assert.deepEqual([adoptedReplay.body.ok, adoptedReplay.body.duplicate], [true, true])
  assert.deepEqual(await a.wallet({ ...ada, cookie: linked.cookie }), adaAfterSignIn,
    'replaying the delivered parcel after adoption does not credit another wage')

  await a.saveParcel(bola, bolaParcel)
  const bolaFirst = await a.settle(bola, bolaParcel, 1)
  assert.deepEqual([bolaFirst.body.ok, bolaFirst.body.code, bolaFirst.body.stock], [true, 'restocked', 6])
  const parked = await a.signIn('RestockOwner', bola.cookie)
  assert.deepEqual([parked.status, parked.body.outcome, parked.body.character?.id, parked.body.parked?.id],
    [200, 'parked', ada.id, bola.id])

  const selected = await a.proved('/api/account/character', { use: bola.id }, parked.cookie, 'RestockOwner')
  assert.equal(selected.status, 200)
  const bolaReplay = await a.settle({ ...bola, cookie: parked.cookie }, bolaParcel, 1, bolaFirst.request.requestId)
  assert.deepEqual([bolaReplay.body.ok, bolaReplay.body.duplicate], [true, true])
  const returned = await a.proved('/api/account/character', { use: ada.id }, parked.cookie, 'RestockOwner')
  assert.equal(returned.status, 200)
  const adaAfterSwitch = await a.settle({ ...ada, cookie: parked.cookie }, adaParcel, 0, adaFirst.request.requestId)
  assert.deepEqual([adaAfterSwitch.body.ok, adaAfterSwitch.body.duplicate], [true, true])

  await a.f.server.store.transact(db => {
    const account = Object.values(db.accounts ?? {}).find(row => row.subject === 'RestockOwner')
    assert.ok(account?.sessionKey)
    const active = db.sessions[account.sessionKey]
    assert.ok(active)
    active.expiresAt = a.f.now() - 1
  })
  await a.f.request('/api/session', { name: 'Archive trigger' })
  const archived = await a.f.server.store.read(db => snapshot(db.archivedLives?.[ada.id]))
  assert.equal(archived?.publicId, ada.id)
  const restored = await a.signIn('RestockOwner', parked.cookie)
  assert.deepEqual([restored.status, restored.body.outcome, restored.body.character?.id], [200, 'restored', ada.id])
  const recoveredReplay = await a.settle({ ...ada, cookie: restored.cookie }, adaParcel, 0, adaFirst.request.requestId)
  assert.deepEqual([recoveredReplay.body.ok, recoveredReplay.body.duplicate], [true, true])

  const beforeDelete = await a.f.server.store.read(db => snapshot({
    stock: (db.livingWorld as { npcInventory: unknown }).npcInventory,
    wallet: Object.values(db.sessions).find(row => row.publicId === ada.id)?.cities.lagos?.state,
    effects: db.walletEffects ?? [],
  }))
  const deleted = await a.proved('/api/account/delete', { confirm: 'delete', erase: false }, restored.cookie, 'RestockOwner')
  assert.deepEqual([deleted.status, (await deleted.json() as { kept: boolean }).kept], [200, true])
  const guestCookie = deleted.headers.get('set-cookie')?.split(';')[0] ?? ''
  assert.ok(guestCookie)
  const afterDelete = await a.f.server.store.read(db => {
    const root = db.livingWorld as { parcels: Record<string, { account: string | null }>; npcInventory: { outlet: { revision: number; stock: number }; erasedSettlements: number; delivered: Record<string, { settlements: number }> } }
    return snapshot({ parcels: root.parcels, inventory: root.npcInventory,
      wallet: Object.values(db.sessions).find(row => row.publicId === ada.id)?.cities.lagos?.state, effects: db.walletEffects ?? [] })
  })
  assert.equal(afterDelete.parcels[ada.id]?.account, null, 'the retained actor becomes a guest without losing its parcel')
  assert.equal(Object.hasOwn(afterDelete.parcels, bola.id), false, 'parked discarded actor custody is removed')
  assert.deepEqual([afterDelete.inventory.outlet.revision, afterDelete.inventory.outlet.stock, afterDelete.inventory.erasedSettlements], [2, 6, 1])
  const adaWatermark = (beforeDelete.stock as { delivered: Record<string, { settlements: number; generation: number; deliveredAt: number }> }).delivered[ada.id]
  assert.ok(adaWatermark)
  assert.deepEqual([adaWatermark.settlements, adaWatermark.generation, adaWatermark.deliveredAt], [1, 1, adaParcel.parcel!.terminalAt])
  assert.deepEqual(afterDelete.inventory.delivered, { [ada.id]: adaWatermark },
    'the erased actor watermark is removed while Ada’s retained watermark remains')
  assert.equal(Object.values(afterDelete.inventory.delivered).reduce((sum, row) => sum + row.settlements, afterDelete.inventory.erasedSettlements),
    afterDelete.inventory.outlet.revision, 'retained plus anonymized settlements still explain the outlet revision')
  assert.deepEqual(afterDelete.wallet, beforeDelete.wallet)
  assert.deepEqual(afterDelete.effects, beforeDelete.effects)
  const guestReplay = await a.settle({ ...ada, cookie: guestCookie }, adaParcel, 0, adaFirst.request.requestId)
  assert.deepEqual([guestReplay.body.ok, guestReplay.body.duplicate, guestReplay.body.stock], [true, true, 6])
  assert.deepEqual(await a.f.server.store.read(db => snapshot(db.walletEffects ?? [])), beforeDelete.effects,
    'keep-as-guest retains the original once receipt and cannot pay again')
  const guestFreshId = await a.settle({ ...ada, cookie: guestCookie }, adaParcel, 0)
  assert.deepEqual([guestFreshId.body.ok, guestFreshId.body.code, guestFreshId.body.stock], [true, 'already_restocked', 6])
  assert.deepEqual(await a.f.server.store.read(db => snapshot(db.walletEffects ?? [])), beforeDelete.effects,
    'a new ID cannot repay the retained terminal parcel')
  assert.deepEqual(afterDelete.inventory.outlet, (beforeDelete.stock as { outlet: unknown }).outlet,
    'discarding the parked actor does not remove already credited NPC stock')
})

test('erase=true removes the proven actor parcel and reward watermark but preserves fictional outlet stock', async t => {
  const a = await setup(t), player = await a.guest('Erase restock actor')
  const parcel = deliveredNpcParcel(player.id, a.f.now(), 'erase-delivery')
  await a.saveParcel(player, parcel)
  const first = await a.settle(player, parcel, 0)
  assert.deepEqual([first.body.ok, first.body.code, first.body.stock], [true, 'restocked', 3])
  const signed = await a.signIn('RestockEraseOwner', player.cookie)
  assert.equal(signed.body.outcome, 'linked')
  const before = await a.f.server.store.read(db => snapshot({
    outlet: (db.livingWorld as { npcInventory: { outlet: unknown } }).npcInventory.outlet,
    effects: db.walletEffects ?? [],
  }))
  const deleted = await a.proved('/api/account/delete', { confirm: 'delete', erase: true }, signed.cookie, 'RestockEraseOwner')
  assert.deepEqual([deleted.status, (await deleted.json() as { kept: boolean }).kept], [200, false])
  const after = await a.f.server.store.read(db => {
    const root = db.livingWorld as { parcels: Record<string, unknown>; npcInventory: { outlet: unknown; erasedSettlements: number; delivered: Record<string, unknown> } }
    return snapshot({ parcels: root.parcels, inventory: root.npcInventory, effects: db.walletEffects ?? [] })
  })
  assert.equal(Object.hasOwn(after.parcels, player.id), false)
  assert.deepEqual(after.inventory.outlet, before.outlet, 'privacy erasure does not subtract credited stock or revision')
  assert.deepEqual([after.inventory.erasedSettlements, Object.hasOwn(after.inventory.delivered, player.id)], [1, false])
  assert.deepEqual(after.effects, before.effects)
  const oldCookieReplay = await a.f.request(SETTLE, first.request, signed.cookie)
  assert.equal(oldCookieReplay.status, 401, 'the deleted account session cannot reuse its old settlement receipt')
  assert.deepEqual(await a.f.server.store.read(db => snapshot(db.walletEffects ?? [])), before.effects)
})
