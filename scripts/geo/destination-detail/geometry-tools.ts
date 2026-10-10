/** Small, dependency-free polygon and line tools for the destination-detail builders (WGS84 degrees, longitude first). */
import type { Element } from './overpass.ts';

export type P = [number, number];
export type Ring = P[];
export type Box = readonly [south: number, west: number, north: number, east: number];

export const inBox = (box: Box, [lon, lat]: P): boolean => lat >= box[0] && lat <= box[2] && lon >= box[1] && lon <= box[3];

/** Douglas-Peucker on a line; the tolerance is in degrees. */
export function simplify(points: P[], tolerance: number): P[] {
  if (points.length < 3) return points;
  const [ax, ay] = points[0]!, [bx, by] = points.at(-1)!;
  let worst = -1, at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i]!;
    const length = Math.hypot(bx - ax, by - ay) || 1e-12;
    const distance = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
    if (distance > worst) { worst = distance; at = i; }
  }
  if (worst <= tolerance) return [points[0]!, points.at(-1)!];
  return [...simplify(points.slice(0, at + 1), tolerance).slice(0, -1), ...simplify(points.slice(at), tolerance)];
}

/** Simplify a closed ring (first point repeated at the end); returns a ring of at least four points or nothing. */
export function simplifyRing(ring: Ring, tolerance: number): Ring {
  const open = ring.slice(0, -1);
  if (open.length < 4) return open.length >= 3 ? [...open, open[0]!] : [];
  // Split at the farthest vertex so the closing edge is not simplified away.
  let far = 0, best = -1;
  open.forEach(([x, y], i) => { const d = Math.hypot(x - open[0]![0], y - open[0]![1]); if (d > best) { best = d; far = i; } });
  const a = simplify(open.slice(0, far + 1), tolerance), b = simplify([...open.slice(far), open[0]!], tolerance);
  const closed = [...a.slice(0, -1), ...b];
  return closed.length >= 4 ? closed : [];
}

/** Sutherland-Hodgman clip of a ring to a box. Concave rings may gain edges along the box, which is the map's own edge. */
export function clipRing(ring: Ring, box: Box): Ring {
  let points = ring.slice(0, -1);
  const edges: { inside: (p: P) => boolean; cross: (a: P, b: P) => P }[] = [
    { inside: (p) => p[0] >= box[1], cross: (a, b) => [box[1], a[1] + (b[1] - a[1]) * (box[1] - a[0]) / (b[0] - a[0])] },
    { inside: (p) => p[0] <= box[3], cross: (a, b) => [box[3], a[1] + (b[1] - a[1]) * (box[3] - a[0]) / (b[0] - a[0])] },
    { inside: (p) => p[1] >= box[0], cross: (a, b) => [a[0] + (b[0] - a[0]) * (box[0] - a[1]) / (b[1] - a[1]), box[0]] },
    { inside: (p) => p[1] <= box[2], cross: (a, b) => [a[0] + (b[0] - a[0]) * (box[2] - a[1]) / (b[1] - a[1]), box[2]] },
  ];
  for (const edge of edges) {
    const next: P[] = [];
    points.forEach((point, i) => {
      const prior = points[(i + points.length - 1) % points.length]!;
      if (edge.inside(point)) { if (!edge.inside(prior)) next.push(edge.cross(prior, point)); next.push(point); }
      else if (edge.inside(prior)) next.push(edge.cross(prior, point));
    });
    points = next;
    if (!points.length) return [];
  }
  return points.length >= 3 ? [...points, points[0]!] : [];
}

export const ringArea = (ring: Ring): number => Math.abs(ring.slice(1).reduce((sum, [x, y], i) => sum + ring[i]![0] * y - x * ring[i]![1], 0)) / 2;

