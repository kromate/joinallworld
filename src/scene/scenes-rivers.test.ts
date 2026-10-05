import { loadCityContent as preloadCityContent } from '../game/cities/registry.ts';
await preloadCityContent('lagos');
// Port Harcourt's scenes: every venue of the city builds headlessly inside the rendering budget, with a place for each
// of its spots and game tables and a way to it. Nothing here needs WebGL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createKit } from './kit.ts';
import type { SceneVenue } from './types.ts';
import { MAX_CROWD, buildVenueScene } from './venue-scenes.ts';
import { sceneVenue } from '../venue-world.ts';
import { VARIANTS } from './venues-rivers.ts';
import { PORT_HARCOURT_SCENES } from '../game/cities/port-harcourt/scenes.ts';
import { loadAllCityScenes } from './city-scenes.ts';
// Every city's own scenes are a download of their own (src/scene/city-scenes.ts): the tests build all of them.
await loadAllCityScenes();

const CITY = 'port-harcourt';
// The scene and its crowd keep to 15,000; the player's own figure is drawn at medium detail, once, on top.
const TRIANGLE_BUDGET = 15000 + 2000, DRAW_CALL_BUDGET = 60;
const crowd = (count = MAX_CROWD) => Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Player${i}`, kind: i % 3 === 2 ? 'npc' : 'player' }));
const everyVariant = (): string[] => Object.entries(VARIANTS).flatMap(([kind, variants]) => Object.keys(variants).map((variant) => `${kind}/${variant}`));

test('every Port Harcourt venue builds in budget with its own scene: each spot and game table has a place and a way to it', async () => {
  const content = await preloadCityContent(CITY);
  const kit = createKit();
  const used = new Set<string>();
  const report: string[] = [];
  for (const authored of content.venues) {
    if (authored.kind === 'home') continue;
    const venue = sceneVenue(authored.id, CITY) as unknown as SceneVenue;
    const variant = ['church', 'mosque', 'speakeasy'].includes(String(venue.scene?.variant)) ? undefined : venue.scene?.variant;
    if (variant) {
      used.add(`${venue.scene!.kind}/${variant}`);
      assert.ok(VARIANTS[venue.scene!.kind!]?.[variant], `${authored.id}: ${venue.scene!.kind}/${variant} is a scene of its own`);
    }
    const entry = buildVenueScene(kit, venue, CITY);
    entry.setCrowd(crowd());
    const stats = entry.stats();
    report.push(`${authored.id} ${venue.scene!.kind}${variant ? `/${variant}` : ''} ${stats.triangles} ${stats.drawCalls}`);
    assert.ok(stats.triangles > 1500 && stats.triangles < TRIANGLE_BUDGET, `${authored.id} triangles ${stats.triangles}`);
    assert.ok(stats.drawCalls <= DRAW_CALL_BUDGET && stats.lights <= 4, `${authored.id} draw calls ${stats.drawCalls}, lights ${stats.lights}`);
    const { grid, entrance } = entry.walk;
    const reach = (what: string, x: number, z: number, approach?: { x: number; z: number } | null, within = 1.5) => {
      const at = grid!.nearest(approach?.x ?? x, approach?.z ?? z);
      assert.ok(at && grid!.path(entrance!.x, entrance!.z, at.x, at.z)?.length! > 0, `${authored.id}.${what} is reachable from the entrance`);
      assert.ok(Math.hypot(at.x - (approach?.x ?? x), at.z - (approach?.z ?? z)) < within, `${authored.id}.${what}: the floor reaches it`);
    };
    const spots = entry.walk.spots();
    assert.ok(spots.length > 0, `${authored.id} has spots`);
    for (const spot of spots) {
      assert.ok(entry.anchors[spot.id]?.landmark, `${authored.id}.${spot.id} is pinned to a landmark of the scene`);
      reach(spot.id, spot.x, spot.z, spot.approach);
    }
    for (const thing of entry.walk.things()) reach(thing.id, thing.x, thing.z, null, 2.6);
    // A variant is a different scene from the bare kind it replaces.
    if (variant) assert.notEqual(stats.triangles, buildVenueScene(kit, { ...venue, scene: { ...venue.scene, variant: undefined } }, CITY).stats().triangles, `${authored.id} differs from the bare ${venue.scene!.kind}`);
    entry.dispose();
  }
  if (process.env.RIVERS_REPORT) console.log(report.join('\n'));
  assert.deepEqual([...used].sort(), everyVariant().sort(), 'every variant scene is used by a venue');
  kit.dispose();
});

test('the Port Harcourt scenes table names venues of the city, scenes that exist and landmarks they have', async () => {
  const content = await preloadCityContent(CITY);
  const kit = createKit();
  const ids = new Set(content.venues.map((venue) => venue.id));
  for (const [id, scene] of Object.entries(PORT_HARCOURT_SCENES)) {
    assert.ok(ids.has(id), `${id} is a venue of the city`);
    assert.match(String(scene.variant), /^ph-/, `${id}: the variant carries the city's prefix`);
    assert.ok(VARIANTS[scene.kind]?.[String(scene.variant)], `${id}: ${scene.kind}/${scene.variant} exists`);
    const entry = buildVenueScene(kit, sceneVenue(id, CITY) as unknown as SceneVenue, CITY);
    for (const landmark of Object.values(scene.anchors ?? {})) assert.ok(entry.anchors[landmark]?.landmark === landmark, `${id}: ${landmark} is a landmark of ${scene.variant}`);
    entry.dispose();
  }
  kit.dispose();
});

