import test from 'node:test'
import assert from 'node:assert/strict'
import { reliefAt, reliefNormal } from './relief.ts'
import { extentWord } from './labels.ts'
import { placeLabels } from './geo/labels.ts'
import { IBADAN_LANDMARK_POINTS } from '../game/cities/ibadan/landmarks.ts'
import { IBADAN_CHARACTER } from '../game/cities/ibadan/character.ts'
import { IBADAN_ROADS } from '../game/cities/ibadan/roads.ts'

test('relief: a hill is highest at its centre, falls to nothing at its rim, and a pack without hills is flat', () => {
  const hills = [{ name: 'h', x: 10, z: 10, r: 8, h: 1 }]
  assert.equal(reliefAt(undefined, 1, 1), 0)
  assert.ok(Math.abs(reliefAt(hills, 10, 10) - 1) < 1e-9)
  assert.equal(reliefAt(hills, 18, 10), 0)
  assert.ok(reliefAt(hills, 14, 10) > 0 && reliefAt(hills, 14, 10) < 1)
  const [nx, ny] = reliefNormal(hills, 14, 10)
  assert.ok(nx > 0 && ny > 0, 'the slope faces away from the crest')
})

test('the whole-extent button is named by the pack: a metropolitan area is a city, a state with surroundings a state', () => {
  assert.equal(extentWord({ extent: 'city', context: {} }), 'city')
  assert.equal(extentWord({ context: {} }), 'state')
  assert.equal(extentWord({}), 'city')
  assert.equal(IBADAN_CHARACTER.extent, 'city')
})

test('atlas labels: a marker that would overlap tries its other anchors before it gives way', () => {
  const base = { priority: 1000, size: 13, fixed: true, text: 'Ibadan', anchor: 'above' as const }
  const placed = placeLabels([
    { id: 'a', x: 200, y: 200, ...base },
    { id: 'b', x: 200, y: 215, priority: 90, size: 13, text: 'Abeokuta', anchor: 'above', alts: ['right', 'below', 'far-below'] },
  ], { width: 600, height: 600 })
  const b = placed.find((label) => label.id === 'b')
  assert.ok(b, 'the second marker is shown')
  assert.notEqual(b.anchor, 'above')
})

test('Orita Challenge stands at the junction of Challenge Road, the expressway and Ring Road in the bundled roads', () => {
  const point = IBADAN_LANDMARK_POINTS.find((item) => item.id === 'challenge-interchange')!
  const ends: [number, number][] = []
  for (const [name, , x0, y0, ...steps] of IBADAN_ROADS as [string, number, number, number, ...number[]][]) {
    if (!['Challenge Road', 'Ring Road', 'A1'].includes(name)) continue
    ends.push([x0 / 1e4, y0 / 1e4]); let x = x0, y = y0
    for (let i = 0; i + 1 < steps.length; i += 2) { x += steps[i]!; y += steps[i + 1]! }
    ends.push([x / 1e4, y / 1e4])
  }
  const near = ends.filter(([lon, lat]) => Math.hypot((lon - point.lon) * 110.3, (lat - point.lat) * 110.6) < 0.15)
  assert.ok(near.length >= 6, `${near.length} road ends within 150 m of the point`)
})

test('the Ibadan character data names real places: hills, areas, water and a railway with its station', () => {
  assert.ok((IBADAN_CHARACTER.hills ?? []).length >= 5)
  assert.ok((IBADAN_CHARACTER.areas ?? []).some((area) => area.tone === 'old') && (IBADAN_CHARACTER.areas ?? []).some((area) => area.tone === 'planned'))
  assert.ok((IBADAN_CHARACTER.waters ?? []).some((water) => water.kind === 'lake') && (IBADAN_CHARACTER.waters ?? []).some((water) => water.kind === 'river'))
  assert.equal(IBADAN_CHARACTER.rails?.[0]?.stations.length, 1)
})
