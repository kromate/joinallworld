import type { Bounds, Position } from '../types.ts';

/** Mean Earth radius used by the spherical great-circle view helper. */
export const VIEW_EARTH_RADIUS_METERS = 6_371_008.8;
export const MAX_PREVIEW_RADIUS_METERS = 5_000;

interface LocalPoint { x: number; y: number; z: number }

/** Bound the flat-ground camera footprint, including its oblique far corners. */
export function groundFootprintRadius(position: LocalPoint, target: LocalPoint, cornerDirections: readonly LocalPoint[]): number {
  if (cornerDirections.length !== 4 || [...Object.values(position), ...Object.values(target), ...cornerDirections.flatMap(value => Object.values(value))].some(value => !Number.isFinite(value))) {
    throw new RangeError('camera footprint requires finite positions and four corner rays');
  }
  let radius = 1;
  for (const direction of cornerDirections) {
    if (direction.y >= -1e-9) return MAX_PREVIEW_RADIUS_METERS + 1;
    const distance = (target.y - position.y) / direction.y;
    if (distance <= 0) return MAX_PREVIEW_RADIUS_METERS + 1;
    radius = Math.max(radius, Math.hypot(position.x + distance * direction.x - target.x, position.z + distance * direction.z - target.z));
  }
  return radius * 1.01; // Reserve a small margin for the planar ENU approximation.
}

export interface GeographicCircleBounds {
  bounds: Bounds;
  /** Radius actually used after applying the preview's explicit 5 km limit. */
  radiusMeters: number;
  limited: boolean;
}

function normalizeLongitude(value: number): number {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

/**
 * Returns the smallest longitude/latitude rectangle containing a spherical
 * great-circle disk. A west value greater than east means the rectangle crosses
 * the antimeridian. Near a pole, longitude is deliberately unrestricted.
 */
export function geographicCircleBounds(center: Position, requestedRadiusMeters: number): GeographicCircleBounds {
  const [longitude, latitude] = center;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new RangeError('center must be a WGS84 [longitude, latitude] position');
  }
  if (!Number.isFinite(requestedRadiusMeters) || requestedRadiusMeters <= 0) throw new RangeError('radius must be a positive finite number');

  const radiusMeters = Math.min(requestedRadiusMeters, MAX_PREVIEW_RADIUS_METERS);
  const angularRadius = radiusMeters / VIEW_EARTH_RADIUS_METERS;
  const latitudeRadians = latitude * Math.PI / 180;
  const southRadians = Math.max(-Math.PI / 2, latitudeRadians - angularRadius);
  const northRadians = Math.min(Math.PI / 2, latitudeRadians + angularRadius);
  const south = southRadians * 180 / Math.PI;
  const north = northRadians * 180 / Math.PI;
  const reachesPole = northRadians >= Math.PI / 2 || southRadians <= -Math.PI / 2;
  if (reachesPole) return { bounds: [-180, south, 180, north], radiusMeters, limited: requestedRadiusMeters > radiusMeters };

  // Exact longitude extremum for a spherical great-circle disk that does not
  // contain a pole: asin(sin(angular radius) / cos(center latitude)).
  const ratio = Math.min(1, Math.sin(angularRadius) / Math.cos(latitudeRadians));
  const longitudeDelta = Math.asin(ratio) * 180 / Math.PI;
  const westRaw = longitude - longitudeDelta;
  const eastRaw = longitude + longitudeDelta;
  const west = normalizeLongitude(westRaw);
  const east = normalizeLongitude(eastRaw);
  return { bounds: [west, south, east, north], radiusMeters, limited: requestedRadiusMeters > radiusMeters };
}
