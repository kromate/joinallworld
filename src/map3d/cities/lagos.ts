import { LAGOS_LOCAL_UNIT_DESCRIPTIONS } from '../../game/cities/lagos/descriptions.ts';
/**
 * OWNER: world
 * City pack: Lagos State on its real shape. The land is the twenty local governments' open
 * boundaries (src/map3d/geo/lagos-shapes.ts, geoBoundaries ADM2), every part and hole kept and drawn
 * exactly as given; the lagoon, the creeks and the Atlantic are simply the space between and around
 * them. Nothing is stylised, compressed or invented about the outline.
 *
 * PROJECTION  the Nigeria map frame (src/map3d/geo/frame.ts): equirectangular, 9°N standard
 * parallel, one unit = 100 m, x east, z SOUTH, local = frame − ORIGINS.lagos (Lagos Island,
 * 3.40°E 6.45°N). Every coordinate below is written as longitude/latitude and converted once, at
 * module load, with toLocal(). Lagos tiles into the country map with no offset to remember.
 *
 * PLACED BY HAND  the venues, homes, roads and bridges are hand-placed from general geographic
 * knowledge, to within a few hundred metres, and each is tested to lie inside the local government
 * it belongs to. Where two landmarks of the central islands would overlap, the later one is pushed
 * apart by the minimum needed (never more than 250 m), keeping the real order and direction; the
 * outlines are never touched.
 *
 *   mainland  Ikeja and the airport inland, Mushin, Surulere, Yaba, Gbagada and Bariga along the
 *             lagoon shore, Apapa and its port in the south-west, Badagry far to the west
 *   lagoon    the Lagos Lagoon between the mainland and the barrier island, crossed by the Third
 *             Mainland, Carter and Eko bridges
 *   islands   Lagos Island, Ikoyi and Banana Island, Victoria Island, the Falomo and Lekki–Ikoyi
 *             link bridges, then the Lekki peninsula running east to the Lekki Free Zone
 *   edges     Ikorodu round the north-east of the lagoon, Epe across the Lekki lagoon
 *
 * Venue ids are the ones in src/game/content/venues.ts. The server's fare bands use the content
 * tables, not these positions: this is presentation only.
 *
 * A pack is plain data plus decorate(): the generic builder (src/map3d/city-build.ts) draws land,
 * roads, bridges, landmarks and the city fabric from the data; decorate() adds what only this
 * city has (the port, the airfield and the tank farm around the airport and refinery landmarks,
 * Eko Atlantic).
 */

import { LAGOS_LGAS } from '../../game/cities/lagos/localUnits.ts';
import { ORIGINS, toLocal } from '../geo/frame.ts';
import { lagosShapes } from '../geo/lagos-shapes.ts';
import { mapContext } from '../context.ts';
import { catalogueCitiesInState } from '../../game/cities/registry.ts';
import type { LonLatPolygon } from '../geo/lagos-shapes.ts';
import type { Box4, CityPack, DecorateBatch, PackBounds, PackDistrict, PackEstate, PackFabric, PackHome, PackLand, PackLga, PackRoad, PackSite, PackSoon, Point2, Rect } from '../types.ts';

export const id = 'lagos';
export const name = 'Lagos';

/** The projection this pack is drawn in (src/map3d/geo/frame.ts). */
export const frame = { origin: ORIGINS.lagos, unitsPerKm: 10 } as const;
/** Longitude, latitude (degrees) → this pack's local units [x, z]. */
const at = (lon: number, lat: number): Point2 => toLocal(ORIGINS.lagos, lon, lat);
/** A list of [lon, lat] → local points. */
const line = (list: readonly (readonly [number, number])[]): Point2[] => list.map(([lon, lat]) => at(lon, lat));

// ---- The real shapes ---------------------------------------------------------------------------------------------

const SHAPES = lagosShapes();
/** A ring of [lon, lat] in local units, without a repeated closing point. */
const ring = (points: readonly (readonly [number, number])[]): Point2[] => {
  const out = line(points);
  const first = out[0], last = out.at(-1);
  if (out.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) out.pop();
  return out;
};
const area = (points: readonly Point2[]): number => { let sum = 0; for (let i = 0, j = points.length - 1; i < points.length; j = i++) sum += (points[j]![0] + points[i]![0]) * (points[j]![1] - points[i]![1]); return Math.abs(sum / 2); };
/** Parts as [outer ring, ...holes] in local units. */
const localParts = (parts: readonly LonLatPolygon[]): Point2[][][] => parts.map((part) => part.map(ring));
const largest = (parts: readonly (readonly Point2[][])[]): Point2[] => parts.reduce((a, b) => (area(b[0]!) > area(a[0]!) ? b : a))[0]!;

const SHAPE_PARTS: Record<string, Point2[][][]> = Object.fromEntries(Object.entries(SHAPES.lgas).map(([lga, parts]) => [lga, localParts(parts)]));

