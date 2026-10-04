/**
 * OWNER: world
 * City pack: Lagos as a miniature. Our own stylised, compressed layout of the real geography,
 * drawn from general knowledge — no map tiles, no third-party data, nothing copied.
 *
 *   north  the Mainland: Ikeja and the airport inland, Mushin, Surulere, Yaba, Gbagada and Bariga
 *          on the lagoon shore, Apapa port in the south-west
 *   east   Lagos Lagoon, with the Third Mainland Bridge running over the water along the shore
 *   middle Lagos Island and Ikoyi (one island), Banana Island off its north-east corner; Carter
 *          and Eko bridges to the mainland
 *   south  Victoria Island and the Lekki peninsula running east, the Lekki–Ikoyi link bridge,
 *          the beach and the Atlantic
 *   edges  the outer local governments, compressed towards the edges of the board: Alimosho, Ojo
 *          and Badagry in the west, Ifako-Ijaiye and Agege along the top, Ikorodu round the lagoon to
 *          the north-east, Ibeju-Lekki at the end of the peninsula and Epe across the Lekki lagoon
 *
 * UNITS: x runs east, z runs south, y is up. One unit is roughly a small house. Venue ids are the
 * ones in src/game/content/venues.js; the server's fare bands still use the positions there —
 * these coordinates are presentation only.
 *
 * A pack is plain data plus decorate(): the generic builder (src/map3d/city-build.js) draws land,
 * roads, bridges, landmarks and the city fabric from the data; decorate() adds what only this
 * city has (the port, the airfield and the tank farm around the airport and refinery landmarks, Eko Atlantic).
 */

import { LAGOS_LGAS } from '../../game/content/world.js';
import type { Box4, CityPack, DecorateBatch, PackBounds, PackDistrict, PackEstate, PackFabric, PackHome, PackLand, PackLga, PackRoad, PackSite, PackSoon } from '../types.ts';

export const id = 'lagos';
export const name = 'Lagos';

/** The board. `fit` is what "the whole city" frames (the land, not the open sea); `sea` is the open-water block the sea-plot layer uses. */
export const bounds: PackBounds = { minX: -176, maxX: 190, minZ: -116, maxZ: 62, fit: { minX: -166, maxX: 180, minZ: -104, maxZ: 46 }, sea: { x0: 24, x1: 92, z0: 50, z1: 92 } };

/** Land masses as control polygons [x, z]; the builder rounds the corners. `kind` picks the ground colour. */
export const land: PackLand[] = [
  // The mainland runs west to Badagry and, round the top of the lagoon, north-east to Ikorodu.
  { id: 'mainland', kind: 'mainland', points: [[-166, -106], [152, -106], [158, -86], [140, -68], [106, -70], [84, -80], [66, -90], [53, -93], [48, -84], [46, -68], [38, -54], [30, -44], [26, -30], [22, -18], [10, -11], [-12, -11], [-30, -11], [-44, -10], [-50, -2], [-52, 10], [-60, 18], [-80, 18], [-94, 12], [-126, 12], [-138, 14], [-152, 18], [-166, 13]] },
  { id: 'island', kind: 'island', points: [[-42, 2], [-20, 0], [4, 0], [26, -3], [46, -3], [56, 3], [55, 13], [44, 20], [10, 20], [-20, 21], [-40, 19], [-46, 10]] },
  { id: 'banana', kind: 'estate', points: [[47, -13], [58, -18], [72, -16], [75, -8], [62, -3.5], [49, -4.5]] },
  { id: 'vi', kind: 'island', points: [[-14, 27], [10, 26], [34, 26], [50, 26], [60, 22], [76, 16], [100, 13], [127, 14], [146, 11], [166, 10], [180, 14], [181, 40], [90, 40.5], [40, 40.5], [0, 40.5], [-12, 39], [-17, 34]] },
  { id: 'beach', kind: 'sand', points: [[-13, 38], [181, 38], [182, 46], [60, 46.5], [-10, 46]] },
  // Epe, on the far shore of the Lekki lagoon.
  { id: 'epe', kind: 'mainland', points: [[138, -46], [162, -50], [180, -42], [182, -14], [168, -4], [144, -6], [134, -22]] },
  { id: 'tarkwa', kind: 'sand', points: [[-104, 32], [-76, 30], [-54, 33], [-55, 38], [-80, 37.5], [-104, 38]] },
  { id: 'eko-atlantic', kind: 'sand', points: [[-12, 46], [14, 46], [16, 56], [-10, 56]] },
];

