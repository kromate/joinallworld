/**
 * Source-pinned sedan boarding presentation geometry. This describes authored anchors and the
 * current scene's placement-anchor recipe; internal skinned-clip motion is unverified. It is
 * deliberately NOT collision, actor-volume, or trip proof. The active practice sedan now includes
 * authored floor and seat solids; its actual traversable aperture and actor fit remain unknown.
 */
export const SEDAN_BOARDING_DESCRIPTOR = Object.freeze({
  schemaVersion: 1,
  id: 'sedan-driver-boarding-v2',
  source: Object.freeze({
    revision: 'sedan-interior-content-pins-v2',
    baselineRevision: '75ad421adc6d1eb455c9f7a258bc63e315ce5955',
    sha256: Object.freeze({
      'src/models/vehicles/sedan-interior.ts': 'fee4c0f203868acd4bc99a47a05918c66163ffddc40451cd39bb012bd4b14059',
      'src/models/vehicles/index.ts': '7db039a0b25373a86354639fd703a96aab3a3de48a3088c14c555cc0fa6afc19',
      'src/models/vehicles/geometry.ts': '4bf847bd17a735050daa4686ed0be495c64a7936ed3c65c6e306e740edc94885',
      'src/game/living-world/vehicle-clearance.ts': '61753ce829d9a202772ed6e3f1644828da33450255fbe26c4da11a2effc33d5f',
      'src/app/features/living-world/drivingScene.ts': '41381b92f248655081eab1ac9215dec97ffaa442206e45122dc37f5a63d25156',
      'src/scene/body/stand-in.ts': '55c39f33f08d43a0ac7f7ab1766522e1ef48ddfb4c7aced20cd762fd57156098',
      'src/scene/body/skinned.ts': 'ee2ec68e2a707c5b8976aa1e28f085129f84142e466fd622d09b51633bbf197a',
      'src/scene/body/poses.ts': '7f328e67ec33d1c94516d76746635e45d8f90a01416176534fa0448d4e797d5e',
      'src/scene/characters.ts': '3d5990a1dd7a01098a1ab37f820e5f27027d4336090972b56f1e96c44ada55b6',
      'src/types/avatar.ts': '612d9ccf82dbd32a06926ca79dc837bbc3179ffa11ddb8ec45a9f312ec76eb6d',
      'src/app/features/start/lookModel.ts': 'b3323c862f6aa40a10db0390c7ee96f170b8a18c76b5d9aaf64d3e90fb86ef85',
    }),
  }),
  frame: Object.freeze({
    units: 'metres',
    forward: '+Z',
    driverSide: '-X',
    localToWorld: 'x=center.x+local.x*cos(heading)+local.z*sin(heading); z=center.z-local.x*sin(heading)+local.z*cos(heading)',
  }),
  sedan: Object.freeze({
    detail: 'street',
    geometryBudget: Object.freeze({ triangles: 814, triangleLimit: 1500, drawCalls: 8 }),
    bodyShell: Object.freeze({ width: 1.9, length: 4.35, height: 1.58 }),
    conservativeStaticEnvelope: Object.freeze({ halfWidth: 1.302, halfLength: 2.246 }),
    driverAnchor: Object.freeze({ x: -0.437, y: 0.74, z: 0.42 }),
    driverSeatAnchor: 'anchors.driver; anchors.seats[0] is the passenger seat',
    cabin: Object.freeze({
      sideProfileZ: Object.freeze([-2.175, 2.175]),
      sideGlassZ: Object.freeze([-1.214, 0.854]),
      roofY: 1.53,
      floorOrSeatSolids: 'sedan-interior.ts authors a body-local floor and four cushion/backrest seats; actor fit and interior collision are unverified',
      clearDoorway: 'unknown',
    }),
    driverDoor: Object.freeze({
      hingeLocal: Object.freeze({ x: -0.96, y: 0.93, z: 0.89 }),
      closedGroundAnchorLocal: Object.freeze({ x: -0.96, y: 0.6132, z: 0.42 }),
      panelBox: Object.freeze({ width: 0.08, height: 0.88, depth: 0.94 }),
      bodyPanelPartition: Object.freeze({ x: Object.freeze([-1.07, -0.89]), y: Object.freeze([0.49, 1.48]), z: Object.freeze([-0.05, 0.89]) }),
      openAngleRadians: Math.PI * 0.55,
      openDirection: '+Y rotation, outward from the driver side',
      apertureClearance: 'unknown; clipped exterior panel bounds do not define a traversable opening',
    }),
  }),
  actor: Object.freeze({
    standInSceneScale: 1.75 / 2.45,
    fallbackSceneScale: 1.75 / 2.95,
    fallbackAvatarHeightFactor: 'avatarProportions(sceneLook(look).appearance).height; 0.94 short / 1 average / 1.06 tall',
    sitPoseSeatArgument: 0.6,
    fallbackSitRootOffsetAvatarUnits: Object.freeze({ stand: 0.13, sit: -1.05 }),
    actorVolume: 'unverified',
    clipSweptVolume: 'unverified; skinned clip and wardrobe bounds are not collision bounds',
  }),
  entry: Object.freeze([
    Object.freeze({ phase: 'open-door', door: Object.freeze([0, 1]), standInPlacement: 'approachGround', fallbackAvatarRoot: 'approachGround', normalMs: 200, reducedMotionMs: 80 }),
    Object.freeze({ phase: 'walk-to-threshold', door: 1, standInPlacement: Object.freeze(['approachGround', 'thresholdGround']), fallbackAvatarRoot: Object.freeze(['approachGround', 'thresholdGround']), normalMs: 620, reducedMotionMs: 240 }),
    Object.freeze({ phase: 'seat-transition', door: 1, standInPlacement: 'thresholdSeatAnchor; internal sit-enter clip trajectory unverified', fallbackAvatarRoot: 'thresholdSeatRoot', normalMs: 'clip-settled', reducedMotionMs: 'clip-settled' }),
    Object.freeze({ phase: 'slide-to-seat', door: Object.freeze([1, 1]), standInPlacement: Object.freeze(['thresholdSeatAnchor', 'driverSeatAnchor']), fallbackAvatarRoot: Object.freeze(['thresholdSeatRoot', 'driverSeatRoot']), normalMs: 380, reducedMotionMs: 180 }),
    Object.freeze({ phase: 'close-door', door: Object.freeze([1, 0]), standInPlacement: 'driverSeatAnchor', fallbackAvatarRoot: 'driverSeatRoot', normalMs: 220, reducedMotionMs: 100 }),
  ]),
  exit: Object.freeze([
    Object.freeze({ phase: 'open-door', door: Object.freeze([0, 1]), standInPlacement: 'driverSeatAnchor', fallbackAvatarRoot: 'driverSeatRoot', normalMs: 200, reducedMotionMs: 80 }),
    Object.freeze({ phase: 'slide-to-egress-staging', door: 1, standInPlacement: Object.freeze(['driverSeatAnchor', 'egressSeatAnchor']), fallbackAvatarRoot: Object.freeze(['driverSeatRoot', 'egressSeatRoot']), outwardFromClosedDoorM: 0.6, normalMs: 500, reducedMotionMs: 220 }),
    Object.freeze({ phase: 'sit-exit', door: 1, standInPlacement: 'standingAt(egressGround); sit-exit clip trajectory unverified', fallbackAvatarRoot: Object.freeze(['egressSeatRoot', 'egressGroundRoot']), normalMs: 'clip-settled', reducedMotionMs: 220 }),
    Object.freeze({ phase: 'walk-to-approach', door: 1, standInPlacement: Object.freeze(['egressGround', 'approachGround']), fallbackAvatarRoot: Object.freeze(['egressGroundRoot', 'approachGround']), normalMs: 620, reducedMotionMs: 240 }),
    Object.freeze({ phase: 'close-door', door: Object.freeze([1, 0]), standInPlacement: 'approachGround', fallbackAvatarRoot: 'approachGround', normalMs: 220, reducedMotionMs: 80 }),
  ]),
  anchors: Object.freeze({
    approachOutwardM: 1.5,
    entryThresholdOutwardM: 0.2,
    exitStagingOutwardM: 0.6,
    standInSeatAnchorY: 'driverAnchor.y - sitPoseSeatArgument * standInSceneScale; host placement anchor, not mesh pelvis/root bounds',
    fallbackSeatRootY: 'driverAnchor.y + (stand - sit) * fallbackSceneScale * fallbackAvatarHeightFactor',
    fallbackThresholdRootY: 'fallbackSeatRootY',
    exitGroundY: 0,
    readyForDriving: 'only after entry door close and StandIn easing has settled',
  }),
  authority: Object.freeze({
    canBoard: false,
    routeAuthorized: false,
    staticVehicleEnvelope: 'pinned analytic bounds; not a swept mapped-route collision result',
    stoppedPoseProof: 'unverified',
    reason: 'No certified interior aperture, actor/clip volume, ground support, or mapped approach sweep contract exists.',
  }),
} as const)

