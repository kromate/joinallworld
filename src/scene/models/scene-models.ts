/**
 * OWNER: scenes
 * Scene models: place many copies of a model file in a scene that is built by a synchronous function.
 *
 *   const cache = modelCacheFor(kit, () => loadSource(kit));            // one cache per kit: a file is fetched and read once
 *   const layer = createModelLayer(kit, cache, { budget: { triangles: 9000, drawCalls: 24 } });
 *   layer.add({ near: 'bungalow-cream', far: 'bungalow-cream-far', x, z, ry, scale, tint, standIn: (b) => { ...procedural... } });
 *   scenery.add(layer.group);
 *   layer.build();                                                      // synchronous: what is already loaded is drawn, the rest gets its stand-in
 *   void layer.load(() => host.render());                               // fetch what is missing, swap stand-ins for models once, then say so
 *   layer.focus(x, z);                                                  // near / far versions follow a point (the camera); true when something was redrawn
 *   layer.dispose();
 *
 * HOW COPIES ARE DRAWN. Every part of a model names the texture atlas it samples. Placements are merged by atlas and level of
 * detail into one mesh each (a whole street of buildings that share an atlas is one draw call), unless a placement asks for
 * mode 'instance': then each model part is one InstancedMesh (for a model that has its own texture, many copies, no per-copy
 * label). A node whose name starts with "sign" is writable: a placement's `labels` paint text on it from a shared label atlas.
 *
 * STAND-INS. `standIn` draws the placement the old procedural way into one batch, at once. When a placement's model has arrived the
 * stand-in is dropped and the model drawn; when the file fails (or the device is not allowed to fetch) the stand-in stays. Nothing
 * here asks for a frame: `load` calls `changed` once after a swap, and `focus` is called from the frame that is being drawn anyway.
 *
 * BUDGET. `budget` caps triangles and draw calls of the model meshes; placements with the lowest `priority` (then the farthest from
 * the focus) are left out until it fits, and `stats().dropped` says how many. Pure helpers (`mergeKeys`, `budgetOf`) are tested
 * without WebGL.
 */
import type * as THREE from 'three';
import { createBatch, releaseObjects, sceneMaterials } from '../build.ts';
import type { Kit } from '../kit.ts';
import type { Batch, Colour } from '../types.ts';

export interface ModelPart {
  name: string;
  /** Nodes called sign, sign_1, sign_number ... are writable. */
  writable: boolean;
  /** The texture atlas this part samples ('' when it only has vertex colours). */
  atlas: string;
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array | null;
  color: Float32Array | null;
  index: Uint32Array;
}
export interface ModelData {
  key: string;
  parts: ModelPart[];
  /** Named empties in the model's own frame (light and door anchors). */
  anchors: Record<string, [number, number, number]>;
  triangles: number;
}
export interface ModelSource {
  load(key: string): Promise<ModelData>;
  /** The decoded atlas picture for a key, once a model that uses it has been read. */
  texture(atlas: string): THREE.Texture | null;
  dispose?(): void;
}

export type ModelMode = 'merge' | 'instance';
export type ModelLevel = 'near' | 'far';
export interface Placement {
  /** File key of the full model, and of the cheap one drawn at a distance. */
  near: string;
  far?: string | undefined;
  x: number;
  y?: number;
  z: number;
  ry?: number;
  scale?: number;
  /** Multiplies the model's colours (a wall colour on a cream building). */
  tint?: Colour | undefined;
  mode?: ModelMode;
  /** Text for writable nodes, by node name. */
  labels?: Record<string, string> | undefined;
  /** Lowest goes first when the budget is exceeded. Default 1. */
  priority?: number;
  /** Left out at the far level (small exterior detail). */
  detail?: boolean;
  /** The procedural drawing of this thing in its own frame (origin at x, z, turned by ry). */
  standIn?: ((b: Batch) => void) | undefined;
}
export interface LayerBudget { triangles: number; drawCalls: number }
export interface LayerOptions {
  budget?: LayerBudget;
  /** Beyond this distance from the focus a placement uses its far model. */
  nearRadius?: number;
  /** Called for each new material (shadows, see-through patch, night windows). */
  decorate?: (material: THREE.Material, atlas: string) => void;
  /** A number for each placement (a building's own draw): when given, every merged mesh carries it as the vertex attribute `aSeed`, so a material can light some buildings and not others. */
  seedOf?: (placement: Placement) => number;
  /** Where near / far is measured from at first (the camera's place); `focus()` moves it. */
  focus?: { x: number; z: number };
  /** Colour of a label's board and of its letters. */
  labelStyle?: { board: Colour; ink: Colour };
}
export interface LayerStats {
  triangles: number;
  drawCalls: number;
  models: number;
  placements: number;
  dropped: number;
  standIns: number;
  levels: { near: number; far: number };
  atlases: string[];
}

