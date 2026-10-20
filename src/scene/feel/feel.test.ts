// feel(): the tiers' effects arrive together, a large moment is not repeated inside 2 s, and reduced motion or the choice stops the shake.
import test from 'node:test'
import assert from 'node:assert/strict'

// A tiny page: just enough for the confetti and the shake event.
interface Fake { className?: string; children: Fake[]; style: { setProperty(): void; left?: string; top?: string }; setAttribute(): void; append(...n: Fake[]): void; remove(): void; addEventListener(): void; lastChild: Fake | null; querySelector(): null }
const made: Fake[] = []
const fakeNode = (): Fake => {
  const node: Fake = { children: [], style: { setProperty() {} }, setAttribute() {}, append(...n) { node.children.push(...n); node.lastChild = n.at(-1) ?? null }, remove() {}, addEventListener() {}, lastChild: null, querySelector: () => null }
  made.push(node); return node
}
const body = fakeNode()
const win = new EventTarget()
let media = false
Object.assign(globalThis, {
  window: win,
  document: { body, createElement: () => fakeNode(), querySelector: () => null },
  matchMedia: () => ({ matches: media }),
})
const shakes: number[] = []
win.addEventListener('jaw:shake', (event) => shakes.push((event as CustomEvent<{ trauma: number }>).detail.trauma))

const { feel } = await import('./index.ts')
const now = performance.now.bind(performance)
let clock = 100000
performance.now = () => clock

test('a large moment throws confetti and nudges the camera once; a second one inside 2 s is played as medium', () => {
  const before = made.length
  const first = feel('goal-done', {})
  assert.equal(first.tier, 'large')
  assert.deepEqual(shakes, [0.6])
  assert.ok(made.length > before + 20, 'confetti pieces were made')
  clock += 1000
  const second = feel('level-up', {})
  assert.equal(second.tier, 'medium')
  assert.deepEqual(shakes, [0.6], 'no second shake')
  clock += 1500
  assert.equal(feel('election-won', {}).tier, 'large')
  assert.deepEqual(shakes, [0.6, 0.6])
})

test('the tier\'s sound is played only when the caller gives a way to play it', () => {
  clock += 10000
  const heard: string[] = []
  feel('danfo-stop', { sound: (name) => heard.push(name) })
  feel('pay-received', { sound: (name) => heard.push(name), burst: false })
  feel('election-won', { sound: (name) => heard.push(name), burst: false })
  feel('level-up', {}) // silent
  assert.deepEqual(heard, ['toast', 'success', 'goal'])
})

test('small and medium moments never shake', () => {
  clock += 10000
  shakes.length = 0
  feel('danfo-stop', {}); feel('pay-received', {}); feel('fight-hit', {})
  assert.deepEqual(shakes, [])
})

test('the system setting stops the shake (the confetti is also left out by the burst itself)', () => {
  clock += 10000
  shakes.length = 0
  media = true
  feel('goal-done', {})
  assert.deepEqual(shakes, [])
  media = false
})

test.after(() => { performance.now = now })
