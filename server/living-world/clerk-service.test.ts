import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture, flakyDisk, snapshot } from '../test-fixture.ts'
import { ROUTE_MODULES } from '../routes/index.ts'
import livingWorldRoutes from '../routes/living-world.ts'
import type { ClerkResponse } from '../../src/types/living-world-clerk.ts'
import type { Look } from '../../src/types/life.ts'

const PATH = '/api/living-world/clerk'
const LOOK: Look = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }
type Player = { cookie: string; id: string }
type Reply = ClerkResponse & { error?: string; serverTime?: number }
const id = (f: Awaited<ReturnType<typeof fixture>>) => f.id()

async function setup(t: Parameters<typeof fixture>[0], options: Parameters<typeof fixture>[1] = {}) {
  assert.ok(ROUTE_MODULES.includes(livingWorldRoutes), 'clerk coverage uses the production living-world route module')
  return fixture(t, options)
}
async function onboard(f: Awaited<ReturnType<typeof fixture>>, name: string): Promise<Player> {
  const created = await f.request('/api/session', { name, onboarding: true })
  assert.equal(created.status, 200)
  const value = await created.json() as { session?: { id?: string } }
  const player = { cookie: (created.headers.get('set-cookie') ?? '').split(';')[0] ?? '', id: value.session?.id ?? '' }
  assert.ok(player.cookie && player.id)
  assert.equal((await f.action(player.cookie, { type: 'onboarding.quick-start', payload: { look: LOOK } })).code, 'playing')
  return player
}
async function post(f: Awaited<ReturnType<typeof fixture>>, suffix: string, body: object, player: Player): Promise<Reply> {
  return await (await f.request(PATH + suffix, body, player.cookie)).json() as Reply
}
async function current(f: Awaited<ReturnType<typeof fixture>>, player: Player): Promise<Reply> {
  return await (await f.request(`${PATH}?city=lagos`, null, player.cookie)).json() as Reply
}
async function wallet(f: Awaited<ReturnType<typeof fixture>>, player: Player): Promise<{ cash: number; ledger: unknown }> {
  return f.server.store.read(db => {
    const state = Object.values(db.sessions).find(item => item.publicId === player.id)?.cities.lagos?.state
    return { cash: state?.cash ?? -1, ledger: snapshot(state?.ledger) }
  })
}
async function answer(f: Awaited<ReturnType<typeof fixture>>, player: Player, revision: number, stepId: string, evidenceId: string, requestId = id(f)): Promise<Reply> {
  return post(f, '/step', { cityId: 'lagos', requestId, revision, stepId, evidenceId }, player)
}
async function finish(f: Awaited<ReturnType<typeof fixture>>, player: Player): Promise<Reply> {
  let currentView = await current(f, player)
  assert.equal(currentView.ok, true)
  const answers = [
    ['inspect_receipt', 'receipt'],
    ['inspect_dispatch', 'dispatch'],
    ['compare_discrepancy', 'compare-b'],
    ['choose_outcome', 'outcome-a'],
  ] as const
  for (let revision = currentView.revision ?? 0; revision < answers.length; revision++) {
    const [stepId, evidenceId] = answers[revision]!
    currentView = await answer(f, player, revision, stepId, evidenceId)
    assert.equal(currentView.ok, true, currentView.code)
    assert.equal(currentView.revision, revision + 1)
  }
  assert.equal(currentView.practice?.step, 'complete')
  return currentView
}

