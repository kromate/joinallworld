/**
 * OWNER: world
 * The atlas projection: Equal Earth (Šavrič, Patterson & Jenny, 2018), written out here — no library.
 * Pure maths, no Three.js and no DOM.
 *
 * One flat projection serves all three zoom levels (world → Africa → Nigeria), so zooming is one
 * continuous camera move over one plane. The central meridian is 11°E: Africa sits in the middle
 * of the sheet and the cut on the far side (169°W) runs through the Bering Strait and open ocean.
 *
 *   project(lon, lat)   → [x, y]      map units; 1 unit = 1° of latitude at the equator, y north
 *   unproject(x, y)     → [lon, lat]  the inverse (Newton's method on the polynomial)
 *   relLon(lon)         → the longitude as stored in the data: in [−169, 191), continuous across 180°
 *   EXTENT              the sheet: { minX, maxX, minY, maxY }
 */
const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = Math.sqrt(3) / 2;
const DEG = Math.PI / 180;
/** The central meridian, degrees east. */
export const CENTRAL_MERIDIAN = 11;

/** A longitude in the range the data uses: [CENTRAL_MERIDIAN − 180, CENTRAL_MERIDIAN + 180). */
export function relLon(lon) {
  let value = (lon - CENTRAL_MERIDIAN + 180) % 360;
  if (value < 0) value += 360;
  return value - 180 + CENTRAL_MERIDIAN;
}

/** @param {number} lon degrees east, as stored (see relLon) @param {number} lat degrees north @returns {[number, number]} */
export function project(lon, lat) {
  const lambda = (lon - CENTRAL_MERIDIAN) * DEG, theta = Math.asin(M * Math.sin(lat * DEG)), t2 = theta * theta, t6 = t2 * t2 * t2;
  const x = (lambda * Math.cos(theta)) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)));
  const y = theta * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
  return [x / DEG, y / DEG];
}

/** @returns {[number, number]} [lon, lat]; a point off the sheet comes back clamped to its edge. */
export function unproject(x, y) {
  const py = Math.max(-1.3173, Math.min(1.3173, y * DEG));
  let theta = py;
  for (let i = 0; i < 12; i++) {
    const t2 = theta * theta, t6 = t2 * t2 * t2;
    const f = theta * (A1 + A2 * t2 + t6 * (A3 + A4 * t2)) - py, d = A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2);
    const step = f / d;
    theta -= step;
    if (Math.abs(step) < 1e-12) break;
  }
  const t2 = theta * theta, t6 = t2 * t2 * t2;
  const lambda = (M * x * DEG * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))) / Math.cos(theta);
  const lat = Math.asin(Math.max(-1, Math.min(1, Math.sin(theta) / M))) / DEG;
  return [Math.max(-180, Math.min(180, lambda / DEG)) + CENTRAL_MERIDIAN, lat];
}

const corner = project(CENTRAL_MERIDIAN + 180, 0), top = project(CENTRAL_MERIDIAN, 90);
/** The whole sheet in map units. */
export const EXTENT = Object.freeze({ minX: -corner[0], maxX: corner[0], minY: -top[1], maxY: top[1] });
