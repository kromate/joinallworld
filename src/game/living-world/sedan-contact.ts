import * as THREE from 'three'
import { buildVehicle, poseVehicle } from '../../models/vehicles/index.ts'

/**
 * CPU-only contact samples from the authored map-detail sedan meshes.
 * These are rendered triangles, not a collision hull or proof that an actor can board.
 *
 * Source inspection: `src/models/vehicles/index.ts` builds the car shell/windows and a
 * hinged driver door in `buildCar` (around lines 667-754). `addSeat` (around 280) adds
 * empty Object3D anchors; the sedan builder adds no cabin floor or seat meshes. Until
 * those authored surfaces and a bounded doorway volume exist, interior contact remains
 * unknown. A minimal next model change is to author a cabin floor and seat collision
 * surfaces alongside the sedan setup in `buildCar` (lines 747-754), plus an explicit
 * doorway/aperture volume at the `addDoor` call (line 751); keep them separately named
 * so an actor sampler can distinguish traversable interior from exterior shell. The
 * exterior panel samples below must not be treated as cabin clearance.
 */

export const SEDAN_CONTACT_LIMITS = Object.freeze({
  doorFractions: Object.freeze([0, 0.25, 0.5, 0.75, 1] as const),
  maxTriangles: 10_000,
})

export type LocalPoint = readonly [x: number, y: number, z: number]

export interface ContactTriangle {
  readonly a: LocalPoint
  readonly b: LocalPoint
  readonly c: LocalPoint
}

export interface ContactMeshBatch {
  /** Object names from the generated Three.js hierarchy; not semantic collision tags. */
  readonly meshPath: string
  readonly triangles: readonly ContactTriangle[]
}

export interface DoorPoseContactSample {
  readonly doorFraction: number
  readonly batches: readonly ContactMeshBatch[]
}

export interface SedanContactDiagnostic {
  readonly model: 'sedan'
  readonly detail: 'map'
  /** The model's authored forward axis is +Z; zero is the pinned vehicle-local heading. */
  readonly headingRadians: 0
  readonly frame: 'vehicle-local-metres'
  readonly staticRenderedMeshes: readonly ContactMeshBatch[]
  readonly closedDoorMeshes: readonly ContactMeshBatch[]
  readonly doorPoseSamples: readonly DoorPoseContactSample[]
  readonly anchors: {
    readonly driver: LocalPoint
    readonly door: LocalPoint
    readonly seats: readonly LocalPoint[]
    readonly seatGeometry: 'anchor-only'
  }
  readonly interior: {
    readonly floor: 'not-authored'
    readonly doorwayGeometry: 'side-cutout-only-no-traversal-volume'
    readonly traversableDoorway: 'unknown'
    readonly continuousDoorSweep: 'not-certified-by-finite-samples'
  }
  readonly canBoard: false
  readonly routeAuthorized: false
  readonly triangleCount: number
}

function meshObject(value: THREE.Object3D): value is THREE.Mesh {
  return 'isMesh' in value && value.isMesh === true
}

function instanceMesh(value: THREE.Mesh): value is THREE.InstancedMesh {
  return 'isInstancedMesh' in value && value.isInstancedMesh === true
}

function pathOf(object: THREE.Object3D, root: THREE.Object3D): string {
  const parts: string[] = []
  let cursor: THREE.Object3D | null = object
  while (cursor && cursor !== root) {
    parts.push(cursor.name || cursor.type)
    cursor = cursor.parent
  }
  return parts.reverse().join('/') || root.name
}

function triangleCount(object: THREE.Mesh): number {
  const positions = object.geometry.getAttribute('position')
  const elements = object.geometry.index?.count ?? positions?.count ?? 0
  if (!positions || !Number.isSafeInteger(elements) || elements < 0 || elements % 3 !== 0) {
    throw new RangeError('Sedan mesh has unsupported triangle geometry')
  }
  const instances = instanceMesh(object) ? object.count : 1
  if (!Number.isSafeInteger(instances) || instances < 0) throw new RangeError('Sedan mesh has invalid instance count')
  return (elements / 3) * instances
}

