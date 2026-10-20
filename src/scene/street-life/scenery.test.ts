// Street life's scenery: shopfronts on the street's own buildings (./shopfronts.ts), furniture along the far kerb (./furniture.ts), as
// instanced parts (./parts.ts) drawn in four meshes (./scenery.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createKit } from '../kit.ts';
import { boxOf } from '../street/street-kit.ts';
import { Z, planStreet } from '../street/street-plan.ts';
import { ROW_HALF_WIDTH } from '../../game/neighbourhood-space.ts';
import { ATLAS_SIZE, BLOB_TRIANGLES, BOX_TRIANGLES, FLAG_CELL, FIRST_MANNEQUIN, MANNEQUIN_CELLS, SIGN_CELLS, atlasRect, atlasUv, partCalls, partTriangles } from './parts.ts';
import { BAY_MIN, SHOP_ASSETS, SHOP_NAMES, frontagesOf, planShopfronts, shopParts } from './shopfronts.ts';
import type { Frontage } from './shopfronts.ts';
import { ALLWORLD_FLAG, FLAGS, SLOT_CLEAR, flagFor, planFurniture, furnitureParts } from './furniture.ts';
import type { CrossingSpec, FurnitureInput } from './furniture.ts';
import { DAY_LIGHT, createStreetScenery, planScenery } from './scenery.ts';
import { emittersFor } from '../street/night-lights.ts';
import { loadCityContent } from '../../game/cities/registry.ts';
import { createLife } from '../../life.ts';
import { buildNeighbourhoodScene } from '../neighbourhood-scene.ts';

const street = planStreet({ houses: [{ x: 6, plot: 7, tier: 'bungalow', wall: 1, roof: 1, door: 0, fence: 1, yard: 0, land: [], own: true }], seed: 'ikeja/0/3', mix: { buildings: ['bank', 'clinic', 'shoprow', 'school'], flats: true } });
const crossings: CrossingSpec[] = [{ x: 78, z0: Z.kerb, z1: Z.farKerb, paint: false }, { x: 10, z0: Z.kerb, z1: Z.farKerb, paint: true }];
const avoid = street.pieces.filter((p) => p.z > Z.farKerb && p.z < Z.farFront + 3).map((p) => ({ x: p.x, z: p.z, r: 1.6 }));
const furniture: Omit<FurnitureInput, 'seed'> = { half: ROW_HALF_WIDTH, lineZ: Z.farKerb + 0.45, road: -1, base: 0.05, crossings, avoid, flagX: 68 };

test('frontages: every shop building the street placed, its front plane and width, facing the road; never overlapping', () => {
  const fronts = frontagesOf(street.pieces, boxOf);
  const shops = street.pieces.filter((p) => SHOP_ASSETS.has(p.asset) && (p.role === 'far' || p.role === 'building'));
  assert.ok(fronts.length > 0 && fronts.length <= shops.length);
  for (const f of fronts) {
    assert.ok(f.x1 > f.x0 && f.height > 0);
    if (f.facing === -1) assert.ok(f.z >= Z.farFront - 0.01 && f.z <= Z.farFront + 0.5, `across the road, front on the far pavement: ${f.z}`);
    else assert.ok(Math.abs(f.z - Z.front) < 0.01, `a vacant plot's building, front on the plots' front plane: ${f.z}`);
  }
  for (const a of fronts) for (const b of fronts) if (a !== b && a.facing === b.facing && Math.abs(a.z - b.z) < 0.6) assert.ok(a.x1 <= b.x0 + 1e-9 || b.x1 <= a.x0 + 1e-9, 'no overlap');
  const turned = frontagesOf([{ id: 'r', asset: 'bank', x: 0, z: 0, ry: Math.PI / 2, scale: 1, role: 'far' }, { id: 'h', asset: 'bungalow', x: 0, z: 0, ry: 0, scale: 1, role: 'house' }], boxOf);
  assert.equal(turned.length, 0, 'side-on buildings and homes get none');
});

test('bays: inside their frontage, wide enough, plain shop names (no trade marks) that fit the sign cells, the same every time', () => {
  const fronts = frontagesOf(street.pieces, boxOf), bays = planShopfronts(fronts, 's');
  assert.deepEqual(planShopfronts(fronts, 's'), bays);
  assert.ok(bays.length >= fronts.length);
  for (const bay of bays) {
    assert.ok(bay.width >= BAY_MIN);
    assert.ok(fronts.some((f) => f.facing === bay.facing && f.z === bay.z && bay.x - bay.width / 2 >= f.x0 - 1e-9 && bay.x + bay.width / 2 <= f.x1 + 1e-9));
  }
  assert.ok(SHOP_NAMES.length <= SIGN_CELLS);
  for (const shop of SHOP_NAMES) assert.match(shop.name, /^[A-ZÉ &]+$/, 'a plain word for what the shop sells');
  assert.equal(planShopfronts([{ id: 'thin', x0: 0, x1: 2, z: 0, facing: 1, height: 4 }], 's').length, 0, 'too narrow for a shop');
});