export function inRing([x, y]: P, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[i]!, [bx, by] = ring[j]!;
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

/** Join way pieces end to end into closed rings. A piece that never closes is dropped, never forced shut. */
export function assemble(pieces: P[][]): Ring[] {
  const rest = pieces.filter((piece) => piece.length >= 2).map((piece) => piece.slice());
  const same = (a: P, b: P): boolean => a[0] === b[0] && a[1] === b[1];
  const rings: Ring[] = [];
  while (rest.length) {
    let line = rest.pop()!;
    for (let grew = true; grew && !same(line[0]!, line.at(-1)!);) {
      grew = false;
      for (let i = 0; i < rest.length; i++) {
        const piece = rest[i]!;
        const head = line[0]!, tail = line.at(-1)!;
        if (same(tail, piece[0]!)) line = [...line, ...piece.slice(1)];
        else if (same(tail, piece.at(-1)!)) line = [...line, ...piece.slice(0, -1).reverse()];
        else if (same(head, piece.at(-1)!)) line = [...piece.slice(0, -1), ...line];
        else if (same(head, piece[0]!)) line = [...piece.slice(1).reverse(), ...line];
        else continue;
        rest.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (line.length >= 4 && same(line[0]!, line.at(-1)!)) rings.push(line);
  }
  return rings;
}

/** The outer and inner rings of one area element (a closed way, or a relation of outer and inner member ways). */
export function areaRings(element: Element): { outer: Ring[]; inner: Ring[] } {
  const line = (geometry: { lat: number; lon: number }[] | undefined): P[] => (geometry ?? []).map((g): P => [g.lon, g.lat]);
  if (element.type === 'way') return { outer: assemble([line(element.geometry)]), inner: [] };
  const members = element.members ?? [];
  return {
    outer: assemble(members.filter((m) => m.type === 'way' && m.role !== 'inner').map((m) => line(m.geometry))),
    inner: assemble(members.filter((m) => m.type === 'way' && m.role === 'inner').map((m) => line(m.geometry))),
  };
}

/** Outer rings with the inner rings that fall inside them, clipped to the box and simplified. */
export function polygonsOf(rings: { outer: Ring[]; inner: Ring[] }, box: Box, tolerance: number): Ring[][] {
  const out: Ring[][] = [];
  for (const outer of rings.outer) {
    const shell = simplifyRing(clipRing(outer, box), tolerance);
    if (!shell.length) continue;
    const holes = rings.inner.filter((inner) => inRing(inner[0]!, outer)).map((inner) => simplifyRing(clipRing(inner, box), tolerance)).filter((ring) => ring.length);
    out.push([shell, ...holes]);
  }
  return out;
}

export const round = (value: number, places = 5): number => Math.round(value * 10 ** places) / 10 ** places;
export const roundRing = (ring: Ring): Ring => ring.map(([lon, lat]): P => [round(lon), round(lat)]);

/**
 * The built-up extent of an area, traced from a grid, as two sets of polygons: the play area (built-up ground and the water in it)
 * and the land (the same without the water, kept `shore` fine cells back from it so land and water never overlap).
 * A coarse cell is built-up when a land-use point lies in it or within `grow` cells of one that does (and always near an anchor,
 * so a place is never left outside); empty pockets under `minHole` coarse cells are filled. The outline is a sketch at the
 * fine grid's size (`cell / split` degrees), not a surveyed edge. Each polygon is an outer ring followed by its holes.
 */
export function builtUp(points: readonly P[], anchors: readonly P[], water: readonly Ring[][], box: Box, options: { cell: number; split: number; grow: number; minHole: number; shore: number }): { play: Ring[][]; land: Ring[][] } {
  const { cell, split, grow, minHole, shore } = options;
  const cols = Math.ceil((box[3] - box[1]) / cell), rows = Math.ceil((box[2] - box[0]) / cell);
  const seed = new Uint8Array(cols * rows), coarse = new Uint8Array(cols * rows);
  const cellOf = ([lon, lat]: P): [number, number] => [Math.floor((lon - box[1]) / cell), Math.floor((lat - box[0]) / cell)];
  for (const point of points) { const [c, r] = cellOf(point); if (c >= 0 && c < cols && r >= 0 && r < rows) seed[r * cols + c] = 1; }
  const spread = (c0: number, r0: number, radius: number): void => {
    for (let r = Math.max(0, r0 - radius); r <= Math.min(rows - 1, r0 + radius); r++)
      for (let c = Math.max(0, c0 - radius); c <= Math.min(cols - 1, c0 + radius); c++) if ((c - c0) ** 2 + (r - r0) ** 2 <= radius * radius + 1) coarse[r * cols + c] = 1;
  };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (seed[r * cols + c]) spread(c, r, grow);
  for (const anchor of anchors) { const [c, r] = cellOf(anchor); spread(c, r, 2); }
  const seen = new Uint8Array(cols * rows);
  for (let start = 0; start < coarse.length; start++) {
    if (coarse[start] || seen[start]) continue;
    const region: number[] = [start];
    seen[start] = 1;
    let touchesEdge = false;
    for (let i = 0; i < region.length; i++) {
      const at = region[i]!, c = at % cols, r = Math.floor(at / cols);
      if (c === 0 || r === 0 || c === cols - 1 || r === rows - 1) touchesEdge = true;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const next = nr * cols + nc;
        if (!coarse[next] && !seen[next]) { seen[next] = 1; region.push(next); }
      }
    }
    if (!touchesEdge && region.length < minHole) for (const at of region) coarse[at] = 1;
  }
  // The fine grid: the coarse mask, plus the water, scan-filled row by row (even-odd over every ring of every polygon).
  const fine = cell / split, fc = cols * split, fr = rows * split;
  const wet = new Uint8Array(fc * fr);
  for (let r = 0; r < fr; r++) {
    const lat = box[0] + (r + 0.5) * fine, hits: number[] = [];
    for (const polygon of water) for (const ring of polygon) for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = ring[i - 1]!, [bx, by] = ring[i]!;
      if ((ay > lat) !== (by > lat)) hits.push(ax + ((lat - ay) / (by - ay)) * (bx - ax));
    }
    hits.sort((a, b) => a - b);
    for (let h = 0; h + 1 < hits.length; h += 2) {
      const from = Math.max(0, Math.ceil((hits[h]! - box[1]) / fine - 0.5)), to = Math.min(fc - 1, Math.floor((hits[h + 1]! - box[1]) / fine - 0.5));
      for (let c = from; c <= to; c++) wet[r * fc + c] = 1;
    }
  }
  const play = new Uint8Array(fc * fr), land = new Uint8Array(fc * fr);
  for (let r = 0; r < fr; r++) for (let c = 0; c < fc; c++) {
    const at = r * fc + c;
    if (coarse[Math.floor(r / split) * cols + Math.floor(c / split)] || wet[at]) play[at] = 1;
  }
  for (let r = 0; r < fr; r++) for (let c = 0; c < fc; c++) {
    const at = r * fc + c;
    if (!play[at] || wet[at]) continue;
    let near = false;
    for (let dr = -shore; dr <= shore && !near; dr++) for (let dc = -shore; dc <= shore; dc++) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nc >= 0 && nr < fr && nc < fc && wet[nr * fc + nc]) { near = true; break; }
    }
    if (!near) land[at] = 1;
  }
  return { play: traceCells(play, fc, fr, box, fine), land: traceCells(land, fc, fr, box, fine) };
}

