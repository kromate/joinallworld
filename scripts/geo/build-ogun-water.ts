/**
 * Regenerates src/game/cities/ogun/water.ts: the rivers and still water of the four Ogun city play areas and the
 * corridors between them, from OpenStreetMap (© OpenStreetMap contributors, ODbL 1.0) through the public Overpass
 * interpreter.
 *
 *   node --experimental-strip-types scripts/geo/build-ogun-water.ts
 *
 * Named waterway ways (the Ogun, Lafenwa, Yewa, Ona, Ibu, Omi and Ofe rivers, Majidun Creek) are lines; named closed
 * natural=water ways (reservoirs, lagoons, creeks mapped as rings) are rings. Both are limited to the box below and are
 * kept only when a vertex lies inside the Ogun State outline, then simplified (Douglas-Peucker, 0.0003 degrees) and
 * quantised to 0.0001 degrees (about 11 m). Each row is [name, kind, first longitude and latitude in 0.0001 degrees,
 * then steps to every next vertex]. Nothing is drawn that the source does not hold.
 */
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { OGUN_STATE } from '../../src/map3d/geo/data/ogun.ts';
import { decodeTopology } from '../../src/map3d/geo/topo.ts';

const BOX = [6.45, 2.85, 7.5, 4.1] as const;
const RIVERS = 'Ogun|Lafenwa River|Yewa|Ona|Ibu|Omi|Ofe|Majidun Creek';
const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const TOLERANCE = 0.0003;
type P = [number, number];
interface Element { type: string; id: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[]; members?: { type: string; ref: number; geometry?: { lat: number; lon: number }[] }[] }

async function query(text: string): Promise<{ raw: string; elements: Element[] }> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'User-Agent': 'allworld-geo-build', 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(text)}` });
    if (response.status === 429 || response.status === 504) { await new Promise((resolve) => setTimeout(resolve, 20000)); continue; }
    if (!response.ok) throw new Error(`Overpass answered ${response.status}`);
    const raw = await response.text();
    return { raw, elements: (JSON.parse(raw) as { elements: Element[] }).elements };
  }
  throw new Error('Overpass kept refusing the request');
}
function simplify(points: P[], tolerance: number): P[] {
  if (points.length < 3) return points;
  const [ax, ay] = points[0]!, [bx, by] = points.at(-1)!;
  let worst = -1, at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i]!, length = Math.hypot(bx - ax, by - ay) || 1e-12;
    const distance = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
    if (distance > worst) { worst = distance; at = i; }
  }
  if (worst <= tolerance) return [points[0]!, points.at(-1)!];
  return [...simplify(points.slice(0, at + 1), tolerance).slice(0, -1), ...simplify(points.slice(at), tolerance)];
}

const outline = decodeTopology(OGUN_STATE).features[0]!.rings;
const inState = ({ lon, lat }: { lon: number; lat: number }): boolean => outline.some((polygon) => polygon.reduce((inside, ring) => {
  let hit = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) if ((ring[i + 1]! > lat) !== (ring[j + 1]! > lat) && lon < ((ring[j]! - ring[i]!) * (lat - ring[i + 1]!)) / (ring[j + 1]! - ring[i + 1]!) + ring[i]!) hit = !hit;
  return hit ? !inside : inside;
}, false));

const box = BOX.join(',');
const rivers = await query(`[out:json][timeout:90];way["waterway"="river"]["name"~"^(${RIVERS})$"](${box});out geom tags;`);
const still = await query(`[out:json][timeout:90];way["natural"="water"]["name"](${box});out geom tags;`);
const hash = createHash('sha256').update(rivers.raw).update(still.raw).digest('hex');
const rows: string[] = [];
let points = 0;
const add = (name: string, kind: 'river' | 'lake', geometry: { lat: number; lon: number }[]): void => {
  if (!geometry.some(inState)) return;
  const line = geometry.map((g): P => [g.lon, g.lat]);
  // A closed ring is split at its farthest point first: the chord of a ring is a point, which measures nothing.
  const closed = kind === 'lake' && line.length > 3 && line[0]![0] === line.at(-1)![0] && line[0]![1] === line.at(-1)![1];
  const far = closed ? line.reduce((best, p, i) => (Math.hypot(p[0] - line[0]![0], p[1] - line[0]![1]) > Math.hypot(line[best]![0] - line[0]![0], line[best]![1] - line[0]![1]) ? i : best), 0) : 0;
  const kept = closed ? [...simplify(line.slice(0, far + 1), TOLERANCE).slice(0, -1), ...simplify(line.slice(far), TOLERANCE)] : simplify(line, TOLERANCE);
  const q = kept.map(([lon, lat]): P => [Math.round(lon * 1e4), Math.round(lat * 1e4)]).filter((p, i, all) => i === 0 || p[0] !== all[i - 1]![0] || p[1] !== all[i - 1]![1]);
  if (q.length < 2) return;
  const steps = q.slice(1).flatMap(([x, y], i) => [x - q[i]![0], y - q[i]![1]]);
  points += q.length;
  rows.push(`  [${JSON.stringify(name)}, ${JSON.stringify(kind)}, ${q[0]![0]}, ${q[0]![1]}, ${steps.join(', ')}],`);
};
for (const element of rivers.elements) if (element.geometry) add(element.tags?.name ?? 'River', 'river', element.geometry);
for (const element of still.elements) {
  const ring = element.geometry;
  if (ring && ring.length > 3 && ring[0]!.lat === ring.at(-1)!.lat && ring[0]!.lon === ring.at(-1)!.lon) add(element.tags?.name ?? 'Water', 'lake', ring);
}
const file = `/**
 * The rivers and still water of the four Ogun city play areas and the corridors between them: OpenStreetMap waterway ways
 * named ${RIVERS.replace(/\|/g, ', ')} (lines) and named closed natural=water ways (rings) in the box ${BOX.join(', ')}
 * (south, west, north, east), kept when a vertex lies inside the Ogun State outline. Water that the source maps as a
 * multipolygon relation is not included.
 * © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright). Generated by
 * scripts/geo/build-ogun-water.ts from the Overpass interpreter; source sha256 ${hash}.
 * Douglas-Peucker tolerance ${TOLERANCE} degrees, quantised to 0.0001 degrees. ${rows.length} lines, ${points} points.
 * Each row: name, kind ("river" line or "lake" ring), first longitude and latitude in 0.0001 degrees, then the steps to
 * every next vertex as longitude and latitude pairs. The export name is OGUN_WATER.
 */
export const OGUN_WATER: readonly (readonly (string | number)[])[] = [
${rows.join('\n')}
];
`;
writeFileSync(new URL('../../src/game/cities/ogun/water.ts', import.meta.url), file);
console.log(`${rows.length} lines, ${points} points, ${file.length} bytes`);
