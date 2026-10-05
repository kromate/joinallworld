/**
 * Regenerates src/game/cities/ogun/roads.ts: the main roads of the Ogun city play areas and the corridors between them, from OpenStreetMap
 * (© OpenStreetMap contributors, ODbL 1.0) through the public Overpass interpreter.
 *
 *   node --experimental-strip-types scripts/geo/build-ogun-roads.ts
 *
 * Motorway, trunk and primary ways in the box covering the four city play areas and their corridors (Lagos-Abeokuta,
 * Lagos-Ibadan, Abeokuta-Ibadan, Sagamu-Ijebu-Ode-Ore), and named secondary ways in the four town cores, are
 * simplified (Douglas-Peucker; the tolerance is in the generated header) and quantised to 0.0001 degrees
 * (about 11 m). Each road is [name, major, first longitude, first latitude, then steps in 0.0001 degrees].
 * Nothing is drawn that the source does not hold, and no junction is invented.
 */
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { OGUN_STATE } from '../../src/map3d/geo/data/ogun.ts';
import { decodeTopology } from '../../src/map3d/geo/topo.ts';

const BOX = [6.45, 2.85, 7.5, 4.1] as const;
// The four town cores (south, west, north, east): Abeokuta, Ota, Ijebu-Ode and Sagamu.
const CORES = [[7.1, 3.26, 7.24, 3.46], [6.62, 3.08, 6.74, 3.28], [6.78, 3.88, 6.86, 3.98], [6.8, 3.6, 6.9, 3.75]] as const;
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
// A way is kept only when some vertex lies inside the Ogun State outline: the box also reaches into Lagos and Oyo.
const outline = decodeTopology(OGUN_STATE).features[0]!.rings;
const inState = ([lon, lat]: P): boolean => outline.some((polygon) => polygon.reduce((inside, ring) => {
  let hit = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) if ((ring[i + 1]! > lat) !== (ring[j + 1]! > lat) && lon < ((ring[j]! - ring[i]!) * (lat - ring[i + 1]!)) / (ring[j + 1]! - ring[i + 1]!) + ring[i]!) hit = !hit;
  return hit ? !inside : inside;
}, false));
const inCore = (p: P): boolean => CORES.some((core) => inBox(core, p));

const major = await query(`[out:json][timeout:90];way["highway"~"^(motorway|trunk|primary)$"](${BOX.join(',')});out geom tags;`);
const secondaries = [];
for (const core of CORES) secondaries.push(await query(`[out:json][timeout:90];way["highway"="secondary"]["name"](${core.join(',')});out geom tags;`));
const hash = createHash('sha256').update(major.raw);
for (const part of secondaries) hash.update(part.raw);
const digest = hash.digest('hex');

const rows: string[] = [];
let points = 0;
const add = (way: Way, isMajor: boolean, tolerance: number): void => {
  const line: P[] = way.geometry.map((g) => [g.lon, g.lat]);
  const kept = simplify(line, tolerance).filter((p, i, all) => i === 0 || p[0] !== all[i - 1]![0] || p[1] !== all[i - 1]![1]);
  if (kept.length < 2 || !kept.some((p) => inBox(BOX, p) && inState(p))) return;
  const q = kept.map(([lon, lat]): P => [Math.round(lon * 1e4), Math.round(lat * 1e4)]);
  const steps = q.slice(1).flatMap(([x, y], i) => [x - q[i]![0], y - q[i]![1]]);
  const name = (way.tags.name ?? way.tags.ref ?? '').replace(/\s+/g, ' ').trim() || 'Road';
  points += q.length;
  rows.push(`  [${JSON.stringify(name)}, ${isMajor ? 1 : 0}, ${q[0]![0]}, ${q[0]![1]}, ${steps.join(', ')}],`);
};
for (const way of major.ways) add(way, way.tags.highway !== 'primary', inCore(way.geometry[0] ? [way.geometry[0].lon, way.geometry[0].lat] : [0, 0]) ? CORE_TOLERANCE : FAR_TOLERANCE);
const seen = new Set<number>();
for (const part of secondaries) for (const way of part.ways) if (!seen.has(way.id)) { seen.add(way.id); add(way, false, CORE_TOLERANCE); }

const file = `/**
 * The main roads of the Ogun city play areas and the corridors between them: OpenStreetMap motorway, trunk and primary ways in the box
 * ${BOX.join(', ')} (south, west, north, east) and named secondary ways in the four town cores
 * ${CORES.map((core) => core.join(', ')).join('; ')}.
 * © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright). Generated by
 * scripts/geo/build-ogun-roads.ts from the Overpass interpreter; source sha256 ${digest}.
 * Douglas-Peucker tolerance ${FAR_TOLERANCE} degrees (${CORE_TOLERANCE} in the core), quantised to 0.0001 degrees.
 * ${rows.length} ways, ${points} points. Each row: name, major (1/0), first longitude and latitude in
 * 0.0001 degrees, then the steps to every next vertex as longitude and latitude pairs.
 */
export const OGUN_ROADS: readonly (readonly (string | number)[])[] = [
${rows.join('\n')}
];
`;
writeFileSync(new URL('../../src/game/cities/ogun/roads.ts', import.meta.url), file);
console.log(`${rows.length} ways, ${points} points, ${file.length} bytes`);
