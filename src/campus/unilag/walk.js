import { createWalkGrid } from '../../scene/movement.js';
import { BUILDINGS, ZONES } from './layout.js';

const WALL = 1;
const zoneById = new Map(ZONES.map((zone) => [zone.id, zone]));

/**
 * Converts a building descriptor into physical wall rectangles.
 *
 * Exterior buildings are solid rectangles. Interior buildings derive a back
 * wall, two side walls and the rendered side/back furniture strips from the
 * same descriptor, leaving a central aisle through the entire south facade.
 * Gates are two pillars with a clear opening beneath the arch.
 * Sports grounds, gardens and water scenery do not create solid footprints.
 *
 * @param {import('./layout.js').CampusBuilding|object} building Building descriptor.
 * @returns {Array<[number,number,number,number]>} Obstacle rectangles.
 */
export function footprintOf(building) {
  const { x, z, w, d, kind, interior } = building;
  const x0 = x - w / 2, x1 = x + w / 2;
  const z0 = z - d / 2, z1 = z + d / 2;
  if (kind === 'open-space') return [];
  if (kind === 'gate') {
    const pillarWidth = w * 0.15;
    return [
      [x - w * 0.36 - pillarWidth / 2, z0, x - w * 0.36 + pillarWidth / 2, z1],
      [x + w * 0.36 - pillarWidth / 2, z0, x + w * 0.36 + pillarWidth / 2, z1],
    ];
  }
  if (!interior) return [[x0, z0, x1, z1]];
  return [
    [x0, z0, x1, z0 + WALL],
    [x0, z0, x0 + WALL, z1],
    [x1 - WALL, z0, x1, z1],
    [x0 + WALL, z0 + WALL, x0 + 6, z1 - 1],
    [x1 - 6, z0 + WALL, x1 - WALL, z1 - 1],
    [x0 + 6, z0 + WALL, x1 - 6, z0 + 3.5],
  ];
}

/** @param {{x:number,z:number}} a @param {{x:number,z:number}} b */
const samePoint = (a, b) => Math.abs(a.x - b.x) < 1e-8 && Math.abs(a.z - b.z) < 1e-8;

/**
 * Builds campus occupancy grids and a router that crosses zones through the
 * paired portal graph. Each per-zone path is accepted only when its final
 * waypoint is the exact requested endpoint; this rejects createWalkGrid's
 * documented partial-path fallback for unreachable goals.
 *
 * @param {Record<string, Array<[number,number,number,number]|[number,number,number]>>} [extraFootprints]
 *   Additional rendered obstacle shapes keyed by zone id. This lets a scene
 *   rebuild navigation after placing trees, cars, lamps and benches.
 * @returns {{
 *   grids: Map<string, ReturnType<typeof createWalkGrid>>,
 *   zoneAt: (x:number,z:number)=>import('./layout.js').CampusZone|null,
 *   route: (from:{x:number,z:number},to:{x:number,z:number})=>Array<{x:number,z:number}>|null
 * }} Campus navigation API.
 */
export function createCampusWalk(extraFootprints = {}) {
  const grids = new Map();
  for (const zone of ZONES) {
    const block = BUILDINGS.filter((building) => building.zone === zone.id).flatMap(footprintOf);
    block.push(...(extraFootprints[zone.id] || []));
    if (zone.id === 'lagoon') block.push([340, zone.bounds[1], zone.bounds[2], zone.bounds[3]]);
    grids.set(zone.id, createWalkGrid({ bounds: zone.bounds, block, cell: 1, radius: 0.4 }));
  }

  /**
   * Returns the zone containing a world point. Shared edges resolve toward the
   * zone whose interior contains the point; portal points deliberately sit
   * half a metre to either side and are therefore unambiguous.
   * @param {number} x World x.
   * @param {number} z World z.
   * @returns {import('./layout.js').CampusZone|null}
   */
  function zoneAt(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    return ZONES.find((zone) => {
      const [x0, z0, x1, z1] = zone.bounds;
      return x >= x0 && x < x1 && z >= z0 && z < z1;
    }) || null;
  }

  /**
   * Finds the shortest unweighted sequence of portal hops between two zones.
   * @param {string} from Start zone id.
   * @param {string} to Destination zone id.
   * @returns {Array<{zone:string,portal:import('./layout.js').Portal}>|null}
   */
  function portalRoute(from, to) {
    if (from === to) return [];
    const queue = [from];
    const previous = new Map([[from, null]]);
    while (queue.length) {
      const here = queue.shift();
      const zone = zoneById.get(here);
      for (const edge of zone?.portals || []) {
        if (previous.has(edge.to)) continue;
        previous.set(edge.to, { zone: here, portal: edge });
        if (edge.to === to) {
          const hops = [];
          let cursor = to;
          while (cursor !== from) {
            const step = previous.get(cursor);
            hops.push({ zone: step.zone, portal: step.portal });
            cursor = step.zone;
          }
          return hops.reverse();
        }
        queue.push(edge.to);
      }
    }
    return null;
  }

  /**
   * Requests a per-zone path and refuses partial fallback paths.
   * @param {string} zoneId Owning zone id.
   * @param {{x:number,z:number}} from Segment start.
   * @param {{x:number,z:number}} to Segment destination.
   * @returns {Array<{x:number,z:number}>|null}
   */
  function exactSegment(zoneId, from, to) {
    const grid = grids.get(zoneId);
    if (!grid?.free(from.x, from.z) || !grid.free(to.x, to.z)) return null;
    if (samePoint(from, to)) return [];
    const path = grid.path(from.x, from.z, to.x, to.z);
    if (!path?.length || !samePoint(path[path.length - 1], to)) return null;
    return path;
  }

  /**
   * Routes between two exact world points. Returned waypoints omit the start,
   * include paired portal crossings, and end at the exact destination.
   * Water, out-of-bounds points and disconnected or blocked endpoints fail.
   * @param {{x:number,z:number}} from Exact start point.
   * @param {{x:number,z:number}} to Exact destination point.
   * @returns {Array<{x:number,z:number}>|null}
   */
  function route(from, to) {
    if (!from || !to) return null;
    const startZone = zoneAt(from.x, from.z);
    const endZone = zoneAt(to.x, to.z);
    if (!startZone || !endZone) return null;
    const hops = portalRoute(startZone.id, endZone.id);
    if (!hops) return null;

    const result = [];
    let current = { x: from.x, z: from.z };
    let currentZone = startZone.id;
    for (const hop of hops) {
      const segment = exactSegment(currentZone, current, hop.portal.at);
      if (!segment) return null;
      result.push(...segment, { ...hop.portal.peer });
      current = hop.portal.peer;
      currentZone = hop.portal.to;
    }
    const finalSegment = exactSegment(currentZone, current, { x: to.x, z: to.z });
    if (finalSegment === null) return null;
    result.push(...finalSegment);
    return result;
  }

  return { grids, zoneAt, route };
}
