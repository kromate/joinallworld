import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createKit } from './kit.ts';
import { buildNeighbourhoodScene } from './neighbourhood-scene.ts';
import { packStyle } from '../game/content/world.ts';
import { loadCityContent } from '../game/cities/registry.ts';
import { createLife } from '../life.ts';
import { rowX } from '../game/neighbourhood-space.ts';
import type { WorldStreetResponse } from '../types/world.ts';

await loadCityContent('lagos');

test('multi-storey front openings preserve the door approach and render windows on every floor', () => {
  const kit = createKit();
  const scene = buildNeighbourhoodScene(kit);
  try {
    const style = packStyle({ shape: 0, wall: 2, roof: 0, door: 0, windows: 2, fence: 1, yard: 0, sign: 0 }, 'villa');
    const street: WorldStreetResponse = {
      city: 'lagos', anchor: { lga: 'kosofe', estate: 0, plot: 35 },
      street: { city: 'lagos', lga: 'kosofe', estate: 0, row: 2 },
      houses: [{ plot: 35, style, upgradeAt: 0, you: true }],
    };
    scene.setStreet(street);
    const x = rowX(35);
    assert.equal(scene.walk?.grid.free(x, -3.25), true, 'the approach to the canonical door stays walkable');

    let solid: import('three').Mesh | undefined;
    scene.group.traverse(child => { if (child.name === 'solid' && !solid) solid = child as import('three').Mesh; });
    assert.ok(solid, 'the neighbourhood solid batch exists');
    const position = solid.geometry.getAttribute('position');
    const front = -7.15, wallFace = front + 0.12, paneFace = front + 0.035;
    const onPlane = (z: number, y0: number, y1: number, x0: number, x1: number) => {
      const found = new Set<number>();
      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i), y = position.getY(i), pz = position.getZ(i);
        if (Math.abs(pz - z) < 0.002 && x > x0 && x < x1 && y > y0 && y < y1) found.add(Math.round(y * 100));
      }
      return found;
    };
    const doorWallYs = onPlane(wallFace, 0.05, 2.4, x - 0.77, x + 0.77);
    assert.equal(doorWallYs.size, 0, 'the upper door wall is not emitted twice over the window-grid wall');

    const capTop = 10.2 + 1.25 - 0.04;
    const hasCapPoint = (pointX: number, pointY: number, z: number) => {
      for (let i = 0; i < position.count; i++) {
        if (Math.abs(position.getX(i) - pointX) < 0.002 && Math.abs(position.getY(i) - pointY) < 0.002 && Math.abs(position.getZ(i) - z) < 0.002) return true;
      }
      return false;
    };
    const capWidth = 8.8 + 0.5 - 0.04;
    for (const z of [front + 0.12, front - 6.1 - 0.12]) {
      assert.ok(hasCapPoint(x, capTop, z), `gable apex closes at end z=${z.toFixed(2)}`);
      assert.ok(hasCapPoint(x - capWidth / 2, 10.2, z) && hasCapPoint(x + capWidth / 2, 10.2, z), `both eave corners close across the house at end z=${z.toFixed(2)}`);
    }

    const paneYs = onPlane(paneFace, 1.7, 9.2, x - 3.4, x + 3.4);
    for (const [bottom, top] of [[1.775, 2.925], [4.55, 5.75], [7.95, 9.15]]) {
      assert.ok([...paneYs].some(y => y / 100 > bottom && y / 100 < top), `window pane exists on floor y=${bottom.toFixed(2)}..${top.toFixed(2)}`);
    }
    for (const [bottom, top] of [[1.77, 2.93], [4.55, 5.75], [7.95, 9.15]]) {
      let sidePanes = 0;
      let blockedSideWallVertices = 0;
      for (let i = 0; i < position.count; i++) {
        const px = position.getX(i), py = position.getY(i), pz = position.getZ(i);
        if (py > bottom && py < top && Math.abs(pz + 10.2) < 0.7 && (Math.abs(px - (x - 4.435)) < 0.002 || Math.abs(px - (x + 4.435)) < 0.002)) sidePanes++;
        if (py > bottom && py < top && Math.abs(pz + 10.2) < 0.002 && (Math.abs(px - (x - 4.52)) < 0.002 || Math.abs(px - (x + 4.52)) < 0.002)) blockedSideWallVertices++;
      }
      assert.equal(sidePanes, 8, `one side window pane is cut and glazed on each wall at floor y=${bottom.toFixed(2)}..${top.toFixed(2)}`);
      assert.equal(blockedSideWallVertices, 0, `the side-wall openings are real gaps, not panes laid over solid walls at y=${bottom.toFixed(2)}..${top.toFixed(2)}`);
    }

    const cornerRay = new THREE.Raycaster();
    const coveredCorner = (origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number, label: string) => {
      cornerRay.set(origin, direction);
      const hit = cornerRay.intersectObject(solid!, false)[0];
      assert.ok(hit && hit.distance < maxDistance, `${label} has a frame-covered opening corner, got ${hit?.distance ?? 'no hit'}`);
    };
    for (let floor = 0; floor < 3; floor++) {
      const y = floor === 0 ? 2.35 : floor * 3.4 + 1.75, h = floor === 0 ? 1.15 : 1.2;
      for (const side of [-1, 1]) {
        const cx = x + side * (floor === 0 ? 2.55 : 2.2);
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
          coveredCorner(new THREE.Vector3(cx + sx * (1.6 / 2 - 0.11), y + sy * (h / 2 - 0.11), 0), new THREE.Vector3(0, 0, -1), 7.05, `front window floor ${floor} corner ${sx}/${sy}`);
        }
      }
      const z = -10.2, w = 1.35;
      for (const side of [-1, 1]) for (const sz of [-1, 1]) for (const sy of [-1, 1]) {
        coveredCorner(new THREE.Vector3(x + side * 10, y + sy * (h / 2 - 0.11), z + sz * (w / 2 - 0.11)), new THREE.Vector3(-side, 0, 0), 5.5, `side window floor ${floor} corner ${sz}/${sy}`);
      }
    }
  } finally {
    scene.dispose?.(); kit.dispose();
  }
});

