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
 *
 * UNITS: x runs east, z runs south, y is up. One unit is roughly a small house. Venue ids are the
 * ones in src/game/content/venues.js; the server's fare bands still use the positions there —
 * these coordinates are presentation only.
 *
 * A pack is plain data plus decorate(): the generic builder (src/map3d/city-build.js) draws land,
 * roads, bridges, landmarks and the city fabric from the data; decorate() adds what only this
 * city has (the port, the airport and refinery building sites, Eko Atlantic).
 */

export const id = 'lagos';
export const name = 'Lagos';

/** The board. `fit` is what "the whole city" frames (the land, not the open sea); `sea` is the open-water block the sea-plot layer uses. */
export const bounds = { minX: -134, maxX: 136, minZ: -94, maxZ: 62, fit: { minX: -122, maxX: 124, minZ: -80, maxZ: 46 }, sea: { x0: 24, x1: 92, z0: 50, z1: 92 } };

/** Land masses as control polygons [x, z]; the builder rounds the corners. `kind` picks the ground colour. */
export const land = [
  { id: 'mainland', kind: 'mainland', points: [[-126, -86], [48, -86], [46, -68], [38, -54], [30, -44], [26, -30], [22, -18], [10, -11], [-12, -11], [-30, -11], [-44, -10], [-50, -2], [-52, 10], [-60, 18], [-80, 18], [-94, 12], [-126, 12]] },
  { id: 'island', kind: 'island', points: [[-42, 2], [-20, 0], [4, 0], [26, -3], [46, -3], [56, 3], [55, 13], [44, 20], [10, 20], [-20, 21], [-40, 19], [-46, 10]] },
  { id: 'banana', kind: 'estate', points: [[47, -13], [58, -18], [72, -16], [75, -8], [62, -3.5], [49, -4.5]] },
  { id: 'vi', kind: 'island', points: [[-14, 27], [10, 26], [34, 26], [50, 26], [60, 22], [76, 16], [100, 13], [127, 14], [128, 40], [90, 40.5], [40, 40.5], [0, 40.5], [-12, 39], [-17, 34]] },
  { id: 'beach', kind: 'sand', points: [[-13, 38], [128, 38], [129, 46], [60, 46.5], [-10, 46]] },
  { id: 'tarkwa', kind: 'sand', points: [[-104, 32], [-76, 30], [-54, 33], [-55, 38], [-80, 37.5], [-104, 38]] },
  { id: 'eko-atlantic', kind: 'sand', points: [[-12, 46], [14, 46], [16, 56], [-10, 56]] },
];

/**
 * Roads as control polylines. Two roads meet where they share an exact point. `bridge` is the
 * deck height (the builder ramps it at both ends, adds piers and rails); `major` roads are wider
 * and carry lane marks and traffic.
 */
export const roads = [
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
  { id: 'broad', name: 'Broad Street', major: true, points: [[-36, 3], [-36, 10], [-16, 10], [8, 10], [30, 10], [48, 10], [52, 9]] },
  { id: 'carter-landing', name: 'Idumota', points: [[-16, 3], [-16, 10]] },
  { id: 'adeniji', name: 'Adeniji Adele Road', points: [[8, 3], [8, 10]] },
  { id: 'falomo-road', name: 'Kingsway Road', points: [[30, 10], [30, 17]] },
  { id: 'falomo', name: 'Falomo Bridge', bridge: 1.3, points: [[30, 17], [30, 23], [30, 29]] },
  { id: 'banana-road', name: 'Banana Island Road', points: [[48, 10], [50, 2]] },
  { id: 'banana-bridge', name: 'Banana Island causeway', bridge: 0.6, points: [[50, 2], [51.5, -2.5], [53, -7]] },
  { id: 'banana-drive', name: 'Banana Island Drive', points: [[53, -7], [60, -8], [68, -9]] },
  // The Lekki–Ikoyi link bridge and the peninsula
  { id: 'link', name: 'Lekki–Ikoyi Link Bridge', bridge: 2.2, pylon: true, points: [[52, 9], [57, 15], [63, 23]] },
  { id: 'link-landing', name: 'Admiralty Way', points: [[63, 23], [64, 29]] },
  { id: 'ozumba', name: 'Lekki–Epe Expressway', major: true, points: [[-10, 30], [10, 29], [30, 29], [48, 30], [64, 29], [84, 30], [104, 29]] },
  { id: 'beach-road', name: 'Beach Road', points: [[84, 30], [89, 35], [92, 38]] },
];

