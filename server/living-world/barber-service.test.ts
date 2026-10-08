import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture, flakyDisk, snapshot } from '../test-fixture.ts'
import { ROUTE_MODULES } from '../routes/index.ts'
import livingWorldRoutes from '../routes/living-world.ts'
import type { BarberResponse, BarberSessionView } from '../../src/types/living-world-barber.ts'
import type { Look } from '../../src/types/life.ts'

const PATH = '/api/living-world/barber'
const LOOK: Look = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }
type Player = { cookie: string; id: string }
type Reply = BarberResponse & { serverTime?: number; storage?: string; error?: string }
const identifier = (f: Awaited<ReturnType<typeof fixture>>) => f.id()

async function setup(t: Parameters<typeof fixture>[0], options: Parameters<typeof fixture>[1] = {}) {
  assert.ok(ROUTE_MODULES.includes(livingWorldRoutes), 'barber uses the production living-world route module')
  return fixture(t, options)
}
async function onboard(f: Awaited<ReturnType<typeof fixture>>, name: string): Promise<Player> {
  const created = await f.request('/api/session', { name, onboarding: true })
  assert.equal(created.status, 200)
  const body = await created.json() as { session?: { id?: string } }
  const player = { cookie: (created.headers.get('set-cookie') ?? '').split(';')[0] ?? '', id: body.session?.id ?? '' }
  assert.ok(player.cookie && player.id)
  const action = await f.action(player.cookie, { type: 'onboarding.quick-start', payload: { look: LOOK } })
  assert.equal(action.code, 'playing')
  const onboarding = await f.server.store.read(db => Object.values(db.sessions).find(item => item.publicId === player.id)?.cities.lagos?.state.onboarding)
  assert.deepEqual([onboarding?.required, onboarding?.done], [false, false], 'confirmed quick-start guests remain eligible for simulated NPC practice')
  return player
}
async function post(f: Awaited<ReturnType<typeof fixture>>, suffix: string, body: object, player: Player): Promise<Reply> {
  return await (await f.request(PATH + suffix, body, player.cookie)).json() as Reply
}
async function current(f: Awaited<ReturnType<typeof fixture>>, player: Player): Promise<Reply> {
  return await (await f.request(`${PATH}?city=lagos`, null, player.cookie)).json() as Reply
}
async function cash(f: Awaited<ReturnType<typeof fixture>>, player: Player): Promise<number> {
  const body = await (await f.request('/api/life?city=lagos', null, player.cookie)).json() as { state?: { cash?: number } }
  return body.state?.cash ?? NaN
}
async function wallet(f: Awaited<ReturnType<typeof fixture>>, player: Player): Promise<{ cash: number; ledger: unknown }> {
  return f.server.store.read(db => {
    const state = Object.values(db.sessions).find(item => item.publicId === player.id)?.cities.lagos?.state
    return { cash: state?.cash ?? -1, ledger: snapshot(state?.ledger) }
  })
}
async function stroke(f: Awaited<ReturnType<typeof fixture>>, player: Player, session: BarberSessionView, tool: 'comb' | 'clippers' | 'brush', y: number, xs = [0.25, 0.4, 0.55]): Promise<Reply> {
  const frames = xs.map(x => ({ tool, x, y, pressed: true }))
  const body = { cityId: 'lagos', sessionId: session.sessionId, revision: session.revision, sequence: session.nextSequence, frames }
  f.advance(frames.length * 100)
  const accepted = await post(f, '/input', body, player)
  const retry = await post(f, '/input', body, player)
  assert.deepEqual([retry.ok, retry.duplicate, retry.session], [true, true, accepted.session], 'same control sequence replays its exact committed frame result')
  const reorderedFrame = { pressed: true, y, x: xs[0]!, tool }
  const reordered = await post(f, '/input', { frames: [reorderedFrame, ...xs.slice(1).map(x => ({ pressed: true, y, x, tool }))], sequence: body.sequence,
    revision: body.revision, sessionId: body.sessionId, cityId: body.cityId }, player)
  assert.deepEqual([reordered.ok, reordered.duplicate, reordered.session], [true, true, accepted.session], 'JSON key order cannot turn the same frame into a conflict')
  const conflict = await post(f, '/input', { ...body, frames: [{ ...frames[0]!, x: 0.26 }, ...frames.slice(1)] }, player)
  assert.equal(conflict.code, 'packet_conflict', 'the same sequence cannot carry different strokes')
  assert.deepEqual(conflict.session, accepted.session)
  return accepted
}
async function finishLesson(f: Awaited<ReturnType<typeof fixture>>, player: Player, session: BarberSessionView): Promise<BarberSessionView> {
  for (const [tool, y, xs] of [
    ['comb', 0.4, [0.25, 0.4, 0.55]], ['clippers', 0.69, [0.25, 0.4, 0.55]], ['brush', 0.47, [0.4, 0.55, 0.7]],
  ] as const) {
    const next = await stroke(f, player, session, tool, y, [...xs])
    assert.equal(next.ok, true, next.code)
    assert.ok(next.session)
    session = next.session
  }
  assert.equal(session.status, 'complete')
  return session
}
const start = (f: Awaited<ReturnType<typeof fixture>>, player: Player, lessonId: 'basic' | 'advanced', requestId = identifier(f)) =>
  post(f, '/start', { cityId: 'lagos', lessonId, requestId }, player)

