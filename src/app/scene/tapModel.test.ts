import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyTap, nearestSpot, placeCard, wentSomewhere } from './tapModel.ts'

const scene = { spots: [{ id: 'bar', px: 100, py: 100 }, { id: 'stage', px: 300, py: 120 }], things: [{ id: 'table:a', px: 200, py: 200 }], people: [{ id: 'npc:ada', px: 105, py: 110 }] }

test('a person beats a spot under the same finger', () => {
  assert.deepEqual(classifyTap(scene, { x: 103, y: 105 }).kind, 'person')
})
test('a tap near a spot is on the spot, and the closest spot wins', () => {
  const hit = classifyTap({ spots: scene.spots }, { x: 110, y: 100 })
  assert.equal(hit.kind, 'spot'); assert.equal(hit.id, 'bar')
})
test('a game table is a thing', () => { assert.equal(classifyTap(scene, { x: 210, y: 205 }).kind, 'thing') })
test('bare ground is none', () => { assert.equal(classifyTap(scene, { x: 500, y: 500 }).kind, 'none') })
test('a scene with nothing in it is none', () => { assert.equal(classifyTap({}, { x: 1, y: 1 }).kind, 'none') })
test('nearestSpot finds the closest or null', () => {
  assert.equal(nearestSpot(scene.spots, { x: 280, y: 90 })?.id, 'stage')
  assert.equal(nearestSpot([], { x: 0, y: 0 }), null)
  assert.equal(nearestSpot(undefined, { x: 0, y: 0 }), null)
})
test('wentSomewhere: walking or moved', () => {
  assert.equal(wentSomewhere({ x: 0, z: 0 }, { x: 0, z: 0, moving: false }), false)
  assert.equal(wentSomewhere({ x: 0, z: 0 }, { x: 0, z: 0, moving: true }), true)
  assert.equal(wentSomewhere({ x: 0, z: 0 }, { x: 0.5, z: 0, moving: false }), true)
})
test('placeCard keeps the card inside the box and above the point when it can', () => {
  const up = placeCard({ x: 200, y: 300 }, { w: 200, h: 100 }, { w: 800, h: 600 })
  assert.deepEqual(up, { x: 100, y: 174 })
  const edge = placeCard({ x: 5, y: 40 }, { w: 200, h: 100 }, { w: 800, h: 600 })
  assert.equal(edge.x, 8); assert.equal(edge.y, 66)
  const right = placeCard({ x: 790, y: 300 }, { w: 200, h: 100 }, { w: 800, h: 600 })
  assert.equal(right.x, 592)
})
