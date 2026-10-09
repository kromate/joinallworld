import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadCityContent } from './game/cities/registry.ts';
import { createHostLights, createVenueWorld, HOST_LIGHTING } from './venue-world.ts';

await loadCityContent('lagos');

for (const maps of [false, true]) {
  test(`host lights dispose owned shadow targets once and preserve unrelated lights (allocated=${maps})`, () => {
    const scene = new THREE.Scene(), unrelated = new THREE.DirectionalLight();
    scene.add(unrelated);
    const lights = createHostLights(THREE, scene);
    lights.apply(null);
    assert.deepEqual([lights.hemi.intensity, lights.sun.intensity], [HOST_LIGHTING.hemi[2], HOST_LIGHTING.sun[1]], 'scenes without a preset retain host defaults');
    const disposed: string[] = [];
    if (maps) {
      lights.sun.shadow.map = new THREE.WebGLRenderTarget(2, 2);
      lights.sun.shadow.mapPass = new THREE.WebGLRenderTarget(2, 2);
      lights.sun.shadow.map.addEventListener('dispose', () => disposed.push('map'));
      lights.sun.shadow.mapPass.addEventListener('dispose', () => disposed.push('mapPass'));
    }
    lights.dispose(); lights.dispose();
    assert.deepEqual(disposed, maps ? ['map', 'mapPass'] : []);
    assert.deepEqual(scene.children, [unrelated], 'all owned lights and the rim target detach');
    assert.equal(lights.rim.target.parent, null);
    unrelated.dispose();
  });
}

test('actual host teardown releases shadow targets before renderer teardown', () => {
  const events: string[] = [];
  let shadow: THREE.LightShadow | undefined;
  const renderer = {
    shadowMap: {}, domElement: { remove() {} },
    setPixelRatio() {}, setClearColor() {}, setSize() {},
    render(scene: THREE.Scene) {
      if (shadow) return;
      const sun = scene.children.find(child => child instanceof THREE.DirectionalLight && child.castShadow) as THREE.DirectionalLight | undefined;
      assert.ok(sun, 'the actual host owns a shadow-casting sun');
      shadow = sun.shadow;
      shadow.map = new THREE.WebGLRenderTarget(2, 2);
      shadow.map.addEventListener('dispose', () => events.push('shadow'));
    },
    dispose() { events.push('renderer'); },
  } as unknown as THREE.WebGLRenderer;
  const container = { appendChild() {}, getBoundingClientRect: () => ({ width: 390, height: 844 }) } as unknown as HTMLElement;
  const world = createVenueWorld(container, { location: 'park', renderer });
  assert.ok(shadow, 'the renderer received the actual scene');
  world.dispose(); world.dispose();
  assert.deepEqual(events, ['shadow', 'renderer'], 'host released the shadow target before renderer teardown');
});