test('NPC mannequin lessons require active strokes, then atomically pay once and unlock the fixed tool upgrade', async t => {
  const f = await setup(t), player = await onboard(f, 'Ada'), other = await onboard(f, 'Bola')
  await f.server.store.transact(db => {
    const owner = Object.values(db.sessions).find(item => item.publicId === player.id)
    assert.ok(owner?.cities.lagos)
    owner.cities.lagos.state.cash = 0
  })
  const before = await wallet(f, player), otherBefore = await wallet(f, other)
  const lookAndWardrobeBefore = await f.server.store.read(db => {
    const owner = Object.values(db.sessions).find(item => item.publicId === player.id)
    assert.ok(owner?.cities.lagos)
    return snapshot({ look: owner.cities.lagos.state.onboarding.look, wardrobe: owner.cities.lagos.state.onboarding.wardrobe })
  })
  const forgedSystemAction = await f.action(player.cookie, { type: 'living-world.server', payload: { op: 'barber-reward', lessonId: 'basic' } })
  assert.equal(forgedSystemAction.code, 'server_only', 'clients cannot invoke the internal wallet/result action')
  const early = await start(f, player, 'advanced')
  assert.deepEqual([early.ok, early.code], [false, 'barber_tool_required'])
  assert.equal(await f.server.store.read(db => (db.livingWorld as { barber: Record<string, unknown> }).barber[player.id]), undefined,
    'an advanced lesson refusal does not initialize a saved barber row')
  const begun = await start(f, player, 'basic')
  assert.ok(begun.ok && begun.session && begun.plan)
  assert.equal(begun.plan.styleId, 'man-low-cut-v1')
  const storedBeforeEarlyInput = await f.server.store.read(db => snapshot((db.livingWorld as { barber: Record<string, unknown> }).barber[player.id]))
  const earlyInput = await post(f, '/input', { cityId: 'lagos', sessionId: begun.session.sessionId, revision: begun.session.revision,
    sequence: begun.session.nextSequence, frames: [{ tool: 'comb', x: 0.25, y: 0.4, pressed: true }] }, player)
  assert.deepEqual([earlyInput.code, earlyInput.session?.status, earlyInput.session?.practice.objectiveIndex, earlyInput.session?.practice.pointerDown],
    ['insufficient_time_credit', 'running', 0, false], 'elapsed server time is required before controls advance the mannequin lesson')
  assert.deepEqual(await f.server.store.read(db => snapshot((db.livingWorld as { barber: Record<string, unknown> }).barber[player.id])), storedBeforeEarlyInput,
    'an under-credited frame writes neither controls nor progress')
  const forgedHttp = await f.request(PATH + '/claim', { cityId: 'lagos', lessonId: 'basic', sessionId: begun.session.sessionId, requestId: identifier(f), completed: true, amount: 9999 }, player.cookie)
  assert.deepEqual([forgedHttp.status, (await forgedHttp.json() as { error: string }).error], [400, 'invalid_barber_request'])
  assert.deepEqual(await wallet(f, player), before)
  const stranger = await post(f, '/input', { cityId: 'lagos', sessionId: begun.session.sessionId, revision: begun.session.revision, sequence: 1, frames: [{ tool: 'comb', x: 0.25, y: 0.4, pressed: true }] }, other)
  assert.equal(stranger.code, 'no_practice')
  const complete = await finishLesson(f, player, begun.session)
  assert.equal(complete.practice.objectiveIndex, 3)
  assert.deepEqual(await wallet(f, player), before, 'active practice has no automatic payout')

  const claimBody = { cityId: 'lagos', lessonId: 'basic', sessionId: complete.sessionId, requestId: identifier(f) }
  const [paid, duplicate] = await Promise.all([post(f, '/claim', claimBody, player), post(f, '/claim', claimBody, player)])
  assert.equal([paid.duplicate, duplicate.duplicate].filter(Boolean).length, 1)
  assert.ok(paid.ok && duplicate.ok)
  assert.deepEqual([paid.results, duplicate.results], [[{ lessonId: 'basic', styleId: 'man-low-cut-v1', earnedAt: f.now() }], paid.results])
  const afterBasic = await wallet(f, player)
  assert.equal(afterBasic.cash, 80)
  assert.equal((afterBasic.ledger as unknown[]).length, (before.ledger as unknown[]).length + 1)
  const replay = await post(f, '/claim', { ...claimBody, requestId: identifier(f) }, player)
  assert.equal(replay.code, 'lesson_retained')
  assert.deepEqual(await wallet(f, player), afterBasic)
  const empty = await post(f, '/upgrade', { cityId: 'lagos', requestId: identifier(f) }, player)
  assert.equal(empty.code, 'insufficient_funds')
  assert.deepEqual(await wallet(f, player), afterBasic, 'the fixed 120 naira clipper upgrade refuses the 80 naira lesson balance unchanged')
  await f.server.store.transact(db => {
    const owner = Object.values(db.sessions).find(item => item.publicId === player.id)
    assert.ok(owner?.cities.lagos)
    owner.cities.lagos.state.cash = 120
  })
  // This deliberately seeded balance is only a purchase-path fixture, not proof of delivery earnings.
  // Settle it through the canonical life reader before measuring the upgrade ledger: wallet.sanitize
  // records the mismatch between this test-only balance and the prior ledger as a correction line.
  assert.equal(await cash(f, player), 120, 'the fixture funding is visible after canonical settlement')
  const beforeUpgrade = await wallet(f, player), upgradeBody = { cityId: 'lagos', requestId: identifier(f) }
  const [upgraded, upgradeRetry] = await Promise.all([post(f, '/upgrade', upgradeBody, player), post(f, '/upgrade', upgradeBody, player)])
  assert.deepEqual([upgraded.ok, upgradeRetry.ok, [upgraded.duplicate, upgradeRetry.duplicate].filter(Boolean).length, upgraded.starterTool, upgradeRetry.starterTool], [true, true, 1, true, true])
  const afterUpgrade = await wallet(f, player)
  assert.equal(afterUpgrade.cash, 0)
  assert.equal((afterUpgrade.ledger as unknown[]).length, (beforeUpgrade.ledger as unknown[]).length + 1, 'one same-ID retry writes one debit')
  const newUpgradeId = await post(f, '/upgrade', { cityId: 'lagos', requestId: identifier(f) }, player)
  assert.equal(newUpgradeId.code, 'barber_tool_retained')
  assert.deepEqual(await wallet(f, player), afterUpgrade, 'a new request id cannot debit for the already-owned tool')
  const advanced = await start(f, player, 'advanced')
  assert.ok(advanced.ok && advanced.session && advanced.plan)
  assert.equal(advanced.plan.styleId, 'man-fade-v1')
  const advancedDone = await finishLesson(f, player, advanced.session)
  const paidAdvanced = await post(f, '/claim', { cityId: 'lagos', lessonId: 'advanced', sessionId: advancedDone.sessionId, requestId: identifier(f) }, player)
  assert.deepEqual([paidAdvanced.ok, paidAdvanced.results.map(row => row.styleId), await cash(f, player)], [true, ['man-low-cut-v1', 'man-fade-v1'], 120])
  assert.deepEqual((await current(f, player)).results, paidAdvanced.results)
  const lookAndWardrobeAfter = await f.server.store.read(db => {
    const owner = Object.values(db.sessions).find(item => item.publicId === player.id)
    assert.ok(owner?.cities.lagos)
    return snapshot({ look: owner.cities.lagos.state.onboarding.look, wardrobe: owner.cities.lagos.state.onboarding.wardrobe })
  })
  assert.deepEqual(lookAndWardrobeAfter, lookAndWardrobeBefore, 'the mannequin style is never written to the real player look or wardrobe')
  assert.deepEqual(await wallet(f, other), otherBefore, 'another player receives no result or wallet mutation')
})

