// The browser-side state shared by the growth screens (Missions, Events, Bring a friend, Stay in
// touch, the away card, the share sheet, and the Tables app's share buttons), as one store.
//
//   const { state, share, load, call, track, … } = useGrowth()
//   state.hello    the last /api/growth/hello answer, or null
//   state.busy     the share kind being prepared (the pressed button says "Preparing…"), or null
//   state.sharing  the share shown in the share sheet: { facts, prepared } | null
//   state.error    why the last hello failed, or null
//   state.loading  a hello is on its way
//   state.landing  where the page's share link came from, once known
//
// It says hello when a growth screen is drawn and the last answer is older than five minutes —
// never from a timer — and prepares shares. The link a page was opened with is read in ONE place,
// the landing; nothing here reads the address. Pure decisions are in growthModel.ts.
//
// ON THIS DEVICE (localStorage)
//   allworld-device   a random token made once per browser (boundary.ts deviceToken)
//   allworld-away     the server time of the hello whose away card was dismissed
//
// Like the other stores: `createGrowth(deps)` is testable with fake deps (this file imports nothing
// of the application); `useGrowth()` (useGrowth.ts) is the one shared instance of the page. The
// share module is fetched the first time something is shared.
import { computed, ref, shallowReactive } from 'vue'
import type { ComputedRef } from 'vue'
import type { HelloResult, ShareKind, ShareResult } from '../../../types/growth.ts'
import type { FetchJson } from '../../types/client.ts'
import type { ToastKind } from '../../types/panel.ts'
import type { ShareModule } from './boundary.ts'
import { announceAge, channelHref, failureOf, growthReady, helloEvents, helloStale, isInvite, track } from './growthModel.ts'
import type { GrowthCall, HelloOk } from './growthModel.ts'
import type { LandingState, SharingState } from './growthTypes.ts'
import { surfaceOf } from './inviteModel.ts'

export { announceAge, track } from './growthModel.ts'
export type { GrowthCall, GrowthFailure, HelloOk } from './growthModel.ts'
export type { LandingState, SharingState } from './growthTypes.ts'

const AWAY_KEY = 'allworld-away'

export interface GrowthState {
  hello: HelloOk | null
  /** Client time of the last hello (0 = none). */
  at: number
  loading: boolean
  error: string | null
  sharing: SharingState | null
  busy: ShareKind | null
  landing: LandingState | null
}
const fresh = (): GrowthState => ({ hello: null, at: 0, loading: false, error: null, sharing: null, busy: null, landing: null })

/** What the second argument of share() may carry: the calendar event id, or a table id. */
export interface ShareExtra { event?: string; table?: string; /** Where the share was started from (telemetry only; never sent to the server). */ surface?: string }

export interface GrowthDeps {
  fetchJson: FetchJson
  /** The view's connection and onboarding flags, and the city every POST names. */
  view(): { cityId: string; connected: boolean; onboarding?: { required?: boolean } | null }
  command(type: 'missions.refresh'): Promise<unknown>
  toast(text: string, kind?: ToastKind): void
  open(id: string): unknown
  now(): number
  storage: Pick<Storage, 'getItem' | 'setItem'> | null
  deviceToken(): string
  loadShare(): Promise<ShareModule>
  origin(): string
  revokeUrl(url: string): void
  /** Calls `listener` whenever the device session changes ('jaw:session'). */
  onSessionChange(listener: () => void): () => void
}

