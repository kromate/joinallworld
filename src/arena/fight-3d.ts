/**
 * OWNER: games (real-time)
 * FIGHT IN 3D: the same server-judged fight (./fight.ts) drawn with three.js on the phone. The rules are a side view, 1000 units wide;
 * this view puts them in a ring at their own scale (a fighter's body is 105 units, so 1.8 m fighters make the stage 15.8 m between
 * the walls) and plays each fighter's animation clips from what the snapshot says: idle and walking, punch and kick timed so the
 * strike lands on the tick the server counts it, block, the hit reaction, the knock-down and the winner's cheer, with crossfades so
 * nothing pops. The camera follows the pair, closes in as they close, shakes on a hit and turns round the fighter who went down.
 * HUD and banners are drawn over it by ./fight-draw.ts (drawFightHud), so both views read the same.
 *
 * ASSETS (manifests in scripts/assets/manifests/, licences in Help): two CC0 KayKit fighters with their clips, and our own ring from
 * scripts/assets/blender/ring.py. About 0.5 MB in all, about 7,300 triangles, under 20 draw calls, one light, no shadow map.
 * A lazy chunk: the Games hub warms it (preloadFight) and the Fight screen fetches it when it opens, and draws the 2D view until it is ready (or for ever, without WebGL).
 */
import { THREE, Shake, FrameStats, MEDIAN_FRAMES, blobShadow, cloneSkinned, disposeScene, lambertise, loadGlb, makeRenderer, nextLevel, ratioLadder } from './three/kit.ts'
import type { RatioState } from './three/kit.ts'
import { ASSET_VERSIONS } from './asset-versions.generated.ts'
import { ACT, ARENA_W, BODY_H, HZ, MOVES, PHASE } from './fight.ts'
import type { FighterSnap, FightSnap } from './fight.ts'
import { defaultNativeLook, nativeFightersAllowed, unpackNativeLook } from './native-look.ts'
import type { ArenaNative } from '../types/arena.ts'
import { shakeReduced } from '../scene/feel/reduce.ts'
import { createHitStop } from '../scene/feel/hitstop.ts'
import { fightHitStopMs } from '../scene/feel/tiers.ts'
import { clipsFor, spawnNativeFighter, warmNative } from './fight-native.ts'
import type { NativeFighter } from './fight-native.ts'

/** A model's URL with its content version (asset-versions.generated.ts): /assets/ is cached for a year, so a changed file needs a new URL. */
const versioned = (path: string): string => `${path}?v=${ASSET_VERSIONS[path] ?? 'x'}`
export const FIGHT_ASSETS = Object.freeze({
  fighters: [versioned('/assets/packs/kaykit-adventurers/fighter-1.glb'), versioned('/assets/packs/kaykit-adventurers/fighter-2.glb')] as const,
  ring: versioned('/assets/packs/allworld-fight/ring-wide.glb'),
  clips: versioned('/assets/packs/allworld-fight/native-fight-clips.glb'),
})
/** Whether this phone draws the players' own characters (enough memory and cores, WebGL 2); otherwise the stylised fighters. */
export function nativeAllowedHere(): boolean {
  const nav = (globalThis.navigator ?? {}) as { deviceMemory?: number; hardwareConcurrency?: number }
  let webgl2 = false
  try { webgl2 = !!document.createElement('canvas').getContext('webgl2') } catch { webgl2 = false }
  return nativeFightersAllowed({ ...(nav.deviceMemory !== undefined ? { deviceMemory: nav.deviceMemory } : {}), ...(nav.hardwareConcurrency !== undefined ? { hardwareConcurrency: nav.hardwareConcurrency } : {}), webgl2 })
}
/** Fetch and parse the Fight models ahead of the screen (the Games hub does this when it opens and when the browser is idle). */
export function preloadFight(): Promise<unknown> {
  if (nativeAllowedHere()) return Promise.all([loadGlb(FIGHT_ASSETS.ring), loadGlb(FIGHT_ASSETS.clips), warmNative()])
  return Promise.all([...FIGHT_ASSETS.fighters, FIGHT_ASSETS.ring].map((url) => loadGlb(url)))
}
/** A few seconds to get the real characters; after that the stylised fighters are used (`globalThis.allworldFightNativeWaitMs` overrides it, for measuring on a slow dev machine). */
export const NATIVE_WAIT_MS = 8000
/** How fast the walk clip's feet match the ground, metres a second (the clip's own speed); the playback rate follows the real speed. */
export const WALK_SPEED = 1.5
/** Metres per rules unit: a fighter's 105-unit body is 1.8 m tall. */
export const UNIT = 1.8 / BODY_H
/** The canvas is this high above the floor (scripts/assets/blender/ring.py). */
export const CANVAS_Y = 1.0
export const FIGHTER_HEIGHT = 1.8

