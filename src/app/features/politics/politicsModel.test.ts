import assert from 'node:assert/strict'
import test from 'node:test'
import type { GovResponse } from '../../../types/civic.ts'
import type { PoliticsResponse } from '../../../types/politics.ts'
import { ballotKey, ballotPath, leverRange, leverText, leverWhy, officeLine, partyMottoWhy, partyNameWhy, quorumLine, seatOf } from './politicsModel.ts'

const lever = { id: 'salesTax' as const, label: 'Sales tax', about: '', min: 0, max: 10, base: 0, unit: '%' as const, value: 4 }

test('the city ballot shares the Governor app’s cache entry; a state or national one has its own', () => {
  assert.equal(ballotKey('lagos', 'city'), 'gov:lagos')
  assert.equal(ballotPath('lagos', 'city'), '/api/civic/gov?city=lagos')
  assert.equal(ballotKey('lagos', 'state'), 'gov:lagos:state')
  assert.equal(ballotPath('lagos', 'nation'), '/api/civic/gov?city=lagos&tier=nation')
})

test('a lever is shown with its unit and range, and a bad value says why', () => {
  assert.equal(leverText(lever, 4), '4%'); assert.equal(leverRange(lever), '0–10%')
  assert.equal(leverWhy(lever, 5), '')
  for (const value of [11, -1, 2.5, '5', undefined, NaN]) assert.notEqual(leverWhy(lever, value), '', String(value))
  assert.equal(leverWhy(lever, 11), 'Sales tax can be 0–10%.')
})

test('the seat sentence names the holder and the party, or says the seat is empty', () => {
  const seat = { title: 'Governor', name: 'Lagos State' }
  const held = { governor: { id: 'a', name: 'Ada', slogan: '', votes: 12, week: 1, termStartedAt: 0, termEndsAt: 1 } } satisfies Pick<GovResponse, 'governor'>
  assert.equal(officeLine(seat, held, 'Green Hands'), 'Ada is Governor of Lagos State · Green Hands')
  assert.equal(officeLine(seat, held, null), 'Ada is Governor of Lagos State')
  assert.match(officeLine(seat, { governor: null }, null), /nobody holds the seat/)
  assert.equal(officeLine(seat, null, null), '')
  assert.match(quorumLine({ quorum: 10 }), /at least 10 votes/)
})

test('a seat is found by its tier', () => {
  const data = { seats: [{ tier: 'city' }, { tier: 'nation' }] } as unknown as PoliticsResponse
  assert.equal(seatOf(data, 'nation')?.tier, 'nation'); assert.equal(seatOf(data, 'state'), null); assert.equal(seatOf(null, 'city'), null)
})

test('a party needs a name and a motto of the right length', () => {
  assert.notEqual(partyNameWhy('ab'), ''); assert.equal(partyNameWhy('Green Hands'), '')
  assert.notEqual(partyMottoWhy('  '), ''); assert.equal(partyMottoWhy('Plant more'), '')
})

import type { JusticeResponse } from '../../../types/politics.ts'
import { arrestWhy, enrolSeats, fightWhy, jailLine, offenceLine, officerOf, timeLeft } from './politicsModel.ts'

test('a sentence is told in minutes, then hours', () => {
  assert.equal(timeLeft(10 * 60000, 0), '10 minutes'); assert.equal(timeLeft(60000, 0), '1 minute'); assert.equal(timeLeft(95 * 60000, 0), '1 h 35 min'); assert.equal(timeLeft(5, 0), '1 minute')
  const jail = { until: 30 * 60000, minutes: 30, by: { id: 'c', name: 'Chi' } }
  assert.match(jailLine(jail, 0), /in jail for 30 minutes more, arrested by Chi\. You cannot travel or work, but you can message and call people\./)
})

test('the Fight button says why it is off: offline, in jail, or in another place', () => {
  const you = (jail: NonNullable<JusticeResponse['you']>['jail']): JusticeResponse['you'] => ({ jail, police: null, wanted: [] })
  assert.equal(fightWhy('No internet.', you(null), true, 0), 'No internet.')
  assert.equal(fightWhy(null, null, true, 0), 'Connect to fight.')
  assert.match(fightWhy(null, you({ until: 600000, minutes: 10, by: { id: 'c', name: 'Chi' } }), true, 0), /in jail for 10 minutes/)
  assert.match(fightWhy(null, you(null), false, 0), /same place/)
  assert.equal(fightWhy(null, you(null), true, 0), '')
})

test('an officer is told when the offender is not here, and the officeholder sees the seats they can enrol for', () => {
  const offence = { by: { id: 'a', name: 'Ada' }, against: { id: 'b', name: 'Bola' }, venue: 'the park' }
  assert.match(arrestWhy(null, { ...offence, here: false }), /Ada is not here with you/)
  assert.equal(arrestWhy(null, { ...offence, here: true }), ''); assert.equal(arrestWhy('Offline.', { ...offence, here: true }), 'Offline.')
  assert.equal(offenceLine(offence), 'Ada attacked Bola at the park')
  const seats = [{ canEnrol: false, officers: [] }, { canEnrol: true, officers: [{ id: 'x', name: 'X' }] }] as unknown as JusticeResponse['seats']
  assert.equal(enrolSeats({ seats }).length, 1); assert.equal(enrolSeats(null).length, 0)
  assert.equal(officerOf(seats[1]!, 'x'), true); assert.equal(officerOf(seats[1]!, 'y'), false)
})

import { VERDICTS, canEscalate, courtName, higherCourt, noteWhy, rulingLine, statementWhy } from './politicsModel.ts'

test('bail and sentences are shown with their own units', () => {
  assert.equal(leverText({ unit: '₦' }, 3000), '₦3,000'); assert.equal(leverRange({ min: 0, max: 5000, unit: '₦' }), '₦0–₦5,000')
  assert.equal(leverText({ unit: 'min' }, 15), '15 min'); assert.equal(leverText({ unit: '%' }, 5), '5%')
})

test('courts: who can go up, to which court, and what a ruling needs', () => {
  assert.deepEqual([higherCourt('city'), higherCourt('state'), higherCourt('nation')], ['state court', 'federal court', null])
  assert.equal(courtName('nation'), 'federal court')
  const base = { status: 'decided' as const, appeals: 0, tier: 'city' as const, ruling: { by: { id: 'j', name: 'J' }, verdict: 'upheld' as const, note: 'x', at: 1, tier: 'city' as const } }
  assert.equal(canEscalate(base), true)
  assert.equal(canEscalate({ ...base, status: 'open' }), false, 'not ruled yet')
  assert.equal(canEscalate({ ...base, appeals: 1 }), false, 'once')
  assert.equal(canEscalate({ ...base, tier: 'nation' }), false, 'top court')
  assert.equal(canEscalate({ ...base, ruling: { ...base.ruling, verdict: 'quashed' } }), false, 'already free')
  assert.equal(rulingLine(base), 'J upheld it: x'); assert.equal(rulingLine({ ruling: null }), '')
  assert.deepEqual(VERDICTS.map((verdict) => verdict.id), ['upheld', 'reduced', 'quashed'])
  assert.match(noteWhy(null, 'ab'), /reasons first/); assert.equal(noteWhy(null, 'Fair and clear'), ''); assert.equal(noteWhy('Offline.', 'Fair'), 'Offline.')
  assert.match(statementWhy(null, ''), /statement first/); assert.equal(statementWhy(null, 'I was provoked'), '')
})