// ---- the cache -----------------------------------------------------------------------------------------------------------

export interface ModelCache {
  request(key: string): Promise<ModelData | null>;
  peek(key: string): ModelData | null;
  failed(key: string): boolean;
  /** Files asked of the source so far (tests: a file is read once however many placements use it). */
  readonly reads: number;
  readonly source: ModelSource;
}
export function createModelCache(source: ModelSource): ModelCache {
  const entries = new Map<string, { promise: Promise<ModelData | null>; data: ModelData | null; failed: boolean }>();
  let reads = 0;
  return {
    source,
    get reads() { return reads; },
    request(key) {
      let entry = entries.get(key);
      if (!entry) {
        reads += 1;
        const made: { promise: Promise<ModelData | null>; data: ModelData | null; failed: boolean } = { promise: Promise.resolve(null), data: null, failed: false };
        made.promise = source.load(key).then((data) => { made.data = data; return data; }, () => { made.failed = true; return null; });
        entries.set(key, made);
        entry = made;
      }
      return entry.promise;
    },
    peek: (key) => entries.get(key)?.data ?? null,
    failed: (key) => entries.get(key)?.failed ?? false,
  };
}
const caches = new WeakMap<Kit, ModelCache>();
/** The one cache of a kit. `make` runs the first time and builds the source; the source is freed with the kit. */
export function modelCacheFor(kit: Kit, make: () => ModelSource): ModelCache {
  let cache = caches.get(kit);
  if (!cache) {
    cache = createModelCache(make());
    caches.set(kit, cache);
    const source = cache.source;
    kit.onDispose(() => { source.dispose?.(); caches.delete(kit); });
  }
  return cache;
}

// ---- pure helpers --------------------------------------------------------------------------------------------------------

/** The merged mesh a part of a placement goes into: one per atlas and level (writable parts with a label share the label mesh). */
export const mergeKeys = (part: ModelPart, level: ModelLevel, labelled: boolean): string => `${part.writable && labelled ? 'label' : part.atlas || 'plain'}:${level}`;

export interface BudgetItem { model: ModelData; mode: ModelMode; level: ModelLevel; labels: boolean; priority: number; distance: number }
/** Triangles and draw calls the items would cost, and the indices (into `items`) to leave out to fit `budget`. */
export function budgetOf(items: BudgetItem[], budget?: LayerBudget): { triangles: number; drawCalls: number; drop: Set<number> } {
  const drop = new Set<number>();
  const order = items.map((_, i) => i).sort((a, b) => items[a]!.priority - items[b]!.priority || items[b]!.distance - items[a]!.distance);
  const cost = (): { triangles: number; drawCalls: number } => {
    let triangles = 0;
    const calls = new Set<string>();
    items.forEach((item, i) => {
      if (drop.has(i)) return;
      for (const part of item.model.parts) {
        triangles += part.index.length / 3;
        calls.add(item.mode === 'instance' && !(part.writable && item.labels) ? `i:${item.model.key}:${part.name}` : mergeKeys(part, item.level, item.labels));
      }
    });
    return { triangles, drawCalls: calls.size };
  };
  let now = cost();
  if (budget) for (const i of order) {
    if (now.triangles <= budget.triangles && now.drawCalls <= budget.drawCalls) break;
    drop.add(i);
    now = cost();
  }
  return { ...now, drop };
}

/** UV bounds of a part's texture coordinates. */
function uvBounds(uv: Float32Array): [number, number, number, number] {
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (let i = 0; i < uv.length; i += 2) { u0 = Math.min(u0, uv[i]!); u1 = Math.max(u1, uv[i]!); v0 = Math.min(v0, uv[i + 1]!); v1 = Math.max(v1, uv[i + 1]!); }
  return [u0, v0, u1, v1];
}

// ---- labels --------------------------------------------------------------------------------------------------------------

