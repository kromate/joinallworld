// Getting around without a DOM: the one place that decides what a trip costs, why Go is off, what
// the trip bar says, which places the Map lists and what each Ride row offers. It is the typed
// port of src/ui/panels/world-ui.js (the helpers the Map card and the Ride app shared, so the two
// can never disagree about a fare, a trip time or why a trip is refused) plus the pure parts of
// map.js, ride.js and the roadside prompt. Everything is derived from view.travel
// (src/game/systems/travel.js). The words for "why Go is off" come from the connection table
// (src/ui/link.js), so a trip is never refused as "offline" when the server is merely unreachable.
import { VENUE_CATEGORIES } from '../../../game/content/venues.ts'
import type { LifeState } from '../../../types/life.ts'
import type { AdsResponse, GovResponse } from '../../../types/civic.ts'
import type { LifeView, RoadsideChoiceCard, TravelDestination, TravelModeCard } from '../../../types/view.ts'
import type { PanelView } from '../../types/panel.ts'
import { cap, money } from '../../ui/format.ts'
import { linkWords } from './travelBoundary.ts'
import type { LinkAction } from './travelBoundary.ts'

/** What the panels read of the page's view. */
export type TravelPanelView = Pick<PanelView, 'connected' | 'link' | 'session'> & Pick<LifeView, 'travel' | 'activities'> & { health?: Pick<LifeView['health'], 'weather'> | null }
type TravelState = Pick<LifeState, 'cash' | 'location' | 'activeAction'>

/** What follows "…, so the trip cannot start." for each connection state: the way out, truthfully. */
const LINK_NEXT: Readonly<Record<string, string>> = {
  offline: 'Reconnect and Go will work again — nothing changes until then.',
  unreachable: 'Your life is safe there. Reconnect and Go will work again.',
  expired: 'Start a new life, or try again.',
  new: 'Choose a nickname to start a session on this device, then travel.',
  connecting: 'Go will work in a moment.',
}

export const signed = (amount: number): string => (amount > 0 ? `+${amount}` : `−${-amount}`)
export const needsLine = (needs: Readonly<Record<string, number | undefined>> | null | undefined): string =>
  Object.entries(needs ?? {}).filter((pair): pair is [string, number] => typeof pair[1] === 'number').map(([need, amount]) => `${signed(amount)} ${cap(need)}`).join(', ')
export const fareText = (mode: { fare?: number | null }): string => (mode.fare ? money(mode.fare) : 'Free')

/** One-line summary of a trip: "Danfo · about 8s · −2 Hygiene, −2 Fun". */
export function tripLine(mode: Pick<TravelModeCard, 'label' | 'seconds' | 'needs'> & Partial<Pick<TravelModeCard, 'xp' | 'fuel'>>): string {
  const parts = [mode.label, `about ${mode.seconds}s`]
  const costs = needsLine(mode.needs)
  if (costs) parts.push(costs)
  for (const [skill, amount] of Object.entries(mode.xp ?? {})) parts.push(`+${amount} ${cap(skill)} XP`)
  if (mode.fuel) parts.push('fuel only')
  return parts.join(' · ')
}

/** Pick the mode to show as selected: the wanted one if this trip offers it, else Danfo, else the first. */
export function chosenMode(destination: Pick<TravelDestination, 'modes'> | null | undefined, wanted: string | null | undefined, fallback = 'danfo'): TravelModeCard | null {
  const modes = destination?.modes ?? []
  return modes.find((mode) => mode.id === wanted) ?? modes.find((mode) => mode.id === fallback) ?? modes[0] ?? null
}

/**
 * The one-tap way out of a refusal:
 *   reconnect  not connected: the action of that connection state (try again when the device is offline or the
 *              server does not answer, the session panel when there is no life yet or the saved one is gone)
 *   cancel     busy: cancel what is running
 *   mode       not enough cash: go on foot, which is free
 *   enter      already there: go inside
 */
export type Fix =
  | { kind: 'reconnect'; label: string; action: LinkAction }
  | { kind: 'cancel'; label: string }
  | { kind: 'mode'; mode: string; label: string }
  | { kind: 'enter'; label: string }

/** Why Go is disabled. `label` is short enough for the button; `reason` is the full sentence beside it and always says what to do about it. */
export interface GoBlock { code: string; label: string; reason: string; link?: string; fix?: Fix | null }

