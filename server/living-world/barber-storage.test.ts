import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { createServer, type AllworldServer } from '../server.ts'
import { createStore } from '../store.ts'
import { KEYED_SPECS, type StoreLayout } from '../keyed.ts'
import { flakyDisk, snapshot } from '../test-fixture.ts'
import { ROUTE_MODULES } from '../routes/index.ts'
import livingWorldRoutes from '../routes/living-world.ts'
import type { BarberResponse, BarberSessionView } from '../../src/types/living-world-barber.ts'
import type { Look } from '../../src/types/life.ts'
import type { TimedId } from '../../src/types/protocol.ts'

const PATH = '/api/living-world/barber'
const LOOK: Look = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }
type Player = { id: string; cookie: string }
type Reply = BarberResponse & { serverTime?: number; storage?: string; error?: string }
type Host = {
  server: AllworldServer
  request(path: string, body?: unknown, cookie?: string): Promise<Response>
  close(): Promise<void>
}

async function openHost(dir: string, now: () => number, layout: StoreLayout, disk: ReturnType<typeof flakyDisk>): Promise<Host> {
  const store = await createStore(dir, { layout, io: disk.io, now, log: () => {} })
  const server = await createServer({ dataDir: dir, store, now, heartbeatMs: 60_000, sessionTtlMs: 2_592_000_000, log: () => {} })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test host did not bind a TCP address')
  return {
    server,
    request: (path, body, cookie) => fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

function requestId(now: number): TimedId { return `${now}:${randomUUID()}` }
async function post(host: Host, suffix: string, body: object, player: Player): Promise<{ status: number; body: Reply }> {
  const response = await host.request(PATH + suffix, body, player.cookie)
  return { status: response.status, body: await response.json() as Reply }
}
async function current(host: Host, player: Player): Promise<Reply> {
  return await (await host.request(`${PATH}?city=lagos`, undefined, player.cookie)).json() as Reply
}
async function wallet(host: Host, player: Player): Promise<{ cash: number; ledger: unknown }> {
  return host.server.store.read(db => {
    const life = Object.values(db.sessions).find(item => item.publicId === player.id)?.cities.lagos?.state
    return { cash: life?.cash ?? -1, ledger: snapshot(life?.ledger) }
  })
}
async function row(host: Host, player: Player): Promise<unknown> {
  return host.server.store.read(db => snapshot((db.livingWorld as { barber?: Record<string, unknown> } | undefined)?.barber?.[player.id]))
}
async function receipt(host: Host, player: Player, id: TimedId): Promise<unknown> {
  return host.server.store.read(db => {
    const owner = Object.values(db.sessions).find(item => item.publicId === player.id)
    const saved = owner?.once?.[id]
    return saved === undefined ? undefined : snapshot(saved)
  })
}
async function onboard(host: Host, now: () => number): Promise<Player> {
  const created = await host.request('/api/session', { name: 'Storage Guest', onboarding: true })
  assert.equal(created.status, 200)
  const body = await created.json() as { session?: { id?: string } }
  const player = { id: body.session?.id ?? '', cookie: (created.headers.get('set-cookie') ?? '').split(';')[0] ?? '' }
  assert.ok(player.id && player.cookie)
  const confirmed = await host.request('/api/action', {
    actionId: requestId(now()), cityId: 'lagos', type: 'onboarding.quick-start', payload: { look: LOOK },
  }, player.cookie)
  assert.equal((await confirmed.json() as { code: string }).code, 'playing')
  return player
}

async function stroke(host: Host, player: Player, now: { value: number }, session: BarberSessionView,
  tool: 'comb' | 'clippers' | 'brush', y: number): Promise<BarberSessionView> {
  const frames = [0.25, 0.4, 0.55].map(x => ({ tool, x, y, pressed: true }))
  const body = { cityId: 'lagos', sessionId: session.sessionId, revision: session.revision, sequence: session.nextSequence, frames }
  now.value += frames.length * 100
  const response = await post(host, '/input', body, player)
  assert.equal(response.body.ok, true, response.body.code)
  assert.ok(response.body.session)
  return response.body.session
}
async function finish(host: Host, player: Player, now: { value: number }, initial: BarberSessionView): Promise<BarberSessionView> {
  let session = initial
  for (const [tool, y] of [['comb', 0.4], ['clippers', 0.69], ['brush', 0.47]] as const) session = await stroke(host, player, now, session, tool, y)
  assert.deepEqual([session.status, session.practice.objectiveIndex], ['complete', 3])
  return session
}

test('barber result, once receipts, tool debit and wallet survive Node storage layouts and restart rollback', async t => {
  assert.ok(ROUTE_MODULES.includes(livingWorldRoutes), 'exercise the registered production HTTP routes')
  assert.ok(KEYED_SPECS.livingWorld?.some(spec => spec.path.length === 1 && spec.path[0] === 'barber'), 'barber rows have an isolated keyed entry map')
  const dir = await mkdtemp(join(tmpdir(), 'joinallworld-barber-storage-'))
  const now = { value: 100_000 }, disk = flakyDisk()
  let host = await openHost(dir, () => now.value, 'legacy', disk)
  t.after(async () => { await host.close(); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }) })
  const restart = async (layout: StoreLayout): Promise<void> => { await host.close(); host = await openHost(dir, () => now.value, layout, disk) }
  const player = await onboard(host, () => now.value)
  const started = await post(host, '/start', { cityId: 'lagos', lessonId: 'basic', requestId: requestId(now.value) }, player)
  assert.ok(started.body.ok && started.body.session)

  const cursorPacket = { cityId: 'lagos', sessionId: started.body.session.sessionId, revision: started.body.session.revision,
    sequence: started.body.session.nextSequence, frames: [{ tool: 'comb', x: 0.25, y: 0.4, pressed: true }] }
  now.value += 100
  const cursor = await post(host, '/input', cursorPacket, player)
  assert.deepEqual([cursor.body.ok, cursor.body.session?.practice.pointerDown], [true, true])
  const cursorRow = await row(host, player)
  await restart('shadow')
  const reloaded = await current(host, player)
  assert.deepEqual([reloaded.session?.status, reloaded.session?.practice.pointerDown, reloaded.session?.practice.cursor], ['paused', false, null],
    'loading a durable active cursor pauses it and clears the held tool')
  assert.notDeepEqual(await row(host, player), cursorRow, 'the reload pause is durably recorded before the response')
  assert.equal((await host.server.store.layout?.status())?.requested, 'shadow')

  const resumed = await post(host, '/resume', { cityId: 'lagos', sessionId: reloaded.session!.sessionId,
    revision: reloaded.session!.revision, requestId: requestId(now.value) }, player)
  assert.ok(resumed.body.ok && resumed.body.session)
  const walletBeforeClaim = await wallet(host, player)
  const complete = await finish(host, player, now, resumed.body.session)
  assert.equal(complete.practice.status, 'complete')
  assert.deepEqual(await wallet(host, player), walletBeforeClaim, 'an earned mannequin result is unpaid until explicitly claimed')
  const unpaidRow = await row(host, player) as { results?: Record<string, unknown>; lessons?: Record<string, { claimed?: boolean }> }
  assert.equal(unpaidRow.results?.['basic'], undefined)
  assert.equal(unpaidRow.lessons?.['basic']?.claimed, false)

  const claimBody = { cityId: 'lagos', lessonId: 'basic', sessionId: complete.sessionId, requestId: requestId(now.value) }
  const [claim, claimRetry] = await Promise.all([post(host, '/claim', claimBody, player), post(host, '/claim', claimBody, player)])
  assert.ok(claim.body.ok && claimRetry.body.ok)
  assert.equal([claim.body.duplicate, claimRetry.body.duplicate].filter(Boolean).length, 1)
  assert.deepEqual(claim.body.results, [{ lessonId: 'basic', styleId: 'man-low-cut-v1', earnedAt: now.value }])
  const paidWallet = await wallet(host, player)
  assert.equal(paidWallet.cash, walletBeforeClaim.cash + 80)
  const retainedRow = await row(host, player)
  const claimReceipt = await receipt(host, player, claimBody.requestId)
  const newClaim = await post(host, '/claim', { ...claimBody, requestId: requestId(now.value) }, player)
  assert.equal(newClaim.body.code, 'lesson_retained')
  assert.deepEqual(await wallet(host, player), paidWallet, 'a new claim id cannot pay the NPC lesson twice')

  // Fixture-only storage setup for the fixed 120-naira upgrade rollback test. This is not a
  // delivered-earnings journey: the preceding basic lesson really earned only its 80-naira payout.
  await host.server.store.transact(db => {
    const owner = Object.values(db.sessions).find(item => item.publicId === player.id)
    assert.ok(owner?.cities.lagos)
    owner.cities.lagos.state.cash = 120
  })
  const settledFunding = await host.request('/api/life?city=lagos', undefined, player.cookie)
  assert.equal(settledFunding.status, 200)
  assert.equal((await settledFunding.json() as { state: { cash: number } }).state.cash, 120,
    'settle the fixture balance through the production life route before taking rollback snapshots')
  const fundedWallet = await wallet(host, player), upgradeRow = await row(host, player)
  assert.equal((fundedWallet.ledger as unknown[]).length, (paidWallet.ledger as unknown[]).length + 1,
    'wallet settlement records its correction before the upgrade transaction starts')
  const upgradeBody = { cityId: 'lagos', requestId: requestId(now.value) }
  const failedReceipt = await receipt(host, player, upgradeBody.requestId)
  assert.equal(failedReceipt, undefined)
  disk.fail = 'ENOSPC'
  const failed = await post(host, '/upgrade', upgradeBody, player)
  disk.fail = null
  assert.deepEqual([failed.status, failed.body.error], [503, 'storage_unavailable'])
  assert.deepEqual(await row(host, player), upgradeRow, 'a failed durable write rolls back the barber row')
  assert.deepEqual(await wallet(host, player), fundedWallet, 'a failed upgrade leaves the cash and ledger unchanged')
  assert.equal(await receipt(host, player, upgradeBody.requestId), undefined, 'the refused durable transaction leaves no once receipt')

  const upgraded = await post(host, '/upgrade', upgradeBody, player)
  assert.deepEqual([upgraded.status, upgraded.body.ok, upgraded.body.code, upgraded.body.starterTool], [200, true, 'barber_tool_upgraded', true])
  const upgradedWallet = await wallet(host, player), upgradedRow = await row(host, player)
  assert.equal(upgradedWallet.cash, 0)
  assert.equal((upgradedWallet.ledger as unknown[]).length, (fundedWallet.ledger as unknown[]).length + 1)
  const upgradeReceipt = await receipt(host, player, upgradeBody.requestId)
  assert.ok(upgradeReceipt)

  async function assertRetainedState(): Promise<void> {
    const view = await current(host, player)
    assert.deepEqual([view.ok, view.results], [true, [{ lessonId: 'basic', styleId: 'man-low-cut-v1', earnedAt: claim.body.results[0]!.earnedAt }]])
    assert.equal(view.starterTool, true)
    assert.deepEqual(await wallet(host, player), upgradedWallet)
    assert.deepEqual(await row(host, player), upgradedRow)
    const claimAgain = await post(host, '/claim', claimBody, player)
    assert.deepEqual([claimAgain.body.ok, claimAgain.body.duplicate, claimAgain.body.code, claimAgain.body.results], [true, true, 'lesson_claimed', claim.body.results])
    const upgradeAgain = await post(host, '/upgrade', upgradeBody, player)
    assert.deepEqual([upgradeAgain.body.ok, upgradeAgain.body.starterTool, upgradeAgain.body.duplicate, upgradeAgain.body.code], [true, true, true, 'barber_tool_upgraded'])
    assert.deepEqual(await wallet(host, player), upgradedWallet, 'same-ID retries never pay or debit twice')
  }
  assert.deepEqual(await receipt(host, player, claimBody.requestId), claimReceipt)
  assert.deepEqual(await receipt(host, player, upgradeBody.requestId), upgradeReceipt)
  await restart('shadow')
  assert.equal((await host.server.store.layout?.status())?.requested, 'shadow')
  await assertRetainedState()
  await restart('entries')
  assert.equal((await host.server.store.layout?.status())?.requested, 'entries')
  await assertRetainedState()
  await restart('legacy')
  assert.equal((await host.server.store.layout?.status())?.requested, 'legacy')
  await assertRetainedState()

  const newUpgrade = await post(host, '/upgrade', { cityId: 'lagos', requestId: requestId(now.value) }, player)
  assert.deepEqual([newUpgrade.body.code, newUpgrade.body.starterTool], ['barber_tool_retained', true])
  assert.deepEqual(await wallet(host, player), upgradedWallet, 'a new id after restart cannot debit for the retained tool')
  assert.deepEqual([await receipt(host, player, claimBody.requestId), await receipt(host, player, upgradeBody.requestId)], [claimReceipt, upgradeReceipt])
  assert.deepEqual(await row(host, player), upgradedRow)
})
