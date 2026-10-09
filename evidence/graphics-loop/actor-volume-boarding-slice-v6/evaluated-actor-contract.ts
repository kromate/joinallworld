/**
 * Source-only contract for one immutable, same-turn actor evaluation.
 * This module records evidence provenance; it does not calculate collision or authorize boarding.
 */
export type RendererPath = 'skinned' | 'procedural-fallback'
export type PoseKind = 'idle' | 'walk' | 'jog' | 'sit' | 'entry' | 'exit' | 'other'
export type ShaderPath = 'three-default-skinning' | 'production-body-skinning' | 'production-wardrobe-fabric'

export interface EvaluationTurn {
  /** Opaque identity for the exact host update/render turn. Equality is by object identity. */
  readonly token: object
  readonly frameSequence: number
}
export interface PhaseState {
  readonly hostPhase: string
  readonly pose: PoseKind
  readonly easing: boolean
  readonly clip: string | null
  readonly clipTimeSeconds: number | null
  readonly gaitPhaseRadians: number | null
  readonly transitionProgress: number | null
}
export interface PlacementNodeState {
  readonly node: object
  /** Actual Object3D.parent identity; ancestors are ordered from actor parent out to scene root. */
  readonly parent: object | null
  readonly matrixLocal: readonly number[]
  /** world matrix captured after the host has evaluated ancestor placement */
  readonly matrixWorld: readonly number[]
}
export interface SkeletonState {
  readonly skeleton: object
  readonly generation: number
  /** Ordered bone identities and their evaluated world matrices. */
  readonly bones: readonly { readonly bone: object; readonly matrixWorld: readonly number[] }[]
  readonly bindMatrix: readonly number[]
  readonly bindMatrixInverse: readonly number[]
}
export interface PositionMaterialState {
  readonly material: object
  readonly materialType: string
  readonly shaderPath: ShaderPath
  readonly programKey: string
  readonly shaderSourceSha256: string
  /** Exact onBeforeCompile callback; for Three default materials it must equal the host's stock callback. */
  readonly onBeforeCompile: Function
  readonly stockOnBeforeCompile: Function | null
  /** The cache/kit lease that owns this exact material instance. */
  readonly ownerLease: object
  readonly ownerGeneration: number
}
export interface EvaluatedMeshState {
  readonly mesh: object
  readonly geometry: object
  readonly geometryGeneration: number
  readonly drawStart: number
  readonly drawCount: number
  readonly indexCount: number
  readonly vertexCount: number
  readonly triangles: number
  readonly skeleton: SkeletonState | null
  readonly materials: readonly PositionMaterialState[]
}
export interface ActorEvaluationInput {
  readonly turn: EvaluationTurn
  readonly actor: object
  readonly actorGeneration: number
  readonly rendererPath: RendererPath
  /** Fingerprint of normalized look, seed, resolved garments, face/expression, and presentation. */
  readonly appearanceFingerprint: string
  readonly phase: PhaseState
  readonly ancestors: readonly PlacementNodeState[]
  readonly root: PlacementNodeState
  readonly meshes: readonly EvaluatedMeshState[]
  readonly traversal: { readonly nodes: number; readonly meshes: number; readonly triangles: number; readonly maxDepth: number; readonly elapsedMs: number; readonly deadlineExceeded: boolean; readonly aborted: boolean }
}

export const EVALUATION_LIMITS = Object.freeze({
  nodes: 512,
  meshes: 128,
  triangles: 100_000,
  depth: 64,
  elapsedMs: 50,
  bonesPerMesh: 128,
  matrixElements: 16,
})

export type RefusalCode =
  | 'invalid-snapshot' | 'traversal-over-budget' | 'deadline-exceeded'
  | 'different-host-turn' | 'stale-frame-sequence' | 'actor-generation-changed'
  | 'actor-or-look-changed' | 'phase-changed' | 'ancestor-chain-changed'
  | 'placement-matrix-changed' | 'skeleton-or-bind-changed' | 'geometry-or-draw-range-changed'
  | 'material-program-changed' | 'cache-owner-changed'

export type EvaluationCheck =
  | Readonly<{ state: 'current'; canBoard: false; routeAuthorized: false; sampledTriangles: number }>
  | Readonly<{ state: 'refused'; code: RefusalCode; canBoard: false; routeAuthorized: false }>

