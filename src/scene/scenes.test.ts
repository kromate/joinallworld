import { loadCityContent as preloadCityContent } from '../game/cities/registry.ts';
await preloadCityContent('lagos');
// Scene modules: every venue kind builds headlessly, stays inside the rendering budget and
// frees everything it made. Nothing here needs WebGL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { createKit } from './kit.ts';
import type { SceneMaterials, SceneOptions, SceneVenue } from './types.ts';
import { SCENES, KINDS, TIMES, LIGHTING, MAX_CROWD, DEFAULT_CAMERA, buildVenueScene, timeOfDay, lightingFor } from './venue-scenes.ts';
import { LOOK_OPTIONS, POSES, normalizeLook, drawAvatar, buildAvatar, buildCrowd, appearanceToLook } from './characters.ts';
import type { CrowdPerson, DrawOptions } from './characters.ts';
import type { LifeState } from '../types/life.ts';
import { createBatch, sceneMaterials } from './build.ts';
import { sign, textWidth, table, chair, bench, stall, speaker, screen, plant, palm, lampPost, signBoard } from './props.ts';
import { createVenueWorld, createHostLights, sceneVenue, HOST_LIGHTING } from '../venue-world.ts';
import { VENUES } from '../game/cities/lagos/venues.ts';

import { NPCS } from '../game/cities/lagos/regulars.ts';

import { spotsOf } from '../life.ts';