test('authored clerk case needs ordered evidence and pays the fixed fictional reward once', async t => {
  const f = await setup(t), player = await onboard(f, 'Clerk learner'), other = await onboard(f, 'Other learner')
  await f.server.store.transact(db => {
    const session = Object.values(db.sessions).find(item => item.publicId === player.id)
    assert.ok(session?.cities.lagos)
    session.cities.lagos.state.cash = 0
  })
  await (await f.request('/api/life?city=lagos', null, player.cookie)).arrayBuffer()
  const before = await wallet(f, player), otherBefore = await wallet(f, other)
  const forged = await f.action(player.cookie, { type: 'living-world.server', payload: { op: 'clerk-reward' } })
  assert.equal(forged.code, 'server_only', 'the internal reward operation is unavailable through player actions')

  const ready = await current(f, player)
  assert.deepEqual([ready.ok, ready.code, ready.practice, ready.revision, ready.claimed, ready.reward], [true, 'practice_ready', null, null, false, 75])
  const startId = id(f), begun = await post(f, '/start', { cityId: 'lagos', requestId: startId }, player)
  assert.deepEqual([begun.ok, begun.code, begun.revision, begun.practice?.step], [true, 'practice_started', 0, 'inspect_receipt'])
  assert.equal('actorId' in (begun.practice ?? {}), false, 'the public projection does not expose the saved actor binding')
  assert.equal(begun.practice?.narrative.includes('Fictional NPC practice'), true)
  const retriedStart = await post(f, '/start', { requestId: startId, cityId: 'lagos' }, player)
  assert.deepEqual([retriedStart.ok, retriedStart.duplicate, retriedStart.practice], [true, true, begun.practice])
  const otherActor = await answer(f, other, 0, 'inspect_receipt', 'receipt')
  assert.deepEqual([otherActor.ok, otherActor.code, otherActor.practice], [false, 'practice_not_started', null],
    'a request by another authenticated session cannot name or advance the saved actor')

  const wrongOrder = await answer(f, player, 0, 'choose_outcome', 'outcome-a')
  assert.deepEqual([wrongOrder.ok, wrongOrder.code, wrongOrder.revision], [false, 'step_out_of_order', 0])
  const wrongChoice = await answer(f, player, 0, 'inspect_receipt', 'dispatch')
  assert.deepEqual([wrongChoice.ok, wrongChoice.code, wrongChoice.revision, wrongChoice.reason], [false, 'learning_feedback', 0, 'Start by opening the receiving receipt.'])
  assert.equal((await current(f, player)).practice?.step, 'inspect_receipt')
  assert.deepEqual(await wallet(f, player), before, 'practice and feedback do not award money')
  assert.equal((await post(f, '/step', { cityId: 'lagos', requestId: id(f), revision: 0, stepId: 'inspect_receipt', evidenceId: 'receipt', completed: true }, player)).error,
    'invalid_clerk_request', 'extra client progress fields are refused')
  const beforeEarlyClaim = await f.server.store.read(db => snapshot((db.livingWorld as { clerk: Record<string, unknown> }).clerk[player.id]))
  const earlyClaim = await post(f, '/claim', { cityId: 'lagos', requestId: id(f), revision: 4 }, player)
  assert.deepEqual([earlyClaim.ok, earlyClaim.code, earlyClaim.claimed], [false, 'practice_incomplete', false],
    'a structurally valid claim cannot substitute for the authored evidence steps')
  assert.deepEqual(await f.server.store.read(db => snapshot((db.livingWorld as { clerk: Record<string, unknown> }).clerk[player.id])), beforeEarlyClaim)
  assert.deepEqual(await wallet(f, player), before)

  const firstRequestId = id(f)
  const firstBody = { cityId: 'lagos', requestId: firstRequestId, revision: 0, stepId: 'inspect_receipt', evidenceId: 'receipt' }
  const firstStep = await post(f, '/step', firstBody, player)
  const firstRetry = await post(f, '/step', firstBody, player)
  assert.deepEqual([firstStep.ok, firstStep.revision, firstRetry.ok, firstRetry.duplicate, firstRetry.practice],
    [true, 1, true, true, firstStep.practice], 'a step receipt replays the current trusted practice projection')
  const changedSameId = await f.request(PATH + '/step', { ...firstBody, evidenceId: 'dispatch' }, player.cookie)
  assert.deepEqual([changedSameId.status, (await changedSameId.json() as { error: string }).error], [409, 'client_id_conflict'])

  let complete = await finish(f, player)
  const completionWallet = await wallet(f, player)
  assert.deepEqual(completionWallet, before, 'completing the scenario still requires a separate claim')
  complete = await current(f, player)
  assert.equal(complete.practice?.step, 'complete')

  const claimBody = { cityId: 'lagos', revision: 4, requestId: id(f) }
  const [paid, retry] = await Promise.all([post(f, '/claim', claimBody, player), post(f, '/claim', claimBody, player)])
  assert.equal([paid.duplicate, retry.duplicate].filter(Boolean).length, 1)
  assert.deepEqual([paid.ok, retry.ok, paid.claimed, retry.claimed, paid.reward], [true, true, true, true, 75])
  const after = await wallet(f, player)
  assert.equal(after.cash, before.cash + 75)
  assert.equal((after.ledger as unknown[]).length, (before.ledger as unknown[]).length + 1, 'one terminal claim produces one wallet ledger entry')
  const newId = await post(f, '/claim', { ...claimBody, requestId: id(f) }, player)
  assert.deepEqual([newId.ok, newId.code, newId.claimed], [false, 'practice_claimed', true])
  assert.deepEqual(await wallet(f, player), after, 'a fresh request id cannot claim the same practice twice')
  assert.deepEqual(await wallet(f, other), otherBefore, 'the reward cannot change another player wallet')
})