/**
 * Roads as control polylines. Two roads meet where they share an exact point. `bridge` is the
 * deck height (the builder ramps it at both ends, adds piers and rails); `major` roads are wider
 * and carry lane marks and traffic.
 */
export const roads: PackRoad[] = [
  // Mainland
  { id: 'ikorodu', name: 'Ikorodu Road', major: true, points: [[-20, -82], [-21, -58], [-21, -36], [-18, -24], [-16, -15]] },
  { id: 'agege', name: 'Agege Motor Road', major: true, points: [[-86, -56], [-60, -58], [-40, -58], [-21, -58], [2, -56], [22, -60], [36, -64]] },
  { id: 'mushin', name: 'Mushin Road', major: true, points: [[-98, -34], [-62, -34], [-40, -33], [-21, -36], [0, -36], [14, -38]] },
  { id: 'herbert', name: 'Herbert Macaulay Way', points: [[2, -56], [0, -36], [4, -24], [-6, -17], [-16, -15]] },
  { id: 'apapa', name: 'Apapa Road', points: [[-62, -34], [-56, -16], [-64, -2], [-70, 6]] },
  { id: 'ijora', name: 'Ijora Causeway', points: [[-56, -16], [-44, -16], [-36, -15]] },
  // Bridges across the lagoon
  { id: 'carter', name: 'Carter Bridge', bridge: 1.5, major: true, points: [[-16, -15], [-16, -6], [-16, 3]] },
  { id: 'eko', name: 'Eko Bridge', bridge: 1.5, major: true, points: [[-36, -15], [-37, -6], [-36, 3]] },
  { id: 'third-mainland', name: 'Third Mainland Bridge', bridge: 1.9, major: true, points: [[36, -64], [43, -52], [40, -38], [35, -24], [26, -10], [13, -3], [8, 3]] },
  // Lagos Island and Ikoyi
  { id: 'broad', name: 'Broad Street', major: true, points: [[-36, 3], [-36, 10], [-16, 10], [8, 10], [30, 10], [48, 10], [50.2, 10.2], [52, 11]] },
  { id: 'carter-landing', name: 'Idumota', points: [[-16, 3], [-16, 10]] },
  { id: 'adeniji', name: 'Adeniji Adele Road', points: [[8, 3], [8, 10]] },
  { id: 'falomo-road', name: 'Kingsway Road', points: [[30, 10], [30, 17]] },
  { id: 'falomo', name: 'Falomo Bridge', bridge: 1.3, points: [[30, 17], [30, 23], [30, 29]] },
  { id: 'banana-road', name: 'Banana Island Road', points: [[48, 10], [50, 2]] },
  { id: 'banana-bridge', name: 'Banana Island causeway', bridge: 0.6, points: [[50, 2], [51.5, -2.5], [53, -7]] },
  { id: 'banana-drive', name: 'Banana Island Drive', points: [[53, -7], [60, -8], [68, -9]] },
  // The Lekki–Ikoyi link bridge and the peninsula. Its first and last control points carry on the line of the road
  // at each end (Broad Street, Admiralty Way), so the deck leaves and rejoins the road in one curve, without a corner.
  { id: 'link', name: 'Lekki–Ikoyi Link Bridge', bridge: 2, pylon: true, major: true, points: [[52, 11], [54, 12.4], [57.6, 16.2], [61.6, 20.6], [63, 23]] },
  { id: 'link-landing', name: 'Admiralty Way', major: true, points: [[63, 23], [63.8, 26], [64, 29]] },
  { id: 'ozumba', name: 'Lekki–Epe Expressway', major: true, points: [[-10, 30], [10, 29], [30, 29], [48, 30], [64, 29], [84, 30], [104, 29]] },
  { id: 'beach-road', name: 'Beach Road', points: [[84, 30], [89, 35], [92, 38]] },
  // Out to the far local governments: west to Badagry, round the lagoon to Ikorodu, east to Ibeju-Lekki and over to Epe
  { id: 'badagry-expressway', name: 'Lagos–Badagry Expressway', major: true, points: [[-98, -34], [-112, -30], [-130, -26], [-148, -20], [-162, -10]] },
  { id: 'lasu-road', name: 'LASU–Iba Road', points: [[-130, -26], [-138, -52], [-146, -78], [-150, -96]] },
  { id: 'ikorodu-north', name: 'Ikorodu Road', major: true, points: [[-20, -82], [-8, -94], [20, -99], [56, -99], [92, -92], [124, -84]] },
  { id: 'lekki-epe', name: 'Lekki–Epe Expressway', major: true, points: [[104, 29], [130, 27], [152, 26], [172, 27]] },
  { id: 'epe-bridge', name: 'Epe Bridge', bridge: 1.5, points: [[152, 26], [152.6, 20], [153.4, 14], [154.2, 8], [155.2, 2], [156.2, -3], [157, -8]] },
  { id: 'epe-road', name: 'Epe Road', points: [[157, -8], [158, -20], [160, -34]] },
];

