/**
 * OWNER: scenes
 * Geometry batcher. A venue is hundreds of small coloured primitives; drawing each as its own
 * mesh would cost hundreds of draw calls. A batch bakes every primitive (position, normal and a
 * per-vertex colour) into at most three merged meshes, one per layer:
 *
 *   solid   lit, casts and receives shadow
 *   glow    unlit "lights on" surfaces (lamps, screens, signs) whose strength follows time of day
 *   glass   translucent lit surfaces (water, windows)
 *
 * Everything is plain typed-array work, so it runs under `node --test` without WebGL.
 *
 *   const b = createBatch(THREE);
 *   b.box(x, y, z, w, h, d, colour, { ry, rx, rz, layer });        // centred, like the kit
 *   b.cyl(x, y, z, radius, height, colour, { top, seg, open, sx, sz, ...rotation, layer });
 *   b.cone / b.ball / b.ico / b.quad / b.disc                       // see below
 *   b.at(x, y, z, ry, () => { ...local coordinates... });           // nested transform
 *   b.light(x, y, z, colour, intensity, distance);                  // a point light request
 *   const { meshes, lights, triangles } = b.build(sceneMaterials(kit));
 *
 * PARTS. A primitive drawn with `{ part: 'name' }` is baked into its own mesh per layer (named
 * 'solid@name', with mesh.userData.part = 'name') instead of the shared one, so a scene can show
 * and hide that part by itself — the walls of a room, with what hangs on them, are parts.
 *
 * Materials are three per kit, shared by every scene and avatar, and are freed with the kit.
 */

import type * as THREE from 'three';
import type { Batch, BatchGeometry, BatchLayer, BatchOptions, BatchResult, Colour, LightSpec, PropMark, SceneMaterials, ThreeModule } from './types.ts';
import type { Kit } from './kit.ts';
import { bakeVertexAO, createOccluders, type AoPrim } from './ao-bake.ts';
import { aoStrength, bakedAO, renderTier } from './look.ts';

interface Template extends BatchGeometry { pos: Float32Array; nor: Float32Array; idx: number[]; lo: number[]; hi: number[]; shrink: number }
interface LayerData { pos: number[]; nor: number[]; col: number[]; idx: number[]; prims: AoPrim[] }
/** Local bounds of any batch geometry: templates carry theirs; geometry passed to batch.geometry() is measured once and remembered. */
const measured = new WeakMap<BatchGeometry, { lo: number[]; hi: number[]; shrink: number }>();
function boundsOf(shape: BatchGeometry): { lo: number[]; hi: number[]; shrink: number } {
  if ('lo' in shape && 'hi' in shape) return shape as Template;
  let found = measured.get(shape);
  if (!found) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < shape.pos.length; i++) { lo[i % 3] = Math.min(lo[i % 3]!, shape.pos[i]!); hi[i % 3] = Math.max(hi[i % 3]!, shape.pos[i]!); }
    found = { lo, hi, shrink: 0.14 };
    measured.set(shape, found);
  }
  return found;
}
const templates = new Map<string, Template>();

/**
 * AO FACTORS AGAIN. The vertex AO of a batch depends only on the positions, normals and primitives of its solid layers and on the
 * strength (not on the colours it multiplies). A scene built again with the same inputs (the neighbourhood, on every return) takes
 * the factors from the last bake instead of probing again. The inputs are kept and compared number for number, so a factor is
 * only reused for exactly the same inputs; the colours come out the same. Kept: the most recent batches, up to AO_KEEP_VALUES.
 */