/** Where each venue's landmark stands. Ids are venue ids (src/game/content/venues.js). */
export const sites = {
  radio: { x: -66, z: -51 }, shrine: { x: -46, z: -65 }, 'viewing-centre': { x: -31, z: -27 }, 'amala-shitta': { x: -45, z: -23 },
  cchub: { x: 8.5, z: -30 }, hospital: { x: 11, z: -64 }, salon: { x: 26, z: -53 },
  church: { x: -26, z: 4.5 }, market: { x: -9.5, z: 4.5 }, police: { x: 1.5, z: 4.5 }, park: { x: 17, z: 4.5 },
  mosque: { x: -30, z: 15.5 }, 'polling-unit': { x: -19, z: 15.5 }, office: { x: -8, z: 15.5 }, 'state-house': { x: 4, z: 15.5 },
  'i-fitness': { x: -3, z: 35.5 }, library: { x: 9, z: 35.5 }, quilox: { x: 21, z: 35.5 }, rooftop: { x: 40, z: 35.5 },
  palms: { x: 76, z: 23 }, 'canopy-walk': { x: 93, z: 21.5 }, beach: { x: 97, z: 42 },
};

/** Where Home stands for each house (ids of HOME_SPOTS in src/game/content/venues.js). */
export const homes = {
  mushin: { x: -50, z: -40.5, district: 'Mushin' }, yaba: { x: 15, z: -44.5, district: 'Yaba' }, lekki: { x: 72, z: 36, district: 'Lekki Phase 1' },
  ikoyi: { x: 40, z: 15.5, district: 'Ikoyi' }, banana: { x: 66, z: -13.5, district: 'Banana Island' },
};

/** Coming-soon districts: fenced, hazard-striped building sites. Ids are those of COMING_SOON. */
export const soon = {
  airport: { x: -103, z: -66, zone: [-122, -82, -88, -48], gate: [-86, -56] },
  refinery: { x: 116, z: 27, zone: [106, 16, 126, 37], gate: [104, 29] },
};

/** District name plates laid on the ground: [x, z, size]. `water` plates are lettered straight onto the water. */
export const districts = [
  { name: 'IKEJA', x: -68, z: -70, size: 2.6 }, { name: 'MUSHIN', x: -34, z: -45, size: 2.2 }, { name: 'SURULERE', x: -76, z: -22, size: 2.2 },
  { name: 'YABA', x: 10, z: -19.5, size: 2.2 }, { name: 'GBAGADA', x: -6, z: -72, size: 2 }, { name: 'APAPA', x: -100, z: 6, size: 2.2 },
  { name: 'LAGOS ISLAND', x: -14, z: 23, size: 1.6, water: true }, { name: 'IKOYI', x: 40, z: 4.6, size: 1.7 }, { name: 'BANANA ISLAND', x: 92, z: -12, size: 1.3, water: true },
  { name: 'VICTORIA ISLAND', x: 30, z: 33.5, size: 1.5 }, { name: 'LEKKI', x: 86, z: 34.5, size: 2.2 },
  { name: 'LAGOS LAGOON', x: 86, z: -34, size: 3.4, water: true }, { name: 'ATLANTIC OCEAN', x: 30, z: 54, size: 3, water: true, sea: true },
  { name: 'THIRD MAINLAND BRIDGE', x: 62, z: -50, size: 1.2, water: true }, { name: 'LINK BRIDGE', x: 68, z: 10.5, size: 1.1, water: true },
];

/** Areas the city fabric keeps clear: [x0, z0, x1, z1]. Sites, roads and plates are kept clear automatically. */
export const zones = [
  [-122, -82, -88, -48],   // airport
  [106, 16, 126, 37],      // refinery
  [-84, 2, -52, 18],       // Apapa port
];

/**
 * What the fabric of each part of town is made of. The first area containing a point wins.
 * style: 'dense' tin-roofed houses · 'blocks' mid-rise · 'towers' high-rise · 'villas' big houses and gardens · 'green' trees only
 */
