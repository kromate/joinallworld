import assert from 'node:assert/strict'
import test from 'node:test'
import { isPlayApp, playRequestHeaders } from './playMode.ts'
import type { PlayModeEnvironment } from './playMode.ts'

function memory(initial: string | null = null): { environment: (href?: string, referrer?: string) => PlayModeEnvironment; value: () => string | null; writes: () => number } {
  let kept = initial, count = 0
  return {
    environment: (href = 'https://joinallworld.com/', referrer = '') => ({ href, referrer, storage: { getItem: () => kept, setItem: (_key, value) => { kept = value; count += 1 } } }),
    value: () => kept,
    writes: () => count,
  }
}

test('Play mode recognises the exact launch parameter and remembers both answers for the tab', () => {
  const play = memory()
  assert.equal(isPlayApp(play.environment('https://joinallworld.com/?utm_medium=twa&utm_source=play')), true)
  assert.equal(play.value(), 'play')
  assert.deepEqual(playRequestHeaders(play.environment('https://joinallworld.com/ordinary-web-now')), { 'X-Allworld-App': 'play' })
  assert.equal(play.writes(), 1)

  const web = memory()
  assert.equal(isPlayApp(web.environment('https://joinallworld.com/?utm_source=playful')), false)
  assert.equal(web.value(), 'web')
  assert.equal(isPlayApp(web.environment('https://joinallworld.com/?utm_source=play')), false, 'the first address decides the session')
  assert.equal(web.writes(), 1)
})

test('Play mode accepts only the Android app referrer at its URL boundary', () => {
  assert.equal(isPlayApp(memory().environment('https://joinallworld.com/', 'android-app://com.joinallworld.app/')), true)
  assert.equal(isPlayApp(memory().environment('https://joinallworld.com/', 'android-app://com.joinallworld.app.evil/')), false)
  assert.equal(isPlayApp(memory().environment('https://joinallworld.com/', 'https://com.joinallworld.app/')), false)
})

test('ordinary installed web apps are not labelled as Play, and refused storage never breaks a request', () => {
  const broken: PlayModeEnvironment = {
    href: 'https://joinallworld.com/?utm_source=play', referrer: '',
    storage: { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } },
  }
  assert.deepEqual(playRequestHeaders(broken), { 'X-Allworld-App': 'play' })
  assert.equal(isPlayApp({ href: 'https://joinallworld.com/', referrer: '', storage: null }), false)
})

test('a browser without session storage keeps its first launch decision in memory', () => {
  const locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location')
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  try {
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'https://joinallworld.com/?utm_source=play' } })
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get: () => { throw new Error('blocked') } })
    assert.equal(isPlayApp(), true)
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'https://joinallworld.com/after-navigation' } })
    assert.equal(isPlayApp(), true)
  } finally {
    if (locationDescriptor) Object.defineProperty(globalThis, 'location', locationDescriptor)
    else Reflect.deleteProperty(globalThis, 'location')
    if (storageDescriptor) Object.defineProperty(globalThis, 'sessionStorage', storageDescriptor)
    else Reflect.deleteProperty(globalThis, 'sessionStorage')
  }
})