test('the signature places of Port Harcourt each have a scene of their own', () => {
  const signature = ['pleasure-park', 'isaac-boro-park', 'mile-one-market', 'mile-three-market', 'oil-mill-market', 'railway-township', 'wharf', 'tourist-beach', 'bonny-jetty', 'okrika-jetty', 'yakubu-gowon-stadium', 'adokiye-stadium', 'government-house', 'uniport', 'rsu', 'iaue', 'trans-amadi', 'garden-city-amusement', 'bole-kitchen', 'garden-city-evening'];
  const seen = new Map<string, string>();
  for (const id of signature) {
    const scene = PORT_HARCOURT_SCENES[id];
    assert.ok(scene?.variant, `${id} has a scene of its own`);
    const key = `${scene.kind}/${scene.variant}`;
    assert.ok(!seen.has(key), `${id} shares ${key} with ${seen.get(key)}`);
    seen.set(key, id);
  }
});

test('no two Port Harcourt scenes are the same scene, and each keeps its people off the water', () => {
  const kit = createKit();
  const sizes = new Map<string, string>();
  for (const [kind, variants] of Object.entries(VARIANTS)) {
    for (const variant of Object.keys(variants)) {
      const entry = buildVenueScene(kit, { id: `${kind}-${variant}`, label: 'Test Place', scene: { kind, variant } } as SceneVenue, CITY);
      const key = `${entry.stats().triangles}`;
      assert.ok(!sizes.has(key), `${kind}/${variant} has the same triangle count as ${sizes.get(key)}`);
      sizes.set(key, `${kind}/${variant}`);
      assert.ok(entry.camera.landscape.length === 3 && entry.camera.portrait.length === 3, `${kind}/${variant} has a camera for both orientations`);
      // Everyone the scene places stands inside its walkable bounds: on the bank, the quay or the jetty, never in the creek.
      const [x0, z0, x1, z1] = entry.walk.grid!.bounds;
      entry.setCrowd(crowd());
      for (const tag of entry.tags()) assert.ok(tag.position.x >= x0 - 0.01 && tag.position.x <= x1 + 0.01 && tag.position.z >= z0 - 0.01 && tag.position.z <= z1 + 0.01, `${kind}/${variant}: ${tag.id} stands at ${tag.position.x.toFixed(1)}, ${tag.position.z.toFixed(1)}, outside the floor`);
      entry.dispose();
    }
  }
  kit.dispose();
});
