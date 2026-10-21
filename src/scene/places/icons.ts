// OWNER: scenes (unique places), used by the city map (src/map3d)
// The map icons: each venue's LOD2 model (up to 500 triangles, about 2 KB), read into plain arrays the city can place on its plinths.
//
//   const plan = await planPlaceIcons(city)         // null: the city has no place models, nothing changes
//   plan.venues                                      // the venues that have an icon coming: the city draws their procedural building apart, as a fallback
//   const icons = await plan.load()                  // never rejects; a venue whose file fails is simply absent, and keeps its procedural building
//
// A LOD2 file is drawn from vertex colour alone, so the map downloads no atlas. Lazy: reached only through a dynamic import from src/map3d.
import { Matrix3, Vector3 } from 'three';
import { fetchPlaceGlb } from './glb.ts';
import { loadPlaceManifest } from './load.ts';
import type { PlaceManifest } from './manifest.ts';

/** One icon in plain arrays: metres, +Y up, ground at y = 0, main facade towards +Z; vertex colour linear RGB. */
export interface PlaceIcon { position: Float32Array; normal: Float32Array; color: Float32Array; index: Uint32Array; triangles: number }
export interface PlaceIcons { readonly models: ReadonlyMap<string, PlaceIcon> }
export interface PlaceIconPlan { readonly venues: ReadonlySet<string>; load(): Promise<PlaceIcons> }

export interface IconOptions { fetcher?: typeof globalThis.fetch; manifest?: PlaceManifest | null; concurrency?: number; decode?(bytes: Uint8Array<ArrayBuffer>): Promise<{ scene: import('three').Object3D }> }

async function decodeGlb(bytes: Uint8Array<ArrayBuffer>): Promise<{ scene: import('three').Object3D }> {
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([import('three/examples/jsm/loaders/GLTFLoader.js'), import('three/examples/jsm/libs/meshopt_decoder.module.js')]);
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer, '');
}

/** Every mesh of a decoded model merged into one icon, node transforms baked in. */
export function iconOf(root: import('three').Object3D): PlaceIcon {
  root.updateMatrixWorld(true);
  const meshes: import('three').Mesh[] = [];
  root.traverse(object => { if ((object as import('three').Mesh).isMesh) meshes.push(object as import('three').Mesh); });
  let vertices = 0, indices = 0;
  for (const mesh of meshes) { vertices += mesh.geometry.getAttribute('position').count; indices += mesh.geometry.index?.count ?? 0; }
  if (!vertices || !indices) throw new Error('Place icon has no triangles');
  const position = new Float32Array(vertices * 3), normal = new Float32Array(vertices * 3), color = new Float32Array(vertices * 3).fill(1), index = new Uint32Array(indices);
  const v = new Vector3(), n3 = new Matrix3();
  let base = 0, at = 0;
  for (const mesh of meshes) {
    const g = mesh.geometry, p = g.getAttribute('position'), nm = g.getAttribute('normal'), c = g.getAttribute('color');
    n3.getNormalMatrix(mesh.matrixWorld);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld); position.set([v.x, v.y, v.z], (base + i) * 3);
      if (nm) { v.fromBufferAttribute(nm, i).applyMatrix3(n3).normalize(); normal.set([v.x, v.y, v.z], (base + i) * 3); } else normal.set([0, 1, 0], (base + i) * 3);
      if (c) color.set([c.getX(i), c.getY(i), c.getZ(i)], (base + i) * 3);
    }
    for (let i = 0; i < (g.index?.count ?? 0); i++) index[at + i] = g.index!.getX(i) + base;
    base += p.count; at += g.index?.count ?? 0;
    g.dispose();
  }
  if (![position, normal, color].every(a => a.every(Number.isFinite))) throw new Error('Place icon arrays are invalid');
  return { position, normal, color, index, triangles: index.length / 3 };
}

export async function planPlaceIcons(city: string, options: IconOptions = {}): Promise<PlaceIconPlan | null> {
  const manifest = options.manifest === undefined ? await loadPlaceManifest(city) : options.manifest;
  if (!manifest || !Object.keys(manifest.venues).length) return null;
  const venues = new Set(Object.keys(manifest.venues));
  return {
    venues,
    async load() {
      const models = new Map<string, PlaceIcon>(), queue = [...venues], width = Math.max(1, options.concurrency ?? 6);
      await Promise.all(Array.from({ length: Math.min(width, queue.length) }, async () => {
        for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
          try {
            const lod = manifest.venues[id]!.lod2;
            const bytes = await fetchPlaceGlb(lod, 'lod2', options.fetcher ? { fetcher: options.fetcher } : {});
            const icon = iconOf((await (options.decode ?? decodeGlb)(bytes)).scene);
            if (icon.triangles !== lod.triangles) throw new Error('Place icon triangles differ from the manifest');
            models.set(id, icon);
          } catch { /* this venue keeps its procedural building */ }
        }
      }));
      return { models };
    },
  };
}
