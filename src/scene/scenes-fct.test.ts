import { loadCityContent as preloadCityContent } from '../game/cities/registry.ts';
await preloadCityContent('lagos');
// Abuja's scenes: every venue of the city builds headlessly inside the rendering budget with a place for each of its
// spots, and every scene of src/scene/venues-fct.ts is a scene of its own. Nothing here needs WebGL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createKit } from './kit.ts';
import type { SceneVenue } from './types.ts';
import { MAX_CROWD, buildVenueScene } from './venue-scenes.ts';
import { VARIANTS } from './venues-fct.ts';
import { sceneVenue } from '../venue-world.ts';
import { loadAllCityScenes } from './city-scenes.ts';
// Every city's own scenes are a download of their own (src/scene/city-scenes.ts): the tests build all of them.
await loadAllCityScenes();

// The scene and its crowd keep to 15,000; the player's own figure is drawn at medium detail, once, on top.
const TRIANGLE_BUDGET = 15000 + 2000, DRAW_CALL_BUDGET = 60;
const crowd = (count = MAX_CROWD) => Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Player${i}`, kind: i % 3 === 2 ? 'npc' : 'player' }));
const all = (): string[] => Object.entries(VARIANTS).flatMap(([kind, variants]) => Object.keys(variants).map((variant) => `${kind}/${variant}`));
/** The venues that are drawn by a scene of their own, and the ones that keep the scene of their kind. */
const OWN = ['millennium-park', 'national-mosque', 'christian-centre', 'eagle-square', 'arts-village', 'wuse-market', 'garki-market', 'gwagwalada-market', 'national-stadium', 'velodrome', 'children-zoo', 'uniabuja', 'nile-university', 'baze-university', 'idu-station', 'city-gate', 'utako-hub', 'gwarinpa-evening', 'community-house', 'kubwa-garden', 'gwagwalada-garden', 'jabi-lake-park'];
const STOCK = ['airport', 'kubwa-clinic', 'kubwa-kitchen', 'kubwa-salon', 'wuse-savings', 'community-polling'];

test('every Abuja venue builds in budget with its own scene: each spot and game table has a place and a way to it', async () => {
  const content = await preloadCityContent('abuja');
  const kit = createKit();
  const used = new Set<string>(), own: string[] = [], stock: string[] = [];
  const report: string[] = [];
  for (const authored of content.venues) {
    if (authored.kind === 'home') continue;
    const venue = sceneVenue(authored.id, 'abuja') as unknown as SceneVenue;
    const kind = venue.scene!.kind!, variant = venue.scene?.variant;
    if (variant) {
      assert.ok(variant.startsWith('fct-'), `${authored.id}: ${variant} carries the city's prefix`);
      assert.ok(VARIANTS[kind]?.[variant], `${authored.id}: ${kind}/${variant} is a scene of its own`);
      used.add(`${kind}/${variant}`);
      own.push(authored.id);
    } else stock.push(authored.id);
    const entry = buildVenueScene(kit, venue, 'abuja');
    assert.equal(entry.kind, kind);
    entry.setCrowd(crowd());
    const stats = entry.stats();
    report.push(`${authored.id} ${kind}${variant ? `/${variant}` : ''} ${stats.triangles} ${stats.drawCalls}`);
    assert.ok(stats.triangles > 1500 && stats.triangles < TRIANGLE_BUDGET, `${authored.id} triangles ${stats.triangles}`);
    assert.ok(stats.drawCalls <= DRAW_CALL_BUDGET && stats.lights <= 4, `${authored.id} draw calls ${stats.drawCalls}, lights ${stats.lights}`);
    const { grid, entrance } = entry.walk;
    assert.ok(grid && entrance, `${authored.id} has a floor and an entrance`);
    assert.ok(grid.path(entrance.x, entrance.z, entrance.x, entrance.z) !== null && grid.nearest(entrance.x, entrance.z), `${authored.id}: the entrance is on the floor`);
    const reach = (what: string, x: number, z: number, approach?: { x: number; z: number } | null, within = 1.5) => {
      const at = grid.nearest(approach?.x ?? x, approach?.z ?? z);
      assert.ok(at && grid.path(entrance.x, entrance.z, at.x, at.z)?.length! > 0, `${authored.id}.${what} is reachable from the entrance`);
      assert.ok(Math.hypot(at.x - (approach?.x ?? x), at.z - (approach?.z ?? z)) < within, `${authored.id}.${what}: the floor reaches it`);
    };
    const spots = entry.walk.spots();
    assert.ok(spots.length >= 1, `${authored.id} has spots`);
    for (const spot of spots) {
      assert.ok(entry.anchors[spot.id]?.landmark, `${authored.id}.${spot.id} is pinned to a landmark of the scene`);
      reach(spot.id, spot.x, spot.z, spot.approach);
    }
    // Two spots of one venue never share a landmark: each has a place of its own.
    assert.equal(new Set(spots.map((spot) => entry.anchors[spot.id]!.landmark)).size, spots.length, `${authored.id}: each spot has its own landmark`);
    for (const thing of entry.walk.things()) reach(thing.id, thing.x, thing.z, null, 2.6);
    // A variant is a different scene from the bare kind it replaces.
    if (variant) assert.notEqual(stats.triangles, buildVenueScene(kit, { ...venue, scene: { ...venue.scene, variant: undefined } }, 'abuja').stats().triangles, `${authored.id} differs from the bare ${kind}`);
    entry.dispose();
  }
  if (process.env.FCT_REPORT) console.log(report.join('\n'));
  assert.deepEqual(own.sort(), [...OWN].sort(), 'the venues with a scene of their own');
  assert.deepEqual(stock.sort(), [...STOCK].sort(), 'the venues that keep the scene of their kind');
  assert.deepEqual([...used].sort(), all().sort(), 'every variant scene is used by a venue');
  assert.equal(used.size, OWN.length, 'no two venues share a scene');
  kit.dispose();
});