/** Where a rules position is in the ring. */
export const toWorld = (x: number, y: number): { x: number; y: number } => ({ x: (x - ARENA_W / 2) * UNIT, y: CANVAS_Y + y * UNIT })

export type Clip = 'idle' | 'walk' | 'walk-back' | 'punch' | 'punch-2' | 'kick' | 'blocking' | 'block-hit' | 'hit' | 'hit-2' | 'down' | 'cheer'
/** Clips that play once and hold their last frame. */
export const ONCE: ReadonlySet<Clip> = new Set(['punch', 'punch-2', 'kick', 'block-hit', 'hit', 'hit-2', 'down'])

/**
 * The clip a fighter should be showing, pure. `speed` is metres a second towards (+) or away from (-) the other fighter;
 * `blockHit` is true for a moment after a blocked hit; `won` once the match is over and this seat won.
 */
export function clipFor(f: FighterSnap, speed: number, opts: { blockHit: boolean; strongHit: boolean; won: boolean; punchAlt: boolean }): Clip {
  const act = f[3], blocking = (f[6] & 1) !== 0
  if (act === ACT.ko || f[5] <= 0) return 'down'
  if (opts.won) return 'cheer'
  if (act === ACT.hurt) return opts.strongHit ? 'hit-2' : 'hit'
  if (act === ACT.punch) return opts.punchAlt ? 'punch-2' : 'punch'
  if (act === ACT.kick) return 'kick'
  if (blocking) return opts.blockHit ? 'block-hit' : 'blocking'
  if (Math.abs(speed) > 0.35) return speed > 0 ? 'walk' : 'walk-back'
  return 'idle'
}
/** How fast an attack clip plays so its whole swing fits the move's ticks (it lands when the server says it lands). */
export const attackScale = (clipSeconds: number, act: number): number => {
  const move = MOVES[act as 1 | 2]
  return move ? clipSeconds / (move.total / HZ) : 1
}
/** The camera's vertical field of view for a screen shape: wider on a tall phone, so two fighters fit across it. */
export const fovFor = (aspect: number): number => (aspect < 1 ? 60 : 40)
/**
 * What covers the canvas, in px: the HUD bars at the top, the thumb pad at the bottom (portrait), and the thumb clusters at the sides
 * (landscape: they sit over the bottom corners, so the fighters are fitted between them). The camera frames the fighters in what is left.
 */
export interface Insets { top: number; bottom: number; left: number; right: number }
export const NO_INSETS: Insets = Object.freeze({ top: 0, bottom: 0, left: 0, right: 0 })
/** A standing fighter and the room a jump needs, metres above the canvas, and half a body (and a glove) either side of the pair. */
const FIT_HEIGHT = 2.9, FIT_SIDE = 0.47
/** The widest the lens opens to keep the camera inside the ropes: a tall phone, a wide one. */
const MAX_FOV_TALL = 80, MAX_FOV_WIDE = 58
/**
 * How to frame the pair, pure: the field of view, the camera's distance (metres) for a gap between the fighters, and `shift`, the
 * px to slide the picture down so the fighters centre in the free band (between the HUD and the pad) instead of the whole canvas.
 * Both fighters and their reach fit the free width, and a standing fighter plus a jump fits the free height. The camera stays inside
 * the ropes while it can: a wide pair opens the lens first (up to MAX_FOV_*), and only a pair too wide for that pulls back past the
 * ropes (the camera then rises over them, see cameraHeight); in portrait it may go far back, in landscape it stops at the far wall.
 */
