/**
 * OWNER: living-world (pure fixture). A deterministic, server-steppable driving lesson.
 * Position uses metres in an x/z plane; +z is forward and heading is radians from +z.
 * Persisted state is server-owned. A network adapter must send controls only and call this
 * module on the server; readDrivingState is for loading a saved server record, never client proof.
 */

export interface DrivingInput {
  throttle: number
  brake: number
  steer: number
}

export interface DrivingPoint { x: number; z: number }
export interface DrivingCheckpoint {
  id: string
  center: DrivingPoint
  radius: number
  stopRequired: boolean
}
export interface DrivingRoute {
  id: string
  version: string
  /** Open road polylines in metre coordinates. */
  roads: readonly (readonly DrivingPoint[])[]
  checkpoints: readonly DrivingCheckpoint[]
  roadWidth: number
  speedLimit: number
}
export type DrivingStatus = 'running' | 'paused' | 'complete'
export type DrivingAssessment = 'pending' | 'passed' | 'failed'
export type CheckpointEntry = 'blocked' | 'armed' | 'entered'
export interface DrivingState {
  routeId: string
  routeVersion: string
  position: DrivingPoint
  heading: number
  speed: number
  checkpointIndex: number
  /** `blocked` requires exit before entry; `entered` applies only to a stop checkpoint. */
  checkpointEntry: CheckpointEntry
  stopDwellMs: number
  score: number
  status: DrivingStatus
  assessment: DrivingAssessment
  feedback: string
}
export interface DrivingStep { state: DrivingState; feedback: string }

