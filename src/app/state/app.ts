// The application: one game, one panel registry, one shell, wired together.
//
// This is what src/life-main.js is to the existing shell — the place where a server state turns
// into "show the trip on the map", "the venue comes up on arrival", "select the spot the player
// was heading for" — expressed over the stores instead of over the DOM. The 3D hosts register
// themselves here (ScenePane, MapPane) so those rules can reach them; until one has loaded its
// callers skip it, exactly as before, and it is given the current state the moment it exists.
import { shallowRef } from 'vue'
import type { LifeState } from '../../types/life.ts'
import type { Panel, ShellMode, VuePanel } from '../types/panel.ts'
import type { CityView, PlayerLook, VenueWorld, WorldMap } from '../legacy/scene.ts'
import { NPCS, isDeparting, roomJoinNeeded, venueLabel } from '../legacy/engine.ts'
import { LEGACY_PANELS, crowdList, linkWords, playersHere } from '../legacy/modules.ts'
import { captureLink, forgetDraft, forgetJoin, forgetRef, forgetTable, joinTarget, keepPlay, pendingPlay, pendingRef, pendingTable, play, track } from '../legacy/quickStart.ts'
import { deviceToken } from '../features/growth/boundary.ts'
import { createLanding } from '../features/landing/landingStore.ts'
import { tableById } from '../../tables/places.ts'
import { loadPeople, onPeople, social, takeLinkHost } from '../legacy/social.ts'
import { createLegacyHost } from '../legacy/api.ts'
import { createDeclarativeHandler } from '../legacy/declarative.ts'
import { useGame } from './game.ts'
import type { Game } from './game.ts'
import { buildRegistry, legacyChoice } from './panels.ts'
import { createShell } from './shell.ts'
import { NATIVE_PANELS } from '../features/panels.ts'

/** The trip a state is on, as a key ('' when it is not travelling): a different key is a different trip. */
export const tripKey = (state: LifeState): string => {
  const active = state.activeAction
  return active && isDeparting(state) ? `${active.kind}|${state.location}|${active.id}|${active.duration}` : ''
}

const HELD_KEY = 'joinallworld-cities'