const issued = new WeakMap<object, { readonly captured: ActorEvaluationInput; readonly references: ReferenceManifest }>()
interface ReferenceManifest {
  readonly actor: object
  readonly root: object
  readonly ancestors: readonly object[]
  readonly meshes: readonly object[]
  readonly geometries: readonly object[]
  readonly skeletons: readonly (object | null)[]
  readonly bones: readonly (readonly object[])[]
  readonly materials: readonly (readonly object[])[]
  readonly ownerLeases: readonly (readonly object[])[]
}
const finite = (value: number): boolean => Number.isFinite(value)
const validMatrix = (matrix: readonly number[]): boolean => matrix.length === 16 && matrix.every(finite)
const validSha = (value: string): boolean => /^[a-f0-9]{64}$/.test(value)
const BODY_SOURCE_SHA256 = '4fa64261e15a7e104f527ad4782aff2bb80c53d559dc7a448d95d797d92c6bdb'
const WARDROBE_SOURCE_SHA256 = '4b053592fdc8efdad0e9cd5071cb853594c2db53829cd74116bf578f439f82da'
const THREE_LOCK_SHA256 = 'd3a82d0f0d7e750bee84042a2ab36dcaa655cf6e7c9bdb8047823e507112efa9'
const BODY_PROGRAM_KEY = 'allworld-body-sleep-socket-eyes-2'
const WARDROBE_PROGRAM_KEY = 'allworld-wardrobe-fabric-v2'
function supportedMaterial(mat: PositionMaterialState): boolean {
  if (!mat.material || !mat.ownerLease || typeof mat.onBeforeCompile !== 'function') return false
  if (mat.shaderPath === 'production-body-skinning') return mat.shaderSourceSha256 === BODY_SOURCE_SHA256 && mat.programKey === BODY_PROGRAM_KEY
    && (mat.materialType === 'MeshStandardMaterial' || mat.materialType === 'MeshLambertMaterial')
  if (mat.shaderPath === 'production-wardrobe-fabric') return mat.shaderSourceSha256 === WARDROBE_SOURCE_SHA256 && mat.programKey === WARDROBE_PROGRAM_KEY
    && (mat.materialType === 'MeshStandardMaterial' || mat.materialType === 'MeshLambertMaterial')
  return mat.shaderPath === 'three-default-skinning' && mat.shaderSourceSha256 === THREE_LOCK_SHA256
    && mat.stockOnBeforeCompile === mat.onBeforeCompile
    && mat.programKey === Function.prototype.toString.call(mat.onBeforeCompile)
}
function multiplyMatrices(a: readonly number[], b: readonly number[]): number[] {
  const out = Array<number>(16).fill(0)
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
    for (let k = 0; k < 4; k++) {
      const index = col * 4 + row
      out[index] = out[index]! + a[k * 4 + row]! * b[col * 4 + k]!
    }
  }
  return out
}
function matricesNear(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => Math.abs(value - b[index]!) <= 1e-8)
}