/** Why Go is disabled, or null when the trip can start. */
export function goBlock(state: TravelState, view: TravelPanelView, destination: TravelDestination, mode: TravelModeCard | null): GoBlock | null {
  if (!view.connected) {
    // `code` stays 'offline' (it is a code, not wording); the words say which of the five states this really is.
    // A host that reports no `link` and has no session is a device with no life yet ('new'), not an unreachable server.
    const words = linkWords(!view.link && view.session === null ? 'new' : view)
    if (!words) return null
    const waiting = words.state === 'new' || words.state === 'connecting'
    const next = LINK_NEXT[words.state] ?? ''
    return {
      code: 'offline', link: words.state, label: words.short, fix: words.action ? { kind: 'reconnect', label: words.action.label, action: words.action } : null,
      reason: waiting ? `${words.why} ${next}` : `${words.why.replace(/\.$/, '')}, so the trip cannot start. ${next}`,
    }
  }
  const blocked = destination.blocked ?? mode?.blocked
  if (blocked) {
    if (blocked.code === 'closed') return { code: 'closed', label: destination.status, reason: `${blocked.reason} Pick somewhere that is open now, or come back then.` }
    if (blocked.code === 'already_here') return { code: 'already_here', label: 'You are here', reason: 'You are already here.', fix: { kind: 'enter', label: 'Go inside' } }
    if (blocked.code === 'coming_soon') return { code: 'coming_soon', label: 'Coming soon', reason: `${blocked.reason} There is nothing to do there yet.` }
    if (blocked.code === 'insufficient_funds') {
      const short = Math.max(0, (mode?.fare || 0) - (Number(state.cash) || 0))
      const trek = destination.modes.find((option) => option.id === 'trek' && !option.blocked)
      return {
        code: 'insufficient_funds', label: `Not enough cash · ${mode ? fareText(mode) : ''}`, fix: trek && mode?.id !== 'trek' ? { kind: 'mode', mode: 'trek', label: `Trek instead · Free · ${trek.seconds}s` } : null,
        reason: `${mode?.label ?? ''} costs ${money(mode?.fare)} and you have ${money(state.cash)} — you are ${money(short)} short.${trek ? ' Trekking is free, or earn a little first.' : ''}`,
      }
    }
    return { code: blocked.code || 'unavailable', label: 'Unavailable', reason: blocked.reason }
  }
  const active = state.activeAction
  if (active) {
    const trip = active.kind === 'travel' || active.kind === 'commute'
    const name = trip ? view.travel?.destinations?.find((item) => item.id === active.id)?.label : view.activities?.active?.label
    const locked = !trip && Boolean(view.activities?.active) && view.activities?.active?.cancellable === false
    return {
      code: trip ? 'travelling' : 'busy', label: trip ? 'Already travelling' : 'Busy',
      fix: locked ? null : { kind: 'cancel', label: trip ? 'Cancel that trip' : `Cancel ${name || 'it'}` },
      reason: trip ? `You are already on the way${name ? ` to ${name}` : ''}. Arrive first, or cancel that trip (its fare is not refunded) and then travel here.`
        : `You are busy${name ? `: ${name}` : ''} (${Math.ceil(active.remaining ?? 0)}s left). ${locked ? 'It cannot be cancelled — wait for it to finish, then travel.' : 'Wait for it to finish, or cancel it and then travel.'}`,
    }
  }
  if (!mode) return { code: 'unavailable', label: 'Unavailable', reason: 'No way of travelling there is available right now.' }
  return null
}

/** A way of travelling as the trip bar names it (a travel mode, the commute, your own car). */
export interface TripMode { id: string; label: string; icon?: string | null }
export interface TripInfo {
  from: { id: string; label: string }
  to: { id: string; label: string }
  mode: TripMode
  fare: number | null
  commute: boolean
  remaining: number
  duration: number
  fraction: number
  rule: string
}

/**
 * The trip in progress, for the trip bar, or null. Everything is the server's: where it started, how,
 * what was paid and how long is left.
 */
export function tripInfo(state: TravelState, view: Pick<TravelPanelView, 'travel'>): TripInfo | null {
  const active = state.activeAction
  if (!active || (active.kind !== 'travel' && active.kind !== 'commute')) return null
  const commute = active.kind === 'commute'
  const trip = commute ? null : view.travel?.active
  const place = (id: string): { id: string; label: string } => view.travel?.destinations?.find((item) => item.id === id) ?? { id, label: id }
  const from = place(trip?.from ?? state.location), to = place(active.id)
  const wanted = active.kind === 'travel' ? active.mode : undefined
  const mode: TripMode = commute ? { id: 'commute', label: 'Commute to work' }
    : view.travel?.modes?.find((item) => item.id === wanted) ?? (wanted === 'car' ? { id: 'car', label: 'Your car' } : { id: 'unknown', label: 'On the way' })
  const fare = Number.isFinite(trip?.fare) ? trip?.fare ?? null : null
  const rule = commute ? `Cancel to stay at ${from.label}. Nothing was charged for the commute.`
    : fare === null ? `Cancel to stay at ${from.label}. A fare already paid is not refunded.`
      : fare > 0 ? `Cancel to stay at ${from.label}. The ${money(fare)} ${wanted === 'car' ? 'fuel' : 'fare'} you paid is not refunded.` : `Cancel to stay at ${from.label}. This trip was free, so nothing is lost.`
  const duration = active.duration || 1, remaining = Math.max(0, active.remaining ?? 0)
  return { from, to, mode, fare, commute, remaining, duration, fraction: Math.max(0, Math.min(1, 1 - remaining / duration)), rule }
}
/** "· ₦200 paid" / " · Free" / '' after the way of travelling on the trip bar. */
export const paidText = (trip: Pick<TripInfo, 'fare'>): string => (trip.fare === null ? '' : trip.fare > 0 ? ` · ${fareText({ fare: trip.fare })} paid` : ' · Free')