export const LABEL_CELL = { w: 256, h: 64, cols: 4 } as const;
/** Which cell of the label atlas a text has (first come, first served; the same text shares one cell), and the atlas size in cells. */
export function labelCells(texts: Iterable<string>): { cell: Map<string, number>; rows: number } {
  const cell = new Map<string, number>();
  for (const text of texts) if (!cell.has(text)) cell.set(text, cell.size);
  return { cell, rows: Math.max(1, Math.ceil(cell.size / LABEL_CELL.cols)) };
}
/** Where a cell sits in the atlas as [u0, v0, u1, v1] (top-left origin, v down, like the model atlases). */
export function labelRect(index: number, rows: number): [number, number, number, number] {
  const col = index % LABEL_CELL.cols, row = Math.floor(index / LABEL_CELL.cols);
  return [col / LABEL_CELL.cols, row / rows, (col + 1) / LABEL_CELL.cols, (row + 1) / rows];
}
function paintLabels(THREE: typeof import('three'), cells: Map<string, number>, rows: number, style: { board: Colour; ink: Colour }): THREE.Texture | null {
  const doc = globalThis.document;
  if (!doc?.createElement) return null;
  const canvas = doc.createElement('canvas');
  canvas.width = LABEL_CELL.w * LABEL_CELL.cols; canvas.height = LABEL_CELL.h * rows;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.fillStyle = style.board; g.fillRect(0, 0, canvas.width, canvas.height);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const [text, index] of cells) {
    const x = (index % LABEL_CELL.cols) * LABEL_CELL.w, y = Math.floor(index / LABEL_CELL.cols) * LABEL_CELL.h;
    g.strokeStyle = style.ink; g.lineWidth = 3; g.strokeRect(x + 3, y + 3, LABEL_CELL.w - 6, LABEL_CELL.h - 6);
    let size = 40;
    g.fillStyle = style.ink;
    do { g.font = `700 ${size}px system-ui, sans-serif`; size -= 2; } while (g.measureText(text).width > LABEL_CELL.w - 24 && size > 12);
    g.fillText(text, x + LABEL_CELL.w / 2, y + LABEL_CELL.h / 2 + 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false; texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}

// ---- the layer -----------------------------------------------------------------------------------------------------------

export interface ModelLayer {
  readonly group: THREE.Group;
  add(placement: Placement): void;
  /** Draw now: loaded models, and a stand-in for everything else. */
  build(): void;
  /** Fetch every model the placements need, swap stand-ins for them, and call `changed` once if anything was swapped. */
  load(changed: () => void): Promise<void>;
  /** Move the point near / far is measured from. True when meshes were rebuilt (the caller's frame draws them). */
  focus(x: number, z: number): boolean;
  stats(): LayerStats;
  /** The point lights a model asks for (its `light_*` anchors) for the placements drawn, in scene coordinates. */
  anchors(prefix: string): { x: number; y: number; z: number; model: string }[];
  dispose(): void;
}

const WHITE: [number, number, number] = [1, 1, 1];

export function createModelLayer(kit: Kit, cache: ModelCache, options: LayerOptions = {}): ModelLayer {
  const { THREE } = kit;
  const group = new THREE.Group();
  const placements: Placement[] = [];
  const nearRadius = options.nearRadius ?? 56;
  const style = options.labelStyle ?? { board: '#f3eee0', ink: '#2b2a27' };
  let focusX = options.focus?.x ?? 0, focusZ = options.focus?.z ?? 0, hasFocus = Boolean(options.focus), disposed = false;
  let meshes: THREE.Object3D[] = [];
  let standMeshes: THREE.Mesh[] = [];
  let materials = new Map<string, THREE.Material>();
  let labelTexture: THREE.Texture | null = null;
  let levels: ModelLevel[] = [];
  let stats: LayerStats = { triangles: 0, drawCalls: 0, models: 0, placements: 0, dropped: 0, standIns: 0, levels: { near: 0, far: 0 }, atlases: [] };
  const instanceGeometry = new Map<string, THREE.BufferGeometry>();
  let lights: { x: number; y: number; z: number; model: string }[] = [];
  let notify: (() => void) | null = null;
  const tints = new Map<string, [number, number, number]>();
  const tintOf = (colour: Colour | undefined): [number, number, number] => {
    if (!colour) return WHITE;
    let value = tints.get(colour);
    if (!value) { const c = new THREE.Color(colour); value = [c.r, c.g, c.b]; tints.set(colour, value); }
    return value;
  };

  const levelFor = (placement: Placement, index: number): ModelLevel => {
    if ((!placement.far && !placement.detail) || !hasFocus) return 'near';
    const distance = Math.hypot(placement.x - focusX, placement.z - focusZ);
    // A little hysteresis: a placement that is far stays far until it is clearly inside.
    return distance > nearRadius + (levels[index] === 'far' ? -8 : 0) ? 'far' : 'near';
  };
  /** The model for the wanted level; until that file is here, whichever version of it is (no stand-in when a cheaper or fuller one is on hand). */
  const modelFor = (placement: Placement, level: ModelLevel): ModelData | null => {
    const far = placement.far ? cache.peek(placement.far) : null, near = cache.peek(placement.near);
    return level === 'far' ? far ?? near : near ?? far;
  };

  function materialFor(atlas: string): THREE.Material {
    let material = materials.get(atlas);
    if (!material) {
      const map = atlas === 'label' ? labelTexture : atlas ? cache.source.texture(atlas) : null;
      const common = { vertexColors: true, ...(map ? { map } : {}) };
      material = kit.matte ? new THREE.MeshLambertMaterial(common) : new THREE.MeshStandardMaterial({ ...common, roughness: 0.92, metalness: 0 });
      material.userData.atlas = atlas;
      kit.adopt(material);
      options.decorate?.(material, atlas);
      materials.set(atlas, material);
    }
    return material;
  }

  /**
   * Take down what the last build drew. The materials stay: a layer is built again every few steps of a walk (near and far models
   * follow the camera), and a material thrown away takes its compiled shader with it, so each of those builds stalled the frame
   * while the same shaders were compiled again. They are let go of when the layer is.
   */
  function clearBuilt(): void {
    for (const object of meshes) { object.parent?.remove(object); (object as THREE.Mesh).geometry?.dispose?.(); }
    meshes = [];
    releaseObjects(standMeshes);
    labelTexture?.dispose(); labelTexture = null;
  }
  function clearMaterials(): void {
    for (const material of materials.values()) material.dispose();
    materials = new Map();
  }

  function rebuild(): void {
    clearBuilt();
    // A kept material follows its atlas: one whose picture arrived (or went) since it was made is made again.
    for (const [atlas, material] of materials) {
      if (atlas === 'label') continue;
      const map = atlas ? cache.source.texture(atlas) : null, held = material as THREE.Material & { map?: THREE.Texture | null };
      if (Boolean(held.map) === Boolean(map)) held.map = map; else { material.dispose(); materials.delete(atlas); }
    }
    levels = placements.map((placement, i) => levelFor(placement, i));
    const items: BudgetItem[] = [], itemOf: number[] = [];
    const missing: number[] = [];
    placements.forEach((placement, i) => {
      const model = modelFor(placement, levels[i]!);
      if (!model) { missing.push(i); return; }
      // Details are not drawn at the far level: they are skipped, not dropped.
      if (placement.detail && levels[i] === 'far') return;
      items.push({ model, mode: placement.mode ?? 'merge', level: levels[i]!, labels: Boolean(placement.labels), priority: placement.priority ?? 1, distance: Math.hypot(placement.x - focusX, placement.z - focusZ) });
      itemOf.push(i);
    });
    const kept = items.map((item, j) => ({ item, placement: itemOf[j]! }));
    const plan = budgetOf(kept.map((entry) => entry.item), options.budget);
    const drawn: number[] = [];
    kept.forEach((entry, j) => { if (!plan.drop.has(j)) drawn.push(entry.placement); });
    // A dropped placement keeps no stand-in: it is left out on purpose.
    const labelTexts = new Set<string>();
    for (const i of drawn) for (const text of Object.values(placements[i]!.labels ?? {})) labelTexts.add(text);
    const { cell, rows } = labelCells(labelTexts);
    if (labelTexts.size) labelTexture = paintLabels(THREE, cell, rows, style);
    // The label sheet is painted again with each build: the material that shows it is kept, unless it gained or lost its sheet.
    const labelMaterial = materials.get('label') as (THREE.Material & { map?: THREE.Texture | null }) | undefined;
    if (labelMaterial) { if (Boolean(labelMaterial.map) === Boolean(labelTexture)) labelMaterial.map = labelTexture; else { labelMaterial.dispose(); materials.delete('label'); } }
    const labelled = Boolean(labelTexture);

    // Gather merge groups.
    interface Group { atlas: string; level: ModelLevel; parts: { part: ModelPart; placement: Placement; rect: [number, number, number, number] | null }[] }
    const groups = new Map<string, Group>();
    const instances = new Map<string, { model: ModelData; part: ModelPart; level: ModelLevel; list: Placement[] }>();
    lights = [];
    let triangles = 0, near = 0, far = 0;
    const atlases = new Set<string>();
    for (const i of drawn) {
      const placement = placements[i]!, level = levels[i]!, model = modelFor(placement, level)!;
      if (level === 'far') far += 1; else near += 1;
      for (const [name, at] of Object.entries(model.anchors)) {
        const turn = placement.ry ?? 0, s = placement.scale ?? 1, c = Math.cos(turn), sn = Math.sin(turn);
        lights.push({ x: placement.x + (at[0] * c + at[2] * sn) * s, y: (placement.y ?? 0) + at[1] * s, z: placement.z + (-at[0] * sn + at[2] * c) * s, model: `${model.key}:${name}` });
      }
      for (const part of model.parts) {
        const text = part.writable && labelled ? placement.labels?.[part.name] : undefined;
        if (placement.mode === 'instance' && !text) {
          const id = `${model.key}:${part.name}`;
          let entry = instances.get(id);
          if (!entry) { entry = { model, part, level, list: [] }; instances.set(id, entry); }
          entry.list.push(placement);
          continue;
        }
        const key = text !== undefined ? 'label:' + level : mergeKeys(part, level, false);
        let g = groups.get(key);
        if (!g) { g = { atlas: text !== undefined ? 'label' : part.atlas, level, parts: [] }; groups.set(key, g); }
        g.parts.push({ part, placement, rect: text !== undefined ? labelRect(cell.get(text)!, rows) : null });
      }
    }

    const dummy = new THREE.Object3D();
    for (const [key, g] of groups) {
      let vertices = 0, indices = 0;
      for (const { part } of g.parts) { vertices += part.position.length / 3; indices += part.index.length; }
      const pos = new Float32Array(vertices * 3), nor = new Float32Array(vertices * 3), col = new Float32Array(vertices * 3), uv = new Float32Array(vertices * 2), seed = options.seedOf ? new Float32Array(vertices) : null;
      const idx = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
      let v = 0, ii = 0;
      for (const { part, placement, rect } of g.parts) {
        const s = placement.scale ?? 1, turn = placement.ry ?? 0, c = Math.cos(turn), sn = Math.sin(turn), ox = placement.x, oy = placement.y ?? 0, oz = placement.z;
        const tint = tintOf(placement.tint), n = part.position.length / 3;
        const bounds = rect && part.uv ? uvBounds(part.uv) : null, mark = seed ? options.seedOf!(placement) : 0;
        for (let k = 0; k < n; k++) {
          const px = part.position[k * 3]!, py = part.position[k * 3 + 1]!, pz = part.position[k * 3 + 2]!;
          pos[(v + k) * 3] = (px * c + pz * sn) * s + ox; pos[(v + k) * 3 + 1] = py * s + oy; pos[(v + k) * 3 + 2] = (-px * sn + pz * c) * s + oz;
          const nx = part.normal[k * 3]!, ny = part.normal[k * 3 + 1]!, nz = part.normal[k * 3 + 2]!;
          nor[(v + k) * 3] = nx * c + nz * sn; nor[(v + k) * 3 + 1] = ny; nor[(v + k) * 3 + 2] = -nx * sn + nz * c;
          if (rect) { col[(v + k) * 3] = 1; col[(v + k) * 3 + 1] = 1; col[(v + k) * 3 + 2] = 1; }
          else {
            const r = part.color ? part.color[k * 3]! : 1, gg = part.color ? part.color[k * 3 + 1]! : 1, b = part.color ? part.color[k * 3 + 2]! : 1;
            col[(v + k) * 3] = r * tint[0]; col[(v + k) * 3 + 1] = gg * tint[1]; col[(v + k) * 3 + 2] = b * tint[2];
          }
          if (seed) seed[v + k] = mark;
          if (part.uv) {
            const u = part.uv[k * 2]!, w = part.uv[k * 2 + 1]!;
            if (rect && bounds) {
              const du = bounds[2] - bounds[0] || 1, dv = bounds[3] - bounds[1] || 1;
              uv[(v + k) * 2] = rect[0] + ((u - bounds[0]) / du) * (rect[2] - rect[0]); uv[(v + k) * 2 + 1] = rect[1] + ((w - bounds[1]) / dv) * (rect[3] - rect[1]);
            } else { uv[(v + k) * 2] = u; uv[(v + k) * 2 + 1] = w; }
          }
        }
        for (let k = 0; k < part.index.length; k++) idx[ii + k] = part.index[k]! + v;
        v += n; ii += part.index.length;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      if (seed) geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
      geometry.setIndex(new THREE.BufferAttribute(idx, 1));
      const mesh = new THREE.Mesh(geometry, materialFor(g.atlas));
      mesh.name = `model:${key}`;
      mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh); meshes.push(mesh);
      triangles += indices / 3; atlases.add(g.atlas);
    }
    for (const [id, entry] of instances) {
      const { part, list } = entry;
      let geometry = instanceGeometry.get(id);
      if (!geometry) {
        geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(part.position, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(part.normal, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(part.color ?? new Float32Array(part.position.length).fill(1), 3));
        if (part.uv) geometry.setAttribute('uv', new THREE.BufferAttribute(part.uv, 2));
        geometry.setIndex(new THREE.BufferAttribute(part.index, 1));
        instanceGeometry.set(id, geometry);
      }
      const mesh = new THREE.InstancedMesh(geometry, materialFor(part.atlas), list.length);
      list.forEach((placement, k) => {
        dummy.position.set(placement.x, placement.y ?? 0, placement.z); dummy.rotation.set(0, placement.ry ?? 0, 0); dummy.scale.setScalar(placement.scale ?? 1);
        dummy.updateMatrix(); mesh.setMatrixAt(k, dummy.matrix);
        if (placement.tint) mesh.setColorAt(k, new THREE.Color(placement.tint));
      });
      mesh.name = `instances:${id}`; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
      group.add(mesh); meshes.push(mesh);
      triangles += (part.index.length / 3) * list.length; atlases.add(part.atlas);
    }

    // Stand-ins: placements whose model is missing (and that were not left out on purpose).
    const standCount = missing.filter((i) => placements[i]!.standIn).length;
    if (standCount) {
      const batch = createBatch(THREE);
      for (const i of missing) { const placement = placements[i]!; if (placement.standIn) batch.at(placement.x, placement.y ?? 0, placement.z, placement.ry ?? 0, placement.standIn, 0, 0, placement.scale ?? 1); }
      const built = batch.build(sceneMaterials(kit));
      standMeshes = built.meshes;
      standMeshes.forEach((mesh) => group.add(mesh));
      triangles += built.triangles;
      for (const light of built.lights) light.dispose();
    }
    stats = {
      triangles, drawCalls: meshes.length + standMeshes.length, models: new Set(drawn.map((i) => modelFor(placements[i]!, levels[i]!)!.key)).size,
      placements: placements.length, dropped: kept.length - drawn.length, standIns: standCount, levels: { near, far }, atlases: [...atlases].sort(),
    };
  }

  return {
    group,
    add(placement) { placements.push(placement); },
    build() { rebuild(); },
    async load(changed) {
      notify = changed;
      const wanted = (): Set<string> => new Set(placements.map((placement, i) => levels[i] === 'far' && placement.far && !cache.failed(placement.far) ? placement.far : placement.near));
      const have = (keys: Set<string>): number => [...keys].filter((key) => cache.peek(key)).length;
      const first = wanted(), before = have(first);
      await Promise.all([...first].map((key) => cache.request(key)));
      // A far model that would not load falls back to the full one.
      const second = wanted();
      await Promise.all([...second].map((key) => cache.request(key)));
      if (disposed) return;
      if (have(second) === before) return;
      rebuild();
      changed();
    },
    focus(x, z) {
      if (hasFocus && Math.hypot(x - focusX, z - focusZ) < 4) return false;
      focusX = x; focusZ = z; hasFocus = true;
      const next = placements.map((placement, i) => levelFor(placement, i));
      if (next.every((level, i) => level === levels[i])) return false;
      // Models the placements now need at their new level may not have been read yet: ask for them, and draw with what is here meanwhile.
      const need = placements.flatMap((placement, i) => {
        const key = next[i] === 'far' && placement.far && !cache.failed(placement.far) ? placement.far : placement.near;
        return !cache.peek(key) && !cache.failed(key) ? [key] : [];
      });
      if (need.length) void Promise.all(need.map((key) => cache.request(key))).then(() => { if (!disposed) { rebuild(); notify?.(); } });
      rebuild();
      return true;
    },
    stats: () => stats,
    anchors: (prefix) => lights.filter((light) => light.model.split(':').pop()!.startsWith(prefix)),
    dispose() { disposed = true; clearBuilt(); clearMaterials(); for (const g of instanceGeometry.values()) g.dispose(); instanceGeometry.clear(); group.parent?.remove(group); placements.length = 0; },
  };
}
