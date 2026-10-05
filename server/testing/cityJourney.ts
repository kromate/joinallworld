import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DEFAULT_LOOK } from '../../src/game/content/traits.ts'
import { FICTIONAL_CITY_ID as CITY, FICTIONAL_NEIGHBOUR_CITY_ID as OTHER } from '../../src/game/cities/testing/fictionalCity.test-fixture.ts'

export const JOURNEY_TIME = Date.parse('2026-10-05T10:00:00Z')
export interface JourneyDevice { id: string; cookie: string }
export interface JourneySocket { send(value: object): void; next(): Promise<unknown> }
export interface JourneyHost {
  now(): number
  request(path: string, body?: object, cookie?: string): Promise<{ status: number; headers: Pick<Headers, 'get'>; json(): Promise<unknown> }>
  elapse(device: JourneyDevice, city: string, ms: number): Promise<void>
  qualify(device: JourneyDevice, city: string): Promise<void>
  socket(device: JourneyDevice): Promise<JourneySocket>
  session(device: JourneyDevice): Promise<unknown>
  seedLegacy(device: JourneyDevice): Promise<void>
  restart(): Promise<void>
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
export function object(value: unknown): Record<string, unknown> {
  assert.ok(isRecord(value), 'expected an object')
  return value
}
function text(value: unknown): string { assert.equal(typeof value, 'string'); return String(value) }
function number(value: unknown): number { assert.ok(typeof value === 'number' && Number.isFinite(value)); return value }
function list(value: unknown): unknown[] { assert.ok(Array.isArray(value)); return value }
const problem = (answer: Record<string, unknown>): string => JSON.stringify({ error: answer.error, code: answer.code, reason: answer.reason })

/** The stored eligibility history is fixture setup; nomination, payment and isolation use real routes. */
export function qualifyState(value: unknown): void {
  const state = object(value), civic = object(state.civic), work = object(civic.work)
  civic.since = JOURNEY_TIME - 4 * 86400000
  work.days = 2
  if (typeof work.last !== 'number') work.last = Math.floor((JOURNEY_TIME - 86400000) / 86400000) // a stored count of days needs its last day
}

/** What a scripted run needs of a host: read a life, send one action, let a timed action finish, start a new life in a city. */
export function driver(host: JourneyHost) {
  const id = (): string => `${host.now()}:${randomUUID()}`
  async function read(path: string, cookie?: string): Promise<Record<string, unknown>> {
    const response = await host.request(path, undefined, cookie)
    const answer = object(await response.json())
    assert.equal(response.status, 200, `${path}: ${problem(answer)}`)
    return answer
  }
  async function life(device: JourneyDevice, city: string): Promise<Record<string, unknown>> {
    return object((await read(`/api/life?city=${city}`, device.cookie)).state)
  }
  async function action(device: JourneyDevice, city: string, type: string, payload: object = {}, actionId = id()): Promise<Record<string, unknown>> {
    const response = await host.request('/api/action', { cityId: city, type, payload, actionId }, device.cookie)
    const answer = object(await response.json())
    assert.equal(response.status, 200, `${type}: ${problem(answer)}`)
    assert.equal(answer.ok, true, `${type}: ${problem(answer)}`)
    return answer
  }
  async function finish(device: JourneyDevice, city: string, state: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (state.activeAction) await host.elapse(device, city, number(object(state.activeAction).remaining) * 1000 + 100)
    return life(device, city)
  }
  function conserved(state: Record<string, unknown>): void {
    const sum = list(state.ledger).reduce<number>((total, entry) => total + number(object(entry).amount), 0)
    assert.equal(state.cash, 5000 + sum, 'cash equals the original seed plus the complete ledger')
  }
  async function start(name: string, city: string, lga: string): Promise<JourneyDevice> {
    const response = await host.request('/api/session', { name, onboarding: true })
    const answer = object(await response.json())
    assert.equal(response.status, 200)
    const cookie = response.headers.get('set-cookie')?.split(';')[0]
    assert.ok(cookie)
    const device = { id: text(object(answer.session).id), cookie }
    assert.equal(object((await life(device, city)).estate).city, city)
    await action(device, city, 'onboarding.quick-start', { look: DEFAULT_LOOK })
    await action(device, city, 'onboarding.traits', { traits: ['musical', 'tech-bro-or-sis'] })
    await action(device, city, 'onboarding.dream', { dream: 'yaba-unicorn' })
    await action(device, city, 'onboarding.lottery')
    const settled = object((await action(device, city, 'onboarding.home', { lga, via: 'manual' })).state)
    assert.deepEqual([object(settled.estate).lga, object(settled.estate).living, object(settled.estate).tier], [lga, 'own', 'starter'])
    assert.equal(object(settled.economy).rent && object(object(settled.economy).rent).house, null)
    conserved(settled)
    return device
  }
  return { id, read, life, action, finish, conserved, start }
}

export async function cityJourney(host: JourneyHost): Promise<JourneyDevice> {
  const { id, read, life, action, finish, conserved, start } = driver(host)
  async function square(device: JourneyDevice, city: string): Promise<Record<string, unknown>> {
    const current = await life(device, city)
    if (current.location === 'test-square') return current
    const arrived = await finish(device, city, object((await action(device, city, 'travel', { id: 'test-square', mode: 'trek' })).state))
    assert.equal(arrived.location, 'test-square', 'the city venue survives arrival and settlement')
    return arrived
  }
  const first = await start('Amina', CITY, 'test-central')
  const second = await start('Bayo', CITY, 'test-central')
  const neighbour = await start('Chidi', OTHER, 'test-neighbour-central')
  for (const [device, city] of [[first, CITY], [second, CITY], [neighbour, OTHER]] as const) await square(device, city)

  await action(first, CITY, 'apply-job', { id: 'community-helper' })
  await action(first, CITY, 'spot', { id: 'work' })
  const before = await life(first, CITY), workId = id()
  const started = await action(first, CITY, 'activity', { id: 'test-help-shift' }, workId)
  const duplicate = await action(first, CITY, 'activity', { id: 'test-help-shift' }, workId)
  assert.equal(duplicate.duplicate, true)
  const paid = await finish(first, CITY, object(started.state))
  assert.equal(number(paid.cash) - number(before.cash), 100, 'the local workplace pays its own city rate exactly once')
  assert.equal(object(paid.career).city, CITY)
  conserved(paid)

  const peerA = await host.socket(first), peerB = await host.socket(second), peerOther = await host.socket(neighbour)
  async function presence(peer: JourneySocket, expected: string[]): Promise<void> {
    for (let attempts = 0; attempts < 12; attempts += 1) {
      const frame = object(await peer.next())
      assert.notEqual(frame.type, 'error', JSON.stringify(frame))
      if (frame.type !== 'presence') continue
      const members = list(frame.members).map(member => text(object(member).id)).sort()
      if (members.length === expected.length) { assert.deepEqual(members, [...expected].sort()); return }
    }
    assert.fail('expected city-scoped presence did not arrive')
  }
  peerA.send({ type: 'join', cityId: CITY, venueId: 'test-square' })
  await presence(peerA, [first.id])
  peerB.send({ type: 'join', cityId: CITY, venueId: 'test-square' })
  await presence(peerB, [first.id, second.id])
  await presence(peerA, [first.id, second.id])
  peerOther.send({ type: 'join', cityId: OTHER, venueId: 'test-square' })
  await presence(peerOther, [neighbour.id])

  await host.qualify(first, CITY)
  const eligible = await life(first, CITY)
  const nomination = { cityId: CITY, slogan: 'A place for everyone', requestId: id() }
  const nominatedResponse = await host.request('/api/civic/gov/run', nomination, first.cookie)
  const nominated = object(await nominatedResponse.json())
  assert.equal(nominatedResponse.status, 200, problem(nominated))
  assert.equal(nominated.ok, true, problem(nominated))
  assert.equal(number(object(nominated.state).cash), number(eligible.cash) - 2000)
  const repeated = object(await (await host.request('/api/civic/gov/run', nomination, first.cookie)).json())
  assert.equal(object(repeated.state).cash, object(nominated.state).cash, 'a repeated nomination pays no second fee')
  const ownElection = object((await read(`/api/civic/gov?city=${CITY}`)).election)
  const otherElection = object((await read(`/api/civic/gov?city=${OTHER}`)).election)
  assert.deepEqual(list(ownElection.candidates).map(candidate => object(candidate).id), [first.id])
  assert.deepEqual(list(otherElection.candidates), [])

  const home = object((await life(first, CITY)).estate)
  const traveller = await life(first, CITY)
  const departed = object((await action(first, CITY, 'estate.relocate', { to: OTHER, mode: 'road' })).state)
  assert.equal(number(departed.cash), number(traveller.cash) - 10)
  await host.elapse(first, CITY, 1100)
  const arrivalResponse = await host.request(`/api/life?city=${CITY}`, undefined, first.cookie)
  assert.equal(arrivalResponse.status, 200)
  const arrived = object(object(await arrivalResponse.json()).state)
  assert.equal(object(arrived.estate).city, OTHER)
  assert.equal(arrived.location, 'test-square', 'a first-time visitor arrives in a public place')
  assert.equal(object(arrived.estate).lga, null, 'the visitor chooses a local government')
  assert.equal(arrived.cash, departed.cash)
  assert.deepEqual(arrived.skills, departed.skills)
  assert.deepEqual(arrived.social, departed.social)
  assert.equal(object(arrived.career).city, CITY, 'the old job stays tied to its city')
  assert.equal(object(object(object(arrived.estate).away)[CITY]).lga, home.lga)
  conserved(arrived)
  const moved = await host.request(`/api/life?city=${CITY}`, undefined, first.cookie)
  assert.equal(moved.status, 409)
  const movedBody = object(await moved.json())
  assert.equal(movedBody.error, 'city_moved')
  assert.equal(movedBody.city, OTHER)
  assert.deepEqual(Object.keys(object(object(await host.session(first)).cities)), [OTHER])

  const visitor = await read(`/api/world/me?city=${OTHER}`, first.cookie)
  assert.equal(visitor.placed, false, 'arrival does not allocate a home before the visitor chooses')
  const chosen = object((await action(first, OTHER, 'estate.set-lga', { lga: 'test-neighbour-central', via: 'manual' })).state)
  assert.equal(chosen.cash, arrived.cash, 'the first local-government choice and starter home are free')
  const resident = await read(`/api/world/me?city=${OTHER}`, first.cookie)
  assert.equal(resident.placed, true)
  assert.equal(resident.lga, 'test-neighbour-central')

  const returning = object((await action(first, OTHER, 'estate.relocate', { to: CITY, mode: 'road' })).state)
  assert.equal(number(returning.cash), number(arrived.cash) - 10)
  await host.elapse(first, OTHER, 1100)
  const returned = object((await read(`/api/life?city=${OTHER}`, first.cookie)).state)
  assert.equal(object(returned.estate).city, CITY)
  assert.deepEqual([object(returned.estate).lga, object(returned.estate).tier, object(returned.estate).living], [home.lga, home.tier, home.living])
  assert.equal(object(object(object(returned.estate).away)[OTHER]).lga, 'test-neighbour-central', 'the newly chosen home is also kept for a later visit')
  assert.deepEqual(Object.keys(object(object(await host.session(first)).cities)), [CITY])
  conserved(returned)
  conserved(await life(second, CITY))
  conserved(await life(neighbour, OTHER))
  return first
}

const OLD_NEEDS = { hunger: 71, energy: 68, fun: 59, social: 63, hygiene: 75, bladder: 82 }
const OLD_SALT = 'old-ibadan-salt-1234567890abcdef'

export function seedLegacyRecords(value: unknown, now: number): void {
  const session = object(value)
  const entry = {
    state: { v: 1, t: now, cash: 12345, job: 'tech', needs: { ...OLD_NEEDS }, skills: { coding: 80 }, property: { house: 'yaba' } },
    updatedAt: now, salt: OLD_SALT,
  }
  object(session.cities).ibadan = entry
  session.legacyLives = { ...object(session.legacyLives ?? {}), 'ibadan:1': { ...structuredClone(entry), state: { ...entry.state, cash: 7 } } }
}

export async function legacyJourney(host: JourneyHost, device: JourneyDevice): Promise<void> {
  const before = structuredClone(object(object(await host.session(device)).cities)[CITY])
  assert.ok(before)
  await host.seedLegacy(device)
  const listed = object(await (await host.request('/api/characters', undefined, device.cookie)).json())
  const older = list(listed.legacy).map(object).find(entry => entry.cash === 12345)
  assert.ok(older)
  assert.equal(older.city, 'ibadan')
  assert.notEqual(older.id, 'ibadan:1', 'normalization must not overwrite an older archive id')
  const request = { id: text(older.id), clientId: `${host.now()}:${randomUUID()}` }
  const switchOnce = async (): Promise<void> => {
    const response = await host.request('/api/characters/switch', request, device.cookie)
    const result = object(await response.json())
    assert.equal(response.status, 200, problem(result))
    assert.equal(result.ok, true, problem(result))
    assert.equal(result.city, 'ibadan')
  }
  const check = async (): Promise<void> => {
    const session = object(await host.session(device))
    assert.deepEqual(Object.keys(object(session.cities)), ['ibadan'])
    const entry = object(object(session.cities).ibadan), state = object(entry.state)
    assert.equal(entry.salt, OLD_SALT)
    assert.equal(state.cash, 12345)
    assert.equal(state.job, 'tech')
    assert.deepEqual(state.needs, OLD_NEEDS)
    const archive = object(session.legacyLives)
    assert.deepEqual(archive[request.id], before, 'the previous character, home and salt stay intact in the exchanged slot')
    assert.equal(object(object(archive['ibadan:1']).state).cash, 7)
  }
  await switchOnce()
  await switchOnce()
  await check()
  await host.restart()
  await switchOnce()
  await check()
  const restored = await host.request('/api/life?city=ibadan', undefined, device.cookie)
  const answer = object(await restored.json())
  assert.equal(restored.status, 200, problem(answer))
  const state = object(answer.state)
  assert.equal(object(state.estate).city, 'ibadan')
  assert.equal(state.cash, 12345)
  assert.equal(state.job, 'tech')
  assert.deepEqual(state.needs, OLD_NEEDS)
}
