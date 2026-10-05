/**
 * OWNER: world
 * The Nigeria map frame: the one projection every state and city map is built in, so that the
 * pieces tile into the real shape of the country. Pure maths — no Three.js, no DOM.
 * The full contract is in docs/MAP-GEOMETRY.md.
 *
 * PROJECTION  equirectangular (plate carrée) with a fixed standard parallel of 9°N, the middle of
 * Nigeria, on a sphere of radius 6371.0088 km. North is up. Over Nigeria's 4°N–14°N the east–west
 * scale is within 3% of true, and inside one state well under 1%.
 *
 *   x (east)  = (lon − 8) · cos(9°) · 6371.0088 · π/180 · UNITS_PER_KM
 *   z (south) = (9 − lat) · 6371.0088 · π/180 · UNITS_PER_KM
 *
 * The frame's origin (0, 0) is 8°E 9°N. x runs east and z runs SOUTH, the same handedness as the
 * city maps (src/map3d/types.ts: [x, z], z south, y up).
 *
 * SCALE  UNITS_PER_KM = 10: one map unit is 100 m on the ground.
 *
 * LOCAL COORDINATES  a state or city map is drawn in coordinates relative to its own origin:
 *   local = frame − origin        frame = local + origin
 * Origins are whole numbers of units, so placing every map at its origin reproduces Nigeria exactly.
 */

/** Map units per kilometre on the ground. */
export const UNITS_PER_KM = 10;
/** The mean Earth radius the frame uses, in km. */
export const EARTH_RADIUS_KM = 6371.0088;
/** The standard parallel, degrees north. */
export const STANDARD_PARALLEL = 9;
/** The longitude of the frame's x = 0, degrees east. */
export const FRAME_LON = 8;
/** The latitude of the frame's z = 0, degrees north (the same as the standard parallel). */
export const FRAME_LAT = 9;

const DEG = Math.PI / 180;
const UNITS_PER_DEG_LAT = EARTH_RADIUS_KM * DEG * UNITS_PER_KM;
const UNITS_PER_DEG_LON = UNITS_PER_DEG_LAT * Math.cos(STANDARD_PARALLEL * DEG);

/**
 * The identity of the frame AND of the city geometry drawn in it. A camera position kept before this changed (an older,
 * differently shaped board, another origin or scale) is meaningless now and must be dropped, not restored: bump the
 * last part whenever a city's real-world layout is redrawn.
 */
export const CAMERA_FRAME = `nigeria-frame:${FRAME_LON},${FRAME_LAT},${UNITS_PER_KM}:lagos-real-1`;

/** A position in map units: x east, z south. */
export interface FramePoint { x: number; z: number }

/** lon/lat (degrees) → frame units. */
export function project(lon: number, lat: number): FramePoint {
  return { x: (lon - FRAME_LON) * UNITS_PER_DEG_LON, z: (FRAME_LAT - lat) * UNITS_PER_DEG_LAT };
}
/** frame units → lon/lat (degrees). The exact inverse of project(). */
export function unproject(x: number, z: number): { lon: number; lat: number } {
  return { lon: FRAME_LON + x / UNITS_PER_DEG_LON, lat: FRAME_LAT - z / UNITS_PER_DEG_LAT };
}

/** A map's origin in the frame, in whole units. */
export interface MapOrigin { readonly x: number; readonly z: number }
/** The origin of a map whose anchor point is lon/lat: the anchor's frame position, rounded to whole units. */
export function originAt(lon: number, lat: number): MapOrigin {
  const p = project(lon, lat);
  return Object.freeze({ x: Math.round(p.x), z: Math.round(p.z) });
}
/** lon/lat → a map's local units. */
export function toLocal(origin: MapOrigin, lon: number, lat: number): [number, number] {
  const p = project(lon, lat);
  return [p.x - origin.x, p.z - origin.z];
}
/** A map's local units → lon/lat. */
export function fromLocal(origin: MapOrigin, x: number, z: number): { lon: number; lat: number } {
  return unproject(x + origin.x, z + origin.z);
}

/**
 * The origins of the maps that exist. A new state adds one line: anchor it at a recognisable
 * point near the middle of its playable area.
 */
export const ORIGINS = Object.freeze({
  /** Lagos: Lagos Island (3.40°E, 6.45°N). */
  lagos: originAt(3.4, 6.45),
} as const);
