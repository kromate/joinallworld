import assert from 'node:assert/strict'
import test from 'node:test'
import { loadCityContent } from '../game/cities/registry.ts'
import { kanoCity } from '../game/cities/kano/index.ts'
import { createKit } from '../scene/kit.ts'
import { buildCity, CITY_TRIANGLE_BUDGET } from './city-build.ts'
import { flatModel, flatSvg } from './flat.ts'
import { heritageDashes } from './heritage.ts'
import { buildNetwork } from './roads.ts'
import type { CityPack } from './types.ts'

test('historical dashes retain their phase across source vertices without extending the line', () => {
  const lines: NonNullable<CityPack['heritageLines']> = [{ id: 'reference', name: 'Approximate outline', kind: 'historic-wall-alignment', points: [[0, 0], [0.5, 0], [1.5, 0], [2, 0]] }]
  const segments = heritageDashes(lines)
  const length = segments.reduce((sum, segment) => sum + Math.hypot(segment.to[0] - segment.from[0], segment.to[1] - segment.from[1]), 0)
  assert.ok(Math.abs(length - 1.4) < 1e-6)
  assert.ok(segments.every(segment => segment.from[0] >= 0 && segment.to[0] <= 2 && segment.from[1] === 0 && segment.to[1] === 0))
})

test('Kano draws the qualified source alignment in both real renderers, independently of road routing', async () => {
  await loadCityContent('kano')
  const descriptor = await kanoCity.loadMap(), pack = await descriptor.loadScene(), network = buildNetwork(pack)
  const lines = pack.heritageLines
  assert.ok(lines?.length)
  const model = flatModel(pack, network)
  assert.deepEqual(model.heritageLines.map(line => [line.id, line.name]), lines.map(line => [line.id, line.name]))
  const svg = flatSvg(model)
  assert.match(svg, /data-heritage="kano-historic-wall"/)
  assert.match(svg, /stroke-dasharray="0.8 0.6"/)
  assert.match(svg, /Published historic wall outline · approximate/)
  assert.ok(network.roads.every(road => road.id !== 'kano-historic-wall'))
  const kit = createKit(), city = buildCity(kit, pack, network)
  try {
    assert.ok(city.group.getObjectByName('historic-wall-alignments'), 'the actual 3D builder creates the separate overlay mesh')
    assert.ok(city.triangles <= CITY_TRIANGLE_BUDGET)
  } finally {
    city.dispose()
    kit.dispose()
  }
})
