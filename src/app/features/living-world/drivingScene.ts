import type { WebGLRenderer } from 'three'
import type { DrivingInput, DrivingRoute, DrivingState } from '../../../game/living-world/driving.ts'
import type { Look } from '../../../types/life.ts'
import type { RiggedAvatar } from '../../../scene/characters.ts'
import type { VehicleModel } from '../../../models/vehicles/index.ts'

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

/** The feature is dynamically imported; Three and the shared scene builders stay out of startup. */
export async function createDrivingScene(canvas: HTMLCanvasElement, route: DrivingRoute, look: Look, reducedMotion: boolean): Promise<DrivingScene> {
  const THREE = await import('three')
  const [{ createKit }, { buildAvatar, poseAvatar }, { buildVehicle, poseVehicle }, { sceneLook }] = await Promise.all([
    import('../../../scene/kit.ts'), import('../../../scene/characters.ts'), import('../../../models/vehicles/index.ts'), import('../start/lookModel.ts'),
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
  const ground = kit.box(0, -0.35, 0, 150, 0.5, 150, '#87a982', scene)
  ground.receiveShadow = true

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const road of route.roads) for (let i = 1; i < road.length; i++) {
    const a = road[i - 1]!, b = road[i]!, dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz)
    minX = Math.min(minX, a.x, b.x); maxX = Math.max(maxX, a.x, b.x); minZ = Math.min(minZ, a.z, b.z); maxZ = Math.max(maxZ, a.z, b.z)
    const angle = Math.atan2(dx, dz), mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2
    const roadMesh = kit.box(mx, -0.06, mz, route.roadWidth, 0.12, length + 0.2, '#4a5054', scene); roadMesh.rotation.y = angle
    const stripe = kit.box(mx, 0.012, mz, 0.12, 0.025, Math.max(1, length * 0.72), '#f4d46b', scene); stripe.rotation.y = angle
  }
  for (const [index, checkpoint] of route.checkpoints.entries()) {
    const marker = kit.box(checkpoint.center.x, 0.12, checkpoint.center.z, 1.1, 0.24, 1.1, checkpoint.stopRequired ? '#e9a94d' : '#4eb6bd', scene)
    marker.name = `practice-checkpoint-${index + 1}`
  }
  const target = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2)
  camera.position.set(target.x - 14, Math.max(28, (maxZ - minZ) * 0.75), target.z - 24); camera.lookAt(target)

  let car: VehicleModel | undefined, avatar: RiggedAvatar | undefined
  try {
    car = buildVehicle('sedan', { detail: 'map', time: 'day', color: '#356fa8' }); scene.add(car.object3D)
    avatar = buildAvatar(kit, sceneLook(look), { rig: true, detail: 'low' }); scene.add(avatar)
  } catch (error) {
    car?.userData.dispose(); avatar?.userData.dispose(); kit.dispose(); renderer.dispose(); scene.clear(); throw error
  }
  if (!car || !avatar) throw new Error('Driving scene models could not be created.')
  const driverAnchor = car.userData.anchors.driver
  const doorAnchor = car.userData.anchors.door
  const seatedOffset = (0.6 + 0.13 - 1.05) * avatar.scale.y // canonical drawAvatar(..., pose:'sit') lift, including look proportions
  const anchorsAt = (point: { x: number; z: number }, heading: number) => {
    car.object3D.position.set(point.x, 0, point.z); car.object3D.rotation.y = heading
    car.object3D.updateWorldMatrix(true, true)
    const driver = driverAnchor.getWorldPosition(new THREE.Vector3())
    const door = doorAnchor.getWorldPosition(new THREE.Vector3())
    const outward = new THREE.Vector3(1.5, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), heading)
    const approach = door.add(outward); approach.y = 0
    const seat = driver.clone(); seat.y += seatedOffset
    return { approach, seat }
  }
  const first = route.roads[0]![0]!, second = route.roads[0]![1]!
  const initialHeading = Math.atan2(second.x - first.x, second.z - first.z)
  const presentParked = (next: DrivingState) => {
    const points = anchorsAt(next.position, next.heading)
    avatar.position.copy(points.seat); avatar.rotation.y = next.heading
    poseAvatar(avatar, { pose: 'sit' })
  }
  let state: DrivingState | null = null, input: DrivingInput = { throttle: 0, brake: 0, steer: 0 }, visible = true, disposed = false, phase: 'idle' | 'enter' | 'drive' | 'exit' = 'idle'
  let phaseTime = 0, clock = 0, lastDraw = 0, frame = 0, renderPending = false, reduceMotion = reducedMotion, ready: (() => void) | null = null
  const render = (): void => { if (!disposed && visible) renderer.render(scene, camera) }
  const draw = (): void => { renderPending = true; schedule() }
  const schedule = (): void => { if (!disposed && visible && !frame) frame = requestAnimationFrame(tick) }
  const tick = (now: number): void => {
    frame = 0
    if (disposed || !visible) return
    const due = !lastDraw || now - lastDraw >= 1000 / 30 - 1
    const animating = phase === 'enter' || phase === 'exit'
    if (due) {
      const dt = lastDraw ? Math.min(0.05, (now - lastDraw) / 1000) : 1 / 30
      lastDraw = now; clock += dt
      if (phase !== 'idle' && phase !== 'drive') {
        phaseTime += dt
        const duration = reduceMotion ? 0.12 : phase === 'enter' ? 0.8 : 1.5
        const t = Math.min(1, phaseTime / duration)
        if (phase === 'enter') {
          const doorAmount = t < 0.34 ? t / 0.34 : t < 0.72 ? 1 : 1 - (t - 0.72) / 0.28
          const points = anchorsAt(state?.position ?? first, state?.heading ?? initialHeading)
          poseVehicle(car, { door: doorAmount, time: clock })
          const walkT = Math.max(0, Math.min(1, (t - 0.34) / 0.48))
          avatar.position.lerpVectors(points.approach, points.seat, walkT)
          avatar.rotation.y = Math.atan2(points.seat.x - points.approach.x, points.seat.z - points.approach.z)
          poseAvatar(avatar, { pose: t >= 0.82 ? 'sit' : walkT > 0 ? 'walk' : 'stand', stride: walkT > 0 && walkT < 1 ? 0.55 : 0 })
          if (t >= 1) { phase = 'drive'; const onReady = ready; ready = null; onReady?.() }
        } else {
          const t2 = Math.min(1, phaseTime / duration)
          const doorAmount = t2 < 0.22 ? t2 / 0.22 : t2 < 0.75 ? 1 : 1 - (t2 - 0.75) / 0.25
          const points = anchorsAt(state?.position ?? first, state?.heading ?? initialHeading)
          poseVehicle(car, { door: doorAmount, time: clock })
          avatar.position.lerpVectors(points.seat, points.approach, t2)
          poseAvatar(avatar, { pose: t2 > 0.75 ? 'walk' : 'stand', stride: t2 > 0.75 ? 0.55 : 0 })
          if (t2 >= 1) phase = 'idle'
        }
      }
      if (state && phase === 'drive') {
        anchorsAt(state.position, state.heading)
        poseVehicle(car, { distance: state.speed * dt, steering: input.steer * 0.62, brake: input.brake, time: clock })
        const points = anchorsAt(state.position, state.heading)
        avatar.position.copy(points.seat); avatar.rotation.y = state.heading
        poseAvatar(avatar, { pose: 'sit' })
      }
      if (renderPending || animating) render()
      renderPending = false
    }
    if (animating || renderPending) schedule()
  }
  const fit = (width: number, height: number): void => {
    if (disposed) return
    const w = Math.max(1, Math.floor(width)), h = Math.max(1, Math.floor(height))
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); draw()
  }
  draw()
  return {
    present(next) {
      state = next
      if (phase === 'drive' || phase === 'idle') { presentParked(next); poseVehicle(car, { brake: input.brake, steering: input.steer * 0.62, time: clock }) }
      draw()
    },
    setInput(next) { input = next; draw() },
    setReducedMotion(on) { reduceMotion = on; if (on && (phase === 'enter' || phase === 'exit')) { phaseTime = phase === 'enter' ? 0.8 : 1.5; draw() } },
    begin(onReady) {
      phase = 'enter'; phaseTime = 0; ready = onReady ?? null
      const points = anchorsAt(state?.position ?? first, state?.heading ?? initialHeading)
      avatar.position.copy(points.approach); poseAvatar(avatar, { pose: 'stand' }); poseVehicle(car, { door: 0, time: clock }); schedule()
    },
    exit() { phase = 'exit'; phaseTime = 0; ready = null; if (state) presentParked(state); schedule() },
    setVisible(on) { visible = on; if (on) { lastDraw = 0; draw() } else { if (frame) cancelAnimationFrame(frame); frame = 0; lastDraw = 0 } },
    resize: fit,
    dispose() { if (disposed) return; disposed = true; if (frame) cancelAnimationFrame(frame); frame = 0; car.userData.dispose(); avatar.userData.dispose(); kit.dispose(); renderer.dispose(); scene.clear() },
  }
}
