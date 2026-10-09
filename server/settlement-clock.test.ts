import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { fixture } from './test-fixture.ts'
import { createServer } from './server.ts'
import { ROUTE_MODULES } from './routes/index.ts'
import { loadCityContent } from '../src/game/cities/registry.ts'
import type { RouteContext, RouteHandler, RouteKey, RouteModule } from './types.ts'

interface ProbeReply {
  settledAt: number
  ok: boolean
  code: string
  duplicate: boolean
  cash: number
  upgrade: { startedAt: number; doneAt: number } | null
}

function settledUpgradeProbe(clock: { now: number }): RouteModule {
  return (ctx: RouteContext): Record<RouteKey, RouteHandler> => ({
    'POST /api/probe/settled-upgrade': async request => {
      const body = await request.json()
      if (typeof body.actionId !== 'string') throw ctx.fail(400, 'invalid_probe')
      const answer = await ctx.store.transact(db => {
        const session = request.requireSession(db, { renew: true })
        const state = ctx.settle(session, 'lagos')
        const settledAt = state.t
        // Model a wall-clock tick between settlement and the synchronous action call.
        // The life action must remain part of this settled snapshot.
        clock.now += 750
        const result = ctx.act(state, {
          type: 'estate.upgrade', cityId: 'lagos', payload: { to: 'bq' }, actionId: body.actionId,
        })
        return {
          settledAt, ok: result.ok, code: result.code,
          duplicate: 'duplicate' in result && result.duplicate === true,
          cash: result.state.cash,
          upgrade: result.state.estate.upgrade
            ? { startedAt: result.state.estate.upgrade.startedAt, doneAt: result.state.estate.upgrade.doneAt }
            : null,
        }
      })
      return { body: answer }
    },
  })
}

