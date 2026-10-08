import type { InventoryGeometry } from './inventory-view.ts';

/** Atlas camera only: original geometry remains unchanged and is not street-scale. */
export function admin1AtlasFrame(geometry: InventoryGeometry): { viewBox: string; wraps: boolean } {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates as number[][][]] : geometry.coordinates as number[][][][];
  const longitudes: number[] = []; let south = 90, north = -90, polarLoop = false;
  for (const polygon of polygons) for (const ring of polygon) {
    let winding = 0;
    let touchesNorthPole = false, touchesSouthPole = false;
    for (let i = 0; i < ring.length; ++i) {
      const [longitude, latitude] = ring[i]!;
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) throw new TypeError('atlas coordinates must be finite');
      longitudes.push(longitude!); south = Math.min(south, latitude!); north = Math.max(north, latitude!);
      // Some source coastlines explicitly trace the pole along meridians. Their
      // normalized longitude winding can be zero, so winding alone misses them.
      if (latitude! >= 90 - 1e-9) touchesNorthPole = true;
      if (latitude! <= -90 + 1e-9) touchesSouthPole = true;
      if (i) { let delta = longitude! - ring[i - 1]![0]!; if (delta > 180) delta -= 360; else if (delta < -180) delta += 360; winding += delta; }
    }
    if (touchesNorthPole || touchesSouthPole) {
      polarLoop = true;
      if (touchesNorthPole) north = 90;
      if (touchesSouthPole) south = -90;
    }
    if (Math.abs(winding) > 180) { polarLoop = true; if (ring.every(point => point[1]! > 0)) north = 90; else if (ring.every(point => point[1]! < 0)) south = -90; }
  }
  if (!longitudes.length) throw new TypeError('atlas feature has no coordinates');
  if (polarLoop) return { viewBox: `0 ${(90 - north) * 2} 720 ${Math.max(1, (north - south) * 2)}`, wraps: false };
  const sorted = [...new Set(longitudes)].sort((a,b) => a-b);
  let gap = -1, next = 0;
  for (let i = 0; i < sorted.length; ++i) { const following = sorted[(i + 1) % sorted.length]! + (i === sorted.length - 1 ? 360 : 0); const size = following - sorted[i]!; if (size > gap) { gap = size; next = (i + 1) % sorted.length; } }
  const west = sorted[next]!, span = 360 - gap, east = west + span;
  const width = Math.max(span * 2, (north - south) * 4, 0.02) * 1.2, height = width / 2;
  const cx = west + east + 360, cy = 180 - south - north;
  return { viewBox: `${cx - width / 2} ${cy - height / 2} ${width} ${height}`, wraps: east > 180 };
}
