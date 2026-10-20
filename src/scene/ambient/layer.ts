/**
 * OWNER: scenes
 * The background people of a venue scene, drawn: passers-by who walk the paths, people who sit on the seats, pairs who talk, people on the
 * phone, a far crowd, and the venue's regulars, who glance at you, shift their weight and talk to each other. The plan is plan.ts; how a
 * person is made is figure.ts, the only place.
 *
 * BATTERY RULE. A scene is drawn on demand (src/scene/motion-loop.ts). This layer moves people only inside a WINDOW: it asks for frames for
 * WINDOW_MS after it is woken (the player arrives, the quarter turns, the player taps or walks) and then lets the loop end; people stand
 * where they were. It never asks for a frame on its own. A scene on a weak device or with reduced motion is never woken: people are placed
 * once, standing. src/scene/ambient/layer.test.ts counts the frames.
 *
 * Nearby people and regulars retain their planned identities. Optional distant extras fit the measured remaining
 * scene budget; their count can fall in a busy venue without changing the character model or detail level.
 */
import type * as THREE from 'three';
import type { Kit } from '../kit.ts';
import type { AvatarGroup } from '../characters.ts';
import { newGaze, stepGaze, watch, gazing } from '../space.ts';
import type { GazeState } from '../space.ts';
import { lookAvatar } from '../avatar-rig.ts';
import { hash } from '../build.ts';
import { totalRenderCost } from '../body/render-cost.ts';
import { createPlanner, poseOf, AMBIENT_STRIDE_DISTANCE } from './plan.ts';
import { nativeWalkCycleDistance } from '../character-lab/native-body.ts';
import type { AmbientPose, Ident, Planner, Role, Sample, Stage, Track } from './plan.ts';
import { TIER_CAPS } from './density.ts';
import { makeFarFigures, makeFigure, makeMotionFigure } from './figure.ts';
import type { FarFigures, MotionFigure } from './figure.ts';
import type { FrameGuard, StreetChoice } from '../street-life/plan.ts';
import type { StreetLife } from '../street-life/draw.ts';

/** How long the layer keeps the frame loop awake after being woken. */
export const WINDOW_MS = 12_000;
/** The most background people built as figures of their own (the far crowd is on top of this). */
export const MAX_FIGURES = 4;
/** How many of them may retain a live canonical rig for nearby reactions. */
export const MAX_FULL = 1;
/** The most regulars drawn as figures of their own (the rest stay in the scene's merged batch). */
export const MAX_RESIDENTS = 6;
/** The most nearby individual figures that carry GPU pose morphs at once (residents and planned people combined). */
export const MAX_REACTIVE = 1;
/** Legacy far-quad cost; replaced by measured native street geometry during integration. */
export const STREET_PERSON = 2;

/**
 * People who remember the player (src/news/acquaintance.ts, one day, kept on this device): a regular the player said hello to or bought a drink
 * for turns, waves and says one line when the player walks up. The layer looks at the store itself, by the regular's id, because the scene
 * hands it only an id, a seed and a place. The key is the store's own (a test keeps the two equal); with nothing stored, nothing is fetched.
 */
export const ACQUAINTANCE_KEY = 'joinallworld-acquaintance-v1';
/** How near the player must come, in metres, and how long the wave lasts. */
export const REMEMBER_REACH = 6;
export const WAVE_MS = 3_500;

export interface Room { triangles: number; meshes: number }
export interface AmbientTag { id: string; name: string; kind: string; text: string; marker: string; colour: string; position: { x: number; y: number; z: number } }
export interface AmbientPerson { id: string; role: Role; x: number; z: number; sitting: boolean }
/** A regular standing in the scene (placed by the scene). */
export interface Resident { id: string; seed: string; look?: unknown; x: number; z: number; ry: number }