const STEP_SECONDS = 0.1
const MAX_SPEED = 16
const MAX_SCORE = 100
const ROAD_MARGIN = 0.65
const STOP_SPEED = 0.35
const STOP_DWELL_MS = 1_000
const MAX_COORD = 100_000
const MAX_ROADS = 32
const MAX_POINTS = 512
const MAX_CHECKPOINTS = 64
const MAX_ROUTE_WIDTH = 40
const MAX_ROUTE_SPEED = 40
const MAX_SAVED_SPEED = 20
const INPUT_KEYS = ['brake', 'steer', 'throttle']
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
const wrapHeading = (heading: number) => ((heading + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI
const copyState = (state: DrivingState): DrivingState => ({ ...state, position: { ...state.position } })
function validPoint(value: unknown): value is DrivingPoint {
  return record(value) && finite(value.x) && finite(value.z) && Math.abs(value.x) <= MAX_COORD && Math.abs(value.z) <= MAX_COORD
}
function validRoute(route: DrivingRoute): boolean {
  if (!record(route) || typeof route.id !== 'string' || !route.id || route.id.length > 80 || typeof route.version !== 'string' || !route.version || route.version.length > 80) return false
  if (!Array.isArray(route.roads) || route.roads.length < 1 || route.roads.length > MAX_ROADS || !Array.isArray(route.checkpoints) || route.checkpoints.length < 1 || route.checkpoints.length > MAX_CHECKPOINTS) return false
  if (!finite(route.roadWidth) || route.roadWidth < 2 || route.roadWidth > MAX_ROUTE_WIDTH || !finite(route.speedLimit) || route.speedLimit < 1 || route.speedLimit > MAX_ROUTE_SPEED) return false
  let pointCount = 0
  for (const road of route.roads) {
    if (!Array.isArray(road) || road.length < 2) return false
    pointCount += road.length
    if (pointCount > MAX_POINTS || road.some((point) => !validPoint(point))) return false
    if (!road.some((point, i) => i > 0 && Math.hypot(point.x - road[i - 1]!.x, point.z - road[i - 1]!.z) > 0.01)) return false
  }
  const ids = new Set<string>()
  for (const checkpoint of route.checkpoints) {
    if (!record(checkpoint) || typeof checkpoint.id !== 'string' || !checkpoint.id || checkpoint.id.length > 80 || ids.has(checkpoint.id) || !validPoint(checkpoint.center)) return false
    if (!finite(checkpoint.radius) || checkpoint.radius < 1 || checkpoint.radius > 30 || typeof checkpoint.stopRequired !== 'boolean') return false
    if (nearestRoad(checkpoint.center, route).distance > route.roadWidth / 2 + checkpoint.radius) return false
    ids.add(checkpoint.id)
  }
  return true
}
function nearestRoad(point: DrivingPoint, route: DrivingRoute): { point: DrivingPoint; distance: number } {
  let best = { point: { ...route.roads[0]![0]! }, distance: Infinity }
  for (const road of route.roads) for (let i = 1; i < road.length; i++) {
    const a = road[i - 1]!, b = road[i]!, dx = b.x - a.x, dz = b.z - a.z
    const length2 = dx * dx + dz * dz || 1
    const t = clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / length2, 0, 1)
    const candidate = { x: a.x + dx * t, z: a.z + dz * t }
    const distance = Math.hypot(point.x - candidate.x, point.z - candidate.z)
    if (distance < best.distance) best = { point: candidate, distance }
  }
  return best
}
type Interval = [number, number]
function clipLinear(value: number, delta: number, low: number, high: number, interval: Interval): Interval | null {
  if (Math.abs(delta) < 1e-12) return value >= low && value <= high ? interval : null
  const a = (low - value) / delta, b = (high - value) / delta
  const result: Interval = [Math.max(interval[0], Math.min(a, b)), Math.min(interval[1], Math.max(a, b))]
  return result[0] <= result[1] ? result : null
}
function circleInterval(from: DrivingPoint, dx: number, dz: number, center: DrivingPoint, radius: number): Interval | null {
  const ox = from.x - center.x, oz = from.z - center.z, a = dx * dx + dz * dz, c = ox * ox + oz * oz - radius * radius
  if (a < 1e-18) return c <= 0 ? [0, 1] : null
  const b = 2 * (ox * dx + oz * dz), discriminant = b * b - 4 * a * c
  if (discriminant < 0) return null
  const root = Math.sqrt(discriminant)
  const result: Interval = [Math.max(0, (-b - root) / (2 * a)), Math.min(1, (-b + root) / (2 * a))]
  return result[0] <= result[1] ? result : null
}
/** Exact interval coverage of the motion segment by road-segment capsules; no spatial sampling. */
function sweptOnRoad(from: DrivingPoint, to: DrivingPoint, route: DrivingRoute): boolean {
  const dx = to.x - from.x, dz = to.z - from.z, radius = route.roadWidth / 2 + ROAD_MARGIN
  const intervals: Interval[] = []
  for (const road of route.roads) for (let i = 1; i < road.length; i++) {
    const a = road[i - 1]!, b = road[i]!, rx = b.x - a.x, rz = b.z - a.z, length = Math.hypot(rx, rz)
    if (length <= 0.01) continue
    const ux = rx / length, uz = rz / length, nx = -uz, nz = ux
    const ox = from.x - a.x, oz = from.z - a.z
    const along = clipLinear(ox * ux + oz * uz, dx * ux + dz * uz, 0, length, [0, 1])
    const strip = along && clipLinear(ox * nx + oz * nz, dx * nx + dz * nz, -radius, radius, along)
    if (strip) intervals.push(strip)
    const startCap = circleInterval(from, dx, dz, a, radius), endCap = circleInterval(from, dx, dz, b, radius)
    if (startCap) intervals.push(startCap)
    if (endCap) intervals.push(endCap)
  }
  intervals.sort((a, b) => a[0] - b[0] || b[1] - a[1])
  let covered = 0
  for (const interval of intervals) {
    if (interval[0] > covered + 1e-9) return false
    covered = Math.max(covered, interval[1])
    if (covered >= 1 - 1e-9) return true
  }
  return false
}
function segmentDistance(a: DrivingPoint, b: DrivingPoint, center: DrivingPoint): number {
  const dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz || 1
  const t = clamp(((center.x - a.x) * dx + (center.z - a.z) * dz) / length2, 0, 1)
  return Math.hypot(a.x + dx * t - center.x, a.z + dz * t - center.z)
}
function inside(point: DrivingPoint, checkpoint: DrivingCheckpoint): boolean {
  return Math.hypot(point.x - checkpoint.center.x, point.z - checkpoint.center.z) <= checkpoint.radius
}

function entryAt(point: DrivingPoint, route: DrivingRoute, index: number): CheckpointEntry {
  const checkpoint = route.checkpoints[index]
  return checkpoint && inside(point, checkpoint) ? 'blocked' : 'armed'
}
function safePaused(route: DrivingRoute, feedback: string): DrivingState {
  const start = validRoute(route) ? route.roads[0]![0]! : { x: 0, z: 0 }
  const checkpointEntry = validRoute(route) ? entryAt(start, route, 0) : 'blocked'
  return { routeId: validRoute(route) ? route.id : '', routeVersion: validRoute(route) ? route.version : '', position: { ...start }, heading: 0, speed: 0,
    checkpointIndex: 0, checkpointEntry, stopDwellMs: 0, score: MAX_SCORE, status: 'paused', assessment: 'pending', feedback }
}
/** Starts at the first point of the first road with a heading towards its next point. */
export function createDriving(route: DrivingRoute): DrivingState {
  if (!validRoute(route)) return safePaused(route, 'The lesson route is unavailable.')
  const first = route.roads[0]![0]!, next = route.roads[0]![1]!
  return { routeId: route.id, routeVersion: route.version, position: { ...first }, heading: Math.atan2(next.x - first.x, next.z - first.z), speed: 0,
    checkpointIndex: 0, checkpointEntry: entryAt(first, route, 0), stopDwellMs: 0, score: MAX_SCORE, status: 'running', assessment: 'pending', feedback: 'Use throttle, brake and steering to follow the road.' }
}
function validInput(value: unknown): value is DrivingInput {
  if (!record(value)) return false
  const keys = Reflect.ownKeys(value)
  if (keys.length !== 3 || keys.some((key) => typeof key !== 'string' || !INPUT_KEYS.includes(key))) return false
  return finite(value.throttle) && value.throttle >= 0 && value.throttle <= 1
    && finite(value.brake) && value.brake >= 0 && value.brake <= 1
    && finite(value.steer) && value.steer >= -1 && value.steer <= 1
}

/** One fixed 100 ms simulation step. There is deliberately no client duration or position argument. */
export function stepDriving(state: DrivingState, input: unknown, route: DrivingRoute): DrivingStep {
  if (!validRoute(route)) {
    const paused = copyState(state); paused.status = 'paused'; paused.speed = 0; paused.feedback = 'The lesson route is invalid; the vehicle is safely stopped.'
    return { state: paused, feedback: paused.feedback }
  }
  // State comes from the server-owned save pipeline. Sanitize it before any physics step;
  // the network contract must never accept a client-submitted state or position.
  const loaded = readDrivingStateChecked(state, route, false)
  if (loaded.status !== 'running') return { state: loaded, feedback: loaded.feedback }
  if (!validInput(input)) {
    const paused = pauseDriving(loaded, 'Controls were invalid; the vehicle is safely stopped.')
    return { state: paused, feedback: paused.feedback }
  }

  const next = copyState(loaded)
  const oldPosition = next.position
  const acceleration = input.throttle * 3.2 - input.brake * 8 - 0.18
  next.speed = clamp(next.speed + acceleration * STEP_SECONDS, 0, MAX_SPEED)
  const speedFeedback = next.speed > route.speedLimit ? 'Slow down: you exceeded the speed limit.' : ''
  if (speedFeedback && state.speed <= route.speedLimit) next.score = Math.max(0, next.score - 8)

  // Bicycle-style steering: the faster the car moves, the wider a turn becomes.
  const wheelAngle = input.steer * 0.62
  const yawRate = next.speed * Math.tan(wheelAngle) / 2.6
  next.heading = wrapHeading(next.heading + yawRate * STEP_SECONDS)
  const candidate = { x: oldPosition.x + Math.sin(next.heading) * next.speed * STEP_SECONDS, z: oldPosition.z + Math.cos(next.heading) * next.speed * STEP_SECONDS }
  let feedback = speedFeedback || 'Follow the road and reach each checkpoint in order.'
  if (!sweptOnRoad(oldPosition, candidate, route)) {
    // Stop at the last server-known safe point. Snapping to a nearest road could teleport
    // across a gap onto an unrelated/disconnected road polyline.
    next.position = oldPosition; next.speed = 0; next.score = Math.max(0, next.score - 25); next.stopDwellMs = 0
    feedback = 'You left the road. The car has stopped; steer back along the route.'
  } else next.position = candidate

  const checkpoint = route.checkpoints[next.checkpointIndex]
  if (checkpoint) {
    const wasInside = inside(oldPosition, checkpoint), isInside = inside(next.position, checkpoint)
    const swept = segmentDistance(oldPosition, next.position, checkpoint.center) <= checkpoint.radius
    if (next.checkpointEntry === 'blocked') {
      // A spawn or overlapping prior zone cannot satisfy this checkpoint. Exit first, then
      // make a fresh approach on a later fixed frame.
      next.stopDwellMs = 0
      if (!isInside) { next.checkpointEntry = 'armed'; feedback = 'Leave this checkpoint zone, then enter it to record it.' }
    } else if (next.checkpointEntry === 'entered') {
      if (!checkpoint.stopRequired || !isInside) {
        next.checkpointEntry = 'armed'; next.stopDwellMs = 0
      } else if (next.speed <= STOP_SPEED) next.stopDwellMs = Math.min(STOP_DWELL_MS, next.stopDwellMs + 100)
      else next.stopDwellMs = 0
      if (checkpoint.stopRequired && next.stopDwellMs >= STOP_DWELL_MS) {
        next.checkpointIndex++; next.stopDwellMs = 0; next.checkpointEntry = entryAt(next.position, route, next.checkpointIndex)
        feedback = 'Full stop recorded. Continue to the next checkpoint.'
      }
    } else if (!wasInside && swept) {
      if (checkpoint.stopRequired) {
        if (isInside) {
          next.checkpointEntry = 'entered'
          if (next.speed <= STOP_SPEED) next.stopDwellMs = Math.min(STOP_DWELL_MS, next.stopDwellMs + 100)
          else feedback = 'Stop inside this checkpoint before continuing.'
        } else feedback = 'Stop inside this checkpoint before continuing.'
      } else {
        next.checkpointIndex++; next.stopDwellMs = 0; next.checkpointEntry = entryAt(next.position, route, next.checkpointIndex)
        feedback = 'Checkpoint reached. Continue along the road.'
      }
    }
  }

  if (next.checkpointIndex >= route.checkpoints.length) {
    next.status = 'complete'; next.speed = 0; next.stopDwellMs = 0; next.checkpointEntry = 'blocked'; next.assessment = next.score >= 70 ? 'passed' : 'failed'
    feedback = next.assessment === 'passed' ? 'Assessment passed.' : 'Assessment not passed. Practise and try again.'
  }
  next.feedback = feedback
  return { state: next, feedback }
}

/** Pausing always clears speed and dwell so held input or partial stops cannot survive a pause. */
export function pauseDriving(state: DrivingState, feedback = 'Lesson paused; the vehicle is safely stopped.'): DrivingState {
  const paused = copyState(state)
  if (paused.status === 'running') paused.status = 'paused'
  if (paused.checkpointEntry === 'entered') paused.checkpointEntry = 'blocked'
  paused.speed = 0; paused.stopDwellMs = 0; paused.feedback = feedback
  return paused
}

/**
 * Bounded persistence reader for server-owned saves. Invalid or stale data becomes a safe pause.
 * A live save always reloads paused at zero speed with no held controls or partial stop dwell;
 * only a later authenticated server resume action may make it active again.
 */
export function readDrivingState(value: unknown, route: DrivingRoute): DrivingState {
  return readDrivingStateChecked(value, route, true)
}

/** Strict, non-stepping validation of a server-owned record. Invalid data is rejected so
 * its caller can quarantine the original save rather than overwrite it with a new lesson.
 * Live state is preserved; this function is never proof of client-submitted progress.
 */
export function readValidatedDrivingState(value: unknown, route: DrivingRoute): DrivingState | null {
  return validateDrivingState(value, route, false)
}

function readDrivingStateChecked(value: unknown, route: DrivingRoute, pauseOnLoad: boolean): DrivingState {
  return validateDrivingState(value, route, pauseOnLoad) ?? safePaused(route,
    validRoute(route) && record(value) && (value.routeId !== route.id || value.routeVersion !== route.version)
      ? 'The route changed; start a new lesson after review.'
      : 'Saved lesson data was invalid; the vehicle is safely stopped.')
}

function validateDrivingState(value: unknown, route: DrivingRoute, pauseOnLoad: boolean): DrivingState | null {
  if (!validRoute(route) || !record(value)) return null
  if (value.routeId !== route.id || value.routeVersion !== route.version) return null
  const point = value.position
  if (!validPoint(point) || !finite(value.heading) || Math.abs(value.heading) > Math.PI * 1_000 || !finite(value.speed) || value.speed < 0 || value.speed > MAX_SAVED_SPEED
    || !Number.isInteger(value.checkpointIndex) || (value.checkpointIndex as number) < 0 || (value.checkpointIndex as number) > route.checkpoints.length
    || typeof value.checkpointEntry !== 'string' || !['blocked', 'armed', 'entered'].includes(value.checkpointEntry)
    || !finite(value.stopDwellMs) || value.stopDwellMs < 0 || value.stopDwellMs >= STOP_DWELL_MS || !finite(value.score) || value.score < 0 || value.score > MAX_SCORE
    || typeof value.status !== 'string' || !['running', 'paused', 'complete'].includes(value.status)
    || typeof value.assessment !== 'string' || !['pending', 'passed', 'failed'].includes(value.assessment)
    || typeof value.feedback !== 'string' || value.feedback.length > 160) return null
  if (value.status === 'paused' && (value.speed !== 0 || value.stopDwellMs !== 0)) return null
  const position = { x: point.x, z: point.z }
  if (nearestRoad(position, route).distance > route.roadWidth / 2 + ROAD_MARGIN) return null
  const savedStatus = value.status as DrivingStatus
  const checkpointIndex = value.checkpointIndex as number
  const entry = value.checkpointEntry as CheckpointEntry
  const currentCheckpoint = route.checkpoints[checkpointIndex]
  const entryConsistent = savedStatus === 'complete' ? entry === 'blocked'
    : currentCheckpoint && (entry === 'blocked' ? inside(position, currentCheckpoint) : entry === 'armed' ? !inside(position, currentCheckpoint) : currentCheckpoint.stopRequired && inside(position, currentCheckpoint))
  if (!entryConsistent) return null
  const terminal = savedStatus === 'complete' && (value.checkpointIndex as number) === route.checkpoints.length
    && value.speed === 0 && value.stopDwellMs === 0
    && value.assessment === (value.score >= 70 ? 'passed' : 'failed')
  if (savedStatus === 'complete' && !terminal || savedStatus !== 'complete' && ((value.checkpointIndex as number) >= route.checkpoints.length || value.assessment !== 'pending')) {
    return null
  }
  if (savedStatus === 'complete') return { routeId: route.id, routeVersion: route.version, position, heading: wrapHeading(value.heading), speed: 0,
    checkpointIndex, checkpointEntry: 'blocked', stopDwellMs: 0, score: value.score, status: 'complete', assessment: value.assessment as DrivingAssessment, feedback: value.feedback }
  const reloadEntry = pauseOnLoad ? entryAt(position, route, checkpointIndex) : entry
  return { routeId: route.id, routeVersion: route.version, position, heading: wrapHeading(value.heading), speed: pauseOnLoad || savedStatus === 'paused' ? 0 : value.speed,
    checkpointIndex, checkpointEntry: reloadEntry, stopDwellMs: pauseOnLoad || savedStatus === 'paused' ? 0 : value.stopDwellMs, score: value.score,
    status: pauseOnLoad ? 'paused' : savedStatus, assessment: 'pending',
    feedback: pauseOnLoad ? 'Lesson paused after reload; resume through the server before driving.' : value.feedback }
}