export function createGrowth(deps: GrowthDeps) {
  const state = shallowReactive<GrowthState>(fresh())
  /** Bumped when the away card is dismissed, so what reads storage is computed again. */
  const awayVersion = ref(0)

  function storedAway(): unknown {
    try { return JSON.parse(deps.storage?.getItem(AWAY_KEY) ?? 'null') } catch { return null }
  }

  /** One POST (a GET with no body). Never throws: a failure comes back as { ok: false, code, reason }. */
  async function call<R extends { ok: boolean }>(path: string, body?: Record<string, unknown>): Promise<GrowthCall<R>> {
    try { return await deps.fetchJson<R>(path, body ? { method: 'POST', body: { cityId: deps.view().cityId, ...body } } : undefined) } catch (error) { return failureOf(error) }
  }

  /** Say hello unless a fresh answer is here. Called when a screen is drawn, never from a timer. */
  async function load(options: { force?: boolean } = {}): Promise<void> {
    if (state.loading || !growthReady(deps.view())) return
    if (!options.force && !helloStale(state.at, deps.now())) return
    state.loading = true
    const result = await call<HelloResult>('/api/growth/hello', { device: deps.deviceToken() })
    state.loading = false
    state.at = deps.now()
    if (result.ok) {
      for (const name of helloEvents(result, state.hello)) track(name)
      state.hello = result
      state.error = null
      announceAge(result.consent?.age)
      if (result.state) void deps.command('missions.refresh')
    } else state.error = result.reason
  }

  /** Make a share link, paint the card and open the share sheet panel. */
  async function share(kind: ShareKind, extra: ShareExtra = {}): Promise<void> {
    const { surface, ...asked } = extra
    if (state.busy) return
    if (!growthReady(deps.view())) { deps.toast('Sharing needs a connection to the server.', 'error'); return }
    state.busy = kind
    const made = await call<ShareResult>('/api/growth/share', { kind, ...asked })
    if (!made.ok) { state.busy = null; deps.toast(made.reason || 'That could not be shared.', 'error'); return }
    let prepared
    try { prepared = await (await deps.loadShare()).prepareShare(made.share.facts, `${deps.origin()}${made.share.path}`) } catch { state.busy = null; deps.toast('That could not be shared.', 'error'); return }
    if (state.sharing?.prepared.url) deps.revokeUrl(state.sharing.prepared.url)
    state.sharing = { facts: made.share.facts, prepared, surface: surfaceOf(surface) }
    track('share_card_created', { kind })
    track('share_opened', { surface: surfaceOf(surface) })
    if (isInvite(kind)) track('invite_created')
    state.busy = null
    deps.open('share-sheet')
  }
  /** The share sheet's own buttons. */
  async function shareNow(): Promise<void> {
    const current = state.sharing
    if (!current) return
    const outcome = await (await deps.loadShare()).systemShare(current.prepared)
    void call('/api/growth/client', { signals: [outcome === 'unavailable' ? 'share-fallback' : 'share-sheet'] })
    if (outcome === 'unavailable') deps.toast('This browser has no share sheet. Use WhatsApp, X or Copy below.', 'info')
  }
  /** Copy the link alone (the invite sheet's Copy link). */
  async function copyLink(): Promise<void> {
    const current = state.sharing
    if (!current) return
    const copied = await (await deps.loadShare()).copyText(current.prepared.link)
    deps.toast(copied ? 'Link copied. Paste it into any chat.' : 'Could not copy. Press and hold the link to copy it yourself.', copied ? 'good' : 'error')
  }
  async function copyShare(): Promise<void> {
    const current = state.sharing
    if (!current) return
    const copied = await (await deps.loadShare()).copyText(current.prepared.text)
    deps.toast(copied ? 'Copied. Paste it into any chat.' : 'Could not copy. Press and hold the text to copy it yourself.', copied ? 'good' : 'error')
  }

  /** The WhatsApp Channel link, only when the server says one is configured and it is https; else ''. */
  const channel: ComputedRef<string> = computed(() => channelHref(state.hello?.channel))

  /** Was this hello's away card dismissed on this device? */
  const awayDismissed: ComputedRef<boolean> = computed(() => { void awayVersion.value; return Boolean(state.hello) && storedAway() === state.hello?.away.since })
  function dismissAway(): void {
    if (state.hello) { try { deps.storage?.setItem(AWAY_KEY, JSON.stringify(state.hello.away.since)) } catch { /* this visit only */ } }
    awayVersion.value += 1
  }

  /** The device session changed: what was loaded belonged to the previous identity. */
  function reset(): void {
    if (state.sharing?.prepared.url) deps.revokeUrl(state.sharing.prepared.url)
    Object.assign(state, fresh())
  }
  const stopListening = deps.onSessionChange(reset)

  // Replies that change what a screen holds go through here, so the stored copy is replaced, never mutated.
  function setConsent(consent: NonNullable<HelloOk['consent']>): void { if (state.hello) state.hello = { ...state.hello, consent } }

  return { state, call, load, share, shareNow, copyShare, copyLink, channel, awayDismissed, dismissAway, setConsent, reset, track, announceAge, dispose: stopListening }
}
export type Growth = ReturnType<typeof createGrowth>

