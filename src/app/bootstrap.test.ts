import assert from 'node:assert/strict'
import test from 'node:test'
import { initialCity } from './bootstrap.ts'

const known = (id: unknown): boolean => ['lagos', 'ibadan', 'test-city'].includes(String(id))

test('startup loads the saved character city before an older storage key', () => {
  assert.equal(initialCity(JSON.stringify({ cityId: 'lagos', state: { estate: { city: 'test-city' } } }), known), 'test-city')
  assert.equal(initialCity(JSON.stringify({ cityId: 'ibadan' }), known), 'ibadan')
})

test('startup accepts only registered cities and tolerates an unavailable browser cache', () => {
  for (const raw of [null, '', '{broken', 'null', '[]', '5', '{"cityId":"unknown"}', '{"state":{"estate":{"city":5}}}']) {
    assert.equal(initialCity(raw, known), 'lagos')
  }
  assert.equal(initialCity(JSON.stringify({ cityId: 'ibadan', state: { estate: { city: 'unknown' } } }), known), 'ibadan')
})
