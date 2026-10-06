// WHERE AN ADDRESS TAKES A PLAYER WHO HAS A LIFE, without the application: `arrive` is given the few things it may do (open a panel,
// show the atlas, ask which city the life is in) and decides which. Nothing is bought, travelled or started: a city that is not the
// player's own opens its travel card and waits for a tap.
//
//   /games…            the Games app over wherever they are; /games/oro today's word; chess, weave, whot and penalties a private game
//                      against the computer (a Phone table)
//   /<city>            in that city: the city map. Elsewhere: the atlas with that city's travel card open ("Go to Abuja")
//   /<city>/games      in that city: the Games app (its tables are listed there). Elsewhere: the travel card
//   /<city>/<venue>    in that city, a venue that exists: the map on that venue. Otherwise as /<city>
//   /<state>, /nigeria, /world   the atlas, at that level
//   /messages, /friends, /invite, /business, /jobs, /help, /sound, /signup, /login   that panel
import { PHONE_TABLE, pathOf } from '../../../paths.ts'
import type { PanelWord, PathIntent } from '../../../paths.ts'
import type { Views } from './address.ts'
import { forgetIntent } from './intent.ts'
import type { WaitingIntent } from './intent.ts'

export interface Env {
  views: Views
  /** The city the life is in now. */
  cityId(): string
  open(id: string, params?: unknown): void
  /** The atlas ('world') or the city map ('city'), as the Map panel's own entry opens them. */
  showMapLayer(layer: 'city' | 'world', at?: { level?: number; city?: string; state?: string }): void
  /** The Games app or a table is on screen. */
  gamesOpen(): boolean
  /** The map is on screen. */
  mapOpen(): boolean
  /** Whether the city (loaded, because the life is in it) has that venue. */
  hasVenue(city: string, venue: string): boolean
  /** The sign-in sheet, the log-in sheet, or the account sheet for a signed-in player. */
  openAccount(which: 'signup' | 'login'): Promise<void>
}

const PANEL_OF: Readonly<Record<Exclude<PanelWord, 'signup' | 'login'>, string>> = { messages: 'messages', friends: 'people', invite: 'invite', business: 'business', jobs: 'jobs', help: 'help', sound: 'settings' }

export async function arrive(env: Env, found: WaitingIntent | null): Promise<void> {
  if (!found) return
  const { intent, via } = found
  forgetIntent()
  const path = pathOf(intent)
  const { views } = env
  const games = (to: string, run: () => void): void => { views.hold(to, () => env.gamesOpen(), 'replace'); run() }
  const map = (to: string, run: () => void): void => { views.hold(to, () => env.mapOpen(), 'replace'); run() }
  switch (intent.kind) {
    case 'panel':
      if (intent.panel === 'signup' || intent.panel === 'login') await env.openAccount(intent.panel); else env.open(PANEL_OF[intent.panel])
      return
    case 'games': {
      const table = intent.game && intent.game !== 'oro' ? PHONE_TABLE[intent.game] : null
      games(path, () => { if (table) env.open('tables', { table }); else env.open('games', intent.game === 'oro' ? { play: 'oro' } : undefined) })
      return
    }
    case 'atlas': map(path, () => { env.showMapLayer('world', { level: intent.level === 'world' ? 0 : 2 }) }); return
    case 'state': map(path, () => { env.showMapLayer('world', { level: 2, state: intent.state }) }); return
    case 'city': return arriveCity(env, intent, via)
  }
}

function arriveCity(env: Env, intent: Extract<PathIntent, { kind: 'city' }>, via: WaitingIntent['via']): void {
  const { views } = env
  const city = intent.city
  const address = `/${city}`
  if (env.cityId() !== city) { views.hold(address, () => env.mapOpen(), 'replace'); env.showMapLayer('world', { level: 2, city }); return }
  if (intent.page === 'games') { views.hold(pathOf(intent), () => env.gamesOpen(), 'replace'); env.open('games'); return }
  // A life the landing's own "Start in …" button began here already stands in the city: it is shown the scene, not a map it did not ask for.
  if (via === 'landing') { views.show('/', 'replace'); return }
  const venue = intent.venue && env.hasVenue(city, intent.venue) ? intent.venue : null
  views.hold(venue ? pathOf(intent) : address, () => env.mapOpen(), 'replace')
  if (venue) env.open('map', { destination: venue }); else env.showMapLayer('city')
}
