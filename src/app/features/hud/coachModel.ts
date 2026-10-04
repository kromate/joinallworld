// The first-session coach: for the first few starter goals it names the next control and rings
// it. Pure, so the wording and the targets are tested without a browser.
import type { LifeState } from '../../../types/life.ts'
import type { Panel, PanelView, ShellMode } from '../../types/panel.ts'
import { isTrip } from '../venue/venueModel.ts'

/** The coach points at the next control for this many starter goals, then stops. */
export const COACH_GOALS = 3
export const COACH_KEY = 'joinallworld-coach-off'

export interface CoachStep {
  text: string
  /** A selector, within the shell, of the control to ring. */
  target: string | null
  /** The Phone app to ring once the phone is open. */
  app?: string
}
export interface CoachInput {
  off: boolean
  clean: boolean
  mode: ShellMode
  expanded: boolean
  panelOf: (id: string) => Pick<Panel, 'id' | 'title' | 'placement'> | undefined
}

/**
 * Silent once the first goals are done, when dismissed, and whenever a sheet, the map or Buy mode
 * is in front. Only the goal's own activity is cheered on; anything else is named as a detour.
 */
export function coachStep(state: Pick<LifeState, 'activeAction' | 'location' | 'spot'>, view: Pick<PanelView, 'connected' | 'onboarding' | 'goals' | 'activities'>, input: CoachInput): CoachStep | null {
  if (input.off || input.clean || input.mode !== 'venue' || !view.connected || view.onboarding?.required) return null
  const goal = view.goals?.chip
  if (!goal || goal.kind !== 'goal' || goal.step > COACH_GOALS) return null
  const active = state.activeAction
  if (active) {
    if (isTrip(active)) return null
    const [goalVenue, goalSpot] = goal.go ?? []
    const forGoal = Boolean(goalSpot) && state.location === goalVenue && state.spot === goalSpot
    return { text: forGoal ? 'Nice. It finishes by itself — watch the bar.' : 'This is not part of the goal. Let it finish or cancel it, then carry on.', target: null }
  }
  if (goal.go) {
    const [venueId, spotId] = goal.go
    if (state.location !== venueId) return { text: `Go ${venueId === 'home' ? 'Home' : 'there'} first: tap ${venueId === 'home' ? 'Home' : 'Map'}.`, target: `[data-nav="${venueId === 'home' ? 'home' : 'map'}"]` }
    const spot = view.activities.spots.find((item) => item.id === spotId)
    if (spot && (state.spot !== spotId || !input.expanded)) return { text: `Tap ${spot.label} to see what you can do.`, target: `[data-spot="${spotId}"]` }
    return { text: `Pick one. ${goal.hint}.`, target: '.life-action:not(:disabled):not(.is-blocked)' }
  }
  if (goal.open) {
    const app = input.panelOf(goal.open)
    if (app?.placement === 'phone') return { text: `Open Phone, then ${app.title}.`, target: '[data-nav="phone"]', app: app.id }
    if (app?.placement === 'nav') return { text: `Tap ${app.title}.`, target: `[data-nav="${goal.open}"]` }
  }
  return null
}
