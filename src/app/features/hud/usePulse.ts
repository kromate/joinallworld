// The numbers behind the online pill: who is online and how many visits there have been. One poll of
// GET /api/world/pulse every 30 s while the page is visible, none while it is hidden, and one at once
// when the page comes back after more than that. No number is shown until the first answer arrives.
import { reactive } from 'vue'
import { POLL_MS } from './onlinePillModel.ts'
import type { PulseNumbers } from './onlinePillModel.ts'

export interface PulseState {
  /** The last answer, or null until the first one. */
  numbers: PulseNumbers | null
  /** Client time of the last answer. */
  at: number | null
  /** The last request failed. */
  failing: boolean
}
export interface PulseDeps {
  fetchJson: (path: string) => Promise<unknown>
  now: () => number
  visible: () => boolean
  setTimer: (run: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0)
/** The documented answer, or null for anything else. */
export function readPulse(value: unknown): PulseNumbers | null {
  if (typeof value !== 'object' || value === null) return null
  const { online, visits, cities } = value as Record<string, unknown>
  if (typeof online !== 'number' || typeof visits !== 'number') return null
  const byCity: Record<string, number> = {}
  if (typeof cities === 'object' && cities !== null) for (const [id, n] of Object.entries(cities)) byCity[id] = count(n)
  return { online: count(online), visits: count(visits), cities: byCity }
}

export function createPulse(deps: PulseDeps) {
  const state = reactive<PulseState>({ numbers: null, at: null, failing: false })
  let timer: unknown = null
  let running = false
  let inFlight = false

  async function poll(): Promise<void> {
    if (inFlight) return
    inFlight = true
    try {
      const numbers = readPulse(await deps.fetchJson('/api/world/pulse'))
      if (numbers) { state.numbers = numbers; state.at = deps.now(); state.failing = false } else state.failing = true
    } catch { state.failing = true } finally { inFlight = false }
  }
  function schedule(): void {
    if (timer !== null) deps.clearTimer(timer)
    timer = null
    if (!running || !deps.visible()) return
    timer = deps.setTimer(() => { timer = null; void tick() }, POLL_MS)
  }
  async function tick(): Promise<void> {
    if (running && deps.visible()) await poll()
    schedule()
  }
  return {
    state,
    /** Begin: ask now, then every 30 s while visible. Safe to call again. */
    start(): void { if (running) return; running = true; void tick() },
    stop(): void { running = false; if (timer !== null) deps.clearTimer(timer); timer = null },
    /** The page was shown or hidden: pause while hidden; on return ask at once if the last answer is old. */
    visibility(): void {
      if (!running) return
      if (!deps.visible()) { if (timer !== null) deps.clearTimer(timer); timer = null; return }
      if (state.at === null || deps.now() - state.at >= POLL_MS) void tick(); else schedule()
    },
    /** The numbers are not trusted any more (the session ended). */
    reset(): void { state.numbers = null; state.at = null; state.failing = false },
  }
}
export type Pulse = ReturnType<typeof createPulse>

let shared: Pulse | null = null
/** The one pulse of this page, wired to the real clock and the page's visibility. */
export function usePulse(fetchJson: (path: string) => Promise<unknown>): Pulse {
  shared ??= createPulse({
    fetchJson,
    now: () => Date.now(),
    visible: () => globalThis.document?.visibilityState !== 'hidden',
    setTimer: (run, ms) => globalThis.setTimeout(run, ms),
    clearTimer: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  })
  return shared
}
