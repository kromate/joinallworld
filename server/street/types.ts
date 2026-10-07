import type { RouteContext } from '../types.ts'
import type { PlotAddress } from '../../src/types/life.ts'
import type { MetrePoint, StreetDoor, TileCoord } from '../../src/street/types.ts'
import type { NormalizedGatePoint } from './gate.ts'

export interface StreetAssetReader { readManifest(city: string, version?: string): Promise<unknown>; readTile(city: string, version: string, file: string): Promise<string | null> }
export interface StreetContext extends RouteContext { streetAssets?: StreetAssetReader }
interface JourneyBase { id: string; city: string; version: string; anchor: PlotAddress; point: MetrePoint; seq: number; acceptedAt: number; credit: number }
export type StreetJourney =
  | (JourneyBase & { kind: 'walking' })
  | (JourneyBase & { kind: 'venue'; venue: string; door: string })
  | (JourneyBase & { kind: 'estate'; estatePosition: NormalizedGatePoint })
export interface StreetCollection { journeys: Record<string, StreetJourney> }
export interface StreetManifestDoor extends StreetDoor { tile: TileCoord }
