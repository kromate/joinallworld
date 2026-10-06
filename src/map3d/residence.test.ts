// OWNER: world — the location-confirmed check against the real boundaries: inside, the border band, far outside, a neighbouring
// local government, another city and another country; the accuracy rules. Pure maths, no browser.
import test from 'node:test'
import assert from 'node:assert/strict'
import lagos from './cities/lagos.ts'
import { ibadanCity } from '../game/cities/ibadan/index.ts'
import { createModulePack } from './cities/module.ts'
import { fromLocal } from './geo/frame.ts'
import { partsOf } from './lga.ts'
import { BORDER_TOLERANCE_M, MAX_ACCURACY_M, confirms, judgeResidence, metresOutside } from './residence.ts'

const ibadan = await createModulePack(ibadanCity)
const ikeja = lagos.lgas.find((lga) => lga.id === 'ikeja')!
const origin = lagos.frame!.origin
const at = (x: number, z: number) => fromLocal(origin, x, z)
const centre = (lga: { polygon: readonly (readonly [number, number])[] }): [number, number] => {
  let x = 0, z = 0
  for (const [px, pz] of lga.polygon) { x += px; z += pz }
  return [x / lga.polygon.length, z / lga.polygon.length]
}
/** A point `metres` outside Ikeja: from the outer-ring vertex furthest from the centre, straight away from the centre. */
function outsideBy(metres: number) {
  const [cx, cz] = centre(ikeja)
  const ring = partsOf(ikeja)[0]![0]!
  const [vx, vz] = ring.reduce((far, point) => (Math.hypot(point[0] - cx, point[1] - cz) > Math.hypot(far[0] - cx, far[1] - cz) ? point : far))
  const length = Math.hypot(vx - cx, vz - cz), step = metres / 100
  return at(vx + ((vx - cx) / length) * step, vz + ((vz - cz) / length) * step)
}

test('a point well inside Ikeja is inside, with a good fix', () => {
  const [cx, cz] = centre(ikeja)
  const p = at(cx, cz)
  assert.equal(judgeResidence(lagos, 'ikeja', p.lat, p.lon, 30), 'inside')
  assert.equal(judgeResidence(lagos, 'ikeja', 6.6018, 3.3515, 30), 'inside', 'the middle of Ikeja town')
  assert.ok(confirms('inside') && confirms('near') && !confirms('outside') && !confirms('inaccurate'))
})

test('near the border: inside the tolerance band confirms, beyond it does not', () => {
  assert.equal(BORDER_TOLERANCE_M, 1500)
  const close = outsideBy(600), band = outsideBy(1300), beyond = outsideBy(2500)
  assert.equal(judgeResidence(lagos, 'ikeja', close.lat, close.lon, 20), 'near')
  assert.equal(judgeResidence(lagos, 'ikeja', band.lat, band.lon, 20), 'near')
  assert.equal(judgeResidence(lagos, 'ikeja', beyond.lat, beyond.lon, 20), 'outside')
})

test('the accuracy circle: a fix whose circle overlaps the area confirms; a precise one does not; a vague one is refused', () => {
  const far = outsideBy(3000)
  assert.equal(judgeResidence(lagos, 'ikeja', far.lat, far.lon, 20), 'outside')
  assert.equal(judgeResidence(lagos, 'ikeja', far.lat, far.lon, 3500), 'near', 'the circle reaches the boundary')
  assert.equal(judgeResidence(lagos, 'ikeja', far.lat, far.lon, 2000), 'outside', 'the circle falls short')
  const inside = at(...centre(ikeja))
  assert.equal(MAX_ACCURACY_M, 5000)
  assert.equal(judgeResidence(lagos, 'ikeja', inside.lat, inside.lon, 5001), 'inaccurate', 'worse than 5 km is never used, even inside')
  assert.equal(judgeResidence(lagos, 'ikeja', inside.lat, inside.lon, 5000), 'inside')
  for (const bad of [Number.NaN, -1, Infinity]) assert.equal(judgeResidence(lagos, 'ikeja', inside.lat, inside.lon, bad), 'inaccurate')
})

test('a neighbouring local government, another city and another country are outside', () => {
  const agege = lagos.lgas.find((lga) => lga.id === 'agege')!
  const [ax, az] = centre(agege), a = at(ax, az)
  assert.equal(judgeResidence(lagos, 'agege', a.lat, a.lon, 30), 'inside')
  assert.ok((metresOutside(lagos, 'ikeja', ax, az) ?? 0) > BORDER_TOLERANCE_M)
  assert.equal(judgeResidence(lagos, 'ikeja', a.lat, a.lon, 30), 'outside', 'in Agege, not Ikeja')
  const ib = ibadan.lgas[0]!
  assert.equal(judgeResidence(lagos, 'ikeja', 7.3775, 3.947, 30), 'outside', 'Ibadan, checked against Ikeja')
  assert.equal(judgeResidence(ibadan, ib.id, 6.6018, 3.3515, 30), 'outside', 'Ikeja, checked against an Ibadan local government')
  assert.equal(judgeResidence(lagos, 'ikeja', 51.5072, -0.1276, 30), 'outside', 'London')
  assert.equal(judgeResidence(lagos, 'ikeja', 0, 0, 30), 'outside')
  assert.equal(judgeResidence(lagos, 'no-such-area', 6.6018, 3.3515, 30), 'outside')
  assert.equal(judgeResidence(lagos, 'ikeja', Number.NaN, 3.3, 30), 'outside')
  assert.equal(judgeResidence(lagos, 'ikeja', 95, 3.3, 30), 'outside')
  assert.equal(judgeResidence(null, 'ikeja', 6.6, 3.35, 30), 'outside')
})
