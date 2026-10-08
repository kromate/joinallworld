import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createLife } from '../life.ts';
import { loadCityContent } from '../game/cities/registry.ts';
import { buildHomeScene } from './home-scene.ts';
import { buildNeighbourhoodScene } from './neighbourhood-scene.ts';
import { createKit } from './kit.ts';
import { LIGHTING } from './lighting.ts';
import { createVenueWorld } from '../venue-world.ts';

await loadCityContent('lagos');
const now = (hour: number, minute = 0) => Date.UTC(2026, 0, 5, hour, minute);
const life = () => createLife({ location: 'home', home: { custom: true, items: [{ id: 'night-lamp', itemId: 'standing-lamp', x: 0, y: 0, rot: 0 }] } }, { cityId: 'lagos', now: now(12) });
function geometries(group: THREE.Object3D) {
  const result: THREE.BufferGeometry[] = [];
  group.traverse(object => { if (object instanceof THREE.Mesh) result.push(object.geometry); });
  return result;
}

test('Home clock changes light and sky once per phase without rebuilding people or furnishings', () => {
  const kit = createKit(), home = buildHomeScene(kit), state = life();
  try {
    home.update(state);
    home.setCrowd([{ id: 'night-guest', name: 'Ada', kind: 'player', look: { body: 'woman', outfit: 'casual' } }]);
    const geometry = geometries(home.group), tags = home.tags();
    const lamps: THREE.PointLight[] = [];
    home.group.traverse(object => { if (object instanceof THREE.PointLight) lamps.push(object); });
    assert.equal(lamps.length, 1, 'day/night reuse the existing single Home lamp');
    for (const [time, hour] of [['day', 12], ['dusk', 17], ['night', 20]] as const) {
      const changed = home.update({ ...state, t: now(hour) });
      assert.equal(changed, time !== 'day');
      assert.deepEqual(home.lighting(), LIGHTING.indoor[time]);
      assert.deepEqual(home.sky, LIGHTING.indoor[time].sky);
      assert.equal(home.background, LIGHTING.indoor[time].sky[0]);
      assert.equal(lamps[0]!.intensity, 26 * LIGHTING.indoor[time].lamps, 'local warm light follows the same phase');
      assert.equal(home.update({ ...state, t: now(hour, 1) }), false, 'clock ticks in the same phase keep Home idle');
      assert.deepEqual(geometries(home.group), geometry, 'time changes never recreate geometry');
      assert.deepEqual(home.tags(), tags, 'the same people and action anchors survive nightfall');
    }
    assert.equal(home.update({ ...state, t: Number.NaN }), false, 'invalid time retains the last valid light');
    assert.deepEqual(home.lighting(), LIGHTING.indoor.night);
  } finally { home.dispose(); kit.dispose(); }
});

test('neighbourhood sun and sky follow the clock without moving homes or doors', () => {
  const kit = createKit(), street = buildNeighbourhoodScene(kit), state = life();
  try {
    street.update?.(state);
    const geometry = geometries(street.group), doors = street.neighbourDoors?.(), homeDoor = { ...street.homeDoor };
    assert.equal(street.update?.({ ...state, t: now(20) }), true);
    assert.deepEqual(street.lighting?.(), LIGHTING.outdoor.night);
    assert.deepEqual(street.sky, LIGHTING.outdoor.night.sky);
    assert.equal(street.background, LIGHTING.outdoor.night.sky[0]);
    assert.equal(street.update?.({ ...state, t: now(20, 1) }), false);
    assert.deepEqual(geometries(street.group), geometry);
    assert.deepEqual(street.neighbourDoors?.(), doors);
    assert.deepEqual(street.homeDoor, homeDoor);
  } finally { street.dispose?.(); kit.dispose(); }
});

test('actual venue host applies Home and neighbourhood night presets and remains idle within a phase', () => {
  let glow = Number.NaN;
  let activeGlowMaterial: THREE.MeshBasicMaterial | undefined;
  const renderer = {
    shadowMap: {}, domElement: { remove() {} },
    setPixelRatio() {}, setClearColor() {}, setSize() {}, dispose() {},
    render(scene: THREE.Scene) {
      scene.traverse(object => {
        if (object instanceof THREE.Mesh && /glow/.test(object.name) && !Array.isArray(object.material) && object.material instanceof THREE.MeshBasicMaterial) {
          activeGlowMaterial = object.material;
          glow = object.material.color.r;
        }
      });
    },
  } as unknown as THREE.WebGLRenderer;
  const container = { appendChild() {}, getBoundingClientRect: () => ({ width: 390, height: 844 }) } as unknown as HTMLElement;
  const world = createVenueWorld(container, { location: 'home', renderer, buildHome: buildHomeScene, buildNeighbourhood: buildNeighbourhoodScene });
  const state = life();
  try {
    world.setState(state);
    const dayFrames = world.diagnostics().renderCount;
    const night = { ...state, t: now(20) };
    world.setState(night);
    assert.equal(world.diagnostics().renderCount, dayFrames + 1, 'nightfall draws the changed light once');
    assert.deepEqual(world.diagnostics().lighting, { hemi: 1.6, sun: 0.9, sky: '#ecdfc9' });
    assert.equal(glow, LIGHTING.indoor.night.glow, 'active Home applies its emissive brightness to the shared material');
    world.setState({ ...night, t: now(20, 1) });
    assert.equal(world.diagnostics().renderCount, dayFrames + 1);
    assert.ok(activeGlowMaterial, 'actual Home exposes a shared glow surface');
    for (const destination of ['park', 'market']) {
      assert.equal(world.prepare(destination), true);
      assert.equal(activeGlowMaterial.color.r, LIGHTING.indoor.night.glow, 'preparing a future day-lit venue cannot dim the visible Home');
      assert.equal(world.diagnostics().renderCount, dayFrames + 1, 'preparation restores materials without drawing a frame');
      assert.deepEqual(world.diagnostics().lighting, { hemi: 1.6, sun: 0.9, sky: '#ecdfc9' });
      assert.equal(world.diagnostics().scenes, 2, 'only the current and one prepared destination remain');
    }
    const outside = { ...night, location: 'neighbourhood' as const };
    world.setState(outside); world.setLocation('neighbourhood');
    assert.deepEqual(world.diagnostics().lighting, { hemi: 1.05, sun: 0.8, sky: '#9fb4e6' }, 'transition applies outdoor night instead of default day');
    assert.equal(glow, LIGHTING.outdoor.night.glow, 'street transition reapplies its own emissive brightness');
    const outsideFrames = world.diagnostics().renderCount;
    world.setState({ ...outside, t: now(20, 2) });
    assert.equal(world.diagnostics().renderCount, outsideFrames);
  } finally { world.dispose(); }
});
