// Contracts of the Three.js hosts, as the shell drives them. The hosts are TypeScript modules
// fetched with a dynamic import (scene/loaders.ts), so Three.js stays out of the entry chunk; the
// types are re-exported here so the shell's state can name them without importing the hosts.
export type { PlayerLook, SceneTag, SceneDiagnostics, VenueWorld, VenueWorldOptions } from '../../venue-world.ts'
export type { CityView, CityViewOptions } from '../../map3d/index.ts'
export type { WorldMap, WorldMapOptions } from '../../world-map.ts'
import type { VenueWorld, VenueWorldOptions } from '../../venue-world.ts'

/** What the campus world adapter (src/campus/unilag/world-adapter) adds to the venue host's API: one scene API over two hosts. */
export interface SceneWorld extends VenueWorld {
  /** Which host is drawing: 'venue', 'campus', or null while the campus is on its way. */
  readonly host: 'venue' | 'campus' | null
  /** Walk to a landmark and then select it. Only the campus walks first; anywhere else it answers { ok: false, code: 'not_walkable' }. */
  walkToSpot(id: string): Promise<{ ok: boolean; code?: string; reason?: string }>
}
export interface SceneWorldOptions extends VenueWorldOptions {
  /** The campus host calls this once the avatar reached the landmark it was sent to: the ordinary `spot` action. */
  commitSpot?: (spot: { id: string }) => Promise<unknown>
  /** Server time, for the campus shuttle. */
  now?: () => number
  /** The campus host came up (or went): measure the HUD again and repeat the avatar's place. */
  onHost?: () => void
}