test('shop parts: proud of the wall on the street side, a lit window and a sign per bay, mannequins only in clothes shops', () => {
  const front: Frontage = { id: 'f', x0: -10, x1: 10, z: 14.5, facing: -1, height: 5 };
  const bays = planShopfronts([front], 'p'), parts = shopParts(bays);
  assert.equal(parts.glows.length, bays.length);
  assert.equal(parts.quads.filter((q) => q.cell < SIGN_CELLS).length, bays.length);
  const mannequins = parts.quads.filter((q) => q.cell >= FIRST_MANNEQUIN && q.cell < FIRST_MANNEQUIN + MANNEQUIN_CELLS).length;
  assert.equal(mannequins, bays.reduce((n, bay) => n + SHOP_NAMES[bay.shop]!.mannequins, 0));
  for (const part of [...parts.boxes, ...parts.glows, ...parts.quads]) assert.ok(part.z <= 14.5 && part.z > 14.5 - 1.6, 'between the wall and the awning\'s edge');
  for (const q of parts.quads) assert.ok(Math.abs(q.x) <= 10, 'within the frontage');
});

test('furniture: off what stands there, off the crossings, off the walking lanes; one flag; bollards at every crossing; stripes only where ours', () => {
  const items = planFurniture({ ...furniture, seed: 'f' });
  const kinds = new Set(items.map((i) => i.kind));
  for (const kind of ['lamp', 'tree', 'bench', 'bin', 'flag', 'bollard']) assert.ok(kinds.has(kind as never), kind);
  assert.equal(items.filter((i) => i.kind === 'flag').length, 1);
  const line = items.filter((i) => i.kind !== 'bollard');
  for (const item of line) {
    for (const a of avoid) assert.ok(Math.hypot(a.x - item.x, a.z - item.z) >= a.r + SLOT_CLEAR - 1e-9, `${item.kind} at ${item.x} clear of what is there`);
    for (const c of crossings) assert.ok(Math.abs(c.x - item.x) >= 2.6);
    assert.ok(item.z > Z.farKerb && item.z < Z.farKerb + 1.0, 'on the kerb line, short of the pavement lanes (12.3 ± 0.55)');
    assert.ok(Math.abs(item.x) <= ROW_HALF_WIDTH);
  }
  assert.equal(items.filter((i) => i.kind === 'bollard').length, crossings.length * 4);
  const parts = furnitureParts(items, crossings, -1, 'f');
  const stripes = parts.boxes.filter((b) => b.y < 0.02);
  assert.ok(stripes.length > 0 && stripes.every((b) => b.x === 10 && b.z > Z.road0 && b.z < Z.road1), 'stripes on the road at the crossing street life paints');
  assert.equal(parts.quads.filter((q) => q.cell === FLAG_CELL).length, 1);
});

test('flags: simple ones by country, the Allworld banner otherwise', () => {
  assert.deepEqual(flagFor('ng').bands, ['#008751', '#ffffff', '#008751']);
  assert.equal(flagFor('ng').vertical, true);
  assert.equal(flagFor('jp').disc, '#bc002d');
  assert.equal(flagFor('gb'), ALLWORLD_FLAG);
  assert.equal(flagFor(null), ALLWORLD_FLAG);
  for (const flag of Object.values(FLAGS)) assert.ok(flag.bands.length >= 1 && flag.bands.every((c) => /^#[0-9a-f]{6}$/.test(c)));
});

test('the atlas: every cell on the canvas, none overlapping; uv offsets and scales match', () => {
  const cells = Array.from({ length: FLAG_CELL + 1 }, (_, i) => atlasRect(i));
  for (const r of cells) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= ATLAS_SIZE && r.y + r.h <= ATLAS_SIZE);
  for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
    const a = cells[i]!, b = cells[j]!;
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `cells ${i} and ${j}`);
  }
  assert.deepEqual(atlasUv(0), [0, 1 - 64 / 1024, 0.5, 64 / 1024]);
});