/** The state's bounding box in degrees [south, west, north, east]. */
const stateBox = (): Box4 => {
  let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
  for (const part of SHAPES.state) for (const [lon, lat] of part[0]!) { south = Math.min(south, lat); north = Math.max(north, lat); west = Math.min(west, lon); east = Math.max(east, lon); }
  return [south, west, north, east];
};
/** The rough box of Lagos State [south, west, north, east] in degrees: a position outside it is "not in Lagos". */
export const geo: { box: Box4 } = { box: stateBox() };

// The whole state in local units, a sea margin around it (the open Atlantic lies to the south).
const [SOUTH, WEST, NORTH, EAST] = geo.box;
const NW = at(WEST, NORTH), SE = at(EAST, SOUTH);
const fit: Rect = { minX: NW[0], maxX: SE[0], minZ: NW[1], maxZ: SE[1] };
/** The board. `fit` is the whole state; `sea` is the open-water block the sea-plot layer uses (the Atlantic off Eti-Osa). */
export const bounds: PackBounds = {
  minX: fit.minX - 30, maxX: fit.maxX + 30, minZ: fit.minZ - 30, maxZ: fit.maxZ + 50, fit,
  sea: { x0: at(3.42, 6.40)[0], x1: at(3.62, 6.40)[0], z0: at(3.42, 6.395)[1], z1: at(3.42, 6.372)[1] },
};
/** The metropolitan core, where the venues are: Ikeja to the Lekki Conservation Centre and Yaba to Victoria Island. The default camera view. */
const coreNW = at(3.30, 6.62), coreSE = at(3.55, 6.40);
export const core: Rect = { minX: coreNW[0], maxX: coreSE[0], minZ: coreNW[1], maxZ: coreSE[1] };
/** A multiplier on road widths: at 100 m a unit the old 2.5-unit road would be 250 m wide. */
export const roadScale = 0.45;

/** Lagos Island, Eti-Osa (Ikoyi, Victoria Island, Lekki) and Ibeju-Lekki lie on the barrier coast; everything else is the mainland. */
const ISLAND_LGAS = new Set(['lagos-island', 'eti-osa', 'ibeju-lekki']);
/**
 * Land: one entry per part of every local government's boundary, exact (never rounded), holes kept.
 * Water is whatever the land does not cover. Eko Atlantic, reclaimed from the sea off Victoria
 * Island, is the only land that is not in the boundary data.
 */
export const land: PackLand[] = [
  ...Object.entries(SHAPE_PARTS).flatMap(([lga, parts]) => parts.map((part, i): PackLand => ({
    id: i ? `${lga}-${i + 1}` : lga, kind: ISLAND_LGAS.has(lga) ? 'island' : 'mainland', points: part[0]!, exact: true, ...(part.length > 1 ? { holes: part.slice(1) } : {}),
  }))),
  // Eko Atlantic: reclaimed from the Atlantic off the south-west of Victoria Island (about 6.409–6.417°N, 3.399–3.417°E).
  { id: 'eko-atlantic', kind: 'sand', exact: true, points: line([[3.399, 6.409], [3.417, 6.409], [3.417, 6.417], [3.399, 6.417]]) },
];

// ---- Roads and bridges --------------------------------------------------------------------------------------------
// Waypoints are [lon, lat], hand-placed from general knowledge to within a few hundred metres. Two roads meet where
// they share an exact point, so every junction is one named constant used by each road that joins there.

type LL = readonly [number, number];
const J: Record<string, LL> = {
  jibowu: [3.373, 6.517],          // where Ikorodu Road starts, at Yaba
  ojuelegba: [3.366, 6.511],       // Ojuelegba, on the Agege Motor Road
  oshodi: [3.347, 6.5555],         // Oshodi interchange
  mile2: [3.341, 6.47],            // Mile 2, where the Badagry Expressway leaves the Oshodi–Apapa road
  anthony: [3.388, 6.564],         // Anthony / Maryland, Ikorodu Road meets the Gbagada road
  ojota: [3.383, 6.579],           // Ojota, where the Lagos–Ibadan Expressway leaves Ikorodu Road
  ketu: [3.3985, 6.605],           // Ketu / Mile 12, Ikorodu Road bends east to Ikorodu
  agegeIkeja: [3.34, 6.582],       // Ikeja, where the airport road leaves the Agege Motor Road
  iddo: [3.377, 6.4745],           // Iddo / Ebute Metta, the mainland end of the Eko Bridge
  carterMain: [3.383, 6.4765],      // the mainland end of the Carter Bridge
  carterIsland: [3.389, 6.463],    // Idumota, the island end of the Carter Bridge
  ekoIsland: [3.384, 6.4595],      // the island end of the Eko Bridge
  tmbIsland: [3.4015, 6.458],      // the island end of the Third Mainland Bridge, at Adeniji Adele
  tmbMain: [3.4005, 6.5475],       // Oworonshoki, the mainland end of the Third Mainland Bridge
  marinaWest: [3.3925, 6.4555],    // where the island's western street joins Broad Street
  broadMid: [3.4015, 6.454],       // where the Third Mainland landing joins Broad Street
  ikoyiEast: [3.439, 6.4535],
  linkEnd: [3.4595, 6.443],        // Lekki Phase 1, the Lekki end of the Link Bridge      // the Ikoyi end of the Lekki–Ikoyi Link Bridge
  falomoNorth: [3.428, 6.4533],     // where the Falomo road leaves the Ikoyi road
  falomoSouth: [3.428, 6.435],     // Victoria Island, the south end of the Falomo Bridge
  admiralty: [3.472, 6.439],      // Lekki Phase 1, Admiralty Way meets the expressway
  eleko: [3.74, 6.466],            // Eleko, where the road to Epe and the road to the Free Zone part
};

