/**
 * OWNER: world
 * THE HOUSES ON THE 3D MAP, at whatever scale the city has grown to.
 *
 * Every player has a house on a plot of an estate (src/game/content/world.js); a local government
 * holds up to 100,352 of them. Nothing here draws a house per DOM node or a mesh per house:
 *
 *   FAR      the whole city: per local government, its estates are gathered into at most
 *            BINS × BINS blocks (plus one for the first, big estate), each as tall as it is
 *            full. ONE instanced mesh for the city, built from the city summary (512 counters per
 *            local government) — two million residents cost the same as twenty.
 *   NEARER   the local government under the middle of the view: one flat pad per estate, tinted
 *            by how full it is. ONE instanced mesh.
 *   CLOSE    the estates in the middle of the view, as real houses: instanced by part (walls,
 *            doors, windows, roofs by shape, fences, yard pieces, plots, the green light of an
 *            owner who is online, scaffolding round an upgrade). The look of a house is a few
 *            small numbers (unpackStyle), written as per-instance colours. Estates are detailed
 *            nearest-first until the DETAIL_BUDGET of triangles is used; the rest stay pads.
 *
 *   createHouses(kit, pack) → {
 *     group, triangles, level,
 *     setSummary(Map<lga, { occ }>)                 rebuild FAR
 *     update(view, data, { own, serverNow })        choose the level for this view; returns the estates it wants loaded
 *     detailed() → [{ lga, estate }]                 the estates drawn as houses right now
 *     dispose()
 *   }
 * Pure geometry work on typed arrays: it runs under `node --test` without a WebGL context.
 */
import { createBatch } from '../scene/build.js';
import { leanGeometry } from './city-build.js';
import { ESTATE, PLOTS_PER_ESTATE, HOUSE_STYLE, HOUSE_TIERS, unpackStyle } from '../game/content/world.js';
import { estateLayout } from './estates.js';
import { lgaAt } from './lga.js';

export const BINS = 5;
export const DETAIL_BUDGET = 25000;
export const PAD_DISTANCE = 150;
const MAX_DETAILED = 9;
const SHAPES = HOUSE_STYLE.shape.map((shape) => shape.id);
/** How big a house is on its plot, by tier rank: the starter is small, a villa fills the plot. */
const TIER_SCALE = [0.62, 0.7, 0.78, 0.86, 0.94], TIER_HEIGHT = [0.5, 0.56, 0.62, 0.86, 0.96];
const YARD = { flowers: ['green', '#e86a8a', 0.5], tree: ['green', '#3f8a57', 1], palm: ['green', '#4f9a5f', 1.25], tank: ['box', '#2f3b46', 0.9], gen: ['box', '#c9423a', 0.6], car: ['box', '#2b5fa8', 0.7], kiosk: ['box', '#e8a13a', 0.8] };

