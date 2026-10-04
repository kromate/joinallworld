// The Community store: the ONE controller (src/community.ts) of the page, loaded on demand, and what
// the Vue shell shows of it. The controller (room socket, presence, chat, nearby voice) stays out of
// the entry chunk: it is fetched with the bounded retry of src/lazy-load.ts (1, 2, 4, 8, 16 s) and
// the panel says what is true while it is not here.
//
// HOW TO WIRE IT (src/app/state/app.ts), once, where `game`, `shell`, `scene` and `showCrowd` exist:
//
//   const community = installCommunity({
//     game,                                          // src/app/state/game.ts Game
//     venueLabel,                                    // (venueId, cityId) => the venue's name
//     status: (text, error) => ...,                  // the status line (game.net is the usual home)
//     toast: (text, kind) => game.toast(text, kind),
//     onMembers: ({ self, members }) => ...,         // draw the others; call reportPlace() when listed without a place (life-main.js onMembers)
//     walkBy: (dx, dz) => scene.venue.value?.walkBy?.(dx, dz) === true,
//     telemetry: { chunkFailed: (name, error) => ..., captureError: (error, context) => ... },   // optional
//   })
//   toggleCommunity = (force?: boolean) => community.toggle(force)     // the `data-community` buttons and the phone icon
//   after the first connection:  void community.ensure()               // fetches the code and joins the room (nothing asks for the microphone)
//   reportPlace():               community.moveTo(x, z)                // the avatar's place in the venue scene; true when the room was told
//   `community.positions.value`  member positions by public id (self excluded), for the scene crowd
//
// MOUNT: <CommunityHost /> once in App.vue (any place after the scene; it is a position:fixed aside, styled by
// #community-panel in src/ui/shell.css). It renders nothing while closed. It is hidden at home: toggle() refuses
// there with the toast the old shell used, and the store closes the panel on arriving home. Load the host with
// defineAsyncComponent if it should stay out of the entry chunk (the panel's CSS comes with it).
//
// The store joins the room by itself: on arrival somewhere new, when a cancelled departure leaves the player
// where they were (roomJoinNeeded), and when the city changes. The join puts the player back with voice OFF.
// A session that ended (`expired`, or a new life) destroys the controller. Nothing here turns voice on:
// only the panel's Join voice button does, as a user gesture.
import { computed, readonly, ref, shallowRef, watch } from 'vue'
import type { ComputedRef, Ref, ShallowRef } from 'vue'
import { roomJoinNeeded } from '../../../client.ts'
import { createLazyLoader } from '../../../lazy-load.ts'
import type { LazyLoader, LazyOptions, LazyState } from '../../../lazy-load.ts'
import { linkWords } from '../../../ui/link.ts'
import type { CommunityOptions } from '../../../community.ts'
import type { CommunityController, CommunityState, MembersEvent, VoicePosition } from '../../../types/community.ts'
import type { Game } from '../../state/game.ts'
import type { ToastKind } from '../../types/panel.ts'

/** What the code chunk exports. */
export interface CommunityModule { createCommunity: (options: CommunityOptions) => Promise<CommunityController> }

/** What the store reads of the application. Injected so the store can be wired (and tested) without the whole shell. */
export interface CommunityDeps {
  game: Pick<Game, 'state' | 'cityId' | 'connected' | 'link' | 'on'>
  venueLabel: (venueId: string, cityId: string) => string
  status: (text: string, error?: boolean) => void
  toast: (text: string, kind?: ToastKind) => void
  /** Everyone in the room and where they stand (null until reported); also called with an empty list when the room empties. */
  onMembers: (event: MembersEvent) => void
  /** Walk the avatar in the scene by (dx, dz). True when it walked. */
  walkBy: (dx: number, dz: number) => boolean
  telemetry?: {
    chunkFailed?: (name: string, error: string | null) => void
    captureError?: (error: unknown, context: { chunk: string }) => void
  }
  /** Test seams. */
  loadModule?: () => Promise<CommunityModule>
  lazy?: Pick<LazyOptions, 'setTimeout' | 'clearTimeout' | 'delays'>
  reload?: () => void
}

/** What the panel shows while the community code is not here. */
export interface CommunityRecovery { heading: string; lead: string; next: string; waiting: boolean }

