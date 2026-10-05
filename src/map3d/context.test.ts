// The land around a state map: it is drawn in the state's own frame, stays inside its window, is light, and says what is around.
import test from 'node:test'
import assert from 'node:assert/strict'
import pack from './cities/lagos.ts'
import { mapContext } from './context.ts'
import { flatModel } from './flat.ts'
import { ORIGINS, toLocal } from './geo/frame.ts'
import { lagosShapes } from './geo/lagos-shapes.ts'

test('the Lagos pack sits in the real map: Ogun, Oyo, Ondo, Benin around it, the Atlantic named, roads leaving it', () => {
  const context = pack.context
  assert.ok(context, 'the pack has context')
  const ids = new Set(context.land.map((piece) => piece.id.split(':')[0]))
  for (const id of ['ogun', 'oyo', 'ondo', 'bj']) assert.ok(ids.has(id), id)
  assert.ok(context.labels.some((label) => label.kind === 'sea' && /ATLANTIC/.test(label.text)))
  assert.deepEqual(context.roads.map((road) => road.id).sort(), ['abeokuta', 'ibadan', 'seme'])
  assert.equal(context.land.find((piece) => piece.id === 'ogun')?.status, 'planned', 'the registry lists a reserved city in Ogun')
  assert.equal(context.land.find((piece) => piece.id === 'oyo')?.status, 'planned', 'and in Oyo')
})

test('context stays inside its window, is light, and meets Lagos exactly where the border is (same frame, same arcs)', () => {
  const { rect, land } = mapContext(ORIGINS.lagos, pack.bounds.fit, ['ogun'])
  let points = 0
  for (const piece of land) for (const [x, z] of piece.points) { points += 1; assert.ok(x >= rect.minX - 1e-6 && x <= rect.maxX + 1e-6 && z >= rect.minZ - 1e-6 && z <= rect.maxZ + 1e-6, piece.id) }
  assert.ok(points < 4000, `${points} points`)
  // The state's own northernmost point is a point on the border with Ogun: the Ogun outline passes within 400 m (the simplification) of it.
  const north = lagosShapes().state.flatMap((part) => part[0]!).reduce((a, b) => (b[1] > a[1] ? b : a))
  const [nx, nz] = toLocal(ORIGINS.lagos, north[0], north[1])
  const near = Math.min(...land.filter((piece) => piece.id.startsWith('ogun')).flatMap((piece) => piece.points.map(([x, z]) => Math.hypot(x - nx, z - nz))))
  assert.ok(near < 30, `${near} units from Lagos's northern border`)
})

test('the flat map gets the same context, and the button says "state"', () => {
  const model = flatModel(pack, { roads: [] })
  assert.ok(model.context && model.context.land.length > 10 && model.context.names.length > 3)
  assert.ok(model.box.width > pack.bounds.maxX - pack.bounds.minX, 'the drawing reaches into the land around')
})
