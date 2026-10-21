import type * as THREE from 'three';
import { createRuntimeHost } from '../models/runtime-host.ts';
import type { RuntimePlacement } from '../models/runtime-module.ts';
import { createModelLayer } from '../models/scene-models.ts';
import type { ValidatedRecipe } from './contract.ts';
import type { PreparedCityAssets } from './prepare.ts';
import { preparedCacheFor } from './cache.ts';
import { createRecipeSigns } from './signs.ts';
import { requireRecipe } from './pack.ts';
import { recipeSurfaceOwner } from './surface-material.ts';
import type { PlaceManifest } from '../places/manifest.ts';
import { recipePlaceSlot } from '../places/fit.ts';
import type { PlaceBackdropOptions } from '../places/backdrop.ts';

/** A venue that has its own model (src/scene/places): the manifest of its city. Absent: the venue is drawn as before, with the city hero if it has one. */
export interface RecipePlace { manifest: PlaceManifest; /** Test seams: the device hints, the fetch, the atlas loader and the decoder. */ hooks?: Pick<PlaceBackdropOptions, 'hints' | 'fetcher' | 'loadAtlas' | 'decode'> }
type Owner = NonNullable<Awaited<ReturnType<typeof createRuntimeHost>>>;
type HostArguments = Parameters<typeof createRuntimeHost>;
type Cost = { triangles: number; drawCalls: number };
export function recipeRuntimeHost(value: ValidatedRecipe, prepared: PreparedCityAssets, reservation: Cost, place?: RecipePlace): typeof createRuntimeHost {
  const start: typeof createRuntimeHost = Object.assign((kit: HostArguments[0], group: HostArguments[1], options: HostArguments[2]) => {
    if (!options.current()) return Promise.resolve(null);
    const { THREE } = kit;
    const spent = options.cost(true), budget = options.budget();
    requireRecipe(spent.triangles + reservation.triangles <= budget.triangles && spent.drawCalls + reservation.drawCalls <= budget.drawCalls, 'complete recipe exceeds host budget');
    const surfaces = value.surfaceStyle === 'physical-atlas-v1' ? recipeSurfaceOwner(kit, value.recipe) : undefined;
    const layer = createModelLayer(kit, preparedCacheFor(kit, prepared), surfaces ? { decorate: surfaces.decorate } : {});
    const root = new THREE.Group(); root.name = `recipe:${value.recipe.venue}`;
    let signs: ReturnType<typeof createRecipeSigns> = null, disposed = false, checking = false, registered = false;
    let backdrop: { dispose(): void } | null = null;
    let placement: RuntimePlacement | null = null;
    let forget: (() => boolean) | undefined;
    const current = () => !disposed && options.current();
    function dispose() {
      if (disposed) return; disposed = true; surfaces?.dispose(); backdrop?.dispose(); backdrop = null; layer.dispose(); heroLayer?.dispose(); signs?.dispose(); root.removeFromParent(); root.clear(); placement = null; forget?.();
    }
    function fail(message: string): never {
      group.userData.runtimeError = message; group.userData.runtimeStatus = 'error'; dispose(); throw new Error(message);
    }
    /** The hero back in its slot, with the sign that names it (the venue's own model could not be had). */
    let heroLayer: ReturnType<typeof createModelLayer> | null = null;
    function restoreHero(): void {
      if (!replaced || !current() || heroLayer) return;
      const hero = value.placements.filter(p => p.source === 'hero');
      try {
        heroLayer = createModelLayer(kit, preparedCacheFor(kit, prepared), surfaces ? { decorate: surfaces.decorate } : {});
        for (const p of hero) heroLayer.add({ near: `${p.assetSha256}:${p.node}`, x: p.x, z: p.z, ry: p.ry, scale: p.scale, mode: 'merge' });
        heroLayer.build();
        surfaces?.merged(heroLayer.group, { ...value, placements: hero }, prepared);
        root.add(heroLayer.group);
        const named = createRecipeSigns(kit, value.recipe);
        if (named) { signs?.dispose(); if (signs) root.remove(signs.mesh); signs = named; root.add(named.mesh); }
        kit.requestRender?.();
      } catch (error) { group.userData.placeModelError = String(error instanceof Error ? error.message : error); }
    }
    async function showPlace(known: RecipePlace): Promise<void> {
      let attached: Awaited<ReturnType<typeof import('../places/backdrop.ts').attachPlaceBackdrop>> = null;
      try {
        const { attachPlaceBackdrop } = await import('../places/backdrop.ts');
        if (!current()) return;
        attached = await attachPlaceBackdrop(kit, group, {
          ...known.hooks, city: value.recipe.city, venue: value.recipe.venue, manifest: known.manifest, slot: recipePlaceSlot(value.recipe.footprint), current,
          // The draw call is shared with everything on screen (the 60): add the model only if it fits beside what is drawn now.
          fits: cost => { const spent = options.cost(), room = options.budget(); return spent.drawCalls + cost.drawCalls <= room.drawCalls; },
          changed: () => { options.changed(); kit.requestRender?.(); },
        });
      } catch (error) { group.userData.placeModelStatus = 'failed'; group.userData.placeModelError = String(error instanceof Error ? error.message : error); }
      if (attached && disposed) attached.dispose(); else backdrop = attached;
      if (!attached) restoreHero();
    }

    const owner: Owner = {
      get placement() { return placement; },
      select(request) { if (!request) { dispose(); return Promise.resolve(false); } return Promise.resolve(current() && placement !== null); },
      dispose,
      guard() {
        if (!current() || checking) return;
        let pending = false;
        group.traverseVisible(node => { if (node.userData.characterStatus === 'loading' || node.userData.characterReservedTriangles > 0 || node.userData.characterReservedDrawCalls > 0) pending = true; });
        if (pending) return;
        checking = true;
        try {
          const fits = () => {
            const cost = options.cost(true), room = options.budget();
            return cost.triangles + reservation.triangles <= room.triangles && cost.drawCalls + reservation.drawCalls <= room.drawCalls;
          };
          if (fits()) return;
          options.readmit();
          if (!fits()) fail(`Complete recipe exceeds whole venue budget: ${JSON.stringify({ spent: options.cost(true), reservation, budget: options.budget() })}`);
        } finally { checking = false; }
      },
      selectAt() {
        if (!current()) return;
        if (!registered) {
          registered = true; checking = true;
          try { options.readmit(); } finally { checking = false; }
          options.changed(); kit.requestRender?.();
        }
        owner.guard();
      },
    };
    // A venue with its own model shows it behind the back wall instead of the city hero (src/scene/places). Until that model is here, and if it
    // never comes, the hero stands in its slot as it always did: restoreHero() puts it back when the model could not be had.
    const replaced = place !== undefined && Object.hasOwn(place.manifest.venues, value.recipe.venue) && value.placements.some(p => p.source === 'hero');
    const drawn = replaced ? { ...value, placements: value.placements.filter(p => p.source !== 'hero') } : value;
    const placeSigns = (recipe: ValidatedRecipe['recipe']) => createRecipeSigns(kit, replaced ? { ...recipe, signs: recipe.signs.filter(sign => !sign.text.startsWith('Model: ')) } : recipe);
    try {
      for (const p of drawn.placements) layer.add({ near: `${p.assetSha256}:${p.node}`, x: p.x, z: p.z, ry: p.ry, scale: p.scale, mode: 'merge' });
      layer.build();
      surfaces?.merged(layer.group, drawn, prepared);
      surfaces?.fallback(options.fallback);
      const stats = layer.stats();
      requireRecipe(stats.placements === drawn.placements.length && stats.dropped === 0 && stats.standIns === 0 && stats.triangles === drawn.placements.reduce((sum, p) => sum + p.triangles, 0), 'incomplete prepared recipe geometry');
      root.add(layer.group); signs = placeSigns(value.recipe); if (signs) root.add(signs.mesh);
      const cost = createRuntimeHost.measure(kit, root, []);
      // Fallback objects belong to the host. Measure them without reparenting.
      let supportTriangles = 0, supportDraws = 0;
      for (const object of options.fallback) {
        const measured = createRuntimeHost.measure(kit, object as THREE.Group, []);
        supportTriangles += measured.triangles; supportDraws += measured.drawCalls;
      }
      requireRecipe(cost.triangles + supportTriangles <= reservation.triangles && cost.drawCalls + supportDraws <= reservation.drawCalls, 'actual geometry exceeds recipe reservation');
      const navigation = options.request.navigation;
      const point = (p: readonly number[]) => new THREE.Vector3(p[0]! * 1.4, p[1]! * 1.4, p[2]! * 1.4);
      placement = { root, tier: 'near', ...cost,
        textureBytes: (prepared.kit.atlas ? Math.ceil(1024 * 1024 * 4 * 4 / 3) : 0) + (signs?.textureBytes ?? 0),
        entrance: { position: new THREE.Vector3(value.recipe.entrance[0], 0, value.recipe.entrance[1]), yaw: value.recipe.entrance[2] },
        anchors: navigation.anchors.map(a => ({ id: a.id, kind: a.kind, position: point(a.position) })),
        collision: navigation.collision.map(b => ({ id: b.id, box: new THREE.Box3(point(b.min), point(b.max)) })),
        walkable: navigation.walkable.map(([x0, z0, x1, z1]) => [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]].map(point)),
      };
      requireRecipe(placement.textureBytes <= 9 * 1024 * 1024, 'recipe texture allocation exceeds limit');
      group.add(root);
      options.contact(options.fallbackContact());
      group.userData.runtimeStatus = 'ready'; group.userData.runtimeTier = 'near'; delete group.userData.runtimeError;
      forget = kit.onDispose(dispose);
      if (place && Object.hasOwn(place.manifest.venues, value.recipe.venue)) void showPlace(place);
      return Promise.resolve(owner);
    } catch (error) { dispose(); throw error; }
  }, { solids: createRuntimeHost.solids, support: createRuntimeHost.support, validate: createRuntimeHost.validate, measure: createRuntimeHost.measure });
  return start;
}
