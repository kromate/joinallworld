import { loadCityContent as preloadCityContent } from '../cities/registry.ts'
await Promise.all(['lagos', 'jos'].map(preloadCityContent))
// How a power cut and the season change the light of a place (docs/REALISM.md §8): pure presets in, presets out.
import assert from 'node:assert/strict'
import test from 'node:test'
import { CITY_RULES } from '../cities/registry.ts'
import { lagosTime } from '../clock.ts'
import { LIGHTING } from '../../scene/venue-scenes.ts'
import { powerCutsOn } from './conditions.ts'
import { CLEAR_LOOK, adjustLighting, lookAt, lookKey, tint } from './look.ts'

const base = LIGHTING.outdoor.night
const on = { ...CLEAR_LOOK }

test('with nothing going on the preset comes back as it was, and a preset is never changed', () => {
  assert.equal(adjustLighting(base, on), base)
  const before = JSON.stringify(base)
  adjustLighting(base, { outage: true, generator: false, wet: true, harmattan: true })
  assert.equal(JSON.stringify(base), before)
})

test('a power cut darkens the lamps and the glow, a generator keeps most of the light, and the sky does not move', () => {
  const dark = adjustLighting(base, { ...on, outage: true })
  const humming = adjustLighting(base, { ...on, outage: true, generator: true })
  assert.ok(dark.lamps < humming.lamps && humming.lamps < base.lamps)
  assert.ok(dark.glow < humming.glow && humming.glow < base.glow)
  assert.ok(dark.hemi[2] < humming.hemi[2] && humming.hemi[2] < base.hemi[2])
  assert.deepEqual(dark.sky, base.sky)
  assert.deepEqual(adjustLighting(base, { ...on, generator: true }), base, 'a generator on its own changes nothing: it only matters in a cut')
})

test('harmattan hazes the sky and the light; the rains turn them grey-blue; both weaken the sun', () => {
  const hazy = adjustLighting(base, { ...on, harmattan: true }), wet = adjustLighting(base, { ...on, wet: true })
  assert.notDeepEqual(hazy.sky, base.sky); assert.notDeepEqual(wet.sky, base.sky); assert.notDeepEqual(hazy.sky, wet.sky)
  assert.ok(hazy.sun[1] < base.sun[1] && wet.sun[1] < base.sun[1])
  for (const preset of [hazy, wet]) for (const colour of [...preset.sky, preset.hemi[0], preset.hemi[1]]) assert.match(colour, /^#[0-9a-f]{6}$/)
  assert.equal(hazy.lamps, base.lamps)
})

test('tint moves a colour part of the way and leaves a value it cannot read alone', () => {
  assert.equal(tint('#000000', '#ffffff', 0.5), '#808080')
  assert.equal(tint('#102030', '#ffffff', 0), '#102030')
  assert.equal(tint('red', '#ffffff', 0.5), 'red')
})

test('lookAt follows the district\'s power, the venue\'s generator and the city\'s season', () => {
  const climate = CITY_RULES.jos?.climate // Lagos has no climate record of its own yet, so it has no season to show
  assert.ok(climate)
  let cutAt = 0
  for (let day = lagosTime(Date.UTC(2026, 0, 1)).day; !cutAt && day < 400000; day++) { const cut = powerCutsOn('lagos', 'Yaba', day)[0]; if (cut) cutAt = cut.from + 60000 }
  assert.ok(cutAt, 'a cut is found')
  const place = { id: 'cchub', district: 'Yaba' }
  const cut = lookAt('lagos', place, climate, cutAt)
  assert.equal(cut.outage, true); assert.equal(cut.generator, true)
  assert.equal(lookAt('lagos', { ...place, generator: false }, climate, cutAt).generator, false, 'a venue may say it has none')
  assert.equal(lookAt('lagos', { id: 'park', district: 'Yaba' }, climate, cutAt).generator, false)
  assert.equal(lookAt('lagos', { id: 'park' }, climate, cutAt).outage, false, 'no district, no cut')
  assert.equal(lookAt('lagos', null, null, cutAt).wet, false)
  assert.equal(lookAt('jos', null, climate, Date.UTC(2026, 6, 15, 12)).wet, true, 'July is the rains')
  assert.equal(lookAt('jos', null, climate, Date.UTC(2026, 0, 15, 12)).wet, false, 'January is dry')
  assert.equal(lookAt('lagos', null, undefined, Date.UTC(2026, 6, 15, 12)).wet, false, 'a city with no climate has no season')
  assert.equal(lookKey(on), '')
  assert.equal(lookKey({ outage: true, generator: false, wet: true, harmattan: false }), 'ow')
})