const AO_KEEP_VALUES = 3_000_000;
interface AoKnown { strength: number; pos: Float64Array[]; nor: Float64Array[]; prims: AoPrim[][]; factors: Float64Array[]; size: number }
const aoKnown: AoKnown[] = [];
/** prepareAo(): primitives baked between checks of the clock, and the work done before it yields. */
const PRIM_CHUNK = 64, SLICE_MS = 4;
const same = (a: number, b: number): boolean => a === b && (a !== 0 || 1 / a === 1 / b);
function sameValues(kept: Float64Array, values: ArrayLike<number>): boolean {
  if (kept.length !== values.length) return false;
  for (let i = 0; i < kept.length; i++) if (!same(kept[i]!, values[i]!)) return false;
  return true;
}
function samePrims(kept: AoPrim[], prims: readonly AoPrim[]): boolean {
  if (kept.length !== prims.length) return false;
  for (let i = 0; i < kept.length; i++) {
    const a = kept[i]!, b = prims[i]!;
    if (!same(a.id, b.id) || !same(a.start, b.start) || !same(a.count, b.count)) return false;
    for (let k = 0; k < 3; k++) if (!same(a.min[k]!, b.min[k]!) || !same(a.max[k]!, b.max[k]!)) return false;
  }
  return true;
}
function aoFactorsKnown(solids: readonly LayerData[], strength: number): Float64Array[] | null {
  for (let at = aoKnown.length - 1; at >= 0; at--) {
    const known = aoKnown[at]!;
    if (!same(known.strength, strength) || known.pos.length !== solids.length) continue;
    if (!solids.every((d, index) => known.pos[index]!.length === d.pos.length && known.prims[index]!.length === d.prims.length)) continue;
    if (!solids.every((d, index) => samePrims(known.prims[index]!, d.prims) && sameValues(known.pos[index]!, d.pos) && sameValues(known.nor[index]!, d.nor))) continue;
    aoKnown.splice(at, 1); aoKnown.push(known);
    return known.factors;
  }
  return null;
}
function aoFactorsKeep(solids: readonly LayerData[], strength: number, factors: Float64Array[]): void {
  const known: AoKnown = {
    strength, factors,
    pos: solids.map((d) => Float64Array.from(d.pos)), nor: solids.map((d) => Float64Array.from(d.nor)),
    prims: solids.map((d) => d.prims.map((p) => ({ id: p.id, start: p.start, count: p.count, min: [...p.min] as [number, number, number], max: [...p.max] as [number, number, number] }))),
    size: solids.reduce((sum, d) => sum + d.pos.length * 3, 0),
  };
  if (known.size > AO_KEEP_VALUES) return;
  aoKnown.push(known);
  let total = aoKnown.reduce((sum, item) => sum + item.size, 0);
  while (total > AO_KEEP_VALUES) total -= aoKnown.shift()!.size;
}
function template(key: string, make: () => THREE.BufferGeometry): Template {
  let entry = templates.get(key);
  if (!entry) {
    const geometry = make();
    const pos = Float32Array.from(geometry.attributes.position!.array);
    const nor = Float32Array.from(geometry.attributes.normal!.array);
    const idx = geometry.index ? Array.from(geometry.index.array) : Array.from({ length: pos.length / 3 }, (_, i) => i);
    geometry.dispose();
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i++) { lo[i % 3] = Math.min(lo[i % 3]!, pos[i]!); hi[i % 3] = Math.max(hi[i % 3]!, pos[i]!); }
    entry = { pos, nor, idx, lo, hi, shrink: key === 'box' || key === 'quad' ? 0 : 0.14 };
    templates.set(key, entry);
  }
  return entry;
}

export const GLOW: Readonly<{ layer: 'glow' }> = Object.freeze({ layer: 'glow' as const });
export const GLASS: Readonly<{ layer: 'glass' }> = Object.freeze({ layer: 'glass' as const });

