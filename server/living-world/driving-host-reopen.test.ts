import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { createServer } from '../server.ts'
import type { AllworldServer } from '../server.ts'
import type { DrivingResponse } from '../../src/types/living-world.ts'

const LOOK = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }
const PATH = '/api/living-world/driving'
const id = (now: number) => `${now}:${randomUUID()}`

async function host(dataDir: string, options: Parameters<typeof createServer>[0], clock: { now: number }) {
  const server = await createServer({ dataDir, now: () => clock.now, log: () => {}, heartbeatMs: 60_000, ...options })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as AddressInfo
  const base = `http://127.0.0.1:${address.port}`
  const request = (path: string, body?: unknown, cookie?: string) => fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { server, request }
}

async function stop(server: AllworldServer): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  await server.store.close?.()
}

async function player(request: (path: string, body?: unknown, cookie?: string) => Promise<Response>, name: string, now: number) {
  const created = await request('/api/session', { name, onboarding: true })
  assert.equal(created.status, 200)
  const cookie = (created.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
  assert.ok(cookie)
  const confirmed = await request('/api/action', { actionId: id(now), cityId: 'lagos', type: 'onboarding.quick-start', payload: { look: LOOK } }, cookie)
  assert.equal((await confirmed.json() as { code: string }).code, 'playing')
  return cookie
}

async function record(dataDir: string, cookie: string, journeyId: string): Promise<Record<string, unknown>> {
  const db = JSON.parse(await readFile(join(dataDir, 'devices.json'), 'utf8')) as {
    sessions: Record<string, { publicId: string; once?: Record<string, unknown> }>
    livingWorld?: { driving?: Record<string, unknown> }
  }
  const secret = cookie.slice(cookie.indexOf('=') + 1)
  const session = db.sessions[secret]
  assert.ok(session)
  const rows = db.livingWorld?.driving
  assert.ok(rows)
  const saved = rows[session.publicId]
  assert.ok(saved)
  assert.equal((saved as { journeyId?: unknown }).journeyId, journeyId)
  return JSON.parse(JSON.stringify(saved)) as Record<string, unknown>
}

async function receipts(dataDir: string, cookie: string): Promise<Record<string, unknown>> {
  const db = JSON.parse(await readFile(join(dataDir, 'devices.json'), 'utf8')) as { sessions: Record<string, { once?: Record<string, unknown> }> }
  const secret = cookie.slice(cookie.indexOf('=') + 1)
  assert.ok(db.sessions[secret])
  return JSON.parse(JSON.stringify(db.sessions[secret]!.once ?? {})) as Record<string, unknown>
}

test('Node production routes require literal constructor authority and an OFF reopen can use and replay a saved v2 row', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'joinallworld-driving-node-reopen-'))
  let current: AllworldServer | null = null
  t.after(async () => { try { if (current) await stop(current) } finally { await rm(dataDir, { recursive: true, force: true }) } })
  const clock = { now: 100_000 }

  // Node environment values are deliberately not an issuance channel. Only the host constructor option is.
  let app = await host(dataDir, { env: { REVERSE_GEAR_ISSUANCE: '1' } }, clock)
  current = app.server
  const legacyCookie = await player(app.request, 'Node OFF', clock.now)
  const legacyStart = await (await app.request(PATH + '/start', { cityId: 'lagos', requestId: id(clock.now) }, legacyCookie)).json() as DrivingResponse
  assert.ok(legacyStart.ok && legacyStart.session)
  assert.equal(legacyStart.reverseGearControls, undefined)
  const offPacket = { cityId: 'lagos', journeyId: legacyStart.session!.journeyId, sequence: 1, frames: [{ throttle: 1, brake: 0, steer: 0, gear: 'reverse' }] }
  const refused = await (await app.request(PATH + '/input', offPacket, legacyCookie)).json() as DrivingResponse
  assert.deepEqual([refused.ok, refused.code, refused.session?.revision, refused.session?.nextSequence, refused.reverseGearControls], [false, 'reverse_gear_disabled', 1, 1, undefined])
  const untouchedV1 = await record(dataDir, legacyCookie, legacyStart.session!.journeyId)
  assert.equal(untouchedV1['v'], 1)
  assert.equal(Object.hasOwn(untouchedV1['state'] as object, 'gear'), false)

  await stop(current); current = null
  clock.now += 100
  app = await host(dataDir, { reverseGearIssuance: JSON.parse('"true"'), env: { REVERSE_GEAR_ISSUANCE: '1' } }, clock)
  current = app.server
  const nonBooleanCookie = await player(app.request, 'Node nonboolean', clock.now)
  const nonBooleanStart = await (await app.request(PATH + '/start', { cityId: 'lagos', requestId: id(clock.now) }, nonBooleanCookie)).json() as DrivingResponse
  assert.ok(nonBooleanStart.ok && nonBooleanStart.session)
  assert.equal(nonBooleanStart.reverseGearControls, undefined)
  const nonBooleanPacket = { cityId: 'lagos', journeyId: nonBooleanStart.session!.journeyId, sequence: 1, frames: [{ throttle: 1, brake: 0, steer: 0, gear: 'reverse' }] }
  const nonBooleanRefusal = await (await app.request(PATH + '/input', nonBooleanPacket, nonBooleanCookie)).json() as DrivingResponse
  assert.deepEqual([nonBooleanRefusal.code, nonBooleanRefusal.session?.revision, nonBooleanRefusal.session?.nextSequence, nonBooleanRefusal.reverseGearControls], ['reverse_gear_disabled', 1, 1, undefined])
  assert.equal((await record(dataDir, nonBooleanCookie, nonBooleanStart.session!.journeyId))['v'], 1, 'a truthy nonboolean constructor fixture and env value cannot issue v2')
  await stop(current); current = null
  clock.now += 100
  app = await host(dataDir, { reverseGearIssuance: true }, clock)
  current = app.server
  const reverseCookie = await player(app.request, 'Node reverse', clock.now)
  const started = await (await app.request(PATH + '/start', { cityId: 'lagos', requestId: id(clock.now) }, reverseCookie)).json() as DrivingResponse
  assert.ok(started.ok && started.session)
  assert.equal(started.reverseGearControls, true)
  clock.now += 250
  const packet = { cityId: 'lagos', journeyId: started.session!.journeyId, sequence: started.session!.nextSequence, frames: [{ throttle: 1, brake: 0, steer: 0, gear: 'reverse' }] }
  const accepted = await (await app.request(PATH + '/input', packet, reverseCookie)).json() as DrivingResponse
  assert.ok(accepted.ok && accepted.session)
  assert.equal(accepted.session!.state.gear, 'reverse')
  const issued = await record(dataDir, reverseCookie, accepted.session!.journeyId)
  assert.equal(issued['v'], 2)
  const packetReceipt = issued['lastPacket']
  assert.deepEqual(packetReceipt, { sequence: 1, fingerprint: JSON.stringify({ cityId: packet.cityId, journeyId: packet.journeyId, sequence: packet.sequence, frames: packet.frames }), code: 'controls_accepted' })
  const issuedReceipts = await receipts(dataDir, reverseCookie)
  await stop(current); current = null

  // Reopen the same actual devices.json through the production Node route registry with issuance OFF.
  clock.now += 2_000
  app = await host(dataDir, { reverseGearIssuance: false, env: { REVERSE_GEAR_ISSUANCE: '1' } }, clock)
  current = app.server
  assert.deepEqual(await record(dataDir, reverseCookie, accepted.session!.journeyId), issued, 'cold OFF reopen itself leaves the running v2 row unchanged')
  assert.deepEqual(await receipts(dataDir, reverseCookie), issuedReceipts, 'cold OFF reopen itself leaves the original packet receipt unchanged')
  const replay = await (await app.request(PATH + '/input', packet, reverseCookie)).json() as DrivingResponse
  assert.deepEqual([replay.ok, replay.code, replay.duplicate, replay.reverseGearControls], [true, 'controls_accepted', true, undefined])
  assert.deepEqual(await record(dataDir, reverseCookie, accepted.session!.journeyId), issued, 'the first cold OFF driving request replays the retained packet before timeout writes')
  assert.deepEqual(await receipts(dataDir, reverseCookie), issuedReceipts, 'the retained packet replay does not alter the original receipt')
  const offCurrent = await (await app.request(PATH + '?city=lagos', undefined, reverseCookie)).json() as DrivingResponse
  assert.ok(offCurrent.ok && offCurrent.session)
  assert.equal(offCurrent.session!.state.status, 'paused')
  assert.equal(offCurrent.reverseGearControls, undefined)
  const afterRead = await record(dataDir, reverseCookie, accepted.session!.journeyId)
  assert.equal(afterRead['v'], 2)
  assert.equal((afterRead['state'] as { gear?: string }).gear, 'forward')

  const resumeRequest = { cityId: 'lagos', journeyId: accepted.session!.journeyId, revision: offCurrent.session!.revision, requestId: id(clock.now) }
  const resumed = await (await app.request(PATH + '/resume', resumeRequest, reverseCookie)).json() as DrivingResponse
  assert.ok(resumed.ok && resumed.session?.state.status === 'running')
  assert.equal(resumed.reverseGearControls, undefined)
  const resumeRow = await record(dataDir, reverseCookie, resumed.session!.journeyId)
  const resumeReceipts = await receipts(dataDir, reverseCookie)
  const resumeRetry = await (await app.request(PATH + '/resume', resumeRequest, reverseCookie)).json() as DrivingResponse
  assert.deepEqual([resumeRetry.ok, resumeRetry.duplicate, resumeRetry.session?.revision], [true, true, resumed.session!.revision])
  assert.deepEqual(await record(dataDir, reverseCookie, resumed.session!.journeyId), resumeRow)
  assert.deepEqual(await receipts(dataDir, reverseCookie), resumeReceipts, 'a lifecycle duplicate reuses its single stored once receipt after OFF reopen')
  clock.now += 250
  const legacyPacket = { cityId: 'lagos', journeyId: resumed.session!.journeyId, sequence: resumed.session!.nextSequence, frames: [{ throttle: 1, brake: 0, steer: 0 }] }
  const legacyWrite = await (await app.request(PATH + '/input', legacyPacket, reverseCookie)).json() as DrivingResponse
  assert.ok(legacyWrite.ok && legacyWrite.session)
  assert.equal(legacyWrite.reverseGearControls, undefined)
  const stillV2 = await record(dataDir, reverseCookie, legacyWrite.session!.journeyId)
  assert.equal(stillV2['v'], 2, 'ordinary OFF legacy input must preserve, not downgrade, an existing v2 row')
  assert.equal(stillV2['nextSequence'], 3)
  const explicitOff = { cityId: 'lagos', journeyId: legacyWrite.session!.journeyId, sequence: 3, frames: [{ throttle: 0, brake: 0, steer: 0, gear: 'reverse' }] }
  const beforeRefusal = await record(dataDir, reverseCookie, legacyWrite.session!.journeyId)
  const refusal = await (await app.request(PATH + '/input', explicitOff, reverseCookie)).json() as DrivingResponse
  assert.deepEqual([refusal.code, refusal.session?.revision, refusal.session?.nextSequence, refusal.reverseGearControls], ['reverse_gear_disabled', legacyWrite.session!.revision, 3, undefined])
  assert.deepEqual(await record(dataDir, reverseCookie, legacyWrite.session!.journeyId), beforeRefusal)

  const beforeSecondReopen = await record(dataDir, reverseCookie, legacyWrite.session!.journeyId)
  const receiptsBeforeSecondReopen = await receipts(dataDir, reverseCookie)
  await stop(current); current = null
  app = await host(dataDir, { env: { REVERSE_GEAR_ISSUANCE: '1' } }, clock)
  current = app.server
  const lifecycleReplay = await (await app.request(PATH + '/resume', resumeRequest, reverseCookie)).json() as DrivingResponse
  assert.deepEqual([lifecycleReplay.ok, lifecycleReplay.duplicate, lifecycleReplay.reverseGearControls], [true, true, undefined], 'the exact previously accepted resume is the first driving request after a second OFF reopen')
  assert.deepEqual(await record(dataDir, reverseCookie, legacyWrite.session!.journeyId), beforeSecondReopen, 'cold OFF lifecycle replay does not mutate the current row')
  assert.deepEqual(await receipts(dataDir, reverseCookie), receiptsBeforeSecondReopen, 'cold OFF lifecycle replay does not add or rewrite once receipts')
})

