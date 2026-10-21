import type { SceneDef } from '../types.ts';
import { createRuntimeHost } from '../models/runtime-host.ts';
import type { RecipeRuntimeMetadata } from './pack.ts';
import { requireRecipe } from './pack.ts';
import type { ValidatedRecipe } from './contract.ts';
import { METRES_TO_SCENE } from './contract.ts';
import type { PreparedCityAssets } from './prepare.ts';
import { recipeRuntimeHost } from './runtime-host.ts';
import { recipeCameraFit } from './camera-fit.ts';
import { recipeSkyTint } from './sky.ts';
import type { PlaceManifest } from '../places/manifest.ts';

/** `places`: the city's place-model manifest (src/scene/places). A venue it lists shows its own model behind the scene; every other venue is drawn as before. */
export function compileRecipe(value: ValidatedRecipe, prepared: PreparedCityAssets, metadata: RecipeRuntimeMetadata, places: PlaceManifest | null = null): SceneDef {
  const { recipe } = value;
  const atlases = new Set(value.placements.map(p => (p.source === 'kit' ? prepared.kit : prepared.hero)?.models.get(p.node)?.parts[0]?.atlas));
  requireRecipe(!atlases.has(undefined), 'missing prepared placement');
  const reservation = { triangles: 12 * (1 + recipe.shell.length) + recipe.signs.length * 2 + value.placements.reduce((sum, p) => sum + p.triangles, 0),
    drawCalls: 2 * (1 + atlases.size + Number(recipe.signs.length > 0)) };
  createRuntimeHost.validate(reservation);
  const host = metadata.hostScenery[recipe.venue];
  requireRecipe(host, 'missing venue host measurement');
  requireRecipe(reservation.triangles + host.triangles <= 15_000, 'complete scenery exceeds triangle limit');
  const bounds: [number, number, number, number] = [-recipe.footprint.w / 2, -recipe.footprint.d / 2, recipe.footprint.w / 2, recipe.footprint.d / 2];
  const metres = (p: readonly number[]): [number, number, number] => [p[0]! / METRES_TO_SCENE, p[1]! / METRES_TO_SCENE, p[2]! / METRES_TO_SCENE];
  const asset = metadata.assets.kit;
  // Preserve the composed preset against the host's shortest arrival distance (13 scene units).
  const start = Math.max(1, ...[recipe.camera.landscape, recipe.camera.portrait]
    .map(([x, y, z]) => Math.hypot(x, y - 0.7, z) / 13));
  return {
    ...(value.sky ? { skyTint: recipeSkyTint(value.sky) } : {}),
    mood: recipe.mood, accent: recipe.palette.accent, camera: { ...recipe.camera, start, fit: recipeCameraFit(value) },
    walk: { bounds, entrance: [recipe.entrance[0], recipe.entrance[1]], open: false, block: value.walk.block },
    runtime: { createHost: recipeRuntimeHost(value, prepared, reservation, places && Object.hasOwn(places.venues, recipe.venue) ? { manifest: places } : undefined), reservation, bounds, support: [{ rect: bounds, y: 0 }], entranceYaw: recipe.entrance[2],
      request: { id: `recipe:${recipe.city}:${recipe.venue}`, near: { url: asset.url, sha256: asset.measurement.sha256 }, far: { url: asset.url, sha256: asset.measurement.sha256 },
        indoors: recipe.mood !== 'outdoor', position: [0, 0, 0], yaw: 0,
        navigation: { entrance: [recipe.entrance[0] / METRES_TO_SCENE, recipe.entrance[1] / METRES_TO_SCENE, recipe.entrance[2]],
          walkable: [bounds.map(n => n / METRES_TO_SCENE) as [number, number, number, number]],
          collision: value.solids.map((b, i) => ({ id: `solid-${i}`, min: metres(b.min), max: metres(b.max) })),
          anchors: recipe.spots.map(s => ({ id: s.key, position: metres([s.x, 0, s.z]), kind: 'spot' })) } } },
    build(batch) {
      batch.box(0, -0.1, 0, recipe.footprint.w, 0.2, recipe.footprint.d, recipe.palette.ground);
      for (const shell of recipe.shell) batch.at(...shell.position, shell.ry, b => b.box(0, 0, 0, ...shell.size, shell.colour));
      for (const lamp of recipe.lamps) batch.light(...lamp.position, lamp.colour, lamp.intensity, lamp.distance);
      return { spots: recipe.spots.map(s => ({ ...s, ...(s.approach ? { approach: [...s.approach] as [number, number] } : {}) })),
        crowd: recipe.crowd.map(p => [...p]), spare: recipe.crowd.map(([x, z]) => [x, z]) };
    },
  };
}
