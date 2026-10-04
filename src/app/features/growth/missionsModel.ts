// What the Missions app says, worked out from view.missions. Pure, so it is tested without a
// browser. The rules and numbers are in src/game/systems/missions.ts and content/missions.js.
import type { MissionRow, MissionSet, MissionsView } from '../../../types/view.ts'
import type { PhoneNotification } from '../../types/panel.ts'

/** The mark of a mission by its kind; a finished one is the 'good' mark. */
const KIND_ICON: Readonly<Record<string, string>> = { life: 'home', discovery: 'compass', social: 'people' }
export const missionIcon = (mission: Pick<MissionRow, 'kind' | 'done'>): string => (mission.done ? 'good' : KIND_ICON[mission.kind] ?? 'star')

/** The red badge on the Missions icon: finished missions not collected yet. */
export const missionsBadge = (view: { missions?: Pick<MissionsView, 'claimable'> | null }): number => view.missions?.claimable || 0
/** The Phone's notification line for finished missions. */
export function missionsNotifications(view: { connected: boolean; now: number; missions?: Pick<MissionsView, 'claimable' | 'day'> | null }): PhoneNotification[] {
  const m = view.missions
  if (!view.connected || !m?.claimable) return []
  return [{ id: `missions:${m.day}:${m.claimable}`, at: view.now, fresh: true, app: 'missions', text: `${m.claimable} finished mission${m.claimable === 1 ? '' : 's'} to collect` }]
}

/** Which controls a mission row has. */
export type MissionAction = { kind: 'collected' } | { kind: 'collect' } | { kind: 'go'; go: boolean; swap: boolean }
export function missionAction(mission: MissionRow, scope: 'daily' | 'weekly', rerollsLeft: number): MissionAction {
  if (mission.claimed) return { kind: 'collected' }
  if (mission.done) return { kind: 'collect' }
  return { kind: 'go', go: Boolean(mission.go || mission.open), swap: scope === 'daily' && rerollsLeft > 0 }
}
/** The small line under a mission's label. */
export const missionHint = (mission: MissionRow, money: (value: number) => string): string =>
  mission.done ? (mission.claimed ? 'Done' : `Done · ${money(mission.cash)} to collect`) : `${mission.hint} · ${money(mission.cash)}`
/** A progress bar is drawn for a counted mission, and for any finished one. */
export const showsProgress = (mission: Pick<MissionRow, 'count' | 'done'>): boolean => mission.count > 1 || mission.done
export const missionPercent = (mission: Pick<MissionRow, 'n' | 'count'>): number => Math.round((mission.n / mission.count) * 100)

/** "All 3 collected · +20 stars earned" or "Collect all 3 today for +20 stars"; '' for an empty set. */
export function setLine(set: MissionSet, word: string): string {
  if (!set.total) return ''
  return set.granted ? `All ${set.total} collected · +${set.stars} stars earned` : `Collect all ${set.total} ${word} for +${set.stars} stars`
}

/** The seven cells of the week's stamp card. */
export type StampCell = 'stamped' | 'goal' | 'empty'
export const stampCells = (stamps: Pick<MissionsView['stamps'], 'days' | 'need'>): StampCell[] =>
  Array.from({ length: 7 }, (_, index) => (index < stamps.days ? 'stamped' : index === stamps.need - 1 ? 'goal' : 'empty'))

/** What follows the bold count of days lived: "days in Lagos · title · next title at 30 days: …". */
export function daysTail(m: Pick<MissionsView, 'activeDays' | 'title' | 'nextTitle'>, cityName: string): string {
  return `day${m.activeDays === 1 ? '' : 's'} in ${cityName}${m.title ? ` · ${m.title}` : ''}${m.nextTitle ? ` · next title at ${m.nextTitle.days} days: ${m.nextTitle.label}` : ''}`
}
export function stampsNote(stamps: MissionsView['stamps']): string {
  return stamps.paid ? `Stamp card complete: +${stamps.stars} stars earned.` : `Play on any ${stamps.need} days this week for +${stamps.stars} stars. Which days is up to you.`
}
