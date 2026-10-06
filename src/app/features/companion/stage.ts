// The companion's own small 3D stage: a transparent canvas with its own renderer, camera and two lights, drawing only the model.
// It is separate from the venue scene on purpose: the scene draws on demand and stays idle when nothing moves, while the companion
// breathes. The loop here runs only while the canvas is shown and the page is visible, at no more than 30 frames a second, and
// draws nothing at all under reduced motion except for a moment after something changes. Nothing is allocated per frame.
import type { CompanionBase, CompanionPose, CompanionRig } from './model.ts'

export interface Stage {
  readonly rig: CompanionRig
  readonly triangles: number
  play(pose: CompanionPose, ms?: number): void
  base(pose: CompanionBase): void
  talk(on: boolean): void
  look(x: number, y: number): void
  point(x: number, y: number): void
  resize(px: number): void
  /** Run the loop (true) or stop it (false); a stopped stage keeps its last frame. */
  run(on: boolean): void
  reduced(on: boolean): void
  dispose(): void
}

const FRAME_MS = 1000 / 30
/** After a change under reduced motion, keep drawing this long so a pose settles. */
const SETTLE_MS = 900

export async function createStage(canvas: HTMLCanvasElement, px: number, reduced: boolean): Promise<Stage> {
  const THREE = await import('three')
  const { buildCompanion } = await import('./model.ts')
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' })
  renderer.setClearColor(0x000000, 0)
  const ratio = Math.min(2, globalThis.devicePixelRatio || 1)
  renderer.setPixelRatio(ratio)
  renderer.setSize(px, px, false)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 20)
  camera.position.set(0, 0.1, 3.9)
  camera.lookAt(0, 0.1, 0)
  scene.add(new THREE.HemisphereLight(0xfff4dc, 0xb99066, 2.1))
  const sun = new THREE.DirectionalLight(0xffffff, 1.6)
  sun.position.set(-2, 3, 4)
  scene.add(sun)
  const rig = buildCompanion(THREE, { reduced })
  scene.add(rig.object)

  let running = false, frame = 0, last = 0, clock = 0, settleUntil = 0, still = reduced, disposed = false
  const draw = (): void => { renderer.render(scene, camera) }
  const tick = (now: number): void => {
    frame = 0
    if (!running || disposed) return
    if (now - last >= FRAME_MS - 1) {
      const dt = last ? (now - last) / 1000 : 1 / 30
      last = now; clock += Math.min(dt, 0.1)
      rig.update(dt, clock)
      draw()
    }
    if (!still || now < settleUntil) frame = requestAnimationFrame(tick)
    else running = false
  }
  const start = (): void => { if (!frame && !disposed) { running = true; frame = requestAnimationFrame(tick) } }
  const poke = (): void => { settleUntil = performance.now() + SETTLE_MS; if (still && !running) start() }

  rig.update(0.016, 0)
  draw()
  return {
    rig, triangles: rig.triangles,
    play(pose, ms) { rig.play(pose, ms); poke() },
    base(pose) { rig.setBase(pose); poke() },
    talk(on) { rig.setTalking(on); poke() },
    look(x, y) { rig.lookAt(x, y); if (still) poke() },
    point(x, y) { rig.pointAt(x, y); poke() },
    resize(size) { renderer.setSize(size, size, false); draw() },
    run(on) {
      if (disposed) return
      if (on) { last = 0; if (!still) start(); else { poke(); start() } } else { running = false; if (frame) { cancelAnimationFrame(frame); frame = 0 } }
    },
    reduced(on) { still = on; rig.setReduced(on); if (!on) start(); else poke() },
    dispose() { disposed = true; running = false; if (frame) cancelAnimationFrame(frame); rig.dispose(); renderer.dispose() },
  }
}
