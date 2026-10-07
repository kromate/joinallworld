import test from 'node:test'
import { SCENE_TRIANGLES, SCENE_DRAW_CALLS } from '../budgets.ts'
import { loadParametricScenes } from './city-scenes.ts'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { loadCityContent } from '../game/cities/registry.ts'
import { createKit } from './kit.ts'
import type { SceneOptions, SceneVenue } from './types.ts'
import { MAX_CROWD, buildVenueScene } from './venue-scenes.ts'
import type { ParametricVenueDesign } from '../types/content.ts'

await loadParametricScenes()

await loadCityContent('lagos')

const TRIANGLE_BUDGET = SCENE_TRIANGLES.value
const DRAW_CALL_BUDGET = SCENE_DRAW_CALLS.value
const CROWD = Array.from({ length: MAX_CROWD }, (_, index) => ({ id: `person-${index}`, name: `Person ${index}`, kind: index % 3 ? 'player' : 'npc' }))

const DESIGNS = [
  { palette: { wall: '#e2c99f', roof: '#755044', accent: '#d98336', ground: '#6e8a55' }, roof: 'flat', sign: 'facade', props: [], landmark: 'rock' },
  { palette: { wall: '#d6ddd4', roof: '#3d5f59', accent: '#e0a43a', ground: '#758b67' }, roof: 'gable', sign: 'roadside', props: ['tree'], landmark: 'hill' },
  { palette: { wall: '#e4d8bf', roof: '#344b73', accent: '#c54c42', ground: '#798b63' }, roof: 'hipped', sign: 'facade', props: ['bench', 'lamp'], landmark: 'tower' },
  { palette: { wall: '#d9c59e', roof: '#654334', accent: '#3e8a6c', ground: '#6d8653' }, roof: 'flat', sign: 'roadside', props: ['planter', 'stall'], landmark: 'gate' },
  { palette: { wall: '#d8d2c2', roof: '#355667', accent: '#68a8bd', ground: '#6f8a65' }, roof: 'gable', sign: 'facade', props: ['tree', 'planter'], landmark: 'river' },
] satisfies readonly ParametricVenueDesign[]

const CASES = [
  { id: 'generated-market', label: 'Unity Market', kind: 'market', spots: [{ id: 'produce', label: 'Produce' }, { id: 'fabric', label: 'Fabric' }, { id: 'people', label: 'People' }] },
  { id: 'generated-clinic', label: 'New Town Clinic', kind: 'hospital', spots: [{ id: 'reception', label: 'Reception' }, { id: 'doctor', label: 'Doctor' }, { id: 'people', label: 'People' }] },
  { id: 'generated-eatery', label: 'Good Food Kitchen', kind: 'buka', spots: [{ id: 'counter', label: 'Counter' }, { id: 'kitchen', label: 'Kitchen' }, { id: 'people', label: 'People' }] },
  { id: 'generated-worship', label: 'Community Quiet Hall', kind: 'worship', spots: [{ id: 'hall', label: 'Quiet hall' }, { id: 'reflection', label: 'Reflection' }, { id: 'people', label: 'People' }] },
] satisfies readonly { id: string; label: string; kind: string; spots: { id: string; label: string }[] }[]

function venue(scene: SceneOptions, item: (typeof CASES)[number]): SceneVenue {
  return { id: item.id, label: item.label, scene: { ...scene, spots: item.spots } }
}

function trackGeometries(run: (live: Set<THREE.BufferGeometry>) => void): Set<THREE.BufferGeometry> {
  const live = new Set<THREE.BufferGeometry>()
  const original = THREE.BufferGeometry.prototype.setIndex
  THREE.BufferGeometry.prototype.setIndex = function setIndex(this: THREE.BufferGeometry, ...args: Parameters<typeof original>) {
    if (!live.has(this)) {
      live.add(this)
      this.addEventListener('dispose', () => live.delete(this))
    }
    return original.apply(this, args)
  }
  try { run(live) } finally { THREE.BufferGeometry.prototype.setIndex = original }
  return live
}

test('parametric identity keeps each venue kind semantic, reachable and inside the scene budget', () => {
  const leaked = trackGeometries((live) => {
    const kit = createKit()
    const kitGeometries = live.size
    for (let index = 0; index < CASES.length; index += 1) {
      const item = CASES[index]!
      const design = DESIGNS[index]!
      const entry = buildVenueScene(kit, venue({ kind: item.kind, design }, item))
      entry.setCrowd(CROWD)
      const stats = entry.stats()
      assert.equal(entry.kind, item.kind)
      assert.equal(entry.mood, item.kind === 'market' ? 'outdoor' : 'indoor')
      assert.ok(stats.triangles <= TRIANGLE_BUDGET, `${item.id}: ${stats.triangles} triangles`)
      assert.ok(stats.drawCalls <= DRAW_CALL_BUDGET, `${item.id}: ${stats.drawCalls} draw calls`)
      assert.ok(entry.walk.grid && entry.walk.entrance, `${item.id}: walk grid and entrance`)
      for (const spot of entry.walk.spots()) {
        assert.ok(entry.anchors[spot.id]?.landmark, `${item.id}.${spot.id}: authored landmark preserved`)
        const target = entry.walk.grid.nearest(spot.approach?.x ?? spot.x, spot.approach?.z ?? spot.z)
        assert.ok(target, `${item.id}.${spot.id}: free approach after decoration`)
        assert.ok(entry.walk.grid.path(entry.walk.entrance.x, entry.walk.entrance.z, target.x, target.z), `${item.id}.${spot.id}: reachable after decoration`)
      }
      const before = live.size
      entry.dispose()
      assert.equal(entry.group.children.length, 0)
      assert.equal(entry.group.parent, null)
      assert.ok(live.size < before && live.size === kitGeometries, `${item.id}: geometry disposed`)
    }
    kit.dispose()
  })
  assert.equal(leaked.size, 0)
})

