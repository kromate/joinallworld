// The online pill, as pure functions: how a count is shortened, what the pill says to a screen
// reader, what the tooltip says, which colour the dot is, and the few steps a number takes when
// it changes. Nothing here touches the page.

/** A poll that has not succeeded for this long, or has failed, makes the numbers stale. */
export const STALE_MS = 75000
/** How often the numbers are asked for while the page is visible. */
export const POLL_MS = 30000

export type PulseTone = 'live' | 'stale'

/** What GET /api/world/pulse answers (server/pulse.ts). */
export interface PulseNumbers { online: number; visits: number; cities: Record<string, number> }

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

/** The label read aloud: "128 people online. 4,210 visits in total." */
export function pulseAria(numbers: PulseNumbers, tone: PulseTone = 'live'): string {
  const text = `${exactCount(numbers.online)} ${noun(numbers.online, 'person', 'people')} online. ${exactCount(numbers.visits)} ${noun(numbers.visits, 'visit', 'visits')} in total.`
  return `${text}${tone === 'stale' ? ' These numbers may be out of date.' : ''} Open People.`
}

/** The tooltip: the exact values. */
export function pulseTitle(numbers: PulseNumbers, tone: PulseTone = 'live'): string {
  return `${exactCount(numbers.online)} online now · ${exactCount(numbers.visits)} visits in total${tone === 'stale' ? ' (not up to date)' : ''}`
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
