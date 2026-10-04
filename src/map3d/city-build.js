/**
 * OWNER: world
 * Builds a city pack (src/map3d/cities/*.js) into a Three.js group: the board, the water, the
 * land, roads and bridges, one landmark per venue, the coming-soon building sites, district
 * plates, and the fabric that makes it a city — houses, blocks, towers, trees, palms, boats and
 * street traffic.
 *
 * BUDGET (asserted in src/map3d/map3d.test.js): everything static is merged into a few meshes and
 * everything repeated is instanced, so the whole city is a few dozen draw calls and stays under
 * 60,000 triangles. Nothing here needs a WebGL context: it is typed-array work and runs under
 * `node --test`. There are no shadow maps — shadows are flat dark quads laid beside what casts them.
 *
 *   buildCity(kit, pack, network, { venues, soon, labelOf }) → {
 *     group, places, triangles, counts,
 *     setHome(houseId)        move the Home landmark to the player's district
 *     setTime('day'|'dusk'|'night')
 *     setTraffic(on)          the decorative "Moving" layer: more vehicles, and they drive
 *     animate(seconds)        called only from a running frame loop: water and traffic drift
 *     dispose()
 *   }
 * places[id] = { id, kind: 'venue' | 'home' | 'soon', x, z, ry, top, gate }
 */
import { createBatch, sceneMaterials, hash } from '../scene/build.js';
import { sign, textWidth } from '../scene/props.js';
import { drawLandmark, PLINTH } from './landmarks.js';
import { miniVehicle, boat } from './vehicles.js';
import { roundPolygon, pointInPolygon } from './roads.js';

export const WATER_Y = -0.5;
const LAND_COLOURS = { mainland: '#bcd596', island: '#c6dca2', estate: '#b2d892', sand: '#f1dfae' };
const ASPHALT = '#5d626b', KERB = '#e4dfcf', DASH = '#f6f2e2', PATH = '#dcd2b6';

export const CITY_LIGHT = Object.freeze({
  day: { sky: ['#cfeaf5', '#8fcbe6'], hemi: ['#f4fbff', '#9fb07f', 2.1], sun: ['#fff0d2', 2.5, [-70, 120, 90]], water: '#4faacb', windows: '#56748c', waves: 0.5, shadow: 0.2 },
  dusk: { sky: ['#f3b184', '#6a5c98'], hemi: ['#f6c9a8', '#5a5370', 1.45], sun: ['#ff9f5f', 1.9, [-130, 46, 40]], water: '#4a79a6', windows: '#ffd9a0', waves: 0.35, shadow: 0.24 },
  night: { sky: ['#1b2748', '#0a1024'], hemi: ['#8ea6dc', '#18233a', 0.95], sun: ['#a9bff2', 0.85, [-60, 110, 60]], water: '#17345a', windows: '#ffffff', waves: 0.16, shadow: 0.3 },
});