export const fabric = [
  { box: [-126, -86, -30, -46], style: 'blocks' },           // Ikeja
  { box: [-126, -46, 50, 14], style: 'dense' },              // Mushin, Surulere, Yaba
  { box: [-30, -86, 50, -46], style: 'dense' },              // Gbagada, Bariga
  { box: [-48, -4, 12, 22], style: 'blocks' },               // Lagos Island
  { box: [12, -4, 58, 22], style: 'villas' },                // Ikoyi
  { box: [46, -19, 76, -3], style: 'villas' },               // Banana Island
  { box: [-18, 25, 56, 42], style: 'towers' },               // Victoria Island
  { box: [56, 12, 104, 42], style: 'villas' },               // Lekki
];

/** Home estates for the Neighbours layer: where each district's player homes are drawn. */
export const estates = {
  mushin: { x: -80, z: -47, cols: 6 }, yaba: { x: -16, z: -50, cols: 6 }, lekki: { x: 54, z: 32.5, cols: 6 }, ikoyi: { x: 11.5, z: 12.5, cols: 6 }, banana: { x: 52, z: -13, cols: 4, max: 8 },
};

const STRIPE = ['#f2c230', '#22252a'];

/** Hazard-striped fence around a rectangle, with a gap for the gate. */
function hazardFence(b, [x0, z0, x1, z1]) {
  const run = (ax, az, bx, bz) => {
    const length = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(length / 2.2)), ry = Math.atan2(bx - ax, bz - az);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      b.box(ax + (bx - ax) * t, 0.55, az + (bz - az) * t, 0.3, 0.5, length / n * 0.98, STRIPE[i % 2], { ry });
      if (i % 3 === 0) b.box(ax + (bx - ax) * t, 0.3, az + (bz - az) * t, 0.36, 0.6, 0.36, '#6b6f75', { ry });
    }
  };
  run(x0, z0, x1, z0); run(x1, z0, x1, z1); run(x1, z1, x0, z1); run(x0, z1, x0, z0);
}
function crane(b, x, z, ry = 0, h = 7, colour = '#e8a13a') {
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
export function decorate(b, { rng }) {
  // ---- Apapa port: quay, gantry cranes, container stacks, two ships ---------------------------
  b.box(-68, 0.12, 10, 30, 0.24, 13, '#9a9c9a');
  const boxes = ['#c9423a', '#2b5fa8', '#e8a13a', '#3f9a5a', '#ece2c6', '#7a4bb0'];
  for (let i = 0; i < 26; i++) {
    const x = -80 + (i % 9) * 3, z = 6 + Math.floor(i / 9) * 3.4, high = 1 + Math.floor(rng() * 3);
    for (let level = 0; level < high; level++) b.box(x, 0.65 + level * 0.82, z, 2.6, 0.8, 1.2, boxes[Math.floor(rng() * boxes.length)]);
  }
  for (const z of [5, 10, 15]) {
    b.at(-54.5, 0, z, 0, () => {
      for (const sx of [-1, 1]) { b.box(sx * 1.2, 2.6, -0.9, 0.3, 5.2, 0.3, '#2b5fa8'); b.box(sx * 1.2, 2.6, 0.9, 0.3, 5.2, 0.3, '#2b5fa8'); }
      b.box(2.2, 5.3, 0, 8.4, 0.4, 2.2, '#2b5fa8');
      b.box(3.4, 4.6, 0, 0.8, 0.7, 0.8, '#ece8dc');
    });
  }
  for (const [x, z, ry, hull] of [[-46, 9, 0, '#33414f'], [-66, 22, Math.PI / 2, '#7a2f2a']]) {
    b.at(x, -0.5, z, ry, () => {
      b.box(0, 0.5, 0, 3, 1.1, 11, hull);
      b.box(0, 1.25, -3.8, 2.4, 1.4, 2.2, '#ece8dc');
      b.box(0, 2.2, -3.8, 0.7, 0.7, 0.7, '#c9423a');
      for (let i = 0; i < 3; i++) b.box(0, 1.35, -1 + i * 2.2, 2.4, 0.8, 1.9, boxes[(i * 2 + (x < -50 ? 1 : 0)) % boxes.length]);
    });
  }

  // ---- Airport at Ikeja: a building site, visibly not open yet --------------------------------
  const air = soon.airport.zone;
  b.box(-105, 0.07, -65, 33, 0.14, 33, '#c8bfa4');
  b.box(-105, 0.16, -74, 30, 0.06, 4.2, '#4a4e55');                         // runway
  for (let i = 0; i < 9; i++) b.box(-117 + i * 3, 0.2, -74, 1.6, 0.02, 0.3, '#ece8dc');
  b.box(-104, 0.16, -68, 3, 0.06, 8, '#4a4e55');                            // taxiway
  b.box(-100, 1.3, -58, 14, 2.6, 5, '#d9d4c4');                             // terminal shell
  b.box(-100, 2.75, -58, 14.6, 0.3, 5.6, '#7d858c');
  for (let i = 0; i < 6; i++) b.box(-106 + i * 2.4, 1.4, -55.4, 1.6, 1.4, 0.1, '#8fb8cc');
  for (let i = 0; i < 5; i++) b.box(-106 + i * 3, 3.6, -58, 0.14, 1.6, 0.14, '#8a8f95');   // bare steel above the roof
  b.box(-100, 4.4, -58, 12.4, 0.14, 0.14, '#8a8f95');
  b.cyl(-114, 3, -60, 0.9, 6, '#d9d4c4', { seg: 8 });                       // control tower
  b.cyl(-114, 6.5, -60, 1.5, 1.2, '#55707c', { seg: 8, top: 1.25 });
  b.at(-96, 0.2, -68, 1.2, () => {                                          // one parked plane
    b.cyl(0, 0.9, 0, 0.55, 6.4, '#ece8dc', { seg: 8, rx: Math.PI / 2 });
    b.cone(0, 0.9, 3.7, 0.55, 1.1, '#ece8dc', { seg: 8, rx: Math.PI / 2 });
    b.box(0, 0.85, 0.2, 7.4, 0.14, 1.5, '#d9d4c4');
    b.box(0, 1.1, -2.8, 2.8, 0.12, 0.8, '#d9d4c4');
    b.box(0, 1.8, -2.9, 0.14, 1.5, 0.9, '#3f9a5a');
  });
  crane(b, -112, -53, 0.6, 8);
  crane(b, -92, -64, -1.9, 6.5, '#d9482f');
  hazardFence(b, air);

  // ---- Refinery in the Lekki Free Zone: tanks, stacks and scaffolding ---------------------------
  const ref = soon.refinery.zone;
  b.box(116, 0.07, 26.5, 20, 0.14, 21, '#c8bfa4');
  for (const [x, z, r, h] of [[110, 20, 2.2, 2.4], [115.5, 20, 2.2, 2.4], [121, 20, 2.2, 2.4], [110, 25.5, 1.6, 3.2], [114, 25.5, 1.6, 3.2]]) {
    b.cyl(x, h / 2, z, r, h, '#dfe2e0', { seg: 10 });
    b.cyl(x, h + 0.12, z, r * 0.96, 0.24, '#b8bcba', { seg: 10, top: 0.5 });
  }
  for (const [x, z, h] of [[120, 27, 9], [122.5, 29.5, 7]]) {
    b.cyl(x, h / 2, z, 0.5, h, '#9aa0a4', { seg: 7, top: 0.7 });
    for (let band = 0; band < 3; band++) b.cyl(x, h - 0.6 - band * 1.4, z, 0.52, 0.5, band % 2 ? '#ece8dc' : '#c9423a', { seg: 7 });
  }
  b.box(112, 1.4, 32, 8, 2.8, 4, '#aab0b3');
  for (let i = 0; i < 5; i++) { b.box(108.4 + i * 1.8, 2.2, 34.2, 0.12, 4.4, 0.12, '#8a8f95'); b.box(112, 1 + i * 0.9, 34.2, 7.4, 0.1, 0.1, '#8a8f95'); }
  for (let i = 0; i < 4; i++) b.cyl(118 + i * 1.6, 0.9, 34, 0.14, 1.8, '#8a8f95', { seg: 5, rz: Math.PI / 2 });
  crane(b, 123, 34, 2.4, 7.5);
  hazardFence(b, ref);

  // ---- Eko Atlantic: reclaimed land with its first towers ---------------------------------------
  for (const [x, z, h, colour] of [[-5, 50, 9, '#b9c7cf'], [1, 52, 12, '#9fb4c0'], [8, 50, 7.5, '#c9d2d4']]) {
    b.box(x, h / 2, z, 3.2, h, 3.2, colour);
    b.box(x, h + 0.2, z, 2.4, 0.4, 2.4, '#7d858c');
  }
}

export default { id, name, bounds, land, roads, sites, homes, soon, districts, zones, fabric, estates, decorate };