export function createHouses(kit, pack) {
  const { THREE } = kit;
  const group = new THREE.Group();
  group.name = 'houses';
  const lit = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  const flat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const block = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, transparent: true, opacity: 0.92 });
  const dummy = new THREE.Object3D(), tint = new THREE.Color(), tintB = new THREE.Color();
  const unit = (draw) => { const batch = createBatch(THREE); draw(batch); return batch.build({ solid: lit, glow: lit, glass: lit }).meshes[0].geometry; };
  // One unit house: 1 wide, 1 deep, walls 1 high; the roof sits on top. Everything is white and takes its colour per instance.
  const geometries = {
    walls: unit((u) => u.box(0, 0.5, 0, 1, 1, 1, '#ffffff')),
    door: unit((u) => u.quad(0, 0.3, 0.506, 0.24, 0.6, '#ffffff')),
    glass: unit((u) => { u.quad(-0.3, 0.58, 0.506, 0.2, 0.26, '#ffffff'); u.quad(0.3, 0.58, 0.506, 0.2, 0.26, '#ffffff'); }),
    // Roofs: a ridge (a three-sided prism lying along the house), a pyramid, a slab, two small pyramids. Twelve triangles or so each.
    gable: unit((u) => u.cyl(0, 0.16, 0, 0.66, 1.12, '#ffffff', { seg: 3, rx: Math.PI / 2, rz: Math.PI, sz: 0.62 })),
    hip: unit((u) => u.cone(0, 0.24, 0, 0.82, 0.48, '#ffffff', { seg: 4, ry: Math.PI / 4 })),
    flat: unit((u) => u.box(0, 0.06, 0, 1.1, 0.12, 1.1, '#ffffff')),
    twin: unit((u) => { for (const z of [-0.26, 0.26]) u.cone(0, 0.2, z, 0.46, 0.4, '#ffffff', { seg: 4, ry: Math.PI / 4, sx: 1.6 }); }),
    fence: unit((u) => { for (const [x, z, ry] of [[0, 0.5, 0], [0, -0.5, Math.PI], [0.5, 0, Math.PI / 2], [-0.5, 0, -Math.PI / 2]]) u.quad(x, 0.11, z, 1, 0.22, '#ffffff', { ry }); }),
    green: unit((u) => u.cone(0, 0.42, 0, 0.3, 0.84, '#ffffff', { seg: 4 })),
    box: unit((u) => u.box(0, 0.2, 0, 0.3, 0.4, 0.3, '#ffffff')),
    // The "online" light: a small flat diamond over the roof (two triangles, unlit green).
    dot: (() => { const geometry = new THREE.PlaneGeometry(1, 1); geometry.rotateX(-Math.PI / 2); geometry.rotateY(Math.PI / 4); geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(12).fill(1), 3)); return geometry; })(),
    scaffold: unit((u) => { for (const [x, z] of [[-0.56, -0.56], [0.56, -0.56], [-0.56, 0.56], [0.56, 0.56]]) u.box(x, 0.75, z, 0.05, 1.5, 0.05, '#ffffff'); for (const y of [0.5, 1.0, 1.5]) { u.box(0, y, 0.56, 1.17, 0.04, 0.05, '#ffffff'); u.box(0, y, -0.56, 1.17, 0.04, 0.05, '#ffffff'); u.box(0.56, y, 0, 0.05, 0.04, 1.17, '#ffffff'); u.box(-0.56, y, 0, 0.05, 0.04, 1.17, '#ffffff'); } }),
    pad: (() => { const geometry = new THREE.PlaneGeometry(1, 1); geometry.rotateX(-Math.PI / 2); const colours = new Float32Array(12).fill(1); geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3)); return geometry; })(),
    block: leanGeometry(THREE, 'box'),
  };
  const trianglesOf = (name) => geometries[name].index.count / 3;

  // ---- instanced layers: created once, grown when needed, refilled when the level or the data changes --------
  const layers = new Map();
  function layer(name, geometryName, material, capacity) {
    let entry = layers.get(name);
    if (!entry || entry.capacity < capacity) {
      if (entry) { group.remove(entry.mesh); entry.mesh.dispose?.(); }
      const size = Math.max(16, Math.ceil(capacity * 1.3));
      const mesh = new THREE.InstancedMesh(geometries[geometryName], material, size);
      mesh.name = `houses-${name}`; mesh.frustumCulled = false; mesh.count = 0; mesh.matrixAutoUpdate = false; mesh.renderOrder = name === 'far' ? 1 : 0;
      mesh.setColorAt(0, tint.set('#ffffff'));
      group.add(mesh);
      entry = { mesh, capacity: size, geometryName };
      layers.set(name, entry);
    }
    return entry.mesh;
  }
  function fill(name, geometryName, material, items, place) {
    if (!items.length) { const entry = layers.get(name); if (entry) { entry.mesh.count = 0; entry.mesh.visible = false; } return 0; }
    const mesh = layer(name, geometryName, material, items.length);
    items.forEach((item, i) => { place(item, dummy, tint); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); mesh.setColorAt(i, tint); });
    mesh.count = items.length; mesh.visible = true;
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    return items.length * trianglesOf(geometryName);
  }

  // ---- FAR: the city as blocks -------------------------------------------------------------------
  let summary = null, farKey = '', farTriangles = 0, hiddenLga = null;
  function buildFar() {
    const items = [];
    if (summary) for (const lga of pack.lgas) {
      const occ = summary.get(lga.id)?.occ;
      if (!occ || lga.id === hiddenLga) continue;
      const layout = estateLayout(pack, lga.id), front = layout.cells[0];
      if (occ[0]) items.push({ x: front.x, z: front.z, w: front.size * 0.92, d: front.size * 0.92, fill: occ[0] / PLOTS_PER_ESTATE, colour: lga.tint, front: true });
      // The compact estates are gathered into a few blocks, each hugging the estates it stands for.
      const xs = lga.polygon.map((point) => point[0]), zs = lga.polygon.map((point) => point[1]);
      const minX = Math.min(...xs), minZ = Math.min(...zs), stepX = (Math.max(...xs) - minX) / BINS || 1, stepZ = (Math.max(...zs) - minZ) / BINS || 1;
      const bins = new Map();
      for (let i = 1; i < ESTATE.estates; i++) {
        if (!occ[i]) continue;
        const cell = layout.cells[i], key = Math.min(BINS - 1, Math.floor((cell.x - minX) / stepX)) + BINS * Math.min(BINS - 1, Math.floor((cell.z - minZ) / stepZ));
        let bin = bins.get(key);
        if (!bin) bins.set(key, bin = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, houses: 0, estates: 0 });
        bin.x0 = Math.min(bin.x0, cell.x - cell.size / 2); bin.x1 = Math.max(bin.x1, cell.x + cell.size / 2); bin.z0 = Math.min(bin.z0, cell.z - cell.size / 2); bin.z1 = Math.max(bin.z1, cell.z + cell.size / 2);
        bin.houses += occ[i]; bin.estates += 1;
      }
      for (const bin of bins.values()) items.push({ x: (bin.x0 + bin.x1) / 2, z: (bin.z0 + bin.z1) / 2, w: bin.x1 - bin.x0, d: bin.z1 - bin.z0, fill: bin.houses / (bin.estates * PLOTS_PER_ESTATE), colour: lga.tint });
    }
    farTriangles = fill('far', 'block', block, items, (item, o, colour) => {
      o.position.set(item.x, 0.03, item.z); o.rotation.set(0, 0, 0); o.scale.set(item.w, 0.12 + item.fill * (item.front ? 1.0 : 1.5), item.d);
      colour.set('#f4ead2').lerp(tintB.set('#b5593c'), 0.25 + item.fill * 0.6);
    });
  }

  // ---- NEARER: one pad per estate of the local government in view ---------------------------------
  let padsKey = '', padTriangles = 0;
  function buildPads(lga, occ, skip) {
    const layout = estateLayout(pack, lga), items = [];
    for (let i = 0; i < ESTATE.estates; i++) if (!skip.has(i)) items.push({ cell: layout.cells[i], fill: (occ?.[i] || 0) / PLOTS_PER_ESTATE });
    padTriangles = fill('pads', 'pad', flat, items, (item, o, colour) => {
      o.position.set(item.cell.x, 0.025, item.cell.z); o.rotation.set(0, 0, 0); o.scale.set(item.cell.size * 0.92, 1, item.cell.size * 0.92);
      if (item.fill > 0) colour.set('#efe3c6').lerp(tintB.set('#b5593c'), 0.2 + item.fill * 0.65); else colour.set('#d3dfb6');
    });
  }

  // ---- CLOSE: the estates in view as houses ----------------------------------------------------------
  let detailKey = '', detailTriangles = 0, drawn = [];
  const hex = (field, index) => HOUSE_STYLE[field][index]?.hex ?? '#ffffff';
  function buildDetail(list, serverNow, own) {
    const plots = [], walls = [], doors = [], glass = [], roofs = Object.fromEntries(SHAPES.map((shape) => [shape, []])), fences = [], greens = [], boxes = [], dots = [], scaffolds = [];
    for (const { lga, estate, houses } of list) {
      const layout = estateLayout(pack, lga), pitch = layout.pitch(estate);
      for (let plot = 0; plot < PLOTS_PER_ESTATE; plot++) {
        const at = layout.plot(estate, plot), house = houses.get(plot);
        const mine = own && own.lga === lga && own.estate === estate && own.plot === plot;
        plots.push({ x: at.x, z: at.z, s: pitch * 0.9, colour: mine ? '#ffe08a' : house ? '#e9e4d2' : '#cdd9b2' });
        if (!house) continue;
        const { tier, style } = unpackStyle(house.s), rank = HOUSE_TIERS[tier].rank, w = pitch * 0.9 * TIER_SCALE[rank] * 0.72, h = pitch * 0.9 * TIER_HEIGHT[rank] * 0.7;
        const item = { x: at.x, z: at.z - pitch * 0.06, w, h, pitch };
        walls.push({ ...item, colour: hex('wall', style.wall) }); doors.push({ ...item, colour: hex('door', style.door) }); glass.push({ ...item, colour: hex('windows', style.windows) });
        roofs[SHAPES[style.shape]].push({ ...item, colour: hex('roof', style.roof) });
        if (style.fence) fences.push({ x: at.x, z: at.z, w: pitch * 0.84, h: pitch * 0.7, colour: hex('fence', style.fence) });
        const yard = YARD[HOUSE_STYLE.yard[style.yard].id];
        if (yard) (yard[0] === 'green' ? greens : boxes).push({ x: at.x + pitch * 0.3, z: at.z + pitch * 0.3, w: pitch * 0.5 * yard[2], h: pitch * 0.5 * yard[2], colour: yard[1] });
        if (house.online) dots.push({ x: at.x, z: at.z - pitch * 0.06, y: h + w * 0.62, w: pitch * 0.2, colour: '#33d17a' });
        if (house.u > serverNow) scaffolds.push({ ...item, colour: '#c9a35a' });
      }
    }
    const stand = (item, o, colour) => { o.position.set(item.x, 0.03, item.z); o.rotation.set(0, 0, 0); o.scale.set(item.w, item.h, item.w); colour.set(item.colour); };
    let total = fill('plots', 'pad', flat, plots, (item, o, colour) => { o.position.set(item.x, 0.028, item.z); o.rotation.set(0, 0, 0); o.scale.set(item.s, 1, item.s); colour.set(item.colour); });
    total += fill('walls', 'walls', lit, walls, stand) + fill('doors', 'door', flat, doors, stand) + fill('glass', 'glass', flat, glass, stand);
    for (const shape of SHAPES) total += fill(`roof-${shape}`, shape, lit, roofs[shape], (item, o, colour) => { o.position.set(item.x, 0.03 + item.h, item.z); o.rotation.set(0, 0, 0); o.scale.set(item.w, item.w, item.w); colour.set(item.colour); });
    total += fill('fences', 'fence', lit, fences, stand) + fill('greens', 'green', lit, greens, stand) + fill('boxes', 'box', lit, boxes, stand);
    total += fill('dots', 'dot', flat, dots, (item, o, colour) => { o.position.set(item.x, item.y, item.z); o.rotation.set(0, 0, 0); o.scale.set(item.w, item.w, item.w); colour.set(item.colour); });
    total += fill('scaffold', 'scaffold', lit, scaffolds, (item, o, colour) => { o.position.set(item.x, 0.03, item.z); o.rotation.set(0, 0, 0); o.scale.set(item.w, Math.max(item.h, item.w) * 0.8, item.w); colour.set(item.colour); });
    detailTriangles = total;
    drawn = list.map(({ lga, estate }) => ({ lga, estate }));
  }
  /** Triangles a list of estates would cost as houses (worst case per house: every part). */
  const PER_HOUSE = trianglesOf('walls') + trianglesOf('door') + trianglesOf('glass') + trianglesOf('gable') + trianglesOf('fence') + trianglesOf('green') + trianglesOf('dot');
  const costOf = (houses) => PLOTS_PER_ESTATE * trianglesOf('pad') + houses * PER_HOUSE;

  let level = 'far';
  const api = {
    group,
    get level() { return level; },
    get triangles() { return farTriangles + padTriangles + detailTriangles; },
    counts: () => ({ far: farTriangles, pads: padTriangles, detail: detailTriangles, estates: drawn.length, calls: [...layers.values()].filter((entry) => entry.mesh.visible && entry.mesh.count > 0).length }),
    perHouse: PER_HOUSE,
    setSummary(next) { summary = next; farKey = ''; padsKey = ''; },
    /**
     * Choose what to draw for this view. `view` = { x, z, distance, pixels } (pixels = CSS pixels one
     * map unit covers at the middle of the view). Returns the estates to load: [{ lga, estate }].
     */
    update(view, data, { own = null, serverNow = 0, visible = true } = {}) {
      group.visible = visible;
      if (!visible || !pack.lgas?.length) return [];
      const focus = view.distance < PAD_DISTANCE ? lgaAt(pack, view.x, view.z) : null;
      const wanted = [];
      let detail = [];
      if (focus) {
        // The estates whose houses would be big enough to tell apart, nearest the middle of the view first.
        const layout = estateLayout(pack, focus), occ = summary?.get(focus)?.occ;
        const near = [];
        for (let i = 0; i < ESTATE.estates; i++) {
          const cell = layout.cells[i], far = Math.hypot(cell.x - view.x, cell.z - view.z);
          if (layout.pitch(i) * view.pixels >= 7 && far < cell.size * 1.2 + 260 / view.pixels) near.push({ estate: i, far, houses: occ?.[i] ?? 0 });
        }
        near.sort((a, b) => a.far - b.far);
        let budget = DETAIL_BUDGET;
        for (const item of near.slice(0, MAX_DETAILED)) {
          const cost = costOf(item.houses);
          if (cost > budget) break;
          budget -= cost;
          wanted.push({ lga: focus, estate: item.estate });
          const loaded = data?.estate(focus, item.estate);
          if (loaded) detail.push({ lga: focus, estate: item.estate, houses: loaded.houses, at: loaded.at });
        }
      }
      level = detail.length ? 'close' : focus ? 'near' : 'far';
      // FAR is always there for the rest of the city; the local government in focus shows its pads instead.
      const nextFar = `${focus || ''}|${summary ? [...summary.values()].map((item) => item.houses).join(',') : ''}`;
      if (nextFar !== farKey) { farKey = nextFar; hiddenLga = focus; buildFar(); }
      const skip = new Set(detail.map((item) => item.estate));
      const nextPads = focus ? `${focus}|${[...skip].join(',')}|${summary?.get(focus)?.houses ?? 0}` : '';
      if (nextPads !== padsKey) { padsKey = nextPads; if (focus) buildPads(focus, summary?.get(focus)?.occ, skip); else padTriangles = fill('pads', 'pad', flat, [], null); }
      const nextDetail = detail.map((item) => `${item.lga}/${item.estate}@${item.at}`).join('|') + `|${own ? `${own.lga}/${own.estate}/${own.plot}` : ''}|${Math.floor(serverNow / 30000)}`;
      if (nextDetail !== detailKey) { detailKey = nextDetail; buildDetail(detail, serverNow, own); }
      return wanted;
    },
    detailed: () => drawn,
    dispose() {
      for (const entry of layers.values()) entry.mesh.dispose?.();
      for (const geometry of Object.values(geometries)) geometry.dispose();
      lit.dispose(); flat.dispose(); block.dispose();
      group.parent?.remove(group);
    },
  };
  return api;
}
