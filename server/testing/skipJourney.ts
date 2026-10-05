import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { tripSkipFee } from '../../src/game/content/travel.ts'
import { linksFrom } from '../../src/game/cities/registry.ts'
import { driver, object } from './cityJourney.ts'
import type { JourneyDevice, JourneyHost } from './cityJourney.ts'

/**
 * Skipping a trip between cities ('travel.skip'), played against a real host: Lagos to Ibadan by bus and back, both legs
 * skipped. The same run is used on the Node server (server/trip-skip.test.ts), on the Worker (deploy/trip-skip.edge.test.ts)
 * and by `npm run two-cities`.
 *
 * What it proves: a skip is refused with nothing charged when there is no trip or the price shown is too low; the first
 * skip is free and the next is charged exactly the price shown, once — a repeated request and two devices pressing at
 * the same moment both end in one charge; the arrival is filed under the new city in the same request; the character's
 * other device is told; and a friend who is watching sees the journey end in an arrival instead of running on.
 */
export interface SkipSocket { send(value: object): void; frames: Record<string, unknown>[] }
export interface SkipHost extends Pick<JourneyHost, 'now' | 'request' | 'elapse'> {
  /** An open socket of the device with every frame it is sent. A host without sockets (a script) leaves it out. */
  socket?(device: JourneyDevice): Promise<SkipSocket>
}
export interface SkipResult { fare: number; free: number; charged: number; cash: number }

const number = (value: unknown): number => { assert.ok(typeof value === 'number' && Number.isFinite(value)); return value }
const pause = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })
async function until<T>(read: () => T | undefined | null | false, what: string): Promise<T> {
  for (let i = 0; i < 200; i++) { const value = read(); if (value) return value; await pause(25) }
  throw new Error(`Never happened: ${what}`)
}