function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const segmentDistance = (x, z, a, b) => { const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(x - a.x - dx * t, z - a.z - dz * t); };
const inBox = (x, z, [x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1;

/** A hand-rolled mesh collector for flat things the batch has no primitive for: polygons, ribbons, walls. */
export function createRaw(THREE) {
  const pos = [], nor = [], col = [], idx = [], tint = new THREE.Color(), cache = new Map();
  const rgb = (colour) => { if (!cache.has(colour)) { tint.set(colour); cache.set(colour, [tint.r, tint.g, tint.b]); } return cache.get(colour); };
  const v = (x, y, z, nx, ny, nz, colour) => { const c = rgb(colour); pos.push(x, y, z); nor.push(nx, ny, nz); col.push(c[0], c[1], c[2]); return pos.length / 3 - 1; };
  /** A triangle wound so that it faces the way its first vertex's normal points. */
  function tri(i, j, k) {
    const ax = pos[i * 3], ay = pos[i * 3 + 1], az = pos[i * 3 + 2];
    const ux = pos[j * 3] - ax, uy = pos[j * 3 + 1] - ay, uz = pos[j * 3 + 2] - az, wx = pos[k * 3] - ax, wy = pos[k * 3 + 1] - ay, wz = pos[k * 3 + 2] - az;
    const facing = (uy * wz - uz * wy) * nor[i * 3] + (uz * wx - ux * wz) * nor[i * 3 + 1] + (ux * wy - uy * wx) * nor[i * 3 + 2];
    if (facing >= 0) idx.push(i, j, k); else idx.push(i, k, j);
  }
  const raw = {
    /** A flat polygon [[x, z], …] at height y, facing up. */
    shape(polygon, y, colour) {
      const base = pos.length / 3;
      for (const [x, z] of polygon) v(x, y, z, 0, 1, 0, colour);
      for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(polygon.map(([x, z]) => new THREE.Vector2(x, z)), [])) tri(base + a, base + b, base + c);
    },
    /** The vertical side of a closed polygon between two heights, facing outwards. */
    wall(polygon, y0, y1, colour) {
      let area = 0;
      for (let i = 0; i < polygon.length; i++) { const [ax, az] = polygon[i], [bx, bz] = polygon[(i + 1) % polygon.length]; area += ax * bz - bx * az; }
      const out = area > 0 ? 1 : -1;
      for (let i = 0; i < polygon.length; i++) {
        const [ax, az] = polygon[i], [bx, bz] = polygon[(i + 1) % polygon.length], length = Math.hypot(bx - ax, bz - az) || 1;
        const nx = ((bz - az) / length) * out, nz = (-(bx - ax) / length) * out;
        const a = v(ax, y1, az, nx, 0, nz, colour), b = v(bx, y1, bz, nx, 0, nz, colour), c = v(bx, y0, bz, nx, 0, nz, colour), d = v(ax, y0, az, nx, 0, nz, colour);
        tri(a, b, c); tri(a, c, d);
      }
    },
    /** A flat band of the given width along a polyline [{ x, y, z }], `lift` above it; `side` shifts it sideways. */
    ribbon(points, width, lift, colour, side = 0) {
      const base = pos.length / 3;
      for (let i = 0; i < points.length; i++) {
        const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)], length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const px = -(b.z - a.z) / length, pz = (b.x - a.x) / length, p = points[i];
        v(p.x + px * (side + width / 2), p.y + lift, p.z + pz * (side + width / 2), 0, 1, 0, colour);
        v(p.x + px * (side - width / 2), p.y + lift, p.z + pz * (side - width / 2), 0, 1, 0, colour);
      }
      for (let i = 0; i < points.length - 1; i++) { const k = base + i * 2; tri(k, k + 1, k + 2); tri(k + 1, k + 3, k + 2); }
    },
    /** A vertical strip along a polyline, `side` units to one side, between two lifts; it faces away from the line. */
    strip(points, side, low, high, colour, facing = Math.sign(side) || 1) {
      const base = pos.length / 3;
      for (let i = 0; i < points.length; i++) {
        const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)], length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const px = -(b.z - a.z) / length, pz = (b.x - a.x) / length, p = points[i];
        v(p.x + px * side, p.y + high, p.z + pz * side, px * facing, 0, pz * facing, colour);
        v(p.x + px * side, p.y + low, p.z + pz * side, px * facing, 0, pz * facing, colour);
      }
      for (let i = 0; i < points.length - 1; i++) { const k = base + i * 2; tri(k, k + 1, k + 2); tri(k + 1, k + 3, k + 2); }
    },
    get triangles() { return idx.length / 3; },
    build(material) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
      geometry.setIndex(new THREE.BufferAttribute(pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
      return new THREE.Mesh(geometry, material);
    },
  };
  return raw;
}

/** Push a polygon's outline outwards by `distance`. */
function offsetPolygon(polygon, distance) {
  let area = 0;
  for (let i = 0; i < polygon.length; i++) { const [ax, az] = polygon[i], [bx, bz] = polygon[(i + 1) % polygon.length]; area += ax * bz - bx * az; }
  const out = area > 0 ? 1 : -1, n = polygon.length;
  return polygon.map(([x, z], i) => {
    const [px, pz] = polygon[(i + n - 1) % n], [qx, qz] = polygon[(i + 1) % n], length = Math.hypot(qx - px, qz - pz) || 1;
    return [x + ((qz - pz) / length) * out * distance, z + (-(qx - px) / length) * out * distance];
  });
}

