// The application: one game, one panel registry, one shell, wired together.
//
// This is what src/life-main.js is to the existing shell — the place where a server state turns
// into "show the trip on the map", "the venue comes up on arrival", "select the spot the player
// was heading for" — expressed over the stores instead of over the DOM. The 3D hosts register
// themselves here (ScenePane, MapPane) so those rules can reach them; until one has loaded its
// callers skip it, exactly as before, and it is given the current state the moment it exists.
import { noteChunkFailure } from './updateNotice.ts'
import { shallowRef, watch } from 'vue'
import type { LifeState } from '../../types/life.ts'
import type { Panel, PanelApi, ShellMode, VuePanel } from '../types/panel.ts'
import type { CityView, PlayerLook, SceneWorld, WorldMap } from '../types/scene.ts'
import type { PlayerActionType } from '../../types/actions.ts'
import type { CommandArgs, CommandResult } from '../types/client.ts'
import { contentFor, regularsFor } from '../../game/cities/runtime.ts'
import { isDeparting } from '../../life.ts'
import { roomJoinNeeded } from '../../client.ts'
import { crowdList, playersHere } from '../../scene/crowd.ts'
import { linkWords } from '../../ui/link.ts'
import { captureLink, forgetDraft, forgetGo, forgetJoin, forgetRef, forgetTable, joinTarget, keepPlay, pendingGo, pendingPlay, pendingRef, pendingTable, play, track } from '../../quick-start/entry.ts'
import { deviceToken } from '../features/growth/boundary.ts'
import { GO_TARGETS } from '../../game/go-links.ts'
import type { GoTarget } from '../../game/go-links.ts'
import { createLanding } from '../features/landing/landingStore.ts'
import { pingUi } from '../features/ping/pingLoader.ts'
import { liveNow, loadPeople, onLifeFrame, onLive, onPeople, onSocketClose, onSocketOpen, resetSocial, social, socketWanted, takeLinkHost } from '../features/social/useSocial.ts'
import { CONTINUED_TEXT, SESSION_CHANGED, continuedElsewhere } from './devices.ts'
import { mapPeople } from '../../game/live-model.ts'
import { hueOf, initialOf } from '../ui/format.ts'
import { funnelEvents, funnelSnap } from '../../quick-start/model.ts'
import { telemetry } from '../../telemetry/index.ts'
import { installCommunity } from '../features/community/communityStore.ts'
import type { MembersEvent } from '../../types/community.ts'
import { useGame } from './game.ts'
import type { Game } from './game.ts'
import { buildRegistry } from './panels.ts'
import { createShell } from './shell.ts'
import { observe as observeSound, play as playSound } from '../../audio/play.ts'
import { CAMERA_FRAME } from './cameraFrame.ts'
import { warmCityScenes } from '../scene/loaders.ts'
import { CAMERA_KEEP_MS, decideView, forgetViews, keepView, loadView } from './viewMemory.ts'
import type { SavedCamera, SavedSheet } from './viewMemory.ts'
import { mapUi } from '../features/travel/travelState.ts'
import { NATIVE_PANELS } from '../features/panels.ts'

/** The trip a state is on, as a key ('' when it is not travelling): a different key is a different trip. */
export const tripKey = (state: LifeState): string => {
  const active = state.activeAction
  return active && isDeparting(state) ? `${active.kind}|${state.location}|${active.id}|${active.duration}` : ''
}

const HELD_KEY = 'joinallworld-cities'

