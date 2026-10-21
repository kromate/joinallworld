// OWNER: scenes (unique places)
// A venue's own model, drawn behind the venue scene. Lazy: reached only through a dynamic import from the recipe host.
//
//   const backdrop = await attachPlaceBackdrop(kit, group, { city, venue, slot, current })     // null: no model, or it could not be had
//
// What it does: pick the level of detail for this device (device.ts), fetch that one file by its hash and check it (glb.ts), decode it through the
// scene model source (src/scene/models/gltf-source.ts, meshopt), bind the shared atlas to the model's one material "trim" (texture x vertex colour,
// as every other scene model), fit it into the slot (fit.ts) and add it to the scene as ONE merged mesh in a group marked `userData.placeModel`
// (src/scene/body/render-cost.ts measures it under PLACE_MODEL_TRIANGLES, apart from scenery). Any failure leaves the scene exactly as it was.
import type * as THREE from 'three';
import type { Kit } from '../kit.ts';
import { createGltfSource } from '../models/gltf-source.ts';
import { createModelCache, createModelLayer } from '../models/scene-models.ts';
import type { ModelData, ModelSource } from '../models/scene-models.ts';
import { PLACE_ATLAS } from './atlas.generated.ts';
import { chooseVenueDetail, placeDeviceHints } from './device.ts';
import type { PlaceDetail, PlaceDeviceHints } from './device.ts';
import { fitPlaceModel, boxOf } from './fit.ts';
import type { PlaceFit, PlaceSlot } from './fit.ts';
import { fetchPlaceGlb, sha256Hex } from './glb.ts';
import { PLACE_MODEL_LIMITS } from './limits.ts';
import { loadPlaceManifest } from './load.ts';
import type { PlaceManifest } from './manifest.ts';

export interface PlaceBackdropOptions {
  city: string
  venue: string
  slot: PlaceSlot
  /** False once the scene is gone or replaced: the result is dropped. */
  current(): boolean
  /** Asked before the model is added: false when the scene has no room for its draw call (the shared 60). */
  fits?(cost: { triangles: number; drawCalls: number }): boolean
  hints?: PlaceDeviceHints
  manifest?: PlaceManifest | null
  fetcher?: typeof globalThis.fetch
  /** Loads the shared atlas picture (a test supplies a texture without an image). */
  loadAtlas?(kit: Kit, url: string): Promise<THREE.Texture>
  /** Reads the verified bytes into a glTF scene (a test reads from disk; the default is GLTFLoader with the meshopt decoder). */
  decode?(bytes: Uint8Array<ArrayBuffer>): Promise<{ scene: THREE.Group }>
  /** Called once the model is in the scene (the host redraws and re-budgets). */
  changed?(): void
}
export interface PlaceBackdrop {
  group: THREE.Group
  detail: PlaceDetail
  triangles: number
  drawCalls: number
  fit: PlaceFit
  dispose(): void
}

