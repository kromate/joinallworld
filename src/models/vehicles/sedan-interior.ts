import * as THREE from 'three'
import type { VehicleModel } from './index.ts'

/**
 * Small authored visual/contact surfaces for the sedan. Coordinates stay in body-local world
 * units (+Z forward), so parenting the group to `parts.body` follows vehicle placement and pose.
 * The simple boxes are source-owned solids, not a certified actor fit or boarding aperture.
 */
export const SEDAN_INTERIOR_LAYOUT = Object.freeze({
  // `sedan()` authors 1.9 × 4.35 × 1.58; buildCar uses sill 0.45, roof 1.53,
  // and sedan cabin z limits rear + 0.82 = -1.355 through front - 1.18 = 0.995.
  // These inset limits leave margin inside that shell; they do not describe collision clearance.
  frame: 'vehicle-body-local',
  units: 'vehicle-world-units',
  forward: '+Z',
  drawCalls: 1,
  // Ten low-poly boxes (120), a 12×4 steering rim (96), three spokes (36), and an 8-sided hub (32).
  triangles: 284,
  shell: Object.freeze({ minX: -0.82, maxX: 0.82, minY: 0.45, maxY: 1.30, minZ: -1.32, maxZ: 0.96 }),
  floor: Object.freeze({ minX: -0.78, maxX: 0.78, minY: 0.46, maxY: 0.52, minZ: -1.25, maxZ: 0.90 }),
  seat: Object.freeze({ width: 0.54, cushionDepth: 0.62, cushionHeight: 0.12, backrestDepth: 0.13, backrestHeight: 0.58 }),
  actorVolume: 'unverified',
  traversableAperture: 'unknown',
  canBoard: false,
} as const)

export interface InteriorBounds {
  readonly min: Readonly<{ x: number; y: number; z: number }>
  readonly max: Readonly<{ x: number; y: number; z: number }>
}

export interface SedanInteriorSolid {
  readonly id: string
  readonly kind: 'floor' | 'seat-cushion' | 'seat-backrest' | 'dashboard' | 'steering-wheel'
  readonly bounds: InteriorBounds
  /** Vertex range in the returned single geometry, for bounded CPU-side inspection. */
  readonly vertexStart: number
  readonly vertexCount: number
}

export interface SedanInteriorSupport {
  readonly id: string
  readonly solidId: string
  readonly kind: 'floor' | 'seat-cushion'
  readonly surfaceY: number
  readonly polygonXZ: readonly (readonly [x: number, z: number])[]
}

export interface SedanInteriorModel {
  readonly group: THREE.Group
  readonly geometry: THREE.BufferGeometry
  readonly material: THREE.MeshStandardMaterial
  readonly solids: readonly SedanInteriorSolid[]
  readonly supportSurfaces: readonly SedanInteriorSupport[]
  readonly triangleCount: number
  /** Normalized visual input only; it does not authorize movement or certify hand contact. */
  poseSteering(input: number): void
  dispose(): void
}
export type AttachedSedanInterior = Omit<SedanInteriorModel, 'dispose'>

interface BoxSpec {
  id: string
  kind: SedanInteriorSolid['kind']
  center: readonly [number, number, number]
  size: readonly [number, number, number]
  color: THREE.Color
}

const finitePoint = (point: THREE.Vector3): boolean => [point.x, point.y, point.z].every(Number.isFinite)
const pointBounds = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): InteriorBounds => Object.freeze({
  min: Object.freeze({ x: minX, y: minY, z: minZ }),
  max: Object.freeze({ x: maxX, y: maxY, z: maxZ }),
})

function localAnchor(model: VehicleModel, anchor: THREE.Object3D): THREE.Vector3 {
  const point = model.userData.parts.body.worldToLocal(anchor.getWorldPosition(new THREE.Vector3()))
  if (!finitePoint(point)) throw new RangeError('Sedan anchor is non-finite')
  return point
}

function rectangle(minX: number, minZ: number, maxX: number, maxZ: number): readonly (readonly [number, number])[] {
  return Object.freeze([
    Object.freeze([minX, minZ] as const), Object.freeze([maxX, minZ] as const),
    Object.freeze([maxX, maxZ] as const), Object.freeze([minX, maxZ] as const),
  ])
}

