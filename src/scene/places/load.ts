// OWNER: scenes (unique places)
// A city's place manifest, from its lazy generated module. Imported only by code that is itself lazy (a venue scene's recipe part, the map's
// icon loader, the neighbour warm-up): nothing here is in the startup bundle. A city without a manifest, or a module that fails to load, is
// "no models" (null) and the scene or map keeps what it draws today. A failure is not remembered, so the next ask tries again.
import { PLACE_ATLAS } from './atlas.generated.ts';
import { parsePlaceManifest } from './manifest.ts';
import type { PlaceManifest } from './manifest.ts';

type Loaders = Readonly<Record<string, () => Promise<{ default: PlaceManifest }>>>;
let registry: Promise<Loaders> | null = null;
const pending = new Map<string, Promise<PlaceManifest | null>>();
const done = new Map<string, PlaceManifest | null>();

/** The generated registry (cities that have models) and a way to inject one in tests. */
async function loaders(): Promise<Loaders> {
  registry ??= import('./registry.generated.ts').then(module => module.PLACE_CITY_LOADERS);
  try { return await registry; } catch (error) { registry = null; throw error; }
}

export function loadPlaceManifest(city: string, source: () => Promise<Loaders> = loaders): Promise<PlaceManifest | null> {
  if (done.has(city)) return Promise.resolve(done.get(city) ?? null);
  const waiting = pending.get(city);
  if (waiting) return waiting;
  const work = (async () => {
    const all = await source();
    const load = Object.hasOwn(all, city) ? all[city] : undefined;
    if (!load) return null;
    const manifest = parsePlaceManifest((await load()).default, city);
    // The manifest and the generated atlas constants must agree: a manifest built for another atlas is not used.
    if (manifest.atlas.sha256 !== PLACE_ATLAS.full.sha256) throw new Error(`Place manifest for ${city} names another atlas`);
    return manifest;
  })().then(manifest => { done.set(city, manifest); return manifest; }, () => null).finally(() => { pending.delete(city); });
  pending.set(city, work);
  return work;
}
/** The manifest if it has already been loaded (the map and the scene read it synchronously after their lazy step). */
export const loadedPlaceManifest = (city: string): PlaceManifest | null => done.get(city) ?? null;
/** For tests. */
export function forgetPlaceManifests(): void { registry = null; pending.clear(); done.clear(); }
