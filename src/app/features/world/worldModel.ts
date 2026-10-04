// The world panels without a DOM: the drawing of a house, the analytics event, the pages of the
// local-government directory and the requests behind them. Typed responses of every /api/world/*
// route are in src/types/world.ts (derived from server/routes/world.ts).
import { reactive } from 'vue'
import type { CityId } from '../../../types/protocol.ts'
import type { HouseStyle, HouseTierId, LgaId } from '../../../types/life.ts'
import type { WorldLgaResponse, WorldPeopleResponse, WorldPerson } from '../../../types/world.ts'
import type { ApiError, FetchJson } from '../../types/client.ts'
import { HOUSE_STYLE, HOUSE_TIERS } from './worldContent.ts'

export const count = (value: unknown): string => Number(value || 0).toLocaleString('en-NG')

/** Analytics, decoupled: whoever listens to 'jaw:track' records it. Never a name, never a coordinate. */
export function track(name: string, props: Record<string, unknown> = {}): void {
  try { window.dispatchEvent(new CustomEvent('jaw:track', { detail: { name, props } })) } catch { /* no window: nothing to tell */ }
}
/** The maps are told what they cached is stale. */
export function worldChanged(): void {
  try { window.dispatchEvent(new CustomEvent('jaw:world-changed')) } catch { /* no window */ }
}
/** Focus the map on a local government or a plot, once the map has had time to open. */
export function focusMap(detail: { lga: string } | { plot: { lga: string; estate: number; plot: number } }): void {
  setTimeout(() => window.dispatchEvent(new CustomEvent('jaw:map-focus', { detail })), 400)
}

// ---- the drawing of a house ------------------------------------------------------------------
export type HouseTop = { kind: 'rect'; x: number; y: number; width: number; height: number } | { kind: 'path'; d: string }
export type HouseYard = { kind: 'none' } | { kind: 'plant'; cy: number; r: number; fill: string } | { kind: 'block'; fill: string }
export interface HouseArtShape {
  label: string
  x: number; y: number; width: number; height: number
  wall: string; roof: string; door: string; windows: string
  top: HouseTop
  fence: string | null
  yard: HouseYard
  windowXs: [number, number]
  poles: { xs: [number, number, number]; top: number; rails: string } | null
}

/** A small drawing of a house from its style: the same few numbers the maps draw from. */
export function houseArtShape(style: HouseStyle, tier: HouseTierId = 'starter', scaffold = false): HouseArtShape {
  const rank = HOUSE_TIERS[tier]?.rank ?? 0
  const width = 70 + rank * 14, height = 40 + rank * 6 + (rank >= 3 ? 22 : 0), x = 110 - width / 2, y = 112 - height
  const hex = (field: keyof HouseStyle): string => HOUSE_STYLE[field][style[field]]?.hex ?? '#888'
  const shape = HOUSE_STYLE.shape[style.shape]?.id ?? 'gable'
  const roof = hex('roof')
  const top: HouseTop = shape === 'flat' ? { kind: 'rect', x: x - 4, y: y - 8, width: width + 8, height: 9 }
    : shape === 'twin' ? { kind: 'path', d: `M${x - 5} ${y}L${x + width * 0.25} ${y - 24}L${x + width * 0.5} ${y}L${x + width * 0.75} ${y - 24}L${x + width + 5} ${y}Z` }
      : shape === 'hip' ? { kind: 'path', d: `M${x - 6} ${y}L${x + width * 0.25} ${y - 24}H${x + width * 0.75}L${x + width + 6} ${y}Z` }
        : { kind: 'path', d: `M${x - 6} ${y}L110 ${y - 30}L${x + width + 6} ${y}Z` }
  const yardId = HOUSE_STYLE.yard[style.yard]?.id ?? 'none'
  const blocks: Record<string, string> = { tank: '#2f3b46', gen: '#c9423a', car: '#2b5fa8', kiosk: '#e8a13a' }
  const yard: HouseYard = yardId === 'none' ? { kind: 'none' }
    : yardId === 'flowers' || yardId === 'tree' || yardId === 'palm' ? { kind: 'plant', cy: yardId === 'flowers' ? 104 : 84, r: yardId === 'flowers' ? 7 : 14, fill: yardId === 'flowers' ? '#e86a8a' : '#3f8a57' }
      : { kind: 'block', fill: blocks[yardId] ?? '#888' }
  return {
    label: `${HOUSE_TIERS[tier]?.label ?? 'House'}${scaffold ? ', being upgraded' : ''}`,
    x, y, width, height, wall: hex('wall'), roof, door: hex('door'), windows: hex('windows'),
    top, fence: style.fence ? hex('fence') : null, yard,
    windowXs: [x + 10, x + width - 26],
    poles: scaffold ? { xs: [x - 8, x + width / 2, x + width + 8], top: y - 34, rails: `M${x - 8} ${y + 12}H${x + width + 8}M${x - 8} ${y - 18}H${x + width + 8}` } : null,
  }
}

