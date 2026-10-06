import assert from 'node:assert/strict'
import { test } from 'node:test'
import { reverseOf } from './playerActions.ts'

test('what can be taken back is taken back with the same reason', () => {
  assert.deepEqual(reverseOf({ action: 'credit', amount: 5000, reason: 'Contest prize' }, { applied: 5000 }), { label: 'Take back ₦5,000', body: { action: 'debit', amount: 5000, reason: 'Undo: Contest prize' } })
  assert.deepEqual(reverseOf({ action: 'debit', amount: 900, reason: 'Duplicate credit' }, { applied: 400 }), { label: 'Give back ₦400', body: { action: 'credit', amount: 400, reason: 'Undo: Duplicate credit' } }, 'only what the debit really took')
  assert.deepEqual(reverseOf({ action: 'mute', minutes: 60 }, {}), { label: 'Lift the mute', body: { action: 'unmute' } })
  assert.deepEqual(reverseOf({ action: 'suspend', kind: 'calls', minutes: 5 }, {}), { label: 'Lift the suspension', body: { action: 'unsuspend', kind: 'calls' } })
  assert.deepEqual(reverseOf({ action: 'ban' }, {}), { label: 'Unban', body: { action: 'unban' } })
  assert.equal(reverseOf({ action: 'credit', amount: 5, reason: 'x' }, { applied: 0 }), null, 'a credit that moved nothing has nothing to take back')
  for (const action of ['rename', 'message', 'note', 'heal', 'need', 'signout', 'teleport', 'unban', 'unmute']) assert.equal(reverseOf({ action }, { applied: 1 }), null, action)
})