export async function skipJourney(host: SkipHost, { log = () => {} }: { log?: (title: string, state: Record<string, unknown>, note: string) => void } = {}): Promise<SkipResult> {
  const { id, life, action, conserved, start } = driver(host)
  /** One request to POST /api/action, whatever its answer (`status` is the HTTP status). */
  async function attempt(device: JourneyDevice, city: string, payload: object, actionId = id()): Promise<Record<string, unknown>> {
    const response = await host.request('/api/action', { cityId: city, type: 'travel.skip', payload, actionId }, device.cookie)
    return { ...object(await response.json()), status: response.status }
  }
  const bus = (from: string, to: string) => { const link = linksFrom(from).find((item) => item.to === to && item.mode === 'road'); assert.ok(link); return link }
  const ada = await start(`Sade${randomUUID().slice(0, 4)}`, 'lagos', 'ikeja')

  // A friend who watches, and a second device of the traveller: both with an open socket.
  const kunle = host.socket ? await start(`Kunle${randomUUID().slice(0, 4)}`, 'lagos', 'ikeja') : null
  let watching: SkipSocket | null = null, other: SkipSocket | null = null
  /** The latest place the friend's socket was told for the traveller. */
  const spot = (): Record<string, unknown> | undefined => (watching?.frames ?? []).flatMap((frame) => (frame.type === 'live-snapshot' ? frame.friends : frame.type === 'live-move' ? frame.spots ?? [] : []) as unknown[])
    .map(object).filter((item) => item.id === ada.id).at(-1)
  if (kunle && host.socket) {
    for (const who of [ada, kunle]) assert.equal((await host.request('/api/social/me', undefined, who.cookie)).status, 200)
    assert.equal(object(await (await host.request('/api/social/friends/request', { to: kunle.id, cityId: 'lagos' }, ada.cookie)).json()).code, 'requested')
    assert.equal(object(await (await host.request('/api/social/friends/answer', { from: ada.id, accept: true, cityId: 'lagos' }, kunle.cookie)).json()).code, 'accepted')
    await host.socket(ada)
    other = await host.socket(ada)
    watching = await host.socket(kunle)
    watching.send({ type: 'live-watch', cityId: 'lagos' })
    await until(() => spot()?.status === 'online' && spot()?.venue === 'home', 'the friend sees the traveller at home in Lagos')
  }

  // ---- nothing to skip ----------------------------------------------------------------------------------------------------
  const home = await life(ada, 'lagos')
  const idle = await attempt(ada, 'lagos', {})
  assert.deepEqual([idle.status, idle.ok, idle.code, object(idle.state).cash], [200, false, 'not_travelling', home.cash])

  // ---- Lagos to Ibadan by bus: the first skip is free -------------------------------------------------------------------------
  const out = bus('lagos', 'ibadan')
  const departed = object((await action(ada, 'lagos', 'estate.relocate', { to: 'ibadan', mode: 'road' })).state)
  assert.equal(number(departed.cash), number(home.cash) - out.fare, 'the fare is charged once, at departure')
  log('Bus to Ibadan departs', departed, `fare −₦${out.fare.toLocaleString('en-NG')}`)
  if (watching) await until(() => object(spot()?.journey ?? {}).to === 'ibadan', 'the friend sees the journey to Ibadan')
  await host.elapse(ada, 'lagos', 40000)
  const midway = await life(ada, 'lagos')
  assert.equal(number(object(midway.activeAction).remaining), out.seconds - 40)
  assert.equal(object(midway.travel).skipped, false)
  const freeId = id()
  const free = await attempt(ada, 'lagos', { quote: 0 }, freeId)
  const arrived = object(free.state)
  assert.deepEqual([free.status, free.ok, free.code], [200, true, 'skipped'], JSON.stringify({ code: free.code, error: free.error, reason: free.reason }))
  assert.deepEqual([object(arrived.estate).city, arrived.activeAction, number(arrived.cash), object(arrived.travel).skipped], ['ibadan', null, number(departed.cash), true], 'arrived at once; the first skip between cities is free')
  assert.equal(typeof free.rev, 'number', 'the answer carries the revision, as every action does')
  log('Skips the rest of the trip: in Ibadan at once', arrived, 'the first skip between cities is free')
  // The same request again (a retry on a bad connection) runs nothing: the character has left Lagos, and the answer says where it is.
  const repeat = await attempt(ada, 'lagos', { quote: 0 }, freeId)
  assert.deepEqual([repeat.status, repeat.error, repeat.city], [409, 'city_moved', 'ibadan'])
  // The life is filed under Ibadan by the skip itself: Ibadan answers, and Lagos says where the character went.
  const inIbadan = await life(ada, 'ibadan')
  assert.deepEqual([object(inIbadan.estate).city, inIbadan.location, inIbadan.cash], ['ibadan', arrived.location, arrived.cash])
  const gone = await host.request('/api/life?city=lagos', undefined, ada.cookie)
  assert.deepEqual([gone.status, object(await gone.json()).city], [409, 'ibadan'])
  if (watching && other) {
    const seen = await until(() => (spot()?.cityId === 'ibadan' && spot()?.venue ? spot() : null), 'the friend sees the arrival in Ibadan')
    assert.deepEqual([seen.venue, seen.journey, seen.trip], [arrived.location, undefined, undefined], 'the pin has arrived: no journey is left running')
    const frames = other.frames
    await until(() => frames.some((frame) => frame.type === 'life-changed' && Array.isArray(frame.by) && frame.by.includes(freeId)), 'the other device is told the life changed, and by which action')
  }

  // ---- back by bus: the price on the button is the price charged, once -----------------------------------------------------
  const back = bus('ibadan', 'lagos')
  const left = object((await action(ada, 'ibadan', 'estate.relocate', { to: 'lagos', mode: 'road' })).state)
  await host.elapse(ada, 'ibadan', 30000)
  const fee = tripSkipFee('intercity', back.seconds - 30, back.fare)
  assert.ok(fee > 0 && fee <= back.fare / 2)
  // A price lower than the server's is refused, and a refusal is remembered like any answer.
  const lowId = id()
  const low = await attempt(ada, 'ibadan', { quote: fee - 50 }, lowId)
  assert.deepEqual([low.ok, low.code, object(low.state).cash], [false, 'price_changed', left.cash])
  assert.match(String(low.reason), /Nothing was charged/)
  assert.deepEqual([(await attempt(ada, 'ibadan', { quote: fee - 50 }, lowId)).duplicate, (await life(ada, 'ibadan')).cash], [true, left.cash])
  assert.equal(low.status, 200)
  // Two devices press Skip at the same moment, each with its own request: one arrives and pays; the other runs nothing and is told
  // the character is in Lagos now (a device follows it there).
  const pressed = await Promise.all([attempt(ada, 'ibadan', { quote: fee }), attempt(ada, 'ibadan', { quote: fee })])
  assert.deepEqual(pressed.map((answer) => [answer.status, answer.code ?? answer.error, answer.city]).sort(), [[200, 'skipped', undefined], [409, 'city_moved', 'lagos']])
  const after = await life(ada, 'lagos')
  assert.deepEqual([object(after.estate).city, after.location, after.activeAction, number(after.cash)], ['lagos', 'home', null, number(left.cash) - fee], 'charged once, exactly the price shown')
  const lines = (after.ledger as unknown[]).map(object)
  assert.deepEqual(lines.filter((line) => String(line.reason).startsWith('Trip skipped')).map((line) => [line.amount, line.reason]), [[-fee, 'Trip skipped (Ibadan → Lagos)']])
  conserved(after)
  log('Bus back to Lagos, skipped with 90 s to go', after, `fare −₦${back.fare.toLocaleString('en-NG')}, skip −₦${fee.toLocaleString('en-NG')}, charged once`)
  if (watching) {
    const seen = await until(() => (spot()?.cityId === 'lagos' && spot()?.venue === 'home' ? spot() : null), 'the friend sees the traveller home again')
    assert.equal(seen.journey, undefined)
  }
  return { fare: out.fare, free: 0, charged: fee, cash: number(after.cash) }
}