test('hip roof panels cover the rectangular eave corners and meet at one centered apex', () => {
  const kit = createKit(), scene = buildNeighbourhoodScene(kit);
  try {
    const style = packStyle({ shape: 1, wall: 2, roof: 0, door: 0, windows: 0, fence: 1, yard: 0, sign: 0 }, 'starter');
    scene.setStreet({
      city: 'lagos', anchor: { lga: 'kosofe', estate: 0, plot: 35 },
      street: { city: 'lagos', lga: 'kosofe', estate: 0, row: 2 },
      houses: [{ plot: 35, style, upgradeAt: 0, you: true }],
    });
    let solid: import('three').Mesh | undefined;
    scene.group.traverse(child => { if (child.name === 'solid' && !solid) solid = child as import('three').Mesh; });
    assert.ok(solid, 'the neighbourhood solid batch exists');
    const position = solid.geometry.getAttribute('position'), x = rowX(35), roofZ = -10.2;
    const hasPoint = (px: number, py: number, pz: number) => {
      for (let i = 0; i < position.count; i++) {
        if (Math.abs(position.getX(i) - px) < 0.003 && Math.abs(position.getY(i) - py) < 0.003 && Math.abs(position.getZ(i) - pz) < 0.003) return true;
      }
      return false;
    };
    for (const dx of [-4.65, 4.65]) for (const dz of [-3.3, 3.3]) {
      assert.ok(hasPoint(x + dx, 3.4, roofZ + dz), `hip eave covers rectangular roof corner (${dx}, ${dz})`);
    }
    assert.ok(hasPoint(x, 3.4 + 1.05, roofZ), 'all four roof faces meet at the centered hip apex');
    const colors = solid.geometry.getAttribute('color'), roofColor = new THREE.Color('#a85c40');
    for (let i = 0; i < position.count; i++) {
      if (Math.abs(colors.getX(i) - roofColor.r) < 0.003 && Math.abs(colors.getY(i) - roofColor.g) < 0.003 && Math.abs(colors.getZ(i) - roofColor.b) < 0.003) {
        assert.ok(Math.abs(position.getX(i) - x) <= 4.653 && Math.abs(position.getZ(i) - roofZ) <= 3.303, 'hip roof vertices stay inside its axis-aligned rectangular eaves');
      }
    }
    const raycaster = new THREE.Raycaster(), roofSamples = [
      [-0.65, -0.2], [-0.65, 0.2], [0.65, -0.2], [0.65, 0.2],
      [-0.2, -0.65], [-0.2, 0.65], [0.2, -0.65], [0.2, 0.65],
    ];
    for (const [nx, nz] of roofSamples) {
      raycaster.set(new THREE.Vector3(x + nx! * 4.65, 10, roofZ + nz! * 3.3), new THREE.Vector3(0, -1, 0));
      const hit = raycaster.intersectObject(solid, false)[0];
      assert.ok(hit && hit.point.y > 3.4, `downward ray at roof quadrant ${nx},${nz} hits above the wall top`);
      const face = hit.face!, ids = [face.a, face.b, face.c], rgb = ids.map(id => [colors.getX(id), colors.getY(id), colors.getZ(id)]);
      assert.ok(rgb.every(value => Math.abs(value[0]! - roofColor.r) < 0.003 && Math.abs(value[1]! - roofColor.g) < 0.003 && Math.abs(value[2]! - roofColor.b) < 0.003), `first hit at ${nx},${nz} is roof material, not an exposed wall wedge`);
    }
    assert.equal(scene.walk?.grid.free(x, -3.25), true, 'the canonical door approach remains walkable');
  } finally {
    scene.dispose?.(); kit.dispose();
  }
});

