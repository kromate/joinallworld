/**
 * OWNER: world
 * Which region is at a point? Point-in-polygon on the data itself (never the GPU), behind a
 * uniform grid so a hover costs a handful of polygon tests. Pure — no Three.js, no DOM.
 *
 *   createPicker(topology, { cells?, slack? })
 *     → { pick(lon, lat) → Feature | null      the region the point is in
 *         near(lon, lat) → Feature | null      the region whose edge is within `slack` degrees (coasts, small islands)
 *         find(lon, lat)                       pick, else near
 *         candidates(lon, lat), cells }
 * Longitudes are those of the data (see relLon in ./projection.js).
 *
 * @typedef {import('./topo.js').Topology} Topology
 * @typedef {import('./topo.js').Feature} Feature
 */

/** Is (x, y) inside the flat ring [x0, y0, x1, y1 …]? Even–odd rule. */
export function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, n = ring.length, j = n - 2; i < n; j = i, i += 2) {
    const xi = ring[i], yi = ring[i + 1], xj = ring[j], yj = ring[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Is the point in the feature: inside one of its polygons and in none of that polygon's holes? */
export function inFeature(feature, lon, lat) {
  const b = feature.bounds;
  if (lon < b.minLon || lon > b.maxLon || lat < b.minLat || lat > b.maxLat) return false;
  for (const poly of feature.rings) {
    if (!inRing(poly[0], lon, lat)) continue;
    let hole = false;
    for (let i = 1; i < poly.length && !hole; i++) hole = inRing(poly[i], lon, lat);
    if (!hole) return true;
  }
  return false;
}

/** @param {Topology} topology @param {{ cells?: number, slack?: number }} [options] cells along the longer side of the grid; slack in degrees for near() */
export function createPicker(topology, { cells = 48, slack = 0 } = {}) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const { bounds } of topology.features) { minLon = Math.min(minLon, bounds.minLon); minLat = Math.min(minLat, bounds.minLat); maxLon = Math.max(maxLon, bounds.maxLon); maxLat = Math.max(maxLat, bounds.maxLat); }
  const size = Math.max(maxLon - minLon, maxLat - minLat, 1e-9) / cells;
  const columns = Math.max(1, Math.ceil((maxLon - minLon) / size)), rows = Math.max(1, Math.ceil((maxLat - minLat) / size));
  /** @type {Feature[][]} */
  const grid = Array.from({ length: columns * rows }, () => []);
  const column = (lon) => Math.max(0, Math.min(columns - 1, Math.floor((lon - minLon) / size))), row = (lat) => Math.max(0, Math.min(rows - 1, Math.floor((lat - minLat) / size)));
  for (const feature of topology.features) {
    // One entry per polygon's box, so a country of scattered islands does not fill the whole grid.
    for (const poly of feature.rings) {
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      for (let i = 0; i < poly[0].length; i += 2) { a = Math.min(a, poly[0][i]); c = Math.max(c, poly[0][i]); b = Math.min(b, poly[0][i + 1]); d = Math.max(d, poly[0][i + 1]); }
      for (let y = row(b); y <= row(d); y++) for (let x = column(a); x <= column(c); x++) { const cell = grid[y * columns + x]; if (!cell.includes(feature)) cell.push(feature); }
    }
  }
  const candidates = (lon, lat) => (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat ? [] : grid[row(lat) * columns + column(lon)]);
  /** @returns {Feature | null} the feature the point is in */
  function pick(lon, lat) { for (const feature of candidates(lon, lat)) if (inFeature(feature, lon, lat)) return feature; return null; }
  /**
   * The feature whose edge is nearest the point, if one is within `slack` degrees: a tap just off a
   * simplified coast, or on an island too small to hit, still finds its country.
   * @returns {Feature | null}
   */
  function near(lon, lat, reach = slack) {
    if (!(reach > 0)) return null;
    let best = null, bestDistance = reach * reach;
    const seen = new Set(), squash = Math.cos((lat * Math.PI) / 180) || 1e-6;
    for (let y = row(lat - reach); y <= row(lat + reach); y++) for (let x = column(lon - reach); x <= column(lon + reach); x++) {
      for (const feature of grid[y * columns + x]) {
        if (seen.has(feature)) continue;
        seen.add(feature);
        const b = feature.bounds;
        if (lon < b.minLon - reach || lon > b.maxLon + reach || lat < b.minLat - reach || lat > b.maxLat + reach) continue;
        for (const poly of feature.rings) {
          const ring = poly[0];
          for (let i = 0, n = ring.length, j = n - 2; i < n; j = i, i += 2) {
            // Distance to the edge, with longitude squashed so a degree is about as long both ways.
            const ax = (ring[j] - lon) * squash, ay = ring[j + 1] - lat, bx = (ring[i] - lon) * squash, by = ring[i + 1] - lat, dx = bx - ax, dy = by - ay;
            const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1))), px = ax + dx * t, py = ay + dy * t, d = px * px + py * py;
            if (d < bestDistance) { bestDistance = d; best = feature; }
          }
        }
      }
    }
    return best;
  }
  return {
    cells: { columns, rows, size, largest: grid.reduce((most, cell) => Math.max(most, cell.length), 0) },
    candidates, pick, near,
    /** The feature at the point, or failing that the nearest one within the slack. */
    find: (lon, lat) => pick(lon, lat) || near(lon, lat),
  };
}