/** Where each venue's landmark stands. Ids are venue ids (src/game/content/venues.js). */
export const sites: Record<string, PackSite> = {
  radio: { x: -66, z: -51 }, shrine: { x: -46, z: -65 }, 'viewing-centre': { x: -31, z: -27 }, 'amala-shitta': { x: -45, z: -23 },
  cchub: { x: 8.5, z: -30 }, hospital: { x: 11, z: -64 }, salon: { x: 26, z: -53 },
  church: { x: -26, z: 4.5 }, market: { x: -9.5, z: 4.5 }, police: { x: 1.5, z: 4.5 }, park: { x: 17, z: 4.5 },
  mosque: { x: -30, z: 15.5 }, 'polling-unit': { x: -19, z: 15.5 }, office: { x: -8, z: 15.5 }, 'state-house': { x: 4, z: 15.5 },
  'i-fitness': { x: -3, z: 35.5 }, library: { x: 9, z: 35.5 }, quilox: { x: 21, z: 35.5 }, rooftop: { x: 40, z: 35.5 },
  palms: { x: 76, z: 23 }, 'canopy-walk': { x: 93, z: 21.5 }, beach: { x: 97, z: 42 },
  // The terminal at the end of Agege Motor Road (Ikeja), and the refinery's gate on the Lekki–Epe Expressway (Ibeju-Lekki).
  airport: { x: -96, z: -57 }, refinery: { x: 112, z: 34.6 },
};

/** Where Home stands for each house (ids of HOME_SPOTS in src/game/content/venues.js). */
export const homes: Record<string, PackHome> = {
  mushin: { x: -50, z: -40.5, district: 'Mushin' }, yaba: { x: 15, z: -44.5, district: 'Yaba' }, lekki: { x: 72, z: 36, district: 'Lekki Phase 1' },
  ikoyi: { x: 40, z: 15.5, district: 'Ikoyi' }, banana: { x: 66, z: -13.5, district: 'Banana Island' },
};

/**
 * Coming-soon districts: { [id of COMING_SOON]: { x, z, zone: [x0, z0, x1, z1], gate: [x, z] } }. Each is marked on both
 * maps and may be fenced off in decorate() with hazardFence() below. Lagos has none now: the airport and the refinery are venues.
 */
export const soon: Record<string, PackSoon> = {};

/** District name plates laid on the ground: [x, z, size]. `water` plates are lettered straight onto the water. */
export const districts: PackDistrict[] = [
  // Neighbourhoods and waters. The local governments have their own name plates (`lgas` below), so they are not repeated here.
  { name: 'YABA', x: 10, z: -19.5, size: 2 }, { name: 'GBAGADA', x: -6, z: -72, size: 2 },
  { name: 'IKOYI', x: 40, z: 4.6, size: 1.7 }, { name: 'BANANA ISLAND', x: 92, z: -12, size: 1.3, water: true },
  { name: 'VICTORIA ISLAND', x: 30, z: 33.5, size: 1.5 }, { name: 'LEKKI', x: 86, z: 34.5, size: 2.2 },
  { name: 'LAGOS LAGOON', x: 88, z: -40, size: 3.4, water: true }, { name: 'LEKKI LAGOON', x: 132, z: -1, size: 1.4, water: true }, { name: 'ATLANTIC OCEAN', x: -66, z: 50, size: 3, water: true },
  { name: 'THIRD MAINLAND BRIDGE', x: 62, z: -50, size: 1.2, water: true }, { name: 'LINK BRIDGE', x: 68, z: 10.5, size: 1.1, water: true },
];

/** Areas the city fabric keeps clear: [x0, z0, x1, z1]. Sites, roads and plates are kept clear automatically. */
export const zones: Box4[] = [
  [-122, -82, -88, -48],   // the airfield
  [106, 16, 126, 37],      // the refinery's tank farm
  [-84, 2, -52, 18],       // Apapa port
];

/**
 * What the fabric of each part of town is made of. The first area containing a point wins.
 * style: 'dense' tin-roofed houses · 'blocks' mid-rise · 'towers' high-rise · 'villas' big houses and gardens · 'green' trees only
 */