export const roads: PackRoad[] = [
  // Mainland: Ikorodu Road runs north from Yaba; the Agege Motor Road from Ojuelegba through Mushin and Oshodi to Ikeja and Agege.
  { id: 'ikorodu', name: 'Ikorodu Road', major: true, points: line([J.jibowu!, [3.378, 6.53], [3.383, 6.546], J.anthony!, J.ojota!, [3.39, 6.593], J.ketu!]) },
  { id: 'ikorodu-north', name: 'Ikorodu Road', major: true, points: line([J.ketu!, [3.42, 6.615], [3.46, 6.62], [3.5105, 6.6194]]) },
  { id: 'agege', name: 'Agege Motor Road', major: true, points: line([J.ojuelegba!, [3.359, 6.526], [3.352, 6.54], J.oshodi!, [3.342, 6.568], J.agegeIkeja!, [3.335, 6.6], [3.329, 6.612], [3.32, 6.625]]) },
  { id: 'lagos-ibadan', name: 'Lagos–Ibadan Expressway', major: true, points: line([J.ojota!, [3.379, 6.603], [3.373, 6.625], [3.365, 6.642]]) },
  { id: 'gbagada', name: 'Gbagada Expressway', major: true, points: line([J.tmbMain!, [3.3945, 6.553], J.anthony!]) },
  { id: 'airport-road', name: 'Airport Road', major: true, points: line([J.agegeIkeja!, [3.33, 6.579], [3.3235, 6.578]]) },
  { id: 'oshodi-apapa', name: 'Oshodi–Apapa Expressway', major: true, points: line([J.oshodi!, [3.34, 6.53], [3.333, 6.51], [3.33, 6.49], J.mile2!, [3.356, 6.456], [3.36, 6.448]]) },
  { id: 'surulere', name: 'Western Avenue', points: line([J.jibowu!, J.ojuelegba!, [3.36, 6.504], [3.354, 6.495], [3.35, 6.485], J.mile2!]) },
  { id: 'herbert', name: 'Herbert Macaulay Way', points: line([J.iddo!, J.carterMain!, [3.381, 6.49], [3.377, 6.5], [3.3735, 6.51], J.jibowu!]) },
  { id: 'akoka', name: 'Akoka Road', points: line([[3.3735, 6.51], [3.386, 6.513], [3.3965, 6.516]]) },
  { id: 'badagry-expressway', name: 'Lagos–Badagry Expressway', major: true, points: line([J.mile2!, [3.32, 6.469], [3.29, 6.466], [3.25, 6.464], [3.21, 6.46], [3.17, 6.456], [3.12, 6.45], [3.05, 6.438], [2.98, 6.428], [2.92, 6.42], [2.8813, 6.4155]]) },
  // Bridges across the lagoon (each over the water between the mainland and the island, ends on land)
  { id: 'carter', name: 'Carter Bridge', bridge: 0.8, major: true, points: line([J.carterMain!, [3.386, 6.47], J.carterIsland!]) },
  { id: 'eko', name: 'Eko Bridge', bridge: 0.8, major: true, points: line([J.iddo!, [3.379, 6.4685], [3.3815, 6.4635], J.ekoIsland!]) },
  { id: 'third-mainland', name: 'Third Mainland Bridge', bridge: 1.2, major: true, points: line([J.tmbMain!, [3.4075, 6.542], [3.412, 6.533], [3.414, 6.52], [3.415, 6.505], [3.412, 6.49], [3.4065, 6.475], J.tmbIsland!]) },
  // Lagos Island and Ikoyi
  { id: 'broad', name: 'Broad Street', major: true, points: line([J.carterIsland!, [3.3905, 6.46], J.marinaWest!, [3.3975, 6.4545], J.broadMid!, [3.4085, 6.4535], [3.4165, 6.453], J.falomoNorth!, [3.4335, 6.4542], J.ikoyiEast!]) },
  { id: 'island-west', name: 'Marina', points: line([J.ekoIsland!, [3.387, 6.4565], J.marinaWest!]) },
  { id: 'adeniji', name: 'Adeniji Adele Road', points: line([J.tmbIsland!, J.broadMid!]) },
  { id: 'falomo-road', name: 'Kingsway Road', points: line([J.falomoNorth!, [3.4285, 6.444]]) },
  { id: 'falomo', name: 'Falomo Bridge', bridge: 0.6, points: line([[3.4285, 6.444], [3.4282, 6.4395], J.falomoSouth!]) },
  // The Lekki–Ikoyi link bridge and the peninsula: Victoria Island's Ozumba Mbadiwe Road and the Lekki–Epe Expressway
  { id: 'link', name: 'Lekki–Ikoyi Link Bridge', bridge: 1.2, pylon: true, major: true, points: line([J.ikoyiEast!, [3.445, 6.4522], [3.451, 6.4495], [3.456, 6.4458], J.linkEnd!]) },
  { id: 'link-landing', name: 'Admiralty Way', major: true, points: line([J.linkEnd!, [3.4635, 6.4395], J.admiralty!]) },
  { id: 'ozumba', name: 'Ozumba Mbadiwe Road', major: true, points: line([[3.408, 6.436], [3.418, 6.4345], J.falomoSouth!, [3.44, 6.435], [3.452, 6.4375], J.linkEnd!]) },
  { id: 'lekki-epe', name: 'Lekki–Epe Expressway', major: true, points: line([J.admiralty!, [3.49, 6.4465], [3.52, 6.45], [3.55, 6.456], [3.58, 6.462], [3.62, 6.466], [3.68, 6.465], J.eleko!]) },
  { id: 'free-zone', name: 'Lekki Free Zone Road', points: line([J.eleko!, [3.8, 6.45], [3.88, 6.44], [3.95, 6.433], [3.981, 6.4325]]) },
  { id: 'epe-road', name: 'Epe Road', major: true, points: line([J.eleko!, [3.8, 6.474], [3.86, 6.5], [3.92, 6.54], [3.96, 6.57], [3.9833, 6.5841]]) },
];

