import { GLASS } from './build.ts'
import type { FootprintShapes, WalkRect } from './movement.ts'
import { bench, lampPost, leafTree, landmark as sceneLandmark, plant, room, rug, sign, signBoard, stall } from './props.ts'
import type { Batch, Colour, SceneContext, SceneLayout } from './types.ts'
import type { ParametricLandmark, ParametricRoofStyle, ParametricVenueDesign, ParametricVenueProp } from '../types/content.ts'
import { boulder, fit, plain } from './venues-common.ts'

interface DecorationContext {
  batch: Batch
  context: SceneContext
  layout: SceneLayout
  footprints: FootprintShapes
  indoor: boolean
}

interface Point { x: number; z: number }

const HALF = Math.PI / 2

function overlaps([x0, z0, x1, z1]: WalkRect, point: Point, radius: number): boolean {
  return point.x + radius > x0 && point.x - radius < x1 && point.z + radius > z0 && point.z - radius < z1
}

function free(point: Point, radius: number, layout: SceneLayout, footprints: FootprintShapes): boolean {
  if (footprints.block.some((shape) => overlaps(shape, point, radius))) return false
  return (layout.spots ?? []).every((spot) => Math.hypot(spot.x - point.x, spot.z - point.z) > radius + 2.2)
}

function propRadius(prop: ParametricVenueProp): number {
  switch (prop) {
    case 'tree': return 1.4
    case 'stall': return 2.1
    case 'bench': return 1.7
    case 'planter': return 0.8
    case 'lamp': return 0.7
  }
}

function drawProp(batch: Batch, prop: ParametricVenueProp, point: Point, palette: ParametricVenueDesign['palette']): void {
  switch (prop) {
    case 'tree': leafTree(batch, point.x, point.z, { s: 0.9, tone: 1 }); return
    case 'bench': bench(batch, point.x, point.z, { w: 2.6, ry: HALF, back: true, color: palette.wall, leg: palette.roof }); return
    case 'planter': plant(batch, point.x, point.z, { s: 1.1, pot: palette.wall, leaf: palette.ground }); return
    case 'stall': stall(batch, point.x, point.z, { w: 3.2, ry: HALF, awning: [palette.accent, palette.wall] }); return
    case 'lamp': lampPost(batch, point.x, point.z, { color: palette.roof }); return
  }
}

function roof(batch: Batch, style: ParametricRoofStyle, z: number, colour: Colour): void {
  if (style === 'flat') {
    batch.box(0, 6.15, z, 12.2, 0.24, 1.7, colour)
    batch.box(0, 6.42, z, 11.2, 0.3, 1.35, colour)
    return
  }
  if (style === 'gable') {
    const angle = 0.48, depth = 1.8
    const slope = depth / 2 / Math.cos(angle) + 0.2, rise = Math.tan(angle) * depth / 4 + 0.04
    batch.box(0, 5.95 + rise, z - depth / 4, 12.5, 0.16, slope, colour, { rx: -angle })
    batch.box(0, 5.95 + rise, z + depth / 4, 12.5, 0.16, slope, colour, { rx: angle })
    batch.box(0, 5.95 + rise * 2 + 0.06, z, 12.6, 0.16, 0.3, colour)
    return
  }
  batch.cone(0, 6.15, z, 6.2, 1.8, colour, { seg: 4, ry: Math.PI / 4, sz: 0.22 })
}

function drawLandmark(batch: Batch, kind: ParametricLandmark, z: number, palette: ParametricVenueDesign['palette']): void {
  const x = 8.8
  switch (kind) {
    case 'rock':
      boulder(batch, x - 1, 0, z, 1.5, 1); boulder(batch, x + 0.9, 0, z + 0.2, 1.1, 2); return
    case 'hill':
      batch.ico(x, 1.4, z, 4.2, 2.8, 1.5, palette.ground); batch.ico(x + 1.2, 2.2, z - 0.1, 2.8, 3.6, 1.2, palette.ground); return
    case 'tower':
      batch.box(x, 3.4, z, 1.8, 6.8, 1.5, palette.wall); batch.box(x, 7, z, 2.5, 0.4, 2.1, palette.roof); batch.box(x, 5.2, z + 0.78, 0.5, 1.1, 0.08, palette.accent); return
    case 'gate':
      for (const side of [-1, 1]) batch.box(x + side * 2, 2.6, z, 0.8, 5.2, 0.8, palette.wall)
      batch.box(x, 5.1, z, 4.8, 0.65, 0.9, palette.roof); return
    case 'river':
      batch.box(x, 0.03, z, 8, 0.06, 1.5, palette.accent, GLASS)
      for (let offset = -3; offset <= 3; offset += 1.5) batch.quad(x + offset, 0.07, z + 0.77, 0.8, 0.04, palette.wall, { rx: -HALF, layer: 'glass' })
  }
}

