// The online pill, as pure functions: how a count is shortened, what the pill says to a screen
// reader, what the tooltip says, which colour the dot is, and the few steps a number takes when
// it changes. Nothing here touches the page.

/** A poll that has not succeeded for this long, or has failed, makes the numbers stale. */
export const STALE_MS = 75000
/** How often the numbers are asked for while the page is visible. */
export const POLL_MS = 30000

export type PulseTone = 'live' | 'stale'

/** What GET /api/world/pulse answers (server/pulse.ts). */
export interface PulseNumbers { online: number; visits: number; /** Distinct players seen today (0 from a server that does not say). */ today?: number; cities: Record<string, number> }

const whole = (value: number): number => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0)
const trim = (value: number): string => String(value).replace(/\.0$/, '')

/**
 * 999 → "999", 1234 → "1.2k", 4200 → "4.2k", 12500 → "12k", 1250000 → "1.2M". Rounded down, never up, so the
 * shortened number never says more than the real one.
 */
export function compactCount(value: number): string {
  const n = whole(value)
  if (n < 1000) return String(n)
  if (n < 10000) return `${trim(Math.floor(n / 100) / 10)}k`
  if (n < 1000000) return `${Math.floor(n / 1000)}k`
  if (n < 10000000) return `${trim(Math.floor(n / 100000) / 10)}M`
  return `${Math.floor(n / 1000000)}M`
}

/** The exact value with thousands separators: 4210 → "4,210". */
export const exactCount = (value: number): string => whole(value).toLocaleString('en-US')

const noun = (n: number, one: string, many: string): string => (whole(n) === 1 ? one : many)

/** Players online in one city, or null when the answer does not carry that city (then only the world count is known). */
export function onlineIn(numbers: PulseNumbers, cityId: string | null | undefined): number | null {
  if (!cityId) return null
  const here = numbers.cities[cityId]
  return typeof here === 'number' ? whole(here) : null
}

/**
 * What the pill is built from. The reader is online themselves, so nothing here is ever 0: the world is at least 1, the city is
 * at least 1 and never more than the world. `today` is never below the world count (they have all played today).
 */
export interface OnlineView { world: number; here: number | null; today: number; alone: boolean }
export function onlineView(numbers: PulseNumbers, cityId: string | null | undefined): OnlineView {
  const world = Math.max(1, whole(numbers.online))
  const city = onlineIn(numbers, cityId)
  return { world, here: city === null ? null : Math.min(world, Math.max(1, city)), today: Math.max(world, whole(numbers.today ?? 0)), alone: world === 1 }
}

/** What stands in the pill instead of a bare "1" when the reader is the only one online: a true line, and the way to change it. */
export function aloneLine(view: Pick<OnlineView, 'today'>): { long: string; short: string } {
  return view.today >= 2 ? { long: `${compactCount(view.today)} played today`, short: `${compactCount(view.today)} today` } : { long: "You're first here", short: 'First here' }
}

/** The label read aloud: "128 people online in Allworld, 12 here. 4,210 visits in total." The reader alone hears a warmer, true line. */
export function pulseAria(numbers: PulseNumbers, tone: PulseTone = 'live', cityId?: string | null): string {
  const view = onlineView(numbers, cityId), visits = `${exactCount(numbers.visits)} ${noun(numbers.visits, 'visit', 'visits')} in total`
  const state = tone === 'stale' ? ' These numbers may be out of date.' : ''
  if (view.alone) return `You are the only one online right now. ${exactCount(view.today)} ${noun(view.today, 'player', 'players')} today. ${visits}.${state} Invite a friend.`
  return `${exactCount(view.world)} people online in Allworld${view.here === null ? '' : `, ${exactCount(view.here)} here`}. ${visits}.${state} Open People.`
}

/** The tooltip: the exact values. Visits are always for the whole game, and it says so. */
export function pulseTitle(numbers: PulseNumbers, tone: PulseTone = 'live', cityId?: string | null): string {
  const view = onlineView(numbers, cityId)
  const stale = tone === 'stale' ? ' (not up to date)' : ''
  const visits = `${exactCount(numbers.visits)} visits in total across all of Allworld`
  if (view.alone) return `You are the only one online right now · ${exactCount(view.today)} ${noun(view.today, 'player', 'players')} today · ${visits}${stale}`
  return `${exactCount(view.world)} in Allworld${view.here === null ? '' : ` · ${exactCount(view.here)} here`} · ${visits}${stale}`
}

/** Green while the last answer is recent; amber when the last request failed or nothing has come for a while. */
export function pulseTone(input: { failing: boolean; at: number | null; now: number }): PulseTone {
  if (input.failing || input.at === null) return 'stale'
  return input.now - input.at > STALE_MS ? 'stale' : 'live'
}

/**
 * The values a number passes through on its way from one to the other: at most `steps`, ending on the target,
 * the first already moved. Nothing to animate (the same number, or a first value, or `steps` of 0) gives just the target.
 */
export function easeSteps(from: number | null, to: number, steps = 6): number[] {
  const target = whole(to)
  if (from === null || steps < 1 || whole(from) === target) return [target]
  const start = whole(from), out: number[] = []
  for (let i = 1; i <= steps; i += 1) {
    const t = 1 - (1 - i / steps) ** 3
    out.push(i === steps ? target : Math.round(start + (target - start) * t))
  }
  return out.filter((value, i) => value !== start && (i === 0 || value !== out[i - 1]))
}