export interface CommunityStore {
  /** The floating panel is open. */
  open: Readonly<Ref<boolean>>
  /** The controller's state; null until it has started. */
  state: ShallowRef<CommunityState | null>
  /** Member positions by public id (self excluded), from the room's presence; feeds the scene crowd. */
  positions: ShallowRef<Record<string, VoicePosition>>
  /** The loader's state, as a ref. */
  load: ShallowRef<LazyState>
  /** Non-null while the code did not load or did not start: what happened, what happens next, and the two buttons. */
  recovery: ShallowRef<CommunityRecovery | null>
  /** The controller exists. */
  running: ComputedRef<boolean>
  /** Create the controller once its code is here and the game is connected. Safe to call any number of times. */
  start(): Promise<void>
  ensure(): Promise<void>
  /** The `data-community` buttons. */
  toggle(force?: boolean): void
  close(): void
  /** "Try again": ask the loader at once. */
  retry(): void
  /** "Reload and retry". */
  reload(): void
  /** The avatar's place in the venue scene. True when the room was told. */
  moveTo(x: number, z: number): boolean
  /** The controller, for the panel's actions; null until it has started. */
  controller(): CommunityController | null
  destroy(): void
}

/** Why something cannot be done right now, in the words of the real connection state ("offline" only when this device has no network). */
export function notConnected(link: string | null | undefined, what: string): string {
  return linkWords(link)?.cannot(what) || `You are not connected yet, so you cannot ${what}. Try again in a moment.`
}

/** The wording under "Community could not load": what is being tried and what the player can do. */
export function recoveryNext(load: LazyState, startProblem: boolean): string {
  const waiting = load.status === 'loading'
  return waiting ? 'Trying again now…'
    : load.status === 'retrying' ? `Trying again by itself in ${Math.round((load.retryInMs ?? 0) / 1000)} s (attempt ${load.attempt + 1} of ${load.attempts}).`
      : load.status === 'failed' ? 'It was tried several times and is no longer being retried. Reload to try again.'
        : startProblem ? 'Its code loaded but it could not start.' : ''
}

/** The status-line sentence for a loader state that is not good, or null. */
export function loadStatusLine(load: LazyState): string | null {
  if (load.status === 'retrying') return `Community did not load · retrying in ${Math.round((load.retryInMs ?? 0) / 1000)} s (attempt ${load.attempt + 1} of ${load.attempts})`
  if (load.status === 'failed') return 'Community is unavailable · it did not load. Open Community to retry'
  return null
}

/** Positions of everyone but the one listed as `self`, as the scene wants them. */
export function positionsOf({ self, members }: MembersEvent): Record<string, VoicePosition> {
  const next: Record<string, VoicePosition> = {}
  for (const member of members) if (member.id !== self && member.position) next[member.id] = member.position
  return next
}

