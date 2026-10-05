// OWNER: shell — the start-up view after a reload (./viewMemory.ts): pure decisions and the storage round trip.
import test from 'node:test'
import assert from 'node:assert/strict'
import { CAMERA_FRAME } from './cameraFrame.ts'
import { FRAME_LAT, FRAME_LON, UNITS_PER_KM } from '../../map3d/geo/frame.ts'
import { decideView, forgetViews, keepView, loadView, savedViewFrom } from './viewMemory.ts'
import type { LifeFacts, SavedView } from './viewMemory.ts'

const facts = (extra: Partial<LifeFacts> = {}): LifeFacts => ({ who: 'p1:lagos', location: 'park', trip: false, allowsMode: (mode) => mode === 'map' || mode === 'buy', allowsSheet: () => true, ...extra })
const saved = (extra: Partial<SavedView> = {}): SavedView => ({ v: 1, who: 'p1:lagos', at: 'park', mode: 'map', layer: 'city', destination: 'library', sheet: null, camera: { kind: '3d', x: 10, z: -4, yaw: 0.3, pitch: 0.9, distance: 80 }, frame: CAMERA_FRAME, ...extra })

test('in the map when the page was reloaded: still the map, the same picked place and camera', () => {
  const view = decideView(JSON.parse(JSON.stringify(saved())), facts())
  assert.deepEqual([view.mode, view.layer, view.destination, view.camera?.kind, view.restored], ['map', 'city', 'library', '3d', true])
})
test('nothing saved, or saved for another life: the venue, as the server places the player', () => {
  assert.equal(decideView(null, facts()).mode, 'venue')
  assert.equal(decideView(saved({ who: 'p2:lagos' }), facts()).mode, 'venue')
  assert.equal(decideView('junk', facts()).restored, false)
  assert.equal(decideView({ v: 2 }, facts()).mode, 'venue')
})
test('a view that names a place the player is no longer in is ignored', () => {
  const view = decideView(saved({ at: 'home', mode: 'buy' }), facts({ location: 'park' }))
  assert.deepEqual([view.mode, view.camera, view.restored], ['venue', null, false])
})
test('at a venue with a phone app open: the venue, and the app is opened again when it is still allowed', () => {
  const sheet = { kind: 'panel', id: 'jobs' } as const
  assert.deepEqual(decideView(saved({ mode: 'venue', sheet }), facts()).sheet, sheet)
  assert.equal(decideView(saved({ mode: 'venue', sheet }), facts({ allowsSheet: () => false })).sheet, null)
})
test('a running trip is shown on the map, with the camera left to the trip', () => {
  const view = decideView(saved(), facts({ trip: true }))
  assert.deepEqual([view.mode, view.camera, view.destination], ['map', null, 'library'])
  assert.equal(decideView(saved({ mode: 'venue' }), facts({ trip: true })).mode, 'map', 'also when the page was looking at the venue when the trip set off')
  assert.equal(decideView(null, facts({ trip: true })).mode, 'map')
})
test('a mode this build cannot open falls back to the venue; the camera and layer belong to the map only', () => {
  assert.equal(decideView(saved({ mode: 'lava' }), facts()).mode, 'venue')
  const home = decideView(saved({ mode: 'buy', layer: 'world', destination: 'x' }), facts())
  assert.deepEqual([home.mode, home.layer, home.destination, home.camera], ['buy', 'city', null, null])
  assert.equal(decideView(saved({ layer: 'world' }), facts()).layer, 'world')
})
test('hostile records are dropped part by part', () => {
  assert.equal(savedViewFrom({ v: 1, who: 'a', at: '<script>', mode: 'map' }), null)
  assert.equal(savedViewFrom({ v: 1, who: 'a', at: 'park', mode: 'map', camera: { kind: '3d', x: 'a' }, sheet: { kind: 'panel', id: '../x' } })?.camera, null)
  assert.equal(savedViewFrom({ v: 1, who: 'a', at: 'park', mode: 'map', sheet: { kind: 'panel', id: '../x' } })?.sheet, null)
})
test('the tab keeps its own record; a new tab of the same player finds the player\'s; a sign-out forgets both', () => {
  const memory = (): Storage => { const items = new Map<string, string>(); return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value) }, removeItem: (key: string) => { items.delete(key) } } as unknown as Storage }
  const tab = memory(), device = memory()
  keepView(saved(), tab, device)
  assert.equal(savedViewFrom(loadView('p1:lagos', tab, device))?.mode, 'map')
  assert.equal(savedViewFrom(loadView('p1:lagos', memory(), device))?.mode, 'map', 'a new tab')
  assert.equal(loadView('p2:lagos', tab, device), null, 'another player sees nothing of it')
  forgetViews(tab, device, 'p1:lagos')
  assert.equal(loadView('p1:lagos', tab, device), null)
})

test('a camera kept in another map frame, or before frames were named, is dropped; the rest of the view is kept', () => {
  for (const frame of [undefined, 'nigeria-frame:old', '']) {
    const old = { ...saved(), ...(frame === undefined ? {} : { frame }) } as Record<string, unknown>
    if (frame === undefined) delete old.frame
    const view = decideView(JSON.parse(JSON.stringify(old)), facts())
    assert.deepEqual([view.mode, view.destination, view.camera], ['map', 'library', null], String(frame))
  }
  assert.equal(decideView(saved(), facts()).camera?.kind, '3d')
})

test('the camera frame names the map frame it stands for', () => {
  assert.ok(CAMERA_FRAME.startsWith(`nigeria-frame:${FRAME_LON},${FRAME_LAT},${UNITS_PER_KM}:`))
})