test('reload pauses a live tool, location changes cannot finish it, and malformed saves stay quarantined', async t => {
  const f = await setup(t), player = await onboard(f, 'Reload')
  const begun = await start(f, player, 'basic')
  assert.ok(begun.session)
  const frame = { tool: 'comb', x: 0.25, y: 0.4, pressed: true }
  const firstPacket = { cityId: 'lagos', sessionId: begun.session.sessionId, revision: begun.session.revision, sequence: 1, frames: [frame] }
  f.advance(100)
  const moved = await post(f, '/input', firstPacket, player)
  assert.ok(moved.session?.practice.pointerDown)
  const loaded = await current(f, player)
  assert.deepEqual([loaded.session?.status, loaded.session?.practice.pointerDown, loaded.session?.practice.cursor], ['paused', false, null])
  const resumed = await post(f, '/resume', { cityId: 'lagos', requestId: identifier(f), sessionId: loaded.session!.sessionId, revision: loaded.session!.revision }, player)
  assert.equal(resumed.session?.status, 'running')
  f.advance(1600)
  const timedOutRetry = await post(f, '/input', firstPacket, player)
  assert.deepEqual([timedOutRetry.duplicate, timedOutRetry.session?.status, timedOutRetry.session?.practice.pointerDown], [true, 'paused', false], 'timeout is processed before a stale packet retry')
  const resumedAgain = await post(f, '/resume', { cityId: 'lagos', requestId: identifier(f), sessionId: timedOutRetry.session!.sessionId, revision: timedOutRetry.session!.revision }, player)
  assert.equal(resumedAgain.session?.status, 'running')
  await f.server.store.transact(db => {
    const owner = Object.values(db.sessions).find(item => item.publicId === player.id)
    assert.ok(owner?.cities.lagos)
    owner.cities.lagos.state.location = 'salon' as typeof owner.cities.lagos.state.location
  })
  const atOldLocation = await post(f, '/input', { cityId: 'lagos', sessionId: resumedAgain.session!.sessionId, revision: resumedAgain.session!.revision, sequence: resumedAgain.session!.nextSequence, frames: [frame] }, player)
  assert.equal(atOldLocation.code, 'location_changed')
  assert.equal(atOldLocation.session?.status, 'paused')
  await f.server.store.transact(db => {
    const rows = (db.livingWorld as { barber: Record<string, Record<string, unknown>> }).barber
    rows[player.id]!.account = 'fb:other-account'
  })
  const accountBound = await f.server.store.read(db => snapshot((db.livingWorld as { barber: Record<string, unknown> }).barber[player.id]))
  assert.equal((await current(f, player)).code, 'account_changed')
  assert.deepEqual(await f.server.store.read(db => snapshot((db.livingWorld as { barber: Record<string, unknown> }).barber[player.id])), accountBound, 'a changed account binding cannot rewrite the record')
  await f.server.store.transact(db => {
    const rows = (db.livingWorld as { barber: Record<string, Record<string, unknown>> }).barber
    rows[player.id]!.account = null
  })
  await f.server.store.transact(db => {
    const rows = (db.livingWorld as { barber: Record<string, unknown> }).barber
    rows[player.id] = { v: 9, unexpected: true }
  })
  const before = await f.server.store.read(db => snapshot((db.livingWorld as { barber: Record<string, unknown> }).barber[player.id]))
  const quarantined = await current(f, player)
  const after = await f.server.store.read(db => snapshot((db.livingWorld as { barber: Record<string, unknown> }).barber[player.id]))
  assert.deepEqual([quarantined.code, before, after], ['invalid_saved_barber', before, before])
})

