// OWNER: scenes (unique places)
// Which level of detail of a place model a device gets, and which atlas. A pure decision from plain hints, so it is tested without a browser;
// placeDeviceHints() reads the hints from the real globals.
//
//   lod0 (up to 20,000 triangles, the 2048 atlas)   only on a device known to be strong: not in Light mode, not Save-Data, not a slow connection,
//                                                   and either a desktop-class render tier or a wide screen with >= 4 GB and >= 4 cores reported.
//   lod1 (up to 4,000 triangles, the 1024 atlas)    everything else, including every device that does not say what it is (iPhones report no
//                                                   memory): the PLAN's rule is "LOD1 is the default on unknown devices" until a real phone's
//                                                   frame time with LOD0 is measured (docs/agent-plans/unique-places/PLAN.md, open checks).
//
// The map icon is always lod2 and has no choice to make.
import { lightOn } from '../../lightMode.ts';
import { renderTier } from '../look.ts';

export type PlaceDetail = 'lod0' | 'lod1';
export interface PlaceDeviceHints {
  light: boolean
  saveData: boolean
  /** navigator.connection.effectiveType, when the browser says. */
  connection?: string | undefined
  /** The render tier of src/scene/look.ts. */
  tier: 'phone' | 'wide' | 'high'
  /** navigator.deviceMemory (GB) and hardwareConcurrency; undefined where the browser does not say. */
  memory?: number | undefined
  cores?: number | undefined
}

export const slowConnection = (connection: string | undefined): boolean => connection === 'slow-2g' || connection === '2g'

/** The venue scene's level of detail for these hints. */
export function chooseVenueDetail(hints: PlaceDeviceHints): PlaceDetail {
  if (hints.light || hints.saveData || slowConnection(hints.connection) || hints.connection === '3g') return 'lod1';
  if (hints.tier === 'high') return 'lod0';
  if (hints.tier === 'wide' && (hints.memory ?? 0) >= 4 && (hints.cores ?? 0) >= 4) return 'lod0';
  return 'lod1';
}
/** Whether the map icons and the neighbour warm-up may fetch at all: never in Light mode, with Save-Data or on 2G. */
export const mayFetchOptionalPlaces = (hints: Pick<PlaceDeviceHints, 'light' | 'saveData' | 'connection'>): boolean => !hints.light && !hints.saveData && !slowConnection(hints.connection);

interface NavigatorLike { deviceMemory?: number; hardwareConcurrency?: number; connection?: { saveData?: boolean; effectiveType?: string } }
export function placeDeviceHints(): PlaceDeviceHints {
  const nav = (globalThis as { navigator?: NavigatorLike }).navigator, connection = nav?.connection;
  return {
    light: lightOn(), saveData: connection?.saveData === true, connection: connection?.effectiveType, tier: renderTier().name,
    memory: typeof nav?.deviceMemory === 'number' ? nav.deviceMemory : undefined, cores: typeof nav?.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : undefined,
  };
}
