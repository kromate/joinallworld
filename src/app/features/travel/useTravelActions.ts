// What the buttons of a refusal do (the one-tap way out of "why Go is off") and the one way a trip
// is started from the Map card and the Ride app. They are the existing shell's own data-menu,
// data-open-gate, data-cancel, data-close and data-action handling, written once for components.
import { useApp } from '../../state/app.ts'
import type { TravelModeId, VenueId } from '../../../types/life.ts'
import { useAct } from '../kit/act.ts'
import type { Fix } from './travelModel.ts'
import type { LinkAction } from './travelBoundary.ts'

export function useTravelActions() {
  const { shell, menu, command } = useApp()
  const { act, pending } = useAct()

  /** Try again (the shell's menu), or the session panel for a life that is gone or not started. */
  function runLink(action: LinkAction): void {
    shell.ui.trayOpen = false
    if (action.menu) { menu(action.menu); return }
    if (action.gate) { const gate = shell.sessionGate(action.gate); if (gate) shell.open(gate.id, { reason: action.gate }) }
  }
  /** The fix of a refusal. `mode` is the card's own concern (it picks the free way); the caller handles it. */
  function runFix(fix: Fix): void {
    if (fix.kind === 'reconnect') runLink(fix.action)
    else if (fix.kind === 'cancel') void command('cancel')
    else if (fix.kind === 'enter') shell.close()
  }
  /** One trip, as 'travel' { id, mode }. Resolves true once the server started it. */
  const travel = (id: VenueId, mode: TravelModeId, options: { close?: boolean } = {}): Promise<boolean> =>
    act('travel', () => command('travel', { id, mode }), options)
  return { runLink, runFix, travel, pending }
}