export const fabric: PackFabric[] = [
  { box: [-126, -86, -30, -46], style: 'blocks' },           // Ikeja
  { box: [-126, -46, 50, 14], style: 'dense' },              // Mushin, Surulere, Yaba
  { box: [-30, -86, 50, -46], style: 'dense' },              // Gbagada, Bariga
  { box: [-48, -4, 12, 22], style: 'blocks' },               // Lagos Island
  { box: [12, -4, 58, 22], style: 'villas' },                // Ikoyi
  { box: [46, -19, 76, -3], style: 'villas' },               // Banana Island
  { box: [-18, 25, 56, 42], style: 'towers' },               // Victoria Island
  { box: [56, 12, 104, 42], style: 'villas' },               // Lekki
  { box: [-166, -106, -126, 20], style: 'dense' },           // Alimosho, Ojo, Badagry
  { box: [-126, -106, 60, -86], style: 'dense' },            // Ifako-Ijaiye, Agege, Kosofe
  { box: [60, -110, 160, -62], style: 'dense' },             // Ikorodu
  { box: [104, 8, 182, 42], style: 'villas' },               // Ibeju-Lekki
  { box: [132, -50, 182, -4], style: 'villas' },             // Epe
];

/** Home estates for the Neighbours layer: where each district's player homes are drawn. */
export const estates: Record<string, PackEstate> = {
  mushin: { x: -80, z: -47, cols: 6 }, yaba: { x: -16, z: -50, cols: 6 }, lekki: { x: 54, z: 32.5, cols: 6 }, ikoyi: { x: 11.5, z: 12.5, cols: 6 }, banana: { x: 52, z: -13, cols: 4, max: 8 },
};

/**
 * THE LOCAL GOVERNMENTS, as geometry. Ids, names, prices and character lines are in
 * src/game/content/world.js (LAGOS_LGAS) and are merged in below; a test asserts the two lists match.
 *   polygon  the boundary in map units [x, z]: our own stylised shapes, placed as the real ones lie
 *            relative to each other. A boundary may run out over water; both maps draw it on land only.
 *   plate    where its name plate stands [x, z]
 *   tint     its colour on the "LGAs" layer
 *   geo      for finding a player's local government ON THEIR DEVICE (src/map3d/lga.js resolveLga):
 *            c = a rough centre [latitude, longitude], box = a rough bounding rectangle
 *            [south, west, north, east]. Hand-drawn from general knowledge, good to a few kilometres:
 *            near a boundary it can name the neighbour, which is why the player confirms the answer.
 */
