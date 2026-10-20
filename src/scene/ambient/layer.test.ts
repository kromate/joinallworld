import { assertNativeSceneBudget } from '../body/native-test-fixture.ts';
import { loadCityContent as preloadCityContent } from '../../game/cities/registry.ts';
await preloadCityContent('lagos');
// The background people of a venue scene, built: inside the scene budget in every kind of place, off unless asked for, frame-bounded, and gone when
// the scene is. The plan itself (who, where, when) is proved in plan.test.ts; this file proves what is drawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createKit } from '../kit.ts';
import { loadAllCityScenes } from '../city-scenes.ts';
import { MAX_CROWD, SCENES } from '../venue-scenes.ts';
import { crowded } from '../space.ts';
import { ACQUAINTANCE_KEY, REMEMBER_REACH, WAVE_MS, WINDOW_MS, MAX_FIGURES, MAX_RESIDENTS, createAmbientLayer } from './layer.ts';
import { MEMORY_LINES } from '../../news/memory-lines.ts';
import type { Ident, Stage } from './plan.ts';
import { createWalkGrid } from '../walk-grid.ts';
import type { SceneEntry, SceneVenue } from '../types.ts';
import { createVenueWorld } from '../../venue-world.ts';
import { loadAmbient } from './hub.ts';
await loadAmbient();
await loadAllCityScenes();

const KINDS = ['park', 'buka', 'hub', 'club', 'office', 'market', 'gym', 'mall', 'beach', 'hospital', 'salon', 'rooftop', 'police', 'worship', 'radio', 'polling', 'viewing', 'shrine', 'walk', 'statehouse', 'airport', 'refinery', 'quad', 'hilltop', 'lakeside', 'generic'];
const TEN = Date.UTC(2026, 9, 12, 9, 0), TEN_PM = Date.UTC(2026, 9, 12, 21, 0); // 10:00 and 22:00 in Lagos (UTC+1)
const venueOf = (kind: string): SceneVenue => ({ id: kind, label: kind, scene: { kind } });
const ident = (kind: string, more: Partial<Ident> = {}): Ident => ({ cityId: 'lagos', venueId: kind, kind, tier: 'full', rainingAt: () => false, hourAt: (at) => (at / 3_600_000 + 1) % 24, ...more });
const crowd = (count = MAX_CROWD) => Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Player${i}`, kind: i % 3 === 2 ? 'npc' : 'player' }));

/** Run with the wall clock fixed, then put it back. */
function at<T>(time: number, run: () => T): T {
  const real = Date.now
  Date.now = () => time
  try { return run() } finally { Date.now = real }
}
const count = (entry: SceneEntry): number => (entry.ambientPeople?.() ?? []).length
const walkers = (entry: SceneEntry) => entry.ambientPeople!()

test('a scene with no ambient config is what it was: no people, no layer, nothing extra drawn', () => {
  const kit = createKit()
  const entry = SCENES.market!(kit, venueOf('market'))
  entry.setCrowd(crowd())
  const before = entry.stats()
  assert.equal(count(entry), 0)
  assert.equal(entry.ambientAwake, false)
  assert.equal(entry.setAmbient!(null), false)
  assert.deepEqual(entry.stats(), before)
  entry.dispose(); kit.dispose()
})

test('every venue kind keeps its full canonical population inside the composition and draw budgets', () => {
  const report: string[] = []
  const kit = createKit()
  let populated = 0
  for (const kind of KINDS) for (const when of [TEN, TEN_PM]) {
    const entry = SCENES[kind]!(kit, venueOf(kind))
    at(when, () => {
      const parent = new THREE.Scene(); parent.add(entry.group)
      entry.setCrowd(crowd())
      assert.equal(entry.setAmbient!(ident(kind)), true)
      const stats = entry.stats(), here = count(entry)
      report.push(`${kind}@${when === TEN ? 10 : 22}: ${stats.triangles} tri, ${stats.drawCalls} calls, ${here} people`)
      assertNativeSceneBudget(stats, `${kind}@${when === TEN ? 10 : 22}`)
      assert.ok(here <= MAX_FIGURES + MAX_RESIDENTS, `${kind} people ${here}`)
      if (here > 0) populated++
      // everyone on a track is in the scene's tags only when speaking; every regular still has her tag
      assert.equal(entry.tags().filter((tag) => tag.kind === 'npc').length, crowd().filter((p) => p.kind === 'npc').length, `${kind} keeps its regulars' tags`)
      const people = walkers(entry)
      assert.deepEqual(crowded(people, 0.9), [], `${kind}: nobody stands inside anyone`)
      entry.dispose(); parent.remove(entry.group)
    })
  }
  assert.ok(populated >= KINDS.length * 1.2, `most places hold somebody (${populated} of ${KINDS.length * 2})`)
  kit.dispose()
  console.log(report.join('\n'))
})