test('a backwards server clock pauses before accepting a retry of an old held-tool packet', async t => {
  const f = await setup(t), player = await onboard(f, 'Clock')
  const begun = await start(f, player, 'basic')
  assert.ok(begun.session)
  const packet = { cityId: 'lagos', sessionId: begun.session.sessionId, revision: begun.session.revision, sequence: 1,
    frames: [{ tool: 'comb', x: 0.25, y: 0.4, pressed: true }] }
  f.advance(100)
  const accepted = await post(f, '/input', packet, player)
  assert.ok(accepted.session?.practice.pointerDown)
  f.advance(-101)
  const retry = await post(f, '/input', packet, player)
  assert.deepEqual([retry.ok, retry.duplicate, retry.session?.status, retry.session?.practice.pointerDown], [true, true, 'paused', false])
})

test('malformed persisted barber receipts and status values stay quarantined without mutation', async t => {
  const f = await setup(t), player = await onboard(f, 'Receipt'), begun = await start(f, player, 'basic')
  assert.ok(begun.session)
  f.advance(100)
  const accepted = await post(f, '/input', { cityId: 'lagos', sessionId: begun.session.sessionId, revision: begun.session.revision,
    sequence: begun.session.nextSequence, frames: [{ tool: 'comb', x: 0.25, y: 0.4, pressed: true }] }, player)
  assert.ok(accepted.ok)
  type ReceiptRecord = { revision: number; sessionId: string; code: unknown; frames: Array<Record<string, unknown>> }
  type LessonRecord = { practice: { status: unknown }; revision: number; lastPacket: ReceiptRecord }
  type BarberRecordUnderTest = { lessons: Record<string, LessonRecord> }
  const base = await f.server.store.read(db => snapshot((db.livingWorld as { barber: Record<string, unknown> }).barber[player.id]))
  const corruptions: Array<[string, (progress: LessonRecord) => void]> = [
    ['coercible status', progress => { progress.practice.status = {} }],
    ['coercible receipt code', progress => { progress.lastPacket.code = {} }],
    ['invalid receipt frame', progress => { progress.lastPacket.frames[0]!.x = 1.5 }],
    ['receipt from another session', progress => { progress.lastPacket.sessionId = 'other-session' }],
    ['receipt revision is no longer prior', progress => { progress.lastPacket.revision = progress.revision }],
  ]
  for (const [label, corrupt] of corruptions) {
    await f.server.store.transact(db => {
      const row = (db.livingWorld as { barber: Record<string, BarberRecordUnderTest> }).barber[player.id]!
      row.lessons.basic!.practice.status = 'running'
      corrupt(row.lessons.basic!)
    })
    const before = await f.server.store.read(db => snapshot((db.livingWorld as { barber: Record<string, unknown> }).barber[player.id]))
    assert.equal((await current(f, player)).code, 'invalid_saved_barber', `${label} is rejected`)
    assert.deepEqual(await f.server.store.read(db => snapshot((db.livingWorld as { barber: Record<string, unknown> }).barber[player.id])), before,
      `${label} remains unchanged for recovery`)
    await f.server.store.transact(db => { (db.livingWorld as { barber: Record<string, unknown> }).barber[player.id] = snapshot(base) })
  }
})