test('an exhausted counter survives a Node file-store reopen: new packets and loads are refused and no row is rewritten', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'joinallworld-driving-node-exhausted-'))
  let current: AllworldServer | null = null
  t.after(async () => { try { if (current) await stop(current) } finally { await rm(dataDir, { recursive: true, force: true }) } })
  const clock = { now: 100_000 }
  const max = Number.MAX_SAFE_INTEGER
  let app = await host(dataDir, {}, clock)
  current = app.server
  const cookie = await player(app.request, 'Node exhausted', clock.now)
  const started = await (await app.request(PATH + '/start', { cityId: 'lagos', requestId: id(clock.now) }, cookie)).json() as DrivingResponse
  assert.ok(started.ok && started.session)
  const journeyId = started.session.journeyId
  clock.now += 250
  const packet = { cityId: 'lagos', journeyId, sequence: 1, frames: [{ throttle: 1, brake: 0, steer: 0 }] }
  assert.ok(((await (await app.request(PATH + '/input', packet, cookie)).json()) as DrivingResponse).ok)
  // Place the saved counters at the last safe values through the store's own transaction, then flush to disk.
  await app.server.store.transact(db => {
    const rows = (db.livingWorld as { driving: Record<string, Record<string, unknown>> }).driving
    const row = Object.values(rows).find(value => value['journeyId'] === journeyId)
    assert.ok(row)
    row['revision'] = max
    row['nextSequence'] = max
    row['lastPacket'] = { ...(row['lastPacket'] as object), sequence: max - 1 }
  })
  await stop(current); current = null
  const seeded = await record(dataDir, cookie, journeyId)
  const seededReceipts = await receipts(dataDir, cookie)
  assert.equal(seeded['revision'], max)

  for (const reopen of [1, 2]) {
    clock.now += 5_000
    app = await host(dataDir, {}, clock)
    current = app.server
    const refused = await (await app.request(PATH + '/input', { ...packet, sequence: max, frames: [{ throttle: 0, brake: 1, steer: 0 }] }, cookie)).json() as DrivingResponse
    assert.deepEqual([refused.ok, refused.code], [false, 'sequence_exhausted'], `reopen ${reopen}: a new packet is refused`)
    assert.deepEqual(await record(dataDir, cookie, journeyId), seeded, `reopen ${reopen}: the refusal wrote no driving row`)
    const read = await (await app.request(PATH + '?city=lagos', undefined, cookie)).json() as DrivingResponse
    assert.deepEqual([read.ok, read.code], [false, 'revision_exhausted'], `reopen ${reopen}: loading refuses instead of pausing`)
    assert.deepEqual(await record(dataDir, cookie, journeyId), seeded, `reopen ${reopen}: loading wrote no driving row`)
    assert.deepEqual(await receipts(dataDir, cookie), seededReceipts, `reopen ${reopen}: no receipt was added`)
    await stop(current); current = null
  }
})
