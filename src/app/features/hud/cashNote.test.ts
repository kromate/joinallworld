// The cash-change note on the top bar leaves the page once its animation is over.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mock, test } from 'node:test'
import { DELTA_MS, noteExpiry } from './hudModel.ts'

test('the note is cleared after its time, and a new change restarts the wait', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    let note: string | null = '−₦3,500'
    const expiry = noteExpiry(() => { note = null })
    expiry.arm()
    mock.timers.tick(DELTA_MS - 1); assert.equal(note, '−₦3,500')
    expiry.arm(); mock.timers.tick(DELTA_MS - 1); assert.equal(note, '−₦3,500', 'a second change restarts the wait')
    mock.timers.tick(1); assert.equal(note, null)
    note = '−₦200'; expiry.arm(); expiry.cancel(); mock.timers.tick(DELTA_MS * 2); assert.equal(note, '−₦200', 'a cancelled wait never clears')
  } finally { mock.timers.reset() }
})
test('the top bar arms the expiry on each change and drops the note with it', () => {
  const source = readFileSync(new URL('./HudBar.vue', import.meta.url), 'utf8')
  assert.match(source, /noteExpiry\(\(\) => \{ delta\.value = null \}\)/)
  assert.match(source, /expiry\.arm\(\)/)
  assert.ok(DELTA_MS >= 3400, 'longer than the animation')
})
