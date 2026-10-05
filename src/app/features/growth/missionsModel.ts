// What the Missions app says, worked out from view.missions. Pure, so it is tested without a
// browser. The rules and numbers are in src/game/systems/missions.ts and content/missions.js.
import type { MissionsView } from '../../../types/view.ts'
import type { PhoneNotification } from '../../types/panel.ts'

/** The red badge on the Missions icon: finished missions not collected yet. */
export const missionsBadge = (view: { missions?: Pick<MissionsView, 'claimable'> | null }): number => view.missions?.claimable || 0
/** The Phone's notification line for finished missions. */
export function missionsNotifications(view: { connected: boolean; now: number; missions?: Pick<MissionsView, 'claimable' | 'day'> | null }): PhoneNotification[] {
  const m = view.missions
  if (!view.connected || !m?.claimable) return []
  return [{ id: `missions:${m.day}:${m.claimable}`, at: view.now, fresh: true, app: 'missions', text: `${m.claimable} finished mission${m.claimable === 1 ? '' : 's'} to collect` }]
}