export function createCommunityStore(deps: CommunityDeps): CommunityStore {
  const { game } = deps
  const open = ref(false)
  const state = shallowRef<CommunityState | null>(null)
  const positions = shallowRef<Record<string, VoicePosition>>({})
  const recovery = shallowRef<CommunityRecovery | null>(null)
  let instance: CommunityController | null = null
  let starting = false, startProblem = false, lastRefusal = 0, epoch = 0

  const loader: LazyLoader<CommunityModule> = createLazyLoader<CommunityModule>(
    () => (deps.loadModule ? deps.loadModule() : import('../../../community.ts')),
    {
      ...deps.lazy,
      onState(next) {
        load.value = next
        const line = loadStatusLine(next)
        if (line) {
          deps.status(line, true)
          if (next.status === 'failed') deps.telemetry?.chunkFailed?.('community', next.error)
        } else if (next.status === 'ready') void start() // a retry that succeeded by itself: bring it up now, without waiting for the player
        updateRecovery()
      },
    },
  )
  const load = shallowRef<LazyState>(loader.state)

  /** Shown while the code is not here (and sticky while the next attempt is in flight, so the buttons do not flicker away). */
  function updateRecovery(): void {
    if (instance) { recovery.value = null; return }
    const current = load.value
    const waiting = current.status === 'loading'
    const down = current.status === 'retrying' || current.status === 'failed' || startProblem
    if (!down && !(waiting && recovery.value)) return
    recovery.value = {
      heading: 'Community could not load',
      lead: 'Your saved city life is still available. Check your connection, then try community again.',
      next: recoveryNext(current, startProblem), waiting,
    }
  }

  function handleMembers(event: MembersEvent): void {
    positions.value = positionsOf(event)
    deps.onMembers(event)
  }
  function handleChange(next: CommunityState): void {
    state.value = next
    // A venue chat line the server refused (blocked wording, or the player is muted): its sentence is also a toast, seen wherever the panel is scrolled to.
    if (next.refusal && next.refusal.seq !== lastRefusal) {
      lastRefusal = next.refusal.seq
      if (next.refusal.text) deps.toast(next.refusal.text, 'error')
    }
  }

  async function start(): Promise<void> {
    if (instance || starting || !game.connected.value) return
    starting = true
    const mine = epoch
    try {
      const module = await loader.load()
      if (!module || instance || !game.connected.value || mine !== epoch) return
      const created = await module.createCommunity({
        cityId: game.cityId.value, venueId: game.state.value.location,
        onMembers: handleMembers,
        venueName: (venueId, cityId) => deps.venueLabel(venueId, cityId),
        // The panel's Walk buttons walk the avatar; its new place comes back through moveTo like any other step.
        onStep: (dx, dz) => deps.walkBy(dx, dz) === true,
        onStatus: (s) => { if (s.status === 'offline') deps.status('Community disconnected · reconnect in panel', true); else if (s.connected) deps.status('Connected · progress saved') },
        onChange: handleChange,
      })
      if (mine !== epoch) { created.destroy(); return }
      instance = created
      startProblem = false; lastRefusal = created.state.refusal?.seq ?? 0
      state.value = created.state
      updateRecovery()
    } catch (error) {
      console.error('The community panel could not be started:', error)
      deps.telemetry?.captureError?.(error, { chunk: 'community' })
      deps.status('Community is unavailable · it could not start. Open Community to retry', true)
      startProblem = true
      updateRecovery()
    } finally { starting = false }
  }

  function toggle(force?: boolean): void {
    if (force === false) { open.value = false; return }
    if (game.state.value.location === 'home') { deps.toast('Your home is private. Visit a public venue to meet people.'); return }
    if (!instance) {
      if (!game.connected.value) { deps.toast(notConnected(game.link.value, 'open the community'), 'error'); return }
      // Not loaded: the panel itself says so and offers the retry. While the first attempt is still in flight there is
      // nothing to show yet, only to wait for.
      if (!recovery.value) {
        deps.toast('Community is still loading. Try again in a moment.')
        void start() // starts at once, or joins the attempt already in flight
        return
      }
    }
    open.value = typeof force === 'boolean' ? force : !open.value
  }
  function retry(): void {
    if (!game.connected.value) deps.toast(notConnected(game.link.value, 'open the community'), 'error')
    else void start()
  }
  function destroy(): void {
    epoch++
    const current = instance
    instance = null
    current?.destroy() // empties the member list for the game through onMembers
    state.value = null
    positions.value = {}
    lastRefusal = 0
  }

  // The room follows the life: arrival, a cancelled departure, a new city. The join puts the player back with voice off.
  game.on('accepted', (next, previous) => {
    if (next.location === 'home') open.value = false
    if (roomJoinNeeded(previous, next)) instance?.join(game.cityId.value, next.location)
  })
  watch(game.cityId, (city) => { instance?.join(city, game.state.value.location) })
  game.on('expired', destroy)
  game.on('session', (_session, created) => { if (created) destroy() })

  return {
    open: readonly(open), state, positions, load, recovery,
    running: computed(() => state.value !== null),
    start, ensure: start, toggle, close: () => { open.value = false }, retry,
    reload: () => (deps.reload ?? (() => globalThis.location.reload()))(),
    moveTo: (x, z) => instance?.moveTo(x, z) === true,
    controller: () => instance,
    destroy,
  }
}

let installed: CommunityStore | null = null
/** Create the page's store (once) from the shell's collaborators; see the header. */
export function installCommunity(deps: CommunityDeps): CommunityStore {
  installed ??= createCommunityStore(deps)
  return installed
}
/** The page's store. The shell installs it (installCommunity) before any component asks. */
export function useCommunity(): CommunityStore {
  if (!installed) throw new Error('The community store is not installed: call installCommunity(deps) when the application is created.')
  return installed
}
/** For tests: forget the installed store. */
export function resetCommunity(): void { installed?.destroy(); installed = null }