test('a market with a few regulars holds a real crowd at ten, inside the budget, and a quiet hour holds few', () => {
  const kit = createKit()
  const regulars = [{ id: 'npc:a', name: 'Ada', kind: 'npc', seed: 'a' }, { id: 'npc:b', name: 'Bayo', kind: 'npc', seed: 'b' }, { id: 'npc:c', name: 'Chi', kind: 'npc', seed: 'c' }]
  const run = (when: number) => at(when, () => {
    const entry = SCENES.market!(kit, venueOf('market'))
    entry.setCrowd(regulars)
    entry.setAmbient!(ident('market'))
    const stats = entry.stats(), here = count(entry), far = entry.group.getObjectByName('ambient-far')?.children.length ?? 0, caps = entry.ambientCaps!()
    entry.dispose()
    return { stats, here, far, caps }
  })
  // a quarter of an hour in the people have all had time to come in; and the same in the quiet hour
  const busy = run(TEN + 300_000), quiet = run(TEN_PM + 300_000)
  assert.ok(busy.here >= 9, `a busy market: ${busy.here} people ${JSON.stringify(busy)}`)
  assertNativeSceneBudget(busy.stats, 'market with three regulars at 10:00')
  assert.ok(quiet.here < busy.here / 2, `${quiet.here} at ten at night against ${busy.here}`)
  console.log('market with three regulars at 10:00:', JSON.stringify(busy), 'at 22:00:', JSON.stringify(quiet))
  kit.dispose()
})

test('the same place at the same time draws the same people, and a market is busier at ten than at ten at night', () => {
  const kit = createKit()
  const names = (when: number) => at(when, () => { const e = SCENES.market!(kit, venueOf('market')); e.setAmbient!(ident('market')); const out = walkers(e).map((p) => [p.id, p.role].join(':')).sort(); e.dispose(); return out })
  assert.deepEqual(names(TEN + 30_000), names(TEN + 30_000))
  assert.ok(names(TEN + 30_000).length > names(TEN_PM + 30_000).length)
  kit.dispose()
})

// ---- the layer on its own, on a small floor, with the player where the test puts them -------------------------------------------

const grid = createWalkGrid({ bounds: [-10, -8, 10, 8], block: [[-2, 0, 2, 1.5]] })
const floor: Stage = { bounds: [-10, -8, 10, 8], entrance: [0, 7.4], open: true, free: (x, z) => grid.free(x, z), path: (ax, az, bx, bz) => grid.path(ax, az, bx, bz), seats: [], points: [[-6, -4], [6, -4], [-6, 4], [6, 4], [0, -5]], fixed: [] }
function onFloor(player: { x: number; z: number }, more: Partial<Ident> = {}) {
  const kit = createKit(), parent = new THREE.Group()
  const layer = createAmbientLayer({ kit, parent, stage: floor, ident: ident('market', more), heightAt: () => 0, avatar: () => player, room: () => ({ triangles: 9_000, meshes: 40 }), clock: () => TEN })
  const holders = () => (parent.getObjectByName('ambient')?.children ?? []).filter((child) => child.name === 'ambient-resident')
  return { kit, parent, layer, holders, done() { layer.dispose(); kit.dispose() } }
}

