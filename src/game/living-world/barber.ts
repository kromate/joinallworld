/**
 * OWNER: living-world (fixture only). Deterministic active NPC barber practice.
 * The host supplies an authored plan and server-owned saved state; player input contains only
 * bounded tool/cursor controls. This module grants no credential, cash, or appearance change.
 * Identity, trusted time, request sequencing, participant consent/presence, and persistence remain
 * server adapter responsibilities. Client state is never proof of progress.
 */
export type BarberBodyId = 'woman' | 'man'
export type BarberToolId = 'comb' | 'clippers' | 'scissors' | 'brush'
export type BarberRegionId = 'front' | 'left' | 'right' | 'crown' | 'finish'
export interface BarberBounds { minX: number; minY: number; maxX: number; maxY: number }
export interface BarberObjective { id: string; tool: BarberToolId; region: BarberRegionId; target: BarberBounds; coverageRequired: number }
export interface BarberPracticePlan {
  id: string
  version: number
  catalogueVersion: string
  styleId: string
  body: BarberBodyId
  objectives: readonly BarberObjective[]
}
export interface BarberPoint { x: number; y: number }
export type BarberPracticeStatus = 'running' | 'paused' | 'complete'
export interface BarberPracticeState {
  v: 1
  plan: BarberPracticePlan
  objectiveIndex: number
  coverage: number
  cursor: BarberPoint | null
  pointerDown: boolean
  status: BarberPracticeStatus
  feedback: string
}
export interface BarberPracticeInput { tool: BarberToolId; x: number; y: number; pressed: boolean }
export interface BarberPracticeStep { state: BarberPracticeState | null; feedback: string }

const MAX_OBJECTIVES = 8
const MAX_CURSOR_STEP = 0.18
const TOOLS: readonly BarberToolId[] = ['comb', 'clippers', 'scissors', 'brush']
const REGIONS: readonly BarberRegionId[] = ['front', 'left', 'right', 'crown', 'finish']
const INPUT_KEYS = ['pressed', 'tool', 'x', 'y']
const PLAN_KEYS = ['body', 'catalogueVersion', 'id', 'objectives', 'styleId', 'version']
const OBJECTIVE_KEYS = ['coverageRequired', 'id', 'region', 'target', 'tool']
const STATE_KEYS = ['coverage', 'cursor', 'feedback', 'objectiveIndex', 'plan', 'pointerDown', 'status', 'v']
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const opaque = (value: unknown, max = 80): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(value) && value.length <= max
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Reflect.ownKeys(value)
  return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key))
}
const unit = (value: unknown): value is number => finite(value) && value >= 0 && value <= 1

function parseBounds(value: unknown): BarberBounds | null {
  if (!record(value) || !exactKeys(value, ['maxX', 'maxY', 'minX', 'minY']) || !unit(value.minX) || !unit(value.minY) || !unit(value.maxX) || !unit(value.maxY)) return null
  if (value.maxX - value.minX < 0.02 || value.maxY - value.minY < 0.02) return null
  return { minX: value.minX, minY: value.minY, maxX: value.maxX, maxY: value.maxY }
}
function parsePlan(value: unknown): BarberPracticePlan | null {
  if (!record(value) || !exactKeys(value, PLAN_KEYS) || !opaque(value.id) || !Number.isSafeInteger(value.version) || Number(value.version) < 1
    || !opaque(value.catalogueVersion) || !opaque(value.styleId) || (value.body !== 'woman' && value.body !== 'man')
    || !Array.isArray(value.objectives) || value.objectives.length < 1 || value.objectives.length > MAX_OBJECTIVES) return null
  const objectives: BarberObjective[] = [], ids = new Set<string>()
  for (const item of value.objectives) {
    if (!record(item) || !exactKeys(item, OBJECTIVE_KEYS) || !opaque(item.id) || ids.has(item.id) || !TOOLS.includes(item.tool as BarberToolId) || !REGIONS.includes(item.region as BarberRegionId)) return null
    const target = parseBounds(item.target)
    if (!target || !finite(item.coverageRequired) || item.coverageRequired < 0.02 || item.coverageRequired > 0.5) return null
    ids.add(item.id)
    objectives.push({ id: item.id, tool: item.tool as BarberToolId, region: item.region as BarberRegionId, target, coverageRequired: item.coverageRequired })
  }
  return { id: value.id, version: Number(value.version), catalogueVersion: value.catalogueVersion, styleId: value.styleId, body: value.body, objectives }
}
function samePlan(a: unknown, b: unknown): boolean {
  const left = parsePlan(a), right = parsePlan(b)
  if (!left || !right) return false
  return left.id === right.id && left.version === right.version && left.catalogueVersion === right.catalogueVersion && left.styleId === right.styleId && left.body === right.body
    && left.objectives.length === right.objectives.length && left.objectives.every((item, index) => {
      const other = right.objectives[index]!
      return item.id === other.id && item.tool === other.tool && item.region === other.region && item.coverageRequired === other.coverageRequired
        && item.target.minX === other.target.minX && item.target.minY === other.target.minY && item.target.maxX === other.target.maxX && item.target.maxY === other.target.maxY
    })
}
function idleState(plan: BarberPracticePlan, status: 'paused' | 'complete', feedback: string, objectiveIndex = 0, coverage = 0): BarberPracticeState {
  return { v: 1, plan, objectiveIndex, coverage, cursor: null, pointerDown: false, status, feedback }
}
/** Starts only from a server-authored, closed-schema plan. styleId is opaque and server-owned. */
export function startBarberPractice(planInput: unknown): BarberPracticeState | null {
  const plan = parsePlan(planInput)
  return plan ? idleState(plan, 'running', 'Choose the highlighted tool and make a slow stroke across the target.') : null
}

