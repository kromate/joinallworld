// The declarative attributes existing panels put in their markup, handled for any element inside
// a LegacyPanel (no bind() needed):
//   data-action="<type>" data-payload='<json>'   send a game action; data-then="close" closes on success
//   data-open="<panelId>" data-params='<json>'   open a panel
//   data-close                                   close the sheet
// and the handful the existing shell's own chrome uses and panels borrow: data-community,
// data-menu, data-new-life, data-open-gate.
import type { PlayerActionType } from '../../types/actions.ts'
import type { Game } from '../state/game.ts'
import type { Shell } from '../state/shell.ts'

const SELECTOR = '[data-action],[data-open],[data-close],[data-community],[data-menu],[data-new-life],[data-open-gate]'

export function parseJson(text: string | undefined): unknown {
  try { return text ? JSON.parse(text) as unknown : undefined } catch { return undefined }
}

export interface DeclarativeHooks {
  toggleCommunity(force?: boolean): void
  menu(id: string): void
  startLife(name: string | null): void
}

export function createDeclarativeHandler(game: Game, shell: Shell, hooks: DeclarativeHooks) {
  return async function onClick(event: Event): Promise<void> {
    const origin = event.target instanceof Element ? event.target : null
    const target = origin?.closest<HTMLElement>(SELECTOR)
    if (!target || (target instanceof HTMLButtonElement && target.disabled)) return
    const data = target.dataset
    if ('menu' in data) { shell.ui.trayOpen = false; hooks.menu(data.menu ?? ''); return }
    if ('newLife' in data) { hooks.startLife(null); return }
    if ('openGate' in data) { const gate = shell.sessionGate(); if (gate) shell.open(gate.id, { reason: data.openGate }); return }
    if ('community' in data) { shell.closeSheet(); shell.ui.trayOpen = false; hooks.toggleCommunity(true); return }
    if ('action' in data) {
      // The type comes from markup an existing panel wrote: the server validates it, as it does for any client.
      const result = await game.command(data.action as PlayerActionType, parseJson(data.payload) as never)
      if (result.ok && data.then === 'close') shell.close()
      // A sheet covers the scene, so a successful action inside one confirms itself with a toast.
      else if (result.ok && shell.sheet.value && game.state.value.message) game.toast(game.state.value.message, 'good')
      return
    }
    if ('open' in data) { shell.open(data.open ?? '', parseJson(data.params)); return }
    if ('close' in data) shell.close()
  }
}
