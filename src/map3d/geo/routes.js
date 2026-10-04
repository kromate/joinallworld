/**
 * OWNER: world
 * The lines between places: Nigeria's trunk roads, the links between cities, the planned routes
 * between countries, and where a traveller is along one. Pure — no Three.js, no DOM.
 *
 * THE ROADS ARE STYLISED. Each is a list of real towns in the order the road passes them, written
 * from general knowledge and joined by straight lines; it shows which way a road goes, not its bends.
 * Town positions are approximate (two decimal places of a degree).
 *
 *   HIGHWAYS                        the trunk roads drawn at the Nigeria level
 *   AIRPORTS                        the main cities' airports
 *   linkPath(link)                  → { id, mode, towns?, points: [[lon, lat]…] } for a CITY_LINKS entry
 *   measure(points)                 → { points: [[x, y]…], lengths, total } in map units
 *   pointAlong(line, progress)      → { x, y, heading } at 0…1 of a measured line
 *   arcPoint(a, b, progress, lift)  → { x, y, height, heading } along a flight: a straight ground track that rises and falls
 *   flightPoint(a, b, progress, lift)  the same, bowed to one side as it is drawn on the map
 *   interCityTripOf(state)          → { key, from, to, mode, duration, remaining } | null — the server's timer (see ../trip.js)
 *   travelEase(u)                   the same gentle start and stop the city trips use
 */
import { project } from './projection.js';

/** @type {Record<string, [number, number]>} lon, lat */
export const TOWNS = Object.freeze({
  lagos: [3.38, 6.52], shagamu: [3.65, 6.84], ibadan: [3.9, 7.38], oyo: [3.93, 7.85], ogbomosho: [4.25, 8.13], ilorin: [4.55, 8.5], jebba: [4.82, 9.13], mokwa: [5.05, 9.3], bida: [6.01, 9.08], suleja: [7.18, 9.18], abuja: [7.49, 9.06],
  'ijebu-ode': [3.92, 6.82], ore: [4.87, 6.75], benin: [5.62, 6.34], agbor: [6.19, 6.25], asaba: [6.73, 6.2], onitsha: [6.79, 6.15], owerri: [7.03, 5.48], 'port-harcourt': [7.03, 4.82],
  kaduna: [7.44, 10.52], zaria: [7.7, 11.07], kano: [8.52, 12], gwagwalada: [7.08, 8.94], abaji: [6.94, 8.47], 'koton-karfe': [6.8, 8.1], lokoja: [6.74, 7.8],
  ife: [4.56, 7.48], akure: [5.19, 7.25], owo: [5.59, 7.2], okene: [6.23, 7.55],
  enugu: [7.5, 6.44], okigwe: [7.35, 5.82], umuahia: [7.49, 5.53], aba: [7.37, 5.11],
  keffi: [7.87, 8.85], lafia: [8.52, 8.49], makurdi: [8.53, 7.73], otukpo: [8.13, 7.19], 'ninth-mile': [7.4, 6.43],
  wudil: [8.84, 11.81], azare: [10.19, 11.68], potiskum: [11.08, 11.71], damaturu: [11.96, 11.75], maiduguri: [13.16, 11.85],
  sapele: [5.69, 5.89], warri: [5.75, 5.52], ughelli: [6, 5.5], patani: [6.19, 5.23], mbiama: [6.45, 5.06], ahoada: [6.65, 5.08], eleme: [7.12, 4.79], ogoni: [7.38, 4.67], eket: [7.92, 4.65], oron: [8.23, 4.82],
});
export const TOWN_NAMES = Object.freeze({ 'ijebu-ode': 'Ijebu Ode', 'port-harcourt': 'Port Harcourt', 'koton-karfe': 'Koton Karfe', 'ninth-mile': 'Ninth Mile', benin: 'Benin City' });
export const townName = (id) => TOWN_NAMES[id] || id.charAt(0).toUpperCase() + id.slice(1);

