import * as THREE from 'three';
import maleUrl from './skin-assets/mobile/1024/middleage_african_male_q90.jpg?url';
import femaleUrl from './skin-assets/mobile/1024/middleage_african_female_q90.jpg?url';

const maps = {
  man: { url: maleUrl, bytes: 126_259, reference: [0.14787665282263032, 0.04880991231432766, 0.021870639694593016] },
  woman: { url: femaleUrl, bytes: 124_599, reference: [0.145267316941515, 0.04278947357020705, 0.02141900069570399] },
} as const;

export interface SkinTextureOwner {
  onDispose(callback: () => void): () => boolean;
}

interface SkinTextureEntry {
  promise: Promise<THREE.Texture>;
  texture?: THREE.Texture;
}

interface SkinTextureCache {
  closed: boolean;
  readonly entries: Map<keyof typeof maps, SkinTextureEntry>;
  unregisterKit?: () => boolean;
}

const caches = new WeakMap<object, SkinTextureCache>();

function configureTexture(texture: THREE.Texture): THREE.Texture {
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 1;
  return texture;
}

function closeCache(cache: SkinTextureCache): void {
  if (cache.closed) return;
  cache.closed = true;
  cache.unregisterKit?.();
  for (const entry of cache.entries.values()) entry.texture?.dispose();
  cache.entries.clear();
}

function cacheFor(owner: SkinTextureOwner): SkinTextureCache {
  let cache = caches.get(owner as object);
  if (!cache) {
    cache = { closed: false, entries: new Map() };
    caches.set(owner as object, cache);
    cache.unregisterKit = owner.onDispose(() => closeCache(cache!));
  }
  if (cache.closed) throw new Error('Authored skin Kit is already disposed');
  return cache;
}

function loadCachedTexture(cache: SkinTextureCache, body: keyof typeof maps): Promise<THREE.Texture> {
  if (cache.closed) return Promise.reject(new Error('Authored skin Kit is already disposed'));
  const existing = cache.entries.get(body);
  if (existing) return existing.promise;

  const source = maps[body];
  const entry = {} as SkinTextureEntry;
  entry.promise = new THREE.TextureLoader().loadAsync(source.url).then((texture) => {
    if (cache.closed) {
      texture.dispose();
      throw new Error('Authored skin texture completed after its Kit was disposed');
    }
    entry.texture = configureTexture(texture);
    return texture;
  }).catch((error: unknown) => {
    if (cache.entries.get(body) === entry) cache.entries.delete(body);
    throw error;
  });
  cache.entries.set(body, entry);
  return entry.promise;
}

async function loadOwnedTexture(body: keyof typeof maps): Promise<THREE.Texture> {
  return configureTexture(await new THREE.TextureLoader().loadAsync(maps[body].url));
}

/** Apply the compatible hm08 skin map to this actor's Body material. Clothing keeps its own material. */
export async function applySkinMaterial(
  root: THREE.Group,
  body: keyof typeof maps,
  skin: string,
  owner?: SkinTextureOwner,
) {
  const mesh = root.getObjectByName('Body') as THREE.SkinnedMesh | undefined;
  if (!mesh?.isSkinnedMesh || Array.isArray(mesh.material)) throw new Error('Authored skin requires one Body material');
  const original = mesh.material;
  const source = maps[body];
  const cache = owner ? cacheFor(owner) : undefined;
  const texture = owner ? await loadCachedTexture(cache!, body) : await loadOwnedTexture(body);
  if (cache?.closed) throw new Error('Authored skin Kit was disposed while loading the texture');

  const material = original.clone() as THREE.MeshStandardMaterial;
  const target = new THREE.Color(skin);
  material.color.setRGB(target.r / source.reference[0], target.g / source.reference[1], target.b / source.reference[2]);
  material.map = texture;
  material.roughness = 0.78;
  material.metalness = 0;

  let disposed = false;
  let unregisterKit: (() => boolean) | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unregisterKit?.();
    if (mesh.material === material) mesh.material = original;
    material.dispose();
    if (!owner) texture.dispose();
  };

  if (owner) {
    unregisterKit = owner.onDispose(dispose);
    if (disposed || cache!.closed) {
      dispose();
      throw new Error('Authored skin Kit was disposed before material attachment');
    }
  }
  mesh.material = material;

  return {
    metrics: { width: 1024, height: 1024, assetBytes: source.bytes, source: 'MakeHuman CC0 hm08 skin', colorReference: source.reference },
    setColor(skinColor: string) {
      if (disposed) throw new Error('Cannot recolor disposed skin material');
      const next = new THREE.Color(skinColor);
      material.color.setRGB(next.r / source.reference[0], next.g / source.reference[1], next.b / source.reference[2]);
    },
    dispose,
  };
}
