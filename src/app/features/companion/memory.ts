// What the companion remembers, kept on this device only (localStorage; nothing is sent to the server).
//   allworld-companion-prefs   per device: mode (lively | quiet | off) and where the button was dragged to
//   allworld-companion         per player (the session's public id): what it already explained, tours done or skipped, moments it
//                              celebrated, how often a nudge was ignored, the conversation log (last 40 lines), the day of the last daily list
// Pure: the storage is passed in, so it runs under node --test.
import type { CompanionAction, TourId } from './types.ts'

export const PREFS_KEY = 'allworld-companion-prefs'
export const MEMORY_KEY = 'allworld-companion'
export type CompanionMode = 'lively' | 'quiet' | 'off'
export interface Prefs { mode: CompanionMode; x?: number; y?: number }
export interface LogLine { id: string; from: 'lumo' | 'you'; text: string; at: number; actions?: CompanionAction[]; read?: boolean }
export interface NudgeMemory { lastAt: number; ignored: number; shownToday: number; day: string; seen: Record<string, number> }
export interface PlayerMemory {
  explained: string[]
  tours: Partial<Record<TourId, 'done' | 'skipped' | 'started'>>
  resume: Partial<Record<TourId, string>>
  milestones: string[]
  cities: string[]
  nudge: NudgeMemory
  log: LogLine[]
  dailyDay: string
  introDone: boolean
  asked: number
}
type Store = Pick<Storage, 'getItem' | 'setItem'> | null | undefined
const LOG_KEPT = 40
const WHO_KEPT = 8

const fresh = (): PlayerMemory => ({ explained: [], tours: {}, resume: {}, milestones: [], cities: [], nudge: { lastAt: 0, ignored: 0, shownToday: 0, day: '', seen: {} }, log: [], dailyDay: '', introDone: false, asked: 0 })
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])

export function readPrefs(storage: Store): Prefs {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(PREFS_KEY) ?? 'null')
    if (!isRecord(raw)) return { mode: 'lively' }
    const mode = raw.mode === 'quiet' || raw.mode === 'off' ? raw.mode : 'lively'
    return { mode, ...(typeof raw.x === 'number' && typeof raw.y === 'number' ? { x: raw.x, y: raw.y } : {}) }
  } catch { return { mode: 'lively' } }
}
export function writePrefs(storage: Store, prefs: Prefs): void { try { storage?.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* kept for this visit only */ } }

function parse(value: unknown): PlayerMemory {
  const base = fresh()
  if (!isRecord(value)) return base
  const nudge = isRecord(value.nudge) ? value.nudge : {}
  const log = Array.isArray(value.log) ? value.log.filter((line): line is LogLine => isRecord(line) && typeof line.text === 'string' && (line.from === 'lumo' || line.from === 'you') && typeof line.at === 'number' && typeof line.id === 'string') : []
  return {
    explained: strings(value.explained), milestones: strings(value.milestones), cities: strings(value.cities),
    tours: isRecord(value.tours) ? value.tours as PlayerMemory['tours'] : {}, resume: isRecord(value.resume) ? value.resume as PlayerMemory['resume'] : {},
    nudge: { lastAt: Number(nudge.lastAt) || 0, ignored: Number(nudge.ignored) || 0, shownToday: Number(nudge.shownToday) || 0, day: typeof nudge.day === 'string' ? nudge.day : '', seen: isRecord(nudge.seen) ? nudge.seen as Record<string, number> : {} },
    log: log.slice(-LOG_KEPT), dailyDay: typeof value.dailyDay === 'string' ? value.dailyDay : '', introDone: value.introDone === true, asked: Number(value.asked) || 0,
  }
}

/** The memory of one player on this device. */
export function createMemory(storage: Store, who: string) {
  const all = (): Record<string, unknown> => { try { const raw: unknown = JSON.parse(storage?.getItem(MEMORY_KEY) ?? 'null'); return isRecord(raw) ? raw : {} } catch { return {} } }
  let data = parse(all()[who])
  const save = (): void => {
    try {
      const keep = all()
      keep[who] = data
      const ids = Object.keys(keep)
      while (ids.length > WHO_KEPT) delete keep[ids.shift() as string]
      storage?.setItem(MEMORY_KEY, JSON.stringify(keep))
    } catch { /* kept for this visit only */ }
  }
  return {
    get data(): PlayerMemory { return data },
    reload(): void { data = parse(all()[who]) },
    explained(topic: string): void { if (!data.explained.includes(topic)) { data.explained = [...data.explained, topic].slice(-40); save() } },
    asked(): void { data.asked += 1; save() },
    milestone: (id: string): boolean => data.milestones.includes(id),
    markMilestone(id: string): void { if (!data.milestones.includes(id)) { data.milestones = [...data.milestones, id]; save() } },
    visitCity(id: string): boolean { if (data.cities.includes(id)) return false; data.cities = [...data.cities, id]; save(); return true },
    tour(id: TourId, status: 'done' | 'skipped' | 'started'): void { data.tours = { ...data.tours, [id]: status }; if (status !== 'started') { const { [id]: _gone, ...rest } = data.resume; data.resume = rest }; save() },
    resume(id: TourId, step: string): void { data.resume = { ...data.resume, [id]: step }; save() },
    append(line: LogLine): void { data.log = [...data.log, line].slice(-LOG_KEPT); save() },
    markRead(): void { if (data.log.some((line) => line.from === 'lumo' && line.read === false)) { data.log = data.log.map((line) => ({ ...line, read: true })); save() } },
    unread: (): number => data.log.filter((line) => line.from === 'lumo' && line.read === false).length,
    set(patch: Partial<PlayerMemory>): void { data = { ...data, ...patch }; save() },
    setNudge(patch: Partial<NudgeMemory>): void { data.nudge = { ...data.nudge, ...patch }; save() },
    clear(): void { data = fresh(); save() },
  }
}
export type Memory = ReturnType<typeof createMemory>
