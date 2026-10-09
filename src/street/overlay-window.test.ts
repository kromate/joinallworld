import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTileOverlayWindow } from './overlay-window.ts'
import type { TileOverlayAsset, TileOverlayView } from './overlay-window.ts'
import type { TileCoord } from './types.ts'

interface TraceView extends TileOverlayView<object> {
  attached: object[]
  rebases: TileCoord[]
  disposals: number
}
interface TraceAsset extends TileOverlayAsset<object> { readonly view: TraceView }

function trace(): TraceAsset {
  const view: TraceView = {
    attached: [], rebases: [], disposals: 0,
    attach(parent) { this.attached.push(parent) },
    rebase(origin) { this.rebases.push({ ...origin }) },
    dispose() { this.disposals++ },
  }
  return { view }
}

const settle = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve() }

test('eviction fences an old same-tile completion after reload', async () => {
  const parent = {}, pending: ((asset: TraceAsset) => void)[] = []
  const window = createTileOverlayWindow({ parent, create: () => new Promise<TraceAsset>((resolve) => pending.push(resolve)) })
  const tile = { x: 2, z: -1 }
  assert.equal(window.onTile(tile), true)
  await settle()
  assert.equal(window.onEvict(tile), true)
  assert.equal(window.onTile(tile), true)
  await settle()
  const newest = trace(); pending[1]!(newest)
  await settle()
  const stale = trace(); pending[0]!(stale)
  await settle()
  assert.deepEqual(newest.view.attached, [parent])
  assert.deepEqual(stale.view.attached, [])
  assert.equal(stale.view.disposals, 1, 'a completed stale resource is immediately released')
  assert.equal(window.diagnostics().resident, 1)
  window.dispose()
  assert.equal(newest.view.disposals, 1)
  assert.equal(window.diagnostics().resident, 0)
})

test('origin changes rebase only ready resident views and loading views use the latest origin', async () => {
  const parent = {}, pending: ((asset: TraceAsset) => void)[] = []
  const window = createTileOverlayWindow({ parent, create: () => new Promise<TraceAsset>((resolve) => pending.push(resolve)) })
  assert.equal(window.onTile({ x: 4, z: 3 }), true)
  await settle()
  const first = trace(); pending[0]!(first); await settle()
  assert.deepEqual(first.view.rebases, [{ x: 0, z: 0 }])
  window.rebase({ x: 1, z: -2 })
  assert.deepEqual(first.view.rebases, [{ x: 0, z: 0 }, { x: 1, z: -2 }])
  assert.equal(window.onTile({ x: 5, z: 3 }), true)
  await settle()
  const second = trace(); pending[1]!(second); await settle()
  assert.deepEqual(second.view.rebases, [{ x: 1, z: -2 }])
  assert.deepEqual([first.view.disposals, second.view.disposals], [0, 0], 'rebasing preserves scene resource ownership')
  window.dispose()
})

test('residency is capped at nine and explicit eviction frees capacity', async () => {
  const pending: ((asset: TraceAsset) => void)[] = []
  const window = createTileOverlayWindow({ parent: {}, create: () => new Promise<TraceAsset>((resolve) => pending.push(resolve)) })
  for (let x = 0; x < 9; x++) assert.equal(window.onTile({ x, z: 0 }), true)
  assert.equal(window.onTile({ x: 9, z: 0 }), false)
  assert.equal(window.diagnostics().resident, 9)
  assert.equal(pending.length, 0, 'factories begin asynchronously only for accepted entries')
  await settle()
  const views = Array.from({ length: 9 }, trace)
  for (let i = 0; i < views.length; i++) pending[i]!(views[i]!)
  await settle()
  assert.equal(window.onEvict({ x: 4, z: 0 }), true)
  assert.equal(window.onTile({ x: 9, z: 0 }), true)
  window.dispose()
  await settle()
  assert.ok(views.every((asset) => asset.view.disposals === 1))
  assert.equal(pending[9], undefined, 'a close before the replacement import starts does not create resources')
})

test('a failed factory is reported once and held until eviction rather than retried on every tile callback', async () => {
  const failures: unknown[] = []
  let attempts = 0
  const tile = { x: 0, z: 0 }
  const window = createTileOverlayWindow({ parent: {}, create: async () => { attempts++; throw Error('asset unavailable') }, onError: (_tile, error) => failures.push(error) })
  assert.equal(window.onTile(tile), true)
  await settle()
  assert.equal(window.onTile(tile), false)
  assert.deepEqual([attempts, failures.length, window.diagnostics().failed], [1, 1, 1])
  window.onEvict(tile)
  window.dispose()
})

test('closing disposes residents and late views without attaching them', async () => {
  const parent = {}, pending: ((asset: TraceAsset) => void)[] = []
  const window = createTileOverlayWindow({ parent, create: () => new Promise<TraceAsset>((resolve) => pending.push(resolve)) })
  assert.equal(window.onTile({ x: 1, z: 1 }), true)
  await settle()
  window.dispose()
  assert.equal(window.onTile({ x: 2, z: 2 }), false)
  const late = trace(); pending[0]!(late); await settle()
  assert.deepEqual(late.view.attached, [])
  assert.equal(late.view.disposals, 1)
  assert.deepEqual(window.diagnostics(), { resident: 0, pending: 0, failed: 0, closed: true })
})
