import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { HIGH_BOOST, bayLights, buildingSeed, emittersFor, floorLit, windowShare } from './night-lights.ts';
import { createLightPools, lampPool } from './light-pools.ts';
import { WET_DARKEN, makeWetGround } from './wet-ground.ts';
import { createKit } from '../kit.ts';

test('more windows are lit in the early evening than at 3 am, and the share stays between 0 and 1 round the clock', () => {
  assert.ok(windowShare(19 * 60) > 0.8, 'early evening');
  assert.ok(windowShare(3 * 60) < 0.15, 'three in the morning');
  assert.ok(windowShare(19 * 60) > windowShare(23 * 60) && windowShare(23 * 60) > windowShare(3 * 60));
  for (let m = -30; m < 1500; m += 7) { const s = windowShare(m); assert.ok(s >= 0 && s <= 1, `minute ${m}`); }
  assert.equal(windowShare(Number.NaN), windowShare(0));
});

test('emitters follow the band, the power cut and the tier', () => {
  const dusk = emittersFor({ band: 'dusk', minuteOfDay: 1110, outage: false, high: false }), night = emittersFor({ band: 'night', minuteOfDay: 1260, outage: false, high: false });
  const day = emittersFor({ band: 'day', minuteOfDay: 720, outage: false, high: false });
  assert.ok(day.glass < dusk.glass && dusk.glass < night.glass && day.pool === 0 && day.share === 0 && day.sign === 0);
  const high = emittersFor({ band: 'night', minuteOfDay: 1260, outage: false, high: true });
  assert.equal(high.glass, night.glass * HIGH_BOOST, 'the high tier is brighter than the screen holds: bloom finds it');
  assert.equal(emittersFor({ band: 'day', minuteOfDay: 720, outage: false, high: true }).glass, day.glass, 'no boost by day');
  assert.equal(night.power, 1);
  assert.equal(emittersFor({ band: 'night', minuteOfDay: 1260, outage: true, high: false }).power, 0, 'a power cut darkens the street');
});

test('who is lit comes from the seed and is the same every time; a share of the shops run a generator', () => {
  const a = bayLights(40, 'agege/3'), b = bayLights(40, 'agege/3'), c = bayLights(40, 'other');
  assert.deepEqual(a, b); assert.notDeepEqual(a.seeds, c.seeds);
  assert.ok(a.seeds.every((s) => s >= 0 && s < 1));
  const gen = a.generators.filter(Boolean).length;
  assert.ok(gen > 2 && gen < 25, `a few of forty shops have a generator (${gen})`);
  assert.equal(buildingSeed(12.3, -4), buildingSeed(12.3, -4));
  assert.notEqual(buildingSeed(12.3, -4), buildingSeed(24.6, -4));
  // About the share of floors are lit; none in a power cut.
  let lit = 0, total = 0;
  for (let building = 0; building < 60; building++) for (let floor = 0; floor < 3; floor++) { total += 1; if (floorLit(buildingSeed(building * 11.5, 5), floor, 0.5, true)) lit += 1; assert.equal(floorLit(buildingSeed(building * 11.5, 5), floor, 1, false), false); }
  assert.ok(lit / total > 0.3 && lit / total < 0.7, `half the floors lit at a share of 0.5: ${lit / total}`);
});

test('the light pools are one instanced mesh for every lamp and shop, shown only when there is a pool to show', () => {
  const kit = createKit(), parent = new THREE.Group();
  const pools = createLightPools(kit, parent);
  pools.setSource('plan', [lampPool(0, 0), lampPool(10, 0), lampPool(20, 0)]);
  pools.setSource('scenery', [lampPool(5, 12), { x: 8, z: 12, rx: 3, rz: 2, colour: '#ffd59a', strength: 0.5, seed: 0.3, generator: false }]);
  assert.equal(pools.count, 5);
  const meshes = parent.children as THREE.InstancedMesh[];
  assert.equal(meshes.length, 1, 'one draw call');
  assert.equal(meshes[0]!.count, 5);
  assert.equal(meshes[0]!.visible, false, 'day: nothing to show');
  pools.setLevel({ pool: 0.8, share: 0.7, power: 1, wet: false });
  assert.equal(meshes[0]!.visible, true);
  assert.equal((meshes[0]!.material as THREE.Material).blending, THREE.AdditiveBlending);
  assert.equal((meshes[0]!.material as THREE.Material).depthWrite, false);
  pools.setSource('scenery', []);
  assert.equal(pools.count, 3); assert.equal((parent.children[0] as THREE.InstancedMesh).count, 3);
  pools.dispose();
  assert.equal(parent.children.length, 0);
  kit.dispose();
});

test('the wet ground is one uniform on the ground material: darkens, glosses and sheens, chained after an existing patch', () => {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  let host = 0;
  material.onBeforeCompile = () => { host += 1; };
  material.customProgramCacheKey = () => 'host';
  const wet = makeWetGround(THREE, material, [-2, 14]);
  const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <emissivemap_fragment>' };
  material.onBeforeCompile(shader as never, null as never);
  assert.equal(host, 1, 'the host patch still runs');
  assert.equal(material.customProgramCacheKey(), 'host|street-wet-ground-1');
  assert.equal(shader.uniforms.uWet!.value, 0, 'dry to begin with');
  assert.match(shader.fragmentShader, /roughnessFactor = mix\(roughnessFactor, 0\.40/);
  assert.match(shader.fragmentShader, new RegExp(`1\\.0 - ${WET_DARKEN.toFixed(2)} \\* wetMask`));
  assert.match(shader.vertexShader, /vWetUp/);
  wet.setWet(true, '#4466aa');
  assert.equal(shader.uniforms.uWet!.value, 1); assert.equal(wet.wet, true);
  wet.setWet(false);
  assert.equal(shader.uniforms.uWet!.value, 0, 'dry again: everything back');
  material.dispose();
});

test('?outage=1 forces a power cut and ?outage=0 keeps the lights on; no address leaves the grid alone', async () => {
  const { outageFromQuery, withOutageQuery } = await import('../weather-query.ts');
  assert.equal(outageFromQuery('?x=1&outage=1'), true); assert.equal(outageFromQuery('?outage=0'), false); assert.equal(outageFromQuery('?outage=2'), null); assert.equal(outageFromQuery(''), null);
  const look = { outage: false, wet: false };
  assert.equal(withOutageQuery(look, '?outage=1').outage, true);
  assert.equal(withOutageQuery(look, '?post=1'), look, 'the same object when nothing is forced');
});
