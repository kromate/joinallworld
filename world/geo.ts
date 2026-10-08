import type { Anchor } from './types.ts';

/** WGS84 topocentric frame. ENU is returned as scene east, up, negative-north. */
const A = 6_378_137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);

function ecef(p: Anchor): [number, number, number] {
  const lon = p.longitude * Math.PI / 180;
  const lat = p.latitude * Math.PI / 180;
  const n = A / Math.sqrt(1 - E2 * Math.sin(lat) ** 2);
  return [(n + p.height) * Math.cos(lat) * Math.cos(lon),
    (n + p.height) * Math.cos(lat) * Math.sin(lon),
    (n * (1 - E2) + p.height) * Math.sin(lat)];
}

function validateAnchor(p: Anchor): void {
  if (!Number.isFinite(p.longitude) || p.longitude < -180 || p.longitude > 180 ||
      !Number.isFinite(p.latitude) || p.latitude < -90 || p.latitude > 90 || !Number.isFinite(p.height)) {
    throw new RangeError('anchor must have finite WGS84 longitude, latitude, and height');
  }
}

function validateLocal(p: { x: number; y: number; z: number }): void {
  if (![p.x, p.y, p.z].every(Number.isFinite)) throw new RangeError('local coordinates must be finite');
}

/** Convert WGS84 to metres in the origin's tangent frame (east, up, -north).
 * Keep tiles local: tangent-plane distortion grows with distance; this is not a
 * continental-scale flat map. Dateline and polar coordinates are supported.
 */
export function toLocal(position: Anchor, origin: Anchor): { x: number; y: number; z: number } {
  validateAnchor(position);
  validateAnchor(origin);
  const target = ecef(position);
  const base = ecef(origin);
  const [dx, dy, dz] = target.map((v, i) => v - base[i]!) as [number, number, number];
  const lon = origin.longitude * Math.PI / 180;
  const lat = origin.latitude * Math.PI / 180;
  const east = -Math.sin(lon) * dx + Math.cos(lon) * dy;
  const north = -Math.sin(lat) * Math.cos(lon) * dx - Math.sin(lat) * Math.sin(lon) * dy + Math.cos(lat) * dz;
  const up = Math.cos(lat) * Math.cos(lon) * dx + Math.cos(lat) * Math.sin(lon) * dy + Math.sin(lat) * dz;
  return { x: east, y: up, z: -north };
}

/** Inverse of toLocal; longitude is normalized to [-180, 180). */
export function fromLocal(local: { x: number; y: number; z: number }, origin: Anchor): Anchor {
  validateLocal(local);
  validateAnchor(origin);
  const [x0, y0, z0] = ecef(origin);
  const lon = origin.longitude * Math.PI / 180;
  const lat = origin.latitude * Math.PI / 180;
  const east = local.x, north = -local.z, up = local.y;
  const x = x0 - Math.sin(lon) * east - Math.sin(lat) * Math.cos(lon) * north + Math.cos(lat) * Math.cos(lon) * up;
  const y = y0 + Math.cos(lon) * east - Math.sin(lat) * Math.sin(lon) * north + Math.cos(lat) * Math.sin(lon) * up;
  const z = z0 + Math.cos(lat) * north + Math.sin(lat) * up;
  const lonOut = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  if (p < 1e-7) {
    return { longitude: ((origin.longitude + 540) % 360) - 180,
      latitude: z < 0 ? -90 : 90, height: Math.abs(z) - A * Math.sqrt(1 - E2) };
  }
  let latitude = Math.atan2(z, p * (1 - E2));
  let height = Math.hypot(p, z) - A;
  for (let i = 0; i < 8; i++) {
    const n = A / Math.sqrt(1 - E2 * Math.sin(latitude) ** 2);
    height = Math.abs(Math.cos(latitude)) > 1e-10
      ? p / Math.cos(latitude) - n
      : z / Math.sin(latitude) - n * (1 - E2);
    latitude = Math.atan2(z, p * (1 - E2 * n / (n + height)));
  }
  return { longitude: ((lonOut * 180 / Math.PI + 540) % 360) - 180,
    latitude: latitude * 180 / Math.PI, height };
}