const EXPECTED_KINDS = ['park', 'buka', 'hub', 'club', 'office', 'market', 'gym', 'mall', 'beach', 'hospital', 'salon', 'rooftop', 'police', 'worship', 'radio', 'polling', 'viewing', 'shrine', 'walk', 'statehouse', 'airport', 'refinery', 'quad', 'hilltop', 'lakeside'];
// The scene and its crowd keep to 15,000; the player's own figure is drawn at medium detail (up to ~2,700 triangles, once), on top.
const TRIANGLE_BUDGET = 15000 + 2000, DRAW_CALL_BUDGET = 60;
const crowd = (count = MAX_CROWD) => Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Player${i}`, kind: i % 3 === 2 ? 'npc' : 'player' }));
// build() only reads the materials of meshes it makes; these tests look at geometry alone.
// A partial game state, as the host's setState takes it in these tests.
const asState = (state: object) => state as unknown as LifeState;
const NO_MATERIALS = { solid: null, glow: null, glass: null } as unknown as SceneMaterials;
const venueOf = (kind: string, scene: Partial<SceneOptions> = {}, more: Partial<SceneVenue> = {}): SceneVenue => ({ id: kind, label: kind, scene: { kind, ...scene }, ...more });

/** Count geometries that are created and later disposed while `run` executes. */
function trackGeometries(run: (live: Set<THREE.BufferGeometry>) => void) {
  const live = new Set<THREE.BufferGeometry>();
  const original = THREE.BufferGeometry.prototype.setIndex;
  THREE.BufferGeometry.prototype.setIndex = function setIndex(this: THREE.BufferGeometry, ...args: Parameters<typeof original>) {
    if (!live.has(this)) { live.add(this); this.addEventListener('dispose', () => live.delete(this)); }
    return original.apply(this, args);
  };
  try { run(live); } finally { THREE.BufferGeometry.prototype.setIndex = original; }
  return live;
}

test('every venue kind has a scene', () => {
  assert.deepEqual([...KINDS].sort(), [...EXPECTED_KINDS].sort());
  for (const kind of [...EXPECTED_KINDS, 'library', 'church', 'mosque', 'generic']) assert.equal(typeof SCENES[kind], 'function', kind);
  assert.deepEqual(DEFAULT_CAMERA, { landscape: [16, 21, 27], portrait: [13, 24, 31] });
});

test('each scene builds within budget with a full crowd, and disposes without leaving anything behind', () => {
  const report: string[] = [];
  const leaked = trackGeometries((live) => {
    const kit = createKit();
    const kitGeometries = live.size;
    for (const kind of [...EXPECTED_KINDS, 'library', 'mosque', 'generic']) {
      const parent = new THREE.Scene();
      const entry = SCENES[kind]!(kit, venueOf(kind));
      parent.add(entry.group);
      const tags = entry.setCrowd(crowd());
      const stats = entry.stats();
      report.push(`${kind}: ${stats.triangles} triangles, ${stats.drawCalls} draw calls`);
      assert.ok(entry.group.isGroup && typeof entry.background === 'string' && entry.camera.landscape.length === 3 && entry.camera.portrait.length === 3, kind);
      assert.ok(stats.triangles > 1500, `${kind} has real geometry (${stats.triangles})`);
      assert.ok(stats.triangles < TRIANGLE_BUDGET, `${kind} triangles ${stats.triangles}`);
      // Static (≤ 3) + sky + crowd (≤ 2) + the player's own figure (a rig: one mesh per part, ≤ 8 with its crown) + the spot ring; the two walking marks add at most 2 more.
      // A room's two walls are parts of their own (≤ 3 layers each), so that the scene can hide the wall the camera is behind.
      assert.ok(stats.drawCalls <= DRAW_CALL_BUDGET && stats.meshes <= (entry.walls ? 21 : 15), `${kind} draw calls ${stats.drawCalls}, meshes ${stats.meshes}`);
      assert.ok(stats.lights <= 4, `${kind} lights ${stats.lights}`);
      assert.equal(tags.length, MAX_CROWD, kind);
      for (const mesh of (entry.group.children as THREE.Mesh[]).filter((child) => child.isMesh)) {
        const { position, normal, color } = mesh.geometry.attributes as Record<'position' | 'normal' | 'color', THREE.BufferAttribute>;
        assert.ok(position.count > 0 && normal.count === position.count && color.count === position.count, `${kind} ${mesh.name}`);
        assert.ok(position.array.every(Number.isFinite), `${kind} ${mesh.name} has finite vertices`);
      }
      const before = live.size;
      entry.dispose();
      assert.equal(entry.group.children.length, 0, `${kind} left objects in its group`);
      assert.equal(entry.group.parent, null, `${kind} still attached`);
      assert.equal(parent.children.length, 0, `${kind} left objects in the scene`);
      assert.ok(live.size < before && live.size === kitGeometries, `${kind} leaked ${live.size - kitGeometries} geometries`);
      entry.dispose();
    }
    kit.dispose();
  });
  assert.equal(leaked.size, 0, 'no geometry survives kit.dispose()');
  assert.equal(report.length, EXPECTED_KINDS.length + 3);
});

test('dispose() frees a scene’s geometry, a rebuild gives the same scene, and the kit frees what the host never disposed', () => {
  const leaked = trackGeometries((live) => {
    const kit = createKit();
    const base = live.size;
    const entry = SCENES.market!(kit, venueOf('market'));
    const shown = entry.stats();
    assert.ok(live.size > base);
    // Hiding is only hiding: a scene no longer watches group.visible to learn about the host.
    entry.group.visible = false;
    assert.equal(entry.group.visible, false);
    assert.ok(live.size > base, 'a hidden scene keeps its geometry until the host disposes it');
    entry.dispose();
    assert.equal(live.size, base, 'a disposed scene holds no geometry');
    assert.equal(entry.group.children.length, 0);
    assert.equal(entry.stats().triangles, 0);
    assert.ok(entry.anchors.people, 'anchors stay readable after dispose');
    const again = SCENES.market!(kit, venueOf('market'));
    assert.deepEqual(again.stats(), shown, 'the next visit builds the same scene');
    kit.dispose();
    assert.equal(again.group.children.length, 0, 'kit.dispose() frees scenes the host never disposed');
  });
  assert.equal(leaked.size, 0);
});

test('kit.dispose() frees the shared scene materials', () => {
  const kit = createKit();
  const materials = sceneMaterials(kit);
  let disposed = 0;
  for (const material of Object.values(materials)) material.addEventListener('dispose', () => { disposed += 1; });
  SCENES.park!(kit, venueOf('park'));
  assert.equal(sceneMaterials(kit), materials, 'one material set per kit');
  kit.dispose();
  assert.ok(disposed >= 3);
});

test('unknown kinds fall back to the generic plaza; variants change the scene', () => {
  const kit = createKit();
  for (const venue of [undefined, {}, { scene: {} }, venueOf('no-such-kind'), venueOf('constructor'), venueOf('home')]) {
    const entry = buildVenueScene(kit, venue);
    assert.equal(entry.kind, 'generic');
    assert.ok(entry.stats().triangles > 500);
  }
  const club = buildVenueScene(kit, venueOf('club')).stats().triangles;
  const speakeasy = buildVenueScene(kit, venueOf('club', { variant: 'speakeasy' })).stats().triangles;
  assert.notEqual(club, speakeasy);
  // The variant is declared by the venue content, never guessed from the venue id.
  assert.equal(buildVenueScene(kit, { id: 'library', scene: { kind: 'club' } }).stats().triangles, club, 'no id-based default');
  assert.equal(VENUES.library.scene.variant, 'speakeasy');
  assert.equal(buildVenueScene(kit, VENUES.library).stats().triangles > 1500, true);
  assert.equal(buildVenueScene(kit, venueOf('library')).stats().triangles, speakeasy, 'the `library` kind alias is still the speakeasy');
  const church = buildVenueScene(kit, venueOf('worship')).stats().triangles;
  const mosque = buildVenueScene(kit, venueOf('worship', { variant: 'mosque' })).stats().triangles;
  assert.notEqual(church, mosque);
  assert.equal(buildVenueScene(kit, { id: 'mosque', scene: { kind: 'worship' } }).stats().triangles, church, 'no id-based default');
  assert.deepEqual([VENUES.mosque.scene.variant, VENUES.church.scene.variant], ['mosque', 'church']);
  assert.equal(buildVenueScene(kit, venueOf('worship', { variant: 'church' })).stats().triangles, church);
  kit.dispose();
});

test('every spot gets an anchor; named spots land on their landmark', () => {
  const kit = createKit();
  const spots = [{ id: 'bookcase', label: 'Secret bookcase' }, { id: 'lounge', label: 'Lounge' }, { id: 'cocktail', label: 'Cocktail bar' }, { id: 'floor', label: 'Dance floor' }, { id: 'people', label: 'People' }, { id: 'mystery', label: 'Something else' }];
  const club = buildVenueScene(kit, venueOf('club', { spots }));
  assert.deepEqual(spots.map((spot) => club.anchors[spot.id]!.landmark), ['bookcase', 'lounge', 'bar', 'dancefloor', 'people', 'dj']);
  for (const spot of spots) assert.ok(Number.isFinite(club.anchors[spot.id]!.x) && Number.isFinite(club.anchors[spot.id]!.z), spot.id);
  assert.equal(club.spot, 'bookcase', 'the player starts at the first spot');
  // Venue-declared spots (an object map, as in content/venues.js) work too.
  const buka = buildVenueScene(kit, venueOf('buka', {}, { spots: { counter: { id: 'counter', label: 'Buka counter' }, kitchen: { id: 'kitchen', label: "Mama's kitchen" }, wash: { id: 'wash', label: 'Wash bowl' }, people: { id: 'people', label: 'People' } } }));
  assert.deepEqual(['counter', 'kitchen', 'wash', 'people'].map((id) => buka.anchors[id]!.landmark), ['counter', 'kitchen', 'wash', 'people']);
  // More spots than landmarks: the rest still get distinct places.
  const many = Array.from({ length: 14 }, (_, i) => ({ id: `s${i}`, label: `Spot ${i}` }));
  const park = buildVenueScene(kit, venueOf('park', { spots: many }));
  const places = new Set(many.map((spot) => `${park.anchors[spot.id]!.x},${park.anchors[spot.id]!.z}`));
  assert.equal(places.size, many.length);
  // A spot that appears later (added by another system) is placed on demand.
  assert.equal(park.setSpot('late-spot'), true);
  assert.ok(Number.isFinite(park.anchors['late-spot']!.x));
  for (const kind of EXPECTED_KINDS) {
    const entry = buildVenueScene(kit, venueOf(kind));
    assert.ok(entry.anchors.people, `${kind} has a people anchor`);
    assert.ok(Object.keys(entry.anchors).length >= 4, `${kind} has landmarks`);
    for (const anchor of Object.values(entry.anchors)) assert.ok(Math.abs(anchor.x) <= 13 && Math.abs(anchor.z) <= 12, `${kind} anchor in bounds`);
    entry.dispose();
  }
  kit.dispose();
});

test('update(state) reports a change only when something visible changed', () => {
  const kit = createKit();
  const noon = Date.UTC(2026, 0, 5, 11, 0), evening = Date.UTC(2026, 0, 5, 17, 0), midnight = Date.UTC(2026, 0, 5, 23, 30);
  assert.deepEqual([noon, evening, midnight].map(timeOfDay), ['day', 'dusk', 'night']);
  const venue = { id: 'park', scene: { kind: 'park' }, spots: { amphitheatre: { id: 'amphitheatre', label: 'Amphitheatre' }, trees: { id: 'trees', label: 'Under the trees' } } };
  const entry = buildVenueScene(kit, venue);
  assert.equal(entry.update({ location: 'park' }), false, 'nothing to reflect');
  assert.equal(entry.update(null), false);
  assert.equal(entry.update({ location: 'park', t: noon, spot: 'amphitheatre' }), false, 'already day, already there');
  const dayBackground = entry.background;
  assert.equal(entry.update({ location: 'park', t: midnight, spot: 'amphitheatre' }), true);
  assert.equal(entry.time, 'night');
  assert.notEqual(entry.background, dayBackground);
  assert.equal(entry.update({ location: 'park', t: midnight + 60000, spot: 'amphitheatre' }), false, 'a minute later is still night');
  assert.equal(entry.update({ location: 'park', t: midnight, spot: 'trees' }), true);
  assert.equal(entry.spot, 'trees');
  const standing = entry.tags()[0]!.position;
  assert.equal(entry.update({ location: 'home', t: midnight, spot: 'kitchen' }), false, 'spots of other venues are ignored');
  assert.equal(entry.update({ location: 'park', t: midnight, spot: 'trees', onboarding: { look: { body: 'man', hair: 'afro' } } }), true);
  assert.equal(entry.update({ location: 'park', t: midnight, spot: 'trees', onboarding: { look: { body: 'man', hair: 'afro' } } }), false);
  assert.equal(entry.update({ location: 'park', t: midnight, spot: 'trees', onboarding: { look: { body: 'man', hair: 'afro' } }, activeAction: { id: 'chill' } }), true);
  assert.notDeepEqual(entry.tags()[0]!.position, standing, 'a busy player moves to the seat of the spot');
  assert.equal(entry.setTime('night'), false);
  assert.equal(entry.setTime('dusk'), true);
  assert.equal(entry.setTime('noon'), false);
  // A fixed time of day ignores the clock.
  const fixed = buildVenueScene(kit, venueOf('beach', { time: 'dusk' }));
  assert.equal(fixed.update({ t: midnight }), false);
  assert.equal(fixed.time, 'dusk');
  kit.dispose();
});

test('lighting presets exist for every mood and time; the scene reports its preset and the host applies it', () => {
  for (const mood of ['outdoor', 'indoor', 'club'] as const) for (const time of TIMES) {
    const preset = LIGHTING[mood][time];
    assert.ok(preset.sky.length === 2 && preset.hemi.length === 3 && preset.sun.length === 3 && preset.glow > 0 && preset.lamps > 0, `${mood} ${time}`);
  }
  assert.equal(lightingFor('nope', 'nope'), LIGHTING.outdoor.day);
  assert.ok(LIGHTING.outdoor.night.hemi[2] < LIGHTING.outdoor.day.hemi[2]);
  const kit = createKit();
  const scene = new THREE.Scene();
  const lights = createHostLights(THREE, scene);
  const entry = buildVenueScene(kit, venueOf('rooftop', { time: 'night' }));
  scene.add(entry.group);
  assert.equal(entry.lighting(), LIGHTING.outdoor.night);
  assert.equal(lights.hemi.intensity, HOST_LIGHTING.hemi[2], 'a scene never reaches into the host: the lights are untouched until the host applies the preset');
  assert.equal(sceneMaterials(kit).glow.color.r, LIGHTING.outdoor.night.glow, 'its own lit surfaces follow the time of day');
  lights.apply(entry.lighting());
  assert.equal(lights.hemi.intensity, LIGHTING.outdoor.night.hemi[2]);
  assert.equal(lights.sun.intensity, LIGHTING.outdoor.night.sun[1]);
  lights.apply(undefined);
  assert.equal(lights.hemi.intensity, 1.6); assert.equal(lights.sun.intensity, 1.4);
  assert.deepEqual(lights.sun.position.toArray(), [-12, 25, 8]);
  assert.equal(`#${lights.hemi.color.getHexString()}`, '#bdd4e7');
  kit.dispose();
});

