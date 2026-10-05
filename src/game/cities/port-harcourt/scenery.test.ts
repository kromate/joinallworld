import assert from 'node:assert/strict'
import test from 'node:test'
import { fromLocal } from '../../../geo/frame.ts'
import { pointInPart } from '../../../map3d/lga.ts'
import { mangroveSites } from './scenery.ts'
import type { LonLatPolygon } from '../../../types/content.ts'

test('mangrove illustration stays within sourced polygons, excludes holes and is bounded', () => {
  const polygon: LonLatPolygon = [[[7, 4.7], [7.1, 4.7], [7.1, 4.8], [7, 4.8]], [[7.02, 4.72], [7.08, 4.72], [7.08, 4.78], [7.02, 4.78]]]
  const origin = { x: -1065, z: 4648 }, sites = mangroveSites([polygon], origin)
  assert.ok(sites.length > 0 && sites.length <= 96)
  assert.deepEqual(sites, mangroveSites([polygon], origin))
  for (const [x, z] of sites) {
    const point = fromLocal(origin, x, z)
    assert.ok(pointInPart(point.lon, point.lat, polygon))
  }
  assert.deepEqual(mangroveSites([], origin), [], 'no vegetation claim is invented without a source area')
})
