import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { linksFrom } from '../../src/game/cities/registry.ts'
import { driver, object } from './cityJourney.ts'
import type { JourneyDevice, JourneyHost } from './cityJourney.ts'

/**
 * The ride home on credit ('estate.relocate' with `credit`), played against a real host: Lagos to Ibadan by bus with the
 * start cash spent down to ₦1,500, so the way back is dearer than what is left. The same run is used on the Node server
 * (server/ride-credit.test.ts) and on the Worker (deploy/ride-credit.edge.test.ts).
 *
 * What it proves: the plain fare is refused for want of money; the ride on credit is taken once however it is sent (a repeat of
 * the same request, two devices at the same moment); it hands over no spending money; the trip cannot be skipped and no other
 * trip between cities starts while the debt stands; the debt is what the life says and the wallet's lines add up; paying it
 * from the wallet clears it; and the character can travel again afterwards.
 */
export type RideHost = Pick<JourneyHost, 'now' | 'request' | 'elapse'> & {
  /** Change the stored life, as spending down would (the host's own way of writing a stored life). */
  edit(device: JourneyDevice, city: string, change: (state: Record<string, unknown>) => void): Promise<void>
}
export interface RideResult { fare: number; debt: number; cash: number }

const number = (value: unknown): number => { assert.ok(typeof value === 'number' && Number.isFinite(value)); return value }

export async function rideJourney(host: RideHost): Promise<RideResult> {
  const { id, life, action, finish, conserved, start } = driver(host)
  async function attempt(device: JourneyDevice, city: string, type: string, payload: object, actionId = id()): Promise<Record<string, unknown>> {
    const response = await host.request('/api/action', { cityId: city, type, payload, actionId }, device.cookie)
    return { ...object(await response.json()), status: response.status }
  }
  const bus = (from: string, to: string) => { const link = linksFrom(from).find((item) => item.to === to && item.mode === 'road'); assert.ok(link); return link }
  const ada = await start(`Sade${randomUUID().slice(0, 4)}`, 'lagos', 'ikeja')
  const out = bus('lagos', 'ibadan'), back = bus('ibadan', 'lagos')
  const LEFT = 1500
  assert.ok(back.fare > LEFT, 'the way back costs more than what is left')

  // ---- a visitor with less than the fare ---------------------------------------------------------------------------------------
  await action(ada, 'lagos', 'estate.relocate', { to: 'ibadan', mode: 'road' })
  await finish(ada, 'lagos', await life(ada, 'lagos'))
  // The rest is spent in Ibadan.
  await host.edit(ada, 'ibadan', (state) => { state.cash = LEFT })
  const visiting = await life(ada, 'ibadan')
  assert.deepEqual([object(visiting.estate).city, number(visiting.cash)], ['ibadan', LEFT])
  assert.ok(out.fare > 0)
  const plain = await attempt(ada, 'ibadan', 'estate.relocate', { to: 'lagos', mode: 'road' })
  assert.deepEqual([plain.ok, plain.code], [false, 'insufficient_funds'])
  // Not to a place that is not the home, and not by a way that is not the cheapest.
  assert.equal((await attempt(ada, 'ibadan', 'estate.relocate', { to: 'abeokuta', mode: 'road', credit: true })).code, 'credit_not_offered')

  // ---- the ride on credit: once, however it is sent ------------------------------------------------------------------------------
  const first = id()
  const taken = await attempt(ada, 'ibadan', 'estate.relocate', { to: 'lagos', mode: 'road', credit: true }, first)
  assert.deepEqual([taken.status, taken.ok, taken.code], [200, true, 'departed'], JSON.stringify({ code: taken.code, reason: taken.reason }))
  const travelling = object(taken.state)
  assert.deepEqual([number(travelling.cash), number(object(travelling.travel).rideDebt), object(travelling.activeAction).kind], [visiting.cash, back.fare, 'intercity'], 'no spending money is handed over; the fare is owed')
  // The same request again (a retry) and a second device pressing the button at the same moment: nothing more is owed.
  const repeat = await attempt(ada, 'ibadan', 'estate.relocate', { to: 'lagos', mode: 'road', credit: true }, first)
  assert.equal(repeat.duplicate, true)
  const pressed = await Promise.all([attempt(ada, 'ibadan', 'estate.relocate', { to: 'lagos', mode: 'road', credit: true }), attempt(ada, 'ibadan', 'estate.relocate', { to: 'lagos', mode: 'road', credit: true })])
  assert.ok(pressed.every((answer) => answer.ok === false || answer.error === 'city_moved' || answer.status === 409), JSON.stringify(pressed.map((answer) => [answer.status, answer.code, answer.error])))
  const mid = await life(ada, 'ibadan')
  assert.deepEqual([number(mid.cash), number(object(mid.travel).rideDebt)], [visiting.cash, back.fare], 'one debt, one fare')
  // No skip, free or paid, on a ride on credit.
  const skip = await attempt(ada, 'ibadan', 'travel.skip', {})
  assert.deepEqual([skip.ok, skip.code, object(object(skip.state).travel).skipped], [false, 'ride_debt', false])

  // ---- home, owing ----------------------------------------------------------------------------------------------------------------
  const home = await finish(ada, 'ibadan', mid)
  assert.deepEqual([object(home.estate).city, number(home.cash), number(object(home.travel).rideDebt)], ['lagos', visiting.cash, back.fare])
  conserved(home)
  const refused = await attempt(ada, 'lagos', 'estate.relocate', { to: 'ibadan', mode: 'road' })
  assert.deepEqual([refused.ok, refused.code], [false, 'ride_debt'])
  assert.match(String(refused.reason), /You owe ₦3,500 for your ride home/)

  // ---- paying it ---------------------------------------------------------------------------------------------------------------------
  const part = await attempt(ada, 'lagos', 'travel.repay-ride', {})
  assert.deepEqual([part.ok, part.code], [true, 'repaid'])
  const owing = object(part.state)
  assert.deepEqual([number(owing.cash), number(object(owing.travel).rideDebt)], [0, back.fare - number(visiting.cash)], 'the wallet paid what it held')
  const none = await attempt(ada, 'lagos', 'travel.repay-ride', {})
  assert.deepEqual([none.ok, none.code], [false, 'no_cash'])
  conserved(owing)
  const lines = (owing.ledger as unknown[]).map(object).map((line) => String(line.reason))
  assert.ok(lines.some((reason) => reason.startsWith('Ride home on credit')) && lines.includes('Ride home repaid'))
  // ---- a life that can comfortably afford the rest has it cleared at its next settlement, once, and the way is open ----------------------------------
  const remaining = number(object(owing.travel).rideDebt)
  await host.edit(ada, 'lagos', (state) => { state.cash = remaining + 5000 })
  await host.elapse(ada, 'lagos', 60000)
  const settled = await life(ada, 'lagos')
  assert.deepEqual([number(settled.cash), 'rideDebt' in object(settled.travel)], [5000, false], 'the whole debt came out of cash')
  assert.equal((settled.ledger as unknown[]).map(object).filter((line) => line.reason === 'Ride home repaid' && line.amount === -remaining).length, 1, 'as one ledger line')
  const again = await life(ada, 'lagos')
  assert.deepEqual([number(again.cash), 'rideDebt' in object(again.travel)], [5000, false], 'and not taken again')
  return { fare: back.fare, debt: number(object(owing.travel).rideDebt), cash: number(owing.cash) }
}
