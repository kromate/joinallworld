// Lumo, the companion: a small hovering lantern spirit built from primitives. One skinned mesh (rigid bones, vertex colours,
// one draw call) plus one additive halo (a second draw call). Three.js arrives as a parameter so the module can load lazily.
import type { Bone, BufferGeometry, Color, Mesh, Object3D, SkinnedMesh } from 'three'
import { COMPANION_COLOURS as C } from './identity.ts'

export type CompanionPose = 'idle' | 'wave' | 'point' | 'nod' | 'celebrate' | 'think' | 'sleepy'
export type CompanionBase = 'idle' | 'think' | 'sleepy'

export interface CompanionRig {
  /** Add this to a scene; contains the character and its glow. About 1.7 units tall, centred on the origin, facing +z. */
  readonly object: Object3D
  /** Advance animation. dt seconds (clamped), t = running seconds. Allocates nothing. */
  update(dt: number, t: number): void
  /** 'idle', 'think' and 'sleepy' are held until changed; 'wave', 'nod', 'celebrate' and 'point' are timed (ms) and return to the held pose. */
  play(pose: CompanionPose, ms?: number): void
  setBase(pose: CompanionBase): void
  setTalking(on: boolean): void
  /** Normalised -1..1 direction (screen right +x, up +y) the eyes and head turn toward. */
  lookAt(x: number, y: number): void
  /** Normalised -1..1 direction the pointing arm and antenna aim at (used with play('point')). */
  pointAt(x: number, y: number): void
  setReduced(on: boolean): void
  readonly triangles: number
  readonly drawCalls: number
  dispose(): void
}

type Vec3 = readonly [number, number, number]
const BONE = { root: 0, body: 1, armL: 2, armR: 3, eyeL: 4, eyeR: 5, mouth: 6, ant1: 7, ant2: 8, base: 9 } as const
// Rest position (world, character space) and parent of each bone.
const RIG: readonly { at: Vec3, parent: number }[] = [
  { at: [0, 0, 0], parent: -1 },
  { at: [0, 0, 0], parent: BONE.root },
  { at: [-0.47, 0.02, 0.04], parent: BONE.body },
  { at: [0.47, 0.02, 0.04], parent: BONE.body },
  { at: [-0.17, 0.15, 0.53], parent: BONE.body },
  { at: [0.17, 0.15, 0.53], parent: BONE.body },
  { at: [0, -0.1, 0.55], parent: BONE.body },
  { at: [0, 0.56, 0], parent: BONE.body },
  { at: [0, 0.84, 0], parent: BONE.ant1 },
  { at: [0, -0.56, 0], parent: BONE.root },
]

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const HOLD_MS = 1600
const DEFAULT_MS: Record<CompanionPose, number> = { idle: 0, think: 0, sleepy: 0, wave: 1800, point: 2200, nod: 1300, celebrate: 2000 }