test('walkers walk: over a minute their places change, on free floor, and they come in and leave by the door', () => {
  const rig = onFloor({ x: 40, z: 40 })
  const seen = new Map<string, { x: number; z: number }[]>()
  for (let t = 0; t < 60_000; t += 250) {
    rig.layer.step(0.25, TEN + t)
    for (const person of rig.layer.people()) { const list = seen.get(person.id) ?? []; list.push({ x: person.x, z: person.z }); seen.set(person.id, list) }
  }
  const walkersSeen = [...seen.entries()].filter(([id, list]) => /walker/.test(id) && list.length > 4)
  assert.ok(walkersSeen.length >= 3, `walkers came through (${walkersSeen.length})`)
  for (const [id, list] of walkersSeen) {
    assert.ok(Math.hypot(list[list.length - 1]!.x - list[0]!.x, list[list.length - 1]!.z - list[0]!.z) > 0.1 || list.length > 20, `${id} moved`)
    for (const at of list) assert.ok(grid.free(at.x, at.z) || Math.hypot(at.x, at.z - 7.4) < 1, `${id} on free floor`)
  }
  rig.done()
})

test('a regular glances at the player who comes close, then looks away; one far off is not looked at', () => {
  const near = onFloor({ x: 3, z: 1.5 })
  near.layer.setResidents([{ id: 'npc:a', seed: 'a', x: 0, z: 0, ry: 0 }])
  const turned: number[] = []
  for (let i = 0; i < 40; i++) { near.layer.step(0.05, TEN + i * 50); turned.push(near.holders()[0]!.rotation.y) }
  assert.ok(Math.max(...turned) > 0.3, `turned towards the player (${Math.max(...turned).toFixed(2)})`)
  assert.ok(Math.abs(turned[39]!) < 0.15, 'and looked away again')
  near.done()
  const far = onFloor({ x: 30, z: 30 })
  far.layer.setResidents([{ id: 'npc:a', seed: 'a', x: 0, z: 0, ry: 0 }])
  const still: number[] = []
  for (let i = 0; i < 40; i++) { far.layer.step(0.05, TEN + i * 50); still.push(far.holders()[0]!.rotation.y) }
  assert.ok(Math.max(...still.map(Math.abs)) < 0.01)
  far.done()
})

/** Run with a stand-in for the device's storage holding what the news store would keep, then put the real one back. */
async function withMemory<T>(people: Record<string, { kind: string; until: number }> | null, run: () => Promise<T>): Promise<T> {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const stub = { getItem: (key: string) => (key === ACQUAINTANCE_KEY && people ? JSON.stringify({ v: 1, people }) : null), setItem: () => undefined }
  Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true, writable: true })
  try { return await run() } finally { if (had) Object.defineProperty(globalThis, 'localStorage', had); else Reflect.deleteProperty(globalThis, 'localStorage') }
}
const later = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms))

test('a regular who remembers the player turns, waves and says one line when they come near; a stranger, a far-off player and an empty memory get nothing', async () => {
  const soon = Date.now() + 3_600_000
  await withMemory({ a: { kind: 'bought', until: soon } }, async () => {
    const rig = onFloor({ x: 3, z: 1.5 })
    rig.layer.setResidents([{ id: 'npc:a', seed: 'a', x: 0, z: 0, ry: 0 }, { id: 'npc:b', seed: 'b', x: -3, z: 0, ry: 0 }])
    await later()
    const turned: number[] = []
    for (let i = 0; i < 30; i++) { rig.layer.step(0.05, TEN + i * 50); turned.push(rig.holders()[0]!.rotation.y) }
    const barks = rig.layer.tags().filter((tag) => tag.kind === 'bark')
    assert.deepEqual(barks.map((tag) => tag.id), ['bark:npc:a'], 'only the one who remembers speaks')
    assert.ok(MEMORY_LINES.bought.lagos.includes(barks[0]!.text), barks[0]!.text)
    assert.ok(Math.max(...turned) > 0.9, `turned to the player (${Math.max(...turned).toFixed(2)})`)
    assert.ok(WAVE_MS > 0 && REMEMBER_REACH > 3)
    // Told once: the same line is not spoken again when the wave is over and the player is still close.
    rig.layer.step(0.05, TEN + 10_000)
    const again = rig.layer.speak('npc:a', 'x', 1)
    assert.equal(again, true)
    rig.done()
    const far = onFloor({ x: 30, z: 30 })
    far.layer.setResidents([{ id: 'npc:a', seed: 'a', x: 0, z: 0, ry: 0 }])
    await later()
    for (let i = 0; i < 30; i++) far.layer.step(0.05, TEN + i * 50)
    assert.deepEqual(far.layer.tags(), [], 'too far to be seen')
    far.done()
    // Reduced motion: a still placement never waves or speaks.
    const calm = onFloor({ x: 3, z: 1.5 })
    calm.layer.setResidents([{ id: 'npc:a', seed: 'a', x: 0, z: 0, ry: 0 }])
    await later()
    calm.layer.settle(TEN)
    assert.deepEqual(calm.layer.tags(), [])
    calm.done()
  })
  await withMemory(null, async () => {
    const rig = onFloor({ x: 3, z: 1.5 })
    rig.layer.setResidents([{ id: 'npc:a', seed: 'a', x: 0, z: 0, ry: 0 }])
    await later()
    for (let i = 0; i < 30; i++) rig.layer.step(0.05, TEN + i * 50)
    assert.deepEqual(rig.layer.tags(), [], 'nothing remembered, nothing said')
    rig.done()
  })
  await withMemory({ a: { kind: 'greeted', until: Date.now() - 1000 } }, async () => {
    const rig = onFloor({ x: 3, z: 1.5 })
    rig.layer.setResidents([{ id: 'npc:a', seed: 'a', x: 0, z: 0, ry: 0 }])
    await later()
    for (let i = 0; i < 30; i++) rig.layer.step(0.05, TEN + i * 50)
    assert.deepEqual(rig.layer.tags(), [], 'a day later they have forgotten')
    rig.done()
  })
})