export function buildCity(kit, pack, network, { venues = {}, soon = {} } = {}) {
  const { THREE } = kit;
  const shared = sceneMaterials(kit);
  const rng = mulberry(hash(`city:${pack.id}`));
  const group = new THREE.Group();
  group.name = `city:${pack.id}`;
  const own = [];                                   // geometries and materials this city must free
  const keep = (thing) => { own.push(thing); return thing; };
  const materials = {
    ground: keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })),
    water: keep(new THREE.MeshStandardMaterial({ color: CITY_LIGHT.day.water, roughness: 0.42, metalness: 0.05 })),
    board: keep(new THREE.MeshStandardMaterial({ color: '#2c4a52', roughness: 1 })),
    waves: keep(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false })),
    windows: keep(new THREE.MeshBasicMaterial({ vertexColors: true, color: CITY_LIGHT.day.windows })),
    shadow: keep(new THREE.MeshBasicMaterial({ color: '#0d1a14', transparent: true, opacity: 0.2, depthWrite: false })),
    instanced: keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 })),
  };
  let triangles = 0;
  const add = (mesh, name, order = 0) => { mesh.name = name; mesh.renderOrder = order; mesh.matrixAutoUpdate = false; mesh.updateMatrix(); keep(mesh.geometry); group.add(mesh); return mesh; };
  const count = (mesh) => { triangles += (mesh.geometry.index.count / 3) * (mesh.isInstancedMesh ? mesh.count : 1); return mesh; };

  // ---- the board and the water -------------------------------------------------------------
  const { minX, maxX, minZ, maxZ } = pack.bounds;
  const seaZ = pack.bounds.sea ? pack.bounds.sea.z1 + 4 : maxZ;
  const width = maxX - minX, depth = seaZ - minZ, midX = (minX + maxX) / 2, midZ = (minZ + seaZ) / 2;
  const board = new THREE.Mesh(new THREE.BoxGeometry(width + 2, 3, depth + 2), materials.board);
  board.position.set(midX, WATER_Y - 1.56, midZ);
  count(add(board, 'board'));
  const water = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), materials.water);
  water.rotation.x = -Math.PI / 2; water.position.set(midX, WATER_Y, midZ);
  count(add(water, 'water'));

  // ---- land --------------------------------------------------------------------------------
  const raw = createRaw(THREE);
  const lands = pack.land.map((entry) => { const polygon = roundPolygon(entry.points, 2); return { ...entry, polygon, wide: offsetPolygon(polygon, 3) }; });
  for (const entry of lands) {
    const sand = entry.kind === 'sand';
    raw.shape(offsetPolygon(entry.polygon, 2.6), WATER_Y + 0.03, '#7cc6d6');                       // the shallows
    raw.shape(offsetPolygon(entry.polygon, 1.1), WATER_Y + 0.14, sand ? '#f8efd2' : '#ecdcae');    // the beach rim
    raw.wall(entry.polygon, WATER_Y + 0.1, sand ? -0.12 : 0, sand ? '#e0cc98' : '#a9b98a');
    raw.shape(entry.polygon, sand ? -0.12 : 0, LAND_COLOURS[entry.kind] || LAND_COLOURS.mainland);
  }
  const buildable = lands.filter((entry) => entry.kind !== 'sand');
  const onLand = (x, z, margin = 0) => buildable.some((entry) => pointInPolygon(x, z, entry.polygon)
    && (!margin || [[margin, 0], [-margin, 0], [0, margin], [0, -margin]].every(([dx, dz]) => pointInPolygon(x + dx, z + dz, entry.polygon))));
  const onAnyLand = (x, z) => lands.some((entry) => pointInPolygon(x, z, entry.wide));

  // ---- roads and bridges --------------------------------------------------------------------
  const b = createBatch(THREE), w = createBatch(THREE);
  const g = { b, w, at: (x, y, z, ry, draw) => b.at(x, y, z, ry, () => w.at(x, y, z, ry, () => draw(g))) };
  const segments = [];                              // every ground stretch of road, for keeping the fabric off it
  for (const road of network.roads) {
    const wide = road.major ? 2.5 : 1.8;
    raw.ribbon(road.points, wide + 0.7, road.bridge ? 0.05 : 0.035, KERB);
    raw.ribbon(road.points, wide, road.bridge ? 0.08 : 0.06, ASPHALT);
    if (road.major) {
      for (let i = 1; i < road.points.length - 1; i += 2) {
        const a = road.points[i], c = road.points[i + 1], mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2, z: (a.z + c.z) / 2 };
        raw.ribbon([{ x: a.x + (mid.x - a.x) * 0.3, y: a.y, z: a.z + (mid.z - a.z) * 0.3 }, mid], 0.16, road.bridge ? 0.1 : 0.08, DASH);
      }
    }
    if (road.bridge) {
      for (const side of [-1, 1]) {
        const edge = side * (wide / 2 + 0.35);
        raw.strip(road.points, edge, -0.4, 0.42, '#efe9da', side); raw.strip(road.points, edge - side * 0.12, 0.05, 0.42, '#d6cfbc', -side);
        raw.ribbon(road.points, 0.14, 0.42, '#f6f2e6', edge - side * 0.06);
      }
      let since = 99;
      for (let i = 1; i < road.points.length - 1; i++) {
        const point = road.points[i], previous = road.points[i - 1];
        since += Math.hypot(point.x - previous.x, point.z - previous.z);
        if (since < 5.5 || onLand(point.x, point.z)) continue;
        since = 0;
        const next = road.points[i + 1], ry = Math.atan2(next.x - previous.x, next.z - previous.z), height = point.y - WATER_Y;
        b.box(point.x, WATER_Y + height / 2 - 0.2, point.z, wide * 0.8, height, 0.5, '#cfc8b6', { ry });
        b.box(point.x, WATER_Y + 0.12, point.z, wide * 0.95, 0.24, 0.9, '#b9b2a0', { ry });
      }
      if (road.pylon) {                              // a cable-stayed pylon at the middle of the span
        const middle = road.points[Math.floor(road.points.length / 2)], from = road.points[0], to = road.points[road.points.length - 1];
        const ry = Math.atan2(to.x - from.x, to.z - from.z), top = middle.y + 9;
        b.at(middle.x, 0, middle.z, ry, () => {
          for (const side of [-1, 1]) b.box(side * 1.5, (top + WATER_Y) / 2, 0, 0.45, top - WATER_Y, 0.55, '#f1ede2', { rz: side * 0.14 });
          b.box(0, top - 0.6, 0, 1.2, 0.5, 0.6, '#f1ede2');
          for (const end of [-1, 1]) for (let i = 1; i <= 4; i++) {
            const reach = i * 2.1 * end, drop = top - 1 - middle.y - 0.3, length = Math.hypot(reach, drop);
            b.box(0, middle.y + 0.3 + drop / 2, reach / 2, 0.05, length, 0.05, '#dfe4e6', { rx: -Math.atan2(reach, drop) });
          }
          b.ico(0, top + 0.2, 0, 0.16, 0.16, 0.16, '#ff3b30', { layer: 'glow' });
        });
      }
    } else {
      for (let i = 1; i < road.points.length; i++) segments.push({ a: road.points[i - 1], b: road.points[i], half: wide / 2 + 0.5 });
    }
  }

  // ---- landmarks ----------------------------------------------------------------------------
  const places = {};
  const shadows = [];                               // { x, z, w, d, ry } flat shadows, drawn as one instanced mesh
  const clear = [];                                 // { x, z, r } circles the fabric keeps out of
  const path = (place) => {
    if (!place.gate) return;
    const length = Math.hypot(place.gate.x - place.x, place.gate.z - place.z), k = Math.min(1, (PLINTH / 2 - 0.2) / (length || 1));
    const start = { x: place.x + (place.gate.x - place.x) * k, y: 0, z: place.z + (place.gate.z - place.z) * k };
    raw.ribbon([start, place.gate], 1.3, 0.045, PATH);
    segments.push({ a: start, b: place.gate, half: 1.2 });
  };
  for (const [id, spot] of Object.entries(pack.sites)) {
    const venue = venues[id], node = network.places[id];
    if (!venue || !node) continue;
    let top = 4;
    g.at(node.x, 0, node.z, node.ry, () => { top = drawLandmark(g, venue.scene?.kind, venue.scene?.variant).top; });
    places[id] = { id, kind: 'venue', x: spot.x, z: spot.z, ry: node.ry, top, gate: node.gate };
    shadows.push({ x: spot.x + 0.7, z: spot.z + 0.55, w: PLINTH + 1.3, d: PLINTH + 1.3, ry: node.ry });
    clear.push({ x: spot.x, z: spot.z, r: PLINTH * 0.78 });
    path(places[id]);
  }
  // Home: every district's lot is laid out; the house itself is its own small mesh, moved to the player's lot.
  for (const [house, spot] of Object.entries(pack.homes)) {
    const node = network.places[`home:${house}`];
    b.box(spot.x, 0.06, spot.z, PLINTH + 0.4, 0.12, PLINTH + 0.4, '#a7cf8c');
    clear.push({ x: spot.x, z: spot.z, r: PLINTH * 0.78 });
    path({ x: spot.x, z: spot.z, gate: node.gate });
  }
  for (const [id, spot] of Object.entries(pack.soon || {})) {
    if (!soon[id]) continue;
    places[id] = { id, kind: 'soon', x: spot.x, z: spot.z, ry: 0, top: 7.5, gate: null };
  }
  const homeBatch = createBatch(THREE), homeWindows = createBatch(THREE);
  const hg = { b: homeBatch, w: homeWindows, at: (x, y, z, ry, draw) => draw(hg) };
  const homeTop = drawLandmark(hg, 'home').top;

  // ---- district plates, laid on the ground or lettered on the water ---------------------------
  const plates = [];
  for (const plate of pack.districts || []) {
    const size = plate.size || 2, wide = textWidth(plate.name, size);
    b.at(plate.x, plate.water ? WATER_Y + 0.07 : 0.1, plate.z, 0, () => {
      if (!plate.water) b.box(0, 0, -0.04, wide + size * 0.9, size * 1.7, 0.08, '#8fb07a');
      sign(b, 0, 0, 0, plate.name, { size, color: plate.water ? '#d6f1f7' : '#f6faea' });
    }, -Math.PI / 2);
    plates.push({ ...plate, box: [plate.x - wide / 2 - size, plate.z - size * 1.2, plate.x + wide / 2 + size, plate.z + size * 1.2] });
  }

  // ---- what only this city has ----------------------------------------------------------------
  pack.decorate?.(b, { rng, w });

  // ---- boats on the lagoon and the creek ------------------------------------------------------
  const hulls = ['#b5483f', '#2b5fa8', '#e0a23a', '#3f9a5a', '#ece2c6'];
  for (let i = 0, placed = 0; i < 400 && placed < 16; i++) {
    const x = minX + 8 + rng() * (width - 16), z = minZ + 8 + rng() * (maxZ - minZ - 16);
    if (onAnyLand(x, z) || network.roads.some((road) => road.bridge && road.points.some((point) => Math.hypot(point.x - x, point.z - z) < 5)) || plates.some((plate) => inBox(x, z, plate.box))) continue;
    boat(b, x, z, rng() * Math.PI * 2, hulls[placed % hulls.length], placed % 3 !== 0);
    placed += 1;
  }

  // ---- the fabric: houses, blocks, towers, trees and palms ------------------------------------
  const roadDistance = (x, z) => { let best = Infinity; for (const segment of segments) { const d = segmentDistance(x, z, segment.a, segment.b) - segment.half; if (d < best) best = d; } return best; };
  const blocked = (x, z, pad) => clear.some((circle) => Math.hypot(circle.x - x, circle.z - z) < circle.r + pad)
    || (pack.zones || []).some((zone) => inBox(x, z, [zone[0] - pad, zone[1] - pad, zone[2] + pad, zone[3] + pad]))
    || plates.some((plate) => !plate.water && inBox(x, z, [plate.box[0] - pad, plate.box[1] - pad, plate.box[2] + pad, plate.box[3] + pad]))
    || Object.values(pack.estates || {}).some((estate) => inBox(x, z, [estate.x - 1.6 - pad, estate.z - 1.6 - pad, estate.x + (estate.cols - 1) * 2.7 + 1.6 + pad, estate.z + (Math.ceil((estate.max ?? 18) / estate.cols) - 1) * 3 + 1.6 + pad]));
  const noise = (x, z) => { const cell = (ix, iz) => (hash(`${pack.id}:${ix}:${iz}`) % 1000) / 1000, fx = x / 22, fz = z / 22, ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    return (cell(ix, iz) * (1 - tx) + cell(ix + 1, iz) * tx) * (1 - tz) + (cell(ix, iz + 1) * (1 - tx) + cell(ix + 1, iz + 1) * tx) * tz; };
  const STYLES = {
    dense: { gap: 3.5, keep: 0.66, tree: 0.1 },
    blocks: { gap: 4.6, keep: 0.7, tree: 0.1 },
    towers: { gap: 5.0, keep: 0.78, tree: 0.08 },
    villas: { gap: 4.7, keep: 0.74, tree: 0.26 },
  };
  const WALLS = ['#f3ead6', '#ece0c4', '#f6f0e2', '#e9d9b8', '#efe3d0', '#dfe8ea'], ROOFS = ['#a85c40', '#96483a', '#8d9399', '#b67a45', '#6f8492', '#9b9b8f'];
  const BLOCKS = ['#e6dcc6', '#d9cdb4', '#cfd8dc', '#e8d6c0', '#d6dfd0', '#f0e4cc'], GLASSY = ['#9fb9c8', '#b7c9d2', '#8fa9bd', '#c9d6da', '#a9bfc0', '#d9d2c0'];
  const houses = [], towers = [], trees = [], palms = [];
  for (const area of pack.fabric || []) {
    const style = STYLES[area.style];
    if (!style) continue;
    for (let x = area.box[0]; x <= area.box[2]; x += style.gap) for (let z = area.box[1]; z <= area.box[3]; z += style.gap) {
      const px = x + (rng() - 0.5) * 0.7, pz = z + (rng() - 0.5) * 0.7, roll = rng(), turn = rng() < 0.5 ? 0 : Math.PI / 2, pick = Math.floor(rng() * 6), tall = rng();
      // The first area that contains a point owns it, so overlapping areas never double up.
      if (pack.fabric.find((entry) => inBox(px, pz, entry.box)) !== area) continue;
      if (!onLand(px, pz, 2.2) || blocked(px, pz, 1.6)) continue;
      const toRoad = roadDistance(px, pz);
      if (toRoad < 1.5) continue;
      const patch = noise(px, pz);
      // Built-up patches along the roads, green between them.
      const built = toRoad < 24 && patch < style.keep + (toRoad < 7 ? 0.3 : 0);
      if (!built || roll < style.tree) {
        if (roll < (built ? 1 : 0.5)) (area.style === 'villas' && tall < 0.35 ? palms : trees).push({ x: px, z: pz, s: 0.8 + tall * 0.7, ry: tall * 6 });
        continue;
      }
      if (area.style === 'dense') houses.push({ x: px, z: pz, ry: turn, sx: 1.9 + tall * 0.6, sy: 1.0 + tall * 0.5, sz: 2.2 + roll * 0.7, wall: WALLS[pick], roof: ROOFS[(pick + Math.floor(tall * 3)) % 6] });
      else if (area.style === 'villas') houses.push({ x: px, z: pz, ry: turn, sx: 2.7 + tall * 0.6, sy: 1.5 + tall * 0.5, sz: 3.0 + roll * 0.6, wall: '#f6f1e6', roof: ['#b5593c', '#a85c40', '#3f7f86', '#b5593c', '#96483a', '#55707c'][pick] });
      else if (area.style === 'blocks') towers.push({ x: px, z: pz, ry: turn, sx: 2.5 + roll * 0.9, sy: 2.4 + tall * 2.4, sz: 2.5 + tall * 0.8, colour: BLOCKS[pick] });
      else towers.push({ x: px, z: pz, ry: turn, sx: 2.7 + roll * 0.8, sy: 4.6 + tall * tall * 7.5, sz: 2.7 + tall * 0.6, colour: GLASSY[pick] });
    }
  }
  // Palms along the sand, wherever there is sand.
  for (const entry of lands.filter((item) => item.kind === 'sand')) {
    for (let i = 0; i < entry.polygon.length; i += 3) {
      const [ax, az] = entry.polygon[i];
      const cx = entry.polygon.reduce((sum, point) => sum + point[0], 0) / entry.polygon.length, cz = entry.polygon.reduce((sum, point) => sum + point[1], 0) / entry.polygon.length;
      const x = ax + (cx - ax) * 0.12 + (rng() - 0.5) * 2, z = az + (cz - az) * 0.3 + (rng() - 0.5);
      if (!blocked(x, z, 1) && roadDistance(x, z) > 1 && pointInPolygon(x, z, entry.polygon)) palms.push({ x, z, s: 0.8 + rng() * 0.5, ry: rng() * 6, y: -0.12 });
    }
  }
  const thin = (list, cap) => { if (list.length <= cap) return list; const step = list.length / cap; return Array.from({ length: cap }, (_, i) => list[Math.floor(i * step)]); };
  const HOUSE_CAP = 560, TOWER_CAP = 150, TREE_CAP = 330, PALM_CAP = 90;
  const fabric = { houses: thin(houses, HOUSE_CAP), towers: thin(towers, TOWER_CAP), trees: thin(trees, TREE_CAP), palms: thin(palms, PALM_CAP) };

  const dummy = new THREE.Object3D(), tint = new THREE.Color();
  const unit = (draw, material = materials.instanced) => { const batch = createBatch(THREE); draw(batch); return batch.build({ solid: material, glow: material, glass: material }).meshes[0].geometry; };
  function instanced(name, geometry, material, items, place, colourOf) {
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, items.length));
    mesh.count = items.length;
    items.forEach((item, i) => {
      place(item, dummy); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      if (colourOf) mesh.setColorAt(i, tint.set(colourOf(item)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    add(mesh, name);
    if (items.length) count(mesh);
    mesh.visible = items.length > 0;
    return mesh;
  }
  const upright = (item, object, sx = item.sx, sy = item.sy, sz = item.sz) => { object.position.set(item.x, item.y || 0, item.z); object.rotation.set(0, item.ry || 0, 0); object.scale.set(sx, sy, sz); };
  instanced('house-walls', unit((u) => u.box(0, 0.5, 0, 1, 1, 1, '#ffffff')), materials.instanced, fabric.houses, (item, o) => upright(item, o), (item) => item.wall);
  instanced('house-roofs', unit((u) => u.cyl(0, 0.3, 0, 0.78, 0.6, '#ffffff', { seg: 4, top: 0.08, ry: Math.PI / 4 })), materials.instanced, fabric.houses,
    (item, o) => { o.position.set(item.x, item.sy, item.z); o.rotation.set(0, item.ry, 0); o.scale.set(item.sx, 0.9 + item.sy * 0.25, item.sz); }, (item) => item.roof);
  instanced('house-windows', unit((u) => { u.quad(0.18, 0.55, 0.506, 0.26, 0.3, '#ffe6ae'); u.quad(0.506, 0.55, -0.1, 0.26, 0.3, '#fff4d6', { ry: Math.PI / 2 }); u.quad(-0.2, 0.55, -0.506, 0.26, 0.3, '#ffd98a', { ry: Math.PI }); }, materials.windows),
    materials.windows, fabric.houses, (item, o) => upright(item, o));
  instanced('towers', unit((u) => { u.box(0, 0.5, 0, 1, 1, 1, '#ffffff'); u.box(0, 1.01, 0, 0.7, 0.03, 0.7, '#c9ced3'); }), materials.instanced, fabric.towers, (item, o) => upright(item, o), (item) => item.colour);
  instanced('tower-windows', unit((u) => {
    const tones = ['#ffe6ae', '#fff4d6', '#2c3a4a', '#ffd98a', '#cfe4ff', '#2c3a4a'];
    for (let floor = 0; floor < 4; floor++) for (let face = 0; face < 4; face++) {
      const ry = face * Math.PI / 2;
      u.quad(Math.sin(ry) * 0.506, 0.2 + floor * 0.2, Math.cos(ry) * 0.506, 0.78, 0.085, tones[(floor * 5 + face * 3) % tones.length], { ry });
    }
  }, materials.windows), materials.windows, fabric.towers, (item, o) => upright(item, o));
  instanced('trees', unit((u) => { u.cyl(0, 0.45, 0, 0.13, 0.9, '#6b4f36', { seg: 5 }); u.ico(0, 1.45, 0, 0.85, 0.95, 0.85, '#ffffff'); }), materials.instanced, fabric.trees,
    (item, o) => upright(item, o, item.s, item.s, item.s), (item) => ['#3f8a57', '#4f9a5f', '#2c6b4a', '#5aa55f', '#3a7d4f'][Math.floor(item.ry * 7) % 5]);
  instanced('palms', unit((u) => {
    u.cyl(0, 1.5, 0, 0.11, 3.0, '#8a7250', { seg: 5, top: 0.7 });
    for (let i = 0; i < 6; i++) { const a = i * 1.047; u.cone(Math.sin(a) * 0.8, 2.95, Math.cos(a) * 0.8, 0.32, 1.6, i % 2 ? '#3f8a57' : '#4f9a5f', { seg: 3, rz: -Math.sin(a) * 1.25, rx: Math.cos(a) * 1.25 }); }
  }), materials.instanced, fabric.palms, (item, o) => upright(item, o, item.s, item.s, item.s));

  // ---- flat shadows: one instanced quad beside everything that stands up -----------------------
  for (const item of fabric.houses) shadows.push({ x: item.x + 0.3 + item.sy * 0.22, z: item.z + 0.2 + item.sy * 0.16, w: item.sx + 0.5, d: item.sz + 0.5, ry: item.ry });
  for (const item of fabric.towers) shadows.push({ x: item.x + 0.3 + item.sy * 0.2, z: item.z + 0.2 + item.sy * 0.14, w: item.sx + 0.5 + item.sy * 0.12, d: item.sz + 0.5 + item.sy * 0.1, ry: item.ry });
  for (const item of fabric.trees) shadows.push({ x: item.x + 0.4 * item.s, z: item.z + 0.3 * item.s, w: 1.7 * item.s, d: 1.5 * item.s, ry: 0.5 });
  const shadowGeometry = new THREE.PlaneGeometry(1, 1); shadowGeometry.rotateX(-Math.PI / 2);
  const shadowMesh = instanced('shadows', shadowGeometry, materials.shadow, shadows, (item, o) => { o.position.set(item.x, 0.02, item.z); o.rotation.set(0, item.ry, 0); o.scale.set(item.w, 1, item.d); });
  shadowMesh.renderOrder = 1;

  // ---- street traffic: parked until the Moving layer is on and a frame loop is running ---------
  const lanes = network.roads.filter((road) => road.major && road.length > 20);
  const traffic = [];
  for (let i = 0; i < 38 && lanes.length; i++) {
    const road = lanes[i % lanes.length];
    traffic.push({ road, at: rng() * road.length, speed: (2.2 + rng() * 2.2) * (i % 2 ? 1 : -1), kind: i % 5 < 2 ? 'danfo' : 'car', colour: ['#f6f2e6', '#c9423a', '#2b5fa8', '#30343b', '#d9d4c4', '#1f8a86'][i % 6] });
  }
  const along = (road, distance) => {
    const points = road.points, d = ((distance % road.length) + road.length) % road.length;
    let run = 0;
    for (let i = 1; i < points.length; i++) {
      const length = Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
      if (run + length >= d || i === points.length - 1) { const t = Math.min(1, (d - run) / (length || 1)); return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, y: points[i - 1].y + (points[i].y - points[i - 1].y) * t, z: points[i - 1].z + (points[i].z - points[i - 1].z) * t, ry: Math.atan2(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z) }; }
      run += length;
    }
    return { x: points[0].x, y: 0, z: points[0].z, ry: 0 };
  };
  const fleets = ['danfo', 'car'].map((kind) => {
    const items = traffic.filter((item) => item.kind === kind);
    const mesh = instanced(`traffic-${kind}`, unit((u) => miniVehicle(u, kind)), materials.instanced, items, (item, o) => o.position.set(0, 0, 0), kind === 'car' ? (item) => item.colour : null);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return { mesh, items };
  });
  let trafficOn = false;
  function placeTraffic(seconds) {
    for (const { mesh, items } of fleets) {
      items.forEach((item, i) => {
        const spot = along(item.road, item.at + (trafficOn ? item.speed * seconds : 0)), lane = item.speed > 0 ? -0.62 : 0.62, ry = spot.ry + (item.speed > 0 ? 0 : Math.PI);
        dummy.position.set(spot.x - Math.cos(spot.ry) * lane, spot.y + 0.08, spot.z + Math.sin(spot.ry) * lane);
        dummy.rotation.set(0, ry, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.count = trafficOn ? items.length : Math.ceil(items.length / 2);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
  placeTraffic(0);

  // ---- waves: a few pale dashes on open water ---------------------------------------------------
  const waveRaw = createRaw(THREE);
  for (let i = 0, placed = 0; i < 900 && placed < 150; i++) {
    const x = minX + 3 + rng() * (width - 6), z = minZ + 3 + rng() * (depth - 6), length = 1.2 + rng() * 2.2;
    if (onAnyLand(x, z)) continue;
    waveRaw.ribbon([{ x: x - length / 2, y: 0, z }, { x, y: 0, z: z + 0.12 }, { x: x + length / 2, y: 0, z }], 0.12, WATER_Y + 0.05, '#ffffff');
    placed += 1;
  }
  const waves = count(add(waveRaw.build(materials.waves), 'waves', 1));

  // ---- bake ------------------------------------------------------------------------------------
  count(add(raw.build(materials.ground), 'ground'));
  const built = b.build(shared);
  for (const mesh of built.meshes) { mesh.castShadow = false; mesh.receiveShadow = false; count(add(mesh, `city-${mesh.name}`, mesh.name === 'glass' ? 2 : 0)); }
  const windowMesh = w.build({ solid: materials.windows, glow: materials.windows, glass: materials.windows }).meshes[0];
  if (windowMesh) { windowMesh.castShadow = false; windowMesh.receiveShadow = false; count(add(windowMesh, 'windows')); }

  // The Home landmark: its own two small meshes in a group that is moved to the player's lot.
  const home = new THREE.Group();
  home.name = 'home';
  for (const mesh of homeBatch.build(shared).meshes) { mesh.castShadow = false; mesh.receiveShadow = false; keep(mesh.geometry); triangles += mesh.geometry.index.count / 3; home.add(mesh); }
  const homeWindowMesh = homeWindows.build({ solid: materials.windows, glow: materials.windows, glass: materials.windows }).meshes[0];
  if (homeWindowMesh) { homeWindowMesh.castShadow = false; keep(homeWindowMesh.geometry); triangles += homeWindowMesh.geometry.index.count / 3; home.add(homeWindowMesh); }
  group.add(home);
  let homeId = null;
  function setHome(house) {
    const id = Object.hasOwn(pack.homes, house) ? house : Object.keys(pack.homes)[0];
    if (id === homeId) return false;
    homeId = id;
    const node = network.places[`home:${id}`], spot = pack.homes[id];
    home.position.set(spot.x, 0, spot.z); home.rotation.y = node.ry;
    places.home = { id: 'home', kind: 'home', house: id, district: spot.district, x: spot.x, z: spot.z, ry: node.ry, top: homeTop, gate: node.gate };
    return true;
  }
  setHome(null);

  let time = 'day';
  return {
    group, places, materials, pack,
    get triangles() { return triangles; },
    counts: { houses: fabric.houses.length, towers: fabric.towers.length, trees: fabric.trees.length, palms: fabric.palms.length, vehicles: traffic.length, shadows: shadows.length },
    get time() { return time; },
    setHome,
    /** Lighting that belongs to the city's own materials. The host applies hemi, sun and sky. */
    setTime(next) {
      const preset = CITY_LIGHT[next] || CITY_LIGHT.day;
      time = CITY_LIGHT[next] ? next : 'day';
      materials.water.color.set(preset.water); materials.windows.color.set(preset.windows);
      materials.waves.opacity = preset.waves; materials.shadow.opacity = preset.shadow;
      return preset;
    },
    setTraffic(on) { if (trafficOn === Boolean(on)) return false; trafficOn = Boolean(on); placeTraffic(0); return true; },
    get traffic() { return trafficOn; },
    /** Only ever called from a running frame loop: nothing here moves while the map is idle. */
    animate(seconds) {
      waves.position.x = Math.sin(seconds * 0.5) * 0.9; waves.position.z = Math.cos(seconds * 0.37) * 0.35; waves.updateMatrix();
      if (trafficOn) placeTraffic(seconds);
    },
    dispose() {
      for (const thing of own) thing.dispose?.();
      group.parent?.remove(group);
      own.length = 0;
    },
  };
}