export interface LayerOptions {
  kit: Kit
  parent: THREE.Object3D
  stage: Stage
  ident: Ident
  /** The ground height at a place (raised decks). */
  heightAt(x: number, z: number): number
  /** Where the player's avatar is now. */
  avatar(): { x: number; z: number }
  /** What the scene has left to spend, measured without this layer. */
  room(): Room
  /** The wall clock (ms): where the plan puts everyone. Tests pass their own. The window of frames is counted in the host's own frame time, not here. */
  clock?(): number
  /** The layer's tags changed (a bark came or went): the host reads them again. */
  changed?(): void
}

interface Entry {
  id: string
  seed: string
  look: unknown
  lookKey: string
  role: Role
  resident: boolean
  lean: boolean
  holder: THREE.Group
  figures: Map<string, AvatarGroup>
  shown: AvatarGroup | null
  shownKey: string
  lastStride?:number
  nativePhase?:number
  motion: MotionFigure | null
  reactive: boolean
  x: number; z: number; ry: number; placed: boolean
  ox: number; oz: number
  gaze: GazeState
  top: number
  /** Facing a partner for a talk, until the time. */
  talk: { until: number; face: number; lead: boolean } | null
  /** A spoken bark animates the mouth only while the existing ambient window happens to be open. */
  speakingUntil: number
  /** The wave a regular gives the player they remember (see `memories`). */
  wave: { until: number } | null
  blinkPeriod: number
  blinkOffset: number
  speechPhase: number
}

const turn = (from: number, to: number): number => { let d = to - from; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d };

