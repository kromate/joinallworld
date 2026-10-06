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