test('warm-light house windows brighten at night through the existing glow batch', () => {
  const kit = createKit(), scene = buildNeighbourhoodScene(kit);
  try {
    const style = packStyle({ shape: 0, wall: 2, roof: 0, door: 0, windows: 1, fence: 1, yard: 0, sign: 0 }, 'starter');
    scene.setStreet({
      city: 'lagos', anchor: { lga: 'kosofe', estate: 0, plot: 35 },
      street: { city: 'lagos', lga: 'kosofe', estate: 0, row: 2 },
      houses: [{ plot: 35, style, upgradeAt: 0, you: true }],
    });
    const life = createLife({ location: 'home' }, { now: Date.UTC(2026, 0, 5, 12), cityId: 'lagos' });
    const meanWarmWindow = () => {
      let glow: import('three').Mesh | undefined;
      scene.group.traverse(child => { if (child.name === 'glow' && !glow) glow = child as import('three').Mesh; });
      assert.ok(glow, 'warm-window glow shares the existing batched emissive mesh');
      const position = glow.geometry.getAttribute('position'), colors = glow.geometry.getAttribute('color');
      const hits: number[] = [];
      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
        if (Math.abs(z + 7.095) < 0.002 && y > 1.8 && y < 2.9 && (Math.abs(x - (rowX(35) - 2.55)) < 0.7 || Math.abs(x - (rowX(35) + 2.55)) < 0.7)) hits.push(colors.getY(i));
      }
      assert.equal(hits.length, 8, 'both front warm windows have emissive overlay vertices');
      return hits.reduce((sum, value) => sum + value, 0) / hits.length;
    };
    scene.update?.({ ...life, t: Date.UTC(2026, 0, 5, 12) });
    const day = meanWarmWindow();
    scene.update?.({ ...life, t: Date.UTC(2026, 0, 5, 20) });
    const night = meanWarmWindow();
    assert.ok(night > day * 3, `warm windows brighten after dark (${day.toFixed(3)} → ${night.toFixed(3)})`);
  } finally {
    scene.dispose?.(); kit.dispose();
  }
});