export function framing(gap: number, width: number, height: number, inset: Insets = NO_INSETS): { fov: number; dist: number; shift: number } {
  const aspect = width / Math.max(1, height), tall = aspect < 1, base = fovFor(aspect)
  const bandH = Math.max(60, height - inset.top - inset.bottom), freeW = Math.max(120, width - 2 * Math.max(inset.left, inset.right))
  const need = (fov: number): number => {
    const tan2 = 2 * Math.tan((fov * Math.PI) / 360)
    return Math.max(3.6, (FIT_HEIGHT * height) / (bandH * tan2), ((gap + 2 * FIT_SIDE) * height) / (freeW * tan2))
  }
  const inside = ROPE_Z - 0.85, cap = tall ? 30 : 17, widest = tall ? MAX_FOV_TALL : MAX_FOV_WIDE
  let fov = base, dist = need(base)
  if (dist > inside) {
    fov = widest; dist = need(widest)
    for (let f = base + 1; f < widest; f++) if (need(f) <= inside) { fov = f; dist = need(f); break }
  }
  return { fov, dist: Math.min(cap, dist), shift: Math.round(inset.top + bandH / 2 - height / 2) }
}
/** The ring's ropes are 8.25 m from its centre and the top rope 2.25 m up: a camera further out rises to look over it. */
export const ROPE_Z = 8.25, ROPE_TOP = CANVAS_Y + 1.25
/** Camera height (metres above the floor) for a distance: at eye level inside the ring, over the top rope from outside it. */
export const cameraHeight = (dist: number, lookY: number): number => {
  const eye = CANVAS_Y + 1.55
  if (dist <= ROPE_Z - 0.3) return eye
  // The line from the camera to the look point must pass 0.35 m over the top rope where it crosses the ropes.
  const over = lookY + (ROPE_TOP + 0.35 - lookY) * (dist / ROPE_Z)
  return Math.max(eye, over)
}

interface Body {
  root: THREE.Object3D; dispose: () => void; mixer: THREE.AnimationMixer; actions: Map<string, THREE.AnimationAction>; current: Clip | null
  shadow: THREE.Mesh; lastX: number; lastAct: number; lastAt: number; blockHitUntil: number; strongUntil: number; punchAlt: boolean
}

/** What the view needs to know about a seat to dress it: the name (a default look is made from it) and the public native look, if any. */
export interface SeatLook { name: string; nat?: ArenaNative | undefined; /** This seat is the player's own (their pieces are on the phone already). */ mine?: boolean }

export interface FightView {
  /** Both fighters are in the ring (the 2D view draws everything until then). */
  ready(): boolean
  /** Which stylised or real fighters this view is drawing. */
  mode(): 'native' | 'kaykit'
  /** Draw one frame. `a`/`b`/`t` are the two snapshots and how far between; `own` replaces your fighter (prediction). */
  draw(a: FightSnap, b: FightSnap, t: number, meta: { own: FighterSnap | null; you: number | null; winner: number; now: number }): void
  /** This tick's hits (a snapshot's `e`): sparks and camera shake. */
  hits(events: readonly number[][]): void
  /** The canvas size in px and what covers it (HUD, thumbs): the pair is framed in the rest, at once. */
  resize(width: number, height: number, insets?: Insets): void
  stats(): ReturnType<FrameStats['read']> & { /** the pixel ratio now drawn at */ ratio: number; /** which fighters, and why the stylised ones if so */ fighters: string; why: string; clips: unknown; ready: boolean }
  dispose(): void
}

