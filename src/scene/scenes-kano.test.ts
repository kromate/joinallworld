import { loadCityContent as preloadCityContent } from '../game/cities/registry.ts';
await preloadCityContent('lagos');
// Kano's scenes: every venue of the city builds headlessly inside the rendering budget, each spot and game table has a
// place and a way to it, and the scenes the city draws for itself are each a scene of their own. Nothing here needs WebGL.
import test from 'node:test';
import { SCENE_TRIANGLES, SCENE_DRAW_CALLS, SCENE_LIGHTS } from '../budgets.ts';
import assert from 'node:assert/strict';
import { createKit } from './kit.ts';
import type { SceneVenue } from './types.ts';
import { MAX_CROWD, buildVenueScene } from './venue-scenes.ts';
import { sceneVenue } from '../venue-world.ts';
import { VARIANTS } from './venues-kano.ts';
import { KANO_SCENES } from '../game/cities/kano/scenes.ts';
import { loadAllCityScenes } from './city-scenes.ts';
// Every city's own scenes are a download of their own (src/scene/city-scenes.ts): the tests build all of them.
await loadAllCityScenes();

const CITY = 'kano';
// The same budget as src/scene/scenes.test.ts: the scene and a full crowd, with the player's own figure on top.
const TRIANGLE_BUDGET = SCENE_TRIANGLES.value, DRAW_CALL_BUDGET = SCENE_DRAW_CALLS.value;
const crowd = (count = MAX_CROWD) => Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Player${i}`, kind: i % 3 === 2 ? 'npc' : 'player' }));
const allVariants = (): string[] => Object.entries(VARIANTS).flatMap(([kind, variants]) => Object.keys(variants).map((variant) => `${kind}/${variant}`));
/** Places that must have a scene of their own: a visitor expects each of them to look like itself. */
const SIGNATURE = ['palace', 'central-mosque', 'dye-pits', 'kurmi-market', 'kwari-market', 'sabon-market', 'museum', 'dala-hill', 'goron-dutse', 'kofar-nassarawa', 'kofar-mata', 'kofar-kabuga', 'stadium', 'racecourse', 'polo-ground', 'railway-station', 'road-hub', 'buk-old', 'buk-new', 'tea-garden', 'film-workshop', 'community-house', 'nassarawa-garden'];

test('every Kano venue builds in budget with its own scene: each spot and game table has a place and a way to it', async () => {
  const kit = createKit();
  const used = new Set<string>();
  const report: string[] = [];
  const content = await preloadCityContent(CITY);
  for (const authored of content.venues) {
    if (authored.kind === 'home') continue;
    const venue = sceneVenue(authored.id, CITY) as unknown as SceneVenue;
    const variant = ['church', 'mosque', 'speakeasy'].includes(String(venue.scene?.variant)) ? undefined : venue.scene?.variant;
    if (variant) {
      used.add(`${venue.scene!.kind}/${variant}`);
      assert.match(variant, /^kano-/, `${authored.id}: the variant carries the city's prefix`);
      assert.ok(VARIANTS[venue.scene!.kind!]?.[variant], `${authored.id}: ${venue.scene!.kind}/${variant} is a scene of its own`);
    }
    const entry = buildVenueScene(kit, venue, CITY);
    entry.setCrowd(crowd());
    const stats = entry.stats();
    report.push(`${authored.id} ${venue.scene!.kind}${variant ? `/${variant}` : ''} ${stats.triangles} ${stats.drawCalls}`);
    assert.ok(stats.triangles > 1500 && stats.triangles < TRIANGLE_BUDGET, `${authored.id} triangles ${stats.triangles}`);
    assert.ok(stats.drawCalls <= DRAW_CALL_BUDGET && stats.lights <= SCENE_LIGHTS.value, `${authored.id} draw calls ${stats.drawCalls}, lights ${stats.lights}`);
    const { grid, entrance } = entry.walk;
    const reach = (what: string, x: number, z: number, approach?: { x: number; z: number } | null, within = 1.5) => {
      const at = grid!.nearest(approach?.x ?? x, approach?.z ?? z);
      assert.ok(at && grid!.path(entrance!.x, entrance!.z, at.x, at.z)?.length! > 0, `${authored.id}.${what} is reachable from the entrance`);
      assert.ok(Math.hypot(at.x - (approach?.x ?? x), at.z - (approach?.z ?? z)) < within, `${authored.id}.${what}: the floor reaches it`);
    };
    assert.ok(entry.walk.spots().length >= 2, `${authored.id} has its spots`);
    for (const spot of entry.walk.spots()) {
      assert.ok(entry.anchors[spot.id]?.landmark, `${authored.id}.${spot.id} is pinned to a landmark of the scene`);
      reach(spot.id, spot.x, spot.z, spot.approach);
    }
    for (const thing of entry.walk.things()) reach(thing.id, thing.x, thing.z, null, 2.6);
    // A scene of the city's own stands each spot at the landmark of the same name, and no two spots share a place.
    if (variant) {
      for (const spot of entry.walk.spots()) assert.equal(entry.anchors[spot.id]!.landmark, spot.id, `${authored.id}.${spot.id} stands at its own landmark`);
      const at = entry.walk.spots().map((spot) => `${spot.x.toFixed(1)},${spot.z.toFixed(1)}`);
      assert.equal(new Set(at).size, at.length, `${authored.id}: every spot has a place of its own`);
      // A variant is a different scene from the bare kind it replaces.
      assert.notEqual(stats.triangles, buildVenueScene(kit, { ...venue, scene: { ...venue.scene, variant: undefined } }, CITY).stats().triangles, `${authored.id} differs from the bare ${venue.scene!.kind}`);
    }
    entry.dispose();
  }
  if (process.env.KANO_REPORT) console.log(report.join('\n'));
  assert.deepEqual([...used].sort(), allVariants().sort(), 'every variant scene is used by a venue');
  kit.dispose();
});