/** Build actual visible floor/cushion/backrest geometry from the current authored sedan anchors. */
export function createSedanInterior(model: VehicleModel): SedanInteriorModel {
  if (model.userData.type !== 'sedan' || (model.userData.detail !== 'map' && model.userData.detail !== 'street')) {
    throw new RangeError('Sedan interior requires a map- or street-detail sedan model')
  }
  model.object3D.updateMatrixWorld(true)
  const { driver, seats } = model.userData.anchors
  if (!driver || seats.length !== 3) throw new RangeError('Sedan interior requires one driver and three passenger anchors')
  const anchors = [driver, ...seats].map(anchor => localAnchor(model, anchor))
  const [driverPoint, frontPassenger, rearDriver, rearPassenger] = anchors
  if (!driverPoint || !frontPassenger || !rearDriver || !rearPassenger
    || driverPoint.x >= 0 || frontPassenger.x <= 0 || rearDriver.z >= 0 || rearPassenger.z >= 0
    || anchors.some(point => point.x < -0.55 || point.x > 0.55 || point.y < 0.65 || point.y > 0.85
      || point.z < -0.8 || point.z > 0.6)) {
    throw new RangeError('Sedan anchor layout is outside the authored interior envelope')
  }

  const layout = SEDAN_INTERIOR_LAYOUT
  const seatAnchors = [
    ['driver', driverPoint], ['front-passenger', frontPassenger],
    ['rear-driver-side', rearDriver], ['rear-passenger-side', rearPassenger],
  ] as const
  const specs: BoxSpec[] = [{
    id: 'cabin-floor', kind: 'floor',
    center: [0, (layout.floor.minY + layout.floor.maxY) / 2, (layout.floor.minZ + layout.floor.maxZ) / 2],
    size: [layout.floor.maxX - layout.floor.minX, layout.floor.maxY - layout.floor.minY, layout.floor.maxZ - layout.floor.minZ],
    color: new THREE.Color('#363a3d'),
  }, {
    id: 'dashboard', kind: 'dashboard',
    center: [(driverPoint.x + frontPassenger.x) / 2, driverPoint.y + 0.315, driverPoint.z + 0.35],
    size: [1.34, 0.14, 0.28],
    color: new THREE.Color('#55595a'),
  }]
  const supports: SedanInteriorSupport[] = [{
    id: 'cabin-floor-support', solidId: 'cabin-floor', kind: 'floor', surfaceY: layout.floor.maxY,
    polygonXZ: rectangle(layout.floor.minX, layout.floor.minZ, layout.floor.maxX, layout.floor.maxZ),
  }]
  const halfWidth = layout.seat.width / 2
  for (const [seatId, anchor] of seatAnchors) {
    const cushionTop = anchor.y - 0.12
    const cushionBottom = cushionTop - layout.seat.cushionHeight
    const cushionCenterZ = anchor.z + 0.03
    const cushionId = `${seatId}-cushion`
    const cushionBounds = pointBounds(anchor.x - halfWidth, cushionBottom, cushionCenterZ - layout.seat.cushionDepth / 2,
      anchor.x + halfWidth, cushionTop, cushionCenterZ + layout.seat.cushionDepth / 2)
    specs.push({
      id: cushionId, kind: 'seat-cushion', center: [anchor.x, (cushionBottom + cushionTop) / 2, cushionCenterZ],
      size: [layout.seat.width, layout.seat.cushionHeight, layout.seat.cushionDepth], color: new THREE.Color('#45494c'),
    })
    supports.push({ id: `${seatId}-seat-support`, solidId: cushionId, kind: 'seat-cushion', surfaceY: cushionTop,
      polygonXZ: rectangle(cushionBounds.min.x, cushionBounds.min.z, cushionBounds.max.x, cushionBounds.max.z) })

    const backrestBottom = cushionTop
    const backrestTop = backrestBottom + layout.seat.backrestHeight
    const backrestCenterZ = anchor.z - 0.31
    specs.push({
      id: `${seatId}-backrest`, kind: 'seat-backrest',
      center: [anchor.x, (backrestBottom + backrestTop) / 2, backrestCenterZ],
      size: [layout.seat.width, layout.seat.backrestHeight, layout.seat.backrestDepth], color: new THREE.Color('#3d4144'),
    })
  }

  const positions: number[] = []
  const normals: number[] = []
  const colors: number[] = []
  const solids: SedanInteriorSolid[] = []
  for (const spec of specs) {
    const [x, y, z] = spec.center
    const [width, height, depth] = spec.size
    if (![x, y, z, width, height, depth].every(Number.isFinite) || width <= 0 || height <= 0 || depth <= 0) {
      throw new RangeError('Sedan interior solid is invalid')
    }
    const minX = x - width / 2, maxX = x + width / 2
    const minY = y - height / 2, maxY = y + height / 2
    const minZ = z - depth / 2, maxZ = z + depth / 2
    if (minX < layout.shell.minX || maxX > layout.shell.maxX || minY < layout.shell.minY || maxY > layout.shell.maxY
      || minZ < layout.shell.minZ || maxZ > layout.shell.maxZ) {
      throw new RangeError('Sedan interior solid exceeds the authored cabin envelope')
    }
    const part = new THREE.BoxGeometry(width, height, depth)
    part.translate(x, y, z)
    const partPositions = part.getAttribute('position')
    const partNormals = part.getAttribute('normal')
    const partIndex = part.index
    const partVertexCount = partIndex?.count ?? partPositions.count
    if (partVertexCount % 3 !== 0) throw new RangeError('Sedan interior box has invalid triangle geometry')
    const vertexStart = positions.length / 3
    const color = spec.color
    for (let i = 0; i < partVertexCount; i += 1) {
      const vertex = partIndex?.getX(i) ?? i
      positions.push(partPositions.getX(vertex), partPositions.getY(vertex), partPositions.getZ(vertex))
      normals.push(partNormals.getX(vertex), partNormals.getY(vertex), partNormals.getZ(vertex))
      colors.push(color.r, color.g, color.b)
    }
    part.dispose()
    solids.push(Object.freeze({ id: spec.id, kind: spec.kind,
      bounds: pointBounds(minX, minY, minZ, maxX, maxY, maxZ), vertexStart, vertexCount: partVertexCount }))
  }

  // Keep the wheel and its three spokes in the same vertex-coloured batch. All temporary
  // geometries are discarded here; steering updates below touch only this stable vertex range.
  const wheelStart = positions.length / 3
  const steeringCenter = [driverPoint.x, driverPoint.y + 0.19, driverPoint.z + 0.18] as const
  const appendPart = (part: THREE.BufferGeometry, color: THREE.Color): void => {
    const partPositions = part.getAttribute('position'), partNormals = part.getAttribute('normal'), partIndex = part.index
    const count = partIndex?.count ?? partPositions.count
    for (let i = 0; i < count; i += 1) {
      const vertex = partIndex?.getX(i) ?? i
      positions.push(partPositions.getX(vertex), partPositions.getY(vertex), partPositions.getZ(vertex))
      normals.push(partNormals.getX(vertex), partNormals.getY(vertex), partNormals.getZ(vertex))
      colors.push(color.r, color.g, color.b)
    }
    part.dispose()
  }
  const wheelColor = new THREE.Color('#25292b')
  const rim = new THREE.TorusGeometry(0.155, 0.022, 4, 12)
  rim.translate(...steeringCenter)
  appendPart(rim, wheelColor)
  for (const angle of [0, Math.PI * 2 / 3, Math.PI * 4 / 3]) {
    const spoke = new THREE.BoxGeometry(0.024, 0.125, 0.022)
    spoke.rotateZ(-angle)
    spoke.translate(steeringCenter[0] + Math.sin(angle) * 0.064, steeringCenter[1] + Math.cos(angle) * 0.064, steeringCenter[2])
    appendPart(spoke, wheelColor)
  }
  const hub = new THREE.CylinderGeometry(0.04, 0.04, 0.026, 8, 1)
  hub.rotateX(Math.PI / 2)
  hub.translate(...steeringCenter)
  appendPart(hub, new THREE.Color('#414749'))
  const wheelEnd = positions.length / 3
  const wheelBounds = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity }
  for (let i = wheelStart; i < wheelEnd; i += 1) {
    const at = i * 3, x = positions[at]!, y = positions[at + 1]!, z = positions[at + 2]!
    wheelBounds.minX = Math.min(wheelBounds.minX, x); wheelBounds.minY = Math.min(wheelBounds.minY, y); wheelBounds.minZ = Math.min(wheelBounds.minZ, z)
    wheelBounds.maxX = Math.max(wheelBounds.maxX, x); wheelBounds.maxY = Math.max(wheelBounds.maxY, y); wheelBounds.maxZ = Math.max(wheelBounds.maxZ, z)
  }
  if (wheelBounds.minX < layout.shell.minX || wheelBounds.maxX > layout.shell.maxX
    || wheelBounds.minY < layout.shell.minY || wheelBounds.maxY > layout.shell.maxY
    || wheelBounds.minZ < layout.shell.minZ || wheelBounds.maxZ > layout.shell.maxZ) {
    throw new RangeError('Sedan steering geometry exceeds the authored cabin envelope')
  }
  solids.push(Object.freeze({ id: 'steering-wheel', kind: 'steering-wheel',
    bounds: pointBounds(wheelBounds.minX, wheelBounds.minY, wheelBounds.minZ, wheelBounds.maxX, wheelBounds.maxY, wheelBounds.maxZ),
    vertexStart: wheelStart, vertexCount: wheelEnd - wheelStart }))

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  const wheelBasePositions = Float32Array.from(geometry.getAttribute('position').array.slice(wheelStart * 3, wheelEnd * 3))
  const wheelBaseNormals = Float32Array.from(geometry.getAttribute('normal').array.slice(wheelStart * 3, wheelEnd * 3))
  // Enclose the actual maximum chord displacement through the full clamped rotation interval.
  let wheelRadius = 0
  for (let at = 0; at < wheelBasePositions.length; at += 3) {
    wheelRadius = Math.max(wheelRadius, Math.hypot(wheelBasePositions[at]! - steeringCenter[0], wheelBasePositions[at + 1]! - steeringCenter[1]))
  }
  if (geometry.boundingSphere) geometry.boundingSphere.radius += 2 * wheelRadius * Math.sin(0.62 / 2)
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal')
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 })
  material.side = THREE.DoubleSide
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'sedan-interior-solids'
  const group = new THREE.Group()
  group.name = 'sedan-interior'
  group.add(mesh)

  let disposed = false
  const poseSteering = (input: number): void => {
    if (disposed) return
    const value = Number.isFinite(input) ? Math.max(-1, Math.min(1, input)) : 0
    // Positive input turns right; seen from the seated driver behind the wheel this is clockwise.
    const angle = -value * 0.62, cosine = Math.cos(angle), sine = Math.sin(angle)
    for (let vertex = 0; vertex < wheelEnd - wheelStart; vertex += 1) {
      const at = vertex * 3, target = (wheelStart + vertex) * 3
      const x = wheelBasePositions[at]! - steeringCenter[0], y = wheelBasePositions[at + 1]! - steeringCenter[1]
      const nx = wheelBaseNormals[at]!, ny = wheelBaseNormals[at + 1]!
      position.array[target] = steeringCenter[0] + x * cosine - y * sine
      position.array[target + 1] = steeringCenter[1] + x * sine + y * cosine
      normal.array[target] = nx * cosine - ny * sine
      normal.array[target + 1] = nx * sine + ny * cosine
    }
    position.needsUpdate = true
    normal.needsUpdate = true
  }
  return {
    group,
    geometry,
    material,
    solids: Object.freeze(solids),
    supportSurfaces: Object.freeze(supports.map(surface => Object.freeze(surface))),
    triangleCount: positions.length / 9,
    poseSteering,
    dispose() {
      if (disposed) return
      disposed = true
      try { geometry.dispose() } finally { material.dispose() }
    },
  }
}