/** Make the 3D view on `canvas`, or null when WebGL or the models are not available (the screen keeps its 2D view). */
export async function createFightView(canvas: HTMLCanvasElement, opts: { reduced: boolean; seats?: () => readonly SeatLook[] }): Promise<FightView | null> {
  const renderer = makeRenderer(canvas)
  if (!renderer) return null
  let ringModel: Awaited<ReturnType<typeof loadGlb>>, clipsModel: Awaited<ReturnType<typeof loadGlb>> | null = null
  let native = nativeAllowedHere()
  try {
    ringModel = await loadGlb(FIGHT_ASSETS.ring)
    if (native) { try { clipsModel = await loadGlb(FIGHT_ASSETS.clips) } catch { native = false } }
  } catch { renderer.dispose(); return null }

  const scene = new THREE.Scene()
  scene.background = skyTexture()
  scene.fog = new THREE.Fog(0x1a1426, 16, 40)
  scene.add(new THREE.HemisphereLight(0xffe6c4, 0x2a2238, 1.25))
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.6)
  sun.position.set(-4, 9, 7); scene.add(sun)

  const ring = ringModel.scene.clone(true)
  lambertise(ring)
  const box = new THREE.Box3().setFromObject(ring), centre = box.getCenter(new THREE.Vector3())
  ring.position.x -= centre.x; ring.position.z -= centre.z
  scene.add(ring)
  const hallGroup = hall()
  scene.add(hallGroup)

  const bodies: (Body | null)[] = [null, null]
  const makeBody = (root: THREE.Object3D, mixerRoot: THREE.Object3D, animations: readonly THREE.AnimationClip[], seat: number, dispose: () => void): Body => {
    const holder = new THREE.Group(); holder.add(root); scene.add(holder)
    const mixer = new THREE.AnimationMixer(mixerRoot), actions = new Map<string, THREE.AnimationAction>()
    for (const clip of animations) {
      const action = mixer.clipAction(clip)
      if (ONCE.has(clip.name as Clip)) { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true }
      actions.set(clip.name, action)
    }
    const shadow = blobShadow(0.55); shadow.position.y = CANVAS_Y + 0.012; scene.add(shadow)
    return { root: holder, mixer, actions, current: null, shadow, lastX: seat ? 640 : 360, lastAct: ACT.none, lastAt: 0, blockHitUntil: 0, strongUntil: 0, punchAlt: false,
      dispose: () => { mixer.stopAllAction(); holder.removeFromParent(); shadow.removeFromParent(); (shadow.material as THREE.Material).dispose(); dispose() } }
  }
  // The stylised fighters (the fallback): two CC0 models with their own clips, fetched only when they are needed.
  let mode: 'native' | 'kaykit' = native ? 'native' : 'kaykit', why = native ? '' : 'this phone'
  let startedAt = 0 // when the seats were first known: the real characters get NATIVE_WAIT_MS from then
  async function kayKit(): Promise<void> {
    mode = 'kaykit'; generation[0] = (generation[0] ?? 0) + 1; generation[1] = (generation[1] ?? 0) + 1
    try {
      const models = await Promise.all(FIGHT_ASSETS.fighters.map((url) => loadGlb(url)))
      if (disposed) return
      models.forEach((model, seat) => {
        bodies[seat]?.dispose()
        const root = cloneSkinned(model.scene)
        lambertise(root)
        root.updateMatrixWorld(true)
        const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3())
        root.scale.setScalar(FIGHTER_HEIGHT / Math.max(0.1, size.y))
        bodies[seat] = makeBody(root, root, model.animations, seat, () => undefined)
      })
    } catch { /* the 2D view goes on */ }
  }
  // Each seat's native fighter is made when its look is known and made again when the look changes.
  const wanted: string[] = ['', ''], generation = [0, 0]
  let disposed = false, seatsSeen: readonly SeatLook[] | null = null
  const real: boolean[] = [false, false]
  /** Dress one seat and put it in the ring. Another person's own look may need files this phone has not got: their fighter starts in the world's crowd pieces (already here) and swaps when theirs arrives. */
  function build(seat: number, appearance: ReturnType<typeof defaultNativeLook>, mine: number, final: boolean): Promise<void> {
    return (async () => {
      const fighter: NativeFighter = await spawnNativeFighter(appearance)
      if (disposed || mode !== 'native' || generation[seat] !== mine || (!final && real[seat])) { fighter.dispose(); return }
      const body = makeBody(fighter.group, fighter.model, clipsFor((clipsModel as NonNullable<typeof clipsModel>).animations, appearance.body, fighter.bones), seat, () => fighter.dispose())
      bodies[seat]?.dispose(); bodies[seat] = body
      if (final) real[seat] = true
    })()
  }
  function wantNative(seat: number, look: SeatLook | undefined, other: SeatLook | undefined): void {
    const otherBody = other?.nat ? unpackNativeLook(other.nat)?.body : undefined
    const given = look?.nat ? unpackNativeLook(look.nat) : null
    const fallback = defaultNativeLook(look?.name ?? '', seat, otherBody)
    const appearance = given ?? fallback
    const key = JSON.stringify(appearance)
    if (wanted[seat] === key) return
    wanted[seat] = key
    real[seat] = false
    const mine = ++generation[seat]!
    const fail = (error: unknown): void => { if (!disposed && mode === 'native' && generation[seat] === mine) { why = String((error as Error)?.message ?? error).slice(0, 120); void kayKit() } }
    if (given && !look?.mine && !bodies[seat]) void build(seat, fallback, mine, false).catch(() => undefined)
    void build(seat, appearance, mine, true).catch(fail)
  }
  if (!native) void kayKit()

  // Sparks: one Points object, a small pool.
  const SPARKS = 48
  const sparkPos = new Float32Array(SPARKS * 3), sparkVel = new Float32Array(SPARKS * 3), sparkLife = new Float32Array(SPARKS).fill(1)
  const sparkGeo = new THREE.BufferGeometry(); sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3))
  const sparkMat = new THREE.PointsMaterial({ color: 0xffd36a, size: 0.09, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending })
  const sparks = new THREE.Points(sparkGeo, sparkMat); sparks.frustumCulled = false; scene.add(sparks)
  let nextSpark = 0

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80)
  const shake = new Shake(opts.reduced || shakeReduced()), shakeOffset = new THREE.Vector3()
  // Hit-stop: the fighters' poses and the sparks hold for 50-90 ms when a blow lands (src/scene/feel/hitstop.ts). Real time, not frames; the rules and input never wait.
  const hitStop = createHitStop()
  const look = new THREE.Vector3(0, CANVAS_Y + 0.95, 0), camPos = new THREE.Vector3(0, CANVAS_Y + 1.6, 7)
  const stats = new FrameStats()
  let last = 0, koSince = -1, sizeW = 300, sizeH = 300, inset: Insets = NO_INSETS, snapCamera = true
  // Adaptive resolution: the pixel ratio steps down while frames run long and back up when they run easy (kit.ts nextLevel).
  const ladder = ratioLadder(globalThis.devicePixelRatio || 1)
  let rung: RatioState = { level: 0, calmMs: 0 }
  const recent: number[] = []
  const setRung = (next: RatioState): void => {
    if (next.level !== rung.level) { renderer.setPixelRatio(ladder[next.level] as number); renderer.setSize(sizeW, sizeH, false); recent.length = 0 }
    rung = next
  }

  function play(body: Body, clip: Clip, now: number, restart: boolean, scale = 1): void {
    const next = body.actions.get(clip) ?? body.actions.get('idle')
    if (!next) return
    const prev = body.current ? body.actions.get(body.current) : undefined
    if (body.current === clip && !restart) { next.timeScale = scale; return }
    next.reset(); next.timeScale = scale; next.enabled = true; next.setEffectiveWeight(1)
    const fade = ONCE.has(clip) ? 0.07 : clip === 'down' ? 0.12 : 0.2
    if (prev && prev !== next) next.crossFadeFrom(prev, fade, false)
    next.play()
    body.current = clip
    void now
  }

  return {
    draw(a, b, t, meta) {
      const began = performance.now()
      const now = meta.now, dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60
      const frameMs = last ? now - last : 0
      last = now; stats.tick(now)
      if (frameMs > 0 && frameMs < 250) { recent.push(frameMs); if (recent.length > MEDIAN_FRAMES) recent.shift(); setRung(nextLevel(rung, ladder.length, recent)) }
      const snaps: [FighterSnap, FighterSnap] = [0, 1].map((seat) => {
        const fa = a.f[seat as 0 | 1], fb = b.f[seat as 0 | 1]
        const mixd: FighterSnap = [fa[0] + (fb[0] - fa[0]) * t, fa[1] + (fb[1] - fa[1]) * t, fb[2], fb[3], fb[4], fb[5], fb[6]]
        return meta.own && meta.you === seat ? meta.own : mixd
      }) as [FighterSnap, FighterSnap]
      const over = b.p === PHASE.over
      const held = hitStop.advance(dt) // 0 while a blow's freeze lasts: poses and sparks use this, the camera and the rules do not
      // Who is sitting where: dress each seat from its public look when the roster changes (the real characters), or give up on them.
      const seats = opts.seats?.() ?? null
      if (mode === 'native' && clipsModel) {
        if (seats !== seatsSeen || !seats) { seatsSeen = seats; if (!startedAt) startedAt = now; for (const seat of [0, 1]) wantNative(seat, seats?.[seat], seats?.[1 - seat]) }
        if (startedAt && bodies.some((x) => !x) && now - startedAt > ((globalThis as { allworldFightNativeWaitMs?: number }).allworldFightNativeWaitMs ?? NATIVE_WAIT_MS)) { why = 'waited too long'; void kayKit() }
      }
      bodies.forEach((body, seat) => {
        if (!body) return
        const f = snaps[seat as 0 | 1], other = snaps[(1 - seat) as 0 | 1]
        const w = toWorld(f[0], f[1])
        const facing = f[2] ? 1 : -1
        // The real fighters step into a strike so a fist or a foot reaches the other fighter's body (the rules' reach counts from the body centre).
        const move = MOVES[f[3] as 1 | 2]
        if (move && mode === 'native') {
          const gap = Math.abs(toWorld(other[0], 0).x - w.x)
          w.x += facing * Math.max(0, Math.min(0.5, gap - (f[3] === ACT.kick ? 1.3 : 1.0))) * Math.sin(Math.PI * Math.min(1, f[4] / move.total))
        }
        body.root.position.set(w.x, w.y, 0)
        body.root.rotation.y = facing > 0 ? Math.PI / 2 : -Math.PI / 2
        // Speed towards the other fighter, from the drawn positions (metres a second).
        const towards = Math.sign(other[0] - f[0]) || facing
        const speed = dt > 0 ? ((f[0] - body.lastX) * UNIT / dt) * towards : 0
        body.lastX = f[0]
        // A new attack restarts its clip; the second punch of a pair uses the other arm.
        const startedAttack = (f[3] === ACT.punch || f[3] === ACT.kick) && (f[3] !== body.lastAct || f[4] < body.lastAt)
        if (startedAttack && f[3] === ACT.punch) body.punchAlt = !body.punchAlt
        const startedHurt = f[3] === ACT.hurt && body.lastAct !== ACT.hurt
        body.lastAct = f[3]; body.lastAt = f[4]
        const clip = clipFor(f, speed, { blockHit: now < body.blockHitUntil, strongHit: now < body.strongUntil, won: over && meta.winner === seat, punchAlt: body.punchAlt })
        const action = body.actions.get(clip)
        const scale = clip === 'punch' || clip === 'punch-2' || clip === 'kick' ? attackScale(action?.getClip().duration ?? 0.4, f[3]) : clip === 'walk' || clip === 'walk-back' ? (mode === 'native' ? Math.min(1.7, Math.max(0.7, Math.abs(speed) / WALK_SPEED)) : Math.min(1.6, Math.max(0.7, Math.abs(speed) / 2.2))) : 1
        play(body, clip, now, startedAttack || (startedHurt && (clip === 'hit' || clip === 'hit-2')), scale)
        body.mixer.update(held)
        // The shadow stays on the canvas and shrinks as the fighter rises.
        const lift = Math.max(0, f[1] * UNIT)
        body.shadow.position.set(w.x, CANVAS_Y + 0.012, 0)
        body.shadow.scale.setScalar(Math.max(0.5, 1 - lift * 0.6));
        (body.shadow.material as THREE.MeshBasicMaterial).opacity = 0.45 * Math.max(0.3, 1 - lift)
      })
      // Sparks fly and fall.
      for (let i = 0; i < SPARKS; i++) {
        const life = sparkLife[i] as number
        if (life >= 1) { sparkPos[i * 3 + 1] = -10; continue }
        sparkLife[i] = life + held * 2.2
        sparkVel[i * 3 + 1] = (sparkVel[i * 3 + 1] as number) - 9.8 * held
        for (let k = 0; k < 3; k++) sparkPos[i * 3 + k] = (sparkPos[i * 3 + k] as number) + (sparkVel[i * 3 + k] as number) * held
      }
      sparkGeo.attributes.position!.needsUpdate = true
      // The camera: between the two, closer as they close in; on a knock-out it turns slowly round the one who went down.
      const x0 = toWorld(snaps[0][0], 0).x, x1 = toWorld(snaps[1][0], 0).x, gap = Math.abs(x1 - x0)
      // The fighters are framed in the part the HUD and thumbs leave free (framing, resize), centred on their middle height.
      const frame = framing(gap, sizeW, sizeH, inset)
      let tx = (x0 + x1) / 2, ty = CANVAS_Y + 1.2, dist = frame.dist, yaw = 0, drop = 0
      if (Math.abs(camera.fov - frame.fov) > 0.05) { camera.fov = frame.fov; camera.updateProjectionMatrix() }
      const loser = b.f[0][5] <= 0 ? 0 : b.f[1][5] <= 0 ? 1 : -1
      if ((b.p === PHASE.ko || over) && loser >= 0 && !opts.reduced) {
        if (koSince < 0) koSince = now
        const k = Math.min(1, (now - koSince) / 1800), ease = k * k * (3 - 2 * k)
        tx += ((loser ? x1 : x0) - tx) * ease; ty -= 0.45 * ease; dist = Math.min(dist * (1 - 0.32 * ease), ROPE_Z - 0.6 + (dist - ROPE_Z + 0.6) * (1 - ease)); yaw = 0.55 * ease * (loser ? -1 : 1); drop = 0.6 * ease
      } else if (b.p !== PHASE.ko && !over) koSince = -1
      const ease = 1 - Math.pow(0.001, dt)
      if (snapCamera) { look.set(tx, ty, 0); snapCamera = false; camPos.set(look.x, cameraHeight(dist, look.y), dist) } // a new shape: frame at once
      look.x += (tx - look.x) * ease; look.y += (ty - look.y) * ease
      const want = new THREE.Vector3(look.x + Math.sin(yaw) * dist, cameraHeight(dist, look.y) - drop, Math.cos(yaw) * dist)
      camPos.lerp(want, ease)
      camera.position.copy(camPos).add(shake.offset(dt, shakeOffset))
      camera.lookAt(look)
      renderer.render(scene, camera)
      stats.cpu(performance.now() - began)
    },
    hits(events) {
      for (const [seat, blocked, strong, x, y] of events as [number, number, number, number, number][]) {
        const body = bodies[seat]
        if (body) { if (blocked) body.blockHitUntil = performance.now() + 260; else if (strong) body.strongUntil = performance.now() + 400 }
        shake.kick(blocked ? 0.05 : strong ? 0.22 : 0.12)
        if (!shake.reduced) hitStop.freeze(fightHitStopMs(!!strong, !!blocked))
        const at = toWorld(x, y), n = blocked ? 8 : strong ? 18 : 12
        for (let i = 0; i < n; i++) {
          const k = nextSpark = (nextSpark + 1) % SPARKS, a = Math.random() * Math.PI * 2, v = 1.5 + Math.random() * (strong ? 4 : 2.6)
          sparkPos.set([at.x, at.y, (Math.random() - 0.5) * 0.2], k * 3)
          sparkVel.set([Math.cos(a) * v, Math.abs(Math.sin(a)) * v + 1, (Math.random() - 0.5) * v], k * 3)
          sparkLife[k] = 0
        }
        sparkMat.color.set(blocked ? 0x9ad0ff : 0xffd36a)
      }
    },
    resize(width, height, insets = NO_INSETS) {
      sizeW = width; sizeH = height; inset = insets
      renderer.setSize(width, height, false)
      const f = framing(0, width, height, insets)
      // In portrait the lamps would show as dots behind the top bar: they are only drawn in a wide view.
      ;(hallGroup.userData.lamps as THREE.Object3D).visible = width >= height
      camera.aspect = width / Math.max(1, height); camera.fov = f.fov
      camera.setViewOffset(width, height, 0, -f.shift, width, height) // slides the picture so the pair centres in the free band
      camera.updateProjectionMatrix()
      snapCamera = true
    },
    stats: () => ({ ...stats.read(renderer), ratio: ladder[rung.level] as number, fighters: mode, why, clips: bodies.map((x) => (x ? [x.actions.size, x.current] : null)), ready: bodies.every((x) => x !== null) }),
    ready: () => bodies.every((x) => x !== null),
    mode: () => mode,
    dispose() { disposed = true; for (const x of bodies) x?.dispose(); disposeScene(scene); sparkGeo.dispose(); sparkMat.dispose(); renderer.dispose() },
  }
}