export function buildCompanion(THREE: typeof import('three'), options: { reduced?: boolean } = {}): CompanionRig {
  const pos: number[] = [], col: number[] = [], glowAttr: number[] = [], skinIdx: number[] = [], skinW: number[] = [], index: number[] = []
  const c1 = new THREE.Color(), c2 = new THREE.Color(), cm = new THREE.Color()

  /** Append a geometry (already placed in character space) bound to one bone, coloured bottom-to-top, with a glow weight (0 lit, 1 self-lit). */
  function put(geo: BufferGeometry, bone: number, glow: number, from: string, to: string = from): void {
    geo.computeBoundingBox()
    const box = geo.boundingBox!
    const span = Math.max(1e-4, box.max.y - box.min.y)
    c1.set(from); c2.set(to)
    const p = geo.getAttribute('position')
    const base = pos.length / 3
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i))
      cm.copy(c1).lerp(c2, (p.getY(i) - box.min.y) / span)
      col.push(cm.r, cm.g, cm.b)
      glowAttr.push(glow)
      skinIdx.push(bone, 0, 0, 0); skinW.push(1, 0, 0, 0)
    }
    const ix = geo.index
    if (ix) for (let i = 0; i < ix.count; i++) index.push(base + ix.getX(i))
    else for (let i = 0; i < p.count; i++) index.push(base + i)
    geo.dispose()
  }
  const ball = (rx: number, ry: number, rz: number, x: number, y: number, z: number, w: number, h: number): BufferGeometry =>
    new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz).translate(x, y, z)
  const bowl = (rx: number, ry: number, rz: number, x: number, y: number, z: number, w: number, h: number): BufferGeometry =>
    new THREE.SphereGeometry(1, w, h, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(rx, ry, rz).translate(x, y, z)

  // Body: an egg, amber below and cream above, lightly self-lit so it reads as a lantern.
  put(ball(0.52, 0.6, 0.5, 0, 0, 0, 16, 11), BONE.body, 0.28, C.body, C.bodyLight)
  // Face plate: a broad dark oval proud of the front.
  put(ball(0.42, 0.33, 0.21, 0, 0.07, 0.35, 16, 9), BONE.body, 0, C.face)
  // Cheeks, on the plate.
  for (const s of [-1, 1]) put(ball(0.07, 0.04, 0.03, s * 0.3, -0.05, 0.49, 6, 4), BONE.body, 0.35, C.cheek)
  // Collar and base ring in the game's green.
  put(new THREE.CylinderGeometry(0.13, 0.19, 0.08, 12, 1).translate(0, 0.58, 0), BONE.body, 0, C.accent)
  put(new THREE.CylinderGeometry(0.4, 0.3, 0.12, 16, 1).translate(0, -0.56, 0), BONE.base, 0, C.accent)
  // Glowing underside of the base.
  put(new THREE.CircleGeometry(0.27, 12).rotateX(Math.PI / 2).translate(0, -0.63, 0), BONE.base, 1, C.glow)
  // Arms: stubby fins that hang from the shoulders, amber with a cheek-coloured tip.
  for (const s of [-1, 1]) {
    const bone = s < 0 ? BONE.armL : BONE.armR
    put(ball(0.105, 0.2, 0.1, s * 0.5, -0.16, 0.04, 8, 6), bone, 0, C.cheek, C.body)
  }
  // Eyes: big glowing ovals with a small spark.
  for (const s of [-1, 1]) {
    const bone = s < 0 ? BONE.eyeL : BONE.eyeR
    put(ball(0.105, 0.135, 0.045, s * 0.17, 0.15, 0.545, 8, 6), bone, 1, C.glow)
    put(ball(0.03, 0.036, 0.02, s * 0.17 + 0.03, 0.2, 0.585, 6, 4), bone, 1, '#ffffff')
  }
  // Mouth: a small bowl that opens when it talks.
  put(bowl(0.09, 0.07, 0.03, 0, -0.07, 0.56, 10, 4), BONE.mouth, 1, C.glow)
  // Antenna: a stem, a green leaf and a flame tuft.
  put(new THREE.CylinderGeometry(0.024, 0.032, 0.3, 6, 1, true).translate(0, 0.74, 0), BONE.ant1, 0, C.body)
  put(ball(0.085, 0.05, 0.02, 0, 0, 0, 6, 4).rotateZ(0.5).translate(0.085, 0.7, 0), BONE.ant1, 0, C.accent)
  put(ball(0.11, 0.12, 0.11, 0, 0.96, 0, 8, 6), BONE.ant2, 1, C.glow)
  put(new THREE.ConeGeometry(0.1, 0.22, 8, 1, true).translate(0, 1.09, 0), BONE.ant2, 1, C.glow, '#ffee9a')

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  geometry.setAttribute('aGlow', new THREE.Float32BufferAttribute(glowAttr, 1))
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIdx, 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinW, 4))
  geometry.setIndex(index)

  const glowUniform = { value: 1 }
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = glowUniform
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;\nuniform float uGlow;')
      .replace('#include <opaque_fragment>', 'outgoingLight = mix(outgoingLight, diffuseColor.rgb * uGlow, vGlow);\n#include <opaque_fragment>')
  }
  material.customProgramCacheKey = () => 'allworld-companion'

  // Skeleton: rigid bones at the rest positions above.
  const bones: Bone[] = RIG.map(() => new THREE.Bone())
  RIG.forEach((b, i) => {
    const parent = b.parent < 0 ? null : RIG[b.parent]!.at
    bones[i]!.position.set(b.at[0] - (parent ? parent[0] : 0), b.at[1] - (parent ? parent[1] : 0), b.at[2] - (parent ? parent[2] : 0))
    if (b.parent >= 0) bones[b.parent]!.add(bones[i]!)
  })
  const mesh: SkinnedMesh = new THREE.SkinnedMesh(geometry, material)
  mesh.frustumCulled = false
  mesh.add(bones[BONE.root]!)
  const root = new THREE.Group()
  root.add(mesh)
  mesh.position.y = -0.1
  root.updateMatrixWorld(true)
  const skeleton = new THREE.Skeleton(bones)
  mesh.bind(skeleton)

  // Halo: a soft warm disc, opaque at the heart and clear at the rim, drawn behind the body (no texture).
  const haloGeo = (() => {
    const seg = 16, rings = [[0, 0.75], [0.5, 0.3], [1, 0]] as const
    const hp: number[] = [], hc: number[] = [], hi: number[] = []
    for (const r of rings) {
      for (let i = 0; i < (r[0] === 0 ? 1 : seg); i++) {
        const a = (i / seg) * Math.PI * 2
        hp.push(Math.cos(a) * r[0], Math.sin(a) * r[0], 0)
        hc.push(1, 0.84, 0.36, r[1])
      }
    }
    for (let i = 0; i < seg; i++) {
      const n = (i + 1) % seg
      // the centre is vertex 0, the middle ring starts at 1 and the rim at 1 + seg
      hi.push(0, 1 + i, 1 + n)
      hi.push(1 + i, 1 + seg + i, 1 + seg + n, 1 + i, 1 + seg + n, 1 + n)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(hc, 4))
    g.setIndex(hi)
    return g
  })()
  const haloMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, fog: false })
  const halo: Mesh = new THREE.Mesh(haloGeo, haloMat)
  halo.frustumCulled = false
  halo.renderOrder = 1
  root.add(halo)

  const count = (g: BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3
  const triangles = count(geometry) + count(haloGeo)

  // ---- animation state (all preallocated) ----
  let reduced = !!options.reduced
  let base: CompanionBase = 'idle'
  let timed: CompanionPose | null = null
  let timedStart = 0, timedMs = 0
  let now = 0, talking = false
  let lookX = 0, lookY = 0, pointX = 0.6, pointY = 0.5
  let seed = 12345
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  let nextBlink = 2, blinkP = -1
  let syllableAt = 0, mouthTarget = 0
  // smoothed channels
  let sLookX = 0, sLookY = 0, sArmL = -0.3, sArmR = 0.3, sArmLen = 1, sLeanX = 0, sLeanZ = 0, sYaw = 0
  let sOpen = 1, sMouth = 0, sGlow = 1, sCurl = 0, sHop = 0, sSag = 0, sPoint = 0, sSwing = 0
  let sSmile = 0, sMouthX = 0

  const ease = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt))

  function update(dtIn: number, t: number): void {
    const dt = clamp(Number.isFinite(dtIn) ? dtIn : 0, 0, 0.05)
    now += dt
    if (timed && now >= timedStart + timedMs) timed = null
    const pose: CompanionPose = timed ?? base
    const u = timed ? clamp((now - timedStart) / timedMs, 0, 1) : 0
    const p = timed ? now - timedStart : 0
    const m = reduced ? 0 : 1

    // targets
    let tArmL = -0.32, tArmR = 0.32, tLeanX = 0, tLeanZ = 0, tYawExtra = 0, tHop = 0
    let tGlow = 1, tOpen = 1, tCurl = 0, tSag = 0, tSwing = 1, tSmile = 0.3, tMouthX = 0, tArmLen = 1
    let lx = lookX, ly = lookY
    let tPoint = 0, mouthOpenExtra = 0

    switch (pose) {
      case 'wave':
        tArmR = 0.5 + m * (2.1 + Math.sin(p * 13) * 0.32)
        tLeanZ = -0.07 * m; tGlow = 1.25; tSmile = 1
        break
      case 'point': {
        const ang = clamp(Math.atan2(pointX, -pointY), -2.7, 2.7)
        if (pointX >= 0) tArmR = 0.3 + m * (ang - 0.3); else tArmL = -0.3 + m * (ang + 0.3)
        tArmLen = 1 + 0.25 * m
        tLeanZ = -pointX * 0.14 * m; tLeanX = -pointY * 0.06 * m
        tPoint = pointX
        lx = pointX; ly = pointY
        tGlow = 1.2; tSmile = 0.6
        break
      }
      case 'nod': {
        const dip = Math.max(0, Math.sin(u * Math.PI * 4))
        tLeanX = 0.3 * dip * m; tHop = -0.04 * dip * m
        tOpen = 1 - 0.55 * dip; tSmile = 0.8
        break
      }
      case 'celebrate': {
        const hop = Math.abs(Math.sin(p * 8))
        tHop = 0.2 * hop * m
        tArmR = 0.5 + m * (2.15 + Math.sin(p * 18) * 0.25); tArmL = -tArmR
        tYawExtra = Math.sin(p * 6) * 0.3 * m
        tGlow = 1.7 + 0.25 * Math.sin(p * 14); tSmile = 1; mouthOpenExtra = 0.85
        break
      }
      case 'think':
        lx = 0.55; ly = 0.65
        tLeanZ = 0.16 * m; tYawExtra = -0.1 * m
        tGlow = 0.72; tCurl = 1 * m; tSwing = 0.3; tMouthX = 0.05; tSmile = 0; tOpen = 0.9
        tArmR = 0.3 + 0.55 * m
        break
      case 'sleepy':
        lx = lookX * 0.3; ly = -0.3
        tOpen = 0.26; tGlow = 0.6; tSag = 1 * m; tLeanX = 0.14 * m; tSwing = 0.3
        tArmL = -0.12; tArmR = 0.12; tSmile = 0
        break
      default:
        break
    }

    // blink
    if (blinkP < 0 && now >= nextBlink) blinkP = 0
    let blink = 1
    if (blinkP >= 0) {
      blinkP += dt / (pose === 'sleepy' ? 0.38 : 0.17)
      if (blinkP >= 1) { blinkP = -1; nextBlink = now + (rnd() < 0.18 ? 0.22 : 2 + rnd() * 3.2) }
      else blink = 1 - Math.sin(blinkP * Math.PI) * (pose === 'sleepy' ? 0.75 : 1)
    }

    // talking
    if (talking) {
      if (now >= syllableAt) {
        syllableAt = now + 0.07 + rnd() * 0.13
        mouthTarget = rnd() < 0.16 ? 0.05 : 0.3 + rnd() * 0.7
      }
    } else mouthTarget = 0
    const tMouth = Math.max(mouthTarget, mouthOpenExtra)

    // smoothing
    sLookX = ease(sLookX, lx, 9, dt); sLookY = ease(sLookY, ly, 9, dt)
    sArmL = ease(sArmL, tArmL, 14, dt); sArmR = ease(sArmR, tArmR, 14, dt)
    sArmLen = ease(sArmLen, tArmLen, 12, dt)
    sLeanX = ease(sLeanX, tLeanX, 10, dt); sLeanZ = ease(sLeanZ, tLeanZ, 8, dt)
    sYaw = ease(sYaw, lookX * 0.38 * m + tYawExtra, 7, dt)
    sOpen = ease(sOpen, tOpen, 12, dt)
    sMouth = ease(sMouth, tMouth, 22, dt)
    sGlow = ease(sGlow, tGlow + (talking ? 0.12 * Math.sin(t * 17) + 0.1 : 0), 10, dt)
    sCurl = ease(sCurl, tCurl, 5, dt); sHop = ease(sHop, tHop, 22, dt)
    sSag = ease(sSag, tSag, 4, dt); sPoint = ease(sPoint, tPoint, 10, dt); sSwing = ease(sSwing, tSwing, 5, dt)
    sSmile = ease(sSmile, tSmile, 10, dt); sMouthX = ease(sMouthX, tMouthX, 8, dt)

    // apply
    const slow = pose === 'sleepy' ? 0.55 : 1
    const bob = m * (Math.sin(t * 2.1 * slow) * 0.04 + sSag * -0.04)
    const tilt = m * Math.sin(t * 1.15 * slow) * 0.045
    bones[BONE.root]!.position.set(0, sHop + bob, 0)
    const body = bones[BONE.body]!
    body.rotation.set(sLeanX - clamp(lookY, -1, 1) * 0.16 * m, sYaw, tilt + sLeanZ)
    body.scale.set(1, 1 + m * Math.sin(t * 2.6 * slow) * 0.012, 1)
    bones[BONE.base]!.rotation.set(0, 0, -(tilt + sLeanZ) * 0.6)
    const al = bones[BONE.armL]!, ar = bones[BONE.armR]!
    const flap = m * Math.sin(t * 2.1 * slow + 1) * 0.04
    al.rotation.set(0, 0, sArmL - flap); ar.rotation.set(0, 0, sArmR + flap)
    al.scale.set(1, pose === 'point' && pointX < 0 ? sArmLen : 1, 1)
    ar.scale.set(1, pose === 'point' && pointX >= 0 ? sArmLen : 1, 1)

    const open = sOpen * blink
    const ex = sLookX * 0.05, ey = sLookY * 0.04 - (1 - sOpen) * 0.03
    const happy = pose === 'celebrate' || pose === 'wave' ? 0.88 : 1
    const eyeL = bones[BONE.eyeL]!, eyeR = bones[BONE.eyeR]!
    eyeL.position.set(RIG[BONE.eyeL]!.at[0] + ex, RIG[BONE.eyeL]!.at[1] + ey - RIG[BONE.body]!.at[1], RIG[BONE.eyeL]!.at[2])
    eyeR.position.set(RIG[BONE.eyeR]!.at[0] + ex, RIG[BONE.eyeR]!.at[1] + ey - RIG[BONE.body]!.at[1], RIG[BONE.eyeR]!.at[2])
    const sc = Math.max(0.07, open * happy)
    eyeL.scale.set(1 + (1 - sc) * 0.12, sc, 1); eyeR.scale.set(1 + (1 - sc) * 0.12, sc, 1)

    const mouth = bones[BONE.mouth]!
    mouth.position.set(RIG[BONE.mouth]!.at[0] + ex * 0.6 + sMouthX, RIG[BONE.mouth]!.at[1] + sLookY * 0.02 - sMouth * 0.02, RIG[BONE.mouth]!.at[2])
    mouth.scale.set(1 - sMouth * 0.22 + sSmile * 0.15, 0.3 + sSmile * 0.35 + sMouth * 1.3, 1)

    const sway = Math.sin(t * 2.4 * slow) * 0.13 * sSwing * m
    const a1 = bones[BONE.ant1]!, a2 = bones[BONE.ant2]!
    a1.rotation.set(0, 0, sway - sPoint * 0.35 * m + sCurl * 0.5 - sSag * 0.35)
    a2.rotation.set(0, 0, Math.sin(t * 2.4 * slow - 0.9) * 0.2 * sSwing * m - sPoint * 0.25 * m + sCurl * 0.85 - sSag * 0.5)

    glowUniform.value = clamp(sGlow, 0.35, 1.9)
    const pulse = reduced ? 1 : 1 + 0.05 * Math.sin(t * 3)
    const hs = (1.0 + 0.25 * clamp(sGlow - 1, -1, 1)) * pulse
    halo.scale.set(hs, hs, 1)
    halo.position.set(0, bones[BONE.root]!.position.y - 0.02, -0.55)
    haloMat.opacity = clamp(0.35 + 0.35 * sGlow, 0.2, 1)
  }

  const rig: CompanionRig = {
    object: root,
    update,
    play(pose, ms) {
      if (pose === 'idle' || pose === 'think' || pose === 'sleepy') { base = pose; timed = null; return }
      timed = pose; timedStart = now; timedMs = Math.max(200, ms ?? DEFAULT_MS[pose] ?? HOLD_MS) / 1000
    },
    setBase(pose) { base = pose },
    setTalking(on) { talking = on },
    lookAt(x, y) { lookX = clamp(Number.isFinite(x) ? x : 0, -1, 1); lookY = clamp(Number.isFinite(y) ? y : 0, -1, 1) },
    pointAt(x, y) { pointX = clamp(Number.isFinite(x) ? x : 0, -1, 1); pointY = clamp(Number.isFinite(y) ? y : 0, -1, 1) },
    setReduced(on) { reduced = on },
    triangles,
    drawCalls: 2,
    dispose() {
      geometry.dispose(); material.dispose(); haloGeo.dispose(); haloMat.dispose(); skeleton.dispose()
      root.remove(mesh); root.remove(halo)
    },
  }
  return rig
}