/** Validate and load saved server state. An interrupted stroke is paused and its held tool cleared. */
export function readBarberPractice(saved: unknown, expectedPlanInput: unknown): BarberPracticeState | null {
  const expectedPlan = parsePlan(expectedPlanInput)
  if (!expectedPlan || !record(saved) || !exactKeys(saved, STATE_KEYS) || saved.v !== 1 || !record(saved.plan)) return null
  const storedPlan = parsePlan(saved.plan)
  if (!storedPlan || !Number.isSafeInteger(saved.objectiveIndex) || Number(saved.objectiveIndex) < 0 || Number(saved.objectiveIndex) > storedPlan.objectives.length
    || !finite(saved.coverage) || saved.coverage < 0 || saved.coverage > 0.5 || typeof saved.pointerDown !== 'boolean'
    || !['running', 'paused', 'complete'].includes(String(saved.status)) || typeof saved.feedback !== 'string' || saved.feedback.length > 160) return null
  const cursor = saved.cursor === null ? null : parsePoint(saved.cursor)
  if (saved.cursor !== null && !cursor) return null
  const complete = saved.status === 'complete'
  if (complete !== (Number(saved.objectiveIndex) === storedPlan.objectives.length) || (Number(saved.objectiveIndex) < storedPlan.objectives.length && saved.coverage >= storedPlan.objectives[Number(saved.objectiveIndex)]!.coverageRequired)) return null
  if (!samePlan(storedPlan, expectedPlan)) return idleState(expectedPlan, 'paused', 'The practice plan changed. Start the current approved plan again.')
  if (complete) return idleState(storedPlan, 'complete', saved.feedback, Number(saved.objectiveIndex), Number(saved.coverage))
  const status = saved.status === 'running' || saved.pointerDown || cursor ? 'paused' : saved.status as 'paused' | 'complete'
  return idleState(storedPlan, status, status === 'paused' && saved.status === 'running' ? 'Practice paused on reload. Resume with the tool lifted.' : saved.feedback, Number(saved.objectiveIndex), Number(saved.coverage))
}

function parsePoint(value: unknown): BarberPoint | null {
  return record(value) && exactKeys(value, ['x', 'y']) && unit(value.x) && unit(value.y) ? { x: value.x, y: value.y } : null
}
function validState(state: unknown, plan: BarberPracticePlan): state is BarberPracticeState {
  if (!record(state) || !exactKeys(state, STATE_KEYS) || state.v !== 1) return false
  const storedPlan = parsePlan(state.plan), index = state.objectiveIndex, coverage = state.coverage
  if (!storedPlan || !samePlan(storedPlan, plan) || typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index > storedPlan.objectives.length
    || !finite(coverage) || coverage < 0 || coverage > 0.5) return false
  if (typeof state.pointerDown !== 'boolean' || !['running', 'paused', 'complete'].includes(String(state.status)) || typeof state.feedback !== 'string' || state.feedback.length > 160) return false
  if (state.cursor !== null && !parsePoint(state.cursor)) return false
  if (state.pointerDown !== (state.cursor !== null)) return false
  if ((state.status === 'complete') !== (index === storedPlan.objectives.length)) return false
  return index === storedPlan.objectives.length || coverage < storedPlan.objectives[index]!.coverageRequired
}

/** Lift the tool while pausing. Partial measured coverage may resume; no cursor or pressure survives. */
export function pauseBarberPractice(state: BarberPracticeState, feedback = 'Practice paused. Lift the tool before continuing.'): BarberPracticeState {
  if (state.status === 'complete') return state
  return { ...state, cursor: null, pointerDown: false, status: 'paused', feedback: feedback.slice(0, 160) }
}

