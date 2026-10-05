// The map layers that are on before the player has touched a toggle. It is a file of its own because the page's travel state
// (travelState.ts) needs it at startup, and the rest of the travel rules (travelModel.ts) only when the Map, the Ride app or a trip is shown.
import type { LayerState } from './travelModel.ts'

export const initialLayers = (): LayerState => ({ lgas: true, homes: true, moving: false, billboards: false, sea: false, gov: false })