test('saved lesson pointers exactly match the sole unclaimed lesson while completed unpaid work remains valid', async t => {
  const f = await setup(t), orphan = await onboard(f, 'Orphan'), player = await onboard(f, 'Two lessons')
  const orphanStart = await start(f, orphan, 'basic')
  assert.ok(orphanStart.session)
  const orphanDone = await finishLesson(f, orphan, orphanStart.session)
  assert.equal((await current(f, orphan)).session?.status, 'complete', 'a real completed unpaid lesson remains valid while still selected')
  await f.server.store.transact(db => {
    const row = (db.livingWorld as { barber: Record<string, { currentLesson: string | null }> }).barber[orphan.id]!
    row.currentLesson = null
  })
  const orphanBefore = await f.server.store.read(db => snapshot((db.livingWorld as { barber: Record<string, unknown> }).barber[orphan.id]))
  assert.equal((await current(f, orphan)).code, 'invalid_saved_barber', 'an unclaimed completed lesson cannot become an orphan')
  assert.deepEqual(await f.server.store.read(db => snapshot((db.livingWorld as { barber: Record<string, unknown> }).barber[orphan.id])), orphanBefore)
  assert.equal(orphanDone.status, 'complete')

  const basic = await start(f, player, 'basic')
  assert.ok(basic.session)
  const basicDone = await finishLesson(f, player, basic.session)
  const basicClaim = await post(f, '/claim', { cityId: 'lagos', lessonId: 'basic', sessionId: basicDone.sessionId, requestId: identifier(f) }, player)
  assert.ok(basicClaim.ok)
  await f.server.store.transact(db => {
    const owner = Object.values(db.sessions).find(item => item.publicId === player.id)
    assert.ok(owner?.cities.lagos)
    owner.cities.lagos.state.cash = 120
  })
  assert.equal((await post(f, '/upgrade', { cityId: 'lagos', requestId: identifier(f) }, player)).ok, true)
  const advanced = await start(f, player, 'advanced')
  assert.ok(advanced.session)
  const advancedDone = await finishLesson(f, player, advanced.session)
  assert.equal(advancedDone.status, 'complete')
  await f.server.store.transact(db => {
    const row = (db.livingWorld as { barber: Record<string, { starterTool: boolean; currentLesson: string | null; results: Record<string, unknown>; lessons: Record<string, { claimed: boolean }> }> }).barber[player.id]!
    row.starterTool = false; delete row.results.basic; row.lessons.basic!.claimed = false
  })
  const multipleBefore = await f.server.store.read(db => snapshot((db.livingWorld as { barber: Record<string, unknown> }).barber[player.id]))
  assert.equal((await current(f, player)).code, 'invalid_saved_barber', 'two unclaimed lessons cannot coexist even if each has genuine completed controls')
  assert.deepEqual(await f.server.store.read(db => snapshot((db.livingWorld as { barber: Record<string, unknown> }).barber[player.id])), multipleBefore,
    'the malformed multi-lesson row remains unchanged for recovery')
})

