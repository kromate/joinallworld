import test from 'node:test'
import assert from 'node:assert/strict'
import { MONEY_REQUEST } from '../../../moneyRequest.ts'
import { cardButtons, cardState, cardTitle, checkRequest, doneText, refusalText } from './moneyRequestModel.ts'
import type { MoneyRequestView } from '../../../types/social.ts'

const view = (extra: Partial<MoneyRequestView> = {}): MoneyRequestView => ({ id: 'MR-1', amount: 500, state: 'open', mine: false, expiresAt: 1000, payable: true, ...extra })

test('an amount is a whole number of naira within the limits, and a note is trimmed and at most 60 characters', () => {
  assert.deepEqual(checkRequest(' 500 ', '  lunch  '), { ok: true, amount: 500, note: 'lunch' })
  assert.deepEqual(checkRequest('500', '   '), { ok: true, amount: 500 })
  for (const bad of ['', '0', '-5', '12.5', '1e3', 'abc', '99999999999999999']) assert.equal(checkRequest(bad, '').ok, false, bad)
  assert.deepEqual(checkRequest('50', '', { min: 100, max: 5000 }), { ok: false, reason: 'The smallest amount is ₦100.' })
  assert.deepEqual(checkRequest('6000', '', { min: 100, max: 5000 }), { ok: false, reason: 'The largest amount is ₦5,000.' })
  assert.equal(checkRequest('100', 'x'.repeat(MONEY_REQUEST.noteMax)).ok, true)
  assert.equal(checkRequest('100', 'x'.repeat(MONEY_REQUEST.noteMax + 1)).ok, false)
  assert.equal(checkRequest('100', '😀'.repeat(MONEY_REQUEST.noteMax)).ok, true, 'characters a person sees, not code units')
})

test('an open request reads as expired once its time has come, and the other states stay as they are', () => {
  assert.equal(cardState(view(), 999), 'open')
  assert.equal(cardState(view(), 1000), 'expired')
  assert.equal(cardState(view({ state: 'paid' }), 5000), 'paid')
  assert.equal(cardState(view({ state: 'declined' }), 5000), 'declined')
  assert.equal(cardState(view({ state: 'expired' }), 0), 'expired')
})

test('the friend asked can pay or decline, the one who asked can cancel, and a resolved card has no buttons', () => {
  assert.deepEqual(cardButtons(view(), 1), ['pay', 'decline'])
  assert.deepEqual(cardButtons(view({ mine: true, payable: false }), 1), ['cancel'])
  assert.deepEqual(cardButtons(view({ payable: false }), 1), ['decline'], 'blocked: it can still be turned down')
  for (const state of ['paid', 'declined', 'cancelled', 'expired'] as const) assert.deepEqual(cardButtons(view({ state }), 1), [], state)
  assert.deepEqual(cardButtons(view(), 1000), [], 'out of time')
})

test('titles and refusals are plain sentences, and the server wording wins', () => {
  assert.equal(cardTitle(true, 'Ada'), 'You asked Ada')
  assert.equal(cardTitle(false, 'Ada'), 'Ada asked you')
  assert.equal(refusalText('daily_limit', 'You have sent 5 gifts today.'), 'You have sent 5 gifts today.')
  assert.match(refusalText('request_open'), /already have a request waiting/)
  assert.match(refusalText('network'), /Connection lost/)
  assert.match(refusalText('mystery'), /Nothing was changed/)
  assert.equal(doneText('pay', 1500, 'Ada'), 'Paid ₦1,500 to Ada')
})
