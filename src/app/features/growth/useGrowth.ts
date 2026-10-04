// The one shared growth store of the page, for every growth screen and for the Tables app:
//
//   import { useGrowth } from '../growth/useGrowth.ts'
//   const growth = useGrowth()
//   growth.share('table', { table: id })      growth.state.busy / .sharing / .hello / .error / .landing
//
// The store itself (state, load, call, share, shareNow, copyShare, channel, awayDismissed,
// dismissAway, track, announceAge) is built in growthStore.ts; this wires it to the application.
import { useApp } from '../../state/app.ts'
import { deviceToken, loadShareModule } from './boundary.ts'
import { createGrowth } from './growthStore.ts'
import type { Growth } from './growthStore.ts'
import { sharedGrowth } from './growthShared.ts'

export { announceAge, createGrowth, track } from './growthStore.ts'
export type { Growth, GrowthCall, GrowthDeps, GrowthFailure, GrowthState, HelloOk, LandingState, SharingState, ShareExtra } from './growthStore.ts'

/** The one growth store of this page. Created on first use. */
export function useGrowth(): Growth {
  if (sharedGrowth.value) return sharedGrowth.value
  const { game, shell, command } = useApp()
  const created = createGrowth({
    fetchJson: game.fetchJson,
    view: () => game.view.value,
    command: (type) => command(type),
    toast: (text, kind) => game.toast(text, kind),
    open: (id) => shell.open(id),
    now: () => Date.now(),
    storage: globalThis.localStorage ?? null,
    deviceToken,
    loadShare: loadShareModule,
    origin: () => globalThis.location.origin,
    revokeUrl: (url) => URL.revokeObjectURL(url),
    onSessionChange(listener) {
      const target = globalThis.window
      if (!target) return () => {}
      target.addEventListener('jaw:session', listener)
      return () => target.removeEventListener('jaw:session', listener)
    },
  })
  sharedGrowth.value = created
  return created
}