/** Fail closed if a serialized or caller-provided descriptor differs from this source-pinned contract. */
export function readSedanBoardingDescriptor(value: unknown): typeof SEDAN_BOARDING_DESCRIPTOR | null {
  try {
    return matchesDescriptorValue(value, SEDAN_BOARDING_DESCRIPTOR) ? SEDAN_BOARDING_DESCRIPTOR : null
  } catch { return null }
}

function matchesDescriptorValue(value: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== 'object') return Object.is(value, expected)
  if (value === null || typeof value !== 'object' || Array.isArray(value) !== Array.isArray(expected)) return false
  const prototype = Object.getPrototypeOf(value)
  if (Array.isArray(expected) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false
  const keys = Reflect.ownKeys(value), expectedKeys = Reflect.ownKeys(expected)
  if (keys.length !== expectedKeys.length) return false
  for (const key of expectedKeys) {
    const actual = Object.getOwnPropertyDescriptor(value, key), pinned = Object.getOwnPropertyDescriptor(expected, key)
    if (!actual || !pinned || !Object.hasOwn(actual, 'value') || actual.enumerable !== pinned.enumerable) return false
    if (!matchesDescriptorValue(actual.value, pinned.value)) return false
  }
  return true
}

export interface VehicleFramePoint { x: number; z: number }
/** Convert a planar vehicle-local point with the same +Z-forward Y-heading convention as drivingScene. */
export function vehicleLocalToWorld(point: VehicleFramePoint, center: VehicleFramePoint, heading: number): VehicleFramePoint | null {
  if (![point.x, point.z, center.x, center.z, heading].every(Number.isFinite)) return null
  const c = Math.cos(heading), s = Math.sin(heading)
  const x = center.x + point.x * c + point.z * s, z = center.z - point.x * s + point.z * c
  return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null
}
