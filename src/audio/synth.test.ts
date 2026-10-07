import assert from 'node:assert/strict'
import test from 'node:test'
import { FakeContext, FakeParam, FakeSource, asContext } from './fakeAudio.ts'
import { MAX_VOICES, MIN_GAP, Synth, type Recipe } from './synth.ts'
import { RECIPES } from './data.ts'

const param = (p: AudioParam): FakeParam => p as unknown as FakeParam
const make = (recipes: Readonly<Record<string, Recipe>> = RECIPES): { ctx: FakeContext; synth: Synth } => { const ctx = new FakeContext(); return { ctx, synth: new Synth(asContext(ctx), recipes) } }

test('a recipe schedules its envelope: a ramp up to the peak, an exponential decay to silence, and a stop after the end', () => {
  const { ctx, synth } = make({ blip: { l: [{ w: 'sine', f: 440, a: 0.01, d: 0.2, g: 0.5 }] } })
  const before = ctx.made.length
  assert.equal(synth.play('blip'), true)
  const osc = ctx.sources.find(s => s.kind === 'osc') as FakeSource
  assert.deepEqual(osc.started, [0]); assert.ok(osc.stopped[0] as number > 0.2)
  const envelope = ctx.gains.slice(-3).find(g => g.gain.calls.some(c => c[0] === 'lin')) ?? ctx.gains[ctx.gains.length - 1]
  const calls = envelope?.gain.calls.map(c => c[0])
  assert.deepEqual(calls, ['set', 'lin', 'exp'])
  assert.equal(envelope?.gain.calls[1]?.[1], 0.5); assert.ok((envelope?.gain.calls[2]?.[1] ?? 1) < 0.001)
  assert.ok(ctx.made.length > before)
})

test('pitch glides, FM, AM and filters are scheduled on the audio clock', () => {
  const { ctx, synth } = make({ rich: { l: [{ w: 'triangle', f: 200, f2: 400, d: 0.3, g: 0.3, fm: [2, 1], am: [6, 0.5], fl: ['lowpass', 3000, 1, 500] }] } })
  synth.play('rich')
  const osc = ctx.sources.filter(s => s.kind === 'osc')
  assert.equal(osc.length, 3, 'carrier, modulator and AM oscillator')
  assert.ok(osc[0]?.frequency.calls.some(c => c[0] === 'exp' && c[1] === 400), 'the glide')
  assert.ok(ctx.made.some(n => 'Q' in n && (n as unknown as { frequency: { calls: unknown[][] } }).frequency.calls.some(c => c[0] === 'exp' && c[1] === 500)), 'the filter sweep')
})

test('the voice pool is capped, and an important sound is never dropped for a minor one', () => {
  const recipes: Record<string, Recipe> = {}
  for (let i = 0; i < 40; i++) recipes[`minor${i}`] = { l: [{ w: 'sine', f: 300 + i, d: 5, g: 0.1 }], pri: 0 }
  recipes.major = { l: [{ w: 'sine', f: 900, d: 1, g: 0.1 }], pri: 2 }
  const { synth } = make(recipes)
  for (let i = 0; i < 40; i++) synth.play(`minor${i}`)
  assert.ok(synth.voices.size <= MAX_VOICES, `${synth.voices.size} voices`)
  assert.equal(synth.play('major'), true, 'a major sound steals a minor voice')
  assert.ok(synth.voices.size <= MAX_VOICES)
  assert.equal([...synth.voices].some(v => v.id === 'major'), true)
})

test('a voice is released when its last source ends', () => {
  const { ctx, synth } = make({ blip: { l: [{ w: 'sine', f: 440, d: 0.1, g: 0.3 }] } })
  synth.play('blip')
  assert.equal(synth.voices.size, 1)
  for (const s of ctx.sources) s.end()
  assert.equal(synth.voices.size, 0)
})

test('the same recipe twice in a moment is one sound; later it plays again', () => {
  const { ctx, synth } = make()
  assert.equal(synth.play('tap'), true)
  assert.equal(synth.play('tap'), false)
  ctx.currentTime = MIN_GAP * 2
  assert.equal(synth.play('tap'), true)
  assert.equal(synth.play('no-such-recipe'), false)
})

test('an effect steps the ambience back for a moment; a call keeps it nearly silent and softens effects', () => {
  const { ctx, synth } = make()
  synth.play('success')
  assert.ok(param(synth.ambDuck.gain).calls.some(c => c[0] === 'target' && (c[1] as number) < 1), 'ducked under the effect')
  assert.ok(param(synth.ambDuck.gain).calls.some(c => c[0] === 'target' && c[1] === 1), 'and released')
  ctx.currentTime = 1
  synth.setCall(true)
  assert.equal(synth.ambDuck.gain.value, 0.03); assert.equal(synth.fxDuck.gain.value, 0.4)
  const mark = param(synth.ambDuck.gain).calls.length
  synth.play('notify')
  const after = param(synth.ambDuck.gain).calls.slice(mark).filter(c => c[0] === 'target')
  assert.ok(after.length > 0 && after.every(c => (c[1] as number) <= 0.03), 'effects duck from the call level, not from full')
  synth.setCall(false)
  assert.equal(synth.ambDuck.gain.value, 1); assert.equal(synth.fxDuck.gain.value, 1)
})

test('the output ceiling cannot pass -1 dBFS whatever is mixed', () => {
  const { ctx } = make()
  const curve = ctx.shapers[0]?.curve as Float32Array
  assert.ok(curve.length > 1000)
  assert.ok(Math.max(...curve.map(Math.abs)) <= 0.8913 + 1e-6, 'tanh scaled to -1 dBFS')
})

test('every shipped recipe is well-formed: finite, positive times, gains in range, a decay that ends', () => {
  for (const [id, recipe] of Object.entries(RECIPES)) {
    assert.ok(recipe.l.length > 0, id)
    // The call to prayer is one long phrase (about 17 s); everything else ends inside six seconds.
    const limit = id.startsWith('azan') ? 20 : 6
    for (const layer of recipe.l) {
      assert.ok(layer.d > 0 && layer.d < limit, `${id} length`)
      assert.ok(layer.g > 0 && layer.g <= 0.6, `${id} gain ${layer.g}`)
      assert.ok((layer.at ?? 0) >= 0 && (layer.at ?? 0) + layer.d < limit, `${id} offset`)
      if (layer.w !== 'noise') assert.ok(Number.isFinite(layer.f) && (layer.f as number) > 20 && (layer.f as number) < 12000, `${id} frequency`)
    }
  }
})