/** The dark of the hall above the lamps: a vertical gradient drawn once into a small texture. */
function skyTexture(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = 2; c.height = 256
  const g = c.getContext('2d') as CanvasRenderingContext2D
  const grad = g.createLinearGradient(0, 0, 0, 256)
  grad.addColorStop(0, '#07060d'); grad.addColorStop(0.6, '#1a1426'); grad.addColorStop(1, '#2e2238')
  g.fillStyle = grad; g.fillRect(0, 0, 2, 256)
  const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** The hall round the ring: dark stands that rise into shadow, and a row of warm lamps over them. Two instanced draws. */
function hall(): THREE.Group {
  const group = new THREE.Group()
  const tiers = 14, stands = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0x2a2236 }), tiers * 3)
  const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd28a, fog: false }), 18)
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3()
  let i = 0
  for (let row = 0; row < tiers; row++) {
    // Behind the ring and down both sides, each row a step higher and further back.
    stands.setMatrixAt(i++, m.compose(p.set(0, 0.4 + row * 0.55, -14 - row * 0.9), q, s.set(34, 0.8, 0.9)))
    stands.setMatrixAt(i++, m.compose(p.set(-14 - row * 0.9, 0.4 + row * 0.55, -2), q, s.set(0.9, 0.8, 26)))
    stands.setMatrixAt(i++, m.compose(p.set(14 + row * 0.9, 0.4 + row * 0.55, -2), q, s.set(0.9, 0.8, 26)))
  }
  for (let k = 0; k < 18; k++) lamps.setMatrixAt(k, m.compose(p.set(-17 + k * 2, 15.5, -24), q, s.set(1, 1, 1)))
  group.add(stands, lamps)
  group.userData.lamps = lamps
  return group
}