test('every spot of every venue stands at a landmark of its scene, and every regular has a place', () => {
  const kit = createKit();
  for (const venue of Object.values(VENUES)) {
    // The UNILAG campus is drawn by its own host (src/campus/unilag/host.ts behind world-adapter.ts) and has its own scene, walk and budget tests there.
    if (venue.scene.kind === 'home' || venue.scene.kind === 'unilag') continue;
    const seen = sceneVenue(venue.id);
    assert.deepEqual(seen!.scene.spots.map((spot) => spot.id), spotsOf(venue.id, 'lagos').map((spot) => spot.id), `${venue.id}: spots added by other systems are passed to the scene`);
    const entry = buildVenueScene(kit, seen);
    for (const spot of seen!.scene.spots) assert.ok(entry.anchors[spot.id]?.landmark, `${venue.id}.${spot.id} is on open floor`);
    for (const [spot, landmark] of Object.entries((venue.scene as SceneOptions).anchors || {})) {
      assert.ok(seen!.scene.spots.some((item) => item.id === spot), `${venue.id}: anchor hint for unknown spot ${spot}`);
      assert.equal(entry.anchors[spot]!.landmark, landmark, `${venue.id}.${spot}`);
    }
    for (const npc of (Object.values(NPCS) as { id: string; venue: string; at: string }[]).filter((item) => item.venue === venue.id)) assert.ok(entry.anchors[npc.at]?.landmark, `${npc.id} stands at ${npc.at}`);
    entry.dispose();
  }
  // A running activity takes the pose of the spot it happens at; leaving shows the avatar walking.
  const park = buildVenueScene(kit, sceneVenue('park'));
  assert.equal(park.update({ location: 'park', spot: 'trees' }), true);
  const standing = park.tags()[0]!.position;
  assert.equal(park.update({ location: 'park', spot: 'trees', activeAction: { kind: 'activity', id: 'chill' } }), true, 'starting an activity redraws the avatar');
  const sitting = park.tags()[0]!.position;
  assert.ok(sitting.y < standing.y && (sitting.x !== standing.x || sitting.z !== standing.z), 'chilling under the trees sits on the bench');
  assert.equal(park.update({ location: 'park', spot: 'trees', activeAction: { kind: 'travel', id: 'home' } }), true);
  assert.deepEqual([park.tags()[0]!.position.x, park.tags()[0]!.position.z], [standing.x, standing.z], 'a traveller is not posed at the bench');
  kit.dispose();
});

