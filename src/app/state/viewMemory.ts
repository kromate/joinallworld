// Where the player was looking, kept so that a reload puts the screen back the way it was. The PLACE is the server's
// (the life's location, a running trip); this only remembers the VIEW: scene or map (and which map layer, which
// place was picked, how far the camera was), and which phone app or Sim tab was open. It is a record per device
// session (sessionStorage) with a small copy per player (localStorage) for a new tab of the same player.
//
// decideView() is the whole decision, pure: the saved record and what the server says about the life in, the view
// to start with out. A record that names a place the player is no longer in, or another life, is ignored.

export type SavedSheet = { kind: 'phone' } | { kind: 'panel'; id: string } | { kind: 'sim'; tab: string }
export type SavedCamera =
  | { kind: '3d'; x: number; z: number; yaw: number; pitch: number; distance: number }
  | { kind: '2d'; scale: number; x: number; y: number }
export interface SavedView {
  v: 1
  /** `${session id}:${city}`: the life this view belongs to. */
  who: string
  /** The venue the player stood in when this was kept. */
  at: string
  mode: string
  layer: 'city' | 'world'
  destination: string | null
  sheet: SavedSheet | null
  camera: SavedCamera | null
}
/** What the server says about the life, and what this build knows how to open. */
export interface LifeFacts {
  who: string
  location: string
  /** A trip is running (the map is where it is shown). */
  trip: boolean
  /** Is this view something the shell may open now (a nav panel exists and is enabled)? 'venue' is always allowed. */
  allowsMode: (mode: string) => boolean
  /** Is this sheet something the shell may open again? */
  allowsSheet: (sheet: SavedSheet) => boolean
}
export interface InitialView {
  mode: string
  layer: 'city' | 'world'
  destination: string | null
  sheet: SavedSheet | null
  camera: SavedCamera | null
  /** True when something of the saved view was used. */
  restored: boolean
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const text = (value: unknown, max = 60): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && /^[\w:.-]+$/.test(value)

function cameraOf(value: unknown): SavedCamera | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if (item.kind === '3d' && finite(item.x) && finite(item.z) && finite(item.yaw) && finite(item.pitch) && finite(item.distance) && item.distance > 0) return { kind: '3d', x: item.x, z: item.z, yaw: item.yaw, pitch: item.pitch, distance: item.distance }
  if (item.kind === '2d' && finite(item.scale) && finite(item.x) && finite(item.y) && item.scale > 0) return { kind: '2d', scale: item.scale, x: item.x, y: item.y }
  return null
}
function sheetOf(value: unknown): SavedSheet | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if (item.kind === 'phone') return { kind: 'phone' }
  if (item.kind === 'panel' && text(item.id)) return { kind: 'panel', id: item.id }
  if (item.kind === 'sim' && text(item.tab)) return { kind: 'sim', tab: item.tab }
  return null
}
/** A stored record, checked part by part (it is untrusted), or null. */
export function savedViewFrom(value: unknown): SavedView | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if (item.v !== 1 || typeof item.who !== 'string' || !text(item.at) || !text(item.mode)) return null
  return { v: 1, who: item.who, at: item.at, mode: item.mode, layer: item.layer === 'world' ? 'world' : 'city', destination: text(item.destination) ? item.destination : null, sheet: sheetOf(item.sheet), camera: cameraOf(item.camera) }
}

/** The view to start with. */
export function decideView(saved: unknown, facts: LifeFacts): InitialView {
  const none: InitialView = { mode: facts.trip ? 'map' : 'venue', layer: 'city', destination: null, sheet: null, camera: null, restored: false }
  const view = savedViewFrom(saved)
  if (!view || view.who !== facts.who) return none
  // A trip is shown on the map, wherever the player was looking when it set off.
  if (facts.trip) return { ...none, destination: view.mode === 'map' ? view.destination : null, restored: view.mode === 'map' }
  // The player is somewhere else now (an arrival happened while the page was closed): the venue they are in is the view.
  if (view.at !== facts.location) return none
  const mode = view.mode === 'venue' || facts.allowsMode(view.mode) ? view.mode : 'venue'
  const sheet = view.sheet && facts.allowsSheet(view.sheet) ? view.sheet : null
  return { mode, layer: mode === 'map' ? view.layer : 'city', destination: mode === 'map' ? view.destination : null, sheet, camera: mode === 'map' ? view.camera : null, restored: mode !== 'venue' || sheet !== null }
}

// ---- storage ---------------------------------------------------------------------------------------------------
const TAB_KEY = 'joinallworld-view'
const PLAYER_KEY = 'joinallworld-view:'
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null | undefined
const read = (store: Store, key: string): unknown => { try { return JSON.parse(store?.getItem(key) ?? 'null') } catch { return null } }

/** The record for this life: this tab's first, then the one kept for the player (a new tab). */
export function loadView(who: string, tab: Store, device: Store): unknown {
  const own = savedViewFrom(read(tab, TAB_KEY))
  if (own && own.who === who) return own
  const shared = savedViewFrom(read(device, PLAYER_KEY + who))
  return shared && shared.who === who ? shared : null
}
export function keepView(view: SavedView, tab: Store, device: Store): void {
  try { tab?.setItem(TAB_KEY, JSON.stringify(view)) } catch { /* kept for nothing: the view is a convenience */ }
  try { device?.setItem(PLAYER_KEY + view.who, JSON.stringify(view)) } catch { /* the same */ }
}
/** Forget every saved view (sign-out, a new life): this tab's and the player's. */
export function forgetViews(tab: Store, device: Store, who?: string | null): void {
  try { tab?.removeItem(TAB_KEY) } catch { /* nothing to forget */ }
  try { if (who) device?.removeItem(PLAYER_KEY + who) } catch { /* nothing to forget */ }
}
