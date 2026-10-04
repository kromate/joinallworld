// Dynamic imports of the Three.js hosts: the chunk is fetched when the scene or the map first shows.
import type { SceneWorld, SceneWorldOptions, CityView, CityViewOptions, WorldMap, WorldMapOptions } from '../types/scene.ts'

/** One scene API over two hosts: the venue host, and the UNILAG campus's own (fetched only when the player goes there). */
export async function loadSceneWorld(): Promise<(container: HTMLElement, options?: SceneWorldOptions) => SceneWorld> {
  return (await import('../../campus/unilag/world-adapter.js')).createWorldAdapter as unknown as (container: HTMLElement, options?: SceneWorldOptions) => SceneWorld
}
export async function loadMaps(): Promise<{ createCityView: (container: HTMLElement, options?: CityViewOptions) => CityView; createWorldMap: (container: HTMLElement, options?: WorldMapOptions) => WorldMap }> {
  const [city, world] = await Promise.all([import('../../map3d/index.ts'), import('../../world-map.ts')])
  return { createCityView: city.createCityView, createWorldMap: world.createWorldMap }
}
