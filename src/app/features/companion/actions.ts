// What a button can do. Every action is one call on `ActionEnv`, which the host fills with the game's real routes (actionEnv.ts):
// open a panel, show a place on the Map, open the world map on a city, walk to a spot, ring or message a friend, start a tour.
// Nothing here spends money, travels or messages anyone on its own: a trip is only ever opened on the Map for the player to start.
import type { CompanionAction, TourId } from './types.ts'

export interface ActionEnv {
  openPanel(id: string, params?: Record<string, unknown>): void
  openMap(venue: string): void
  openWorld(city: string): void
  goTo(venue: string, spot?: string): void
  openSim(tab: string): void
  openChat(friend: string, name: string): void
  call(friend: string, name: string): void
  invite(): void
  startTour(id: TourId): void
  ask(text: string): void
  setMode(mode: 'lively' | 'quiet' | 'off'): void
  dismiss(): void
}

export function runAction(action: CompanionAction, env: ActionEnv): void {
  switch (action.kind) {
    case 'open': env.openPanel(action.id, action.params); return
    case 'map': env.openMap(action.venue); return
    case 'world': env.openWorld(action.city); return
    case 'go': env.goTo(action.venue, action.spot); return
    case 'relief': env.openPanel('bank'); return
    case 'call': env.call(action.friend, action.name); return
    case 'chat': env.openChat(action.friend, action.name); return
    case 'invite': env.invite(); return
    case 'tour': env.startTour(action.tour); return
    case 'ask': env.ask(action.text); return
    case 'sim': env.openSim(action.tab); return
    case 'report': env.openPanel('support'); return
    case 'mode': env.setMode(action.mode); return
    case 'dismiss': env.dismiss(); return
  }
}

/** The panel ids an action opens through `openPanel`, for the test that each one exists. */
export function panelOf(action: CompanionAction): string | null {
  if (action.kind === 'open') return action.id
  if (action.kind === 'relief') return 'bank'
  if (action.kind === 'report') return 'support'
  return null
}