// ---- Venues, homes -------------------------------------------------------------------------------------------------

/**
 * Where each place stands: [longitude, latitude, the local government it must lie in, the real place].
 * Approximate (general knowledge, tens to a few hundred metres); a fictional venue is given a plausible
 * neighbourhood. The Lagos Island landmarks are spread over the island's narrow wedge, about 400 m
 * apart, keeping their real order (Idumota market in the north-west, the Marina offices along the
 * south-west shore, the park and polling unit in the east).
 */
export const PLACES: Readonly<Record<string, readonly [lon: number, lat: number, lga: string, place: string]>> = {
  radio: [3.3550, 6.5965, 'ikeja', 'Ikeja, off Obafemi Awolowo Way'],
  shrine: [3.3436, 6.6012, 'ikeja', 'Afrika Shrine, Pepple Street, Ikeja'],
  airport: [3.3210, 6.5775, 'oshodi-isolo', 'Murtala Muhammed terminal (the boundary data places the terminal in Oshodi-Isolo)'],
  'viewing-centre': [3.3640, 6.5090, 'surulere', 'Ojuelegba'],
  'amala-shitta': [3.3545, 6.4985, 'surulere', 'Shitta, Surulere'],
  cchub: [3.3820, 6.5075, 'lagos-mainland', 'Herbert Macaulay Way, Sabo Yaba'],
  hospital: [3.3975, 6.5620, 'kosofe', 'General Hospital, Gbagada'],
  salon: [3.3870, 6.5370, 'somolu', 'Bariga'],
  unilag: [3.3985, 6.5175, 'lagos-mainland', 'University of Lagos, Akoka'],
  market: [3.3880, 6.4580, 'lagos-island', 'Idumota / Balogun market'],
  mosque: [3.3950, 6.4575, 'lagos-island', 'Lagos Central Mosque, Nnamdi Azikiwe Street'],
  church: [3.3905, 6.4520, 'lagos-island', 'Cathedral Church of Christ, Marina'],
  police: [3.3985, 6.4530, 'lagos-island', 'Lagos Island police station'],
  'polling-unit': [3.4035, 6.4560, 'lagos-island', 'Isale Eko'],
  park: [3.4045, 6.4510, 'lagos-island', 'Freedom Park, Broad Street'],
  office: [3.3965, 6.4480, 'lagos-island', 'Marina offices'],
  'state-house': [3.4025, 6.4455, 'lagos-island', 'Marina waterfront (the venue is the state government house; its seat is in Ikeja, the district is the Marina)'],
  'i-fitness': [3.4130, 6.4310, 'eti-osa', 'Victoria Island, Adeola Odeku Street'],
  quilox: [3.4200, 6.4280, 'eti-osa', 'Victoria Island, Oko Awo'],
  library: [3.4230, 6.4300, 'eti-osa', 'Victoria Island, Akin Adesola Street'],
  rooftop: [3.4290, 6.4290, 'eti-osa', 'Victoria Island, Ahmadu Bello Way'],
  palms: [3.4570, 6.4350, 'eti-osa', 'The Palms, Lekki'],
  'canopy-walk': [3.5330, 6.4370, 'eti-osa', 'Lekki Conservation Centre'],
  beach: [3.5000, 6.4300, 'eti-osa', 'Lekki beach, Eti-Osa coast'],
  refinery: [3.9900, 6.4310, 'ibeju-lekki', 'Lekki Free Zone, Ibeju-Lekki'],
};
const HOME_PLACES: Readonly<Record<string, readonly [lon: number, lat: number, lga: string, place: string]>> = {
  mushin: [3.3510, 6.5300, 'mushin', 'Mushin'],
  yaba: [3.3710, 6.5100, 'lagos-mainland', 'Yaba'],
  lekki: [3.4723, 6.4478, 'eti-osa', 'Lekki Phase 1'],
  ikoyi: [3.4335, 6.4475, 'eti-osa', 'Ikoyi'],
  banana: [3.4480, 6.4570, 'eti-osa', 'Banana Island'],
};
/** The expected local government of every site and home (`PLACES`, home spots): the tests check each point lies in it. */
export const placeLga: Readonly<Record<string, string>> = Object.freeze({ ...Object.fromEntries(Object.entries(PLACES).map(([key, place]) => [key, place[2]])), ...Object.fromEntries(Object.entries(HOME_PLACES).map(([key, place]) => [`home:${key}`, place[2]])) });

