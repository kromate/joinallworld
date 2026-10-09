import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createKit } from './kit.ts';
import { buildVenueScene } from './venue-scenes.ts';
import { loadCityContent } from '../game/cities/registry.ts';

await loadCityContent('lagos');

function solidTop(entry: ReturnType<typeof buildVenueScene>, x: number, z: number, minY = -0.1, maxY = 2): number | null {
  entry.group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(x, maxY + 1, z), new THREE.Vector3(0, -1, 0), 0, maxY + 1 - minY);
  const hit = ray.intersectObjects(entry.group.children, true).find((item) =>
    item.object instanceof THREE.Mesh && (item.object.name === 'solid' || item.object.name.startsWith('solid@')) && item.point.y >= minY && item.point.y <= maxY,
  );
  return hit?.point.y ?? null;
}

test('flat venue contact follows the rendered ground top and refuses unsupported or mismatched samples', () => {
  const kit = createKit();
  const entry = buildVenueScene(kit, { id: 'contact-park', scene: { kind: 'park' } });
  try {
    const top = solidTop(entry, 12, 10, -0.06, 0.08);
    assert.ok(top !== null, 'the test point has a rendered ground face');
    assert.equal(entry.walk.contactHeightAt!(12, 10, 0), top! + 0.016);
    assert.equal(entry.walk.contactHeightAt!(12, 10, 0.8), top! + 0.016,
      'an elevated swing sole keeps the known support so the unchanged solver can preserve it');
    assert.equal(entry.walk.contactHeightAt!(12, 10, top! - 0.2), null,
      'a sole buried farther below the support than the correction envelope is unsupported');
    assert.equal(entry.walk.contactHeightAt!(30, 30, 0), null, 'a point beyond the recorded floor has no support');
  } finally {
    entry.dispose();
    kit.dispose();
  }
});

test('declared decks must agree with their rendered solid top', () => {
  const kit = createKit();
  const church = buildVenueScene(kit, { id: 'contact-church', scene: { kind: 'worship', variant: 'church' } });
  const hub = buildVenueScene(kit, { id: 'contact-hub', scene: { kind: 'hub' } });
  const statehouse = buildVenueScene(kit, { id: 'contact-statehouse', scene: { kind: 'statehouse' } });
  try {
    const chancelTop = solidTop(church, 6, -7, 0.49, 0.51);
    assert.ok(chancelTop !== null, 'the church has a drawn chancel at the declared height');
    assert.equal(church.walk.contactHeightAt!(6, -7, 0.5), chancelTop! + 0.016);

    const hubTop = solidTop(hub, 8.5, -9.3, 0.29, 0.31);
    assert.ok(hubTop !== null, 'the pitch has a real platform top');
    assert.equal(hub.walk.contactHeightAt!(8.5, -9.3, 0.3), hubTop! + 0.016);

    // Statehouse metadata declares the portico at 0.83, while its landing box is authored
    // with a top of 0.8. Do not silently treat the visible but mismatched surface as that deck.
    const porticoTop = solidTop(statehouse, 0, -7.2, 0.79, 0.81);
    assert.ok(porticoTop !== null, 'the portico has a rendered top at its authored height');
    assert.equal(statehouse.walk.contactHeightAt!(0, -7.2, 0.8), null, 'declared and rendered deck heights disagree');
  } finally {
    church.dispose();
    hub.dispose();
    statehouse.dispose();
    kit.dispose();
  }
});

test('declared ramps and released scenes never retain contact support', () => {
  const kit = createKit();
  const park = buildVenueScene(kit, { id: 'contact-ramp', scene: { kind: 'park' } });
  const walk = buildVenueScene(kit, { id: 'contact-walk', scene: { kind: 'walk' } });
  const floorPoint = [12, 10] as const;
  assert.notEqual(park.walk.contactHeightAt!(floorPoint[0], floorPoint[1], 0), null);
  assert.equal(walk.walk.contactHeightAt!(-8, 9, 0), null, 'the forest trail stairs are a declared ramp corridor');
  park.dispose();
  walk.dispose();
  assert.equal(park.walk.contactHeightAt!(floorPoint[0], floorPoint[1], 0), null, 'release clears the geometry index');
  kit.dispose();
});
