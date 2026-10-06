import test from 'node:test'
import assert from 'node:assert/strict'
import { PLAYER_ACTIONS, actionDef, auditCsv, bodyOf, formWhy, relative, naira, uptime } from './adminModel.ts'

test('every destructive action asks for a typed word, and a reason is required for money and sanctions', () => {
  for (const def of PLAYER_ACTIONS.filter((item) => item.danger)) assert.ok(def.typed, def.id)
  for (const id of ['credit', 'debit', 'mute', 'suspend', 'ban']) assert.equal(actionDef(id)?.reason, 'required', id)
})
test('a form is sendable only when its fields, reason and typed word are right', () => {
  const credit = actionDef('credit')!
  assert.match(formWhy(credit, {}, '', '') ?? '', /Amount/)
  assert.match(formWhy(credit, { amount: 1.5 }, 'x', '') ?? '', /whole number/)
  assert.match(formWhy(credit, { amount: 100 }, 'ab', '') ?? '', /reason/)
  assert.equal(formWhy(credit, { amount: 100 }, 'launch bonus', ''), null)
  const ban = actionDef('ban')!
  assert.match(formWhy(ban, { minutes: 0 }, 'abuse', 'ban?') ?? '', /Type BAN/)
  assert.equal(formWhy(ban, { minutes: 0 }, 'abuse', 'ban'), null)
  assert.deepEqual(bodyOf(credit, { amount: '5000' }, ' launch '), { action: 'credit', amount: 5000, reason: 'launch' })
})
test('money and time are worded plainly', () => {
  assert.equal(naira(5000), '₦5,000')
  assert.equal(relative(1000, 1000 + 5 * 60000), '5 min ago'); assert.equal(relative(10000, 9000), 'just now'); assert.equal(relative(0, 5), 'never')
  assert.equal(uptime(90 * 60000), '1 h 30 min')
})
test('the audit CSV quotes commas, quotes and anything a spreadsheet would run as a formula', () => {
  const csv = auditCsv([{ n: 1, at: 0, admin: 'abc', adminName: 'Founder', action: 'credit', target: 't', targetName: '=HYPERLINK("x")', params: { amount: 5 }, summary: 'a, b', reason: 'say "hi"', amount: 5 }])
  const [head, row] = csv.split('\r\n')
  assert.match(head ?? '', /^n,time_utc/)
  assert.match(row ?? '', /"'=HYPERLINK\(""x""\)"/); assert.match(row ?? '', /"a, b"/); assert.match(row ?? '', /"say ""hi"""/)
})