/** The outer rings (with their holes) of the filled cells of a grid. */
function traceCells(fill: Uint8Array, cols: number, rows: number, box: Box, cell: number): Ring[][] {
  const key = (c: number, r: number): number => r * (cols + 1) + c;
  const next = new Map<number, number[]>();
  const edge = (c0: number, r0: number, c1: number, r1: number): void => {
    const from = key(c0, r0), list = next.get(from);
    if (list) list.push(key(c1, r1)); else next.set(from, [key(c1, r1)]);
  };
  const filled = (c: number, r: number): boolean => c >= 0 && r >= 0 && c < cols && r < rows && fill[r * cols + c] === 1;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!filled(c, r)) continue;
    if (!filled(c, r - 1)) edge(c, r, c + 1, r);
    if (!filled(c + 1, r)) edge(c + 1, r, c + 1, r + 1);
    if (!filled(c, r + 1)) edge(c + 1, r + 1, c, r + 1);
    if (!filled(c - 1, r)) edge(c, r + 1, c, r);
  }
  const at = (k: number): P => [box[1] + (k % (cols + 1)) * cell, box[0] + Math.floor(k / (cols + 1)) * cell];
  const rings: Ring[] = [];
  for (const start of [...next.keys()]) {
    while (next.get(start)?.length) {
      const ring: Ring = [at(start)];
      let current = start;
      for (;;) {
        const options = next.get(current);
        if (!options?.length) break;
        const to = options.pop()!;
        ring.push(at(to));
        current = to;
        if (to === start) break;
      }
      if (ring.length >= 4 && current === start) rings.push(ring);
    }
  }
  const signed = (ring: Ring): number => ring.slice(1).reduce((sum, [x, y], i) => sum + ring[i]![0] * y - x * ring[i]![1], 0) / 2;
  const outers = rings.filter((ring) => signed(ring) > 0), holes = rings.filter((ring) => signed(ring) < 0);
  return outers.map((outer) => [outer, ...holes.filter((hole) => inRing(hole[0]!, outer))]);
}