/** Where each venue's landmark stands. Ids are venue ids (src/game/content/venues.ts). */
export const sites: Record<string, PackSite> = Object.fromEntries(Object.entries(PLACES).map(([key, [lon, lat]]): [string, PackSite] => { const [x, z] = at(lon, lat); return [key, { x, z }]; }));

/** Where Home stands for each house (ids of HOME_SPOTS in src/game/content/venues.ts). */
export const homes: Record<string, PackHome> = Object.fromEntries(Object.entries(HOME_PLACES).map(([key, [lon, lat, , place]]): [string, PackHome] => { const [x, z] = at(lon, lat); return [key, { x, z, district: place }]; }));

/**
 * Coming-soon districts: { [id of COMING_SOON]: { x, z, zone: [x0, z0, x1, z1], gate: [x, z] } }. Each is marked on both
 * maps and may be fenced off in decorate() with hazardFence() below. Lagos has none now: the airport and the refinery are venues.
 */
export const soon: Record<string, PackSoon> = {};

/** A district name plate: [name, lon, lat, size in units, over water?]. */
const plate = (label: string, lon: number, lat: number, size: number, water = false): PackDistrict => { const [x, z] = at(lon, lat); return { name: label, x, z, size, ...(water ? { water } : {}) }; };
/** District name plates laid on the ground at their real positions. `water` plates are lettered straight onto the water. */
export const districts: PackDistrict[] = [
  // Neighbourhoods and waters. The local governments have their own name plates (`lgas` below), so they are not repeated here.
  plate('YABA', 3.3745, 6.506, 4), plate('GBAGADA', 3.3915, 6.5665, 4),
  plate('IKOYI', 3.4310, 6.4505, 3.4), plate('BANANA ISLAND', 3.4440, 6.4720, 3, true),
  plate('VICTORIA ISLAND', 3.4200, 6.4325, 3.4), plate('LEKKI', 3.4850, 6.4395, 4.4),
  plate('LAGOS LAGOON', 3.4650, 6.5500, 8, true), plate('LEKKI LAGOON', 4.2200, 6.5000, 7, true), plate('ATLANTIC OCEAN', 3.5200, 6.3900, 10, true),
  plate('THIRD MAINLAND BRIDGE', 3.4300, 6.4900, 3, true), plate('LINK BRIDGE', 3.4600, 6.4730, 2.4, true),
];

/** A rectangle given in degrees (west, south, east, north), as a local box [x0, z0, x1, z1]. */
const box = (west: number, south: number, east: number, north: number): Box4 => { const a = at(west, north), b = at(east, south); return [a[0], a[1], b[0], b[1]]; };
/**
 * Areas the city fabric keeps clear (and no estate is laid on): [x0, z0, x1, z1]. Sites, roads and plates are kept clear
 * automatically. Real extents: the airfield about 3 km × 2 km south-west of the terminal, the Apapa port quays about 1.4 km ×
 * 1 km, the refinery's tank farm in the Lekki Free Zone about 3 km × 2 km.
 */
export const zones: Box4[] = [
  box(3.3030, 6.5580, 3.3300, 6.5740),   // the airfield, Murtala Muhammed airport
  box(3.9740, 6.4260, 4.0040, 6.4450),   // the refinery's tank farm
  box(3.3560, 6.4400, 3.3700, 6.4500),   // Apapa port
];

/**
 * What the fabric of each part of town is made of. The first area containing a point wins, so the named
 * neighbourhoods come first, then each local government's own bounding box (the builder keeps fabric on land).
 * style: 'dense' tin-roofed houses · 'blocks' mid-rise · 'towers' high-rise · 'villas' big houses and gardens · 'green' trees only
 */
const STYLE: Record<string, PackFabric['style']> = {
  ikeja: 'blocks', 'lagos-island': 'blocks', 'amuwo-odofin': 'blocks', 'oshodi-isolo': 'blocks', 'eti-osa': 'villas',
  mushin: 'dense', surulere: 'dense', 'lagos-mainland': 'dense', somolu: 'dense', kosofe: 'dense', agege: 'dense', alimosho: 'dense', 'ifako-ijaiye': 'dense', 'ajeromi-ifelodun': 'dense', apapa: 'dense', ojo: 'dense', ikorodu: 'dense',
  badagry: 'green', 'ibeju-lekki': 'green', epe: 'green',
};
const bboxOf = (parts: readonly (readonly Point2[][])[]): Box4 => {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const part of parts) for (const [x, z] of part[0]!) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return [x0, z0, x1, z1];
};
const boxArea = (b: Box4) => (b[2] - b[0]) * (b[3] - b[1]);
export const fabric: PackFabric[] = [
  { box: box(3.4380, 6.4440, 3.4600, 6.4640), style: 'villas' },     // Banana Island
  { box: box(3.4100, 6.4400, 3.4380, 6.4640), style: 'villas' },     // Ikoyi
  { box: box(3.3980, 6.4190, 3.4500, 6.4400), style: 'towers' },     // Victoria Island
  { box: box(3.4500, 6.4200, 3.5300, 6.4600), style: 'villas' },     // Lekki Phase 1 to Ajah
  ...Object.entries(SHAPE_PARTS).map(([lga, parts]): { lga: string; box: Box4 } => ({ lga, box: bboxOf(parts) })).sort((a, b) => boxArea(a.box) - boxArea(b.box)).map(({ lga, box: b }): PackFabric => ({ box: b, style: STYLE[lga] ?? 'dense' })),
];