function createApp(game: Game, native: readonly VuePanel[]) {
  /** Where the other players in this venue room stand, as the room reports it: { [publicId]: { x, z } }. */
  let positions: Record<string, { x: number; z: number }> = {}
  const panels: Panel[] = buildRegistry(native, () => game.state.value)
  /** The 3D hosts, once their code has arrived. */
  const scene = {
    venue: shallowRef<SceneWorld | null>(null),
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
  let shownTrip = '', warmedCity = ''

  const shell = createShell(game, panels, {
    onMode(mode: ShellMode) {
      // A trip is watched on the map: while one is running there is no venue to stand in.
      if (mode === 'venue' && tripKey(game.state.value)) { shell.setMode('map'); return }
      telemetry.screen(mode)
      if (mode === 'map') scene.mapsWanted.value = true
    },
  })

  const playerLook = (): PlayerLook => ({ look: game.state.value.onboarding?.look, seed: game.session.value?.id ?? 'you', name: game.state.value.name || game.client.identity.name })
  const cityVenueLabel = (id: string, cityId: string): string => contentFor(cityId).venues.find((venue) => venue.id === id)?.name ?? id
  function showPlayer(): void { scene.venue.value?.setPlayer(playerLook()); scene.city.value?.setPlayer(playerLook()) }
  /** The crowd in the scene, from real data only: the server's who-is-here listing and the venue's regulars. */
  function showCrowd(): void {
    const state = game.state.value
    const npcs = isDeparting(state) ? [] : regularsFor(game.cityId.value).filter((npc) => npc.venue === state.location)
    scene.venue.value?.setCrowd(crowdList({ players: playersHere(social.people, state, game.cityId.value), npcs, selfId: game.session.value?.id ?? null, positions }))
  }
  onPeople(showCrowd)
  // Friends' houses are named on the map (public ids only).
  const showFriends = (): void => { scene.city.value?.setFriends?.((social.me?.friends ?? []).map((friend) => friend.id)) }
  onPeople(showFriends)
  // Friends where they stand or travel, and how many other players are at each venue: the map's pins, from the live frames.
  const showLive = (): void => {
    const state = game.state.value
    scene.city.value?.setPeople?.(mapPeople({ table: social.live, friends: social.me?.friends ?? [], cityId: game.cityId.value, here: isDeparting(state) ? null : state.location, now: liveNow(),
      look: (person) => ({ initial: initialOf(person.name), hue: hueOf(person.id) }) }), liveNow)
  }
  onLive(showLive)

  /** The current goal's place in the world: the scene flags the spot it points at (a guest's first goals; nothing once settled in). */
  function showGoal(): void {
    const state = game.state.value
    const chip = game.connected.value && state.onboarding?.stage === 'guest' && !state.onboarding.done ? game.view.value.goals?.chip : null
    const at = chip?.kind === 'goal' && Array.isArray(chip.go) && chip.go.length === 2 && !state.activeAction ? chip : null
    scene.venue.value?.setGoal?.(at && at.go ? { venue: at.go[0] ?? '', spot: at.go[1] ?? '', text: at.title } : null)
  }

  /**
   * WHERE PEOPLE STAND. In a public venue the avatar's place in the scene IS the player's place in the room: the scene host
   * reports it (onMove, at most three times a second, only when it moved), it goes to the community store's moveTo(x, z), the
   * server puts it in the room's `presence`, and what comes back through onMembers is drawn in the scene (other players as
   * figures at their own places) AND is what proximity voice measures. One position, one source. Home is private and reports
   * nothing. Nothing here enables voice: that is the Join voice button alone.
   */
  let placeSent = false
  /** Tell the room where the avatar stands right now (the scene itself reports only while it moves). Public venues only. */
  function reportPlace(): void {
    const at = scene.venue.value?.position?.()
    const state = game.state.value
    if (!at || at.location !== state.location || at.location === 'home' || isDeparting(state)) return
    if (community.moveTo(at.x, at.z)) placeSent = true
  }
  /** The avatar moved: that is where the player stands in the room. */
  function onMove(at: { location: string | null; x: number; z: number }): void {
    const state = game.state.value
    if (at.location === state.location && at.location !== 'home' && !isDeparting(state) && community.moveTo(at.x, at.z)) placeSent = true
  }
  /**
   * The room's member list arrived (or emptied): draw the others where they stand, and make sure the room knows where we do.
   * Everywhere but the campus the room says so itself (a member at the origin has not reported yet); on the campus a join starts
   * at the main gate, which is a real place, so the game remembers whether its own report went out and repeats it if not.
   */
  function onMembers({ self, members }: MembersEvent): void {
    const next: Record<string, { x: number; z: number }> = {}
    let listed = false, placed = false
    for (const member of members) {
      if (member.id === self) { listed = true; placed = Boolean(member.position); continue }
      if (member.position) next[member.id] = member.position
    }
    positions = next
    showCrowd()
    if (listed && (!placed || (game.state.value.location === 'unilag' && !placeSent))) reportPlace()
  }
  const community = installCommunity({
    game,
    venueLabel: cityVenueLabel,
    status: (text, error = false) => { game.net.value = { text, error } },
    toast: (text, kind) => game.toast(text, kind),
    onMembers,
    walkBy: (dx, dz) => scene.venue.value?.walkBy?.(dx, dz) === true,
    telemetry: { chunkFailed: (name, error) => { telemetry.chunkFailed(name as never, error); void noteChunkFailure() }, captureError: (error, context) => { telemetry.captureError(error, context) } },
  })

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

  let lastPlot: string | null = null
  game.on('accepted', (state, previous, cause) => {
    observeSound(state, game.view.value)
    const moved = previous.location !== state.location
    // The character is shared; the screen is this device's. A place that changed on another device is followed by the
    // scene and said in one calm line, and whatever is open here (a panel, the Map, the Phone) stays open.
    const away = continuedElsewhere(cause, previous, state)
    if (away) game.toast(CONTINUED_TEXT)
    // The funnel, from the server's own state: each event once, when it happens.
    const was = funnelSnap(previous), is = funnelSnap(state)
    for (const event of funnelEvents(was, is)) {
      const onboarding = state.onboarding
      track(event.name, event.name === 'first_activity_completed' && Number.isFinite(onboarding.bornAt) ? { ...event.props, server_ms: (onboarding.firstAt ?? 0) - (onboarding.bornAt ?? 0) } : event.props)
    }
    if (was.guest && is.done) forgetDraft()
    noteCity(game.cityId.value)
    // A trip started — from the map card, the Ride app, Go to work, anywhere: the map shows it. Once per trip, so a
    // player who then opens another screen is not pulled back; leaving that screen returns to the map.
    const trip = tripKey(state)
    if (trip && trip !== shownTrip && game.mode.value !== 'map' && !away) shell.setMode('map')
    // The trip has just set off: build the place it is going to now (once, a moment after the trip bar has appeared), so
    // arriving is a reveal and not a wait. Nothing is drawn; the map is what is on screen.
    if (trip && trip !== shownTrip && state.activeAction?.kind === 'travel') { const to = state.activeAction.id; setTimeout(() => { if (tripKey(game.state.value) === trip) scene.venue.value?.prepare?.(to) }, 450) }
    shownTrip = trip
    // On the way to another city: its own scenes are fetched during the trip, so the place the player arrives at is drawn at once.
    if (state.activeAction?.kind === 'intercity' && state.activeAction.id !== warmedCity) { warmedCity = state.activeAction.id; void warmCityScenes(warmedCity) }
    const city = scene.city.value
    if (moved) {
      if (state.estate.city !== previous.estate.city) scene.venue.value?.setState(state)
      scene.venue.value?.setLocation(state.location)
      // Arrived while watching the trip: the map shows the arrival for a moment, then the venue comes up.
      if (game.mode.value === 'map' && city && isDeparting(previous)) { city.setState(state); city.arrive(showVenue) }
      else if (game.mode.value !== 'venue' && !away) shell.setMode('venue')
      if (pendingRoute && pendingRoute.venue !== state.location) pendingRoute = null // went somewhere else instead
    }
    // Arrival, or a cancelled trip: restore room membership. Join only — voice stays off until the player asks.
    // (The community store joins the room itself, with voice off.)
    if (roomJoinNeeded(previous, state)) placeSent = false
    scene.venue.value?.setState(state)
    showPlayer()
    showCrowd()
    showGoal()
    if (state.estate.city !== previous.estate.city) {
      scene.world.value?.setCity(state.estate.city)
      scene.city.value?.setCity(state.estate.city)
      placeSent = false
      // Brought here by joining a friend (features/ping): that notice says where the player is, so nothing else is said or opened.
      if (pingUi.arriving) { /* nothing more to open */ }
      // Arriving asks for nothing: a visitor is welcomed by the server's own notice and plays on. Only a life that has no home
      // anywhere (one from before homes were chosen) is shown where to choose its first.
      else if (state.onboarding.done && !state.estate.lga && !state.estate.home && !away) shell.open('city', { city: state.estate.city })
      // The welcome is said aloud: the notice of a new city would otherwise be taken for the first word of a life just read.
      else if (!away && state.message.startsWith('Welcome to ')) game.toast(state.message)
    }
    // The server has set a plot aside for this life (or moved it): tell the maps and, decoupled, analytics. No address, no name.
    const plot = state.estate?.plot
    const plotKey = plot ? `${plot.lga}/${plot.estate}/${plot.plot}` : ''
    if (plotKey !== lastPlot) {
      if (plotKey && lastPlot !== null) { globalThis.window?.dispatchEvent(new CustomEvent('jaw:track', { detail: { name: 'house_allocated', props: {} } })); globalThis.window?.dispatchEvent(new CustomEvent('jaw:world-changed')) }
      lastPlot = plotKey
    }
    // The campus, from the server's own state: enrolment and graduation are told to analytics once each, as they happen (the programme id only).
    const studied = previous.unilagStudent?.status, studies = state.unilagStudent?.status
    if (studied !== studies && studied !== undefined) {
      const programme = state.unilagStudent?.programme
      const event = studies === 'matriculated' && studied === 'admitted' ? { name: 'campus_enrolled', props: { programme } } : studies === 'graduated' ? { name: 'campus_graduated', props: { programme } } : null
      if (event) globalThis.window?.dispatchEvent(new CustomEvent('jaw:track', { detail: event }))
    }
    city?.setState(state)
    // Where the player stands decides who the "others" at a venue are: the pins are worked out again when that changed.
    if (moved || tripKey(previous) !== trip || state.estate.city !== previous.estate.city) showLive()
    // A trip between cities is drawn on the world map, where the server's timer says it is.
    scene.world.value?.setState?.(state)
    shell.enforceRequired()
    // Arrived somewhere (or a trip ended): read who is here once; later changes are pushed by the server.
    if (roomJoinNeeded(previous, state) && game.connected.value) void loadPeople()
    if (pendingRoute && !state.activeAction) {
      const route = pendingRoute
      if (state.location === route.venue) { pendingRoute = null; if (route.spot) { shell.ui.expanded = true; void command('spot', { id: route.spot }) } }
      else if (!game.connected.value) pendingRoute = null
    }
  })
  // The device session is another identity now (a new life was started, or the old one is gone): whatever the browser holds
  // about people — friends, requests, threads, the growth hello, a seat at a table — belonged to the previous one and is
  // dropped before anything is drawn for the new one. A reconnection of the same session changes nothing.
  let sessionId: string | null | undefined
  function sessionChanged(id: string | null): void {
    if (sessionId === id) return
    const first = sessionId === undefined
    const before = sessionId
    sessionId = id
    if (first) return // the first session of this page: nothing was held for anyone else
    resetSocial()
    forgetViews(tabStore(), deviceStore(), before ? `${before}:${game.cityId.value}` : null)
    globalThis.window?.dispatchEvent(new CustomEvent('jaw:session', { detail: { id } }))
  }
  game.on('session', (session) => { sessionChanged(session.id ?? null) })

  // ---- one character on several devices -------------------------------------------------------------------------
  // The server tells every socket of a character when its life changed; the game reads it again unless this device
  // already holds that revision. A socket that opens again (the network came back, the phone was unlocked) reads at once.
  onLifeFrame((hint) => { game.lifeChanged(hint) })
  onSocketOpen((again) => { if (again) void game.wake() })
  // The server has just answered the game: a social socket that was lost while it could not be reached is opened now.
  game.on('accepted', () => { socketWanted() })
  // The server closed this socket because its session changed: this browser was signed out from another device, or the
  // account now plays another character. The copy of the old life kept here is dropped and the page starts again.
  async function sessionMoved(): Promise<void> { await (await import('./sessionEnd.ts')).sessionMoved(game) }
  onSocketClose((code) => { if (code === SESSION_CHANGED) void sessionMoved() })
  // The saved life is gone: its own sheet says so, not the welcome of the landing screen.
  game.on('expired', () => { positions = {}; forgetViews(tabStore(), deviceStore(), whoIs()); sessionChanged(null); const gate = shell.sessionGate('expired'); if (gate) shell.open(gate.id, { reason: 'expired' }) })
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
    venueLabel: (id) => cityVenueLabel(id, game.cityId.value),
    welcomeText: () => `Welcome to ${cityVenueLabel(game.state.value.location, game.cityId.value)}, ${game.state.value.name || game.client.identity.name}.`,
    tableExists: (id) => import('../../tables/city-places.ts').then((places) => places.tableById(game.cityId.value, id) !== null),
    deviceToken,
    track,
    cleanAddress() { try { if (location.pathname !== '/' || location.search) history.replaceState(null, '', '/') } catch { /* the address stays as it was */ } },
    takeLinkHost: () => { takeLinkHost() },
    joinTarget, forgetJoin, pendingRef, forgetRef, pendingTable, forgetTable, pendingGo, forgetGo,
    panelFor: (go) => (Object.hasOwn(GO_TARGETS, go) ? GO_TARGETS[go as GoTarget] : null),
    setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
  })

  /** Open the landing screen again with one sentence about what went wrong; the name and character are still on the device. */
  function reopenLanding(reason: string, name?: string | null, calm = false): void {
    const gate = shell.sessionGate('new')
    if (gate) shell.open(gate.id, { reason: 'new', problem: { reason, ...(name ? { name } : {}), ...(calm ? { calm: true } : {}) } })
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
    if (!onboarding.required || !kept) {
      play.sending = false
      // A guest who is playing (the look is confirmed, the settling-in steps are not done) is landed too: a link they kept, or a button in an e-mail, is not left waiting for them to finish.
      if (!onboarding.required) { keepPlay(null); await landing.land() }
      return
    }
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
      if (open?.kind === 'panel' && shell.byId.get(open.id)?.role === 'session-gate' && !play.settling) shell.closeSheet()
    } else if (result.code === 'invalid_look' || result.code === 'action_id_conflict' || result.code === 'action_expired') {
      keepPlay(null)
      reopenLanding('That character could not be saved. Choose again and tap Play.')
    } else if (game.connected.value) reopenLanding(result.reason || 'Your character could not be saved yet. Tap Play to try again — nothing is lost.')
    shell.enforceRequired()
    if (!game.state.value.onboarding.required) await landing.land()
  }
  // ---- the view after a reload ----------------------------------------------------------------------------------
  // The place is the server's. What this remembers is how the player was looking: the venue or the map (layer, picked place,
  // camera), and the phone app or Sim tab that was open. Until the server has answered (and this has been applied) nothing of
  // the life is drawn, so the first screen is already the right one and there is no jump from a cached place to the real one.
  const ready = shallowRef(false)
  let viewDone = false
  let lastCamera: SavedCamera | null = null
  let pendingCamera: SavedCamera | null = null
  const tabStore = (): Storage | null => { try { return globalThis.sessionStorage ?? null } catch { return null } }
  const deviceStore = (): Storage | null => { try { return globalThis.localStorage ?? null } catch { return null } }
  const whoIs = (): string | null => { const id = game.session.value?.id; return id ? `${id}:${game.cityId.value}` : null }
  const sheetToKeep = (): SavedSheet | null => {
    const open = shell.sheet.value
    if (!open) return null
    if (open.kind === 'phone') return { kind: 'phone' }
    if (open.kind === 'sim') return open.tab ? { kind: 'sim', tab: open.tab } : null
    if (open.kind === 'panel' && (open.from === 'phone' || shell.byId.get(open.id)?.placement === 'phone')) return { kind: 'panel', id: open.id }
    return null
  }
  function saveView(): void {
    const who = whoIs(), state = game.state.value
    if (!ready.value || !who || !game.connected.value || state.onboarding?.required || tripKey(state)) return
    const mode = game.mode.value
    if (mode === 'map') lastCamera = scene.city.value?.camera() ?? lastCamera
    keepView({ v: 1, who, at: state.location, mode, layer: mapUi.layer, destination: mode === 'map' ? mapUi.destination : null, sheet: sheetToKeep(), camera: mode === 'map' ? lastCamera : null, frame: CAMERA_FRAME, keptAt: Date.now() }, tabStore(), deviceStore())
  }
  function restoreView(): void {
    const who = whoIs(), state = game.state.value
    if (viewDone || !who) return
    viewDone = true
    const view = decideView(loadView(who, tabStore(), deviceStore()), {
      who, now: Date.now(), location: state.location, trip: Boolean(tripKey(state)),
      allowsMode: (mode) => { const panel = shell.byId.get(mode); return panel?.placement === 'nav' && shell.gateOf(panel) === null },
      allowsSheet: (sheet) => sheet.kind === 'phone' || (sheet.kind === 'sim' ? shell.placed('sim-tab').some((panel) => panel.id === sheet.tab) : (() => { const panel = shell.byId.get(sheet.id); return panel?.placement === 'phone' && shell.gateOf(panel) === null && typeof panel.required !== 'function' })()),
    })
    if (state.onboarding?.required) return
    if (view.mode !== 'venue') {
      if (view.camera) { lastCamera = view.camera; pendingCamera = view.camera }
      shell.setMode(view.mode, view.mode === 'map' ? { layer: view.layer, ...(view.destination ? { destination: view.destination } : {}) } : null)
    }
    // An e-mail's button was pressed: its panel is what the player came for (it opens once the landing has settled), so the remembered phone app or tab is not opened first. The remembered place and map are kept.
    if (view.sheet && !shell.sheet.value && pendingGo() === null) {
      if (view.sheet.kind === 'phone') shell.open('phone')
      else if (view.sheet.kind === 'sim') shell.open('sim', { tab: view.sheet.tab })
      else shell.open(view.sheet.id)
    }
  }
  // Closing the map and opening it again within half an hour keeps the view the player left it in; after longer, it opens on the city core.
  let mapLeftAt = 0
  // Panels and sheets open and close with a soft sound; the sound hook is inert until the first tap.
  watch(() => shell.sheet.value !== null, (open) => playSound(open ? 'open' : 'close'), { flush: 'post' })
  watch(game.mode, (mode, was) => {
    if (was === 'map' && mode !== 'map') mapLeftAt = Date.now()
    else if (mode === 'map' && was !== 'map' && mapLeftAt && Date.now() - mapLeftAt >= CAMERA_KEEP_MS) { mapLeftAt = 0; scene.city.value?.recentre() }
  })
  watch(scene.city, (city) => { if (city && pendingCamera) { city.restoreCamera(pendingCamera); pendingCamera = null } })
  watch([game.mode, shell.sheet, () => mapUi.layer, () => mapUi.destination], saveView, { flush: 'post' })
  globalThis.window?.addEventListener('pagehide', saveView)
  globalThis.document?.addEventListener('visibilitychange', () => { if (globalThis.document.hidden) saveView() })
  // A page that never hears from the server still shows what it has, after a moment.
  if (globalThis.window) globalThis.setTimeout(() => { ready.value = true }, 6000)

  /** Connect (or reconnect), then finish what the first minute left open. */
  async function connect(createNew = false, name: string | null = null, startCity?: string): Promise<boolean> {
    let ok = false
    try {
      ok = await game.connect(createNew, name, startCity)
      if (ok && !game.state.value.onboarding.required) restoreView()
    } finally { ready.value = true }
    if (ok) {
      await firstMinute()
      if (game.state.value.onboarding.done && game.state.value.estate.lga === null && !game.state.value.estate.home) shell.open('city')
    }
    // Not awaited: a slow or failing community chunk must not hold up the game or block a later Reconnect.
    if (ok) void community.ensure()
    return ok
  }
  /** Play was tapped on the landing screen ('jaw:quick-start'). A second tap while the first is on its way is the same start. */
  let starting = false
  /** The world was full when Play was tapped: the start is sent again by itself after a growing pause (capacityWait.ts worldFullWait). */
  let fullRetry: ReturnType<typeof globalThis.setTimeout> | null = null, fullTries = 0
  async function quickStart(name: string | null, startCity?: string): Promise<void> {
    if (starting) return
    starting = true
    if (fullRetry !== null) { globalThis.clearTimeout(fullRetry); fullRetry = null }
    try {
      const ok = await connect(true, name, startCity)
      if (ok) fullTries = 0
      // A refused name comes back through 'needName' with the server's sentence; anything else is the connection.
      if (!ok && game.link.value !== 'new') {
        play.sending = false
        // The sentences of a refusal are fetched only when the server gave one.
        const capacity = game.client.refusal ? await import('../features/start/capacityWait.ts') : null
        if (capacity && game.client.refusal === 'full') {
          const { worldFullText, worldFullWait } = capacity
          // Every place is taken. The visitor waits on the landing screen, told why, and is let in as soon as there is room.
          const wait = worldFullWait(fullTries++)
          reopenLanding(worldFullText(wait), name, true)
          fullRetry = globalThis.setTimeout(() => { fullRetry = null; if (!game.connected.value) void quickStart(name, startCity) }, wait * 1000)
        } else if (capacity) {
          const { networkLimitText, networkLimitWait } = capacity
          // Too many new players from this network address in the last hour: said plainly, with the wait the server gave, and tried again then.
          const wait = networkLimitWait(game.client.retryAfter)
          reopenLanding(networkLimitText(wait), name, true)
          fullRetry = globalThis.setTimeout(() => { fullRetry = null; if (!game.connected.value) void quickStart(name, startCity) }, (wait + 2) * 1000)
        } else reopenLanding(`${linkWords(game.link.value)?.why || 'The game server did not answer.'} Your name and character are kept on this device — tap Play to try again.`, name)
      }
    } finally {
      starting = false; play.sending = false; shell.bump(); shell.enforceRequired()
      // The creator that sent this Play may be waiting to send the rest of its choices.
      globalThis.window?.dispatchEvent(new CustomEvent('jaw:quick-start-done', { detail: { ok: game.connected.value && !game.state.value.onboarding.required } }))
    }
  }

  /** One action, with the routing the shell adds: a cancel or a refused trip forgets where the player was heading. */
  async function send<T extends PlayerActionType>(type: T, ...args: CommandArgs<T>): Promise<CommandResult<T>> {
    if (type === 'cancel') pendingRoute = null
    const result = await game.command(type, ...args)
    if (!result.ok && type === 'travel') pendingRoute = null
    return result
  }
  /** The campus host calls this once the avatar has reached the landmark it was sent to: the ordinary `spot` action. */
  async function commitSpot(id: string): Promise<CommandResult<'spot'>> {
    const result = await send('spot', { id })
    if (result.ok) shell.ui.expanded = true
    return result
  }
  /** Every game action goes through here. On the campus a spot is walked to first (the host commits it on arrival); everywhere else it is sent at once. */
  const command: Game['command'] = async (type, ...args) => {
    const payload = args[0] as { id?: unknown } | undefined
    const venue = scene.venue.value
    if (type === 'spot' && game.state.value.location === 'unilag' && venue?.host === 'campus' && typeof payload?.id === 'string' && payload.id !== game.state.value.spot) {
      const result = await venue.walkToSpot(payload.id)
      // A refusal of the walk itself (the server's own refusals were already shown by commitSpot).
      if (!result.ok && result.reason && (result.code === 'no_route' || result.code === 'invalid_spot')) game.toast(result.reason, 'error')
      return result as never
    }
    return send(type, ...args)
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
  function showMapLayer(layer: 'city' | 'world', at: { level?: number; city?: string; friends?: boolean } = {}): void {
    globalThis.window?.dispatchEvent(new CustomEvent('jaw:map-ui', { detail: { layer, ...at } }))
    shell.open('map', { layer, ...at })
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
    placeSent = false
    scene.venue.value?.setLocation(game.state.value.location)
    shell.setMode('venue')
    shell.open('city', { city: id })
  }
  function redrawScene(): void { if (game.mode.value !== 'map') scene.venue.value?.update() }

  /** The services the panels that keep their own state are handed (the social client, the civic cache, the Phone's report check). */
  const api: PanelApi = {
    command: (type, ...args) => command(type, ...args),
    open: (id, params) => shell.open(id, params),
    close: () => shell.close(),
    toast: (text, kind) => game.toast(text, kind),
    fetchJson: (path, options) => game.fetchJson(path, options),
    newId: () => game.newId(),
    refresh: () => shell.bump(),
    redrawScene,
    goTo: (venueId, spotId) => goTo(venueId, spotId),
    toggleCommunity: (force) => community.toggle(force),
    state: () => game.state.value,
    view: () => shell.viewFor(),
  }

  return { game, ready, panels, shell, landing, api, community, scene, command, connect, showFriends, showGoal, reportPlace, onMove, commitSpot, quickStart, goTo, menu, startLife, switchCity, showMapLayer, showPlayer, showCrowd, showLive, heldCities, playerLook }
}
export type App = ReturnType<typeof createApp>

let shared: App | null = null
/** The one application of this page. Created on first use. */
export function useApp(): App {
  shared ??= createApp(useGame(), NATIVE_PANELS)
  return shared
}