/** The shared atlas picture: fetched, checked against the hash in its own file name, decoded, top-left origin (flipY off) like every glTF texture. */
async function loadAtlasTexture(kit: Kit, url: string): Promise<THREE.Texture> {
  const response = await fetch(url, { credentials: 'same-origin', redirect: 'error' });
  if (!response.ok) throw new Error(`Place atlas HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const named = /-([0-9a-f]{64})\.webp$/.exec(url)?.[1];
  if (!named || await sha256Hex(bytes) !== named) throw new Error('Place atlas hash differs from its address');
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/webp' }));
  const texture = new kit.THREE.Texture(bitmap as unknown as ImageBitmap);
  texture.needsUpdate = true;
  return texture;
}
async function decodeGlb(bytes: Uint8Array<ArrayBuffer>): Promise<{ scene: THREE.Group }> {
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([import('three/examples/jsm/loaders/GLTFLoader.js'), import('three/examples/jsm/libs/meshopt_decoder.module.js')]);
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer, '');
}

/** The scene model source for one verified place file and the shared atlas: parts sample the atlas key 'trim'. */
function placeSource(kit: Kit, key: string, root: Promise<{ scene: THREE.Group }>, atlas: Promise<THREE.Texture>): ModelSource {
  const inner = createGltfSource(kit, { urls: { [key]: key }, atlasOf: () => 'trim', open: () => root });
  let texture: THREE.Texture | null = null, disposed = false;
  return {
    texture: name => (name === 'trim' ? texture : null),
    dispose() {
      disposed = true; inner.dispose?.();
      // The picture is freed with the source (its bitmap too: three has uploaded it), including one that arrives after the source is gone.
      const free = (picture: THREE.Texture) => { const image = picture.image as { close?(): void } | null; picture.dispose(); image?.close?.(); };
      const held = texture; texture = null;
      if (held) free(held);
      void atlas.then(picture => { if (picture !== held) free(picture); }, () => {});
    },
    async load(file) {
      const [data, picture] = await Promise.all([inner.load(file), atlas]);
      if (disposed) { picture.dispose(); throw new Error('Place source disposed'); }
      const { THREE } = kit;
      picture.flipY = false; picture.colorSpace = THREE.SRGBColorSpace; picture.anisotropy = 4; picture.needsUpdate = true;
      texture = picture;
      return { ...data, parts: data.parts.map(part => ({ ...part, atlas: 'trim' })) };
    },
  };
}

/**
 * Loads and attaches the venue's model behind the scene. Resolves to null when the city or venue has no model, the device may not have one, the
 * scene is gone, there is no room, or anything fails; in every such case nothing was added.
 */
export async function attachPlaceBackdrop(kit: Kit, parent: THREE.Group, options: PlaceBackdropOptions): Promise<PlaceBackdrop | null> {
  const mark = (status: string, error?: unknown) => {
    parent.userData.placeModelStatus = status;
    if (error === undefined) delete parent.userData.placeModelError; else parent.userData.placeModelError = String(error instanceof Error ? error.message : error);
  };
  try {
    const manifest = options.manifest === undefined ? await loadPlaceManifest(options.city) : options.manifest;
    const entry = manifest && Object.hasOwn(manifest.venues, options.venue) ? manifest.venues[options.venue] : undefined;
    if (!manifest || !entry) { mark('none'); return null; }
    if (!options.current()) return null;
    const hints = options.hints ?? placeDeviceHints(), detail = chooseVenueDetail(hints);
    const lod = entry[detail];
    mark('loading');
    const bytes = await fetchPlaceGlb(lod, detail, options.fetcher ? { fetcher: options.fetcher } : {});
    if (!options.current()) return null;
    const atlasFile = detail === 'lod0' ? PLACE_ATLAS.full : PLACE_ATLAS.small;
    const root = (options.decode ?? decodeGlb)(bytes), picture = (options.loadAtlas ?? loadAtlasTexture)(kit, atlasFile.url);
    // Failures before the cache takes ownership of these promises must not escape as unhandled rejections.
    root.catch(() => {}); picture.catch(() => {});
    const source = placeSource(kit, lod.sha256, root, picture), cache = createModelCache(source);
    const data = await cache.request(lod.sha256);
    if (!data) { source.dispose?.(); throw new Error('Place model did not decode'); }
    if (!options.current()) { source.dispose?.(); return null; }
    const checked = checkDecoded(data, lod.triangles, detail);
    const fit = fitPlaceModel(boxOf(data.parts.map(part => part.position)), options.slot);
    const layer = createModelLayer(kit, cache);
    layer.add({ near: lod.sha256, x: fit.x, y: fit.y, z: fit.z, ry: fit.ry, scale: fit.scale, mode: 'merge' });
    layer.build();
    const stats = layer.stats();
    if (stats.dropped !== 0 || stats.standIns !== 0 || stats.triangles !== checked) { layer.dispose(); source.dispose?.(); throw new Error('Place model was not drawn completely'); }
    const group = new kit.THREE.Group();
    group.name = `place-model:${options.city}:${options.venue}`;
    group.userData.placeModel = true;
    layer.group.traverse(object => { if ((object as THREE.Mesh).isMesh) { object.castShadow = false; object.receiveShadow = false; object.frustumCulled = true; } });
    group.add(layer.group);
    const drawCalls = stats.drawCalls;
    if (!options.current() || (options.fits && !options.fits({ triangles: stats.triangles, drawCalls }))) { layer.dispose(); source.dispose?.(); mark('skipped'); return null; }
    parent.add(group);
    mark('ready');
    parent.userData.placeModelDetail = detail;
    let disposed = false;
    const dispose = () => {
      if (disposed) return; disposed = true;
      layer.dispose(); source.dispose?.(); group.removeFromParent(); group.clear();
      delete parent.userData.placeModelDetail; mark('none');
    };
    kit.onDispose(dispose);
    options.changed?.();
    return { group, detail, triangles: stats.triangles, drawCalls, fit, dispose };
  } catch (error) {
    mark('failed', error);
    return null;
  }
}

/** The decoded file must be the file the manifest described: its triangle count, and within the named limit of its level. */
function checkDecoded(data: ModelData, declared: number, detail: PlaceDetail): number {
  if (data.triangles !== declared) throw new Error('Place model triangles differ from the manifest');
  if (data.triangles > PLACE_MODEL_LIMITS[detail].triangles) throw new Error('Place model exceeds its triangle limit');
  for (const part of data.parts) {
    const count = part.position.length / 3;
    if (!(count > 0 && part.uv && part.uv.length === count * 2 && part.color && part.color.length === count * 3 && part.uv.every(n => n >= -1e-5 && n <= 1 + 1e-5)
      && [part.position, part.normal, part.color, part.uv].every(a => a.every(Number.isFinite)))) throw new Error('Place model arrays are invalid');
  }
  return data.triangles;
}
