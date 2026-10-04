/**
 * OWNER: world
 * The map above the city: the world, Africa and Nigeria as one zoomable atlas, with the open city
 * in colour and everything else coming soon. The atlas itself is src/map3d/geo/atlas.js; this file
 * is the door the host (src/life-main.js) knows, kept so the host does not change when the map does.
 *
 * Contract:
 *   createWorldMap(container, { onOpenCity(cityId), onEnterCity(cityId), onTravel(to, mode), routes(), held() })
 *     → { setCity(cityId), setState(state), refresh(), resize(), destroy(), … }
 *   onOpenCity   the player chose the city they are already in: show its city map
 *   onEnterCity  the player chose another city they may enter (see cityAccess in src/map3d/regions.js)
 *   onTravel     the player set out for another city along a link (the 'estate.relocate' action)
 *   routes()     the life's own view of its links (view.estate.links), with the server's reason when blocked
 *   held()       the cities in which this player already has a life (session.cities)
 *   setState     the life's state: a trip between cities is drawn where the server's timer says it is
 *
 * The region registry (src/map3d/regions.js) says what is open, planned or coming soon; the map
 * data (src/map3d/geo/data) is fetched level by level, the first time each is shown.
 */
import './map3d/geo/atlas.css';
import { createAtlas } from './map3d/geo/atlas.ts';

/** The options the host passes: exactly the atlas's own (see the contract above). */
export type WorldMapOptions = Parameters<typeof createAtlas>[1];
/** The handle the host gets back: the atlas itself. */
export type WorldMap = ReturnType<typeof createAtlas>;

export function createWorldMap(container: HTMLElement, options: WorldMapOptions = {}): WorldMap {
  const atlas = createAtlas(container, options);
  // With ?diagnostics in the address the atlas can be read from a test harness: window.__atlas.diagnostics().
  try { if (new URLSearchParams(globalThis.location.search).has('diagnostics')) (globalThis as { __atlas?: WorldMap }).__atlas = atlas; } catch { /* no address to read */ }
  return atlas;
}