const LGA_SHAPES: Record<string, Pick<PackLga, 'polygon' | 'plate' | 'tint' | 'geo'>> = {
  alimosho: { polygon: [[-168, -108], [-124, -108], [-124, -46], [-168, -46]], plate: [-146, -70], tint: '#e8c27a', geo: { c: [6.584, 3.257], box: [6.50, 3.18, 6.67, 3.30] } },
  'ifako-ijaiye': { polygon: [[-124, -108], [-80, -108], [-80, -84], [-124, -84]], plate: [-102, -96], tint: '#9ecf8a', geo: { c: [6.685, 3.289], box: [6.64, 3.25, 6.71, 3.33] } },
  agege: { polygon: [[-80, -108], [-38, -108], [-38, -84], [-80, -84]], plate: [-59, -96], tint: '#f0a58e', geo: { c: [6.622, 3.325], box: [6.60, 3.29, 6.65, 3.34] } },
  ikeja: { polygon: [[-124, -84], [-38, -84], [-38, -48], [-124, -48]], plate: [-64, -74], tint: '#8fc4e6', geo: { c: [6.596, 3.342], box: [6.56, 3.31, 6.64, 3.38] } },
  kosofe: { polygon: [[-38, -108], [62, -108], [62, -58], [-38, -58]], plate: [10, -78], tint: '#cdb4e8', geo: { c: [6.582, 3.415], box: [6.55, 3.37, 6.63, 3.46] } },
  ikorodu: { polygon: [[62, -112], [162, -112], [162, -58], [62, -58]], plate: [112, -88], tint: '#f2d27a', geo: { c: [6.619, 3.510], box: [6.54, 3.45, 6.72, 3.72] } },
  somolu: { polygon: [[-4, -58], [52, -58], [52, -48], [-4, -48]], plate: [14, -53], tint: '#8ed2c4', geo: { c: [6.540, 3.384], box: [6.52, 3.37, 6.56, 3.40] } },
  mushin: { polygon: [[-62, -48], [-38, -48], [-38, -58], [-4, -58], [-4, -28], [-62, -28]], plate: [-30, -41], tint: '#f0b872', geo: { c: [6.528, 3.354], box: [6.51, 3.33, 6.55, 3.37] } },
  'oshodi-isolo': { polygon: [[-124, -48], [-62, -48], [-62, -28], [-124, -28]], plate: [-92, -41], tint: '#b9d98a', geo: { c: [6.540, 3.312], box: [6.50, 3.29, 6.57, 3.34] } },
  'lagos-mainland': { polygon: [[-4, -48], [44, -48], [28, -6], [-22, -6], [-22, -28], [-4, -28]], plate: [12, -24], tint: '#9db8f0', geo: { c: [6.506, 3.378], box: [6.47, 3.36, 6.53, 3.41] } },
  surulere: { polygon: [[-84, -28], [-22, -28], [-22, -6], [-84, -6]], plate: [-66, -20], tint: '#e8a0c0', geo: { c: [6.500, 3.348], box: [6.48, 3.33, 6.52, 3.37] } },
  apapa: { polygon: [[-84, -6], [-40, -6], [-40, 24], [-84, 24]], plate: [-66, -1], tint: '#b8c4d2', geo: { c: [6.449, 3.359], box: [6.42, 3.34, 6.46, 3.39] } },
  'ajeromi-ifelodun': { polygon: [[-104, -28], [-84, -28], [-84, 24], [-104, 24]], plate: [-94, -4], tint: '#f2c48a', geo: { c: [6.455, 3.334], box: [6.43, 3.31, 6.47, 3.35] } },
  'amuwo-odofin': { polygon: [[-124, -28], [-104, -28], [-104, 24], [-124, 24]], plate: [-114, -6], tint: '#a6d8b0', geo: { c: [6.446, 3.268], box: [6.40, 3.22, 6.48, 3.32] } },
  ojo: { polygon: [[-146, -46], [-124, -46], [-124, 24], [-146, 24]], plate: [-135, -10], tint: '#d8b0e0', geo: { c: [6.463, 3.168], box: [6.42, 3.10, 6.52, 3.22] } },
  badagry: { polygon: [[-168, -46], [-146, -46], [-146, 24], [-168, 24]], plate: [-157, -10], tint: '#8fd0d8', geo: { c: [6.432, 2.887], box: [6.38, 2.70, 6.52, 3.10] } },
  'lagos-island': { polygon: [[-50, -6], [22, -6], [22, 24], [-50, 24]], plate: [-22, 10], tint: '#f0d08a', geo: { c: [6.455, 3.394], box: [6.44, 3.37, 6.47, 3.41] } },
  'eti-osa': { polygon: [[22, -6], [44, -6], [44, -22], [78, -22], [78, 0], [60, 2], [60, 12], [104, 12], [104, 48], [20, 48], [20, 60], [-20, 60], [-20, 24], [22, 24]], plate: [46, 33], tint: '#9ad0a8', geo: { c: [6.459, 3.601], box: [6.40, 3.40, 6.48, 3.72] } },
  'ibeju-lekki': { polygon: [[104, 6], [184, 6], [184, 48], [104, 48]], plate: [146, 33], tint: '#e8b8a0', geo: { c: [6.467, 3.865], box: [6.37, 3.72, 6.52, 4.36] } },
  epe: { polygon: [[130, -52], [184, -52], [184, 0], [130, 0]], plate: [158, -26], tint: '#b0c8f0', geo: { c: [6.586, 3.983], box: [6.50, 3.80, 6.72, 4.36] } },
};
/** The rough box of Lagos State [south, west, north, east]: a position outside it is "not in Lagos". */
export const geo: { box: Box4 } = { box: [6.36, 2.69, 6.73, 4.37] };
export const lgas: PackLga[] = LAGOS_LGAS.map((lga) => ({ id: lga.id, name: lga.name, line: lga.line, land: lga.land, districts: lga.districts, ...LGA_SHAPES[lga.id]! }));

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

/** What only Lagos has. `b` is a geometry batch (src/scene/build.js); `tools` are builder helpers. */
export function decorate(b: DecorateBatch, { rng }: { rng: () => number }) {
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

  // ---- The refinery's tank farm in the Lekki Free Zone, across the expressway from its gate (the venue's landmark) ----
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
  for (const [x, z, h, colour] of [[-5, 50, 9, '#b9c7cf'], [1, 52, 12, '#9fb4c0'], [8, 50, 7.5, '#c9d2d4']] as [number, number, number, string][]) {
    b.box(x, h / 2, z, 3.2, h, 3.2, colour);
    b.box(x, h + 0.2, z, 2.4, 0.4, 2.4, '#7d858c');
  }
}

const pack: CityPack = { id, name, bounds, land, roads, sites, homes, soon, districts, zones, fabric, estates, lgas, geo, decorate };
export default pack;
