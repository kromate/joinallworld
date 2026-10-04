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

const templates = new Map();
function template(key, make) {
  let entry = templates.get(key);
  if (!entry) {
    const geometry = make();
    const pos = Float32Array.from(geometry.attributes.position.array);
    const nor = Float32Array.from(geometry.attributes.normal.array);
    const idx = geometry.index ? Array.from(geometry.index.array) : Array.from({ length: pos.length / 3 }, (_, i) => i);
    geometry.dispose();
    entry = { pos, nor, idx };
    templates.set(key, entry);
  }
  return entry;
}

export const GLOW = Object.freeze({ layer: 'glow' });
export const GLASS = Object.freeze({ layer: 'glass' });

export function createBatch(THREE) {
  const layer = () => ({ pos: [], nor: [], col: [], idx: [] });
  const layers = { solid: layer(), glow: layer(), glass: layer() };
  const BASE = ['solid', 'glow', 'glass'];
  /** The vertex store for a layer, or for one named part of it (made the first time the part is drawn). */
  const store = (name, part) => { if (!part) return layers[name]; const key = `${name}@${part}`; return (layers[key] ||= layer()); };
  const stack = [new THREE.Matrix4()];
  const lights = [];
  const colours = new Map();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const n3 = new THREE.Matrix3(), v = new THREE.Vector3(), tint = new THREE.Color();

  function rgb(colour) {
    let value = colours.get(colour);
    if (!value) {
      tint.set(colour);
      value = [tint.r, tint.g, tint.b];
      colours.set(colour, value);
    }
    return value;
  }
  function add(shape, x, y, z, sx, sy, sz, colour, o) {
    e.set(o?.rx || 0, o?.ry || 0, o?.rz || 0, 'YXZ');
    m.compose(p.set(x, y, z), q.setFromEuler(e), s.set(sx, sy, sz)).premultiply(stack[stack.length - 1]);
    n3.getNormalMatrix(m);
    const target = store(Object.hasOwn(layers, o?.layer) && BASE.includes(o.layer) ? o.layer : 'solid', o?.part);
    const base = target.pos.length / 3;
    const [r, g, bl] = rgb(colour);
    const { pos, nor, idx } = shape;
    for (let i = 0; i < pos.length; i += 3) {
      v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(m);
      target.pos.push(v.x, v.y, v.z);
      v.set(nor[i], nor[i + 1], nor[i + 2]).applyMatrix3(n3).normalize();
      target.nor.push(v.x, v.y, v.z);
      target.col.push(r, g, bl);
    }
    for (let i = 0; i < idx.length; i++) target.idx.push(base + idx[i]);
  }
  const boxShape = () => template('box', () => new THREE.BoxGeometry(1, 1, 1));
  const cylShape = (top, seg, open) => template(`cyl:${top}:${seg}:${open}`, () => new THREE.CylinderGeometry(top, 1, 1, seg, 1, open));

  const batch = {
    isBatch: true,
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
      stack.push(local.premultiply(stack[stack.length - 1]));
      try { draw(batch); } finally { stack.pop(); }
      return batch;
    },
    /** Ask for a point light at a position in the current local space. */
    light(x, y, z, colour, intensity = 20, distance = 12) {
      v.set(x, y, z).applyMatrix4(stack[stack.length - 1]);
      lights.push({ x: v.x, y: v.y, z: v.z, colour, intensity, distance });
      return batch;
    },
    /** Where a local point ends up in scene space — for anchors recorded while drawing. */
    world(x, y, z) { v.set(x, y, z).applyMatrix4(stack[stack.length - 1]); return { x: v.x, y: v.y, z: v.z }; },
    get triangles() { let count = 0; for (const data of Object.values(layers)) count += data.idx.length; return count / 3; },
    /** Bake the batch into meshes. `materials` comes from sceneMaterials(kit). */
    build(materials) {
      const meshes = [];
      let triangles = 0;
      // The three shared layers first, then each part's own meshes.
      const keys = [...BASE, ...Object.keys(layers).filter((key) => !BASE.includes(key)).sort()];
      for (const key of keys) {
        const data = layers[key];
        if (!data.idx.length) continue;
        const [name, part] = key.split('@');
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
      return { meshes, lights: pointLights, triangles };
    },
  };
  return batch;
}

const resources = new WeakMap();
/**
 * Per-kit shared resources: the three scene materials plus a registry of scenes and avatars the
 * host has not disposed itself. Both are freed through kit.onDispose().
 */
export function kitResources(kit) {
  let entry = resources.get(kit);
  if (!entry) {
    const { THREE } = kit;
    const materials = {
      solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
      glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0, transparent: true, opacity: 0.62, depthWrite: false }),
    };
    const disposers = new Set();
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
export const sceneMaterials = (kit) => kitResources(kit).materials;

/** Remove meshes and lights from their parent and free their geometry. Materials are shared and stay. */
export function releaseObjects(objects) {
  for (const object of objects) {
    object.parent?.remove(object);
    object.geometry?.dispose();
    object.dispose?.();
  }
  objects.length = 0;
}

/** Small deterministic string hash (FNV-1a) for seeded choices. */
export function hash(text) {
  let value = 2166136261;
  const source = String(text ?? '');
  for (let i = 0; i < source.length; i++) value = Math.imul(value ^ source.charCodeAt(i), 16777619);
  return value >>> 0;
}
