// The pop: how hard and how long, and that reduced motion makes it softer and shorter.
import test from 'node:test'
import assert from 'node:assert/strict'
import { POP_MS, POP_MS_REDUCED, popElement, popStyle } from './pop.ts'

test('a pop lasts 180 ms; reduced motion halves its strength and length; strength stays between 0 and 1', () => {
  assert.deepEqual(popStyle(1, false), { amount: 1, ms: POP_MS })
  assert.equal(POP_MS, 180)
  assert.deepEqual(popStyle(0.8, true), { amount: 0.4, ms: POP_MS_REDUCED })
  assert.ok(POP_MS_REDUCED < POP_MS)
  assert.equal(popStyle(5, false).amount, 1)
  assert.equal(popStyle(-1, false).amount, 0)
})

test('popping an element sets its strength and time and restarts the class; the class goes when its own animation ends', () => {
  const classes = new Set<string>(), vars = new Map<string, string>(), listeners: ((event: { target: unknown }) => void)[] = []
  const el = {
    offsetWidth: 1,
    style: { setProperty: (name: string, value: string) => { vars.set(name, value) } },
    classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
    addEventListener: (_: string, fn: (event: { target: unknown }) => void) => { listeners.push(fn) },
    removeEventListener: () => {},
  }
  popElement(el as unknown as Element, 1, false)
  assert.equal(vars.get('--pop'), '1'); assert.equal(vars.get('--pop-ms'), '180ms'); assert.ok(classes.has('feel-pop'))
  listeners[0]!({ target: {} }) // a child's animation ending does not end the pop
  assert.ok(classes.has('feel-pop'))
  listeners[0]!({ target: el })
  assert.ok(!classes.has('feel-pop'))
  popElement(el as unknown as Element, 1, true)
  assert.equal(vars.get('--pop-ms'), '90ms')
  assert.doesNotThrow(() => popElement(null, 1, false))
})
