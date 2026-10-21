// OWNER: scenes (unique places) — every venue of the cities that have place models builds inside the shared triangle and draw-call budgets with a full crowd
// when its model cannot be fetched (no server here): the fallback is the scene as it was, the hero is back, and nothing throws.
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import test from 'node:test'
import { SCENE_TRIANGLES, SCENE_DRAW_CALLS } from '../../budgets.ts'
import { loadCityContent } from '../../game/cities/registry.ts'
import { createKit } from '../kit.ts'
import { loadCityScenes } from '../city-scenes.ts'
import { buildVenueScene, MAX_CROWD } from '../venue-scenes.ts'
import { sceneVenue } from '../../venue-world.ts'
import { awaitNativeSceneGeometry, installNativeGeometryEnvironment, preloadNativeGeometry } from '../../testing/nativeGeometry.test-fixture.ts'

const cities = readdirSync(new URL('../../../scripts/places/manifest/', import.meta.url)).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5))

test('venues of cities with place models stay inside the shared budgets, with the model unreachable (fallback)', async () => {
  const restore = installNativeGeometryEnvironment(), kit = createKit()
  const crowd = Array.from({ length: MAX_CROWD }, (_, index) => ({ id: `visitor-${index}`, name: 'Visitor', kind: 'player' }))
  try {
    await preloadNativeGeometry()
    for (const id of cities) {
      await loadCityScenes(id)
      for (const venue of (await loadCityContent(id)).venues) {
        if (venue.kind === 'home' || venue.kind === 'unilag') continue
        const definition = sceneVenue(venue.id, id)
        const scene = buildVenueScene(kit, definition!, id)
        try {
          scene.setCrowd(crowd)
          const readiness = await awaitNativeSceneGeometry(scene, `${id}.${venue.id}`)
          assert.deepEqual(readiness.errors, [])
          await new Promise(resolve => setTimeout(resolve, 30))
          const stats = scene.stats()
          assert.ok(stats.triangles <= SCENE_TRIANGLES.value, `${id}.${venue.id}: ${stats.triangles} triangles`)
          assert.ok(stats.drawCalls <= SCENE_DRAW_CALLS.value, `${id}.${venue.id}: ${stats.drawCalls} draw calls`)
          const status = scene.group.userData.placeModelStatus
          if (id === 'abuja' && venue.id === 'airport') assert.equal(status, 'failed', `abuja airport tried its model: ${String(scene.group.userData.placeModelError)}`)
        } finally { scene.dispose() }
      }
    }
  } finally { kit.dispose(); restore() }
})
