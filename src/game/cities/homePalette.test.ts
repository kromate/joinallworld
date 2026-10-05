import assert from 'node:assert/strict'
import test from 'node:test'
import { cachedCityContent, loadCityContent } from './registry.ts'
import { ROOM_PALETTE } from '../../scene/home-scene.ts'
import { createLife, viewLife } from '../../life.ts'
import { cleanStyle } from '../content/world.ts'

const OTHERS = ['ibadan', 'abeokuta', 'ota', 'ijebu-ode', 'sagamu'] as const
await Promise.all(['lagos', ...OTHERS].map((id) => loadCityContent(id)))
const HEX = /^#[0-9a-f]{6}$/
const paletteOf = (id: string) => cachedCityContent(id)?.homePalette

test('Lagos keeps the shared room colours; every other open city has a palette of its own', () => {
  assert.equal(paletteOf('lagos'), undefined, 'Lagos names none, so the shared colours draw its rooms')
  const seen = new Set<string>([JSON.stringify(ROOM_PALETTE)])
  for (const id of OTHERS) {
    const palette = paletteOf(id)
    assert.ok(palette, id)
    for (const colour of [palette.back, palette.left, ...palette.floor]) assert.match(colour, HEX, `${id}: ${colour}`)
    assert.ok(!seen.has(JSON.stringify(palette)), `${id} differs from the others and from Lagos`)
    seen.add(JSON.stringify(palette))
  }
})

test('the palette is city data only: stored house styles are untouched and a life reads the same', () => {
  const style = cleanStyle({ wall: 3, roof: 2 })
  assert.deepEqual(style, cleanStyle(JSON.parse(JSON.stringify(style))))
  for (const id of ['lagos', ...OTHERS]) {
    const life = createLife({}, { cityId: id })
    assert.deepEqual(life.estate.style, cleanStyle(life.estate.style), id)
    assert.equal('homePalette' in viewLife(life).estate, false, 'nothing about the palette enters the view')
  }
})
