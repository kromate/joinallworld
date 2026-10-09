import * as THREE from 'three'
import { createHash } from 'node:crypto'
import { createKit, type Kit } from '../../../src/scene/kit.ts'
import { loadBody, type SkinnedBody } from '../../../src/scene/body/skinned.ts'
import { normalizeLook } from '../../../src/scene/avatar-look.ts'
import { STILL, STAIRS, type BodyPose } from '../../../src/scene/body/poses.ts'
import { buildAvatar, poseAvatar, type AvatarGroup, type Pose } from '../../../src/scene/characters.ts'
import { captureActorEvaluation, validateActorEvaluation, type ActorEvaluationInput, type EvaluationCheck, type PoseKind } from '../actor-volume-boarding-slice-v6/evaluated-actor-contract.ts'

const BODY_SOURCE_SHA256 = '4fa64261e15a7e104f527ad4782aff2bb80c53d559dc7a448d95d797d92c6bdb'
const WARDROBE_SOURCE_SHA256 = '4b053592fdc8efdad0e9cd5071cb853594c2db53829cd74116bf578f439f82da'
const THREE_LOCK_SHA256 = 'd3a82d0f0d7e750bee84042a2ab36dcaa655cf6e7c9bdb8047823e507112efa9'
const THREE_DEFAULT_CALLBACK_SHA256 = '0f4ffcfc6253eb09ed7e7724b5fc653c6acf78db474a533b22074715c6eaa2a2'
const BODY_KEY = 'allworld-body-sleep-socket-eyes-2'
const WARDROBE_KEY = 'allworld-wardrobe-fabric-v2'
const MAX_ATTRIBUTE_BYTES = 12 * 1024 * 1024
const MAX_MORPH_CHANNELS = 64

export interface TrackedKit { readonly token: object }
export interface ObservedActor { readonly token: object }
export interface HostFrame { readonly token: object; readonly sequence: number }
export type ObservationResult =
  | Readonly<{ state: 'ready'; snapshot: object; geometryDigest: string; nodeCount: number; meshCount: number; rawAttributeBytes: number; canBoard: false; routeAuthorized: false }>
  | Readonly<{ state: 'unknown'; reason: string; canBoard: false; routeAuthorized: false }>

interface KitOwner {
  readonly kit: Kit
  readonly token: object
  readonly lease: object
  readonly materials: WeakSet<THREE.Material>
  readonly textures: WeakSet<THREE.Texture>
  readonly liveTextures: WeakSet<THREE.Texture>
  readonly watchedTextures: WeakSet<THREE.Texture>
  readonly geometries: WeakSet<THREE.BufferGeometry>
  readonly callbacks: Set<() => void>
  cacheCallback?: () => void
  open: boolean
  generation: number
  templateCacheObserved: boolean
}
interface MaterialOwner {
  readonly material: THREE.Material
  readonly ownerLease: object
  readonly ownerGeneration: number
  readonly shaderPath: 'three-default-skinning' | 'production-body-skinning' | 'production-wardrobe-fabric'
  readonly sourceSha256: string
  readonly materialFingerprint: string
  readonly programKey: string
  readonly onBeforeCompile: THREE.Material['onBeforeCompile']
  readonly stockOnBeforeCompile: THREE.Material['onBeforeCompile'] | null
  readonly textures: readonly { readonly texture: THREE.Texture; readonly ownerLease: object }[]
}
type ActorKind = 'skinned' | 'procedural-fallback'
interface PoseWitness {
  pose: PoseKind
  clip: string | null
  clipTimeSeconds: number | null
  gaitPhaseRadians: number | null
  transitionProgress: number | null
  easing: boolean
  hostPhase: string
}
interface ActorOwner {
  readonly token: object
  readonly root: THREE.Object3D
  readonly kind: ActorKind
  readonly kit: KitOwner
  readonly lease: object
  readonly materialOwners: WeakMap<THREE.Material, MaterialOwner>
  readonly structure: readonly object[]
  readonly geometryRefs: readonly THREE.BufferGeometry[]
  active: boolean
  resourcesLive: boolean
  generation: number
  appearanceFingerprint: string
  presentation: 'everyday' | 'bathing' | 'sleeping'
  pose: PoseWitness
  readonly body?: SkinnedBody
  readonly avatar?: AvatarGroup
}
interface SnapshotOwner {
  readonly actor: ActorOwner
  readonly hostFrame: HostFrame
  readonly v6Token: object
  readonly geometryDigest: string
  readonly structure: readonly object[]
  readonly version: number
}

const kits = new WeakMap<object, KitOwner>()
const actors = new WeakMap<object, ActorOwner>()
const snapshots = new WeakMap<object, SnapshotOwner>()
const hostFrames = new WeakSet<object>()
let lastFrameSequence = -1
const nodeIdentity = new WeakMap<object, number>()
let nextNodeIdentity = 1