test('drawn: four instanced meshes (one draw call each), the triangles the plan counts, the windows lit by the time of day, gone with dispose', () => {
  const kit = createKit(), parent = new THREE.Group();
  const frontages = frontagesOf(street.pieces, boxOf);
  const plan = planScenery(frontages, furniture, 'd');
  const scenery = createStreetScenery(kit, { parent, frontages, furniture, seed: 'd', country: 'ng', light: DAY_LIGHT });
  const meshes = scenery.group.children as THREE.InstancedMesh[];
  assert.equal(meshes.length, 4);
  assert.ok(meshes.every((m) => m.isInstancedMesh && !m.castShadow));
  assert.equal(scenery.drawCalls, partCalls(plan.parts));
  assert.equal(scenery.triangles, partTriangles(plan.parts));
  assert.equal(meshes.reduce((n, m) => n + m.count * (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3, 0), scenery.triangles);
  assert.ok(scenery.triangles < 8_000, `a light dressing: ${scenery.triangles} triangles`);
  assert.equal(BOX_TRIANGLES, 12); assert.equal(BLOB_TRIANGLES, 20);
  assert.ok(scenery.bays > 0 && scenery.items > 0);
  const glass = meshes.find((m) => m.name === 'street-scenery-glow')!, shader = { uniforms: {} as Record<string, { value: number }>, vertexShader: '#include <common>', fragmentShader: '#include <common>\n#include <emissivemap_fragment>' };
  (glass.material as THREE.Material).onBeforeCompile(shader as never, null as never);
  assert.equal(shader.uniforms.uGlow!.value, DAY_LIGHT.glass);
  const night = emittersFor({ band: 'night', minuteOfDay: 1260, outage: false, high: false }), cut = emittersFor({ band: 'night', minuteOfDay: 1260, outage: true, high: false });
  scenery.setLight(night);
  assert.equal(shader.uniforms.uGlow!.value, night.glass);
  assert.equal(shader.uniforms.uShare!.value, night.share);
  assert.equal(shader.uniforms.uPower!.value, 1);
  scenery.setLight(cut);
  assert.equal(shader.uniforms.uPower!.value, 0, 'a power cut reaches the glass');
  // Every glass instance has a shop draw and a generator flag; the lamp heads are marked with a draw below zero (always lit with power).
  const shop = glass.geometry.getAttribute('aShop') as THREE.InstancedBufferAttribute;
  assert.equal(shop.count, plan.parts.glows.length);
  plan.parts.glows.forEach((b, i) => assert.equal(shop.getX(i) < 0, b.bay === undefined, 'a lamp head has no bay'));
  // The ground pools: one under each lamp and one before each shop, none of them a mesh of the scenery's own (the street makes one mesh for all).
  assert.equal(scenery.pools.length, plan.items.filter((item) => item.kind === 'lamp').length + plan.bays.length);
  assert.equal(scenery.group.children.length, 4);
  scenery.dispose();
  assert.equal(parent.children.length, 0);
  assert.equal(scenery.triangles, 0);
  kit.dispose();
});

test('the home street with ?streetlife=on: its shops and furniture, the crowd and a Nigerian street\'s traffic with lights; it moves in its window and goes with the scene', async () => {
  const browser = globalThis as unknown as Record<string, unknown>, had = browser.location;
  browser.location = { search: '?streetlife=on' };
  try {
    await loadCityContent('lagos');
    const kit = createKit(), street = buildNeighbourhoodScene(kit);
    street.update?.(createLife({ location: 'home' }, { cityId: 'lagos', now: Date.UTC(2026, 0, 5, 12) }));
    let changed = 0;
    street.startCrowd?.({ getContext: () => null } as never, () => { changed += 1; });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const named = (name: string) => street.group.children.find((child) => child.name === name);
    const dressing = named('street-scenery'), life = named('street-life');
    assert.ok(dressing && life && changed > 0, 'both arrived and the scene was told to draw again');
    assert.equal(dressing!.children.length, 4, 'four draw calls of scenery');
    const traffic = life!.children.find((child) => child.name === 'street-traffic') as THREE.InstancedMesh;
    assert.ok(traffic && traffic.geometry.getAttribute('aTrim'), 'liveried traffic');
    assert.equal(street.ambientAwake, true);
    for (let i = 0; i < 10; i++) assert.equal(street.stepAmbient?.(1 / 60), true);
    street.dispose?.();
    assert.equal(named('street-scenery'), undefined);
    assert.equal(named('street-life'), undefined);
    kit.dispose();
  } finally { browser.location = had; }
});

test('the home street at night: one pool mesh for the lamps (none on the phone tier), lamps dark in a power cut, windows lit by the hour', async () => {
  const browser = globalThis as unknown as Record<string, unknown>, had = browser.location;
  const at = Date.UTC(2026, 0, 5, 20, 0);   // 21:00 in Lagos
  const build = async (search: string) => {
    browser.location = { search };
    await loadCityContent('lagos');
    const kit = createKit(), street = buildNeighbourhoodScene(kit);
    street.update?.(createLife({ location: 'home' }, { cityId: 'lagos', now: at }));
    return { kit, street };
  };
  try {
    const high = await build('?quality=high'), pools = high.street.group.children.filter((child) => child.name === 'street-light-pools');
    assert.equal(pools.length, 1, 'one draw call for every lamp\'s pool'); assert.ok((pools[0] as THREE.InstancedMesh).count >= 3 && pools[0]!.visible);
    const lamps = (g: THREE.Object3D) => { const found: THREE.PointLight[] = []; g.traverse((o) => { if ((o as THREE.PointLight).isPointLight) found.push(o as THREE.PointLight); }); return found; };
    assert.ok(lamps(high.street.group).length > 0 && lamps(high.street.group).every((l) => l.intensity > 0), 'the lamps are on');
    high.street.dispose?.(); high.kit.dispose();
    const cut = await build('?quality=high&outage=1');
    assert.ok(lamps(cut.street.group).every((l) => l.intensity === 0), 'a power cut puts the lamps out');
    cut.street.dispose?.(); cut.kit.dispose();
    const phone = await build('?quality=phone');
    assert.equal(phone.street.group.children.filter((child) => child.name === 'street-light-pools').length, 0, 'the phone tier draws no extra mesh: its pools stay discs in the glow batch');
    phone.street.dispose?.(); phone.kit.dispose();
  } finally { browser.location = had; }
});