/** A home estate's lot for the Neighbours layer: a little way from the home, inside the same local government. */
const lot = (lon: number, lat: number, cols: number, max?: number): PackEstate => { const [x, z] = at(lon, lat); return { x, z, cols, ...(max ? { max } : {}) }; };
/** Home estates for the Neighbours layer: where each district's player homes are drawn. */
export const estates: Record<string, PackEstate> = {
  mushin: lot(3.3490, 6.5340, 6), yaba: lot(3.3770, 6.5110, 6), lekki: lot(3.4790, 6.4520, 6), ikoyi: lot(3.4300, 6.4440, 6), banana: lot(3.4520, 6.4590, 4, 8),
};

// ---- The local governments -------------------------------------------------------------------------------------------

/**
 * The name plate of each local government: the pole of inaccessibility of its largest part (the point furthest from
 * every boundary), [lon, lat]. Computed once from the boundaries; a test checks each is inside and well clear of the edge.
 */
const PLATES: Readonly<Record<string, LL>> = {
  agege: [3.3155, 6.6183], 'ajeromi-ifelodun': [3.3359, 6.4547], alimosho: [3.2425, 6.5619], 'amuwo-odofin': [3.2798, 6.4407], apapa: [3.3763, 6.4309],
  badagry: [2.9350, 6.4499], epe: [3.9562, 6.5979], 'eti-osa': [3.5976, 6.4584], 'ibeju-lekki': [3.8504, 6.4737], 'ifako-ijaiye': [3.3273, 6.6564],
  ikeja: [3.3576, 6.5893], ikorodu: [3.5581, 6.6131], kosofe: [3.4133, 6.6166], 'lagos-island': [3.4005, 6.4511], 'lagos-mainland': [3.3877, 6.5083],
  mushin: [3.3520, 6.5334], ojo: [3.1543, 6.4481], 'oshodi-isolo': [3.3126, 6.5447], somolu: [3.3879, 6.5365], surulere: [3.3472, 6.4954],
};
const TINTS: Record<string, string> = {
  alimosho: '#e8c27a', 'ifako-ijaiye': '#9ecf8a', agege: '#f0a58e', ikeja: '#8fc4e6', kosofe: '#cdb4e8', ikorodu: '#f2d27a', somolu: '#8ed2c4', mushin: '#f0b872', 'oshodi-isolo': '#b9d98a', 'lagos-mainland': '#9db8f0',
  surulere: '#e8a0c0', apapa: '#b8c4d2', 'ajeromi-ifelodun': '#f2c48a', 'amuwo-odofin': '#a6d8b0', ojo: '#d8b0e0', badagry: '#8fd0d8', 'lagos-island': '#f0d08a', 'eti-osa': '#9ad0a8', 'ibeju-lekki': '#e8b8a0', epe: '#b0c8f0',
};
/**
 * THE LOCAL GOVERNMENTS, as geometry. Ids, names and prices are in src/game/cities/lagos/localUnits.ts (LAGOS_LGAS)
 * and are merged in below; a test asserts the two lists match.
 *   polygons  every part of the real boundary, [outer ring, ...holes], in map units; `polygon` is the largest part
 *   plate     where its name plate stands [x, z]
 *   tint      its colour on the "LGAs" layer
 *   geo       for finding a player's local government ON THEIR DEVICE (src/map3d/lga.ts resolveLga): c = [latitude,
 *             longitude] of the plate, box = the real bounding box [south, west, north, east]
 */
const lgaShape = (lga: string): Pick<PackLga, 'polygon' | 'polygons' | 'plate' | 'tint' | 'geo'> => {
  const parts = SHAPE_PARTS[lga]!, centre = PLATES[lga]!;
  let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
  for (const part of SHAPES.lgas[lga]!) for (const [lon, lat] of part[0]!) { south = Math.min(south, lat); north = Math.max(north, lat); west = Math.min(west, lon); east = Math.max(east, lon); }
  return { polygon: largest(parts), polygons: parts, plate: at(centre[0], centre[1]), tint: TINTS[lga]!, geo: { c: [centre[1], centre[0]], box: [south, west, north, east] } };
};
export const lgas: PackLga[] = LAGOS_LGAS.map((lga) => ({ id: lga.id, name: lga.name, line: LAGOS_LOCAL_UNIT_DESCRIPTIONS[lga.id], land: lga.land, districts: lga.districts, ...lgaShape(lga.id) }));