test('looks are normalised deterministically and tolerate missing or unknown fields', () => {
  for (const junk of [undefined, null, 'x', 7, [], {}, { body: 'robot', hair: 42, outfit: null, fabric: 'silk', skin: 'green', hairColor: -1, outfitColor: '#12', bottomsColor: {} }]) {
    const look = normalizeLook(junk, 'player-123');
    assert.deepEqual(look, normalizeLook(junk, 'player-123'));
    assert.ok(LOOK_OPTIONS.body.includes(look.body));
    assert.ok(LOOK_OPTIONS.hair[look.body].includes(look.hair) && LOOK_OPTIONS.outfit[look.body].includes(look.outfit) && LOOK_OPTIONS.fabric.includes(look.fabric));
    for (const colour of [look.skin, look.hairColor, look.outfitColor, look.bottomsColor]) assert.match(colour, /^#[0-9a-f]{6}$/);
  }
  const seeds = Array.from({ length: 40 }, (_, i) => JSON.stringify(normalizeLook(null, `public-${i}`)));
  assert.ok(new Set(seeds).size > 30, 'different players look different');
  assert.deepEqual(normalizeLook({ body: 'Woman', hair: 'Low cut', outfit: 'Site work', fabric: 'Aso-oke', skin: 6, hairColor: 'Purple', outfitColor: 'Gold', bottomsColor: '#ABCDEF' }), {
    body: 'woman', hair: 'lowcut', outfit: 'sitework', fabric: 'asooke', skin: LOOK_OPTIONS.skin[6]!.hex, hairColor: '#7a4bb0', outfitColor: '#d6a83a', bottomsColor: '#abcdef',
    accessories: [], face: 'oval', expression: 'smile',
  });
  assert.equal(normalizeLook({ body: 'man', hair: 'gele', outfit: 'owambe' }, 's').body, 'man');
  assert.ok(LOOK_OPTIONS.hair.man.includes(normalizeLook({ body: 'man', hair: 'gele' }, 's').hair), 'options not offered for a body fall back');
  assert.equal(LOOK_OPTIONS.skin.length, 7); assert.equal(LOOK_OPTIONS.hairColor.length, 7); assert.equal(LOOK_OPTIONS.outfitColor.length, 10);
  const colours = appearanceToLook({ outfitColor: 'red' }, 'x');
  assert.equal(colours.shirt, '#c9423a');
});

test('every hairstyle, outfit, fabric and pose builds a distinct low-poly avatar', () => {
  const signature = (look: unknown, options?: DrawOptions) => {
    const batch = createBatch(THREE);
    drawAvatar(batch, look, options);
    const built = batch.build(NO_MATERIALS);
    const solid = built.meshes[0]!.geometry;
    let sum = 0;
    const { position, color } = solid.attributes;
    for (let i = 0; i < position!.array.length; i++) sum += position!.array[i]! * (i % 7 + 1) + color!.array[i]! * (i % 5 + 1);
    built.meshes.forEach((mesh) => mesh.geometry.dispose());
    assert.ok(built.triangles > 150 && built.triangles <= 600, `avatar triangles ${built.triangles} for ${JSON.stringify(look)}`);
    return `${built.triangles}:${sum.toFixed(3)}`;
  };
  for (const body of LOOK_OPTIONS.body) {
    const base = { body, hair: 'lowcut', outfit: 'casual', fabric: 'plain', skin: 2, hairColor: 0, outfitColor: 'blue', bottomsColor: 'navy' };
    const hairs = LOOK_OPTIONS.hair[body].map((hair) => signature({ ...base, hair }));
    assert.equal(new Set(hairs).size, hairs.length, `${body} hairstyles are distinct`);
    const outfits = LOOK_OPTIONS.outfit[body].map((outfit) => signature({ ...base, outfit }));
    assert.equal(new Set(outfits).size, outfits.length, `${body} outfits are distinct`);
    const fabrics = LOOK_OPTIONS.fabric.map((fabric) => signature({ ...base, fabric }));
    assert.equal(new Set(fabrics).size, fabrics.length, `${body} fabrics are distinct`);
    const tones = LOOK_OPTIONS.skin.map((_, skin) => signature({ ...base, skin }));
    assert.equal(new Set(tones).size, 7);
    const tops = LOOK_OPTIONS.outfitColor.map((swatch) => signature({ ...base, outfitColor: swatch.id }));
    assert.equal(new Set(tops).size, 10);
    const poses = POSES.map((pose) => signature(base, { pose }));
    assert.equal(new Set(poses).size, POSES.length, `${body} poses are distinct`);
    assert.equal(signature(base, { pose: 'cartwheel' } as unknown as DrawOptions), signature(base, { pose: 'stand' }), 'unknown pose stands');
  }
  for (const pose of ['stand', 'sit', 'walk', 'wave', 'work']) assert.ok((POSES as readonly string[]).includes(pose));
});

test('buildAvatar and buildCrowd return groups, name-tag data and free themselves', () => {
  const leaked = trackGeometries((live) => {
    const kit = createKit();
    const base = live.size;
    const avatar = buildAvatar(kit, { body: 'woman', hair: 'gele', outfit: 'owambe', fabric: 'ankara' }, { x: 2, z: 3, ry: 1, pose: 'wave', marker: 'crown' });
    assert.ok(avatar.isGroup && avatar.children.length >= 1 && avatar.children.length <= 2);
    assert.deepEqual([avatar.position.x, avatar.position.z, avatar.rotation.y], [2, 3, 1]);
    assert.equal(avatar.userData.look.hair, 'gele');
    assert.ok(avatar.userData.top > 2.5);
    const again = buildAvatar(kit, { body: 'woman', hair: 'gele', outfit: 'owambe', fabric: 'ankara' }, { pose: 'wave', marker: 'crown' });
    assert.deepEqual(Array.from((again.children[0] as THREE.Mesh).geometry.attributes.position!.array), Array.from((avatar.children[0] as THREE.Mesh).geometry.attributes.position!.array), 'same look, same geometry');
    const people: CrowdPerson[] = [{ id: 'a', name: 'Ada', kind: 'player', x: 1, z: 1 }, { id: 'n', name: 'Mama Nkechi', kind: 'npc', x: -2, z: 0, pose: 'work' }, { name: 'Tunde', x: 3, z: 2, pose: 'sit', look: { body: 'man', hair: 'locs' } }];
    const built = buildCrowd(kit, people);
    assert.ok(built.group.children.length <= 2, 'a crowd is at most two meshes');
    assert.equal(built.tags.length, 3);
    assert.deepEqual(built.tags.map((tag) => [tag.id, tag.text, tag.kind, tag.marker]), [['a', '@Ada', 'player', 'tag'], ['n', 'Mama Nkechi', 'npc', 'dot'], ['person-2', '@Tunde', 'player', 'tag']]);
    assert.deepEqual([built.tags[0]!.position.x, built.tags[0]!.position.z], [1, 1]);
    assert.ok(built.tags[0]!.position.y > 2.5 && built.tags[2]!.position.y < built.tags[0]!.position.y, 'a seated person has a lower tag');
    assert.ok(built.triangles < 3 * 600);
    assert.deepEqual(buildCrowd(kit, []).tags, []);
    avatar.userData.dispose();
    built.dispose();
    assert.equal(avatar.children.length, 0);
    assert.equal(built.group.children.length, 0);
    assert.ok(live.size > base, 'the undisposed avatar is still alive');
    kit.dispose();
  });
  assert.equal(leaked.size, 0);
});

test('a scene crowd is capped, placed and tagged; the player carries the crown', () => {
  const kit = createKit();
  const entry = buildVenueScene(kit, venueOf('viewing'));
  const empty = entry.stats().triangles;
  const tags = entry.setCrowd(crowd(30));
  assert.equal(tags.length, MAX_CROWD);
  assert.ok(entry.stats().triangles > empty);
  assert.equal(new Set(tags.map((tag) => `${tag.position.x.toFixed(2)},${tag.position.z.toFixed(2)}`)).size, MAX_CROWD, 'everyone has their own place');
  const all = entry.tags();
  assert.equal(all.length, MAX_CROWD + 1);
  assert.deepEqual([all[0]!.kind, all[0]!.marker], ['self', 'crown']);
  const placed = entry.setCrowd([{ id: 'x', name: 'X', x: 4, z: -2 }, { id: 'y', name: 'Y', spot: 'snacks' }, null, 'junk']);
  assert.deepEqual([placed[0]!.position.x, placed[0]!.position.z], [4, -2]);
  const fromSnacks = Math.hypot(placed[1]!.position.x - entry.anchors.snacks!.x, placed[1]!.position.z - entry.anchors.snacks!.z);
  assert.ok(fromSnacks > 1 && fromSnacks < 3.2, `someone "at" a spot stands beside its marker, not on it (${fromSnacks.toFixed(2)} away)`);
  assert.equal(entry.setPlayer({ look: { hair: 'afro' }, name: 'Kromate' }), true);
  assert.equal(entry.setPlayer({ look: { hair: 'afro' }, name: 'Kromate' }), false);
  assert.equal(entry.tags()[0]!.text, 'Kromate');
  assert.equal(entry.setPlayer({ pose: 'wave' }), true);
  assert.deepEqual(entry.setCrowd([]), []);
  assert.equal(entry.stats().meshes <= 13, true);
  kit.dispose();
});

test('shared props draw into a batch; block lettering needs no canvas', () => {
  const batch = createBatch(THREE);
  const steps: number[] = [];
  for (const draw of [() => table(batch, 0, 0), () => chair(batch, 1, 0), () => bench(batch, 2, 0), () => stall(batch, 4, 0), () => speaker(batch, 6, 0), () => screen(batch, 8, 2, 0), () => plant(batch, 9, 0), () => palm(batch, 10, 0), () => lampPost(batch, 11, 0), () => signBoard(batch, 12, 0, 'ON AIR')]) {
    const before = batch.triangles;
    draw();
    steps.push(batch.triangles - before);
  }
  assert.ok(steps.every((count) => count > 0 && count < 450), steps.join(','));
  const before = batch.triangles;
  sign(batch, 0, 3, 0, 'On Air 99.9', { lit: true });
  assert.ok(batch.triangles - before > 40 && batch.triangles - before < 200);
  assert.ok(Math.abs(textWidth('AB', 0.5) - 0.7) < 1e-9);
  const built = batch.build(NO_MATERIALS);
  assert.deepEqual(built.meshes.map((mesh) => mesh.name), ['solid', 'glow']);
  built.meshes.forEach((mesh) => mesh.geometry.dispose());
});

test('the host draws one frame per real change and none while a venue scene is idle', async () => {
  const calls = { render: 0 };
  const renderer = { shadowMap: {}, domElement: { remove() {} }, setPixelRatio() {}, setClearColor() {}, setSize() {}, dispose() {}, render() { calls.render += 1; } };
  const container = { appendChild() {}, getBoundingClientRect: () => ({ width: 1280, height: 800 }) };
  const world = createVenueWorld(container as unknown as HTMLElement, { location: 'park', renderer: renderer as unknown as THREE.WebGLRenderer });
  const midnight = Date.UTC(2026, 0, 5, 23, 30);
  assert.equal(world.diagnostics().renderCount, 1);
  world.setState(asState({ location: 'park', t: midnight, spot: 'amphitheatre' }));
  assert.equal(world.diagnostics().renderCount, 2, 'night falls: one frame');
  for (let i = 1; i <= 20; i++) world.setState(asState({ location: 'park', t: midnight + i * 1000, spot: 'amphitheatre' }));
  assert.equal(world.diagnostics().renderCount, 2, 'twenty state ticks with nothing new: no frames');
  world.setState(asState({ location: 'park', t: midnight, spot: 'trees' }));
  assert.equal(world.diagnostics().renderCount, 3, 'moving to another spot: one frame');
  world.setLocation('library');
  world.setState(asState({ location: 'library', t: midnight }));
  assert.equal(world.diagnostics().renderCount, 4);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(world.diagnostics().renderCount, 4, 'idle: zero renders');
  assert.equal(calls.render, 4);
  world.dispose();
});

test('scene sources hold no frame loops or timers, and the dev harness is not a build input', async () => {
  // Assembled from parts so this file does not itself contain the words the host's own source scan looks for.
  const banned = new RegExp([['request', 'Animation', 'Frame'], ['set', 'Animation', 'Loop'], ['set', 'Interval'], ['set', 'Timeout'], ['Texture', 'Loader'], ['GLTF', 'Loader'], ['new ', 'Image'], ['\\.png'], ['\\.jpg'], ['\\.glb'], ['\\.gltf'], ['fetch', '\\(']].map((parts) => parts.join('')).join('|'));
  for (const file of ['build.ts', 'characters.ts', 'props.ts', 'venue-scenes.ts', 'venues-outdoor.ts', 'venues-social.ts', 'venues-work.ts', 'venues-civic.ts', 'venues-transport.ts', 'harness.ts', 'harness.html']) {
    const code = (await readFile(new URL(file, import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(code, banned, file);
  }
  const config = await readFile(new URL('../../vite.config.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(config, /harness/);
  assert.doesNotMatch(await readFile(new URL('../../index.html', import.meta.url), 'utf8'), /harness/);
});

test('every game table stands in its venue’s scene: on free floor, reachable from the door, clear of markers and of each other', async () => {
  const { TABLES, tablesAt } = await import('../tables/places.ts');
  const { TABLE_CLEAR, TABLE_REACH, TABLE_PLACES } = await import('./venue-scenes.ts');
  const kit = createKit();
  // The campus tables (venue 'unilag') are not furniture of a venue scene: the campus has its own host, and they open from the Tables app.
  const venues = [...new Set(TABLES.map((table) => table.venue))].filter((id) => id !== 'unilag');
  assert.deepEqual(venues.sort(), ['amala-shitta', 'beach', 'park', 'rooftop', 'viewing-centre']);
  const seen: string[] = [];
  for (const id of venues) {
    const venue = sceneVenue(id) ?? (VENUES as unknown as Record<string, SceneVenue>)[id];
    const parent = new THREE.Scene();
    const bare = buildVenueScene(kit, { ...venue, id: `${id}-without-tables` }), bareTriangles = bare.stats().triangles;
    bare.dispose();
    const entry = buildVenueScene(kit, venue);
    parent.add(entry.group);
    const things = entry.walk.things(), wanted = tablesAt(id), grid = entry.walk.grid, door = entry.walk.entrance;
    assert.deepEqual(things.map((thing) => thing.id), wanted.map((table) => `table:${table.id}`), `${id}: every table of the venue has a place in the scene`);
    assert.ok(Object.hasOwn(TABLE_PLACES, entry.kind), `${id}: the ${entry.kind} scene has preferred table places`);
    for (const thing of things) {
      seen.push(thing.id);
      assert.deepEqual([thing.kind, typeof thing.label, thing.top > 1 && thing.r > 1], ['table', 'string', true]);
      // The table itself is solid (the avatar walks round it)…
      assert.equal(grid!.free(thing.x, thing.z), false, `${thing.id}: the table is an obstacle`);
      // …with standing room all round it, and a way there from the door.
      const stands = Array.from({ length: 12 }, (_, step) => { const angle = (step / 12) * Math.PI * 2; return [thing.x + Math.sin(angle) * TABLE_REACH, thing.z + Math.cos(angle) * TABLE_REACH] as [number, number]; }).filter(([x, z]) => grid!.free(x, z));
      assert.ok(stands.length >= 8, `${thing.id}: ${stands.length} of 12 places beside it are free`);
      assert.ok(stands.some(([x, z]) => grid!.path(door!.x, door!.z, x, z)?.length! > 0), `${thing.id}: can be walked to from the entrance`);
      assert.ok(Math.hypot(thing.x - door!.x, thing.z - door!.z) > 3, `${thing.id}: not in the doorway`);
      // No spot marker is covered or crowded by it, and no two tables touch.
      for (const spot of entry.walk.spots()) assert.ok(Math.hypot(spot.x - thing.x, spot.z - thing.z) > TABLE_CLEAR + 0.8, `${thing.id} stands clear of the ${spot.id} marker`);
      for (const other of things) if (other !== thing) assert.ok(Math.hypot(other.x - thing.x, other.z - thing.z) > TABLE_CLEAR * 2, `${thing.id} and ${other.id} do not touch`);
    }
    // Every spot is still reachable with the tables in the room.
    for (const spot of entry.walk.spots()) { const at = grid!.nearest(spot.approach?.x ?? spot.x, spot.approach?.z ?? spot.z); assert.ok(at && grid!.path(door!.x, door!.z, at.x, at.z)?.length! > 0, `${id}: ${spot.id} is still reachable`); }
    // The tables are part of the venue's own batch: a few hundred triangles, no mesh or draw call of their own, inside the budget.
    const stats = entry.stats();
    assert.ok(stats.triangles - bareTriangles > 60 * things.length && stats.triangles - bareTriangles < 420 * things.length, `${id}: ${things.length} tables cost ${stats.triangles - bareTriangles} triangles`);
    assert.ok(stats.triangles < TRIANGLE_BUDGET && stats.drawCalls <= DRAW_CALL_BUDGET, `${id}: ${stats.triangles} triangles, ${stats.drawCalls} draw calls`);
    // A rebuild (night falls) leaves them where they are.
    const before = things.map((thing) => [thing.x, thing.z]);
    entry.setTime('night'); entry.setTime('day');
    assert.deepEqual(entry.walk.things().map((thing) => [thing.x, thing.z]), before);
    entry.dispose();
  }
  assert.equal(seen.length, TABLES.filter((table) => table.venue !== 'unilag').length, 'all eight venue tables stand somewhere');
  // A venue without a table has nothing extra.
  const library = buildVenueScene(kit, sceneVenue('library') ?? VENUES.library);
  assert.deepEqual(library.walk.things(), []);
  library.dispose();
});

test('the Ibadan campus court, hilltop and reservoir scenes: every spot of their venues has a place and a way to it, with an identity of their own', async () => {
  await preloadCityContent('ibadan');
  const { TABLE_PLACES } = await import('./venue-scenes.ts');
  const kit = createKit();
  const wanted: Record<string, string> = { 'ui-campus': 'quad', 'bowers-tower': 'hilltop', 'eleyele-lake': 'lakeside' };
  const triangles: Record<string, number> = {};
  for (const [id, kind] of Object.entries(wanted)) {
    const venue = sceneVenue(id, 'ibadan') as unknown as SceneVenue;
    assert.equal(venue.scene?.kind, kind, `${id} uses the ${kind} scene`);
    assert.ok(Object.hasOwn(TABLE_PLACES, kind), `${kind} has preferred table places`);
    const entry = buildVenueScene(kit, venue, 'ibadan');
    assert.equal(entry.kind, kind);
    const { grid, entrance } = entry.walk;
    const spots = entry.walk.spots();
    assert.ok(spots.length >= 1, `${id} has spots`);
    for (const spot of spots) {
      assert.ok(spot.x !== undefined && entry.anchors[spot.id]?.landmark, `${id}.${spot.id} is pinned to a landmark of the scene`);
      const at = grid!.nearest(spot.approach?.x ?? spot.x, spot.approach?.z ?? spot.z);
      assert.ok(at && grid!.path(entrance!.x, entrance!.z, at.x, at.z)?.length! > 0, `${id}.${spot.id} is reachable from the entrance`);
      assert.ok(Math.hypot(at.x - spot.x, at.z - spot.z) < 1.5, `${id}.${spot.id}: the floor reaches the spot`);
    }
    triangles[kind] = entry.stats().triangles;
    entry.dispose();
  }
  assert.equal(new Set(Object.values(triangles)).size, 3, 'three different scenes');
  kit.dispose();
});

test('every Ibadan venue builds in budget with its own scene: each spot and game table has a place and a way to it', async () => {
  const content = await preloadCityContent('ibadan');
  const { VARIANTS } = await import('./venues-ibadan-b.ts');
  const kit = createKit();
  const used = new Set<string>();
  for (const authored of content.venues) {
    if (authored.kind === 'home') continue;
    const venue = sceneVenue(authored.id, 'ibadan') as unknown as SceneVenue;
    const variant = ['church', 'mosque', 'speakeasy'].includes(String(venue.scene?.variant)) ? undefined : venue.scene?.variant;
    if (variant) {
      used.add(`${venue.scene!.kind}/${variant}`);
      assert.ok(VARIANTS[venue.scene!.kind!]?.[variant], `${authored.id}: ${venue.scene!.kind}/${variant} is a scene of its own`);
    }
    const entry = buildVenueScene(kit, venue, 'ibadan');
    entry.setCrowd(crowd());
    const stats = entry.stats();
    assert.ok(stats.triangles > 1500 && stats.triangles < TRIANGLE_BUDGET, `${authored.id} triangles ${stats.triangles}`);
    assert.ok(stats.drawCalls <= DRAW_CALL_BUDGET && stats.lights <= 4, `${authored.id} draw calls ${stats.drawCalls}`);
    const { grid, entrance } = entry.walk;
    const reach = (what: string, x: number, z: number, approach?: { x: number; z: number } | null, within = 1.5) => {
      const at = grid!.nearest(approach?.x ?? x, approach?.z ?? z);
      assert.ok(at && grid!.path(entrance!.x, entrance!.z, at.x, at.z)?.length! > 0, `${authored.id}.${what} is reachable from the entrance`);
      assert.ok(Math.hypot(at.x - (approach?.x ?? x), at.z - (approach?.z ?? z)) < within, `${authored.id}.${what}: the floor reaches it`);
    };
    for (const spot of entry.walk.spots()) {
      assert.ok(entry.anchors[spot.id]?.landmark, `${authored.id}.${spot.id} is pinned to a landmark of the scene`);
      reach(spot.id, spot.x, spot.z, spot.approach);
    }
    for (const thing of entry.walk.things()) reach(thing.id, thing.x, thing.z, null, 2.6);
    // A variant is a different scene from the bare kind it replaces.
    if (variant) assert.notEqual(stats.triangles, buildVenueScene(kit, { ...venue, scene: { ...venue.scene, variant: undefined } }, 'ibadan').stats().triangles, `${authored.id} differs from the bare ${venue.scene!.kind}`);
    entry.dispose();
  }
  const all = Object.entries(VARIANTS).flatMap(([kind, variants]) => Object.keys(variants).map((variant) => `${kind}/${variant}`));
  assert.deepEqual([...used].sort(), all.sort(), 'every variant scene is used by a venue');
  kit.dispose();
});
