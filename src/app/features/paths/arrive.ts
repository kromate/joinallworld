// A SHORT ADDRESS (/games, /abuja, … — the table is src/paths.ts), as the page handles it. This is a chunk of its own: the page
// fetches it only when the address is not `/`, or when an address kept earlier in this tab is still waiting, so a plain visit pays nothing.
//
//   startPaths()   once, after the game has mounted: reads the address, keeps what it asked for (intent.ts), and, as soon as the player
//                  has a life (a returning player at once; a new visitor after the landing's Play), takes them there (routing.ts).
//   enterGames()   the Games app was opened from inside the game: its address is shown too, so it can be copied (address.ts: Back closes it).
//
// Reserved addresses (the API, the build, invite and share links, files) are never touched; an unknown address is quietly replaced by `/`.
import { watch } from 'vue'
import { cachedCityContent } from '../../../game/cities/registry.ts'
import { isReservedPath, parsePath, pathOf } from '../../../paths.ts'
import { openAccount, openLogin, openSignup } from '../account/accountOpen.ts'
import { useAccountLite } from '../account/useAccountLite.ts'
import { useApp } from '../../state/app.ts'
import type { App } from '../../state/app.ts'
import { browserAddress, createViews } from './address.ts'
import { keepIntent, readIntent, waiting } from './intent.ts'
import { arrive } from './routing.ts'
import type { Env } from './routing.ts'

const address = browserAddress()
const views = createViews(address)
let started = false

const gamesOpen = (app: App): boolean => { const sheet = app.shell.sheet.value; return sheet?.kind === 'panel' && (sheet.id === 'games' || sheet.id === 'tables') }
const mapOpen = (app: App): boolean => app.game.mode.value === 'map'

/** The atlas shows a state's card (and, for several open cities, its own map): chosen once the atlas exists and has gone to its level. */
function selectState(app: App, state: string): void {
  const choose = (world: NonNullable<App['scene']['world']['value']>): void => { void world.ready.then(() => { setTimeout(() => { world.select({ kind: 'state', id: state }, { flyTo: true }) }, 700) }) }
  const world = app.scene.world.value
  if (world) { choose(world); return }
  const stop = watch(app.scene.world, (next) => { if (next) { stop(); choose(next) } })
}

function envOf(app: App): Env {
  const { game, shell } = app
  return {
    views,
    cityId: () => game.cityId.value,
    open: (id, params) => { shell.open(id, params) },
    showMapLayer: (layer, at) => {
      app.showMapLayer(layer, { ...(at?.level !== undefined ? { level: at.level } : {}), ...(at?.city ? { city: at.city } : {}) })
      if (at?.state) selectState(app, at.state)
    },
    gamesOpen: () => gamesOpen(app),
    mapOpen: () => mapOpen(app),
    hasVenue: (city, venue) => cachedCityContent(city)?.venues.some((item) => item.id === venue) ?? false,
    async openAccount(which) {
      const lite = useAccountLite()
      await lite.load()
      if (lite.state.account) openAccount(shell)
      else if (which === 'login') openLogin(shell, 'hud')
      else openSignup(shell, 'hud', lite.state.guest)
    },
  }
}

/** The Games app was opened from inside the game: show `/games` (a Back closes it). */
export function enterGames(): void {
  const app = useApp()
  startPaths() // Back, and the address going back to `/` when the app closes, are handled from here on
  if (views.held() !== null || !globalThis.history) return
  views.hold('/games', () => gamesOpen(app), 'push')
  views.watch(gamesOpen(app))
}

/** Once per page, after the game has mounted. */
export function startPaths(): void {
  if (started) return
  started = true
  const app = useApp()
  const { game, shell } = app
  const here = address.path()
  const asked = parsePath(here)
  if (asked) {
    keepIntent(asked)
    // An action (/signup, /messages, …) is not a place to stay on: its address is cleaned at once. A place or a game keeps its address while it is open.
    views.show(asked.kind === 'panel' ? '/' : pathOf(asked), 'replace')
  } else {
    if (here !== '/' && !isReservedPath(here)) views.show('/', 'replace')
    waiting.value = readIntent()?.intent ?? null
  }
  const ready = (): boolean => game.connected.value && game.state.value.onboarding?.required !== true && game.session.value !== null
  const env = envOf(app)
  // After the page's own first steps (restoring the view, landing a link): a tick later, so what the address asked for is what stays open.
  watch(ready, (now) => { if (now) setTimeout(() => { void arrive(env, readIntent()) }, 0) }, { immediate: true })
  watch(() => views.probe(), (open) => { views.watch(open) })
  window.addEventListener('popstate', () => {
    const intent = parsePath(address.path())
    if (!intent || intent.kind === 'panel') {
      // Back to `/`: what the address had opened is closed.
      if (views.drop()) { if (game.mode.value === 'map') shell.setMode('venue'); if (gamesOpen(app)) shell.closeSheet() }
      return
    }
    views.drop()
    keepIntent(intent)
    if (ready()) void arrive(env, readIntent())
  })
}
