import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { BUILDINGS } from './layout-appearance.ts'
import { BUILDINGS as FOOTPRINTS, ANCHORS, ZONES, ROADS, ENTRANCE } from './layout.ts'
import { footprintOf } from './walk.ts'

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(record).sort().map(key => [key, canonical(record[key])]))
  }
  return value
}

test('lazy appearance restores the accepted complete campus layout without changing navigation', () => {
  const hash = createHash('sha256').update(JSON.stringify(canonical({ BUILDINGS, ANCHORS, ZONES, ROADS, ENTRANCE }))).digest('hex')
  assert.equal(hash, 'fa0e8be77c203b49afddf9ab3a016dbcea40ce7906a6d56df26793d4b9cc74f7')
  assert.equal(BUILDINGS.length, FOOTPRINTS.length)
  for (const full of BUILDINGS) {
    const footprint = FOOTPRINTS.find(item => item.id === full.id)
    assert.ok(footprint)
    assert.deepEqual(footprintOf(full), footprintOf(footprint), full.id)
    for (const field of ['h', 'color', 'confidence', 'source']) assert.equal(Object.hasOwn(footprint, field), false, `${full.id}.${field} stays lazy`)
  }
})
