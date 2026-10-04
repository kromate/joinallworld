// The `api` object every existing panel is handed (the contract at the top of src/ui/shell.js),
// implemented over the Vue shell. One instance serves every LegacyPanel on the page.
//
// refresh() is synchronous on purpose. Existing panels change a module variable, call
// api.refresh(), and on the next line look their new elements up in the document (to restore
// focus, to scroll a list). So every mounted LegacyPanel redraws before refresh() returns, rather
// than at Vue's next flush.
import type { PanelApi, ToastKind } from '../types/panel.ts'
import type { Game } from '../state/game.ts'
import type { Shell } from '../state/shell.ts'

export interface LegacyHost {
  api: PanelApi
  /** A mounted LegacyPanel registers its redraw; the returned function unregisters it. */
  mount(redraw: (force: boolean) => void): () => void
}
export interface LegacyApiHooks {
  goTo(venueId: string, spotId?: string): Promise<void> | void
  toggleCommunity(force?: boolean): void
  redrawScene(): void
}

export function createLegacyHost(game: Game, shell: Shell, hooks: LegacyApiHooks): LegacyHost {
  const mounted = new Set<(force: boolean) => void>()
  const api: PanelApi = {
    command: (type, ...args) => game.command(type, ...args),
    open: (id, params) => shell.open(id, params),
    close: () => shell.close(),
    toast: (text: string, kind?: ToastKind) => game.toast(text, kind),
    fetchJson: (path, options) => game.fetchJson(path, options),
    newId: () => game.newId(),
    refresh() {
      shell.bump()
      for (const redraw of [...mounted]) redraw(true)
    },
    redrawScene: () => hooks.redrawScene(),
    goTo: (venueId, spotId) => hooks.goTo(venueId, spotId),
    toggleCommunity: (force) => hooks.toggleCommunity(force),
    state: () => game.state.value,
    view: () => shell.viewFor(),
  }
  return { api, mount(redraw) { mounted.add(redraw); return () => { mounted.delete(redraw) } } }
}
