// OWNER: scenes (unique places) — the city map shows a venue's own LOD2 model on its plinth in place of the procedural building, keeps the procedural
// one as the fallback until the model arrives and for any venue whose model is missing, and counts its triangles under the city budget.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { Mesh } from 'three'
import { BUDGETS } from '../budgets.ts'
import { loadCityContent } from '../game/cities/registry.ts'
import { COMING_SOON } from '../game/content/venues.ts'
import { contentFor } from '../game/cities/runtime.ts'
import { createKit } from '../scene/kit.ts'
import { iconOf, planPlaceIcons } from '../scene/places/icons.ts'
import type { PlaceIcon, PlaceIcons } from '../scene/places/icons.ts'
import { LANDMARK_SCALE, buildCity } from './city-build.ts'
import { PLINTH } from './landmarks.ts'
import { buildNetwork } from './roads.ts'
import pack from './cities/lagos.ts'

const lod2 = new Uint8Array(readFileSync(new URL('../scene/places/fixtures/airport-abuja.lod2.glb', import.meta.url)))
async function airportIcon(): Promise<PlaceIcon> {
  const { createHash } = await import('node:crypto')
  const sha256 = createHash('sha256').update(lod2).digest('hex')
  const manifest = { schema: 'allworld-place-models', version: 1, city: 'lagos', atlas: { url: `/assets/places/trim-${'a'.repeat(64)}.webp`, sha256: 'a'.repeat(64) },
    venues: { airport: { archetype: 'airport-terminal', lod0: { sha256, bytes: lod2.length, brotliBytes: 1, triangles: 170 }, lod1: { sha256, bytes: lod2.length, brotliBytes: 1, triangles: 170 }, lod2: { sha256, bytes: lod2.length, brotliBytes: 1, triangles: 170 } } } } as const
  const plan = await planPlaceIcons('lagos', { manifest: manifest as never, fetcher: async () => new Response(new Uint8Array(lod2).buffer, { status: 200 }) })
  const icons = await plan!.load()
  return icons.models.get('airport')!
}
const named = (group: { children: { name: string }[] }, prefix: string) => group.children.filter(child => child.name.startsWith(prefix))

test('the venues with an icon coming keep their procedural building apart; the icon replaces it, a venue without one keeps it', async () => {
  await loadCityContent('lagos')
  const content = contentFor('lagos'), venues = Object.fromEntries(content.venues.map(venue => [venue.id, venue.definition]))
  const ids = Object.keys(pack.sites).filter(id => venues[id] && id !== 'airport')
  assert.ok(Object.hasOwn(pack.sites, 'airport') && ids.length > 0, 'the Lagos map has the airport and other venues')
  const other = ids[0]!, icon = await airportIcon()
  const kit = createKit()
  const baseline = buildCity(kit, pack, buildNetwork(pack), { venues, soon: COMING_SOON })
  const apart = buildCity(kit, pack, buildNetwork(pack), { venues, soon: COMING_SOON, iconVenues: new Set(['airport', other]) })
  try {
    assert.equal(apart.triangles, baseline.triangles, 'the same buildings are drawn, only apart')
    assert.ok(named(apart.group, 'landmarks-').length >= 1 && named(apart.group, 'landmarks-').length <= 4, 'a handful of extra meshes')
    assert.equal(named(baseline.group, 'landmarks-').length, 0)
    assert.equal(apart.setPlaceIcons(null), false); assert.equal(apart.setPlaceIcons({ models: new Map() }), false, 'no icon arrived: nothing changes')
    assert.equal(named(apart.group, 'landmarks-').length >= 1, true)
    assert.equal(baseline.setPlaceIcons({ models: new Map([['airport', icon]]) }), false, 'a city built without iconVenues has nothing to swap')

    const before = apart.triangles
    assert.equal(apart.setPlaceIcons({ models: new Map([['airport', icon]]) } satisfies PlaceIcons), true)
    assert.equal(apart.setPlaceIcons({ models: new Map([['airport', icon]]) }), false, 'once')
    // The other venue had no icon: its building is drawn again, apart. The airport's is gone, and the icon stands where it stood.
    const meshes = named(apart.group, 'landmarks-') as Mesh[]
    assert.ok(meshes.length >= 2, 'the fallback for the other venue and the icons')
    const airport = apart.places.airport!, box = { reach: 0, y1: -Infinity }
    // The icon mesh holds the plinth and the model of the airport only: find the mesh whose vertices include the airport's plinth.
    let found = false
    for (const mesh of meshes) {
      const position = mesh.geometry.getAttribute('position')
      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i), z = position.getZ(i)
        if (Math.hypot(x - airport.x, z - airport.z) < PLINTH * LANDMARK_SCALE) {
          found = true
          box.reach = Math.max(box.reach, Math.hypot(x - airport.x, z - airport.z)); box.y1 = Math.max(box.y1, position.getY(i))
        }
      }
    }
    assert.ok(found, 'geometry stands at the airport')
    assert.ok(box.reach <= (PLINTH + 0.5) * LANDMARK_SCALE * Math.SQRT1_2 * 1.01, `it fits its plinth (reach ${box.reach.toFixed(2)})`)
    assert.ok(box.y1 <= airport.top + 1e-3 + 3.4 * LANDMARK_SCALE, 'it is no taller than the label above it expects (or the minimum icon height)')
    assert.ok(apart.triangles < before + 1000, `${before} -> ${apart.triangles}: icons are small`)
    assert.ok(apart.triangles <= BUDGETS.CITY_TRIANGLES.value, 'the city stays inside its triangle budget')
    apart.dispose()
    assert.equal(apart.group.parent, null)
  } finally { baseline.dispose(); apart.dispose(); kit.dispose() }
})

test('an icon with no volume is as good as none: the venue keeps its procedural building', async () => {
  await loadCityContent('lagos')
  const venues = Object.fromEntries(contentFor('lagos').venues.map(venue => [venue.id, venue.definition])), kit = createKit()
  const city = buildCity(kit, pack, buildNetwork(pack), { venues, soon: COMING_SOON, iconVenues: new Set(['airport']) })
  try {
    const before = city.triangles, meshes = named(city.group, 'landmarks-').length
    const flat: PlaceIcon = { position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), normal: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), color: new Float32Array(9).fill(1), index: new Uint32Array([0, 1, 2]), triangles: 1 }
    assert.equal(city.setPlaceIcons({ models: new Map([['airport', flat]]) }), false)
    assert.equal(city.triangles, before); assert.equal(named(city.group, 'landmarks-').length, meshes)
    assert.equal(typeof iconOf, 'function')
  } finally { city.dispose(); kit.dispose() }
})