export const statusClass = (destination: Pick<TravelDestination, 'kind' | 'open'>): 'is-soon' | 'is-open' | 'is-closed' => (destination.kind === 'soon' ? 'is-soon' : destination.open ? 'is-open' : 'is-closed')

// ---- the Map ------------------------------------------------------------------------------------

export interface MapFilter { id: string; label: string }
export const FILTERS: readonly MapFilter[] = [{ id: 'all', label: 'All' }, { id: 'open', label: 'Open now' }, ...Object.values(VENUE_CATEGORIES)]
/** How many "things to do" chips the venue card shows before "+N more". */
export const CHIP_LIMIT = 9

export type LayerId = 'lgas' | 'homes' | 'moving' | 'billboards' | 'sea' | 'gov'
export interface MapLayer {
  id: LayerId
  label: string
  icon: string
  /** A layer without data says what it is. */
  note?: string
  /** A data layer: which response it draws from ('ads' | 'gov'), and the panel and tab that manage it. */
  key?: 'ads' | 'gov'
  path?: 'ads' | 'gov'
  open?: string
  params?: { tab: string }
  action?: string
}
export const LAYERS: readonly MapLayer[] = [
  // The world layer: on from the start. The maps load only what is in view (src/map3d/world-data.js).
  { id: 'lgas', label: 'LGAs', icon: 'map' },
  { id: 'homes', label: 'Homes', icon: 'houses' },
  { id: 'moving', label: 'Moving', icon: 'bus', note: 'Street traffic — decoration only, it changes nothing in the game.' },
  { id: 'billboards', label: 'Billboards', icon: 'megaphone', key: 'ads', path: 'ads', open: 'ads', params: { tab: 'billboard' }, action: 'Rent a billboard' },
  { id: 'sea', label: 'Sea', icon: 'wave', key: 'ads', path: 'ads', open: 'ads', params: { tab: 'sea' }, action: 'Rent a sea plot' },
  { id: 'gov', label: 'Gov', icon: 'governor', key: 'gov', path: 'gov', open: 'state-house', action: 'Open the State House' },
]
export const DATA_LAYERS: readonly MapLayer[] = LAYERS.filter((item) => item.path)
export type LayerState = Record<LayerId, boolean>
export const initialLayers = (): LayerState => ({ lgas: true, homes: true, moving: false, billboards: false, sea: false, gov: false })

/** Does this place pass the filter? Coming-soon places never do. */
export const matchesFilter = (item: Pick<TravelDestination, 'kind' | 'open' | 'category'>, filter: string): boolean =>
  item.kind !== 'soon' && (filter === 'all' || (filter === 'open' ? item.open : item.category === filter || item.kind === 'home'))

/** The line under the map's name: the weather and how many places are open, or where the trip is going. */
export function overviewLine(destinations: readonly TravelDestination[], trip: Pick<TravelDestination, 'label'> | null, weatherLabel: string | null): string {
  const all = destinations.filter((item) => item.kind !== 'soon')
  return trip ? `On the way to ${trip.label}…` : `${weatherLabel ? `${weatherLabel} · ` : ''}${all.filter((item) => item.open).length} of ${all.length} places open`
}

/** What a data layer's cache holds. */
export interface LayerData { data: AdsResponse | GovResponse | null; error: string | null }
/** A line under the layer toggles: what the layer shows, or why it cannot, and the button to manage it. */
export interface LayerNote {
  text: string
  /** Offer the one-tap way out of a connection problem. */
  reconnect: boolean
  action: { label: string; open: string; params: { tab: string } | null } | null
}
export function layerNote(item: MapLayer, cached: LayerData, connected: boolean, why: string): LayerNote | null {
  if (!item.path) return item.note ? { text: item.note, reconnect: false, action: null } : null
  const data = cached.data
  if (!data && !connected) return { text: `${why} This layer cannot be loaded right now.`, reconnect: true, action: null }
  const action = item.open && item.action ? { label: item.action, open: item.open, params: item.params ?? null } : null
  if (!data) return { text: cached.error ? `Could not load: ${cached.error}` : 'Loading…', reconnect: false, action }
  const text = item.id === 'billboards' && 'billboards' in data ? `${data.billboards.slots.filter((slot) => slot.ad).length} of ${data.billboards.slots.length} billboards rented`
    : item.id === 'sea' && 'sea' in data ? `${data.sea.plots.length} sea plot${data.sea.plots.length === 1 ? '' : 's'} rented · shown in the water below the city`
      : 'governor' in data ? (data.governor ? `Governor ${data.governor.name}` : 'No Governor yet') : ''
  return { text, reconnect: false, action }
}

