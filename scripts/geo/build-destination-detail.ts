/**
 * Regenerates the city-wide geography of one foreign destination from OpenStreetMap (© OpenStreetMap contributors, ODbL 1.0)
 * through the public Overpass interpreter:
 *
 *   ALLWORLD_GEO_CACHE=<directory outside the repository> node --experimental-strip-types scripts/geo/build-destination-detail.ts cairo
 *
 * It writes, in src/game/cities/<id>/:
 *   places.ts    the real named places that stand in for the generic game venues, each with its OpenStreetMap element
 *   geometry.ts  the play-area outline (built-up extent traced from mapped land use)
 *   terrain.ts   water polygons, main roads and the ground labels
 * The choices (which element becomes which venue, which names label the ground) are in scripts/geo/destination-detail/<id>.ts.
 * Nothing is drawn that the source does not hold: a name and a point are read from the recorded element, never typed in.
 * Four requests at most, one at a time, 30 seconds apart; every answer is cached outside the repository (overpass.ts).
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { ask } from './destination-detail/overpass.ts';
import type { Element } from './destination-detail/overpass.ts';
import type { DetailConfig } from './destination-detail/config.ts';
import { areaRings, builtUp, inBox, polygonsOf, round, roundRing, simplify, simplifyRing } from './destination-detail/geometry-tools.ts';
import type { P } from './destination-detail/geometry-tools.ts';

const id = process.argv[2];
if (!id) throw new Error('Usage: build-destination-detail.ts <city id>');
const config = (await import(`./destination-detail/${id}.ts`) as { CONFIG: DetailConfig }).CONFIG;
const out = (file: string): URL => new URL(`../../src/game/cities/${id}/${file}`, import.meta.url);
const [south, west, north, east] = config.box;
const bbox = `${south},${west},${north},${east}`;
const sha = (...parts: string[]): string => createHash('sha256').update(parts.join('')).digest('hex');
const refOf = (element: Element): string => `${element.type}/${element.id}`;
const centreOf = (element: Element): P => {
  if (element.type === 'node') return [element.lon!, element.lat!];
  if (!element.center) throw new Error(`${refOf(element)} has no centre`);
  return [element.center.lon, element.center.lat];
};

// ---- places -----------------------------------------------------------------------------------------------------------------------
const discoveries = [];
for (const [label, query] of Object.entries(config.discovery(bbox))) discoveries.push(await ask(id, label, query));
const discoverySha = discoveries.map((answer) => answer.sha256);
const byRef = new Map(discoveries.flatMap((answer) => answer.elements).map((element) => [refOf(element), element]));
const pick = (ref: string): Element => {
  const element = byRef.get(ref);
  if (!element) throw new Error(`${ref} is not in the recorded answer`);
  return element;
};
const nameOf = (element: Element): string => (element.tags?.['name:en'] ?? element.tags?.name ?? '').replace(/\s+/g, ' ').trim();

const labelled = config.names.map((choice) => ({ name: choice.label ?? nameOf(pick(choice.ref)), at: centreOf(pick(choice.ref)) }));
/** The district of a place is the nearest labelled suburb within one kilometre, else the whole area. */
const districtOf = ([lon, lat]: P): string => {
  const metres = ([x, y]: P): number => Math.hypot((x - lon) * 111320 * Math.cos(lat * Math.PI / 180), (y - lat) * 110574);
  const nearest = labelled.map((label) => ({ label, d: metres(label.at) })).sort((a, b) => a.d - b.d)[0];
  return nearest && nearest.d <= 1000 ? nearest.label.name : config.name;
};