const STRIPE = ['#f2c230', '#22252a'];

/** Hazard-striped fence around a rectangle, with a gap for the gate — for a coming-soon district (`soon` above). */
function hazardFence(b: DecorateBatch, [x0, z0, x1, z1]: Box4) {
  const run = (ax: number, az: number, bx: number, bz: number) => {
    const length = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(length / 2.2)), ry = Math.atan2(bx - ax, bz - az);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      b.box(ax + (bx - ax) * t, 0.55, az + (bz - az) * t, 0.3, 0.5, length / n * 0.98, STRIPE[i % 2]!, { ry });
      if (i % 3 === 0) b.box(ax + (bx - ax) * t, 0.3, az + (bz - az) * t, 0.36, 0.6, 0.36, '#6b6f75', { ry });
    }
  };
  run(x0, z0, x1, z0); run(x1, z0, x1, z1); run(x1, z1, x0, z1); run(x0, z1, x0, z0);
}
function crane(b: DecorateBatch, x: number, z: number, ry = 0, h = 7, colour = '#e8a13a') {
  b.at(x, 0, z, ry, () => {
    b.box(0, h / 2, 0, 0.5, h, 0.5, colour);
    b.box(0, 0.25, 0, 1.6, 0.5, 1.6, '#6b6f75');
    b.box(0, h, 1.6, 0.4, 0.4, 5.6, colour);
    b.box(0, h + 0.7, -0.4, 0.3, 1.4, 0.3, colour);
    b.box(0, h, -1.4, 0.9, 0.7, 0.9, '#55595f');
    b.box(0, h - 1.4, 3.6, 0.08, 2.4, 0.08, '#22252a');
    b.box(0, h - 2.7, 3.6, 0.6, 0.3, 0.6, '#c9423a');
  });
}

/**
 * The same batch with everything drawn moved by (dx, dz): each feature below is drawn around its old origin, then placed.
 * What is drawn inside an at() callback is already in that transform's own frame, so it is not moved again.
 */
function moved(b: DecorateBatch, dx: number, dz: number): DecorateBatch {
  let inside = 0;
  const x = (value: number) => (inside ? value : value + dx), z = (value: number) => (inside ? value : value + dz);
  return {
    box: (px, y, pz, ...rest) => b.box(x(px), y, z(pz), ...rest), cyl: (px, y, pz, ...rest) => b.cyl(x(px), y, z(pz), ...rest), cone: (px, y, pz, ...rest) => b.cone(x(px), y, z(pz), ...rest),
    at: (px, y, pz, ry, draw) => b.at(x(px), y, z(pz), ry, () => { inside += 1; try { draw(); } finally { inside -= 1; } }),
  };
}
/** Where each feature of decorate() is centred: [lon, lat] (the origin its drawing code is written around, in map units, is subtracted). */
const FEATURES = {
  port: at(3.3630, 6.4450),         // Apapa port quays
  airfield: at(3.3165, 6.5665),     // the runway south-west of the terminal at Ikeja
  tankFarm: at(3.9890, 6.4350),     // the refinery's tank farm in the Lekki Free Zone
  atlantic: at(3.4075, 6.4130),     // Eko Atlantic on the Atlantic coast of Victoria Island
};

