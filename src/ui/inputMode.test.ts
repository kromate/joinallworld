import assert from 'node:assert/strict'
import test from 'node:test'
import { inputMode } from './inputMode.ts'
import type { InputFacts } from './inputMode.ts'
import { shortcutGroups } from '../app/features/tour/shortcutsModel.ts'
import { STEPS, wordsOf } from '../app/features/tour/tourModel.ts'

const base: InputFacts = { coarse: false, fine: true, touchPoints: 0, width: 1280, touchSeen: false, keySeen: false }
const decide = (extra: Partial<InputFacts>) => inputMode({ ...base, ...extra })

test('a desktop: keys only', () => assert.deepEqual(decide({}), { touch: false, keys: true }))
test('a phone, however it reports itself: gestures', () => {
  assert.deepEqual(decide({ coarse: true, fine: false, touchPoints: 5, width: 390 }), { touch: true, keys: false })
  assert.equal(decide({ coarse: false, fine: false, width: 390 }).touch, true, 'narrow with no fine pointer (the pointer media query did not say)')
  assert.equal(decide({ coarse: false, fine: true, touchPoints: 1, width: 390 }).touch, true, 'touch points alone')
})
test('a touch laptop, or a tablet with a keyboard, gets both', () => {
  assert.deepEqual(decide({ touchPoints: 10 }), { touch: true, keys: true })
  assert.deepEqual(decide({ coarse: true, fine: false, width: 1024, keySeen: true }), { touch: true, keys: true })
})
test('it follows the first touch or key that arrives', () => {
  assert.deepEqual(decide({ touchSeen: true }), { touch: true, keys: true })
  assert.deepEqual(decide({ coarse: true, fine: false, width: 820 }), { touch: true, keys: false })
  assert.deepEqual(decide({ coarse: true, fine: false, width: 820, keySeen: true }), { touch: true, keys: true })
})
test('what each answer shows: the tour step and the shortcuts sheet', () => {
  const move = STEPS.find((step) => step.id === 'move')!
  const say = (touch: boolean, keys: boolean) => wordsOf(move, { home: false, touch, keys, has: () => false }, false).text
  assert.match(say(true, false), /Drag the stick/); assert.doesNotMatch(say(true, false), /keys/)
  assert.match(say(false, true), /Walk with the keys/)
  assert.match(say(true, true), /keys or the stick/)
  assert.deepEqual(shortcutGroups(true, false).map((group) => group.id), ['move', 'camera', 'map', 'panels', 'chat', 'general'])
  assert.ok(shortcutGroups(true, true).some((group) => group.id === 'touch-move') && shortcutGroups(true, true).some((group) => group.id === 'move'), 'both groups')
  assert.ok(shortcutGroups(false, true).every((group) => !group.id.startsWith('touch-')))
  assert.equal(move.keys!({ home: false, touch: true, keys: false, has: () => false }).length, 0, 'a phone is shown no key-caps')
})
