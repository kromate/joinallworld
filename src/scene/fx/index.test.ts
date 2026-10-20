// The fx host is empty today; these tests pin the tier gate and the shape the next phases fill in.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fxTierFor, fxUsesPost, loadFx } from './index.ts'
import { HIGH_TIER, PHONE_TIER, WIDE_TIER } from '../look.ts'

test('every render tier of look.ts maps to the fx tier of the same name', () => {
  assert.equal(fxTierFor(PHONE_TIER), 'phone')
  assert.equal(fxTierFor(WIDE_TIER), 'wide')
  assert.equal(fxTierFor(HIGH_TIER), 'high')
})

test('an unknown tier name gets the cheapest fx tier', () => {
  assert.equal(fxTierFor({ name: 'ultra' }), 'phone')
  assert.equal(fxTierFor({ name: '' }), 'phone')
})

test('only the high tier may import post-processing and ambient occlusion', () => {
  assert.equal(fxUsesPost('high'), true)
  assert.equal(fxUsesPost('wide'), false)
  assert.equal(fxUsesPost('phone'), false)
})

test('loadFx returns a host that remembers its tier and disposes without error, more than once', async () => {
  for (const tier of ['phone', 'wide', 'high'] as const) {
    const host = await loadFx(tier)
    assert.equal(host.tier, tier)
    host.dispose()
    host.dispose()
  }
})

test('only the high tier given a context builds the post stack; the others stay on the plain path', async () => {
  const context = { THREE: {}, renderer: {}, cityId: 'lagos' } as never
  for (const tier of ['phone', 'wide'] as const) {
    const host = await loadFx(tier, context)
    assert.equal(host.post, null)
    host.regrade(Date.now())
    host.dispose()
  }
  const bare = await loadFx('high')
  assert.equal(bare.post, null, 'no context, no stack')
})

test('the file marks where the next phases add their imports, and never imports the post libraries statically', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
  assert.ok(source.includes('// FX_IMPORTS'), 'phases 1 to 3 look for this marker')
  assert.deepEqual(source.match(/^\s*import\s(?!type\b)[^\n]*['"](?:postprocessing|n8ao)['"]/gm) ?? [], [], 'postprocessing and n8ao are imported lazily, behind the high-tier check')
})

test('the venue host starts the fx host only on the high tier, lazily, and keeps the plain draw otherwise', () => {
  const source = readFileSync(new URL('../../venue-world.ts', import.meta.url), 'utf8')
  assert.ok(source.includes("if (tier.name === 'high' && !fxStarted) startFx()"), 'the gate is the high tier')
  assert.ok(source.includes("import('./scene/fx/index.ts')"), 'the fx chunk is fetched with a dynamic import')
  assert.deepEqual(source.match(/^\s*import\s(?!type\b)[^\n]*scene\/fx\//gm) ?? [], [], 'never a static import of the fx chunk')
  assert.ok(source.includes('(fx?.post ?? renderer).render(scene, camera)'), 'the draw falls back to the renderer')
})