export function createBatch(THREE: ThreeModule): Batch {
  const layer = (): LayerData => ({ pos: [], nor: [], col: [], idx: [], prims: [] });
  const ao = bakedAO();
  let primId = 0;
  const layers: Record<string, LayerData> = { solid: layer(), glow: layer(), glass: layer() };
  const BASE: string[] = ['solid', 'glow', 'glass'];
  /** The vertex store for a layer, or for one named part of it (made the first time the part is drawn). */
  const store = (name: string, part: string | undefined): LayerData => { if (!part) return layers[name]!; const key = `${name}@${part}`; return (layers[key] ||= layer()); };
  const stack = [new THREE.Matrix4()];
  const lights: LightSpec[] = [];
  const props: PropMark[] = [];
  const colours = new Map<Colour, [number, number, number]>();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const n3 = new THREE.Matrix3(), v = new THREE.Vector3(), tint = new THREE.Color();

  function rgb(colour: Colour): [number, number, number] {
    let value = colours.get(colour);
    if (!value) {
      tint.set(colour);
      value = [tint.r, tint.g, tint.b];
      colours.set(colour, value);
    }
    return value;
  }
  function add(shape: BatchGeometry, x: number, y: number, z: number, sx: number, sy: number, sz: number, colour: Colour, o?: BatchOptions) {
    e.set(o?.rx || 0, o?.ry || 0, o?.rz || 0, 'YXZ');
    m.compose(p.set(x, y, z), q.setFromEuler(e), s.set(sx, sy, sz)).premultiply(stack[stack.length - 1]!);
    n3.getNormalMatrix(m);
    const target = store(Object.hasOwn(layers, o?.layer as string) && BASE.includes(o?.layer as string) ? o!.layer! : 'solid', o?.part);
    const base = target.pos.length / 3;
    const [r, g, bl] = rgb(colour);
    const { pos, nor, idx, col } = shape;
    for (let i = 0; i < pos.length; i += 3) {
      v.set(pos[i]!, pos[i + 1]!, pos[i + 2]!).applyMatrix4(m);
      target.pos.push(v.x, v.y, v.z);
      v.set(nor[i]!, nor[i + 1]!, nor[i + 2]!).applyMatrix3(n3).normalize();
      target.nor.push(v.x, v.y, v.z);
      target.col.push(r * (col?.[i] ?? 1), g * (col?.[i + 1] ?? 1), bl * (col?.[i + 2] ?? 1));
    }
    for (let i = 0; i < idx.length; i++) target.idx.push(base + idx[i]!);
    if (ao) {
      // The primitive's world box (shrunk for round shapes), for the occlusion probes at build().
      const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
      const box = boundsOf(shape);
      for (let c = 0; c < 8; c++) {
        v.set(c & 1 ? box.hi[0]! : box.lo[0]!, c & 2 ? box.hi[1]! : box.lo[1]!, c & 4 ? box.hi[2]! : box.lo[2]!).applyMatrix4(m);
        min[0] = Math.min(min[0], v.x); min[1] = Math.min(min[1], v.y); min[2] = Math.min(min[2], v.z);
        max[0] = Math.max(max[0], v.x); max[1] = Math.max(max[1], v.y); max[2] = Math.max(max[2], v.z);
      }
      for (let a = 0; a < 3; a++) { const grow = (max[a]! - min[a]!) * box.shrink / 2; min[a]! += grow; max[a]! -= grow; }
      target.prims.push({ id: primId++, start: base, count: pos.length / 3, min, max });
    }
  }
  const boxShape = () => template('box', () => new THREE.BoxGeometry(1, 1, 1));
  const cylShape = (top: number, seg: number, open: boolean) => template(`cyl:${top}:${seg}:${open}`, () => new THREE.CylinderGeometry(top, 1, 1, seg, 1, open));

  const batch: Batch = {
    isBatch: true,
    /** Add prepared indexed geometry at the current origin, sharing this batch's colour and material path. */
    geometry(shape, colour, o) { add(shape, 0, 0, 0, 1, 1, 1, colour, o); return batch; },
    /** box(x, y, z, width, height, depth, colour, options?) — centred on x, y, z */
    box(x, y, z, w, h, d, colour, o) { add(boxShape(), x, y, z, w, h, d, colour, o); return batch; },
    /** cyl(x, y, z, radius, height, colour, { top = 1 (top radius ÷ bottom radius), seg = 8, open, sx, sz }) — upright, centred */
    cyl(x, y, z, r, h, colour, o) {
      add(cylShape(o?.top ?? 1, o?.seg || 8, !!o?.open), x, y, z, r * (o?.sx || 1), h, r * (o?.sz || 1), colour, o);
      return batch;
    },
    /** cone(x, y, z, radius, height, colour, options?) — point up */
    cone(x, y, z, r, h, colour, o) { return batch.cyl(x, y, z, r, h, colour, { ...o, top: 0 }); },
    /** ball(x, y, z, rx, ry, rz, colour, { seg = 8 }) — an ellipsoid with the given radii */
    ball(x, y, z, rx, ry, rz, colour, o) {
      const seg = o?.seg || 8;
      add(template(`ball:${seg}`, () => new THREE.SphereGeometry(1, seg, Math.max(4, seg - 2))), x, y, z, rx, ry, rz, colour, o);
      return batch;
    },
    /** ico(x, y, z, rx, ry, rz, colour) — a 20-face lump for foliage and rocks */
    ico(x, y, z, rx, ry, rz, colour, o) { add(template('ico', () => new THREE.IcosahedronGeometry(1, 0)), x, y, z, rx, ry, rz, colour, o); return batch; },
    /** quad(x, y, z, width, height, colour, options?) — a flat panel facing +z (two triangles) */
    quad(x, y, z, w, h, colour, o) { add(template('quad', () => new THREE.PlaneGeometry(1, 1)), x, y, z, w, h, 1, colour, o); return batch; },
    /** disc(x, y, z, radius, colour, { seg = 12 }) — a flat circle facing up */
    disc(x, y, z, r, colour, o) {
      const seg = o?.seg || 12;
      add(template(`disc:${seg}`, () => new THREE.CircleGeometry(1, seg)), x, y, z, r * (o?.sx || 1), r * (o?.sz || 1), 1, colour, { ...o, rx: -Math.PI / 2 });
      return batch;
    },
    /** Run `draw` with the origin moved to x, y, z and turned by ry (optionally rx, rz, uniform scale). */
    at(x, y, z, ry, draw, rx = 0, rz = 0, scale = 1) {
      e.set(rx, ry || 0, rz, 'YXZ');
      const local = new THREE.Matrix4().compose(p.set(x, y, z), q.setFromEuler(e), s.set(scale, scale, scale));
      stack.push(local.premultiply(stack[stack.length - 1]!));
      try { draw(batch); } finally { stack.pop(); }
      return batch;
    },
    /** Ask for a point light at a position in the current local space. */
    light(x, y, z, colour, intensity = 20, distance = 12) {
      v.set(x, y, z).applyMatrix4(stack[stack.length - 1]!);
      lights.push({ x: v.x, y: v.y, z: v.z, colour, intensity, distance });
      return batch;
    },
    /** Where a local point ends up in scene space — for anchors recorded while drawing. */
    world(x, y, z) { v.set(x, y, z).applyMatrix4(stack[stack.length - 1]!); return { x: v.x, y: v.y, z: v.z }; },
    note(kind, x, z, r, h) { v.set(x, 0, z).applyMatrix4(stack[stack.length - 1]!); props.push({ kind, x: v.x, z: v.z, r, h }); },
    get triangles(): number { let count = 0; for (const data of Object.values(layers)) count += data.idx.length; return count / 3; },
    /**
     * The ambient-occlusion factors build() would compute, computed now in steps (`yield` after about SLICE_MS of work) and
     * kept in the factor cache build() reads first. The same primitives in the same order with the same probe budget, so the
     * factors, and the scene, are exactly those of a plain build(); only the work is spread over several tasks.
     */
    *prepareAo(): Generator<void, void, void> {
      if (!ao) return;
      const solids = Object.keys(layers).filter((key) => key === 'solid' || key.startsWith('solid@')).map((key) => layers[key]!);
      const strength = aoStrength();
      if (aoFactorsKnown(solids, strength)) return;
      const factors = solids.map((d) => new Float64Array(d.col.length).fill(1));
      const occluders = createOccluders(solids.flatMap((d) => d.prims));
      let budget = 30000, sliceStart = performance.now();
      for (let index = 0; index < solids.length; index++) {
        const d = solids[index]!;
        // A solid without primitives is baked whole (bakeVertexAO's own fallback), as build() does.
        if (!d.prims.length) { budget -= bakeVertexAO(d.pos, d.nor, factors[index]!, d.prims, occluders, { probeBudget: budget, strength }); continue; }
        for (let at = 0; at < d.prims.length; at += PRIM_CHUNK) {
          budget -= bakeVertexAO(d.pos, d.nor, factors[index]!, d.prims.slice(at, at + PRIM_CHUNK), occluders, { probeBudget: budget, strength });
          if (performance.now() - sliceStart > SLICE_MS) { yield; sliceStart = performance.now(); }
        }
      }
      aoFactorsKeep(solids, strength, factors);
    },
    /** Bake the batch into meshes. `materials` comes from sceneMaterials(kit). */
    build(materials: Record<keyof SceneMaterials, THREE.Material>): BatchResult {
      const meshes: THREE.Mesh[] = [];
      let triangles = 0;
      // The three shared layers first, then each part's own meshes.
      if (ao) {
        const solids = Object.keys(layers).filter((key) => key === 'solid' || key.startsWith('solid@')).map((key) => layers[key]!);
        const strength = aoStrength();
        let factors = aoFactorsKnown(solids, strength);
        if (!factors) {
          // The bake multiplies each vertex colour by one factor; baking into ones gives exactly those factors.
          factors = solids.map((d) => new Float64Array(d.col.length).fill(1));
          const occluders = createOccluders(solids.flatMap((d) => d.prims));
          let budget = 30000;
          solids.forEach((d, index) => { budget -= bakeVertexAO(d.pos, d.nor, factors![index]!, d.prims, occluders, { probeBudget: budget, strength }); });
          aoFactorsKeep(solids, strength, factors);
        }
        // col * f, the same product the bake forms in place.
        solids.forEach((d, index) => { const col = d.col, f = factors![index]!; for (let i = 0; i < col.length; i++) col[i] = col[i]! * f[i]!; });
      }
      const keys = [...BASE, ...Object.keys(layers).filter((key) => !BASE.includes(key)).sort()];
      for (const key of keys) {
        const data = layers[key]!;
        if (!data.idx.length) continue;
        const [name, part] = key.split('@') as [BatchLayer, string | undefined];
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(data.pos), 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(data.nor), 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(data.col), 3));
        geometry.setIndex(new THREE.BufferAttribute(data.pos.length / 3 > 65535 ? new Uint32Array(data.idx) : new Uint16Array(data.idx), 1));
        const mesh = new THREE.Mesh(geometry, materials[name]);
        mesh.name = key;
        if (part) mesh.userData.part = part;
        mesh.castShadow = name === 'solid';
        mesh.receiveShadow = name === 'solid';
        if (name === 'glass') mesh.renderOrder = 1;
        triangles += data.idx.length / 3;
        meshes.push(mesh);
      }
      const pointLights = lights.map((spec) => {
        const light = new THREE.PointLight(spec.colour, spec.intensity, spec.distance, 1.5);
        light.position.set(spec.x, spec.y, spec.z);
        light.userData.intensity = spec.intensity;
        return light;
      });
      if (props.length && meshes[0]) meshes[0].userData.props = props.slice();
      return { meshes, lights: pointLights, triangles };
    },
  };
  return batch;
}

