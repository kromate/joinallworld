// What the Health app shows, worked out from view.health. Pure, so it is tested without a browser.
// The rules are the engine's (systems/health.js).
import type { HealthCure } from '../../../types/content.ts'
import type { HealthView } from '../../../types/view.ts'

export type HealthTone = 'is-sick' | 'is-rundown' | 'is-well'

export const toneOf = (health: Pick<HealthView, 'sick' | 'rundown'>): HealthTone => (health.sick ? 'is-sick' : health.rundown ? 'is-rundown' : 'is-well')

/** The sentence under the status: what it is, what it does, and when it passes. */
export function summaryOf(health: Pick<HealthView, 'sick' | 'rundown' | 'immune' | 'immuneMinutes' | 'cause' | 'healsInMinutes'>): string {
  const cause = health.cause === 'rain' ? 'You caught it after being soaked by rain.' : health.cause === 'neglect' ? 'It came from going hungry or unwashed for too long.' : ''
  if (health.sick) return `${cause} It lowers your mood by 35 and makes trekking cost more, but it blocks nothing. It will pass by itself in about ${Math.max(1, Math.round((health.healsInMinutes ?? 0) / 60))}h.`
  if (health.rundown) return 'You are wearing yourself down. Eat and wash before it turns into sickness.'
  return health.immune ? `You are protected from falling sick for about ${health.immuneMinutes} more min.` : 'Nothing is wrong.'
}

/** Whole percent of resistance left. */
export const resistanceOf = (strain: number): number => Math.round((1 - strain) * 100)

/** The glyph id of the status mark. */
export const statusIcon = (health: Pick<HealthView, 'sick' | 'rundown'>): 'sick' | 'rundown' | 'well' => (health.sick ? 'sick' : health.rundown ? 'rundown' : 'well')

export interface ActivityLike { id: string; cost?: number; duration: number }
export interface VenueLike { spots: Record<string, { activities: ActivityLike[] }> }

export interface CureLine {
  id: string
  label: string
  price: string
  /** ' · 20s' — the activity's length, when there is one. */
  time: string
  short: boolean
  text: string
  /** Where to go, or null. */
  place: string | null
}

/** One cure with its price (free, or from the activity that cures) and where to get it. */
export function cureLine(cure: HealthCure, cash: number, venues: Readonly<Record<string, VenueLike>>): CureLine {
  const def = cure.activity && cure.where ? Object.values(venues[cure.where]?.spots ?? {}).flatMap((spot) => spot.activities).find((item) => item.id === cure.activity) ?? null : null
  const cost = def ? def.cost || 0 : cure.cost || 0
  return { id: cure.id, label: cure.label, price: cost ? `₦${Math.round(cost).toLocaleString('en-NG')}` : 'Free', time: def ? ` · ${def.duration}s` : '', short: cost > cash, text: cure.text, place: cure.where }
}