function cloneInput(input: ActorEvaluationInput): ActorEvaluationInput {
  const cloneSkeleton = (s: SkeletonState | null): SkeletonState | null => s && Object.freeze({
    skeleton: s.skeleton, generation: s.generation,
    bones: Object.freeze(s.bones.map(b => Object.freeze({ bone: b.bone, matrixWorld: Object.freeze([...b.matrixWorld]) }))),
    bindMatrix: Object.freeze([...s.bindMatrix]), bindMatrixInverse: Object.freeze([...s.bindMatrixInverse]),
  })
  return Object.freeze({
    turn: Object.freeze({ token: input.turn.token, frameSequence: input.turn.frameSequence }),
    actor: input.actor, actorGeneration: input.actorGeneration, rendererPath: input.rendererPath,
    appearanceFingerprint: `${input.appearanceFingerprint}`,
    phase: Object.freeze({ ...input.phase }),
    ancestors: Object.freeze(input.ancestors.map(a => Object.freeze({ node: a.node, parent: a.parent, matrixLocal: Object.freeze([...a.matrixLocal]), matrixWorld: Object.freeze([...a.matrixWorld]) }))),
    root: Object.freeze({ node: input.root.node, parent: input.root.parent, matrixLocal: Object.freeze([...input.root.matrixLocal]), matrixWorld: Object.freeze([...input.root.matrixWorld]) }),
    meshes: Object.freeze(input.meshes.map(m => Object.freeze({
      mesh: m.mesh, geometry: m.geometry, geometryGeneration: m.geometryGeneration,
      drawStart: m.drawStart, drawCount: m.drawCount, indexCount: m.indexCount, vertexCount: m.vertexCount, triangles: m.triangles,
      skeleton: cloneSkeleton(m.skeleton),
      materials: Object.freeze(m.materials.map(mat => Object.freeze({ ...mat }))),
    }))),
    traversal: Object.freeze({ ...input.traversal }),
  })
}
function referencesOf(input: ActorEvaluationInput): ReferenceManifest {
  return Object.freeze({
    actor: input.actor, root: input.root.node,
    ancestors: Object.freeze(input.ancestors.map(a => a.node)),
    meshes: Object.freeze(input.meshes.map(m => m.mesh)),
    geometries: Object.freeze(input.meshes.map(m => m.geometry)),
    skeletons: Object.freeze(input.meshes.map(m => m.skeleton?.skeleton ?? null)),
    bones: Object.freeze(input.meshes.map(m => Object.freeze(m.skeleton?.bones.map(b => b.bone) ?? []))),
    materials: Object.freeze(input.meshes.map(m => Object.freeze(m.materials.map(mat => mat.material)))),
    ownerLeases: Object.freeze(input.meshes.map(m => Object.freeze(m.materials.map(mat => mat.ownerLease)))),
  })
}
function validInput(input: ActorEvaluationInput): boolean {
  if (!input || !input.turn || !input.turn.token || !Number.isSafeInteger(input.turn.frameSequence) || input.turn.frameSequence < 0) return false
  if (!input.actor || !Number.isSafeInteger(input.actorGeneration) || input.actorGeneration < 0) return false
  if (input.rendererPath !== 'skinned' && input.rendererPath !== 'procedural-fallback') return false
  if (typeof input.appearanceFingerprint !== 'string' || input.appearanceFingerprint.length < 16) return false
  const p = input.phase
  if (!p || !p.hostPhase || !['idle', 'walk', 'jog', 'sit', 'entry', 'exit', 'other'].includes(p.pose) || typeof p.easing !== 'boolean'
    || !(p.clip === null || typeof p.clip === 'string' && p.clip.length > 0)
    || !(p.clipTimeSeconds === null || finite(p.clipTimeSeconds) && p.clipTimeSeconds >= 0)
    || !(p.gaitPhaseRadians === null || finite(p.gaitPhaseRadians))
    || !(p.transitionProgress === null || finite(p.transitionProgress) && p.transitionProgress >= 0 && p.transitionProgress <= 1)) return false
  if (!input.root.node || !validMatrix(input.root.matrixLocal) || !validMatrix(input.root.matrixWorld) || !Array.isArray(input.ancestors) || !Array.isArray(input.meshes)) return false
  if (input.ancestors.length > EVALUATION_LIMITS.depth || input.ancestors.some(a => !a.node || !validMatrix(a.matrixLocal) || !validMatrix(a.matrixWorld))) return false
  if (input.root.parent !== (input.ancestors[0]?.node ?? null)) return false
  for (let i = 0; i < input.ancestors.length; i++) if (input.ancestors[i]!.parent !== (input.ancestors[i + 1]?.node ?? null)) return false
  const placementChain = [input.root, ...input.ancestors]
  for (let i = 0; i < placementChain.length; i++) {
    const node = placementChain[i]!, parent = placementChain[i + 1]
    if (!matricesNear(parent ? multiplyMatrices(parent.matrixWorld, node.matrixLocal) : node.matrixLocal, node.matrixWorld)) return false
  }
  if (input.meshes.length > EVALUATION_LIMITS.meshes) return false
  for (const m of input.meshes) {
    if (!m.mesh || !m.geometry || !Number.isSafeInteger(m.geometryGeneration) || m.geometryGeneration < 0
      || !Number.isSafeInteger(m.drawStart) || m.drawStart < 0 || !Number.isSafeInteger(m.drawCount) || m.drawCount < 0
      || !Number.isSafeInteger(m.indexCount) || m.indexCount < 0 || !Number.isSafeInteger(m.vertexCount) || m.vertexCount < 0
      || !Number.isSafeInteger(m.triangles) || m.triangles < 0 || !Array.isArray(m.materials) || m.materials.length === 0) return false
    if (m.drawStart + m.drawCount > m.indexCount || m.drawStart % 3 !== 0 || m.drawCount % 3 !== 0 || m.triangles * 3 !== m.drawCount) return false
    if (m.skeleton && (!m.skeleton.skeleton || !Number.isSafeInteger(m.skeleton.generation) || m.skeleton.generation < 0
      || m.skeleton.bones.length === 0 || m.skeleton.bones.length > EVALUATION_LIMITS.bonesPerMesh
      || !validMatrix(m.skeleton.bindMatrix) || !validMatrix(m.skeleton.bindMatrixInverse)
      || m.skeleton.bones.some(b => !b.bone || !validMatrix(b.matrixWorld)))) return false
    for (const mat of m.materials) {
      if (!mat.materialType || !mat.programKey || !validSha(mat.shaderSourceSha256) || !supportedMaterial(mat) || !mat.ownerLease
        || !Number.isSafeInteger(mat.ownerGeneration) || mat.ownerGeneration < 0) return false
    }
  }
  const t = input.traversal
  return !!t && Number.isSafeInteger(t.nodes) && t.nodes >= 1 && Number.isSafeInteger(t.meshes) && t.meshes >= 0
    && Number.isSafeInteger(t.triangles) && t.triangles >= 0 && Number.isSafeInteger(t.maxDepth) && t.maxDepth >= 0
    && finite(t.elapsedMs) && t.elapsedMs >= 0 && t.deadlineExceeded === false && t.aborted === false && t.meshes === input.meshes.length
    && t.triangles === input.meshes.reduce((sum, m) => sum + m.triangles, 0)
    && t.nodes <= EVALUATION_LIMITS.nodes && t.meshes <= EVALUATION_LIMITS.meshes
    && t.triangles <= EVALUATION_LIMITS.triangles && t.maxDepth <= EVALUATION_LIMITS.depth
    && t.elapsedMs <= EVALUATION_LIMITS.elapsedMs
}