/** What the Map tells the city map ('jaw:map-ui'). */
export interface MapUiDetail {
  layer?: string
  filter?: string
  selected?: string | null
  layers?: Partial<LayerState>
  ads?: AdsResponse | null
  gov?: GovResponse | null
  layout?: boolean
}
/** The shape the panel was last drawn in: when it changes, the map re-fits around it. */
export const layoutKey = (parts: { layer: string; destination: string | null; listOpen: boolean; layersOn: number; tripping: boolean }): string =>
  `${parts.layer}|${parts.destination ?? ''}|${parts.listOpen}|${parts.layersOn}|${parts.tripping}`

/** The link "Copy a link to this place" puts on the clipboard. */
export const venueLink = (origin: string, pathname: string, venueId: string): string => `${origin}${pathname}?venue=${encodeURIComponent(venueId)}`

/** The params the Map is opened with: a place, or a layer. */
export interface MapParams { destination?: string | null; layer?: string }
export const asMapParams = (value: unknown): MapParams | null => (typeof value === 'object' && value !== null ? value as MapParams : null)

// ---- the roadside prompt ------------------------------------------------------------------------

/** "Pay the fixer · ₦200": the cost is added unless the label already says it. */
export const choiceTitle = (choice: Pick<RoadsideChoiceCard, 'label' | 'cost'>): string =>
  `${choice.label}${choice.cost && !choice.label.includes(fareText({ fare: choice.cost })) ? ` · ${fareText({ fare: choice.cost })}` : ''}`
export const choiceHint = (choice: Pick<RoadsideChoiceCard, 'hint' | 'chance'>): string => `${choice.hint || ''}${choice.chance !== null ? ` · ${choice.chance}% chance` : ''}`
/** ", or in about 3 min" when the event lapses by itself. */
export const expiryText = (expiresIn: number | null | undefined): string => (expiresIn ? `, or in about ${Math.max(1, Math.ceil(expiresIn / 60))} min` : '')

// ---- the Ride app -------------------------------------------------------------------------------

/** What stops every trip alike is said once, above the list. */
export const EVERYWHERE: readonly string[] = ['offline', 'travelling', 'busy']

/** Places you can ride to: homes first, then open ones, then by name. */
export function ridePlaces(destinations: readonly TravelDestination[]): TravelDestination[] {
  return destinations.filter((item) => item.kind !== 'soon' && !item.here)
    .sort((a, b) => Number(b.kind === 'home') - Number(a.kind === 'home') || Number(b.open) - Number(a.open) || a.label.localeCompare(b.label))
}
/** The mode picked once for every row: the wanted one if the first place offers it, else the default, else the first. */
export function pickedMode(places: readonly TravelDestination[], wanted: string | null, defaultMode: string): TravelModeCard | undefined {
  const modes = places[0]?.modes ?? []
  return modes.find((mode) => mode.id === wanted) ?? modes.find((mode) => mode.id === defaultMode) ?? modes[0]
}

export interface RideRow {
  place: TravelDestination
  mode: TravelModeCard | null
  block: GoBlock | null
  /** A reason that belongs to this row alone (not one that stops every trip). */
  own: GoBlock | null
}
export function rideRows(state: TravelState, view: TravelPanelView, places: readonly TravelDestination[], picked: TravelModeCard | undefined): { rows: RideRow[]; notice: GoBlock | null } {
  const fallback = view.travel.defaultMode
  const rows = places.map((place): RideRow => {
    const mode = chosenMode(place, picked?.id, fallback)
    const block = goBlock(state, view, place, mode)
    return { place, mode, block, own: block && !EVERYWHERE.includes(block.code) ? block : null }
  })
  const notice = rows.map((row) => row.block).find((block): block is GoBlock => Boolean(block) && EVERYWHERE.includes(block?.code ?? '')) ?? null
  return { rows, notice }
}
/** The rules the Ride app folds away. */
export const rideRules = (modes: readonly Pick<TravelModeCard, 'label' | 'blurb'>[]): string[] => [
  'Pick how to travel once, then tap Go beside any place. The fare and the trip time are on each row.',
  'The fare is charged when you set off, and a cancelled trip is not refunded.',
  'You will see the trip on the city map, like every other trip.',
  ...modes.filter((mode) => mode.blurb).map((mode) => `${mode.label}: ${mode.blurb}`),
]