/** A calm, denomination-neutral worship room for generated venues that did not name a variant. */
export function buildQuietParametricWorship(batch: Batch, context: SceneContext): SceneLayout {
  const palette = context.venue?.scene?.design?.palette
  if (!palette) return { spots: [], crowd: [] }
  room(batch, { floor: palette.ground, wall: palette.wall, side: palette.wall, trim: palette.roof, h: 6.2 })
  rug(batch, 0, -2.1, 9.5, 7.2, palette.ground, { border: palette.accent })
  for (const z of [-5.2, -2.8, -0.4, 2]) {
    bench(batch, -3.3, z, { w: 4.8, color: palette.wall, leg: palette.roof })
    bench(batch, 3.3, z, { w: 4.8, color: palette.wall, leg: palette.roof })
  }
  batch.box(0, 0.45, -8.4, 4.6, 0.9, 1.2, palette.wall)
  batch.box(0, 0.95, -8.4, 4.9, 0.12, 1.4, palette.accent)
  batch.cyl(-8.8, 0.55, -7.8, 0.7, 1.1, palette.wall, { seg: 12, top: 1.2 })
  batch.disc(-8.8, 1.12, -7.8, 0.56, palette.accent, { seg: 12, layer: 'glass' })
  plant(batch, 9.8, -8.3, { s: 1.2, pot: palette.roof, leaf: palette.ground })
  plant(batch, -9.8, 7.7, { s: 1.1, pot: palette.roof, leaf: palette.ground })
  return {
    spots: [
      sceneLandmark('hall', /hall|pray|worship|service|gather|quiet/, 0, 3.8, Math.PI),
      sceneLandmark('reflection', /reflect|meditat|counsel|read|study/, 0, -6.5, Math.PI),
      sceneLandmark('wash', /wash|water|clean/, -7.2, -6.5, -HALF),
      sceneLandmark('people', /people|meet|community|volunteer/, 7.2, 5.8, HALF),
    ],
    crowd: [[-5.6, 5.5, 0.2], [-2.8, 6.5, -0.3], [2.8, 6.4, 0.4], [5.6, 5.3, -0.4]],
    spare: [[-7, 4], [7, 3.4], [-8, 1], [8, 0.5]],
  }
}

/** Add generated-city identity without replacing the scene kind's authored layout or landmarks. */
export function decorateParametricVenue({ batch, context, layout, footprints, indoor }: DecorationContext): void {
  const design = context.venue?.scene?.design
  if (!design) return

  const rear = indoor ? -10.55 : -12.65
  batch.box(0, 3, rear, 11.6, 5.8, 0.5, design.palette.wall)
  batch.box(0, 1.15, rear + 0.27, 10.8, 0.28, 0.08, design.palette.accent)
  roof(batch, design.roof, rear, design.palette.roof)

  const label = plain(context.label)
  const propCandidates: Point[] = indoor
    ? [{ x: 10.7, z: 8.7 }, { x: -10.6, z: 8.5 }, { x: 10.6, z: 5.8 }, { x: -10.5, z: 5.5 }]
    : [{ x: 13.2, z: 10.6 }, { x: -13.1, z: 10.5 }, { x: 13.1, z: 7.2 }, { x: -13.2, z: 7.1 }]
  const signCandidates: Point[] = indoor
    ? [{ x: -10.2, z: 8.2 }, { x: 10.2, z: 8.2 }, { x: -10.4, z: 5.2 }, { x: 10.4, z: 5.2 }]
    : [{ x: -12.2, z: 10.5 }, { x: 12.2, z: 10.5 }, { x: -12.6, z: 6.2 }, { x: 12.6, z: 6.2 }]
  const placed: Point[] = []
  const roadside = design.sign === 'roadside'
    ? signCandidates.find((candidate) => free(candidate, Math.min(3.4, fit(label, 6.8, 0.42) * label.length * 0.45 + 0.6), layout, footprints))
    : undefined
  if (!roadside) {
    sign(batch, 0, 4.35, rear + 0.29, label, { size: fit(label, 8.8, 0.5), color: design.palette.accent, board: design.palette.roof, lit: true, pad: 0.24 })
  } else {
    signBoard(batch, roadside.x, roadside.z, label, { y: 2.5, size: fit(label, 6.8, 0.42), color: design.palette.wall, board: design.palette.roof, lit: true })
    placed.push(roadside)
  }

  if (design.landmark) drawLandmark(batch, design.landmark, indoor ? -11.1 : -12.3, design.palette)

  for (const prop of design.props ?? []) {
    const radius = propRadius(prop)
    const point = propCandidates.find((candidate) => free(candidate, radius, layout, footprints)
      && placed.every((other) => Math.hypot(other.x - candidate.x, other.z - candidate.z) > radius + 2.2))
    if (!point) continue
    drawProp(batch, prop, point, design.palette)
    placed.push(point)
  }
}