const places = config.places.map((choice) => {
  const element = pick(choice.ref);
  const [lon, lat] = centreOf(element);
  const name = choice.label ?? nameOf(element);
  if (!name) throw new Error(`${choice.ref} has no English name`);
  if (!inBox(config.box, [lon, lat])) throw new Error(`${choice.ref} lies outside the play box`);
  return {
    ...(choice.slot ? { slot: choice.slot } : { key: choice.key }),
    name, district: districtOf([lon, lat]), kind: choice.kind, category: choice.category, icon: choice.icon,
    lon: round(lon, 6), lat: round(lat, 6), line: choice.line, osm: choice.ref,
    ...(element.tags?.wikidata ? { wikidata: element.tags.wikidata } : {}),
    accuracy: element.type === 'node' ? 'mapped-feature' : 'feature-centroid',
  };
});

const labels = config.names.map((choice) => {
  const element = pick(choice.ref);
  const [lon, lat] = centreOf(element);
  const name = choice.label ?? nameOf(element);
  if (!name) throw new Error(`${choice.ref} has no English name`);
  return { id: choice.id, name, lon: round(lon, 5), lat: round(lat, 5), kind: choice.kind };
});

writeFileSync(out('places.ts'), `/**
 * Real places of ${config.name} that replace the generic game venues. Every place is one OpenStreetMap element of the recorded
 * answers (sha256 ${discoverySha.join(', ')}) to the queries in scripts/geo/destination-detail/${id}.ts; its name is the element's
 * English name and its point is the node, or the centre of the way or relation. © OpenStreetMap contributors, ODbL 1.0
 * (https://www.openstreetmap.org/copyright). Generated by scripts/geo/build-destination-detail.ts; do not edit by hand.
 */
import type { DestinationPlace } from '../africa/types.ts'

export const PLACES: readonly DestinationPlace[] = ${JSON.stringify(places, null, 2)}
`);
console.log(`places ${places.length}, labels ${labels.length}`);

// ---- outline, water and roads ---------------------------------------------------------------------------------------------------------
const waterAnswer = await ask(id, 'water', config.water(bbox));
const water = waterAnswer.elements.flatMap((element) => polygonsOf(areaRings(element), config.box, config.waterTolerance));
if (!water.length) throw new Error('The water answer left no water polygon in the box');

const landuse = await ask(id, 'landuse', config.landuse(bbox));
const usePoints = landuse.elements.map((element): P => centreOf(element));
const anchors = [...places.map((place): P => [place.lon, place.lat]), ...labelled.map((label) => label.at)];
const traced = builtUp(usePoints, anchors, water, config.box, { cell: config.cell, split: config.split, grow: config.grow, minHole: config.minHole, shore: config.shore });
const tidy = (polygons: P[][][]): P[][][] => polygons.map((polygon) => polygon.map((ring) => simplifyRing(ring, config.outlineTolerance)).filter((ring) => ring.length)).filter((polygon) => polygon.length);
const land = tidy(traced.land), play = tidy(traced.play);
if (!land.length) throw new Error('The land-use answer left no built-up area in the box');
const lonLat = (polygons: P[][][]): string => JSON.stringify(polygons.map((polygon) => polygon.map(roundRing)));

writeFileSync(out('geometry.ts'), `/**
 * The play-area outline of ${config.name}: ${config.boundaryNote}. Land-use points: ${usePoints.length}, traced on a ${config.cell} degree grid
 * grown by ${config.grow} cells and kept round every place of the game, then cut to a ${config.cell / config.split} degree grid with the Nile taken out of the land
 * (the play area keeps it), and simplified (Douglas-Peucker, ${config.outlineTolerance} degrees). A sketch at the grid's size, not a surveyed edge. © OpenStreetMap contributors, ODbL 1.0. Generated by scripts/geo/build-destination-detail.ts
 * from the Overpass interpreter; source sha256 ${landuse.sha256}. Loaded only with this city's map.
 */
import type { DestinationGeometry } from '../africa/map.ts'

export const GEOMETRY: DestinationGeometry = {
  land: ${lonLat(land)},
  playArea: ${lonLat(play)},
  buildings: [], roads: [],
}
`);