test('all roof, sign, prop and landmark options build, while an absent design keeps the legacy path', () => {
  const kit = createKit()
  const item = CASES[0]!
  const legacy = buildVenueScene(kit, venue({ kind: item.kind }, item))
  const legacyStats = legacy.stats()
  const legacyAnchors = Object.fromEntries(item.spots.map((spot) => [spot.id, legacy.anchors[spot.id]!.landmark]))
  legacy.dispose()
  const repeated = buildVenueScene(kit, venue({ kind: item.kind }, item))
  assert.deepEqual(repeated.stats(), legacyStats)
  assert.deepEqual(Object.fromEntries(item.spots.map((spot) => [spot.id, repeated.anchors[spot.id]!.landmark])), legacyAnchors)
  repeated.dispose()

  for (const design of DESIGNS) {
    const entry = buildVenueScene(kit, venue({ kind: item.kind, design }, item))
    assert.ok(entry.stats().triangles > legacyStats.triangles, `${design.roof}/${design.sign}/${design.landmark}: identity geometry added`)
    assert.deepEqual(Object.fromEntries(item.spots.map((spot) => [spot.id, entry.anchors[spot.id]!.landmark])), legacyAnchors)
    entry.dispose()
  }

  const shortLabel = buildVenueScene(kit, { id: 'short', label: 'A', scene: { kind: 'market', design: DESIGNS[0] } })
  const realLabel = buildVenueScene(kit, { id: 'long', label: 'UNITY MARKET', scene: { kind: 'market', design: DESIGNS[0] } })
  assert.notEqual(shortLabel.stats().triangles, realLabel.stats().triangles, 'the actual venue label determines the sign geometry')
  shortLabel.dispose()
  realLabel.dispose()
  kit.dispose()
})

test('parametric worship is neutral only without an explicit authored variant', () => {
  const kit = createKit()
  const design = DESIGNS[1]!
  const quiet = buildVenueScene(kit, { id: 'quiet', label: 'Quiet Hall', scene: { kind: 'worship', design, spots: [{ id: 'reflection', label: 'Reflection' }] } })
  const church = buildVenueScene(kit, { id: 'church', label: 'Named Church', scene: { kind: 'worship', variant: 'church', design } })
  const mosque = buildVenueScene(kit, { id: 'mosque', label: 'Named Mosque', scene: { kind: 'worship', variant: 'mosque', design } })
  assert.equal(quiet.anchors.reflection?.landmark, 'reflection')
  assert.notEqual(quiet.stats().triangles, church.stats().triangles)
  assert.notEqual(quiet.stats().triangles, mosque.stats().triangles)
  assert.notEqual(church.stats().triangles, mosque.stats().triangles)
  quiet.dispose(); church.dispose(); mosque.dispose(); kit.dispose()
})

test('every generated base kind stays within budget with every design and a full crowd', () => {
  const kit = createKit()
  try {
    for (const kind of ['airport', 'buka', 'club', 'hospital', 'hub', 'market', 'office', 'park', 'polling', 'refinery', 'salon', 'statehouse', 'viewing', 'walk', 'worship']) {
      for (const design of DESIGNS) {
        const entry = buildVenueScene(kit, { id: `generated-${kind}`, label: 'Public Place', scene: { kind, design, spots: [{ id: 'visit', label: 'Visit' }, { id: 'work', label: 'Work' }] } })
        try {
          entry.setCrowd(CROWD)
          const stats = entry.stats()
          assert.ok(stats.triangles <= TRIANGLE_BUDGET, `${kind}/${design.roof}/${design.landmark}: ${stats.triangles} triangles`)
          assert.ok(stats.drawCalls <= DRAW_CALL_BUDGET, `${kind}/${design.roof}: ${stats.drawCalls} draw calls`)
          assert.ok(entry.walk.grid && entry.walk.entrance, `${kind}: walk grid and entrance`)
          for (const spot of entry.walk.spots()) {
            const target = entry.walk.grid.nearest(spot.approach?.x ?? spot.x, spot.approach?.z ?? spot.z)
            assert.ok(target && entry.walk.grid.path(entry.walk.entrance.x, entry.walk.entrance.z, target.x, target.z), `${kind}.${spot.id}: reachable`)
          }
        } finally { entry.dispose() }
      }
    }
  } finally { kit.dispose() }
})
