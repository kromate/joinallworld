import assert from 'node:assert/strict'
import { test } from 'node:test'
import { change, describe, linePath, niceMax, xAt, yAt } from './chartModel.ts'

const box = { width: 100, height: 50, left: 10, right: 10, top: 5, bottom: 5 }
test('an axis ends on a round number', () => {
  assert.deepEqual([0, 0.4, 1, 1.5, 3, 7, 12, 480, 5001].map(niceMax), [1, 0.5, 1, 2, 5, 10, 20, 500, 10000])
})
test('a point sits inside the plot area', () => {
  assert.equal(xAt(box, 0, 5), 10); assert.equal(xAt(box, 4, 5), 90); assert.equal(xAt(box, 0, 1), 50)
  assert.equal(yAt(box, 0, 10), 45); assert.equal(yAt(box, 10, 10), 5)
})
test('a day that was not measured lifts the line instead of drawing a zero', () => {
  assert.equal(linePath(box, [1, null, 3], 10), 'M10.0 41.0 M90.0 33.0')
  assert.equal(linePath(box, [null, null], 10), '')
  assert.match(linePath(box, [1, 2, 3], 10), /^M10\.0 41\.0 L50\.0 37\.0 L90\.0 33\.0$/)
})
test('the change against yesterday is said in words', () => {
  assert.equal(change(12, 10)?.word, '+2 (+20%) vs yesterday')
  assert.equal(change(8, 10)?.word, '−2 (−20%) vs yesterday')
  assert.equal(change(5, 5)?.word, 'no change')
  assert.equal(change(5, 0)?.word, '+5 vs yesterday')
  assert.equal(change(5, null), null)
})
test('a screen reader hears the range, not just "chart"', () => {
  assert.match(describe('New players', ['1 Oct', '2 Oct', '3 Oct'], [4, null, 9]), /2 days from 1 Oct to 3 Oct\. Latest 9, highest 9 on 3 Oct, lowest 4 on 1 Oct/)
  assert.equal(describe('Online', [], []), 'Online: no data yet.')
})
