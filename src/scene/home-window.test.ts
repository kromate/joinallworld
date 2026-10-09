import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadCityContent } from '../game/cities/registry.ts';
import { createLife } from '../life.ts';
import { buildHomeScene } from './home-scene.ts';
import { createKit } from './kit.ts';

await loadCityContent('lagos');

for (const tier of ['starter', 'duplex', 'villa'] as const) {
  test(`${tier} home windows transmit sight through the rear wall while preserving its edges and cutaway`, () => {
    const kit = createKit(), home = buildHomeScene(kit);
    try {
      const state = createLife({ location: 'home' }, { now: Date.UTC(2026, 0, 5, 11), cityId: 'lagos' });
      state.estate.living = 'own'; state.estate.tier = tier;
      home.update(state); home.look(0, 0);
      home.group.updateMatrixWorld(true);
      const panes: THREE.Mesh[] = [], walls: THREE.Mesh[] = [];
      home.group.traverse(child => {
        if (!(child instanceof THREE.Mesh) || !/^f\d+-back$/.test(String(child.userData.part))) return;
        if (child.name.startsWith('home-room-glass@')) panes.push(child);
        if (child.name.startsWith('home-room-solid@')) walls.push(child);
      });
      assert.equal(panes.length, tier === 'villa' ? home.floors - 1 : home.floors, 'each enclosed floor has a pane; the open terrace does not');
      const ray = new THREE.Raycaster(); ray.far = 2;
      for (const pane of panes) {
        assert.ok((pane.material as THREE.Material).transparent, 'glass uses the shared transparent material');
        pane.geometry.computeBoundingBox();
        const bounds = pane.geometry.boundingBox!, centre = bounds.getCenter(new THREE.Vector3());
        const width = bounds.max.x - bounds.min.x;
        const wall = walls.find(mesh => mesh.userData.part === pane.userData.part)!;
        assert.ok(wall);
        // Trace both lights of the window from outside, avoiding its centre mullion.
        for (const side of [-1, 1]) {
          const origin = new THREE.Vector3(centre.x + side * width / 4, centre.y, centre.z - 1).applyMatrix4(pane.matrixWorld);
          ray.set(origin, new THREE.Vector3(0, 0, 1));
          assert.ok(ray.intersectObject(pane, false).length, 'the sight line crosses the glass');
          assert.equal(ray.intersectObject(wall, false).length, 0, 'opaque wall or frame cannot cover the window light');
          const edge = new THREE.Vector3(centre.x + side * (width / 2 + 0.2), centre.y, centre.z - 1).applyMatrix4(pane.matrixWorld);
          ray.set(edge, new THREE.Vector3(0, 0, 1));
          assert.ok(ray.intersectObject(wall, false).length, 'wall remains closed immediately beside the opening');
        }
      }
      assert.ok(home.walk.grid!.free(home.walk.entrance.x, home.walk.entrance.z), 'the door approach remains walkable');
      home.look(0, -20);
      for (const pane of panes.filter(mesh => mesh.userData.part === 'f0-back')) assert.equal(pane.visible, false, 'glass hides with the rear wall during cutaway');
      home.look(0, 0);
      for (const pane of panes.filter(mesh => mesh.userData.part === 'f0-back')) assert.equal(pane.visible, true, 'glass returns when the rear wall returns');
    } finally { home.dispose(); kit.dispose(); }
  });
}