test('no two Abuja scenes are the same scene', () => {
  const kit = createKit();
  const sizes = new Map<number, string>();
  for (const [kind, variants] of Object.entries(VARIANTS)) {
    for (const variant of Object.keys(variants)) {
      const entry = buildVenueScene(kit, { id: `${kind}-${variant}`, label: 'Test Place', scene: { kind, variant } } as SceneVenue, 'abuja');
      const triangles = entry.stats().triangles;
      assert.ok(!sizes.has(triangles), `${kind}/${variant} has the same triangle count as ${sizes.get(triangles)}`);
      sizes.set(triangles, `${kind}/${variant}`);
      entry.dispose();
    }
  }
  assert.equal(sizes.size, all().length);
  kit.dispose();
});

test('an Abuja scene with something tall starts its camera far enough back to hold all of it, upright and across', () => {
  // The start distances of the host (src/venue-world.ts START_DISTANCE): the camera begins at start × these, never beyond the preset.
  const WIDE_START = 22, PORTRAIT_START = 16.5;
  for (const key of ['worship/fct-mosque', 'worship/fct-church', 'viewing/fct-stadium', 'walk/fct-gate', 'park/fct-parade']) {
    const [kind, variant] = key.split('/') as [string, string];
    const camera = VARIANTS[kind]![variant]!.camera;
    assert.ok(camera?.start, `${key} sets where its camera starts`);
    const whole = (at: readonly [number, number, number]) => Math.hypot(at[0], at[1] - 0.7, at[2]);
    assert.ok(camera.start * WIDE_START >= whole(camera.landscape), `${key}: a wide window starts with the whole scene`);
    assert.ok(camera.start * PORTRAIT_START >= whole(camera.portrait), `${key}: a tall window starts with the whole scene`);
  }
  // Every outdoor scene has a camera of its own for a tall window, and it looks from the front right like the others.
  for (const [kind, variants] of Object.entries(VARIANTS)) for (const [variant, def] of Object.entries(variants)) {
    assert.ok(def.camera, `${kind}/${variant} has a camera`);
    assert.ok(def.camera.landscape[0] > 0 && def.camera.landscape[2] > 0 && def.camera.portrait[0] > 0 && def.camera.portrait[2] > 0, `${kind}/${variant} looks in from the front right`);
  }
});