/** @typedef {{ id: string, name: string, towns: string[] }} Highway */
/** @type {readonly Highway[]} */
export const HIGHWAYS = Object.freeze([
  { id: 'lagos-ibadan', name: 'Lagos–Ibadan Expressway', towns: ['lagos', 'shagamu', 'ibadan'] },
  { id: 'ibadan-abuja', name: 'Ibadan–Ilorin–Abuja road', towns: ['ibadan', 'oyo', 'ogbomosho', 'ilorin', 'jebba', 'mokwa', 'bida', 'suleja', 'abuja'] },
  { id: 'lagos-port-harcourt', name: 'Lagos–Benin–Onitsha–Port Harcourt road', towns: ['lagos', 'shagamu', 'ijebu-ode', 'ore', 'benin', 'agbor', 'asaba', 'onitsha', 'owerri', 'port-harcourt'] },
  { id: 'abuja-kano', name: 'Abuja–Kaduna–Kano road', towns: ['abuja', 'suleja', 'kaduna', 'zaria', 'kano'] },
  { id: 'abuja-lokoja', name: 'Abuja–Lokoja road', towns: ['abuja', 'gwagwalada', 'abaji', 'koton-karfe', 'lokoja'] },
  { id: 'enugu-port-harcourt', name: 'Enugu–Port Harcourt Expressway', towns: ['enugu', 'okigwe', 'umuahia', 'aba', 'port-harcourt'] },
  { id: 'kano-maiduguri', name: 'Kano–Maiduguri road', towns: ['kano', 'wudil', 'azare', 'potiskum', 'damaturu', 'maiduguri'] },
  { id: 'east-west', name: 'East–West Road', towns: ['warri', 'ughelli', 'patani', 'mbiama', 'ahoada', 'port-harcourt', 'eleme', 'ogoni', 'eket', 'oron'] },
]);

/** The main cities' airports: [lon, lat], beside the city rather than on top of it. */
export const AIRPORTS = Object.freeze([
  { id: 'los', city: 'lagos', name: 'Lagos · Murtala Muhammed', at: [3.32, 6.58] }, { id: 'abv', city: 'abuja', name: 'Abuja · Nnamdi Azikiwe', at: [7.26, 9.01] },
  { id: 'phc', city: 'port-harcourt', name: 'Port Harcourt · Omagwa', at: [6.95, 5.02] }, { id: 'kan', city: 'kano', name: 'Kano · Mallam Aminu Kano', at: [8.52, 12.05] },
  { id: 'enu', city: 'enugu', name: 'Enugu · Akanu Ibiam', at: [7.56, 6.47] }, { id: 'ibd', city: 'ibadan', name: 'Ibadan · Alakia', at: [3.98, 7.36] },
]);

/** The towns a road link between two cities passes, keyed "a:b" by the link's own a and b. */
const ROAD_LINKS = {
  'lagos:ibadan': ['lagos', 'shagamu', 'ibadan'],
  'lagos:abuja': ['lagos', 'shagamu', 'ibadan', 'ife', 'akure', 'owo', 'okene', 'lokoja', 'koton-karfe', 'abaji', 'gwagwalada', 'abuja'],
  'lagos:port-harcourt': ['lagos', 'shagamu', 'ijebu-ode', 'ore', 'benin', 'sapele', 'warri', 'ughelli', 'patani', 'mbiama', 'ahoada', 'port-harcourt'],
  'ibadan:abuja': ['ibadan', 'oyo', 'ogbomosho', 'ilorin', 'jebba', 'mokwa', 'bida', 'suleja', 'abuja'],
  'abuja:port-harcourt': ['abuja', 'keffi', 'lafia', 'makurdi', 'otukpo', 'ninth-mile', 'enugu', 'okigwe', 'umuahia', 'aba', 'port-harcourt'],
};
export const linkId = (link) => `${link.a}:${link.b}:${link.mode}`;

/**
 * The line a link between two cities follows: a road through its towns, or a flight between the two cities.
 * @param {{ a: string, b: string, mode: string }} link @param {(cityId: string) => { lon: number, lat: number } | null} cityAt
 * @returns {{ id: string, mode: string, towns: string[] | null, points: [number, number][] } | null}
 */