// ---- the directory of one local government ---------------------------------------------------
export interface LgaPage {
  info: WorldLgaResponse | null
  /** Null while a page is on its way. */
  items: WorldPerson[] | null
  next: number | null
  q: string
  online: boolean
  loading: boolean
  error: string
  /** The search was shorter than the server's minimum. */
  short: boolean
}
export interface DirectoryDeps { fetchJson: FetchJson; cityId: () => CityId }

export const peoplePath = (id: string, city: string, query: { q: string; online: boolean; after: number | null }): string =>
  `/api/world/lga/${id}/people?city=${city}${query.q ? `&q=${encodeURIComponent(query.q)}` : ''}${query.online ? '&online=1' : ''}${query.after !== null ? `&after=${query.after}` : ''}`

/** One page per local government, kept for the page's lifetime: a search and a filter are still there when the sheet is reopened. */
export function createLgaDirectory(deps: DirectoryDeps) {
  const pages = new Map<string, LgaPage>()
  const pageOf = (id: string): LgaPage => {
    let page = pages.get(id)
    if (!page) { page = reactive<LgaPage>({ info: null, items: null, next: null, q: '', online: false, loading: false, error: '', short: false }); pages.set(id, page) }
    return page
  }

  /** The counts and the first page of residents; with `more`, the page after the last one. */
  async function load(id: string, more = false): Promise<void> {
    const page = pageOf(id), city = deps.cityId()
    if (page.loading) return
    page.loading = true
    page.error = ''
    try {
      if (!more) page.info = await deps.fetchJson<WorldLgaResponse>(`/api/world/lga/${id}?city=${city}`)
      const body = await deps.fetchJson<WorldPeopleResponse>(peoplePath(id, city, { q: page.q, online: page.online, after: more ? page.next : null }))
      page.items = more ? [...(page.items ?? []), ...body.items] : body.items
      page.next = body.next
      page.short = 'short' in body && body.short === true
    } catch (error) {
      page.error = (error as Partial<ApiError> | null)?.reason || 'The list could not be loaded. Try again.'
    } finally { page.loading = false }
  }
  /** Start again from the first page (a new search, the filter, a retry). */
  function restart(id: string): Promise<void> { pageOf(id).items = null; return load(id) }
  function search(id: string, q: string): Promise<void> { pageOf(id).q = q.trim(); return restart(id) }
  function toggleOnline(id: string): Promise<void> { const page = pageOf(id); page.online = !page.online; return restart(id) }
  return { pageOf, load, restart, search, toggleOnline }
}
export type LgaDirectory = ReturnType<typeof createLgaDirectory>

/** What the page says when a list has nobody in it. */
export const emptyPeopleText = (page: Pick<LgaPage, 'q' | 'online'>): string =>
  page.q ? 'Nobody listed by that name here.' : page.online ? 'Nobody listed here is online right now.' : 'Nobody is listed here yet.'

/** The house the map hands over when one is tapped (src/map3d/map3d.js onSelectHouse). */
export interface MapHouse { lga: LgaId; estate: number; plot: number; id: string | null; name: string | null; online: boolean; you: boolean; style: number; upgrading: boolean }
export function asMapHouse(value: unknown): MapHouse | null {
  if (typeof value !== 'object' || value === null) return null
  const house = value as Partial<MapHouse>
  if (typeof house.lga !== 'string' || typeof house.estate !== 'number' || typeof house.plot !== 'number') return null
  return { lga: house.lga, estate: house.estate, plot: house.plot, id: house.id ?? null, name: house.name ?? null, online: Boolean(house.online), you: Boolean(house.you), style: typeof house.style === 'number' ? house.style : 0, upgrading: Boolean(house.upgrading) }
}
/** The local government id a page was opened with. */
export function lgaParam(params: unknown): string | null {
  const id = (params as { lga?: unknown } | null | undefined)?.lga
  return typeof id === 'string' ? id : null
}