function fail(reason: string): ObservationResult { return Object.freeze({ state: 'unknown', reason, canBoard: false, routeAuthorized: false }) }
function nodeId(node: object | null): number | null {
  if (!node) return null
  let id = nodeIdentity.get(node)
  if (id === undefined) { id = nextNodeIdentity++; nodeIdentity.set(node, id) }
  return id
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`
}
function poseFromBody(pose: BodyPose): PoseKind {
  return pose === 'idle' ? 'idle' : pose === 'walk' ? 'walk' : pose === 'jog' ? 'jog' : pose === 'sit' || pose === 'soak' || pose === 'lie' ? 'sit' : 'other'
}
function poseFromFallback(pose: Pose): PoseKind {
  return pose === 'walk' ? 'walk' : pose === 'jog' ? 'jog' : pose === 'sit' || pose === 'relax' ? 'sit' : pose === 'stand' ? 'idle' : 'other'
}
function stableFingerprint(look: unknown, seed: unknown): string {
  if (!(seed === undefined || typeof seed === 'string' && seed.length <= 256 || typeof seed === 'number' && Number.isFinite(seed))) return ''
  return canonical({ look: normalizeLook(look, seed), seed })
}

/** Real Kit wrapper. Its private lease is minted from createKit(), never a caller descriptor. */
export function createTrackedKit(options: { matte?: boolean } = {}): TrackedKit {
  const kit = createKit(options)
  const token = Object.freeze({}), lease = Object.freeze({})
  const owner: KitOwner = { kit, token, lease, materials: new WeakSet(), textures: new WeakSet(), liveTextures: new WeakSet(), watchedTextures: new WeakSet(),
    geometries: new WeakSet(), callbacks: new Set(), open: true, generation: 0, templateCacheObserved: false }
  owner.geometries.add(kit.boxGeometry); owner.geometries.add(kit.sphereGeometry); owner.geometries.add(kit.cylinderGeometry); owner.geometries.add(kit.crownGeometry)
  const rawOnDispose = kit.onDispose.bind(kit)
  const rawDispose = kit.dispose.bind(kit)
  const rawEachMaterial = kit.eachMaterial.bind(kit)
  kit.onDispose = (callback) => { owner.callbacks.add(callback); return rawOnDispose(callback) }
  const observeKitMaterial = (material: THREE.Material) => {
    owner.materials.add(material)
    for (const value of Object.values(material)) if (value && typeof value === 'object' && (value as THREE.Texture).isTexture) observeKitTexture(value as THREE.Texture)
  }
  function observeKitTexture(texture: THREE.Texture) {
    owner.textures.add(texture); owner.liveTextures.add(texture)
    if (!owner.watchedTextures.has(texture)) {
      owner.watchedTextures.add(texture)
      texture.addEventListener('dispose', () => { owner.liveTextures.delete(texture); owner.generation++ })
    }
  }
  kit.eachMaterial = (callback) => rawEachMaterial((material) => { observeKitMaterial(material); callback(material) })
  // Observe all current and future Kit materials while preserving the actual Kit factory behavior.
  kit.eachMaterial(observeKitMaterial)
  kit.onDispose(() => { owner.open = false; owner.generation++ })
  kit.dispose = () => {
    if (!owner.open) return
    owner.open = false; owner.generation++
    rawDispose()
  }
  kits.set(token, owner)
  return Object.freeze({ token })
}

/** A frame handle is minted by this adapter and must be consumed synchronously. */
export function beginHostFrame(sequence: number): HostFrame | null {
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence <= lastFrameSequence) return null
  lastFrameSequence = sequence
  const frame = Object.freeze({ token: Object.freeze({}), sequence })
  hostFrames.add(frame)
  return frame
}

function materialFingerprint(material: THREE.Material): string {
  const record = material as THREE.Material & { color?: THREE.Color; emissive?: THREE.Color; roughness?: number; metalness?: number; map?: THREE.Texture | null; alphaMap?: THREE.Texture | null }
  const textures = Object.entries(material).flatMap(([name, value]) => {
    if (!value || typeof value !== 'object' || !(value as THREE.Texture).isTexture) return []
    const texture = value as THREE.Texture
    return [{ name, version: texture.version, mapping: texture.mapping, channel: texture.channel, colorSpace: texture.colorSpace,
      wrapS: texture.wrapS, wrapT: texture.wrapT, minFilter: texture.minFilter, magFilter: texture.magFilter,
      source: nodeId(texture.source), image: nodeId(texture.image as object | null), matrix: [...texture.matrix.elements],
      offset: texture.offset.toArray(), repeat: texture.repeat.toArray(), center: texture.center.toArray(), rotation: texture.rotation }]
  })
  return createHash('sha256').update(JSON.stringify({ type: material.type, name: material.name, visible: material.visible,
    side: material.side, transparent: material.transparent, opacity: material.opacity, alphaTest: material.alphaTest,
    depthTest: material.depthTest, depthWrite: material.depthWrite, vertexColors: material.vertexColors,
    color: record.color?.toArray() ?? null, emissive: record.emissive?.toArray() ?? null, roughness: record.roughness ?? null,
    metalness: record.metalness ?? null, textures, customKey: material.customProgramCacheKey() })).digest('hex')
}
function registerMaterial(material: THREE.Material, kind: ActorKind, kit: KitOwner, actorLease: object): MaterialOwner | null {
  const programKey = material.customProgramCacheKey()
  const textures = Object.entries(material).flatMap(([, value]) => value && typeof value === 'object' && (value as THREE.Texture).isTexture
    ? [{ texture: value as THREE.Texture, ownerLease: kit.lease }] : [])
  // A skinned material is accepted only in the immediate result of the actual loadBody call,
  // after its Kit-scoped shared-template disposal callback has been observed. Those maps are
  // part of that privately owned template cache; fallback maps, if any, come from Kit materials.
  if (kind === 'skinned' && !kit.templateCacheObserved) return null
  if (kind === 'skinned') for (const entry of textures) {
    kit.textures.add(entry.texture); kit.liveTextures.add(entry.texture)
    if (!kit.watchedTextures.has(entry.texture)) {
      kit.watchedTextures.add(entry.texture)
      entry.texture.addEventListener('dispose', () => { kit.liveTextures.delete(entry.texture); kit.generation++ })
    }
  }
  if (kind === 'procedural-fallback' && textures.some(entry => !kit.textures.has(entry.texture) || !kit.liveTextures.has(entry.texture))) return null
  if (kind === 'skinned' && programKey === BODY_KEY && (material.type === 'MeshStandardMaterial' || material.type === 'MeshLambertMaterial')) {
    return Object.freeze({ material, ownerLease: actorLease, ownerGeneration: 0, shaderPath: 'production-body-skinning', sourceSha256: BODY_SOURCE_SHA256, materialFingerprint: materialFingerprint(material),
      programKey, onBeforeCompile: material.onBeforeCompile, stockOnBeforeCompile: null, textures: Object.freeze(textures) })
  }
  if (kind === 'skinned' && programKey === WARDROBE_KEY && (material.type === 'MeshStandardMaterial' || material.type === 'MeshLambertMaterial')) {
    return Object.freeze({ material, ownerLease: actorLease, ownerGeneration: 0, shaderPath: 'production-wardrobe-fabric', sourceSha256: WARDROBE_SOURCE_SHA256, materialFingerprint: materialFingerprint(material),
      programKey, onBeforeCompile: material.onBeforeCompile, stockOnBeforeCompile: null, textures: Object.freeze(textures) })
  }
  if (kind === 'procedural-fallback' && kit.materials.has(material) && material.onBeforeCompile === THREE.Material.prototype.onBeforeCompile
    && createHash('sha256').update(Function.prototype.toString.call(THREE.Material.prototype.onBeforeCompile)).digest('hex') === THREE_DEFAULT_CALLBACK_SHA256
    && programKey === Function.prototype.toString.call(THREE.Material.prototype.onBeforeCompile)) {
    return Object.freeze({ material, ownerLease: kit.lease, ownerGeneration: kit.generation, shaderPath: 'three-default-skinning', sourceSha256: THREE_LOCK_SHA256, materialFingerprint: materialFingerprint(material),
      programKey, onBeforeCompile: material.onBeforeCompile, stockOnBeforeCompile: THREE.Material.prototype.onBeforeCompile, textures: Object.freeze(textures) })
  }
  return null
}

interface BoundedTree { readonly nodes: readonly THREE.Object3D[]; readonly ancestors: readonly THREE.Object3D[]; readonly maxDepth: number; readonly elapsedMs: number }
/** Recompute transforms through a capped walk; never call Object3D's recursive world-update helpers here. */
function updateTreeBounded(root: THREE.Object3D): BoundedTree | null {
  const started = performance.now(), ancestors: THREE.Object3D[] = [], seen = new Set<THREE.Object3D>()
  let parent = root.parent
  while (parent) {
    if (seen.has(parent) || ancestors.length >= 64 || performance.now() - started > 50) return null
    seen.add(parent); ancestors.push(parent); parent = parent.parent
  }
  const updateLocalAndWorld = (node: THREE.Object3D) => {
    if (!node.matrixWorldAutoUpdate) throw new Error('manual-world-matrix-unsupported')
    if (node.matrixAutoUpdate) node.updateMatrix()
    if (node.parent) node.matrixWorld.multiplyMatrices(node.parent.matrixWorld, node.matrix)
    else node.matrixWorld.copy(node.matrix)
    if (!node.matrix.elements.every(Number.isFinite) || !node.matrixWorld.elements.every(Number.isFinite)) throw new Error('non-finite-node-transform')
  }
  try {
    for (let i = ancestors.length - 1; i >= 0; i--) updateLocalAndWorld(ancestors[i]!)
    const nodes: THREE.Object3D[] = [], stack: { node: THREE.Object3D; depth: number }[] = [{ node: root, depth: 0 }]
    let maxDepth = 0
    while (stack.length) {
      if (performance.now() - started > 50 || nodes.length >= 512) return null
      const item = stack.pop()!
      if (item.depth > 64 || seen.has(item.node)) return null
      seen.add(item.node); updateLocalAndWorld(item.node)
      nodes.push(item.node); maxDepth = Math.max(maxDepth, item.depth)
      if (nodes.length + stack.length + item.node.children.length > 512) return null
      for (let i = item.node.children.length - 1; i >= 0; i--) stack.push({ node: item.node.children[i]!, depth: item.depth + 1 })
    }
    const elapsedMs = performance.now() - started
    if (elapsedMs > 50) return null
    return { nodes: Object.freeze(nodes), ancestors: Object.freeze(ancestors), maxDepth, elapsedMs }
  } catch { return null }
}

function registerActor(root: THREE.Object3D, kind: ActorKind, kit: KitOwner, fingerprint: string, body?: SkinnedBody, avatar?: AvatarGroup): ObservedActor | null {
  if (!kit.open || !fingerprint) return null
  const registrationStarted = performance.now()
  const tree = updateTreeBounded(root)
  if (!tree) return null
  const structure = [...tree.nodes], geometryRefs: THREE.BufferGeometry[] = [], registeredMaterials = new Set<THREE.Material>(), materialOwners = new WeakMap<THREE.Material, MaterialOwner>()
  const actorToken = Object.freeze({}), lease = Object.freeze({})
  let bodyShaderCount = 0, wardrobeShaderCount = 0, bytes = 0, triangles = 0
  let invalid = false
  for (const node of tree.nodes) {
    if (performance.now() - registrationStarted > 50) { invalid = true; break }
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) {
      if ('geometry' in node || 'material' in node || (node as THREE.Sprite).isSprite) invalid = true
      if (invalid) break
      continue
    }
    if (!mesh.geometry?.isBufferGeometry || (mesh as THREE.InstancedMesh).isInstancedMesh || mesh.geometry.groups.length > 256) { invalid = true; break }
    const summary = geometryDigest(mesh)
    if (!summary) { invalid = true; break }
    bytes += summary.bytes; triangles += summary.triangles
    if (bytes > MAX_ATTRIBUTE_BYTES || triangles > 100_000) { invalid = true; break }
    geometryRefs.push(mesh.geometry)
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (!meshMaterials.length || mesh.geometry.groups.some(group => !Number.isInteger(group.materialIndex) || group.materialIndex < 0 || group.materialIndex >= meshMaterials.length)) { invalid = true; break }
    for (const material of meshMaterials) {
      const proof = registerMaterial(material, kind, kit, lease)
      if (!proof) { invalid = true; break }
      if (proof.shaderPath === 'production-body-skinning') bodyShaderCount++
      if (proof.shaderPath === 'production-wardrobe-fabric') wardrobeShaderCount++
      registeredMaterials.add(material)
      materialOwners.set(material, proof)
    }
    if (invalid) break
  }
  if (invalid || performance.now() - registrationStarted > 50 || !structure.length
    || (kind === 'skinned' && bodyShaderCount !== 1) || (kind === 'skinned' && wardrobeShaderCount < 1)) return null
  const pose: PoseWitness = body
    ? { pose: 'idle', clip: STILL.idle.clip, clipTimeSeconds: null, gaitPhaseRadians: null, transitionProgress: null, easing: body.easing, hostPhase: 'skinned:still-idle' }
    : { pose: 'idle', clip: null, clipTimeSeconds: null, gaitPhaseRadians: null, transitionProgress: null, easing: false, hostPhase: 'fallback:stand' }
  const actor: ActorOwner = { token: actorToken, root, kind, kit, lease, materialOwners, structure: Object.freeze(structure), geometryRefs: Object.freeze(geometryRefs), active: true,
    resourcesLive: true, generation: 0, appearanceFingerprint: fingerprint, presentation: 'everyday', pose, ...(body ? { body } : {}), ...(avatar ? { avatar } : {}) }
  for (const geometry of new Set(geometryRefs)) geometry.addEventListener('dispose', () => { actor.resourcesLive = false; actor.generation++ })
  const actorTextures = new Set<THREE.Texture>()
  for (const material of registeredMaterials) {
    material.addEventListener('dispose', () => { actor.resourcesLive = false; actor.generation++ })
    for (const texture of materialOwners.get(material)?.textures ?? []) actorTextures.add(texture.texture)
  }
  for (const texture of actorTextures) texture.addEventListener('dispose', () => { actor.resourcesLive = false; actor.generation++ })
  actors.set(actorToken, actor)
  return Object.freeze({ token: actorToken })
}

function trackBody(body: SkinnedBody, actor: ActorOwner, kit: KitOwner): void {
  const originalDispose = body.dispose.bind(body)
  body.dispose = () => { if (!actor.active) return; actor.active = false; actor.generation++; originalDispose() }
  const originalShow = body.show.bind(body)
  body.show = (pose, animate = false) => {
    originalShow(pose, animate); actor.generation++
    actor.pose = body.easing
      ? { pose: poseFromBody(body.pose), clip: null, clipTimeSeconds: null, gaitPhaseRadians: null, transitionProgress: null, easing: true, hostPhase: 'skinned:unsupported-transition' }
      : { pose: poseFromBody(body.pose), clip: STILL[body.pose]?.clip ?? null, clipTimeSeconds: null, gaitPhaseRadians: null, transitionProgress: null, easing: false, hostPhase: `skinned:still-${body.pose}` }
  }
  const originalStride = body.stride.bind(body)
  body.stride = (phase, jog, climb = 0) => {
    originalStride(phase, jog, climb); actor.generation++
    const clip = climb ? (climb > 0 ? STAIRS.up : STAIRS.down) : (jog ? 'jog' : 'walk')
    actor.pose = { pose: jog ? 'jog' : 'walk', clip, clipTimeSeconds: null, gaitPhaseRadians: phase, transitionProgress: null, easing: false, hostPhase: `skinned:${clip}` }
  }
  const originalEnter = body.enter.bind(body)
  body.enter = animate => { originalEnter(animate); actor.generation++; actor.pose = body.easing
    ? { pose: 'entry', clip: 'door', clipTimeSeconds: 0, gaitPhaseRadians: null, transitionProgress: 0, easing: true, hostPhase: 'skinned:door-transition' }
    : { pose: 'idle', clip: STILL.idle.clip, clipTimeSeconds: null, gaitPhaseRadians: null, transitionProgress: null, easing: false, hostPhase: 'skinned:still-idle' } }
  const originalStep = body.step.bind(body)
  body.step = dt => { const active = originalStep(dt); actor.generation++; if (!body.easing) actor.pose = { pose: poseFromBody(body.pose), clip: STILL[body.pose]?.clip ?? null,
    clipTimeSeconds: null, gaitPhaseRadians: null, transitionProgress: null, easing: false, hostPhase: `skinned:still-${body.pose}` }; return active }
  const originalSettle = body.settle.bind(body)
  body.settle = () => { originalSettle(); actor.generation++; actor.pose = { pose: poseFromBody(body.pose), clip: STILL[body.pose]?.clip ?? null,
    clipTimeSeconds: null, gaitPhaseRadians: null, transitionProgress: null, easing: false, hostPhase: `skinned:still-${body.pose}` } }
  const originalWear = body.wear.bind(body)
  body.wear = (look, seed) => {
    const result = originalWear(look, seed)
    if (result) { actor.appearanceFingerprint = createHash('sha256').update(`${stableFingerprint(look, seed)}|presentation:${actor.presentation}`).digest('hex'); actor.generation++ }
    return result
  }
  const originalSetPresentation = body.setPresentation.bind(body)
  body.setPresentation = presentation => {
    const changed = originalSetPresentation(presentation)
    if (changed) { actor.presentation = presentation; actor.appearanceFingerprint = createHash('sha256').update(`${actor.appearanceFingerprint}|presentation:${presentation}`).digest('hex'); actor.generation++ }
    return changed
  }
  const originalPlace = body.place.bind(body)
  body.place = (x, y, z, ry) => { originalPlace(x, y, z, ry); actor.generation++; actor.pose.hostPhase = `skinned:placed:${body.pose}` }
  const originalSitOn = body.sitOn.bind(body)
  body.sitOn = (x, top, z, ry) => { originalSitOn(x, top, z, ry); actor.generation++; actor.pose.hostPhase = 'skinned:seat-anchor' }
  const originalWorkOn = body.workOn.bind(body)
  body.workOn = (x, floor, z, ry) => { originalWorkOn(x, floor, z, ry); actor.generation++; actor.pose.hostPhase = 'skinned:work-anchor' }
  const originalSampleUse = body.sampleUse.bind(body)
  body.sampleUse = (pose, seconds) => { originalSampleUse(pose, seconds); actor.generation++; actor.pose = { pose: poseFromBody(pose), clip: null, clipTimeSeconds: seconds,
    gaitPhaseRadians: null, transitionProgress: null, easing: false, hostPhase: 'skinned:timed-use-pose' } }
  // This callback identity was registered by loadBody through the actual Kit.onDispose path.
}

/** Calls the shipped loader and registers only the returned production actor instance. */
export async function loadObservedBody(ownerHandle: TrackedKit, look: unknown, seed: unknown, sceneScale: number): Promise<ObservedActor | null> {
  const kit = ownerHandle && kits.get(ownerHandle.token)
  const fingerprint = stableFingerprint(look, seed)
  if (!kit?.open || !fingerprint || !Number.isFinite(sceneScale) || sceneScale <= 0) return null
  const callbacksBefore = new Set(kit.callbacks)
  let body: SkinnedBody
  try { body = await loadBody(kit.kit, look, seed, sceneScale) } catch { return null }
  const added = [...kit.callbacks].filter(callback => !callbacksBefore.has(callback))
  if (!kit.cacheCallback && added.length === 1) kit.cacheCallback = added[0]
  const cacheStillOwned = !!kit.cacheCallback && kit.callbacks.has(kit.cacheCallback)
  if (!kit.open || !cacheStillOwned) { body.dispose(); return null }
  kit.templateCacheObserved = true
  const handle = registerActor(body.object, 'skinned', kit, fingerprint, body)
  const actor = handle && actors.get(handle.token)
  if (!handle || !actor) { body.dispose(); return null }
  trackBody(body, actor, kit)
  // The wrapped source body callback is registered before loadBody returns and calls body.dispose dynamically.
  return handle
}

/** Calls the shipped procedural fallback builder with a real Kit and registers its returned actor subtree. */
export function buildObservedFallback(ownerHandle: TrackedKit, look: unknown, seed: unknown): ObservedActor | null {
  const kit = ownerHandle && kits.get(ownerHandle.token)
  const fingerprint = stableFingerprint(look, seed)
  if (!kit?.open || !fingerprint) return null
  let avatar: AvatarGroup
  try { avatar = buildAvatar(kit.kit, look, { rig: true, seed }) } catch { return null }
  avatar.userData.look = normalizeLook(look, seed) as typeof avatar.userData.look
  const handle = registerActor(avatar, 'procedural-fallback', kit, fingerprint, undefined, avatar)
  const actor = handle && actors.get(handle.token)
  if (!handle || !actor) { avatar.userData.dispose(); return null }
  const dispose = avatar.userData.dispose.bind(avatar.userData)
  avatar.userData.dispose = () => { if (!actor.active) return; actor.active = false; actor.generation++; dispose() }
  return handle
}

/** Attach an adapter-owned actor without exposing its root or internal lifetime lease. */
export function mountObservedActor(actorHandle: ObservedActor, parent: THREE.Object3D, placement: Readonly<{ x: number; y: number; z: number; yaw: number }>): boolean {
  const actor = actorHandle && actors.get(actorHandle.token)
  if (!actor?.active || !actor.kit.open || !parent?.isObject3D || ![placement.x, placement.y, placement.z, placement.yaw].every(Number.isFinite)) return false
  if (actor.root.parent) return false
  actor.root.position.set(placement.x, placement.y, placement.z)
  actor.root.rotation.set(0, placement.yaw, 0)
  parent.add(actor.root)
  if (!updateTreeBounded(actor.root)) { parent.remove(actor.root); return false }
  actor.generation++
  return true
}

/** Pose through the real production body/fallback API; unknown/transitional states remain unobservable. */
export function setObservedPose(actorHandle: ObservedActor, pose: BodyPose | Pose, phase = 0, jog = false, climb = 0): boolean {
  const actor = actorHandle && actors.get(actorHandle.token)
  if (!actor?.active || !actor.kit.open || !Number.isFinite(phase) || !Number.isFinite(climb)) return false
  if (actor.body) {
    if (pose === 'walk' || pose === 'jog') actor.body.stride(phase, jog || pose === 'jog', climb)
    else actor.body.show(pose as BodyPose, false)
    return !!updateTreeBounded(actor.root)
  }
  if (!actor.avatar || typeof pose !== 'string' || !['stand', 'walk', 'jog', 'sit', 'relax', 'work', 'wave', 'dance'].includes(pose)) return false
  poseAvatar(actor.avatar, { pose: pose as Pose, stride: phase })
  actor.generation++
  actor.pose = { pose: poseFromFallback(pose as Pose), clip: null, clipTimeSeconds: null,
    gaitPhaseRadians: pose === 'walk' || pose === 'jog' ? phase : null, transitionProgress: null, easing: false, hostPhase: `fallback:${pose}` }
  return !!updateTreeBounded(actor.root)
}

export function beginObservedTransition(actorHandle: ObservedActor, pose: BodyPose, entering = false): boolean {
  const actor = actorHandle && actors.get(actorHandle.token)
  if (!actor?.active || !actor.kit.open || !actor.body) return false
  if (entering) actor.body.enter(true)
  else actor.body.show(pose, true)
  return !!updateTreeBounded(actor.root)
}

export function wearObservedLook(actorHandle: ObservedActor, look: unknown, seed: unknown): boolean {
  const actor = actorHandle && actors.get(actorHandle.token)
  if (!actor?.active || !actor.kit.open || !stableFingerprint(look, seed)) return false
  if (!actor.body) return false // A fallback must be rebuilt through buildObservedFallback; it has no mutable wardrobe controller.
  const changed = actor.body.wear(look, seed)
  return changed && !!updateTreeBounded(actor.root)
}

export function placeObservedActor(actorHandle: ObservedActor, x: number, y: number, z: number, yaw: number): boolean {
  const actor = actorHandle && actors.get(actorHandle.token)
  if (!actor?.active || !actor.kit.open || ![x, y, z, yaw].every(Number.isFinite)) return false
  if (actor.body) actor.body.place(x, y, z, yaw)
  else { actor.root.position.set(x, y, z); actor.root.rotation.y = yaw; actor.generation++ }
  return !!updateTreeBounded(actor.root)
}

export function advanceObservedTransition(actorHandle: ObservedActor, dt: number): boolean | null {
  const actor = actorHandle && actors.get(actorHandle.token)
  if (!actor?.active || !actor.kit.open || !actor.body || !Number.isFinite(dt) || dt < 0) return null
  const active = actor.body.step(dt)
  return updateTreeBounded(actor.root) ? active : null
}

export function settleObservedActor(actorHandle: ObservedActor): boolean {
  const actor = actorHandle && actors.get(actorHandle.token)
  if (!actor?.active || !actor.kit.open || !actor.body) return false
  actor.body.settle(); return !!updateTreeBounded(actor.root)
}

export function disposeObservedActor(actorHandle: ObservedActor): boolean {
  const actor = actorHandle && actors.get(actorHandle.token)
  if (!actor?.active) return false
  if (actor.body) actor.body.dispose()
  else actor.avatar?.userData.dispose?.()
  actor.root.removeFromParent()
  actor.active = false
  actor.generation++
  return true
}

export function disposeTrackedKit(kitHandle: TrackedKit): boolean {
  const kit = kitHandle && kits.get(kitHandle.token)
  if (!kit?.open) return false
  kit.kit.dispose()
  return true
}

function geometryDigest(mesh: THREE.Mesh): { digest: string; bytes: number; indexCount: number; vertexCount: number; drawStart: number; drawCount: number; triangles: number } | null {
  const geometry = mesh.geometry
  const hash = createHash('sha256')
  let bytes = 0
  const updateArray = (array: ArrayLike<number> & { readonly buffer?: ArrayBufferLike; readonly byteOffset?: number; readonly byteLength?: number; readonly constructor: { readonly name?: string } }, schema: string): boolean => {
    if (!array || !array.buffer || !Number.isSafeInteger(array.byteLength) || !Number.isSafeInteger(array.byteOffset)) return false
    bytes += array.byteLength
    if (bytes > MAX_ATTRIBUTE_BYTES) return false
    hash.update(schema)
    hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength))
    return true
  }
  const hashAttribute = (name: string, attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): boolean => {
    const raw = 'data' in attribute ? attribute.data.array : attribute.array
    const interleaved = 'data' in attribute ? `${attribute.data.stride}:${attribute.offset}` : 'plain'
    if ((raw instanceof Float32Array || raw instanceof Float64Array) && raw.some(value => !Number.isFinite(value))) return false
    return updateArray(raw, `${name}|${attribute.itemSize}|${attribute.count}|${attribute.normalized}|${attribute.version}|${raw.constructor.name}|${interleaved}`)
  }
  const index = geometry.index
  const position = geometry.getAttribute('position')
  if (!position) return null
  if (index && !hashAttribute('index', index)) return null
  for (const name of Object.keys(geometry.attributes).sort()) if (!hashAttribute(`attribute:${name}`, geometry.attributes[name]!)) return null
  for (const name of Object.keys(geometry.morphAttributes).sort()) {
    const attributes = geometry.morphAttributes[name]!
    if (attributes.length > MAX_MORPH_CHANNELS) return null
    for (let i = 0; i < attributes.length; i++) if (!hashAttribute(`morph:${name}:${i}`, attributes[i]!)) return null
  }
  const elementCount = index?.count ?? position.count
  const drawStart = geometry.drawRange.start
  const drawCount = geometry.drawRange.count === Infinity ? elementCount - drawStart : Math.min(geometry.drawRange.count, elementCount - drawStart)
  if (!Number.isSafeInteger(elementCount) || elementCount < 0 || elementCount % 3 !== 0 || !Number.isInteger(drawStart) || drawStart < 0 || drawStart % 3 !== 0
    || !Number.isSafeInteger(drawCount) || drawCount < 0 || drawCount % 3 !== 0 || drawStart + drawCount > elementCount) return null
  if (index) {
    const raw = index.array
    for (let i = 0; i < raw.length; i++) if (!Number.isInteger(raw[i]) || raw[i]! < 0 || raw[i]! >= position.count) return null
  }
  if (geometry.groups.length > 256 || Object.keys(geometry.attributes).length > 32) return null
  const groups = geometry.groups.map(group => ({ start: group.start, count: group.count, materialIndex: group.materialIndex }))
  if (groups.some(group => !Number.isInteger(group.start) || group.start < 0 || !Number.isInteger(group.count) || group.count < 0 || group.start + group.count > elementCount || group.start % 3 !== 0 || group.count % 3 !== 0)) return null
  const morphInfluences = (mesh as THREE.Mesh & { morphTargetInfluences?: number[] }).morphTargetInfluences ?? []
  if (morphInfluences.length > MAX_MORPH_CHANNELS || morphInfluences.some(value => !Number.isFinite(value))) return null
  hash.update(JSON.stringify({ groups, drawStart, drawCount, elementCount, vertexCount: position.count, morphInfluences,
    dictionary: (mesh as THREE.Mesh & { morphTargetDictionary?: Record<string, number> }).morphTargetDictionary ?? null,
    visible: mesh.visible, layerMask: mesh.layers.mask, renderOrder: mesh.renderOrder, castShadow: mesh.castShadow,
    receiveShadow: mesh.receiveShadow, frustumCulled: mesh.frustumCulled,
    matrix: mesh.matrix.elements, matrixWorld: mesh.matrixWorld.elements }))
  const skinned = mesh as THREE.SkinnedMesh
  if (skinned.isSkinnedMesh) {
    if (!skinned.skeleton || skinned.skeleton.bones.length > 128) return null
    skinned.skeleton.update()
    hash.update(new Uint8Array(skinned.skeleton.boneMatrices.buffer, skinned.skeleton.boneMatrices.byteOffset, skinned.skeleton.boneMatrices.byteLength))
    hash.update(JSON.stringify({ bones: skinned.skeleton.bones.map(bone => bone.matrixWorld.elements), inverses: skinned.skeleton.boneInverses.map(value => value.elements),
      bind: skinned.bindMatrix.elements, bindInverse: skinned.bindMatrixInverse.elements }))
  }
  return { digest: hash.digest('hex'), bytes, indexCount: elementCount, vertexCount: position.count, drawStart, drawCount, triangles: drawCount / 3 }
}

/** Enumerates the actual complete subtree and rejects unsupported/over-budget position inputs. */
function collectLive(record: ActorOwner, frame: HostFrame): { input: ActorEvaluationInput; digest: string; nodes: readonly object[]; rawAttributeBytes: number } | null {
  const started = performance.now()
  if (!record.active || !record.resourcesLive || !record.kit.open || (record.kind === 'skinned' && !record.kit.templateCacheObserved)
    || record.pose.easing || record.pose.pose === 'entry' || record.pose.pose === 'exit' || record.pose.pose === 'other') return null
  const tree = updateTreeBounded(record.root)
  if (!tree) return null
  const nodes = tree.nodes, meshes: ActorEvaluationInput['meshes'][number][] = [], digests: string[] = []
  let attributeBytes = 0, triangleTotal = 0, failure = false
  for (const node of nodes) {
    if (performance.now() - started > 50) { failure = true; break }
    digests.push(createHash('sha256').update(JSON.stringify({ id: nodeId(node), parent: nodeId(node.parent), type: node.type, name: node.name,
      visible: node.visible, layers: node.layers.mask, matrixAutoUpdate: node.matrixAutoUpdate, matrixWorldAutoUpdate: node.matrixWorldAutoUpdate,
      matrix: node.matrix.elements, matrixWorld: node.matrixWorld.elements })).digest('hex'))
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) {
      if ('geometry' in node || 'material' in node || (node as THREE.Sprite).isSprite) { failure = true; break }
      continue
    }
    if (meshes.length >= 128 || !mesh.geometry?.isBufferGeometry || (mesh as THREE.InstancedMesh).isInstancedMesh) { failure = true; break }
    const summary = geometryDigest(mesh)
    if (!summary) { failure = true; break }
    attributeBytes += summary.bytes; triangleTotal += summary.triangles
    if (attributeBytes > MAX_ATTRIBUTE_BYTES || triangleTotal > 100_000) { failure = true; break }
    const materialList = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (!materialList.length || mesh.geometry.groups.some(group => group.materialIndex < 0 || group.materialIndex >= materialList.length)) { failure = true; break }
    const materials: ActorEvaluationInput['meshes'][number]['materials'][number][] = []
    for (const material of materialList) {
      const proof = record.materialOwners.get(material)
      if (!proof || proof.material !== material || material.onBeforeCompile !== proof.onBeforeCompile || material.customProgramCacheKey() !== proof.programKey
        || materialFingerprint(material) !== proof.materialFingerprint || !record.kit.open
        || proof.ownerGeneration !== (proof.ownerLease === record.kit.lease ? record.kit.generation : 0)
        || proof.textures.some(texture => texture.ownerLease !== record.kit.lease || !record.kit.textures.has(texture.texture) || !record.kit.liveTextures.has(texture.texture))) { failure = true; break }
      materials.push({ material, materialType: material.type, shaderPath: proof.shaderPath, programKey: proof.programKey, shaderSourceSha256: proof.sourceSha256,
        onBeforeCompile: proof.onBeforeCompile, stockOnBeforeCompile: proof.stockOnBeforeCompile, ownerLease: proof.ownerLease, ownerGeneration: proof.ownerGeneration })
    }
    if (failure) break
    const skinned = mesh as THREE.SkinnedMesh
    if (skinned.isSkinnedMesh && !skinned.skeleton) { failure = true; break }
    const skeletonState = skinned.isSkinnedMesh ? {
      skeleton: skinned.skeleton, generation: record.generation,
      bones: skinned.skeleton.bones.map(bone => ({ bone, matrixWorld: [...bone.matrixWorld.elements] })),
      bindMatrix: [...skinned.bindMatrix.elements], bindMatrixInverse: [...skinned.bindMatrixInverse.elements],
    } : null
    const geometryOwner = record.kind === 'procedural-fallback' && record.kit.geometries.has(mesh.geometry) ? record.kit.lease : record.lease
    if (record.kind === 'skinned' && !record.geometryRefs.includes(mesh.geometry)) { failure = true; break }
    if (record.kind === 'procedural-fallback' && geometryOwner !== record.kit.lease && !record.geometryRefs.includes(mesh.geometry)) { failure = true; break }
    meshes.push({ mesh, geometry: mesh.geometry, geometryGeneration: record.generation, drawStart: summary.drawStart, drawCount: summary.drawCount,
      indexCount: summary.indexCount, vertexCount: summary.vertexCount, triangles: summary.triangles, skeleton: skeletonState, materials })
    digests.push(summary.digest, geometryOwner === record.kit.lease ? 'geometry-owner:kit' : 'geometry-owner:actor')
  }
  if (failure || performance.now() - started > 50 || nodes.length !== record.structure.length
    || nodes.some((node, index) => node !== record.structure[index])) return null
  const ancestors: ActorEvaluationInput['ancestors'][number][] = tree.ancestors.map(parent => ({ node: parent, parent: parent.parent,
    matrixLocal: [...parent.matrix.elements], matrixWorld: [...parent.matrixWorld.elements] }))
  const elapsedMs = performance.now() - started
  if (!Number.isFinite(elapsedMs) || elapsedMs > 50) return null
  const input: ActorEvaluationInput = {
    turn: Object.freeze({ token: frame.token, frameSequence: frame.sequence }), actor: record.token, actorGeneration: record.generation, rendererPath: record.kind,
    appearanceFingerprint: record.appearanceFingerprint,
    phase: { hostPhase: record.pose.hostPhase, pose: record.pose.pose, easing: record.pose.easing, clip: record.pose.clip,
      clipTimeSeconds: record.pose.clipTimeSeconds, gaitPhaseRadians: record.pose.gaitPhaseRadians, transitionProgress: record.pose.transitionProgress },
    ancestors, root: { node: record.root, parent: record.root.parent, matrixLocal: [...record.root.matrix.elements], matrixWorld: [...record.root.matrixWorld.elements] },
    meshes, traversal: { nodes: nodes.length, meshes: meshes.length, triangles: triangleTotal, maxDepth: tree.maxDepth, elapsedMs, deadlineExceeded: false, aborted: false },
  }
  return { input, digest: createHash('sha256').update(digests.join('|')).digest('hex'), nodes, rawAttributeBytes: attributeBytes }
}

/** Capture an actual loader-owned actor after its caller has evaluated the pose and placement. */
export function captureObservedActor(actorHandle: ObservedActor, frame: HostFrame): ObservationResult {
  const actor = actorHandle && actors.get(actorHandle.token)
  if (!actor || !hostFrames.has(frame) || !actor.active || !actor.kit.open) return fail('unregistered-actor-kit-or-frame')
  const live = collectLive(actor, frame)
  if (!live) return fail('unknown-phase-owner-geometry-or-traversal')
  const v6 = captureActorEvaluation(live.input)
  if (!v6) return fail('snapshot-contract-rejected-live-host-state')
  const snapshot = Object.freeze({})
  snapshots.set(snapshot, { actor, hostFrame: frame, v6Token: v6.token, geometryDigest: live.digest, structure: live.nodes,
    version: actor.generation })
  queueMicrotask(() => snapshots.delete(snapshot))
  return Object.freeze({ state: 'ready', snapshot, geometryDigest: live.digest, nodeCount: live.nodes.length,
    meshCount: live.input.meshes.length, rawAttributeBytes: live.rawAttributeBytes, canBoard: false, routeAuthorized: false })
}

/** Must run synchronously in the same host frame as captureObservedActor, before its microtask expiry. */
export function validateObservedActorSnapshot(snapshot: object, actorHandle: ObservedActor, frame: HostFrame): EvaluationCheck {
  const saved = snapshots.get(snapshot)
  const actor = actorHandle && actors.get(actorHandle.token)
  if (!saved || !actor || saved.actor !== actor || saved.hostFrame !== frame || !hostFrames.has(frame) || !actor.active || !actor.kit.open
    || saved.version !== actor.generation) return Object.freeze({ state: 'refused', code: 'invalid-snapshot', canBoard: false, routeAuthorized: false })
  const current = collectLive(actor, frame)
  if (!current || current.digest !== saved.geometryDigest || current.nodes.length !== saved.structure.length
    || current.nodes.some((node, index) => node !== saved.structure[index])) return Object.freeze({ state: 'refused', code: 'geometry-or-draw-range-changed', canBoard: false, routeAuthorized: false })
  return validateActorEvaluation(saved.v6Token, current.input)
}

/** Close only this adapter's actor/Kit ownership; no caller-provided cache lease can enter the registry. */
export function actorEvidenceStatus(actorHandle: ObservedActor): Readonly<{ alive: boolean; templateCacheOwned: boolean; path: ActorKind | null }> {
  const actor = actorHandle && actors.get(actorHandle.token)
  return Object.freeze({ alive: !!actor?.active && !!actor.resourcesLive && !!actor.kit.open,
    templateCacheOwned: !!actor?.kit.open && !!actor.kit.templateCacheObserved && !!actor.kit.cacheCallback && actor.kit.callbacks.has(actor.kit.cacheCallback),
    path: actor?.kind ?? null })
}
