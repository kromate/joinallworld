/** Storage boundary: practice cursors must remain per actor, lossless across layout changes. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Layer, assembleText, markerIds, splitText } from '../keyed.ts'
import { MemoryLayers } from '../keyed-memory.ts'
import { createDriving } from '../../src/game/living-world/driving.ts'
import { PRACTICE_COURSE } from '../../src/game/living-world/course.ts'

test('livingWorld saves split losslessly and one actor update writes only its entry', () => {
  const saved = { v: 1, driving: { ada: { revision: 1, state: createDriving(PRACTICE_COURSE) }, bola: { revision: 7, state: createDriving(PRACTICE_COURSE) } }, future: { preserve: 'old saves and unknown extensions' } }
  const text = JSON.stringify(saved), split = splitText('livingWorld', text)
  assert.deepEqual(markerIds(split.rootText), ['driving'])
  assert.equal(assembleText(split.rootText, id => split.maps.find(map => map.id === id)?.entries ?? []), text)
  const layers = new MemoryLayers()
  layers.ingest('livingWorld', text)
  const layer = new Layer(layers)
  const view = layer.get('livingWorld') as typeof saved
  view.driving.ada.revision++
  view.driving.ada.state.position.z = 0.03
  const changes = layer.changes()
  assert.equal(changes.length, 1)
  assert.equal(changes[0]?.root, null, 'large root is not rewritten')
  assert.deepEqual(changes[0]?.maps.map(map => [map.id, map.puts.map(put => put.key), map.deletes]), [['driving', ['ada'], []]])
  const undo = layers.apply(changes)
  const committed = JSON.parse(layers.text('livingWorld')!) as typeof saved
  assert.deepEqual(committed.driving.bola, saved.driving.bola)
  assert.deepEqual(committed.future, saved.future)
  assert.equal(committed.driving.ada.revision, 2)
  for (let i = undo.length - 1; i >= 0; i--) undo[i]?.()
  assert.equal(layers.text('livingWorld'), text, 'failed commit can restore the exact previous save')
  const restarted = new MemoryLayers()
  restarted.ingest('livingWorld', JSON.stringify(committed))
  assert.deepEqual(JSON.parse(restarted.text('livingWorld')!), committed)
})

test('adding a qualification preserves existing driving and future fields; claim writes only its actor entry', () => {
  const saved = { driving: { ada: { revision: 3 }, bola: { revision: 8 } }, qualifications: {}, future: { keep: true } }
  const text = JSON.stringify(saved), split = splitText('livingWorld', text)
  assert.deepEqual(markerIds(split.rootText), ['driving', 'qualifications'])
  assert.equal(assembleText(split.rootText, id => split.maps.find(map => map.id === id)?.entries ?? []), text)
  const layers = new MemoryLayers(); layers.ingest('livingWorld', text)
  const layer = new Layer(layers)
  const view = layer.get('livingWorld') as { qualifications: Record<string, unknown> }
  Object.defineProperty(view.qualifications, 'ada', { value: { v: 1, publicId: 'ada', qualification: { id: 'district-driving', version: 1, evidenceJourneyId: 'passed-journey', earnedAt: 100, status: 'active' }, courseId: PRACTICE_COURSE.id, courseVersion: PRACTICE_COURSE.version, cityId: 'lagos' }, enumerable: true, configurable: true, writable: true })
  const changes = layer.changes()
  assert.deepEqual(changes.map(change => [change.root, change.maps.map(map => [map.id, map.puts.map(put => put.key), map.deletes])]), [[null, [['qualifications', ['ada'], []]]]])
  const undo = layers.apply(changes)
  const committed = JSON.parse(layers.text('livingWorld')!) as typeof saved
  assert.deepEqual([committed.driving, committed.future], [saved.driving, saved.future])
  const restarted = new MemoryLayers(); restarted.ingest('livingWorld', JSON.stringify(committed))
  assert.deepEqual(JSON.parse(restarted.text('livingWorld')!), committed)
  for (let i = undo.length - 1; i >= 0; i--) undo[i]?.()
  assert.equal(layers.text('livingWorld'), text, 'failed claim restores the exact prior layout')
})
