// The roof and awning heightmap (cover.ts): what counts as cover, the grid, the recorder that sits in a venue's batch chain.
import test from 'node:test'
import assert from 'node:assert/strict'
import { CAP, CELL, coverFromBoxes, coverFromBuildings, createCover } from './cover.ts'
import { coverRecorder, isCover } from '../roof-record.ts'
import type { Box6 } from '../roof-record.ts'
import type { Batch } from '../types.ts'
import { underCover } from './rain-plan.ts'

test('an awning above head height is cover; walls, low tables and tiny shelves are not', () => {
  assert.equal(isCover([0, 3.1, 0, 4.8, 3.5, 3.4]), true, 'awning')
  assert.equal(isCover([0, 0, 0, 4, 2.5, 4]), false, 'a wall-high block is not a slab above the head')
  assert.equal(isCover([0, 1, 0, 3, 1.1, 3]), false, 'a table top is below head height')
  assert.equal(isCover([0, 3, 0, 1, 3.1, 1]), false, 'too small')
})

test('a roof over a rectangle covers the cells under it, and the sky stays open outside', () => {
  const cover = createCover([-30, -30, 30, 30])
  cover.add(-6, -3, 6, 3, 6)
  assert.equal(cover.empty, false)
  assert.ok(Math.abs(cover.heightAt(0, 0) - 6) < CAP / 255 + 1e-9, 'under the roof')
  assert.equal(cover.heightAt(0, 10), 0, 'beside it')
  assert.equal(cover.heightAt(20, 0), 0)
  assert.equal(cover.heightAt(500, 500), 0, 'outside the grid the sky is open')
  assert.equal(cover.inside(500, 500), false)
})

test('a drop under the roof is covered, a drop above it or beside it is not', () => {
  const cover = coverFromBoxes([[-6, 5.9, -3, 6, 6.4, 3]], [-30, -30, 30, 30])
  assert.equal(underCover(cover, 0, 2, 0), true)
  assert.equal(underCover(cover, 0, 5, 0), true)
  assert.equal(underCover(cover, 0, 12, 0), false, 'above the roof it is still raining')
  assert.equal(underCover(cover, 12, 2, 0), false, 'beside the roof')
  assert.equal(underCover(null, 0, 2, 0), false, 'no cover at all')
})

test('the higher of two roofs wins, and a roof smaller than a cell still covers its cell', () => {
  const cover = createCover([0, 0, 30, 30])
  cover.add(0, 0, 10, 10, 4)
  cover.add(0, 0, 10, 10, 8)
  cover.add(0, 0, 10, 10, 3)
  assert.ok(Math.abs(cover.heightAt(5, 5) - 8) < 0.2)
  cover.add(20.2, 20.2, 20.4, 20.4, 5)
  assert.ok(cover.heightAt(20.3, 20.3) > 4.5)
})

test('the grid is never wider than 256 cells: a long street gets bigger cells', () => {
  const cover = createCover([-300, -20, 300, 20])
  assert.ok(cover.cols <= 256 && cover.rows <= 256)
  assert.ok(cover.cell >= CELL)
  cover.add(100, -5, 110, 5, 7)
  assert.ok(cover.heightAt(105, 0) > 6)
})

test('buildings that run from the ground are cover from the roof down', () => {
  const house: Box6 = [10, 0, 0, 20, 7, 8]
  assert.equal(coverFromBoxes([house], [0, -10, 40, 20]).empty, true, 'a ground box is not a slab')
  const cover = coverFromBuildings([house, [0, 0, 0, 0.3, 1.5, 6]], [0, -10, 40, 20])
  assert.ok(cover.heightAt(15, 4) > 6.5)
  assert.equal(cover.heightAt(30, 4), 0)
  assert.equal(cover.heightAt(0.1, 3), 0, 'a fence post is not a roof')
})

/** A batch that records what it was asked to draw, in a frame that can be moved with at(). */
function stubBatch(): { batch: Batch; calls: string[] } {
  const calls: string[] = []
  let ox = 0, oy = 0, oz = 0
  const batch = {
    isBatch: true,
    geometry() { calls.push('geometry'); return batch },
    box() { calls.push('box'); return batch }, cyl() { calls.push('cyl'); return batch }, cone() { calls.push('cone'); return batch },
    ball() { calls.push('ball'); return batch }, ico() { calls.push('ico'); return batch }, quad() { calls.push('quad'); return batch }, disc() { calls.push('disc'); return batch },
    at(x: number, y: number, z: number, _ry: number, draw: (b: Batch) => void) { const was = [ox, oy, oz]; ox += x; oy += y; oz += z; draw(batch); [ox, oy, oz] = was as [number, number, number]; calls.push('at'); return batch },
    light() { return batch },
    world: (x: number, y: number, z: number) => ({ x: x + ox, y: y + oy, z: z + oz }),
    triangles: 0,
    build: () => ({}) as never,
  } as unknown as Batch
  return { batch, calls }
}

test('the recorder passes every call on and notes only the awnings, in venue coordinates', () => {
  const { batch: inner, calls } = stubBatch()
  const recorder = coverRecorder(inner), b = recorder.batch
  b.box(0, 0.5, 0, 2, 1, 2, '#fff')
  b.box(0, 3.3, 0, 4, 0.1, 2.3, '#f00', { rx: 0.2 })
  b.at(10, 0, 5, 0, () => { b.box(0, 3.4, 0, 3, 0.1, 3, '#0f0') })
  b.ball(0, 5, 0, 1, 1, 1, '#000')
  assert.deepEqual(calls, ['box', 'box', 'box', 'at', 'ball'])
  const boxes = recorder.boxes()
  assert.equal(boxes.length, 2)
  assert.ok(boxes[1]![0] > 8 && boxes[1]![3] < 12 && boxes[1]![2] > 3, 'the second awning is where the frame put it')
  const cover = coverFromBoxes(boxes, [-20, -20, 20, 20])
  assert.ok(cover.heightAt(10, 5) > 3, 'covered under the moved awning')
  assert.equal(cover.heightAt(-10, 5), 0)
})