test('settled action timestamps, pending upgrades and action receipts survive a Node host restart', async t => {
  await loadCityContent('lagos')
  const clock = { now: 100_000, tickOnRead: false }
  const serverNow = () => {
    const value = clock.now
    if (clock.tickOnRead) clock.now += 1
    return value
  }
  const feature = settledUpgradeProbe(clock)
  const f = await fixture(t, { now: serverNow, routes: [...ROUTE_MODULES, feature], log: () => {} })
  const ada = await f.device('Settlement Ada')
  await f.request('/api/life?city=lagos', null, ada.cookie)
  await f.server.store.transact(db => {
    const state = db.sessions[ada.cookie.slice(4)]?.cities.lagos?.state
    assert.ok(state, 'life was settled before preparing the paid action')
    state.cash = 500_000
    state.ledger = []
    state.ledgerDays = []
    state.estate.upgrade = null
    state.activeAction = null
  })

  const bola = await f.device('Settlement Bola')
  await f.request('/api/life?city=lagos', null, bola.cookie)
  await f.server.store.transact(db => {
    const state = db.sessions[bola.cookie.slice(4)]?.cities.lagos?.state
    assert.ok(state, 'second life was settled before the public action')
    state.cash = 500_000
    state.ledger = []
    state.ledgerDays = []
    state.estate.upgrade = null
    state.activeAction = null
  })

  const actionId = `${clock.now}:${randomUUID()}`
  const first = await (await f.request('/api/probe/settled-upgrade', { actionId }, ada.cookie)).json() as ProbeReply
  assert.deepEqual([first.ok, first.code, first.duplicate], [true, 'upgrade_started', false])
  assert.ok(first.upgrade)
  assert.deepEqual([first.upgrade.startedAt, first.upgrade.doneAt], [first.settledAt, first.settledAt + 600_000],
    'the pending build clock starts at the state snapshot, not a later wall-clock read')
  const paidBalance = first.cash

  // The public command path uses playerAct; an injected advancing clock proves its action records
  // follow the settled life rather than a second wall-clock sample inside the same request.
  const publicActionId = `${clock.now}:${randomUUID()}`
  clock.tickOnRead = true
  const publicFirst = await (await f.request('/api/action', {
    actionId: publicActionId, cityId: 'lagos', type: 'estate.upgrade', payload: { to: 'bq' },
  }, bola.cookie)).json() as { ok: boolean; code: string; duplicate?: boolean }
  clock.tickOnRead = false
  assert.deepEqual([publicFirst.ok, publicFirst.code, publicFirst.duplicate], [true, 'upgrade_started', undefined])
  const publicStored = await f.server.store.read(db => db.sessions[bola.cookie.slice(4)]?.cities.lagos?.state)
  assert.ok(publicStored?.estate.upgrade)
  assert.equal(publicStored.estate.upgrade.startedAt, publicStored.t,
    'the public action record shares the exact settlement clock despite later host clock reads')
  assert.equal(publicStored.estate.upgrade.doneAt, publicStored.t + 600_000)
  const publicSettledAt = publicStored.t
  const publicPaidBalance = publicStored.cash

  await f.flush()
  f.server.closeAllConnections()
  await new Promise<void>(resolve => f.server.close(() => resolve()))
  const restarted = await createServer({
    dataDir: f.dir, now: serverNow, sessionTtlMs: 2_592_000_000,
    routes: [...ROUTE_MODULES, feature], log: () => {},
  })
  t.after(async () => {
    restarted.closeAllConnections()
    if (restarted.listening) await new Promise<void>(resolve => restarted.close(() => resolve()))
    await restarted.store.close?.()
  })
  restarted.listen(0, '127.0.0.1')
  await once(restarted, 'listening')
  const address = restarted.address()
  assert.ok(address && typeof address !== 'string')
  const request = (path: string, body?: unknown, cookie = ada.cookie) => fetch(`http://127.0.0.1:${address.port}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  const restored = await (await request('/api/life?city=lagos')).json() as { state: { estate: { upgrade: { startedAt: number; doneAt: number } | null } } }
  assert.ok(restored.state.estate.upgrade, 'the paid pending upgrade is present after loading the saved Node store')
  assert.deepEqual([restored.state.estate.upgrade.startedAt, restored.state.estate.upgrade.doneAt],
    [first.settledAt, first.settledAt + 600_000])
  const beforeReplay = await restarted.store.read(db => db.sessions[ada.cookie.slice(4)]?.cities.lagos?.state.cash)
  const replay = await (await request('/api/probe/settled-upgrade', { actionId })).json() as ProbeReply
  assert.deepEqual([replay.ok, replay.code, replay.duplicate], [true, 'upgrade_started', true])
  assert.equal(replay.cash, beforeReplay)
  assert.equal(replay.cash, paidBalance)
  assert.deepEqual(replay.upgrade, first.upgrade, 'replay returns the existing pending action without moving its clock')

  const publicRestored = await (await request('/api/life?city=lagos', undefined, bola.cookie)).json() as {
    state: { t: number; cash: number; estate: { upgrade: { startedAt: number; doneAt: number } | null } }
  }
  assert.ok(publicRestored.state.estate.upgrade)
  assert.ok(publicRestored.state.t > publicSettledAt, 'reload performs a later settlement independently')
  assert.equal(publicRestored.state.estate.upgrade.startedAt, publicSettledAt,
    'reloading preserves the original action timestamp rather than moving it to the later settlement')
  assert.equal(publicRestored.state.cash, publicPaidBalance)
  const publicReplay = await (await request('/api/action', {
    actionId: publicActionId, cityId: 'lagos', type: 'estate.upgrade', payload: { to: 'bq' },
  }, bola.cookie)).json() as { ok: boolean; code: string; duplicate?: boolean; state: { cash: number; estate: { upgrade: { startedAt: number; doneAt: number } | null } } }
  assert.deepEqual([publicReplay.ok, publicReplay.code, publicReplay.duplicate], [true, 'upgrade_started', true])
  assert.equal(publicReplay.state.cash, publicPaidBalance)
  assert.deepEqual(publicReplay.state.estate.upgrade, publicRestored.state.estate.upgrade)
})