export interface TraversalBudget {
  /** Pass a triangle count (including zero) for mesh nodes; omit it for non-mesh nodes. */
  readonly visitNode: (depth: number, meshTriangles?: number) => boolean
  readonly finish: () => Readonly<{ nodes: number; meshes: number; triangles: number; maxDepth: number; elapsedMs: number; deadlineExceeded: boolean; aborted: boolean }>
}
/** Cooperative synchronous traversal guard. Call before processing every node/mesh. */
export function beginTraversalBudget(now: () => number, maxElapsedMs = EVALUATION_LIMITS.elapsedMs): TraversalBudget | null {
  if (!finite(maxElapsedMs) || maxElapsedMs <= 0 || maxElapsedMs > EVALUATION_LIMITS.elapsedMs) return null
  const start = now()
  if (!finite(start)) return null
  let nodes = 0, meshes = 0, triangles = 0, maxDepth = 0, deadlineExceeded = false, aborted = false, last = start
  const visitNode = (depth: number, meshTriangles?: number): boolean => {
    const current = now()
    if (!finite(current) || current < last || current - start > maxElapsedMs) deadlineExceeded = true
    if (finite(current)) last = current
    const isMesh = meshTriangles !== undefined
    const triangleCount = meshTriangles ?? 0
    if (deadlineExceeded || !Number.isSafeInteger(depth) || depth < 0 || depth > EVALUATION_LIMITS.depth
      || !Number.isSafeInteger(triangleCount) || triangleCount < 0) { aborted = true; return false }
    if (nodes + 1 > EVALUATION_LIMITS.nodes || (isMesh && meshes + 1 > EVALUATION_LIMITS.meshes)
      || triangles + triangleCount > EVALUATION_LIMITS.triangles) { aborted = true; return false }
    nodes++
    if (isMesh) { meshes++; triangles += triangleCount }
    maxDepth = Math.max(maxDepth, depth)
    return true
  }
  const finish = () => {
    const end = now(), elapsedMs = finite(end) ? Math.max(0, end - start) : Number.POSITIVE_INFINITY
    if (!finite(end) || end < last) deadlineExceeded = true
    if (finite(end)) last = end
    if (elapsedMs > maxElapsedMs) deadlineExceeded = true
    return Object.freeze({ nodes, meshes, triangles, maxDepth, elapsedMs, deadlineExceeded, aborted })
  }
  return Object.freeze({ visitNode, finish })
}

