/**
 * OWNER: scenes
 * EACH CITY'S OWN SCENES ARE A DOWNLOAD OF THEIR OWN. The scene host (src/venue-world.ts, src/scene/venue-scenes.ts) holds the
 * kinds every city draws with — and so every scene of the default city. A city's own scenes (its `scene.variant`s, and the
 * kinds it added) are fetched when a venue of THAT city is about to be shown, or a little ahead: while a trip to the city is
 * under way, and when the page starts in it. A player who never leaves one city never downloads another's.
 *
 *   await loadCityScenes(cityId)        fetch what the city needs (nothing for a city without scenes of its own); joins a fetch in flight
 *   cityScenesReady(cityId)             true once buildVenueScene(kit, venue, cityId) can run
 *   citySceneDef(cityId, kind, variant) the city's own scene for a kind and variant, else the kind it added, else null
 *
 * buildVenueScene is synchronous and throws for a city that is not ready: the caller (src/campus/unilag/world-adapter.ts)
 * awaits loadCityScenes first and draws nothing in the meantime, so a plain stand-in is never shown in a city scene's place.
 * A failed fetch is not remembered: the next loadCityScenes asks again (the adapter retries with src/lazy-load.ts).
 *
 * This module imports nothing at run time, so the page can start a city's download before the host itself has arrived.
 */
import type { SceneDef } from './types.ts';

/** VARIANTS[kind][variant] of a scene file. */
export type SceneVariants = Readonly<Record<string, Readonly<Record<string, SceneDef>>>>;
/** One downloaded piece: scene kinds a city added, and its scenes that replace a kind's own. */
export interface ScenePart { kinds?: Readonly<Record<string, SceneDef>>; variants?: SceneVariants }

const FETCH = {
  ibadan: async (): Promise<ScenePart> => { const [own, variants] = await Promise.all([import('./venues-ibadan-a.ts'), import('./venues-ibadan-b.ts')]); return { kinds: own.SCENES, variants: variants.VARIANTS }; },
  'ogun-signature': async (): Promise<ScenePart> => ({ variants: (await import('./venues-ogun-a.ts')).VARIANTS }),
  'ogun-everyday': async (): Promise<ScenePart> => ({ variants: (await import('./venues-ogun-b.ts')).VARIANTS }),
  'port-harcourt': async (): Promise<ScenePart> => ({ variants: (await import('./venues-rivers.ts')).VARIANTS }),
  abuja: async (): Promise<ScenePart> => ({ variants: (await import('./venues-fct.ts')).VARIANTS }),
  kano: async (): Promise<ScenePart> => ({ variants: (await import('./venues-kano.ts')).VARIANTS }),
} satisfies Record<string, () => Promise<ScenePart>>;
type PartId = keyof typeof FETCH;

/** The pieces each city draws with, in the order a variant is looked up. A city that is not listed has no scenes of its own. */
const CITY_PARTS: Readonly<Record<string, readonly PartId[]>> = Object.freeze({
  ibadan: ['ibadan'],
  abeokuta: ['ogun-signature', 'ogun-everyday'], 'ijebu-ode': ['ogun-signature', 'ogun-everyday'],
  ota: ['ogun-everyday'], sagamu: ['ogun-everyday'],
  'port-harcourt': ['port-harcourt'], abuja: ['abuja'], kano: ['kano'],
});
/** Scene kinds that are part of a city's download, with that city: the kind's own scene is there until the city is loaded. */
export const CITY_KINDS: Readonly<Record<string, string>> = Object.freeze({ quad: 'ibadan', hilltop: 'ibadan', lakeside: 'ibadan' });

const loaded = new Map<PartId, ScenePart>(), pending = new Map<PartId, Promise<ScenePart>>();
const partsOf = (cityId: string): readonly PartId[] => (Object.hasOwn(CITY_PARTS, cityId) ? CITY_PARTS[cityId]! : []);

/** Cities with scenes of their own. */
export const sceneCityIds = (): readonly string[] => Object.keys(CITY_PARTS);
export const cityScenesReady = (cityId: string): boolean => partsOf(cityId).every((part) => loaded.has(part));

function loadPart(part: PartId): Promise<ScenePart> {
  const ready = loaded.get(part);
  if (ready) return Promise.resolve(ready);
  const waiting = pending.get(part);
  if (waiting) return waiting;
  const work = FETCH[part]().then((value) => { loaded.set(part, value); return value; }).finally(() => { if (pending.get(part) === work) pending.delete(part); });
  pending.set(part, work);
  return work;
}
/** Fetch a city's own scenes. Resolves at once for a city that has none or has them already; rejects if a piece did not arrive. */
export async function loadCityScenes(cityId: string): Promise<void> { await Promise.all(partsOf(cityId).map(loadPart)); }
/** Every city's scenes (the scene viewer and the tests). */
export async function loadAllCityScenes(): Promise<void> { await Promise.all(sceneCityIds().map(loadCityScenes)); }

/** The city's own scene for a kind: the variant it asked for, else the kind itself where the city added it. Null: the shared kind is drawn. */
export function citySceneDef(cityId: string, kind: string, variant: string): SceneDef | null {
  const parts = partsOf(cityId);
  for (const part of parts) { const variants = loaded.get(part)?.variants, own = variants && Object.hasOwn(variants, kind) ? variants[kind]! : null; if (own && Object.hasOwn(own, variant)) return own[variant]!; }
  for (const part of parts) { const kinds = loaded.get(part)?.kinds; if (kinds && Object.hasOwn(kinds, kind)) return kinds[kind]!; }
  return null;
}
/** The first loaded city that has a scene of its own for this kind and variant (the scene viewer builds a bare kind and variant with it). */
export const sceneCityOf = (kind: string, variant: string): string | null => sceneCityIds().find((cityId) => cityScenesReady(cityId) && citySceneDef(cityId, kind, variant)) ?? null;