test('the Kano scenes table names real venues and real scenes, and every signature place has one of its own', async () => {
  const content = await preloadCityContent(CITY);
  const ids = new Set(content.venues.map((venue) => venue.id));
  const seen = new Set<string>();
  for (const [id, scene] of Object.entries(KANO_SCENES)) {
    assert.ok(ids.has(id), `${id} is a venue of the city`);
    assert.ok(scene.variant && VARIANTS[scene.kind]?.[scene.variant], `${id}: ${scene.kind}/${scene.variant} exists`);
    assert.equal(content.venues.find((venue) => venue.id === id)!.kind, scene.kind, `${id} keeps its kind`);
    assert.ok(!seen.has(`${scene.kind}/${scene.variant}`), `${id} does not share its scene with another venue`);
    seen.add(`${scene.kind}/${scene.variant}`);
  }
  for (const id of SIGNATURE) assert.ok(KANO_SCENES[id], `${id} has a scene of its own`);
});

test('no two Kano scenes are the same scene, and each takes its sign from the venue', () => {
  const kit = createKit();
  const sizes = new Map<string, string>();
  for (const [kind, variants] of Object.entries(VARIANTS)) {
    for (const variant of Object.keys(variants)) {
      const entry = buildVenueScene(kit, { id: `${kind}-${variant}`, label: 'Test Place', scene: { kind, variant } } as SceneVenue, CITY);
      const key = `${entry.stats().triangles}`;
      assert.ok(!sizes.has(key), `${kind}/${variant} has the same triangle count as ${sizes.get(key)}`);
      sizes.set(key, `${kind}/${variant}`);
      // The name on the scene is drawn from the label: a longer label draws more lettering.
      const renamed = buildVenueScene(kit, { id: `${kind}-${variant}`, label: 'Another Test Place Entirely', scene: { kind, variant } } as SceneVenue, CITY);
      assert.notEqual(renamed.stats().triangles, entry.stats().triangles, `${kind}/${variant} draws the venue's own name`);
      assert.equal(entry.mood, 'outdoor', `${kind}/${variant} is an open-air scene`);
      assert.ok(entry.walk.open, `${kind}/${variant} has no walls to hide`);
      renamed.dispose();
      entry.dispose();
    }
  }
  kit.dispose();
});