/** Snapshot after pose/look/parent transforms have been evaluated in one host turn. */
export function captureActorEvaluation(input: ActorEvaluationInput): Readonly<{ token: object }> | null {
  if (!validInput(input)) return null
  const frozen = cloneInput(input)
  const token = Object.freeze({})
  issued.set(token, { captured: frozen, references: referencesOf(input) })
  // Expire before any promise continuation or queued microtask can consume this evaluated pose.
  queueMicrotask(() => issued.delete(token))
  return token
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
}
function samePhase(a: PhaseState, b: PhaseState): boolean {
  return a.hostPhase === b.hostPhase && a.pose === b.pose && a.easing === b.easing && a.clip === b.clip
    && Object.is(a.clipTimeSeconds, b.clipTimeSeconds) && Object.is(a.gaitPhaseRadians, b.gaitPhaseRadians)
    && Object.is(a.transitionProgress, b.transitionProgress)
}
function sameSkeleton(a: SkeletonState | null, b: SkeletonState | null, refs: ReferenceManifest, index: number): boolean {
  if (a === null || b === null) return a === b
  if (a.skeleton !== refs.skeletons[index] || b.skeleton !== refs.skeletons[index] || a.generation !== b.generation
    || !sameNumbers(a.bindMatrix, b.bindMatrix) || !sameNumbers(a.bindMatrixInverse, b.bindMatrixInverse)
    || a.bones.length !== b.bones.length || a.bones.length !== refs.bones[index]?.length) return false
  return a.bones.every((bone, i) => bone.bone === refs.bones[index]?.[i] && b.bones[i]?.bone === refs.bones[index]?.[i]
    && sameNumbers(a.bones[i]!.matrixWorld, b.bones[i]!.matrixWorld))
}

/** Revalidate immediately before evidence is consumed; callers must not await between capture and use. */
export function validateActorEvaluation(token: object, current: ActorEvaluationInput): EvaluationCheck {
  const record = issued.get(token)
  if (!record || !validInput(current)) return Object.freeze({ state: 'refused', code: 'invalid-snapshot', canBoard: false, routeAuthorized: false })
  const { captured: old, references: refs } = record
  if (current.turn.token !== old.turn.token) return Object.freeze({ state: 'refused', code: 'different-host-turn', canBoard: false, routeAuthorized: false })
  if (current.turn.frameSequence !== old.turn.frameSequence) return Object.freeze({ state: 'refused', code: 'stale-frame-sequence', canBoard: false, routeAuthorized: false })
  if (current.actor !== refs.actor || current.actorGeneration !== old.actorGeneration) return Object.freeze({ state: 'refused', code: 'actor-generation-changed', canBoard: false, routeAuthorized: false })
  if (current.rendererPath !== old.rendererPath || current.appearanceFingerprint !== old.appearanceFingerprint) return Object.freeze({ state: 'refused', code: 'actor-or-look-changed', canBoard: false, routeAuthorized: false })
  if (!samePhase(current.phase, old.phase)) return Object.freeze({ state: 'refused', code: 'phase-changed', canBoard: false, routeAuthorized: false })
  if (current.root.node !== refs.root || current.ancestors.length !== refs.ancestors.length
    || current.root.parent !== old.root.parent
    || current.ancestors.some((a, i) => a.node !== refs.ancestors[i] || a.parent !== old.ancestors[i]!.parent)) return Object.freeze({ state: 'refused', code: 'ancestor-chain-changed', canBoard: false, routeAuthorized: false })
  if (!sameNumbers(current.root.matrixLocal, old.root.matrixLocal) || !sameNumbers(current.root.matrixWorld, old.root.matrixWorld)
    || current.ancestors.some((a, i) => !sameNumbers(a.matrixLocal, old.ancestors[i]!.matrixLocal) || !sameNumbers(a.matrixWorld, old.ancestors[i]!.matrixWorld))) return Object.freeze({ state: 'refused', code: 'placement-matrix-changed', canBoard: false, routeAuthorized: false })
  if (current.meshes.length !== old.meshes.length) return Object.freeze({ state: 'refused', code: 'geometry-or-draw-range-changed', canBoard: false, routeAuthorized: false })
  let triangles = 0
  for (let i = 0; i < current.meshes.length; i++) {
    const a = current.meshes[i]!, b = old.meshes[i]!
    if (a.mesh !== refs.meshes[i] || a.geometry !== refs.geometries[i] || a.geometryGeneration !== b.geometryGeneration
      || a.drawStart !== b.drawStart || a.drawCount !== b.drawCount || a.indexCount !== b.indexCount || a.vertexCount !== b.vertexCount || a.triangles !== b.triangles) {
      return Object.freeze({ state: 'refused', code: 'geometry-or-draw-range-changed', canBoard: false, routeAuthorized: false })
    }
    if (!sameSkeleton(a.skeleton, b.skeleton, refs, i)) return Object.freeze({ state: 'refused', code: 'skeleton-or-bind-changed', canBoard: false, routeAuthorized: false })
    if (a.materials.length !== b.materials.length) return Object.freeze({ state: 'refused', code: 'material-program-changed', canBoard: false, routeAuthorized: false })
    for (let j = 0; j < a.materials.length; j++) {
      const am = a.materials[j]!, bm = b.materials[j]!
      if (am.material !== refs.materials[i]?.[j] || am.material !== bm.material || am.materialType !== bm.materialType
        || am.shaderPath !== bm.shaderPath || am.programKey !== bm.programKey || am.shaderSourceSha256 !== bm.shaderSourceSha256
        || am.onBeforeCompile !== bm.onBeforeCompile || am.stockOnBeforeCompile !== bm.stockOnBeforeCompile) return Object.freeze({ state: 'refused', code: 'material-program-changed', canBoard: false, routeAuthorized: false })
      if (am.ownerLease !== refs.ownerLeases[i]?.[j] || am.ownerLease !== bm.ownerLease || am.ownerGeneration !== bm.ownerGeneration) return Object.freeze({ state: 'refused', code: 'cache-owner-changed', canBoard: false, routeAuthorized: false })
    }
    triangles += a.triangles
  }
  return Object.freeze({ state: 'current', canBoard: false, routeAuthorized: false, sampledTriangles: triangles })
}