export interface KitResources { materials: SceneMaterials; disposers: Set<() => void> }
const resources = new WeakMap<Kit, KitResources>();
/**
 * Per-kit shared resources: the three scene materials plus a registry of scenes and avatars the
 * host has not disposed itself. Both are freed through kit.onDispose().
 */
export function kitResources(kit: Kit): KitResources {
  let entry = resources.get(kit);
  if (!entry) {
    const { THREE } = kit;
    // High tier: slightly lower roughness so the generated environment map shows as a soft sheen; glass clearer.
    const high = renderTier().name === 'high';
    const materials: SceneMaterials = {
      solid: kit.matte ? new THREE.MeshLambertMaterial({ vertexColors: true }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: high ? 0.8 : 0.9, metalness: 0 }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
      glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: high ? 0.12 : 0.25, metalness: 0, transparent: true, opacity: 0.62, depthWrite: false }),
    };
    const disposers = new Set<() => void>();
    entry = { materials, disposers };
    resources.set(kit, entry);
    kit.onDispose(() => {
      for (const dispose of [...disposers]) dispose();
      disposers.clear();
      Object.values(materials).forEach((material) => material.dispose());
      resources.delete(kit);
    });
  }
  return entry;
}
export const sceneMaterials = (kit: Kit): SceneMaterials => kitResources(kit).materials;

/** Remove meshes and lights from their parent and free their geometry. Materials are shared and stay. */
/** Anything with a parent, maybe a geometry, maybe a dispose(): meshes and lights. */
export type Releasable = THREE.Object3D & { geometry?: THREE.BufferGeometry; dispose?: () => void };
export function releaseObjects(objects: Releasable[]): void {
  for (const object of objects) {
    object.parent?.remove(object);
    object.geometry?.dispose();
    object.dispose?.();
  }
  objects.length = 0;
}

/** Small deterministic string hash (FNV-1a) for seeded choices. */
export function hash(text: unknown): number {
  let value = 2166136261;
  const source = String(text ?? '');
  for (let i = 0; i < source.length; i++) value = Math.imul(value ^ source.charCodeAt(i), 16777619);
  return value >>> 0;
}
