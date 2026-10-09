import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCityContent } from '../game/cities/registry.ts';
import { createLife } from '../life.ts';
import { buildHomeScene } from './home-scene.ts';
import { createKit } from './kit.ts';

await loadCityContent('lagos');

test('starter kitchen appliances stay within their floor placements and one furniture batch', () => {
  const kit = createKit(), home = buildHomeScene(kit);
  try {
    const items = [
      { id: 'review-drum', itemId: 'water-drum', x: 0, y: 0, rot: 0 },
      { id: 'review-cooker', itemId: 'gas-cooker', x: 2, y: 0, rot: 0 },
      { id: 'review-fridge', itemId: 'fridge', x: 4, y: 0, rot: 0 },
    ];
    const state = createLife({ location: 'home', home: { custom: true, items } }, { now: Date.UTC(2026, 0, 5, 11), cityId: 'lagos' });
    home.update(state);
    const objects = home.objects();
    assert.deepEqual(objects.map((object) => object.itemId), ['water-drum', 'gas-cooker', 'fridge']);
    assert.equal(objects.length, 3);
    const grid = home.walk.grid!;
    assert.ok(grid.free(home.walk.entrance.x, home.walk.entrance.z), 'the canonical entrance remains clear');
    for (const object of objects) assert.equal(grid.free(object.x, object.z), false, `${object.itemId} retains its collision footprint`);
    const furnitureMeshes: unknown[] = [];
    home.group.traverse((child) => { if ((child as { isMesh?: boolean; name?: string }).isMesh && child.name?.startsWith('home-furniture-')) furnitureMeshes.push(child); });
    assert.equal(furnitureMeshes.length, 1, 'all three appliances remain in the single existing furniture draw batch');
  } finally {
    home.dispose(); kit.dispose();
  }
});
