/**
 * Regenerates src/game/cities/port-harcourt/roads.ts: the main roads of the Port Harcourt play area, from OpenStreetMap
 * (© OpenStreetMap contributors, ODbL 1.0) through the public Overpass interpreter.
 *
 *   node --experimental-strip-types scripts/geo/build-rivers-roads.ts
 *
 * Motorway, trunk and primary ways in the box covering the seven opened local governments, and named secondary ways in
 * the city core, are simplified (Douglas-Peucker; the tolerance is in the generated header) and quantised to 0.0001 degrees
 * (about 11 m). A way is kept only when some vertex lies inside the play area. Each road is
 * [name, major, first longitude, first latitude, then steps in 0.0001 degrees].
 * Nothing is drawn that the source does not hold, and no junction is invented.
 */
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { riversCityGeometry } from '../../src/game/cities/port-harcourt/geometry.ts';

const BOX = [4.44, 6.72, 5.27, 7.51] as const;
// The city core (south, west, north, east): the old township, Diobu, the GRAs, Rumuola, Trans-Amadi and Rumuokoro.
const CORE = [4.74, 6.93, 4.9, 7.1] as const;
const FAR_TOLERANCE = 0.0008, CORE_TOLERANCE = 0.0004;
const ENDPOINT = 'https://overpass-api.de/api/interpreter';

interface Way { id: number; tags: Record<string, string>; geometry: { lat: number; lon: number }[] }
async function query(text: string): Promise<{ raw: string; ways: Way[] }> {
  // The public interpreter rate-limits: wait and ask again.
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'User-Agent': 'allworld-geo-build', 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(text)}` });
    if (response.status === 429 || response.status === 504) { await new Promise((resolve) => setTimeout(resolve, 30000)); continue; }
    if (!response.ok) throw new Error(`Overpass answered ${response.status}`);
    const raw = await response.text();
    return { raw, ways: (JSON.parse(raw) as { elements: Way[] }).elements };
  }
  throw new Error('Overpass kept refusing the request');
}

type P = [number, number];
function simplify(points: P[], tolerance: number): P[] {
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
const inBox = (box: readonly number[], [lon, lat]: P): boolean => lat >= box[0]! && lat <= box[2]! && lon >= box[1]! && lon <= box[3]!;
// A way is kept only when some vertex lies inside the seven opened local governments: the box also reaches into the rest of Rivers, Abia and Imo.
const playArea = riversCityGeometry().playArea;
const inPlayArea = ([lon, lat]: P): boolean => playArea.some((polygon) => polygon.reduce((inside, ring) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit ? !inside : inside;
}, false));

const major = await query(`[out:json][timeout:90];way["highway"~"^(motorway|trunk|primary)$"](${BOX.join(',')});out geom tags;`);
const secondary = await query(`[out:json][timeout:90];way["highway"="secondary"]["name"](${CORE.join(',')});out geom tags;`);
const digest = createHash('sha256').update(major.raw).update(secondary.raw).digest('hex');

const rows: string[] = [];
let points = 0;
const add = (way: Way, isMajor: boolean, tolerance: number): void => {
  const line: P[] = way.geometry.map((g) => [g.lon, g.lat]);
  const kept = simplify(line, tolerance).filter((p, i, all) => i === 0 || p[0] !== all[i - 1]![0] || p[1] !== all[i - 1]![1]);
  if (kept.length < 2 || !kept.some((p) => inBox(BOX, p) && inPlayArea(p))) return;
  const q = kept.map(([lon, lat]): P => [Math.round(lon * 1e4), Math.round(lat * 1e4)]);
  const steps = q.slice(1).flatMap(([x, y], i) => [x - q[i]![0], y - q[i]![1]]);
  const name = (way.tags.name ?? way.tags.ref ?? '').replace(/\s+/g, ' ').trim() || 'Road';
  points += q.length;
  rows.push(`  [${JSON.stringify(name)}, ${isMajor ? 1 : 0}, ${q[0]![0]}, ${q[0]![1]}, ${steps.join(', ')}],`);
};
for (const way of major.ways) add(way, way.tags.highway !== 'primary', way.geometry[0] && inBox(CORE, [way.geometry[0].lon, way.geometry[0].lat]) ? CORE_TOLERANCE : FAR_TOLERANCE);
const seen = new Set<number>(major.ways.map((way) => way.id));
for (const way of secondary.ways) if (!seen.has(way.id)) { seen.add(way.id); add(way, false, CORE_TOLERANCE); }

const file = `/**
 * The main roads of the Port Harcourt play area: OpenStreetMap motorway, trunk and primary ways in the box
 * ${BOX.join(', ')} (south, west, north, east) and named secondary ways in the city core ${CORE.join(', ')}.
 * © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright). Generated by
 * scripts/geo/build-rivers-roads.ts from the Overpass interpreter; source sha256 ${digest}.
 * Douglas-Peucker tolerance ${FAR_TOLERANCE} degrees (${CORE_TOLERANCE} in the core), quantised to 0.0001 degrees.
 * ${rows.length} ways, ${points} points. Each row: name, major (1/0), first longitude and latitude in
 * 0.0001 degrees, then the steps to every next vertex as longitude and latitude pairs.
 */
export const PORT_HARCOURT_ROADS: readonly (readonly (string | number)[])[] = [
${rows.join('\n')}
];
`;
writeFileSync(new URL('../../src/game/cities/port-harcourt/roads.ts', import.meta.url), file);
console.log(`${rows.length} ways, ${points} points, ${file.length} bytes`);
