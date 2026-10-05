// The shell's rule for a character that is open on several devices: when is a change of place "from your other device"?
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { continuedElsewhere } from './devices.ts'
import type { LifeState } from '../../types/life.ts'

type Placed = Pick<LifeState, 'location' | 'activeAction' | 'estate'>
const at = (location: string, city = 'lagos'): Placed => ({ location, activeAction: null, estate: { city } } as unknown as Placed)
const travelling = (from: string, to: string, city = 'lagos'): Placed => ({ location: from, activeAction: { kind: 'travel', id: to, duration: 6, remaining: 3 }, estate: { city } } as unknown as Placed)
const busy = (location: string): Placed => ({ location, activeAction: { kind: 'activity', id: 'chill', duration: 30, remaining: 12 }, estate: { city: 'lagos' } } as unknown as Placed)

test('this device\'s own actions and polls are never "from your other device"', () => {
  assert.equal(continuedElsewhere('own', at('park'), travelling('park', 'library')), false)
  assert.equal(continuedElsewhere('own', travelling('park', 'library'), at('library')), false)
  assert.equal(continuedElsewhere('own', at('park'), at('park', 'ibadan')), false)
})

test('a change the server says another device made: a trip that started, a place or a city that changed — and nothing else', () => {
  assert.equal(continuedElsewhere('elsewhere', at('park'), travelling('park', 'library')), true)
  assert.equal(continuedElsewhere('elsewhere', at('park'), at('library')), true)
  assert.equal(continuedElsewhere('elsewhere', at('park'), at('park', 'ibadan')), true)
  assert.equal(continuedElsewhere('elsewhere', at('park'), at('park')), false, 'money spent on another device moves nobody')
  assert.equal(continuedElsewhere('elsewhere', at('park'), busy('park')), false, 'an activity is not a change of place')
  assert.equal(continuedElsewhere('elsewhere', travelling('park', 'library'), travelling('park', 'library')), false, 'the same trip')
})

test('a device that comes back: a new trip, another place or another city is from elsewhere; its own trip having ended is not', () => {
  assert.equal(continuedElsewhere('wake', at('park'), travelling('park', 'library')), true)
  assert.equal(continuedElsewhere('wake', at('park'), at('library')), true)
  assert.equal(continuedElsewhere('wake', at('park'), at('park', 'ibadan')), true)
  assert.equal(continuedElsewhere('wake', travelling('park', 'library'), at('library')), false, 'it set off from here and arrived while away')
  assert.equal(continuedElsewhere('wake', at('park'), at('park')), false)
  assert.equal(continuedElsewhere('wake', at('park'), busy('park')), false)
})

test('the shell keeps the screen a device has open when the place changed elsewhere, and reads the life when a socket comes back', async () => {
  const source = await readFile(new URL('./app.ts', import.meta.url), 'utf8')
  // The three places the shell would otherwise change the screen for a change of place are each held back by `away`.
  assert.match(source, /game\.mode\.value !== 'map' && !away\) shell\.setMode\('map'\)/)
  assert.match(source, /game\.mode\.value !== 'venue' && !away\) shell\.setMode\('venue'\)/)
  assert.match(source, /!state\.estate\.lga && !state\.estate\.home && !away\) shell\.open\('city'/)
  assert.match(source, /if \(away\) game\.toast\(CONTINUED_TEXT\)/)
  // The place itself is always followed.
  assert.match(source, /scene\.venue\.value\?\.setLocation\(state\.location\)/)
  assert.match(source, /onLifeFrame\(\(hint\) => \{ game\.lifeChanged\(hint\) \}\)/)
  assert.match(source, /onSocketOpen\(\(again\) => \{ if \(again\) void game\.wake\(\) \}\)/)
  assert.match(source, /onSocketClose\(\(code\) => \{ if \(code === SESSION_CHANGED\) void sessionMoved\(\) \}\)/)
  const page = await readFile(new URL('../App.vue', import.meta.url), 'utf8')
  assert.match(page, /else \{ wakeSocket\(\); void game\.wake\(\) \}/)
})