test('failed durable claim retries with the same request id; no paid row or wallet effect leaks', async t => {
  const disk = flakyDisk(), f = await setup(t, { disk }), player = await onboard(f, 'Durable')
  const begun = await start(f, player, 'basic')
  assert.ok(begun.session)
  const complete = await finishLesson(f, player, begun.session)
  const claimBody = { cityId: 'lagos', lessonId: 'basic', sessionId: complete.sessionId, requestId: identifier(f) }
  const beforeCash = await cash(f, player)
  const beforeRow = await f.server.store.read(db => snapshot((db.livingWorld as { barber: Record<string, unknown> }).barber[player.id]))
  disk.fail = 'ENOSPC'
  const failed = await f.request(PATH + '/claim', claimBody, player.cookie)
  assert.deepEqual([failed.status, (await failed.json() as { error: string }).error], [503, 'storage_unavailable'])
  disk.fail = null
  const afterFailure = await f.server.store.read(db => snapshot((db.livingWorld as { barber: Record<string, unknown> }).barber[player.id]))
  assert.deepEqual(afterFailure, beforeRow, 'failed durable commit rolls back both the terminal paid flag and once receipt')
  assert.equal(await cash(f, player), beforeCash)
  const recovered = await post(f, '/claim', claimBody, player)
  assert.deepEqual([recovered.ok, recovered.code, recovered.results[0]?.lessonId, recovered.duplicate ?? false], [true, 'lesson_claimed', 'basic', false])
  assert.equal(await cash(f, player), beforeCash + 80)
})