function createApp(game: Game, native: readonly VuePanel[], search: string) {
  const panels: Panel[] = buildRegistry(LEGACY_PANELS, native, legacyChoice(search))
  /** The 3D hosts, once their code has arrived. */
  const scene = {
    venue: shallowRef<VenueWorld | null>(null),
    city: shallowRef<CityView | null>(null),
    world: shallowRef<WorldMap | null>(null),
    /** Bumped when the venue comes up after a trip, so the pane can fade it in. */
    arrivals: shallowRef(0),
    /** Asked for by the shell the first time the Map opens. */
    mapsWanted: shallowRef(false),
  }
  // The link this page was opened with is read once, here, before anything rewrites the address.
  { const link = captureLink(); if (link.join || link.ref || link.table) track('invite_opened', { kind: link.table ? 'table' : link.ref ? 'share' : 'house', has_session: game.client.hasSavedIdentity === true }) }
  let pendingRoute: { venue: string; spot?: string } | null = null
  let shownTrip = ''

  const shell = createShell(game, panels, {
    onMode(mode: ShellMode) {
      // A trip is watched on the map: while one is running there is no venue to stand in.
      if (mode === 'venue' && tripKey(game.state.value)) { shell.setMode('map'); return }
      if (mode === 'map') scene.mapsWanted.value = true
    },
  })

  const playerLook = (): PlayerLook => ({ look: game.state.value.onboarding?.look, seed: game.session.value?.id ?? 'you', name: game.state.value.name || game.client.identity.name })
  function showPlayer(): void { scene.venue.value?.setPlayer(playerLook()); scene.city.value?.setPlayer(playerLook()) }
  /** The crowd in the scene, from real data only: the server's who-is-here listing and the venue's regulars. */
  function showCrowd(): void {
    const state = game.state.value
    const npcs = isDeparting(state) ? [] : Object.values(NPCS).filter((npc) => npc.venue === state.location)
    scene.venue.value?.setCrowd(crowdList({ players: playersHere(social.people, state, game.cityId.value), npcs, selfId: game.session.value?.id ?? null }))
  }
  onPeople(showCrowd)

  function showVenue(): void {
    if (game.mode.value === 'venue') return
    shell.setMode('venue')
    scene.arrivals.value += 1
  }

  function rememberedCities(): string[] {
    try { const list: unknown = JSON.parse(globalThis.localStorage?.getItem(HELD_KEY) || '[]'); return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [] } catch { return [] }
  }
  /**
   * The cities this player has a life in. The server says so in the session response, which makes
   * it true on every device; only a server that does not report it falls back to what this browser remembers.
   */
  function heldCities(): string[] {
    const held = game.session.value?.cities
    return Array.isArray(held) ? held.filter((id) => typeof id === 'string') : rememberedCities()
  }
  function noteCity(id: string): void {
    try { const list = rememberedCities(); if (!list.includes(id)) globalThis.localStorage?.setItem(HELD_KEY, JSON.stringify([...list, id])) } catch { /* remembered for this visit only */ }
  }

  game.on('accepted', (state, previous) => {
    const moved = previous.location !== state.location
    noteCity(game.cityId.value)
    // A trip started — from the map card, the Ride app, Go to work, anywhere: the map shows it. Once per trip, so a
    // player who then opens another screen is not pulled back; leaving that screen returns to the map.
    const trip = tripKey(state)
    if (trip && trip !== shownTrip && game.mode.value !== 'map') shell.setMode('map')
    shownTrip = trip
    const city = scene.city.value
    if (moved) {
      scene.venue.value?.setLocation(state.location)
      // Arrived while watching the trip: the map shows the arrival for a moment, then the venue comes up.
      if (game.mode.value === 'map' && city && isDeparting(previous)) { city.setState(state); city.arrive(showVenue) }
      else if (game.mode.value !== 'venue') shell.setMode('venue')
      if (pendingRoute && pendingRoute.venue !== state.location) pendingRoute = null // went somewhere else instead
    }
    scene.venue.value?.setState(state)
    showPlayer()
    showCrowd()
    city?.setState(state)
    shell.enforceRequired()
    // Arrived somewhere (or a trip ended): read who is here once; later changes are pushed by the server.
    if (roomJoinNeeded(previous, state) && game.connected.value) void loadPeople()
    if (pendingRoute && !state.activeAction) {
      const route = pendingRoute
      if (state.location === route.venue) { pendingRoute = null; if (route.spot) { shell.ui.expanded = true; void command('spot', { id: route.spot }) } }
      else if (!game.connected.value) pendingRoute = null
    }
  })
  // The saved life is gone: its own sheet says so, not the welcome of the landing screen.
  game.on('expired', () => { const gate = shell.sessionGate('expired'); if (gate) shell.open(gate.id, { reason: 'expired' }) })
  game.on('needName', (problem) => { const gate = shell.sessionGate('new'); if (gate) shell.open(gate.id, { reason: 'new', problem }) })

  /** The landing of an invite, share or table link (features/landing): handled once, after the quick start. */
  const landing = createLanding({
    fetchJson: game.fetchJson,
    online: () => game.connected.value,
    cityId: () => game.cityId.value,
    sessionId: () => game.session.value?.id ?? null,
    isGuest: () => game.state.value.onboarding?.stage === 'guest' && !game.state.value.onboarding.done,
    refresh: () => game.refresh(),
    open: (id, params) => shell.open(id, params),
    toast: (text) => game.toast(text),
    venueLabel: (id) => venueLabel(id, game.cityId.value),
    welcomeText: () => `Welcome to ${venueLabel(game.state.value.location, game.cityId.value)}, ${game.state.value.name || game.client.identity.name}.`,
    tableExists: (id) => tableById(id) !== null,
    deviceToken,
    track,
    cleanAddress() { try { if (location.pathname !== '/' || location.search) history.replaceState(null, '', '/') } catch { /* the address stays as it was */ } },
    takeLinkHost: () => { takeLinkHost() },
    joinTarget, forgetJoin, pendingRef, forgetRef, pendingTable, forgetTable,
    setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
  })

  /** Open the landing screen again with one sentence about what went wrong; the name and character are still on the device. */
  function reopenLanding(reason: string, name?: string | null): void {
    const gate = shell.sessionGate('new')
    if (gate) shell.open(gate.id, { reason: 'new', problem: { reason, ...(name ? { name } : {}) } })
  }
  /**
   * After every successful connection: finish a quick start whose Play was tapped — now, or before a
   * reload or a dropped connection. A new life is a GUEST held until its look is confirmed
   * (state.onboarding.required); the look the landing screen kept on the device is confirmed by one
   * 'onboarding.quick-start' action whose id is made once and reused by every retry, so the server
   * applies it exactly once. Safe to call any number of times.
   * Then an invite, share or table link is landed (features/landing).
   */
  async function firstMinute(): Promise<void> {
    const onboarding = game.state.value.onboarding
    if (onboarding.done || onboarding.stage !== 'guest') { play.sending = false; if (onboarding.done) forgetDraft(); await landing.land(); return }
    const kept = pendingPlay()
    if (!onboarding.required || !kept) { play.sending = false; if (!onboarding.required) keepPlay(null); return }
    const actionId = kept.actionId ?? game.newId()
    if (!kept.actionId) keepPlay({ ...kept, actionId })
    play.sending = true
    const result = await game.resend(actionId, 'onboarding.quick-start', { look: kept.look, ...(kept.joining ? { joining: true } : {}) })
    play.sending = false
    if (result.ok && kept.joining) landing.owe()
    if (result.ok) {
      keepPlay(null)
      shell.ui.expanded = true
      const open = shell.sheet.value
      if (open?.kind === 'panel' && shell.byId.get(open.id)?.role === 'session-gate') shell.closeSheet()
    } else if (result.code === 'invalid_look' || result.code === 'action_id_conflict' || result.code === 'action_expired') {
      keepPlay(null)
      reopenLanding('That character could not be saved. Choose again and tap Play.')
    } else if (game.connected.value) reopenLanding(result.reason || 'Your character could not be saved yet. Tap Play to try again — nothing is lost.')
    shell.enforceRequired()
    if (!game.state.value.onboarding.required) await landing.land()
  }
  /** Connect (or reconnect), then finish what the first minute left open. */
  async function connect(createNew = false, name: string | null = null): Promise<boolean> {
    const ok = await game.connect(createNew, name)
    if (ok) await firstMinute()
    return ok
  }
  /** Play was tapped on the landing screen ('jaw:quick-start'). A second tap while the first is on its way is the same start. */
  let starting = false
  async function quickStart(name: string | null): Promise<void> {
    if (starting) return
    starting = true
    try {
      const ok = await connect(true, name)
      // A refused name comes back through 'needName' with the server's sentence; anything else is the connection.
      if (!ok && game.link.value !== 'new') {
        play.sending = false
        reopenLanding(`${linkWords(game.link.value)?.why || 'The game server did not answer.'} Your name and character are kept on this device — tap Play to try again.`, name)
      }
    } finally { starting = false; play.sending = false; legacy.api.refresh(); shell.enforceRequired() }
  }

  /** One action, with the routing the shell adds: a cancel or a refused trip forgets where the player was heading. */
  const command: Game['command'] = async (type, ...args) => {
    if (type === 'cancel') pendingRoute = null
    const result = await game.command(type, ...args)
    if (!result.ok && type === 'travel') pendingRoute = null
    return result
  }

  /**
   * Go to a venue and stand at a spot there. Already there: select the spot. Elsewhere: open the
   * Map travel card for the venue — a trip is never started on the player's behalf — and remember
   * the spot for when they arrive.
   */
  async function goTo(venueId: string, spotId?: string): Promise<void> {
    if (game.state.value.location === venueId) {
      if (game.mode.value !== 'venue') shell.setMode('venue')
      if (spotId) { shell.ui.expanded = true; await command('spot', { id: spotId }) }
      return
    }
    pendingRoute = { venue: venueId, spot: spotId }
    shell.open('map', { destination: venueId })
  }

  /** Open the Map on the city map ('city') or the country map ('world'). The maps are told first. */
  function showMapLayer(layer: 'city' | 'world'): void {
    globalThis.window?.dispatchEvent(new CustomEvent('jaw:map-ui', { detail: { layer } }))
    shell.open('map', { layer })
  }
  /** Entries of the More menu and the connection notice. */
  function menu(id: string): void {
    if (id === 'reconnect') void connect()
    else if (id === 'city' || id === 'locate') showMapLayer('world')
  }
  function startLife(name: string | null): void { void connect(true, name) }
  async function switchCity(id: string): Promise<void> {
    const result = await game.switchCity(id)
    if (!result.ok) return
    noteCity(id)
    scene.world.value?.setCity(id); scene.city.value?.setCity(id)
    scene.venue.value?.setLocation(game.state.value.location)
    shell.setMode('venue')
    shell.open('city', { city: id })
  }
  /**
   * Presence, venue chat and proximity voice (src/community.js) are not hosted by this shell yet:
   * that module is ported last and by itself (docs/MIGRATION-VUE-TS.md, step 7). Nothing here
   * loads it, so nothing here can reach the microphone.
   */
  function toggleCommunity(): void {
    game.toast(game.state.value.location === 'home' ? 'Your home is private. Visit a public venue to meet people.' : 'Venue chat and voice are not in this preview yet. Open the game without “next” to use them.')
  }
  function redrawScene(): void { if (game.mode.value !== 'map') scene.venue.value?.update() }

  const legacy = createLegacyHost(game, shell, { goTo, toggleCommunity, redrawScene })
  // The command an existing panel sends goes through the same routing as the shell's own.
  legacy.api.command = command
  const onDeclarativeClick = createDeclarativeHandler({ ...game, command }, shell, { toggleCommunity, menu, startLife })

  return { game, panels, shell, landing, legacy, scene, command, connect, quickStart, goTo, menu, startLife, switchCity, toggleCommunity, showMapLayer, showPlayer, showCrowd, heldCities, onDeclarativeClick, playerLook }
}
export type App = ReturnType<typeof createApp>

let shared: App | null = null
/** The one application of this page. Created on first use. */
export function useApp(): App {
  shared ??= createApp(useGame(), NATIVE_PANELS, globalThis.location?.search ?? '')
  return shared
}