/** A resident look comes from JSON-shaped city content; sort object keys so equivalent records reuse the same figure cache. */
function appearanceKey(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value)
  if (Array.isArray(value)) return `[${value.map(appearanceKey).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${appearanceKey(record[key])}`).join(',')}}`
}

export interface AmbientLayer {
  /** Advance to the clock (or to `at`) by `dt` seconds. True while the window is open (the loop should keep drawing). */
  step(dt: number, at?: number): boolean
  /** Place everyone as the plan has them at this instant and stand them still (reduced motion, no frame loop). */
  settle(at?: number): void
  /** Open the window (the player arrived or acted, or the quarter turned). */
  wake(): boolean
  readonly awake: boolean
  readonly count: number
  /** How many times step() ran: the frame budget. */
  readonly frames: number
  setResidents(list: readonly Resident[]): string[]
  /** What the scene has left to spend changed (its own crowd did): count it again. */
  rebudget(): void
  residentTag(id: string, name: string): AmbientTag | null
  people(): AmbientPerson[]
  tags(): AmbientTag[]
  /** Move an existing person's mouth for a bounded time; does not add a bubble, timer, wake, or frame. */
  animateSpeech(id: string, ms?: number): boolean
  speak(id: string, text: string, ms?: number): boolean
  talk(a: string, b: string, ms?: number): boolean
  stats(): { triangles: number; meshes: number; overTriangles: number; overMeshes: number }
  /** How many reactive, static and far figures the planner can show. */
  caps(): { full: number; lean: number; far: number }
  /** The street behind the place, when this device has it: its tier, people asked for, and what is drawn now (diagnostics). */
  street(): { tier: string; asked: number; people: number; dropped: boolean } | null
  dispose(): void
}

export function createAmbientLayer(options: LayerOptions): AmbientLayer {
  const { kit, parent, stage, ident, heightAt } = options
  const { THREE } = kit
  const clock = options.clock ?? (() => Date.now())
  const planner: Planner = createPlanner(stage, ident)
  const group = new THREE.Group()
  group.name = 'ambient'
  parent.add(group)
  const entries = new Map<string, Entry>()
  const barks = new Map<string, { text: string; timer: ReturnType<typeof setTimeout> }>()
  let far: FarFigures | null = null, farKey = '', farPending: FarFigures | null = null, farRevision = 0
  let windowLeft = 0, frames = 0, disposed = false, current = clock()
  let fullCap = 0, leanCap = 0, farCap = 0
  let residents: Resident[] = []
  /** What each regular who remembers the player says when the player comes near (told once), by the regular's id; kept if the figure is rebuilt. */
  const memories = new Map<string, { line: string; told: boolean }>()
  const asked = new Set<string>()
  // Street life: decided once for the layer, when its gate's chunk is in (only a full-tier layer asks for it).
  let streetChoice: StreetChoice | null = null, streetAsked = 0, streetGuard: FrameGuard | null = null
  let street: StreetLife | null = null, streetDropped = false

  /** Which of these regulars remember the player? Looked up once each, and only when the device holds any memory at all. */
  function askMemories(list: readonly Resident[]): void {
    const fresh = list.filter((resident) => resident.id.startsWith('npc:') && !asked.has(resident.id))
    if (!fresh.length) return
    let kept = false
    try { kept = Boolean(globalThis.localStorage?.getItem(ACQUAINTANCE_KEY)) } catch { kept = false }
    if (!kept) return
    for (const resident of fresh) asked.add(resident.id)
    void import('../../news/acquaintance.ts').then(async (store) => {
      const now = Date.now()
      const known = fresh.flatMap((resident) => { const kind = store.recall(resident.id.slice(4), now); return kind ? [{ resident, kind }] : [] })
      if (!known.length || disposed) return
      const lines = await import('../../news/memory-lines.ts')
      if (disposed) return
      for (const { resident, kind } of known) {
        memories.set(resident.id, { line: lines.memoryLineIn(ident.cityId, kind, resident.seed), told: false })
      }
    }).catch(() => { /* a regular who does not remember is no harm */ })
  }

  /** Optional extras are bounded separately from the venue's interactive residents. */
  function budget(): void {
    fullCap = ident.tier === 'full' ? MAX_FULL : 0
    leanCap = MAX_FIGURES - fullCap
    farCap = TIER_CAPS[ident.tier].far
  }

  function enter(id: string, seed: string, role: Role, resident: boolean, lean = false, look?: unknown): Entry {
    const holder = new THREE.Group()
    holder.name = resident ? 'ambient-resident' : 'ambient-person'
    group.add(holder)
    const blinkPeriod = 4_200 + hash(`${seed}|blink-period`) % 2_400
    const entry: Entry = {
      id, seed, look, lookKey: appearanceKey(look), role, resident, lean, holder, figures: new Map(), shown: null, shownKey: '', motion: null, reactive: false,
      x: 0, z: 0, ry: 0, placed: false, ox: 0, oz: 0, gaze: newGaze(), top: 2.9, talk: null, speakingUntil: 0, wave: null,
      blinkPeriod, blinkOffset: hash(`${seed}|blink-phase`) % blinkPeriod, speechPhase: (hash(`${seed}|speech-phase`) % 6_283) / 1_000,
    }
    entries.set(id, entry)
    return entry
  }
  function leave(entry: Entry): void {
    for (const figure of entry.figures.values()) figure.userData.dispose()
    entry.motion?.dispose()
    entry.holder.parent?.remove(entry.holder)
    entries.delete(entry.id)
    const bark = barks.get(entry.id)
    if (bark) { clearTimeout(bark.timer); barks.delete(entry.id) }
  }
  /** True only when this call paid the synchronous cost of attempting a morph-controller build. */
  function setReactive(entry: Entry, wanted: boolean, pose: AmbientPose, step: number, seat: number, allowPromotion: boolean): boolean {
    if (wanted === entry.reactive) return false
    if (!wanted) {
      if (entry.shown === entry.motion?.group) { entry.shown = null; entry.shownKey = '' }
      entry.motion?.dispose(); entry.motion = null; entry.reactive = false
      return false
    }
    if (entry.lean || pose === 'sit' || !allowPromotion) return false
    const room = options.room()
    const currentCost = totalRenderCost(group)
    const previous = entry.shown ? totalRenderCost(entry.shown) : { triangles: 0, drawCalls: 0 }
    // Native live rigs retain the reference mesh. Promote only when its full cost fits.
    if (currentCost.triangles - previous.triangles + 34_000 > room.triangles || currentCost.drawCalls - previous.drawCalls + 14 > room.meshes) return false
    const motion = makeMotionFigure(kit, { seed: entry.seed, look: entry.look, pose, step, seat })
    for (const figure of entry.figures.values()) figure.userData.dispose()
    entry.figures.clear(); entry.shown = null; entry.shownKey = ''
    motion.group.visible = false
    entry.holder.add(motion.group)
    entry.motion = motion; entry.reactive = true
    return true
  }
  function show(entry: Entry, pose: AmbientPose, step: number, stride: number | undefined, seat: number, still: boolean): void {
    const sourceStride=stride??(step?.75:.25);
    if(pose==='walk') {
      entry.nativePhase=entry.lastStride===undefined?sourceStride:(entry.nativePhase??0)+((sourceStride-entry.lastStride+1)%1)*AMBIENT_STRIDE_DISTANCE/nativeWalkCycleDistance(entry.look,entry.seed);
      entry.lastStride=sourceStride;
    } else entry.lastStride=undefined;
    if (pose !== 'sit' && entry.motion) {
      const reveal = entry.shown !== entry.motion.group
      if (reveal) {
        if (entry.shown) entry.shown.visible = false
        entry.motion.group.visible = true
        entry.shown = entry.motion.group
      }
      entry.motion.pose(pose, stride ?? (step ? 0.75 : 0.25), still || reveal)
      if (still) entry.motion.settle()
      entry.shownKey = pose
      entry.top = entry.motion.group.userData.top ?? 2.9
      return
    }
    const frame=Math.floor(((entry.nativePhase??0)%1)*8)%8;
    const key = pose === 'walk' ? `walk${frame}` : pose === 'sit' ? `sit${seat}` : pose
    if (key === entry.shownKey) return
    let figure = entry.figures.get(key)
    if (!figure) {
      figure = makeFigure(kit, { seed: entry.seed, look: entry.look, pose, step, stride:frame/8, seat, lean: entry.lean })
      figure.visible=false;
      entry.holder.add(figure)
      entry.figures.set(key, figure)
    }
    if(figure.userData.characterStatus==='loading')return;
    if (entry.shown) entry.shown.visible = false
    figure.visible = true
    entry.shown = figure; entry.shownKey = key
    entry.top = figure.userData.top ?? 2.9
  }

  /** One person this frame: the pose and place the plan gives, and the small reactions to the player (a walker steps round, a stander glances). */
  function put(entry: Entry, sample: Sample, at: number, dt: number, still: boolean, player: { x: number; z: number }, reactive: boolean, promotion: { spent: boolean }): boolean {
    let pose: AmbientPose = sample.walking && still ? 'stand' : sample.pose
    let face = sample.ry, moving = false
    const sitting = sample.mode === 'sit'
    if (entry.talk && at < entry.talk.until) {
      face = entry.talk.face
      pose = entry.talk.lead === (Math.floor(at / 2600) % 2 === 0) && !still ? 'wave' : 'stand'
    } else if (entry.talk) entry.talk = null
    // A regular who remembers the player waves and says one line when they come near. Never on a still placement: nothing moves there, and nothing asks for frames.
    const memory = memories.get(entry.id)
    if (memory && !memory.told && !still && Math.hypot(sample.x - player.x, sample.z - player.z) < REMEMBER_REACH) {
      memory.told = true
      entry.wave = { until: at + WAVE_MS }
      layer.speak(entry.id, memory.line)
    }
    if (entry.wave && at < entry.wave.until && !still) {
      face = Math.atan2(player.x - sample.x, player.z - sample.z)
      pose = 'wave'
    } else if (entry.wave) entry.wave = null
    // A still placement is also the reduced-motion path: it never pays to bake morph targets.
    const keepBaked = still && entry.reactive && pose !== 'sit'
    if (setReactive(entry, keepBaked || (reactive && !still), pose, sample.step, sample.seat, !promotion.spent)) promotion.spent = true
    show(entry, pose, sample.step, sample.stride, sample.seat, still)
    if (!still && entry.motion && entry.shown === entry.motion.group) {
      moving = entry.motion.step(dt) || moving
      const blinkAt = (at + entry.blinkOffset) % entry.blinkPeriod
      const blink = blinkAt < 180 ? Math.sin((blinkAt / 180) * Math.PI) : 0
      const takingTurn = entry.talk && at < entry.talk.until && entry.talk.lead === (Math.floor(at / 2600) % 2 === 0)
      const speaking = at < entry.speakingUntil || takingTurn
      const speech = speaking ? 0.25 + ((Math.sin(at / 82 + entry.speechPhase) + 1) / 2) * 0.75 : 0
      entry.motion.face(blink, speech)
    }
    let x = sample.x, z = sample.z, wantX = 0, wantZ = 0
    if (sample.walking && !still) {
      const dx = x - player.x, dz = z - player.z, d = Math.hypot(dx, dz)
      if (d < 1.6 && d > 0.01) { wantX = (dx / d) * (1.6 - d) * 0.55; wantZ = (dz / d) * (1.6 - d) * 0.55 }
      moving = true
    }
    const ease = Math.min(1, dt * 7)
    entry.ox += (wantX - entry.ox) * ease; entry.oz += (wantZ - entry.oz) * ease
    x += entry.ox; z += entry.oz
    entry.ry = !entry.placed || still ? face : entry.ry + turn(entry.ry, face) * Math.min(1, dt * 9)
    let glance = 0
    if (!sample.walking && !sitting) {
      const self = { x, z }
      if (!still && (gazing(entry.gaze) || watch(entry.gaze, self, face, player))) { stepGaze(entry.gaze, dt, self, face, player, 'stranger'); moving = gazing(entry.gaze) || moving }
      glance = entry.gaze.offset
    }
    entry.placed = true; entry.x = x; entry.z = z
    const y = heightAt(x, z)
    const bakedBob = entry.motion && entry.shown === entry.motion.group
    entry.holder.position.set(x, y + (sample.walking && !bakedBob ? Math.abs(Math.sin(at / 170 + entry.id.length)) * 0.035 : 0), z)
    entry.holder.rotation.y = entry.ry + (lookAvatar(entry.shown, glance) ? 0 : glance)
    return moving
  }

  function place(at: number, dt: number, still: boolean): boolean {
    const player = options.avatar()
    let moving = false
    // Baking one controller creates the base plus its pose/face targets. Bound that synchronous
    // work to one attempt per animated frame; everyone else keeps their existing static figure.
    const promotion = { spent: still }
    const residentSamples = residents.map((resident) => {
      const track: Pick<Track, 'seed' | 'role'> = { seed: resident.seed, role: 'stander' }
      const sample: Sample = { x: resident.x, z: resident.z, ry: resident.ry, mode: 'stand', pose: poseOf(track, { mode: 'stand' }, at), seat: 0.6, step: 0, walking: false }
      return { resident, sample }
    })
    // When there is room for fewer than the plan holds, the ones kept are a mix of walkers, sitters and standers (by a hash of who they are), not all
    // of one kind. Someone already in the place keeps their kind of figure; a newcomer is full while there is a full place left, lean after.
    const sorted = planner.at(at).sort((a, b) => hash(a.track.id) - hash(b.track.id) || (a.track.id < b.track.id ? -1 : 1))
    const admitted: { track: Track; sample: Sample; lean: boolean }[] = []
    let fullUsed = 0, leanUsed = 0
    for (const item of sorted) {
      const known = entries.get(item.track.id)
      if (!known || known.resident) continue
      if (known.lean ? leanUsed < leanCap : fullUsed < fullCap) { admitted.push({ ...item, lean: known.lean }); if (known.lean) leanUsed++; else fullUsed++ }
    }
    const newcomers = sorted.filter((item) => !entries.has(item.track.id)).sort((a, b) => {
      const ad = (a.sample.x - player.x) ** 2 + (a.sample.z - player.z) ** 2, bd = (b.sample.x - player.x) ** 2 + (b.sample.z - player.z) ** 2
      return ad - bd || hash(a.track.id) - hash(b.track.id) || (a.track.id < b.track.id ? -1 : 1)
    })
    for (const item of newcomers) {
      if (fullUsed < fullCap) { admitted.push({ ...item, lean: false }); fullUsed++ } else if (leanUsed < leanCap) { admitted.push({ ...item, lean: true }); leanUsed++ }
    }
    const present = new Set([...admitted.map(({ track }) => track.id), ...residents.map((resident) => resident.id)])
    for (const entry of [...entries.values()]) if (!present.has(entry.id)) leave(entry)

    // Keep the GPU-morphed set both small and stable: an existing member gets a 1.5-unit
    // distance advantage, so two neighbours do not continually exchange geometry at the boundary.
    const candidates = [
      ...residentSamples.map(({ resident, sample }) => ({ id: resident.id, sample })),
      ...admitted.filter(({ lean }) => !lean).map(({ track, sample }) => ({ id: track.id, sample })),
    ].filter(({ sample }) => sample.mode !== 'sit')
    candidates.sort((a, b) => {
      const score = ({ id, sample }: typeof a) => Math.hypot(sample.x - player.x, sample.z - player.z) - (entries.get(id)?.reactive ? 1.5 : 0)
      return score(a) - score(b) || (a.id < b.id ? -1 : 1)
    })
    const reactive = new Set(candidates.slice(0, ident.tier === 'full' ? MAX_REACTIVE : 0).map(({ id }) => id))
    for (const { resident, sample } of residentSamples) {
      const entry = entries.get(resident.id) ?? enter(resident.id, resident.seed, 'stander', true, false, resident.look)
      moving = put(entry, sample, at, dt, still, player, reactive.has(resident.id), promotion) || moving
    }
    for (const { track, sample, lean } of admitted) {
      const entry = entries.get(track.id) ?? enter(track.id, track.seed, track.role, false, lean)
      moving = put(entry, sample, at, dt, still, player, reactive.has(track.id), promotion) || moving
    }
    admitOptionalPeople()
    return moving
  }

  function admitOptionalPeople(): void {
    const room = options.room()
    let triangles = room.triangles - (street?.triangles ?? 0), draws = room.meshes - (street?.drawCalls ?? 0)
    // Residents carry interactions, so they remain present. Optional passers-by use what is left.
    for (const entry of entries.values()) if (entry.resident && entry.shown) {
      const cost = totalRenderCost(entry.shown)
      triangles -= cost.triangles; draws -= cost.drawCalls
    }
    // Optional street traffic must yield before interactive residents or venue scenery.
    // Its independent allocator can finish after this layer's room has changed.
    if (street && (triangles < 0 || draws < 0)) {
      triangles += street.triangles; draws += street.drawCalls;
      dropStreet();
    }
    for (const entry of entries.values()) if (!entry.resident && entry.shown) {
      const cost = totalRenderCost(entry.shown)
      entry.holder.visible = cost.triangles <= triangles && cost.drawCalls <= draws
      if (entry.holder.visible) { triangles -= cost.triangles; draws -= cost.drawCalls }
    }
  }

  function farFor(at: number): void {
    const remaining = (): Room => {
      const room = options.room()
      let triangles = room.triangles - (street?.triangles ?? 0), meshes = room.meshes - (street?.drawCalls ?? 0)
      for (const entry of entries.values()) if (entry.holder.visible && entry.shown) {
        const cost = totalRenderCost(entry.shown)
        triangles -= cost.triangles; meshes -= cost.drawCalls
      }
      return { triangles: Math.max(0, Math.floor(triangles)), meshes: Math.max(0, Math.floor(meshes)) }
    }
    const room = remaining()
    if (far) {
      const cost = totalRenderCost(far.group)
      if (cost.triangles > room.triangles || cost.drawCalls > room.meshes) far.group.visible = false
    }
    const list = farCap > 0 && room.triangles > 0 && room.meshes > 0 ? planner.far(at).slice(0, farCap) : []
    const k = `${list.map((p) => p.seed).join(',')}|${room.triangles}|${room.meshes}`
    if (k === farKey) return
    farKey = k
    const revision = ++farRevision
    farPending?.dispose(); farPending = null
    if (!list.length) { far?.dispose(); far = null; return }
    const attempt = (count: number): void => {
      if (count <= 0 || disposed || revision !== farRevision) {
        if (revision === farRevision) { far?.dispose(); far = null }
        return
      }
      const candidate = makeFarFigures(kit, list.slice(0, count))
      farPending = candidate
      const admit = (): void => {
        if (disposed || revision !== farRevision) { candidate.dispose(); return }
        farPending = null
        const cost = totalRenderCost(candidate.group), available = remaining()
        if (candidate.group.userData.characterStatus === 'error') { candidate.dispose(); return }
        if (cost.triangles <= available.triangles && cost.drawCalls <= available.meshes) {
          far?.dispose(); far = candidate; group.add(far.group); options.changed?.()
          return
        }
        candidate.dispose()
        const remove = Math.max(1, Math.ceil((cost.triangles - available.triangles) / Math.max(1, cost.triangles / count)))
        attempt(count - remove)
      }
      // Loading reservations are not geometry. Prime the same-source snapshots off-scene,
      // then admit their measured result instead of discarding them before they can load.
      const ready = candidate.group.userData.ready as Promise<void> | undefined
      if (candidate.group.userData.characterStatus === 'loading' && ready) {
        void ready.then(admit, () => {
          candidate.dispose()
          if (revision === farRevision) { farPending = null; options.changed?.() }
        })
      } else admit()
    }
    attempt(list.length)
  }

  function sync(at: number, dt: number, still: boolean): boolean {
    current = at
    const moving = place(at, dt, still)
    farFor(at)
    return moving
  }

  function animateSpeech(id: string, ms = 5_000): boolean {
    const entry = entries.get(id)
    if (disposed || !entry) return false
    entry.speakingUntil = clock() + Math.max(0, ms)
    return true
  }

  function dropStreet(): void { street?.dispose(); street = null; streetDropped = true }
  if (ident.tier === 'full') {
    void import('../street-life/plan.ts').then(async (plan) => {
      if (disposed) return
      // The page must draw with WebGL2 (never so under node tests) unless the hand-testing switch says otherwise.
      streetChoice = plan.streetLifeFor({ ambientTier: ident.tier, kind: ident.kind, webgl: typeof (globalThis as { WebGL2RenderingContext?: unknown }).WebGL2RenderingContext === 'function', hints: plan.deviceHints(), forced: plan.pageForced() })
      // Only on the venue's own walkable floor (never outside its boundary); no walk grid, no floor, no lanes: no crowd.
      const walkable = plan.walkableFloor(stage.bounds, stage.free), lanes = plan.venueLanes(stage.bounds, stage.open, stage.free)
      streetAsked = streetChoice && walkable ? plan.venueCrowd(streetChoice, options.room(), lanes) : 0
      if (!streetAsked || !walkable) return
      streetGuard = plan.createFrameGuard()
      // Its room first: the figures are counted again without it (the far crowd gives way), placed where they stand now.
      budget()
      if (windowLeft <= 0) sync(current, 0, true)
      const module = await import('../street-life/draw.ts')
      if (disposed || street || streetDropped) return
      // `walkable` is the final guard for everyone and everything (cut-outs and near bodies alike), and the near bodies' floor too.
      street = module.createStreetLife(kit, { parent: group, seed: `${ident.cityId}|${ident.venueId}`, lanes, roads: [], crowd: streetAsked, vehicles: 0, heightAt, walkable, at: current,
        context: ident.kind, tier: streetChoice?.tier ?? null, ready: () => { admitOptionalPeople(); options.changed?.() } })
      street.step(current, options.avatar())
      admitOptionalPeople()
      options.changed?.()
    }).catch(() => { streetDropped = true })
  }

  budget()
  sync(clock(), 0, true)

  const layer: AmbientLayer = {
    step(dt, at = clock()) {
      if (disposed) return false
      frames += 1
      const closing = windowLeft > 0 && windowLeft - dt <= 0
      windowLeft = Math.max(0, windowLeft - dt)
      sync(at, dt, false)
      // Street life moves with the window; a slow frame drops it for good (the hand-testing switch keeps it on).
      if (street) { if (!streetChoice?.forced && streetGuard?.frame(dt) === 'slow') dropStreet(); else street.step(at, options.avatar(), dt) }
      admitOptionalPeople()
      if (closing) for (const entry of entries.values()) entry.motion?.settle()
      return windowLeft > 0
    },
    settle(at = clock()) { if (!disposed) { windowLeft = 0; sync(at, 1, true); street?.step(at, options.avatar()) } },
    wake() {
      if (disposed) return false
      windowLeft = WINDOW_MS / 1000
      streetGuard?.reset()
      return true
    },
    get awake() { return windowLeft > 0 },
    get count() { return entries.size },
    get frames() { return frames },
    setResidents(list) {
      const next = list.slice(0, MAX_RESIDENTS)
      for (const resident of next) {
        const entry = entries.get(resident.id)
        if (entry?.resident && (entry.seed !== resident.seed || entry.lookKey !== appearanceKey(resident.look))) leave(entry)
      }
      residents = next
      askMemories(next)
      budget()
      sync(clock(), 0, true)
      return residents.map((resident) => resident.id)
    },
    rebudget() { if (disposed) return; budget(); admitOptionalPeople(); if (windowLeft <= 0) farFor(current) },
    residentTag(id, name) {
      const entry = entries.get(id)
      if (!entry?.resident) return null
      return { id, name, kind: 'npc', text: name, marker: 'dot', colour: '#58d68a', position: { x: entry.x, y: entry.holder.position.y + entry.top, z: entry.z } }
    },
    people() {
      return [...entries.values()].filter(entry => entry.holder.visible).map((entry) => ({ id: entry.id, role: entry.role, x: entry.x, z: entry.z, sitting: entry.shownKey.startsWith('sit') }))
    },
    tags() {
      const out: AmbientTag[] = []
      for (const [id, bark] of barks) {
        const entry = entries.get(id)
        if (!entry) continue
        out.push({ id: `bark:${id}`, name: '', kind: 'bark', text: bark.text, marker: 'tag', colour: '#ffffff', position: { x: entry.x, y: entry.holder.position.y + entry.top + 0.35, z: entry.z } })
      }
      return out
    },
    animateSpeech,
    speak(id, text, ms = 5_000) {
      if (!animateSpeech(id, ms)) return false
      const had = barks.get(id)
      if (had) clearTimeout(had.timer)
      const timer = setTimeout(() => { barks.delete(id); options.changed?.() }, ms)
      barks.set(id, { text, timer })
      options.changed?.()
      return true
    },
    talk(a, b, ms = 8_000) {
      const first = entries.get(a), second = entries.get(b)
      if (disposed || !first || !second) return false
      const until = clock() + ms
      first.talk = { until, face: Math.atan2(second.x - first.x, second.z - first.z), lead: true }
      second.talk = { until, face: Math.atan2(first.x - second.x, first.z - second.z), lead: false }
      return true
    },
    caps: () => ({ full: fullCap, lean: leanCap, far: farCap }),
    street: () => (streetChoice ? { tier: streetChoice.tier, asked: streetAsked, people: street?.people ?? 0, dropped: streetDropped } : null),
    stats() {
      const cost = totalRenderCost(group)
      const room = options.room()
      return { triangles: cost.triangles, meshes: cost.meshes, overTriangles: Math.max(0, cost.triangles - room.triangles), overMeshes: Math.max(0, cost.drawCalls - room.meshes) }
    },
    dispose() {
      disposed = true
      farRevision++; farPending?.dispose(); farPending = null
      for (const entry of [...entries.values()]) leave(entry)
      for (const bark of barks.values()) clearTimeout(bark.timer)
      barks.clear()
      far?.dispose(); far = null
      street?.dispose(); street = null
      group.parent?.remove(group)
    },
  }
  return layer
}