/** What only Lagos has. `b` is a geometry batch (src/scene/build.ts); `tools` are builder helpers. */
export function decorate(batch: DecorateBatch, { rng }: { rng: () => number }) {
  let b = moved(batch, FEATURES.port[0] + 68, FEATURES.port[1] - 10);
  // ---- Apapa port: quay, gantry cranes, container stacks, two ships ---------------------------
  b.box(-68, 0.12, 10, 30, 0.24, 13, '#9a9c9a');
  const boxes = ['#c9423a', '#2b5fa8', '#e8a13a', '#3f9a5a', '#ece2c6', '#7a4bb0'];
  for (let i = 0; i < 26; i++) {
    const x = -80 + (i % 9) * 3, z = 6 + Math.floor(i / 9) * 3.4, high = 1 + Math.floor(rng() * 3);
    for (let level = 0; level < high; level++) b.box(x, 0.65 + level * 0.82, z, 2.6, 0.8, 1.2, boxes[Math.floor(rng() * boxes.length)]!);
  }
  for (const z of [5, 10, 15]) {
    b.at(-54.5, 0, z, 0, () => {
      for (const sx of [-1, 1]) { b.box(sx * 1.2, 2.6, -0.9, 0.3, 5.2, 0.3, '#2b5fa8'); b.box(sx * 1.2, 2.6, 0.9, 0.3, 5.2, 0.3, '#2b5fa8'); }
      b.box(2.2, 5.3, 0, 8.4, 0.4, 2.2, '#2b5fa8');
      b.box(3.4, 4.6, 0, 0.8, 0.7, 0.8, '#ece8dc');
    });
  }
  for (const [x, z, ry, hull] of [[-46, 9, 0, '#33414f'], [-66, 22, Math.PI / 2, '#7a2f2a']] as [number, number, number, string][]) {
    b.at(x, -0.5, z, ry, () => {
      b.box(0, 0.5, 0, 3, 1.1, 11, hull);
      b.box(0, 1.25, -3.8, 2.4, 1.4, 2.2, '#ece8dc');
      b.box(0, 2.2, -3.8, 0.7, 0.7, 0.7, '#c9423a');
      for (let i = 0; i < 3; i++) b.box(0, 1.35, -1 + i * 2.2, 2.4, 0.8, 1.9, boxes[(i * 2 + (x < -50 ? 1 : 0)) % boxes.length]!);
    });
  }

  // ---- The airfield at Ikeja, behind the terminal (the venue's landmark): apron, runway, tower, planes ----
  b = moved(batch, FEATURES.airfield[0] + 105, FEATURES.airfield[1] + 65);
  b.box(-105, 0.07, -65, 33, 0.14, 33, '#c5c8c2');
  b.box(-105, 0.16, -74, 30, 0.06, 4.2, '#4a4e55');                         // runway
  for (let i = 0; i < 9; i++) b.box(-117 + i * 3, 0.2, -74, 1.6, 0.02, 0.3, '#ece8dc');
  b.box(-104, 0.16, -68, 3, 0.06, 8, '#4a4e55');                            // taxiway
  b.cyl(-114, 3, -60, 0.9, 6, '#d9d4c4', { seg: 8 });                       // control tower
  b.cyl(-114, 6.5, -60, 1.5, 1.2, '#55707c', { seg: 8, top: 1.25 });
  for (const [x, z, ry, tail] of [[-96, -68, 1.2, '#3f9a5a'], [-110, -66.5, -0.5, '#2b5fa8']] as [number, number, number, string][]) {
    b.at(x, 0.2, z, ry, () => {                                             // planes at their stands
      b.cyl(0, 0.9, 0, 0.55, 6.4, '#ece8dc', { seg: 8, rx: Math.PI / 2 });
      b.cone(0, 0.9, 3.7, 0.55, 1.1, '#ece8dc', { seg: 8, rx: Math.PI / 2 });
      b.box(0, 0.85, 0.2, 7.4, 0.14, 1.5, '#d9d4c4');
      b.box(0, 1.1, -2.8, 2.8, 0.12, 0.8, '#d9d4c4');
      b.box(0, 1.8, -2.9, 0.14, 1.5, 0.9, tail);
    });
  }

  // ---- The refinery's tank farm in the Lekki Free Zone, beside the refinery's gate (the venue's landmark) ----
  b = moved(batch, FEATURES.tankFarm[0] - 116, FEATURES.tankFarm[1] - 20.7);
  b.box(116, 0.07, 20.7, 20, 0.14, 9.4, '#c5c8c2');
  b.box(116, 0.07, 34, 20, 0.14, 6, '#c5c8c2');
  for (const [x, z, r, h] of [[110, 19.5, 2.2, 2.4], [115.5, 19.5, 2.2, 2.4], [121, 19.5, 2.2, 2.4], [110, 23.9, 1.4, 3.2], [114, 23.9, 1.4, 3.2]] as [number, number, number, number][]) {
    b.cyl(x, h / 2, z, r, h, '#dfe2e0', { seg: 10 });
    b.cyl(x, h + 0.12, z, r * 0.96, 0.24, '#b8bcba', { seg: 10, top: 0.5 });
  }
  for (const [x, z, h] of [[119.5, 23.8, 9], [122.5, 23.4, 7]] as [number, number, number][]) {
    b.cyl(x, h / 2, z, 0.5, h, '#9aa0a4', { seg: 7, top: 0.7 });
    for (let band = 0; band < 3; band++) b.cyl(x, h - 0.6 - band * 1.4, z, 0.52, 0.5, band % 2 ? '#ece8dc' : '#c9423a', { seg: 7 });
  }
  for (let i = 0; i < 4; i++) b.cyl(118 + i * 1.6, 0.9, 34, 0.14, 1.8, '#8a8f95', { seg: 5, rz: Math.PI / 2 });

  // ---- Eko Atlantic: reclaimed land with its first towers ---------------------------------------
  b = moved(batch, FEATURES.atlantic[0] - 1, FEATURES.atlantic[1] - 51);
  for (const [x, z, h, colour] of [[-5, 50, 9, '#b9c7cf'], [1, 52, 12, '#9fb4c0'], [8, 50, 7.5, '#c9d2d4']] as [number, number, number, string][]) {
    b.box(x, h / 2, z, 3.2, h, 3.2, colour);
    b.box(x, h + 0.2, z, 2.4, 0.4, 2.4, '#7d858c');
  }
}

/** The land around the state (Ogun, Oyo, Ondo, Benin, Togo), flat and quiet; Ogun answers a tap with "Opening soon" because the registry has a reserved city in it. */
export const context = mapContext(ORIGINS.lagos, fit, ['ogun', 'oyo', 'ondo'].filter((state) => catalogueCitiesInState(state).length > 0));

const pack: CityPack = { id, name, bounds, context, land, roads, sites, homes, soon, districts, zones, fabric, estates, lgas, geo, frame, core, roadScale, decorate };
export default pack;