test('clerk practice travels within Lagos while account changes hide the retained case', async t => {
  const f = await setup(t), player = await onboard(f, 'Bound learner')
  const begun = await post(f, '/start', { cityId: 'lagos', requestId: id(f) }, player)
  assert.equal(begun.ok, true)
  const origin = await f.server.store.read(db => snapshot((db.livingWorld as { clerk: Record<string, unknown> }).clerk[player.id]))
  const firstStroke = { cityId: 'lagos', requestId: id(f), revision: 0, stepId: 'inspect_receipt', evidenceId: 'receipt' }
  const accepted = await post(f, '/step', firstStroke, player)
  assert.deepEqual([accepted.ok, accepted.revision], [true, 1])
  await f.server.store.transact(db => {
    const session = Object.values(db.sessions).find(item => item.publicId === player.id)
    assert.ok(session?.cities.lagos)
    session.cities.lagos.state.location = 'salon' as typeof session.cities.lagos.state.location
  })
  const traveled = await post(f, '/step', firstStroke, player)
  assert.deepEqual([traveled.ok, traveled.duplicate, traveled.revision, traveled.practice?.step], [true, true, 1, 'inspect_dispatch'],
    'the authored case and its receipt remain available to the same actor after moving elsewhere in Lagos')
  const retained = await f.server.store.read(db => snapshot((db.livingWorld as { clerk: Record<string, unknown> }).clerk[player.id]))
  assert.equal((retained as { location: string }).location, (origin as { location: string }).location,
    'origin location is validated metadata, not an authorization gate')
  await f.server.store.transact(db => {
    const rows = (db.livingWorld as { clerk: Record<string, Record<string, unknown>> }).clerk
    const row = rows[player.id]!
    row.account = 'fb:someone-else'
  })
  const accountBound = await f.server.store.read(db => snapshot((db.livingWorld as { clerk: Record<string, unknown> }).clerk[player.id]))
  f.advance(-1)
  const wrongOwner = await current(f, player)
  assert.deepEqual([wrongOwner.code, wrongOwner.practice], ['account_changed', null],
    'account ownership is checked before the backwards clock and never reveals the retained view')
  assert.deepEqual(await f.server.store.read(db => snapshot((db.livingWorld as { clerk: Record<string, unknown> }).clerk[player.id])), accountBound)

  await f.server.store.transact(db => {
    const rows = (db.livingWorld as { clerk: Record<string, unknown> }).clerk
    rows[player.id] = { v: 2, publicId: player.id, unexpected: true }
  })
  const corrupt = await f.server.store.read(db => snapshot((db.livingWorld as { clerk: Record<string, unknown> }).clerk[player.id]))
  const quarantined = await current(f, player)
  assert.deepEqual([quarantined.ok, quarantined.code], [false, 'invalid_saved_clerk'])
  assert.deepEqual(await f.server.store.read(db => snapshot((db.livingWorld as { clerk: Record<string, unknown> }).clerk[player.id])), corrupt,
    'future schema rows remain byte-for-byte available for recovery')
  assert.equal((retained as { practice: { revision: number } }).practice.revision, 1)
})

test('GET is read-only and rejects malformed step bodies before any saved progress changes', async t => {
  const f = await setup(t), player = await onboard(f, 'Read only')
  const started = await post(f, '/start', { cityId: 'lagos', requestId: id(f) }, player)
  assert.equal(started.ok, true)
  const before = await f.server.store.read(db => snapshot((db.livingWorld as { clerk: Record<string, unknown> }).clerk[player.id]))
  for (let i = 0; i < 4; i++) assert.equal((await current(f, player)).revision, 0)
  const extra = await post(f, '/step', { cityId: 'lagos', requestId: id(f), revision: 0, stepId: 'inspect_receipt', evidenceId: 'receipt', actorId: player.id }, player)
  assert.equal(extra.error, 'invalid_clerk_request')
  const after = await f.server.store.read(db => snapshot((db.livingWorld as { clerk: Record<string, unknown> }).clerk[player.id]))
  assert.deepEqual(after, before, 'read and malformed requests do not move persisted evidence state')
})