export type IntervalBlocker =
  | 'finite-snapshots-only' | 'unregistered-bound-provider' | 'unsupported-shader-position-path'
  | 'unbounded-root-trajectory' | 'unbounded-skinning' | 'unbounded-morph-or-appearance'
  | 'unbounded-wardrobe-position' | 'unresolved-entry-seat-exit-clip' | 'incomplete-time-domain'
export interface IntervalClaimRequest {
  readonly interval: readonly [startSeconds: number, endSeconds: number]
  readonly phases: readonly PoseKind[]
  readonly evidenceKind: 'finite-samples' | 'conservative-interval-certificate'
  readonly providerId: string | null
  readonly providerSha256: string | null
  readonly covered: Readonly<Record<'rootTrajectory' | 'skinning' | 'morphAppearance' | 'wardrobePosition' | 'shaderPath' | 'entrySeatExitClips', boolean>>
}
export interface IntervalContractResult {
  readonly state: 'unknown'
  readonly blockers: readonly IntervalBlocker[]
  readonly canBoard: false
  readonly routeAuthorized: false
  readonly coverage: 'discrete-snapshots-only' | 'unproven-continuous-interval'
}
/** No reviewed continuous-volume provider is registered in this diagnostic. Thus no input can authorize. */
export function assessIntervalClaim(request: IntervalClaimRequest): IntervalContractResult {
  const blockers: IntervalBlocker[] = []
  const value = request && typeof request === 'object' ? request : null
  const covered = value?.covered && typeof value.covered === 'object' ? value.covered : null
  if (!value || !Array.isArray(value.interval) || value.interval.length !== 2 || !value.interval.every(finite) || value.interval[0] < 0 || value.interval[1] <= value.interval[0]) blockers.push('incomplete-time-domain')
  if (!value || !Array.isArray(value.phases) || !value.phases.length || value.phases.some(p => !['idle', 'walk', 'jog', 'sit', 'entry', 'exit', 'other'].includes(p))) blockers.push('unresolved-entry-seat-exit-clip')
  if (value?.evidenceKind === 'finite-samples') blockers.push('finite-snapshots-only')
  else blockers.push('unregistered-bound-provider')
  if (!covered?.shaderPath) blockers.push('unsupported-shader-position-path')
  if (!covered?.rootTrajectory) blockers.push('unbounded-root-trajectory')
  if (!covered?.skinning) blockers.push('unbounded-skinning')
  if (!covered?.morphAppearance) blockers.push('unbounded-morph-or-appearance')
  if (!covered?.wardrobePosition) blockers.push('unbounded-wardrobe-position')
  if (!covered?.entrySeatExitClips) blockers.push('unresolved-entry-seat-exit-clip')
  return Object.freeze({ state: 'unknown', blockers: Object.freeze([...new Set(blockers)]), canBoard: false, routeAuthorized: false,
    coverage: value?.evidenceKind === 'finite-samples' ? 'discrete-snapshots-only' : 'unproven-continuous-interval' })
}