export function resumeBarberPractice(state: unknown, planInput: unknown): BarberPracticeState | null {
  const plan = parsePlan(planInput)
  if (!plan) {
    const historicalPlan = record(state) ? parsePlan(state.plan) : null
    return historicalPlan ? idleState(historicalPlan, 'paused', 'The approved practice plan is unavailable.') : null
  }
  if (!validState(state, plan)) return idleState(plan, 'paused', 'Practice state unavailable; restart the approved plan.')
  if (state.status === 'complete') return state
  return { ...state, cursor: null, pointerDown: false, status: 'running', feedback: 'Practice resumed. Lifted tool; begin a fresh stroke.' }
}

/** One fixed 100 ms control step. No elapsed time, objective index, completion flag, or result is accepted from input. */
export function stepBarberPractice(state: unknown, input: unknown, planInput: unknown): BarberPracticeStep {
  const plan = parsePlan(planInput)
  if (!plan) {
    const historicalPlan = record(state) ? parsePlan(state.plan) : null
    return { state: historicalPlan ? idleState(historicalPlan, 'paused', 'The approved practice plan is unavailable.') : null, feedback: 'The approved practice plan is unavailable.' }
  }
  if (!validState(state, plan)) {
    const paused = idleState(plan, 'paused', 'Practice state changed. Restart the approved plan.')
    return { state: paused, feedback: paused.feedback }
  }
  if (state.status === 'complete') return { state, feedback: state.feedback }
  if (state.status !== 'running') return { state, feedback: state.feedback }
  if (!validInput(input)) {
    const paused = pauseBarberPractice(state, 'Controls were invalid. Practice paused; lift the tool and try again.')
    return { state: paused, feedback: paused.feedback }
  }
  const objective = plan.objectives[state.objectiveIndex]!
  if (input.tool !== objective.tool) {
    const next = { ...state, cursor: null, pointerDown: false, feedback: `Use the ${objective.tool} for the ${objective.region} section.` }
    return { state: next, feedback: next.feedback }
  }
  if (!input.pressed) {
    const next = { ...state, cursor: null, pointerDown: false, feedback: 'Tool lifted. Place it inside the highlighted section to begin a stroke.' }
    return { state: next, feedback: next.feedback }
  }
  const point = { x: input.x, y: input.y }
  if (!state.pointerDown || !state.cursor) {
    const next = { ...state, cursor: point, pointerDown: true, feedback: 'Move slowly across the highlighted section.' }
    return { state: next, feedback: next.feedback }
  }
  const distance = Math.hypot(point.x - state.cursor.x, point.y - state.cursor.y)
  if (distance > MAX_CURSOR_STEP) {
    const next = pauseBarberPractice(state, 'That stroke moved too quickly. Practice paused; resume and make shorter strokes.')
    return { state: next, feedback: next.feedback }
  }
  const coverage = Math.min(objective.coverageRequired, state.coverage + coveredLength(state.cursor, point, objective.target))
  if (coverage >= objective.coverageRequired) {
    const objectiveIndex = state.objectiveIndex + 1
    const complete = objectiveIndex === plan.objectives.length
    const next = idleState(plan, complete ? 'complete' : 'running', complete ? 'Practice complete. Your stylist completed the approved technique.' : `Section complete. Lift the tool, then continue to ${plan.objectives[objectiveIndex]!.region}.`, objectiveIndex)
    return { state: next, feedback: next.feedback }
  }
  const next = { ...state, coverage, cursor: point, pointerDown: true, feedback: coverage > state.coverage ? 'Good stroke. Continue covering the highlighted section.' : `Move the ${objective.tool} through the highlighted ${objective.region} section.` }
  return { state: next, feedback: next.feedback }
}

function validInput(value: unknown): value is BarberPracticeInput {
  return record(value) && exactKeys(value, INPUT_KEYS) && TOOLS.includes(value.tool as BarberToolId) && unit(value.x) && unit(value.y) && typeof value.pressed === 'boolean'
}
/** Length of the cursor segment that lies inside a normalized, server-authored target rectangle. */
function coveredLength(from: BarberPoint, to: BarberPoint, rect: BarberBounds): number {
  const dx = to.x - from.x, dy = to.y - from.y
  let low = 0, high = 1
  for (const [origin, delta, min, max] of [[from.x, dx, rect.minX, rect.maxX], [from.y, dy, rect.minY, rect.maxY]] as const) {
    if (Math.abs(delta) < 1e-12) { if (origin < min || origin > max) return 0; continue }
    const a = (min - origin) / delta, b = (max - origin) / delta
    low = Math.max(low, Math.min(a, b)); high = Math.min(high, Math.max(a, b))
    if (low > high) return 0
  }
  return Math.hypot(dx, dy) * Math.max(0, high - low)
}