function captureMeshes(
  root: THREE.Group,
  include: (object: THREE.Object3D) => boolean,
  budget: { used: number; maximum: number },
): ContactMeshBatch[] {
  const inverseRoot = root.matrixWorld.clone().invert()
  const batches: ContactMeshBatch[] = []
  root.traverse((object) => {
    if (!meshObject(object) || !include(object)) return
    const needed = triangleCount(object)
    if (budget.used + needed > budget.maximum) throw new RangeError('Sedan contact triangle limit exceeded')
    const position = object.geometry.getAttribute('position')
    const index = object.geometry.index
    const objectToVehicle = inverseRoot.clone().multiply(object.matrixWorld)
    const instances = instanceMesh(object) ? object.count : 1
    const triangles: ContactTriangle[] = []
    const instanceTransform = new THREE.Matrix4()
    const localToVehicle = new THREE.Matrix4()
    const readPoint = (element: number): LocalPoint => {
      const vertex = index?.getX(element) ?? element
      if (vertex < 0 || vertex >= position.count) throw new RangeError('Sedan mesh index is outside its vertex buffer')
      const point = new THREE.Vector3().fromBufferAttribute(position, vertex).applyMatrix4(localToVehicle)
      if (![point.x, point.y, point.z].every(Number.isFinite)) throw new RangeError('Sedan mesh has non-finite vertices')
      return [point.x, point.y, point.z]
    }
    const elements = index?.count ?? position.count
    for (let instance = 0; instance < instances; instance += 1) {
      if (instanceMesh(object)) {
        object.getMatrixAt(instance, instanceTransform)
        localToVehicle.copy(objectToVehicle).multiply(instanceTransform)
      } else {
        localToVehicle.copy(objectToVehicle)
      }
      for (let offset = 0; offset < elements; offset += 3) {
        triangles.push({ a: readPoint(offset), b: readPoint(offset + 1), c: readPoint(offset + 2) })
      }
    }
    budget.used += needed
    batches.push({ meshPath: pathOf(object, root), triangles })
  })
  return batches
}

function localAnchor(root: THREE.Group, anchor: THREE.Object3D): LocalPoint {
  const point = anchor.getWorldPosition(new THREE.Vector3())
  root.worldToLocal(point)
  if (![point.x, point.y, point.z].every(Number.isFinite)) throw new RangeError('Sedan anchor is non-finite')
  return [point.x, point.y, point.z]
}

/**
 * Build and dispose the real map-detail sedan, returning bounded local-space triangle
 * samples. No GPU, renderer, world coordinates, or synthetic cabin geometry is used.
 */
export function createSedanContactDiagnostic(maxTriangles: number = SEDAN_CONTACT_LIMITS.maxTriangles): SedanContactDiagnostic {
  if (!Number.isSafeInteger(maxTriangles) || maxTriangles < 1 || maxTriangles > SEDAN_CONTACT_LIMITS.maxTriangles) {
    throw new RangeError('Invalid sedan contact triangle limit')
  }
  const model = buildVehicle('sedan', { detail: 'map' })
  try {
    if (model.userData.type !== 'sedan' || model.userData.detail !== 'map') throw new RangeError('Unexpected sedan model provenance')
    const root = model.object3D
    const doorRoot = model.userData.parts.doors[0]
    const { driver, door, seats } = model.userData.anchors
    if (!doorRoot || !door || !driver || seats.length !== 3) throw new RangeError('Sedan contact anchors are incomplete')
    root.updateMatrixWorld(true)
    const isDoorMesh = (object: THREE.Object3D) => {
      let cursor: THREE.Object3D | null = object
      while (cursor && cursor !== root) {
        if (cursor === doorRoot) return true
        cursor = cursor.parent
      }
      return false
    }
    const budget = { used: 0, maximum: maxTriangles }
    const driverAnchor = localAnchor(root, driver)
    const closedDoorAnchor = localAnchor(root, door)
    const seatAnchors = seats.map(seat => localAnchor(root, seat))
    const staticRenderedMeshes = captureMeshes(root, object => !isDoorMesh(object), budget)
    const closedDoorMeshes = captureMeshes(root, isDoorMesh, budget)
    const doorPoseSamples: DoorPoseContactSample[] = []
    for (const doorFraction of SEDAN_CONTACT_LIMITS.doorFractions.slice(1)) {
      poseVehicle(model, { door: doorFraction })
      root.updateMatrixWorld(true)
      doorPoseSamples.push({ doorFraction, batches: captureMeshes(root, isDoorMesh, budget) })
    }
    root.updateMatrixWorld(true)
    return {
      model: 'sedan', detail: 'map', headingRadians: 0, frame: 'vehicle-local-metres',
      staticRenderedMeshes, closedDoorMeshes, doorPoseSamples,
      anchors: {
        driver: driverAnchor, door: closedDoorAnchor, seats: seatAnchors, seatGeometry: 'anchor-only',
      },
      interior: {
        floor: 'not-authored', doorwayGeometry: 'side-cutout-only-no-traversal-volume',
        traversableDoorway: 'unknown',
        continuousDoorSweep: 'not-certified-by-finite-samples',
      },
      canBoard: false, routeAuthorized: false, triangleCount: budget.used,
    }
  } finally {
    model.userData.dispose()
  }
}
