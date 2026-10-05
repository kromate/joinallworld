// Dynamic imports of the Three.js hosts: the chunk is fetched when the scene or the map first shows.
import type { SceneWorld, SceneWorldOptions, CityView, CityViewOptions, WorldMap, WorldMapOptions } from '../types/scene.ts'

/** One scene API over two hosts: the venue host, and the UNILAG campus's own (fetched only when the player goes there). */
export async function loadSceneWorld(): Promise<(container: HTMLElement, options?: SceneWorldOptions) => SceneWorld> {
  return (await import('../../campus/unilag/world-adapter.ts')).createWorldAdapter as unknown as (container: HTMLElement, options?: SceneWorldOptions) => SceneWorld
}
/**
 * Fetch a city's own scenes ahead of need (src/scene/city-scenes.ts): the page starts in the city, or a trip to it has set off.
 * Nothing is built. Resolves when they are here or the fetch failed (never rejects): a fetch that fails here is asked for again,
 * with its retries, when a venue of the city is shown.
 */
export function warmCityScenes(cityId: string): Promise<void> {
  return import('../../scene/city-scenes.ts').then((scenes) => { cityScenes = scenes; return scenes.loadCityScenes(cityId) }).catch(() => undefined)
}
let cityScenes: { cityScenesReady(cityId: string): boolean } | null = null
/** Whether a city's own scenes have arrived, answered without waiting (false until anything was asked for). */
export const cityScenesHere = (cityId: string): boolean => cityScenes?.cityScenesReady(cityId) === true
export async function loadMaps(): Promise<{ createCityView: (container: HTMLElement, options?: CityViewOptions) => CityView; createWorldMap: (container: HTMLElement, options?: WorldMapOptions) => WorldMap }> {
  const [city, world] = await Promise.all([import('../../map3d/index.ts'), import('../../world-map.ts')])
  return { createCityView: city.createCityView, createWorldMap: world.createWorldMap }
}