interface SedanInteriorAttachment {
  readonly interior: SedanInteriorModel
  readonly view: AttachedSedanInterior
  disposed: boolean
}

const attachments = new WeakMap<THREE.Object3D, SedanInteriorAttachment>()
const triangleBudgets = Object.freeze({ map: 250, street: 1500 })
const drawCallBudget = 8

/** Attach one interior to the animated body while preserving the vehicle's existing resource owner. */
export function attachSedanInterior(model: VehicleModel): AttachedSedanInterior {
  if (model.object3D.userData !== model.userData) {
    throw new RangeError('Sedan interior requires the canonical vehicle metadata owner')
  }
  const attached = attachments.get(model.object3D)
  if (attached) {
    if (attached.disposed) throw new RangeError('Sedan interior model is already disposed')
    return attached.view
  }
  const { userData } = model
  if (userData.type !== 'sedan' || (userData.detail !== 'map' && userData.detail !== 'street')) {
    throw new RangeError('Sedan interior requires a map- or street-detail sedan model')
  }
  const triangleBudget = triangleBudgets[userData.detail]
  if (!Number.isSafeInteger(userData.triangles) || !Number.isSafeInteger(userData.drawCalls)
    || userData.triangles < 0 || userData.drawCalls < 0
    || userData.triangles + SEDAN_INTERIOR_LAYOUT.triangles > triangleBudget
    || userData.drawCalls + SEDAN_INTERIOR_LAYOUT.drawCalls > drawCallBudget) {
    throw new RangeError(`Sedan interior exceeds the ${userData.detail} vehicle geometry budget`)
  }
  for (const key of ['triangles', 'drawCalls', 'dispose'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(userData, key)
    if (!descriptor || !('value' in descriptor) || !descriptor.writable) {
      throw new RangeError('Sedan vehicle metadata cannot own interior resources')
    }
  }

  // Budget refusal above happens before allocating the interior's geometry or material.
  const interior = createSedanInterior(model)
  const originalDispose = userData.dispose
  try {
    userData.parts.body.add(interior.group)
    userData.triangles += interior.triangleCount
    userData.drawCalls += SEDAN_INTERIOR_LAYOUT.drawCalls
    const view: AttachedSedanInterior = Object.freeze({
      group: interior.group, geometry: interior.geometry, material: interior.material,
      solids: interior.solids, supportSurfaces: interior.supportSurfaces, triangleCount: interior.triangleCount,
      poseSteering: interior.poseSteering,
    })
    const attachment: SedanInteriorAttachment = { interior, view, disposed: false }
    attachments.set(model.object3D, attachment)
    userData.dispose = () => {
      if (attachment.disposed) return
      attachment.disposed = true
      try {
        interior.group.removeFromParent()
        interior.dispose()
      } finally { originalDispose() }
    }
    return view
  } catch (error) {
    interior.group.removeFromParent()
    interior.dispose()
    throw error
  }
}
