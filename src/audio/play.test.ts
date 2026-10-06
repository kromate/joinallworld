// The gesture gate: nothing is created before the first tap, click or key, and a blocked or missing audio context is silent.
import assert from 'node:assert/strict'
import test from 'node:test'
import { FakeContext } from './fakeAudio.ts'

type Handler = (event: unknown) => void
const handlers = new Map<string, Handler[]>()
const listen = (type: string, handler: Handler): void => { handlers.set(type, [...(handlers.get(type) ?? []), handler]) }
const fire = (type: string, detail: unknown = {}): void => { for (const handler of handlers.get(type) ?? []) handler({ type, detail, target: null }) }
let created = 0
const contexts: FakeContext[] = []
class FakeAudioContext extends FakeContext {
  constructor() { super(); created++; contexts.push(this); this.state = 'suspended' }
  override resume(): Promise<void> { this.resumed++; this.state = 'running'; return Promise.resolve() }
}
const errors: unknown[][] = []
const target = { addEventListener: listen, removeEventListener: () => undefined, dispatchEvent: () => true }
Object.assign(globalThis, {
  window: { ...target, location: { search: '' }, localStorage: null }, document: { ...target, hidden: false, createElement: () => ({ style: {} }) }, addEventListener: listen, localStorage: undefined,
  AudioContext: FakeAudioContext,
})
// The engine's repeating timer must not keep the test process alive.
const realInterval = globalThis.setInterval
globalThis.setInterval = ((run: () => void, ms?: number) => { const id = realInterval(run, ms); id.unref(); return id }) as typeof setInterval
const originalError = console.error
console.error = (...args: unknown[]) => { errors.push(args) }

test('before a gesture nothing is created; the first gesture loads the engine and creates exactly one context, which is resumed', async () => {
  const hook = await import('./play.ts')
  hook.play('tap'); hook.play('coins'); hook.setCallActive(true)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(created, 0, 'no AudioContext before a gesture, however many sounds are asked for')
  fire('pointerdown')
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.equal(created, 1, 'one context after the first gesture')
  assert.equal(contexts[0]?.state, 'running', 'resumed inside the gesture')
  fire('pointerdown'); fire('keydown')
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(created, 1, 'later gestures do not create another')
  assert.deepEqual(errors, [], 'no console errors')
})

test('a board move, a capture and the guide speaking each make a sound; an unknown announcement makes none', async () => {
  const context = contexts[0]
  assert.ok(context, 'the engine is running')
  const made = (): number => context.sources.length
  const heard = async (type: string, detail: unknown): Promise<number> => {
    const before = made()
    fire(type, detail)
    await new Promise(resolve => setTimeout(resolve, 20))
    const heard = made() - before
    await new Promise(resolve => setTimeout(resolve, 200))
    return heard
  }
  assert.ok(await heard('jaw:table', { game: 'chess', event: 'move' }) > 0, 'a piece set down')
  assert.ok(await heard('jaw:table', { game: 'chess', event: 'capture' }) > 0, 'a capture')
  assert.ok(await heard('jaw:table', { game: 'weave', event: 'bingo' }) > 0, 'a word using every tile')
  assert.ok(await heard('jaw:companion', { kind: 'speak', mood: 'celebrate' }) > 0, 'the guide celebrates')
  assert.equal(await heard('jaw:table', { game: 'chess', event: 'nonsense' }), 0)
  assert.equal(await heard('jaw:companion', { kind: 'act' }), 0)
})

test.after(() => { console.error = originalError })