test('a failed durable reward commit rolls back the claim and allows the identical request to recover', async t => {
  const disk = flakyDisk(), f = await setup(t, { disk }), player = await onboard(f, 'Clerk recovery')
  await post(f, '/start', { cityId: 'lagos', requestId: id(f) }, player)
  await finish(f, player)
  const request = { cityId: 'lagos', revision: 4, requestId: id(f) }
  const beforeRow = await f.server.store.read(db => snapshot((db.livingWorld as { clerk: Record<string, unknown> }).clerk[player.id]))
  const beforeWallet = await wallet(f, player)
  disk.fail = 'ENOSPC'
  const failed = await f.request(PATH + '/claim', request, player.cookie)
  assert.deepEqual([failed.status, (await failed.json() as { error: string }).error], [503, 'storage_unavailable'])
  disk.fail = null
  assert.deepEqual(await f.server.store.read(db => snapshot((db.livingWorld as { clerk: Record<string, unknown> }).clerk[player.id])), beforeRow,
    'a failed durable transaction leaves the completed unpaid case unchanged')
  assert.deepEqual(await wallet(f, player), beforeWallet, 'the action and saved claim flag roll back together')
  const recovered = await post(f, '/claim', request, player)
  assert.deepEqual([recovered.ok, recovered.code, recovered.claimed, recovered.duplicate ?? false], [true, 'practice_claimed', true, false])
  const after = await wallet(f, player)
  assert.equal(after.cash, beforeWallet.cash + 75)
  assert.equal((after.ledger as unknown[]).length, (beforeWallet.ledger as unknown[]).length + 1)
})

test('a backwards clock fails closed on reads, evidence steps, and reward claims', async t => {
  const f = await setup(t), player = await onboard(f, 'Clock-bound clerk')
  const begun = await post(f, '/start', { cityId: 'lagos', requestId: id(f) }, player)
  assert.equal(begun.ok, true)
  const before = await f.server.store.read(db => snapshot((db.livingWorld as { clerk: Record<string, unknown> }).clerk[player.id]))
  f.advance(-1)
  const loaded = await current(f, player)
  assert.deepEqual([loaded.ok, loaded.code], [false, 'invalid_server_clock'])
  const stepped = await answer(f, player, 0, 'inspect_receipt', 'receipt')
  assert.deepEqual([stepped.ok, stepped.code, stepped.revision], [false, 'invalid_server_clock', 0])
  const claimed = await post(f, '/claim', { cityId: 'lagos', requestId: id(f), revision: 4 }, player)
  assert.deepEqual([claimed.ok, claimed.code, claimed.claimed], [false, 'invalid_server_clock', false])
  assert.deepEqual(await f.server.store.read(db => snapshot((db.livingWorld as { clerk: Record<string, unknown> }).clerk[player.id])), before)
})

test('two distinct request IDs cannot settle one completed case twice', async t => {
  const f = await setup(t), player = await onboard(f, 'Claim race')
  await f.server.store.transact(db => {
    const session = Object.values(db.sessions).find(item => item.publicId === player.id)
    assert.ok(session?.cities.lagos)
    session.cities.lagos.state.cash = 0
  })
  await (await f.request('/api/life?city=lagos', null, player.cookie)).arrayBuffer()
  const before = await wallet(f, player)
  await post(f, '/start', { cityId: 'lagos', requestId: id(f) }, player)
  await finish(f, player)
  const [left, right] = await Promise.all([
    post(f, '/claim', { cityId: 'lagos', revision: 4, requestId: id(f) }, player),
    post(f, '/claim', { cityId: 'lagos', revision: 4, requestId: id(f) }, player),
  ])
  assert.equal([left.ok, right.ok].filter(Boolean).length, 1, 'only one request can move the saved domain claim from unpaid to paid')
  assert.deepEqual([left.claimed, right.claimed], [true, true])
  const after = await wallet(f, player)
  assert.equal(before.cash, 0)
  assert.equal(after.cash, 75)
  assert.equal((after.ledger as unknown[]).length, (before.ledger as unknown[]).length + 1)
})
