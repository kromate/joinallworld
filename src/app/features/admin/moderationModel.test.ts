import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CANNED, age, counts, queue, step } from './moderationModel.ts'

const report = { id: 'r1', about: 'p1', aboutName: 'Ada', aboutNow: 'Ada B', byName: 'Bola', reason: 'insult', text: 'rude', at: 1000, status: 'received' }
test('reports, shops and pictures become one queue, oldest first, and closed ones are left out', () => {
  const items = queue([report, { ...report, id: 'r2', status: 'dismissed' }], [{ shop: 's1', current: 'Mama Put', reason: 'name', by: { id: 'p2', name: 'Tunde' }, at: 500 }], [{ id: 'img1', from: 'p3', fromName: 'Kemi', at: 2000, reports: 2, hidden: true, removed: false }, { id: 'img2', from: null, fromName: null, at: 1, reports: 0, hidden: false, removed: false }], 9000)
  assert.deepEqual(items.map((item) => item.key), ['shop:s1', 'report:r1', 'picture:img1'])
  assert.deepEqual(counts(items), { all: 3, report: 1, shop: 1, picture: 1 })
  assert.equal(items[1]?.title, 'insult · Ada B'); assert.equal(items[2]?.summary, '2 reports · hidden')
})
test('how long something has waited, and moving down the list', () => {
  assert.deepEqual([age(0, 20_000), age(0, 5 * 60_000), age(0, 3 * 3600_000), age(0, 3 * 86400_000)], ['just now', '5 min', '3 h', '3 d'])
  const items = queue([report, { ...report, id: 'r3', at: 2000 }], [], [], 0)
  assert.equal(step(items, null, 1), 'report:r1'); assert.equal(step(items, 'report:r1', 1), 'report:r3'); assert.equal(step(items, 'report:r3', 1), 'report:r3'); assert.equal(step(items, 'report:r3', -1), 'report:r1'); assert.equal(step([], null, 1), null)
})
test('every canned warning is short, kind and different', () => {
  assert.equal(new Set(CANNED.map((item) => item.text)).size, CANNED.length)
  for (const item of CANNED) assert.ok(item.text.length <= 200 && !/https?:|www\./i.test(item.text), item.id)
})