const roadsAnswer = await ask(id, 'roads', config.roads(bbox, `${config.core.join(',')}`));
const candidates: { row: string; km: number; points: number; major: boolean }[] = [];
const lengthKm = (line: P[]): number => line.slice(1).reduce((sum, [lon, lat], i) => sum + Math.hypot((lon - line[i]![0]) * 111.32 * Math.cos(lat * Math.PI / 180), (lat - line[i]![1]) * 110.57), 0);
for (const way of roadsAnswer.elements) {
  if (way.type !== 'way' || !way.geometry || !way.tags?.highway) continue;
  const isMajor = way.tags.highway === 'motorway' || way.tags.highway === 'trunk';
  const near = inBox(config.core, [way.geometry[0]!.lon, way.geometry[0]!.lat]);
  const kept = simplify(way.geometry.map((g): P => [g.lon, g.lat]), near ? config.coreTolerance : config.farTolerance)
    .filter((p, i, all) => i === 0 || p[0] !== all[i - 1]![0] || p[1] !== all[i - 1]![1]);
  if (kept.length < 2 || !kept.some((p) => inBox(config.box, p))) continue;
  const km = lengthKm(kept);
  // A short unmajor piece is a junction fragment, not a road a player can read at this scale.
  if (!isMajor && km < config.minRoadKm) continue;
  const q = kept.map(([lon, lat]): P => [Math.round(lon * 1e4), Math.round(lat * 1e4)]);
  const steps = q.slice(1).flatMap(([x, y], i) => [x - q[i]![0], y - q[i]![1]]);
  const name = (way.tags['name:en'] ?? way.tags.name ?? way.tags.ref ?? '').replace(/\s+/g, ' ').trim() || 'Road';
  candidates.push({ row: `  [${JSON.stringify(name)}, ${isMajor ? 1 : 0}, ${q[0]![0]}, ${q[0]![1]}, ${steps.join(', ')}],`, km, points: q.length, major: isMajor });
}
const chosen = candidates.sort((a, b) => Number(b.major) - Number(a.major) || b.km - a.km).slice(0, config.maxRoads);
const rows = chosen.map((road) => road.row);
const points = chosen.reduce((sum, road) => sum + road.points, 0);
const trunk = [...new Set(roadsAnswer.elements.filter((way) => way.tags?.highway === 'motorway' || way.tags?.highway === 'trunk').map((way) => way.tags?.['name:en'] ?? way.tags?.name).filter((name): name is string => Boolean(name)))];

const terrainSha = sha(landuse.sha256, waterAnswer.sha256, roadsAnswer.sha256);
writeFileSync(out('terrain.ts'), `/**
 * Water, main roads and ground labels of ${config.name}: ${config.terrainNote} © OpenStreetMap contributors, ODbL 1.0
 * (https://www.openstreetmap.org/copyright). Generated by scripts/geo/build-destination-detail.ts from the Overpass interpreter;
 * source sha256 ${terrainSha} (land use ${landuse.sha256}, water ${waterAnswer.sha256}, roads ${roadsAnswer.sha256}, places ${discoverySha.join(', ')}).
 * Roads: Douglas-Peucker ${config.farTolerance} degrees (${config.coreTolerance} in the core ${config.core.join(', ')}), quantised to 0.0001 degrees;
 * ${rows.length} ways of ${candidates.length} candidates (the longest first, none under ${config.minRoadKm} km unless motorway or trunk), ${points} points; each row is name, major (1/0), first longitude and latitude in 0.0001 degrees, then the steps to every
 * next vertex. Water: simplified ${config.waterTolerance} degrees. Loaded only with this city's map.
 */
import type { DestinationTerrain } from '../africa/map.ts'

export const TERRAIN: DestinationTerrain = {
  water: ${lonLat(water)},
  roads: [
${rows.join('\n')}
  ],
  trunkRoads: ${JSON.stringify(trunk)},
  names: ${JSON.stringify(labels)},
  source: ${JSON.stringify(config.source)},
  licence: 'ODbL-1.0',
}
`);
console.log(`land ${land.length} parts, water ${water.length} parts, roads ${rows.length} ways / ${points} points`);
