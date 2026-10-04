// Contracts of the Three.js hosts, as the shell drives them. The hosts are still JavaScript and
// are fetched with a dynamic import, so Three.js stays out of the entry chunk.
import type { LifeState } from '../../types/life.ts'

/** The player's avatar in every scene: their saved look, seeded by the session's public id (never the cookie). */
export interface PlayerLook { look: unknown; seed: string; name: string }
export interface SceneTag { id: string; kind: 'npc' | 'player' | (string & {}); text?: string }
export interface SceneDiagnostics {
  /** Frames drawn since the host was created. Flat while nothing is happening. */
  renderCount: number
  loop?: { running: boolean; frames: number }
  [key: string]: unknown
}

/** What createVenueWorld() returns (src/venue-world.js). Every method draws at most one frame, and only when something changed. */
export interface VenueWorld {
  update(): void
  diagnostics(): SceneDiagnostics
  resize(): void
  /** How many CSS pixels of the canvas the HUD covers at the top and bottom. */
  /** `hint`: where the HUD rows under the top bar end, so the scene's one-time hint sits below them. */
  setInsets(insets: { top?: number; bottom?: number; hint?: number }): boolean
  setLocation(location: string): void
  setState(state: LifeState): void
  setPlayer(player: PlayerLook): void
  setCrowd(people: unknown[]): void
  zoom(...args: unknown[]): void
  recentre(): void
  walkTo(x: number, z: number): boolean
  dispose(): void
}
export interface VenueWorldOptions { location?: string; onTag?: (tag: SceneTag) => void; onSpot?: (spot: unknown) => void; onMove?: (at: unknown) => void }

/** What createCityView() returns (src/map3d/index.js). */
export interface CityView {
  /** false while the country map is the layer in front. */
  ready?: boolean
  setCity(id: string): void
  setState(state: LifeState): void
  setPlayer(player: PlayerLook): void
  /** Hidden, it draws nothing. */
  setShown(shown: boolean): void
  resize(): void
  /** Show the arrival for a moment, then call `done`. */
  arrive(done: () => void): void
  diagnostics(): SceneDiagnostics
  destroy(): void
}
export interface CityViewOptions {
  cityId?: string
  onSelectVenue?: (venueId: string) => void
  onSelectGov?: () => void
  onSelectNeighbour?: (player: { id: string; name: string }) => void
  /** The avatar reached the door: ask the server for the arrival now. */
  onTripDue?: () => void
  onNotice?: (text: string) => void
}
export interface WorldMap { setCity(id: string): void; resize(): void; /** Draw again: the list of cities the player holds changed. */ refresh?(): void }
export interface WorldMapOptions { onOpenCity?: () => void; onEnterCity?: (cityId: string) => void; held?: () => string[] }

export async function loadVenueWorld(): Promise<(container: HTMLElement, options?: VenueWorldOptions) => VenueWorld> {
  const module = await import('../../venue-world.ts')
  return module.createVenueWorld as unknown as (container: HTMLElement, options?: VenueWorldOptions) => VenueWorld
}
export async function loadMaps(): Promise<{ createCityView: (container: HTMLElement, options?: CityViewOptions) => CityView; createWorldMap: (container: HTMLElement, options?: WorldMapOptions) => WorldMap }> {
  const [city, world] = await Promise.all([import('../../map3d/index.js'), import('../../world-map.js')])
  return {
    createCityView: city.createCityView as unknown as (container: HTMLElement, options?: CityViewOptions) => CityView,
    createWorldMap: world.createWorldMap as unknown as (container: HTMLElement, options?: WorldMapOptions) => WorldMap,
  }
}