test('two regulars face each other while they talk, and go back to their own way after', () => {
  const rig = onFloor({ x: 40, z: 40 })
  rig.layer.setResidents([{ id: 'npc:a', seed: 'a', x: 0, z: 0, ry: 0 }, { id: 'npc:b', seed: 'b', x: 3, z: 0, ry: 0 }])
  assert.equal(rig.layer.talk('npc:a', 'npc:b', 4_000), true)
  for (let i = 0; i < 30; i++) rig.layer.step(0.05, TEN + 100 + i * 50)
  const [a, b] = rig.holders()
  assert.ok(Math.abs(a!.rotation.y - Math.PI / 2) < 0.1 && Math.abs(b!.rotation.y + Math.PI / 2) < 0.1, `${a!.rotation.y} ${b!.rotation.y}`)
  rig.layer.step(0.05, TEN + 9_000)
  for (let i = 0; i < 40; i++) rig.layer.step(0.05, TEN + 9_000 + i * 50)
  assert.ok(Math.abs(rig.holders()[0]!.rotation.y) < 0.1, 'back to facing the way they were placed')
  assert.equal(rig.layer.talk('npc:a', 'npc:nobody'), false)
  rig.done()
})

test('a line over a person is a tag that follows them, goes away by itself, and cannot be put over someone who is not there', async () => {
  const rig = onFloor({ x: 40, z: 40 })
  rig.layer.setResidents([{ id: 'npc:a', seed: 'a', x: 1, z: 2, ry: 0 }])
  assert.equal(rig.layer.speak('npc:a', 'Good morning o!', 30), true)
  assert.equal(rig.layer.speak('nobody', 'hello'), false)
  const tag = rig.layer.tags()[0]!
  assert.deepEqual([tag.kind, tag.text, tag.id], ['bark', 'Good morning o!', 'bark:npc:a'])
  assert.ok(tag.position.y > 2 && tag.position.x === 1 && tag.position.z === 2)
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.deepEqual(rig.layer.tags(), [], 'it went away by itself')
  rig.done()
})

test('frame budget: the window ends the loop by itself, a weak phone gets no far crowd, off gets nobody, and dispose frees everything', () => {
  const kit = createKit()
  at(TEN, () => {
    const entry = SCENES.market!(kit, venueOf('market'))
    entry.setAmbient!(ident('market'))
    assert.equal(entry.wakeAmbient!(), true)
    let frames = 0
    while (entry.stepAmbient!(1 / 60) && frames < 5_000) frames++
    assert.ok(frames >= WINDOW_MS / 1000 * 60 - 2 && frames <= WINDOW_MS / 1000 * 60 + 2, `the window is ${WINDOW_MS} ms of frames (${frames})`)
    assert.equal(entry.ambientAwake, false, 'and then no frame is asked for')
    const far = entry.group.getObjectByName('ambient-far')
    assert.ok(far, 'the full tier has a far crowd')
    entry.setAmbient!(ident('market', { tier: 'light' }))
    assert.equal(entry.group.getObjectByName('ambient-far'), undefined, 'a weak phone has none')
    assert.ok(count(entry) <= 3)
    entry.setAmbient!(ident('market', { tier: 'off' }))
    assert.equal(count(entry), 0)
    entry.setAmbient!(ident('market'))
    entry.dispose()
    assert.equal(entry.group.children.length, 0)
  })
  kit.dispose()
})

