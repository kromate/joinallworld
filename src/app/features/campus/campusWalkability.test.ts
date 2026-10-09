import assert from 'node:assert/strict'
import { test } from 'node:test'
import { campusWalkReason } from './campusWalkability.ts'

test('walk controls distinguish authored campus anchors from visible but unmapped content spots', () => {
  assert.equal(campusWalkReason('library'), '')
  assert.equal(campusWalkReason('cafeteria', 'Find New Hall'), 'The current campus map has no walkable anchor for Find New Hall.')
  assert.equal(campusWalkReason('fagunwa-hall'), 'The current campus map has no walkable anchor for Fagunwa Hall.')
})

test('unknown saved spots cannot inherit an anchor from the object prototype', () => {
  assert.notEqual(campusWalkReason('constructor'), '')
  assert.notEqual(campusWalkReason('__proto__'), '')
})
