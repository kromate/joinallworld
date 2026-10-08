import type { WebGLRenderer } from 'three'
import type { DrivingInput, DrivingRoute, DrivingState } from '../../../game/living-world/driving.ts'
import type { Look } from '../../../types/life.ts'
import type { StandIn } from '../../../scene/body/stand-in.ts'
import type { VehicleModel, VehiclePose } from '../../../models/vehicles/index.ts'

export interface DrivingScene {
  present(state: DrivingState): void
  setInput(input: DrivingInput): void
  setReducedMotion(reduced: boolean): void
  begin(onReady?: () => void): void
  exit(): void
  setVisible(visible: boolean): void
  resize(width: number, height: number): void
  dispose(): void
}

const BODY_SCALE = 1.75 / 2.45
const FALLBACK_SCALE = 1.75 / 2.95
const SEAT = 0.6
const WHEEL_CIRCUMFERENCE = 2 * Math.PI * 0.37

type Point = { x: number; y: number; z: number }
type FlatPoint = { x: number; z: number }
type Phase = 'idle' | 'enter-door' | 'enter-walk' | 'enter-seat' | 'drive' | 'exit-door' | 'exit-walk'
type ActorPose = 'idle' | 'stand' | 'walk' | 'sit'

/** The feature is lazy: Three, scene builders and the shared skinned body stay outside startup. */
export async function createDrivingScene(canvas: HTMLCanvasElement, route: DrivingRoute, look: Look, reducedMotion: boolean, seed = ''): Promise<DrivingScene> {
  const THREE = await import('three')
  const [{ createKit }, { buildAvatar, poseAvatar }, { buildVehicle, poseVehicle }, { sceneLook }, { createStandIn }] = await Promise.all([
    import('../../../scene/kit.ts'), import('../../../scene/characters.ts'), import('../../../models/vehicles/index.ts'),
    import('../start/lookModel.ts'), import('../../../scene/body/stand-in.ts'),
  ])
  const kit = createKit()
  let renderer: WebGLRenderer
  try { renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: false, powerPreference: 'low-power' }) }
  catch (error) { kit.dispose(); throw error }
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5))
  renderer.setClearColor('#d8e8ee', 1)
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#d8e8ee')
  const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 240)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x66735e, 2.1))
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(-18, 32, -10); scene.add(sun)
  const ground = kit.box(0, -0.35, 0, 150, 0.5, 150, '#87a982', scene); ground.receiveShadow = true

  for (const road of route.roads) {
    for (let i = 1; i < road.length; i++) {
      const a = road[i - 1]!, b = road[i]!, dx = b.x - a.x, dz = b.z - a.z
      const length = Math.hypot(dx, dz), angle = Math.atan2(dx, dz)
      const strip = kit.box((a.x + b.x) / 2, -0.07, (a.z + b.z) / 2, route.roadWidth, 0.12, length, '#606b70', scene)
      strip.rotation.y = angle
      if (i > 1) kit.round(a.x, -0.07, a.z, route.roadWidth / 2, 0.12, '#606b70', scene)
    }
  }
  for (const check of route.checkpoints) {
    const color = check.stopRequired ? '#e74d45' : '#f2bd4d'
    kit.round(check.center.x, 0.035, check.center.z, Math.max(0.12, check.radius), 0.07, color, scene)
  }

  let partialCar: VehicleModel | null = null
  let partialAvatar: import('../../../scene/characters.ts').RiggedAvatar | null = null
  try {
    partialCar = buildVehicle('sedan', { colour: '#277f9b', detail: 'map' })
    partialAvatar = buildAvatar(kit, sceneLook(look), { rig: true, detail: 'low', scale: FALLBACK_SCALE })
    scene.add(partialCar.object3D, partialAvatar)
  } catch (error) {
    partialCar?.userData.dispose(); partialAvatar?.userData.dispose(); kit.dispose(); renderer.dispose(); scene.clear(); throw error
  }
  const car = partialCar!, avatar = partialAvatar!
  let phase: Phase = 'idle', phaseTime = 0, state: DrivingState | null = null
  let input: DrivingInput = { throttle: 0, brake: 1, steer: 0 }, clock = 0, stridePhase = 0
  let visible = true, disposed = false, firstFrame = true, renderPending = true, lastDraw = 0, frame = 0
  let ready: (() => void) | null = null, actorPose: ActorPose = 'idle', wheelDistance = 0, previousPoint: FlatPoint | null = null
  let reduceMotion = reducedMotion
  let standIn: StandIn

  const driverAnchor = car.userData.anchors.driver, doorAnchor = car.userData.anchors.door
  const first = route.roads[0]?.[0] ?? { x: 0, z: 0 }
  const next = route.roads[0]?.[1] ?? { x: first.x, z: first.z + 1 }
  const initialHeading = Math.atan2(next.x - first.x, next.z - first.z)
  const initialState = (point: FlatPoint, heading: number): DrivingState => ({
    routeId: route.id, routeVersion: route.version, position: { x: point.x, z: point.z }, heading, speed: 0,
    checkpointIndex: 0, checkpointEntry: 'blocked', stopDwellMs: 0, score: 100,
    status: 'running', assessment: 'pending', feedback: '',
  })
  const chaseOffset = new THREE.Vector3()
  const followCamera = (point: FlatPoint, heading: number) => {
    chaseOffset.set(0, 0, -10).applyAxisAngle(new THREE.Vector3(0, 1, 0), heading)
    camera.position.set(point.x + chaseOffset.x, 6.5, point.z + chaseOffset.z)
    camera.lookAt(point.x + Math.sin(heading) * 3, 1.1, point.z + Math.cos(heading) * 3)
  }
  const sample = (point: FlatPoint, heading: number) => {
    car.object3D.position.set(point.x, 0, point.z); car.object3D.rotation.y = heading; car.object3D.updateWorldMatrix(true, true)
    followCamera(point, heading)
    const driver = driverAnchor.getWorldPosition(new THREE.Vector3()), door = doorAnchor.getWorldPosition(new THREE.Vector3())
    const outward = new THREE.Vector3(1.5, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), heading)
    const approach = door.add(outward); approach.y = 0
    const bodySeat: Point = { x: driver.x, y: driver.y - SEAT * BODY_SCALE, z: driver.z }
    const fallbackSeat: Point = { x: driver.x, y: driver.y + (0.13 - 1.05) * avatar.scale.y, z: driver.z }
    return { driver, approach, bodySeat, fallbackSeat }
  }
  const fallbackAt = (at: Point, heading: number, pose: ActorPose, stride = 0) => {
    avatar.position.set(at.x, at.y, at.z); avatar.rotation.y = heading
    poseAvatar(avatar, pose === 'sit' ? { pose: 'sit' } : pose === 'walk' ? { pose: 'walk', stride: (Math.sin(stride) + 1) / 2 } : { pose: pose === 'idle' ? 'stand' : 'stand' })
  }
  const setActorPose = (pose: ActorPose, animate: boolean, force = false) => {
    if (force || actorPose !== pose) {
      standIn.pose(pose === 'idle' ? 'stand' : pose, pose === 'sit' ? SEAT : undefined, animate)
      actorPose = pose
    }
  }
  const moveActor = (at: Point, heading: number, pose: ActorPose, fallback: Point, stride = 0) => {
    standIn.move(at.x, at.y, at.z, heading)
    setActorPose(pose, false)
    if (pose === 'walk') { standIn.gait(stride, false, at.y); actorPose = 'walk' }
    fallbackAt(fallback, heading, pose, stride)
  }
  const poseCar = (pose: Omit<VehiclePose, 'distance'> = {}) => poseVehicle(car, { ...pose, distance: wheelDistance })
  const placeCar = (nextState: DrivingState) => {
    car.object3D.position.set(nextState.position.x, 0, nextState.position.z)
    car.object3D.rotation.y = nextState.heading; car.object3D.updateWorldMatrix(true, true)
    followCamera(nextState.position, nextState.heading)
  }
  const showParked = (nextState: DrivingState) => {
    placeCar(nextState)
    const anchors = sample(nextState.position, nextState.heading)
    standIn.move(anchors.bodySeat.x, anchors.bodySeat.y, anchors.bodySeat.z, nextState.heading)
    if (actorPose !== 'sit') setActorPose('sit', false, true)
    fallbackAt(anchors.fallbackSeat, nextState.heading, 'sit')
  }
  const syncLoadedBody = () => {
    if (disposed) return
    if (phase === 'enter-door' && actorPose === 'idle') setActorPose('stand', true, true)
    else if (phase === 'enter-walk') setActorPose('walk', false, true)
    else if (phase === 'enter-seat' || phase === 'drive') setActorPose('sit', false, true)
    else if (phase === 'exit-door') setActorPose('stand', true, true)
    else if (phase === 'exit-walk') setActorPose('walk', false, true)
    else if (phase === 'idle' && state && state.status !== 'running') setActorPose('sit', false, true)
    schedule()
  }
  let partialStandIn: StandIn | null = null
  try {
    partialStandIn = createStandIn(kit, syncLoadedBody)
    partialStandIn.wear(sceneLook(look), seed)
    partialStandIn.attach({ group: scene, avatar, scale: BODY_SCALE })
  } catch (error) {
    partialStandIn?.dispose(); car.userData.dispose(); avatar.userData.dispose(); kit.dispose(); renderer.dispose(); scene.clear(); throw error
  }
  standIn = partialStandIn!
  followCamera(first, initialHeading)
  const clockNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  const render = () => {
    if (!visible || disposed) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width && rect.height) {
      renderer.setSize(Math.max(1, Math.floor(rect.width)), Math.max(1, Math.floor(rect.height)), false)
      renderer.render(scene, camera); lastDraw = clockNow()
      if (firstFrame) { firstFrame = false; standIn.start(renderer) }
    }
    renderPending = false
  }
  const schedule = () => {
    renderPending = true
    if (frame || !visible || disposed) return
    frame = requestAnimationFrame(tick)
  }
  function tick(now: number): void {
    frame = 0
    if (!visible || disposed) return
    const due = reduceMotion ? now - lastDraw >= 100 : now - lastDraw >= 1000 / 30
    if (!due) { schedule(); return }
    const dt = Math.min(0.1, Math.max(0.001, (now - (lastDraw || now - 1000 / 30)) / 1000))
    clock += dt
    const bodyAnimating = standIn.step(dt)
    if (phase === 'enter-door') {
      phaseTime += dt
      const at = state?.position ?? first, heading = state?.heading ?? initialHeading, anchors = sample(at, heading)
      standIn.move(anchors.approach.x, anchors.approach.y, anchors.approach.z, heading)
      fallbackAt(anchors.approach, heading, 'stand')
      poseCar({ door: Math.min(1, phaseTime / 0.2), time: clock })
      if (phaseTime >= (reduceMotion ? 0.08 : 0.2) && !standIn.easing) { phase = 'enter-walk'; phaseTime = 0; setActorPose('walk', false, true) }
      else if (phaseTime > 1.5 && standIn.easing) standIn.settle()
    } else if (phase === 'enter-walk') {
      phaseTime += dt; stridePhase += dt * 7
      const at = state?.position ?? first, heading = state?.heading ?? initialHeading, a = sample(at, heading)
      const t = Math.min(1, phaseTime / (reduceMotion ? 0.24 : 0.62))
      const walking: Point = { x: a.approach.x + (a.bodySeat.x - a.approach.x) * t, y: a.bodySeat.y * t, z: a.approach.z + (a.bodySeat.z - a.approach.z) * t }
      const fallback: Point = { x: a.approach.x + (a.fallbackSeat.x - a.approach.x) * t, y: a.fallbackSeat.y * t, z: a.approach.z + (a.fallbackSeat.z - a.approach.z) * t }
      moveActor(walking, heading, 'walk', fallback, stridePhase)
      poseCar({ door: 1, time: clock })
      if (t >= 1) { phase = 'enter-seat'; phaseTime = 0; standIn.move(a.bodySeat.x, a.bodySeat.y, a.bodySeat.z, heading); fallbackAt(a.fallbackSeat, heading, 'sit'); setActorPose('sit', !reduceMotion, true); if (reduceMotion && standIn.easing) standIn.settle() }
    } else if (phase === 'enter-seat') {
      phaseTime += dt
      const at = state?.position ?? first, heading = state?.heading ?? initialHeading, a = sample(at, heading)
      const doorCloseDuration = reduceMotion ? 0.1 : 0.22
      moveActor(a.bodySeat, heading, 'sit', a.fallbackSeat)
      poseCar({ door: Math.max(0, 1 - phaseTime / doorCloseDuration), time: clock })
      if (phaseTime > (reduceMotion ? 0.25 : 1.5) && standIn.easing) standIn.settle()
      if (phaseTime >= doorCloseDuration && !standIn.easing) { phase = 'drive'; phaseTime = 0; const callback = ready; ready = null; callback?.() }
    } else if (phase === 'exit-door') {
      phaseTime += dt
      const current = state ?? initialState(first, initialHeading), a = sample(current.position, current.heading)
      moveActor(a.bodySeat, current.heading, 'stand', a.fallbackSeat)
      poseCar({ door: Math.min(1, phaseTime / 0.2), time: clock })
      if (phaseTime >= (reduceMotion ? 0.08 : 0.2) && !standIn.easing) { phase = 'exit-walk'; phaseTime = 0; setActorPose('walk', false, true) }
      else if (phaseTime > 1.5 && standIn.easing) standIn.settle()
    } else if (phase === 'exit-walk') {
      phaseTime += dt; stridePhase += dt * 7
      const current = state ?? initialState(first, initialHeading), a = sample(current.position, current.heading)
      const t = Math.min(1, phaseTime / (reduceMotion ? 0.24 : 0.62))
      const walking: Point = { x: a.bodySeat.x + (a.approach.x - a.bodySeat.x) * t, y: a.bodySeat.y * (1 - t), z: a.bodySeat.z + (a.approach.z - a.bodySeat.z) * t }
      const fallback: Point = { x: a.fallbackSeat.x + (a.approach.x - a.fallbackSeat.x) * t, y: a.fallbackSeat.y * (1 - t), z: a.fallbackSeat.z + (a.approach.z - a.fallbackSeat.z) * t }
      moveActor(walking, current.heading, 'walk', fallback, stridePhase)
      poseCar({ door: Math.max(0, 1 - Math.max(0, phaseTime - 0.3) / 0.2), time: clock })
      if (t >= 1) { phase = 'idle'; phaseTime = 0; ready = null; setActorPose('stand', false, true); schedule() }
    } else if (phase === 'drive' && state) {
      placeCar(state)
      const a = sample(state.position, state.heading)
      moveActor(a.bodySeat, state.heading, 'sit', a.fallbackSeat)
      poseCar({ steering: input.steer * 0.62, brake: input.brake, time: clock })
    }
    if (renderPending || bodyAnimating || phase !== 'idle' && phase !== 'drive') render()
    if (bodyAnimating || phase !== 'idle' && phase !== 'drive') schedule()
  }
  const fit = (width: number, height: number): void => {
    if (disposed) return
    const w = Math.max(1, Math.floor(width)), h = Math.max(1, Math.floor(height))
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); schedule()
  }
  schedule()
  return {
    present(next) {
      if (previousPoint) {
        const distance = Math.hypot(next.position.x - previousPoint.x, next.position.z - previousPoint.z)
        wheelDistance = (wheelDistance + Math.min(8, distance)) % WHEEL_CIRCUMFERENCE
      }
      previousPoint = { ...next.position }; state = next
      if (phase === 'drive') { placeCar(next); const a = sample(next.position, next.heading); moveActor(a.bodySeat, next.heading, 'sit', a.fallbackSeat); poseCar({ steering: input.steer * 0.62, brake: input.brake, time: clock }) }
      else if (phase === 'idle' && next.status !== 'running') { showParked(next); poseCar({ brake: 1, time: clock }) }
      schedule()
    },
    setInput(next) { input = next; if (phase === 'drive') poseCar({ steering: input.steer * 0.62, brake: input.brake, time: clock }); schedule() },
    setReducedMotion(on) { reduceMotion = on; if (on && (phase === 'enter-door' || phase === 'enter-seat' || phase === 'exit-door') && standIn.easing) standIn.settle(); schedule() },
    begin(onReady) {
      phase = 'enter-door'; phaseTime = 0; ready = onReady ?? null
      const at = state?.position ?? first, heading = state?.heading ?? initialHeading, a = sample(at, heading)
      standIn.move(a.approach.x, a.approach.y, a.approach.z, heading)
      if (standIn.shown || actorPose !== 'idle') setActorPose('stand', !reduceMotion, true)
      if (reduceMotion && standIn.easing) standIn.settle()
      fallbackAt(a.approach, heading, 'stand'); poseCar({ door: 0, time: clock }); schedule()
    },
    exit() {
      phase = 'exit-door'; phaseTime = 0; ready = null
      if (state) { const a = sample(state.position, state.heading); standIn.move(a.bodySeat.x, a.bodySeat.y, a.bodySeat.z, state.heading); setActorPose('stand', !reduceMotion, true); if (reduceMotion && standIn.easing) standIn.settle(); fallbackAt(a.fallbackSeat, state.heading, 'sit') }
      poseCar({ door: 0, time: clock }); schedule()
    },
    setVisible(on) { visible = on; if (on) { lastDraw = 0; schedule() } else { if (frame) cancelAnimationFrame(frame); frame = 0; lastDraw = 0 } },
    resize: fit,
    dispose() { if (disposed) return; disposed = true; ready = null; if (frame) cancelAnimationFrame(frame); frame = 0; standIn.dispose(); car.userData.dispose(); avatar.userData.dispose(); kit.dispose(); renderer.dispose(); scene.clear() },
  }
}