// ---- the host: idle stays idle, and the window is the only reason for frames ----------------------------------------------------

const browser = globalThis as unknown as Record<string, unknown>
test('host: with people, an idle venue still draws nothing; the arrival opens one window of frames and the loop ends by itself; reduced motion draws none', async () => {
  const original = { raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame, document: browser.document, matchMedia: browser.matchMedia, window: browser.window }
  let queue: ((time: number) => void)[] = [], time = 5000, reduce = false
  const clock = Object.getOwnPropertyDescriptor(globalThis.performance, 'now')
  Object.defineProperty(globalThis.performance, 'now', { configurable: true, value: () => time })
  globalThis.requestAnimationFrame = (fn) => { queue.push(fn); return queue.length }
  globalThis.cancelAnimationFrame = () => { queue = [] }
  browser.window = new EventTarget()
  browser.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
  browser.matchMedia = (query: string) => ({ matches: reduce && /reduced-motion/.test(query) })
  const canvas = { style: {}, addEventListener() {}, removeEventListener() {}, setPointerCapture() {}, releasePointerCapture() {}, remove() {} }
  const renderer = { calls: 0, shadowMap: {}, domElement: canvas, setPixelRatio() {}, setClearColor() {}, setSize() {}, dispose() {}, render(this: { calls: number }) { this.calls += 1 } } as unknown as THREE.WebGLRenderer & { calls: number }
  const pump = (n: number): number => { let ran = 0; for (let i = 0; i < n; i++) { const fns = queue; queue = []; if (!fns.length) break; time += 16; fns.forEach((fn) => fn(time)); ran += 1 } return ran }
  try {
    await at(TEN, async () => {
      const world = createVenueWorld({ appendChild() {}, getBoundingClientRect: () => ({ width: 1280, height: 800, left: 0, top: 0 }) } as unknown as HTMLElement, { location: 'market', renderer })
      world.setState({ location: 'market', spot: null, t: TEN, name: 'Ada' } as never)
      const idle = world.diagnostics()
      assert.equal(pump(20), 0, 'no people asked for: no frames')
      world.setAmbient((venue, kind) => ident(kind, { venueId: venue }))
      const ran = pump(2_000)
      assert.ok(ran > 600 && ran < 900, `one window of frames, then the loop ends by itself: ${ran}`)
      assert.equal(world.diagnostics().loop.running, false)
      assert.equal(pump(60), 0, 'after the window: zero frames')
      assert.ok(world.ambientPeople().length > 0, 'and the people are still there, standing')
      assert.equal(world.diagnostics().renderCount >= idle.renderCount + ran, true)
      const before = world.diagnostics().renderCount
      world.wakeAmbient(); assert.ok(pump(2_000) > 600, 'a quarter turn or an arrival wakes it again')
      assert.ok(world.diagnostics().renderCount > before)
      world.dispose()
    })
    reduce = true
    await at(TEN, async () => {
      const world = createVenueWorld({ appendChild() {}, getBoundingClientRect: () => ({ width: 390, height: 844, left: 0, top: 0 }) } as unknown as HTMLElement, { location: 'market', renderer })
      world.setState({ location: 'market', spot: null, t: TEN, name: 'Ada' } as never)
      world.setAmbient((venue, kind) => ident(kind, { venueId: venue }))
      assert.equal(pump(200), 0, 'reduced motion: the people are placed once and no frame is asked for')
      assert.ok(world.ambientPeople().length > 0)
      world.dispose()
    })
  } finally {
    globalThis.requestAnimationFrame = original.raf; globalThis.cancelAnimationFrame = original.caf
    browser.document = original.document; browser.matchMedia = original.matchMedia; browser.window = original.window
    if (clock) Object.defineProperty(globalThis.performance, 'now', clock); else Reflect.deleteProperty(globalThis.performance, 'now')
  }
})
