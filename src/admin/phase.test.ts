import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { STAFF_ONLY, gameUrlOf, phaseOf } from './phase.ts'

test('a stranger is asked to sign in, a signed-in non-admin is told it is for staff, an admin gets the screens', () => {
  assert.equal(phaseOf({ enabled: true, signedIn: false }, null), 'signin')
  assert.equal(phaseOf({ enabled: true, signedIn: true }, 'refused'), 'denied')
  assert.equal(phaseOf({ enabled: true, signedIn: true }, 'ok'), 'ready')
  assert.equal(phaseOf({ enabled: true, signedIn: true }, 'failed'), 'down', 'a server that did not answer is not "not an admin"')
  assert.equal(phaseOf({ enabled: true, signedIn: true }, null), 'loading')
  assert.equal(phaseOf({ enabled: false, signedIn: false }, null), 'off', 'no sign-in is configured, so there is nobody to sign in')
  assert.equal(phaseOf({ enabled: false, signedIn: true }, null), 'denied')
})
test('the way back goes to the game, on the same scheme and port', () => {
  assert.equal(gameUrlOf({ protocol: 'https:', host: 'admin.joinallworld.com' }), 'https://joinallworld.com/')
  assert.equal(gameUrlOf({ protocol: 'http:', host: 'admin.localhost:4175' }), 'http://localhost:4175/')
})
test('the staff-only page says so in plain words, with a way back and a way out, and the page carries nothing of the game', () => {
  const host = readFileSync(new URL('./AdminHost.vue', import.meta.url), 'utf8')
  assert.ok(host.includes('phaseOf(') && host.includes('STAFF_ONLY') && host.includes(':href="gameUrl"') && host.includes('account.signOut()'))
  assert.equal(STAFF_ONLY, 'This area is for Allworld staff')
  for (const file of ['main.ts', 'AdminHost.vue', 'AdminSignIn.vue', 'transport.ts', 'phase.ts']) {
    const imports = [...readFileSync(new URL(`./${file}`, import.meta.url), 'utf8').matchAll(/from '([^']+)'|import\('([^']+)'\)/g)].map((match) => match[1] ?? match[2] ?? '')
    for (const target of imports) assert.doesNotMatch(target, /state\/app|three|scene|companion|game\/|audio|startApp/, `${file} imports ${target}`)
  }
})
