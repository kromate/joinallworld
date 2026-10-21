import { cityContent } from '../../game/cities/registry.ts';
import { spotsOf } from '../../life.ts';
import { screenText } from '../../../server/moderation/text.ts';
import type { SceneDef, SceneVenue } from '../types.ts';
import type { ScenePart } from '../city-scenes.ts';
import { parseCityRecipes } from './contract.ts';
import { parseRecipePack, requireRecipe } from './pack.ts';
import { compileRecipe } from './compile.ts';
import { recipeAssets } from './prepare.ts';
import type { RecipeAssetStore } from './prepare.ts';
import { loadPlaceManifest } from '../places/load.ts';
import type { PlaceManifest } from '../places/manifest.ts';

type Authored = (kind: string, variant: string) => SceneDef | null;
export async function prepareRecipePart(city: string, input: unknown, authored: Authored, store: RecipeAssetStore = recipeAssets, placesOf: (city: string) => Promise<PlaceManifest | null> = loadPlaceManifest): Promise<ScenePart> {
  const { text, metadata } = await parseRecipePack(input, city);
  const content = cityContent(city), targetIds = new Set(metadata.targetVenueIds);
  const targets: SceneVenue[] = [];
  for (const venue of content.venues) {
    const scene = venue.definition.scene;
    const preserved = city === 'lagos' || venue.kind === 'home' || scene.kind === 'home' || scene.kind === 'unilag' || authored(scene.kind, scene.variant ?? '') !== null;
    requireRecipe(targetIds.has(venue.id) !== preserved, `target classification differs for ${venue.id}`);
    if (!preserved) targets.push({ ...venue.definition, scene: { ...scene, spots: spotsOf(venue.id, city).map(s => ({ id: s.id, label: s.label })) } });
  }
  requireRecipe(targets.length === targetIds.size, 'unknown target venue');
  const parsed = parseCityRecipes(text, { city, venues: targets, assets: { kit: metadata.assets.kit.measurement, ...(metadata.assets.hero ? { hero: metadata.assets.hero.measurement } : {}) }, screenText, hostScenery: metadata.hostScenery });
  requireRecipe(parsed.recipes.every(value => value.recipe.region === metadata.region), 'recipe region mismatch');
  requireRecipe(parsed.recipes.filter(value => value.recipe.hero).length === (parsed.recipes.length ? 1 : 0), 'city hero coverage mismatch');
  requireRecipe(Boolean(metadata.assets.hero) === parsed.recipes.some(value => value.recipe.hero), 'unplaced or missing hero dependency');
  if (!parsed.recipes.length) return { kinds: {} };
  // The city's place models are optional: a city without them, or a manifest that cannot be had, draws exactly what it drew before.
  const [prepared, places] = await Promise.all([store.prepareCity(metadata), placesOf(city)]), kinds: Record<string, SceneDef> = {};
  for (const value of parsed.recipes) kinds[`recipe:${value.recipe.venue}`] = compileRecipe(value, prepared, metadata, places);
  return { kinds: Object.freeze(kinds) };
}
export async function loadRecipePart(city: string, authored: Authored): Promise<ScenePart> {
  const { RECIPE_CITY_LOADERS } = await import('./registry.generated.ts');
  const load = Object.hasOwn(RECIPE_CITY_LOADERS, city) ? RECIPE_CITY_LOADERS[city] : undefined;
  requireRecipe(load, `missing generated city ${city}`);
  return prepareRecipePart(city, (await load()).default, authored);
}
