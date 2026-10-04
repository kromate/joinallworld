// The typed boundary to the JavaScript rules engine and client model: the parts with no DOM, so
// the store built on them (state/game.ts) runs under `node --test`. Every cast for these modules
// is here. When a module is converted to TypeScript its lines are deleted and its importers point
// at the real file. The browser-only modules (panels, icons, keys) are in ./modules.ts.
import { createClient as createClientJs, CITIES as CITIES_JS, TEXT as TEXT_JS, roomJoinNeeded as roomJoinNeededJs } from '../../client.ts'
import { viewLife as viewLifeJs, isDeparting as isDepartingJs, VENUES as VENUES_JS } from '../../life.ts'
import { venueLabel as venueLabelJs, venueDistrict as venueDistrictJs } from '../../game/content/venues.ts'
import { NPCS as NPCS_JS } from '../../game/content/npcs.ts'
import { createLazyLoader as createLazyLoaderJs } from '../../lazy-load.ts'
import type { LifeState } from '../../types/life.ts'
import type { LifeView } from '../../types/view.ts'
import type { CityId } from '../../types/protocol.ts'
import type { City, ClientOptions, GameClient } from '../types/client.ts'

// ---- client model and engine ---------------------------------------------------------------
export const createClient = createClientJs as unknown as (options?: ClientOptions) => GameClient
export const CITIES = CITIES_JS as unknown as Readonly<Record<CityId, City>>
export const CLIENT_TEXT = TEXT_JS as unknown as Readonly<{ connectionLost: string; offlinePaused: string; outOfSync: string; notSaving: string; cityNote: (cityName: string) => string }>
/** On arrival somewhere new, and when a departure was cancelled. Join only: nothing here turns voice on. */
export const roomJoinNeeded = roomJoinNeededJs as unknown as (previous: LifeState, next: LifeState) => boolean
export const viewLife = viewLifeJs as unknown as (state: LifeState, ctx?: { now?: number; cityId?: string }) => LifeView
/** True while the life's timed action is one that moves the player (a trip, the commute). */
export const isDeparting = isDepartingJs as unknown as (state: LifeState | null | undefined) => boolean
export interface VenueContent { id: string; label: string; district: string; icon?: string; description?: string }
export const VENUES = VENUES_JS as unknown as Readonly<Record<string, VenueContent>>
export const venueLabel = venueLabelJs as unknown as (venueId: string, cityId: string) => string
export const venueDistrict = venueDistrictJs as unknown as (venueId: string, cityId: string) => string
export interface NpcContent { id: string; name: string; venue: string; [key: string]: unknown }
export const NPCS = NPCS_JS as unknown as Readonly<Record<string, NpcContent>>

// ---- lazy chunks ---------------------------------------------------------------------------
export interface LazyState { status: 'idle' | 'loading' | 'ready' | 'retrying' | 'failed'; attempt: number; attempts: number; retryInMs: number | null; error: string | null }
export interface LazyLoader<T> { state: LazyState; readonly value: T | undefined; load(): Promise<T | null>; stop(): void }
export const createLazyLoader = createLazyLoaderJs as unknown as <T>(load: () => Promise<T>, options?: { delays?: readonly number[]; onState?: (state: LazyState) => void }) => LazyLoader<T>