export function linkPath(link, cityAt) {
  const a = cityAt(link.a), b = cityAt(link.b);
  if (!a || !b) return null;
  if (link.mode === 'air') return { id: linkId(link), mode: 'air', towns: null, points: [[a.lon, a.lat], [b.lon, b.lat]] };
  const towns = ROAD_LINKS[`${link.a}:${link.b}`] || null;
  return { id: linkId(link), mode: link.mode, towns, points: towns ? towns.map((town) => TOWNS[town]) : [[a.lon, a.lat], [b.lon, b.lat]] };
}

/** Longitude/latitude points → map units with the running length, ready for pointAlong. */
export function measure(points) {
  const flat = points.map(([lon, lat]) => project(lon, lat)), lengths = [0];
  for (let i = 1; i < flat.length; i++) lengths.push(lengths[i - 1] + Math.hypot(flat[i][0] - flat[i - 1][0], flat[i][1] - flat[i - 1][1]));
  return { points: flat, lengths, total: lengths[lengths.length - 1] };
}
const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

/** Where 0…1 of the way along a measured line is, and which way the traveller faces (radians, 0 = east, anticlockwise). */
export function pointAlong(line, progress) {
  const want = clamp01(progress) * line.total;
  let i = 1;
  while (i < line.lengths.length - 1 && line.lengths[i] < want) i += 1;
  const a = line.points[i - 1], b = line.points[i], span = line.lengths[i] - line.lengths[i - 1] || 1, k = clamp01((want - line.lengths[i - 1]) / span);
  return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, heading: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}

/** A flight: straight over the ground from a to b (map units), rising to `lift` at the middle. */
export function arcPoint(a, b, progress, lift) {
  const k = clamp01(progress);
  return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, height: 4 * lift * k * (1 - k), heading: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}
/** How far a flight's line bows to one side on the map, as a share of its length: it reads as a flight, not a road. */
export const BOW = 0.07;
/** A flight as it is drawn: the arc of arcPoint, bowed to the left of the direction of travel from a to b. */
export function flightPoint(a, b, progress, lift) {
  const at = arcPoint(a, b, progress, lift), k = Math.max(0, Math.min(1, progress)), side = 4 * BOW * k * (1 - k);
  return { ...at, x: at.x - (b[1] - a[1]) * side, y: at.y + (b[0] - a[0]) * side, heading: at.heading + Math.atan2(BOW * 4 * (1 - 2 * k), 1) };
}
/** How high a flight of this length climbs, in map units: longer flights arc higher, within reason. */
export const liftOf = (length) => Math.max(0.25, Math.min(14, length * 0.16));

/** Gentle away from the stop and into the next one; 0 → 0 and 1 → 1. */
export const travelEase = (u) => { const k = clamp01(u); return k * 0.55 + 0.45 * (k * k * (3 - 2 * k)); };

/**
 * The trip between cities in a state, or null. The server owns the timer:
 * state.activeAction = { kind: 'intercity', id: destination city, from, mode: 'road' | 'air', duration, remaining }.
 */
export function interCityTripOf(state) {
  const active = state?.activeAction;
  if (!active || active.kind !== 'intercity' || typeof active.id !== 'string' || typeof active.from !== 'string' || active.id === active.from) return null;
  const duration = Number.isFinite(active.duration) && active.duration > 0 ? active.duration : 1;
  const remaining = Math.max(0, Math.min(duration, Number.isFinite(active.remaining) ? active.remaining : duration));
  const mode = active.mode === 'air' ? 'air' : 'road';
  return { key: `intercity|${active.from}|${active.id}|${mode}|${duration}`, from: active.from, to: active.id, mode, duration, remaining };
}

/**
 * Where the traveller is at `progress` (0…1) of a link, walked from `from` (the link may be stored the other way round).
 * @returns {{ x: number, y: number, height: number, heading: number, mode: string }}
 */
export function tripPoint(path, line, from, progress) {
  const reversed = !path.id.startsWith(`${from}:`), k = travelEase(progress), at = reversed ? 1 - k : k;
  if (path.mode === 'air') {
    const a = line.points[0], b = line.points[line.points.length - 1], spot = flightPoint(a, b, at, liftOf(line.total));
    return { ...spot, heading: reversed ? spot.heading + Math.PI : spot.heading, mode: 'air' };
  }
  const spot = pointAlong(line, at);
  return { ...spot, height: 0, heading: reversed ? spot.heading + Math.PI : spot.heading, mode: path.mode };
}
