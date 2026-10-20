import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createShaderWarmup } from './shader-warmup.ts';

/** A renderer stand-in: compile() gives each material a program that reports linked after `linkChecks` polls. */
function fakeRenderer({ parallel = true, linkChecks = 2 } = {}) {
  const props = new WeakMap<object, { currentProgram?: { isReady(): boolean } }>();
  let compiles = 0;
  const renderer = {
    extensions: { has: (name: string) => parallel && name === 'KHR_parallel_shader_compile' },
    properties: { get: (material: object) => { if (!props.has(material)) props.set(material, {}); return props.get(material)!; } },
    compile(root: THREE.Object3D) {
      compiles++;
      const materials = new Set<THREE.Material>();
      root.traverse((object) => { const mesh = object as THREE.Mesh; if (!mesh.isMesh) return; const material = mesh.material as THREE.Material; materials.add(material); const entry = renderer.properties.get(material); if (!entry.currentProgram) { let polls = 0; entry.currentProgram = { isReady: () => ++polls > linkChecks }; } });
      return materials;
    },
  };
  return { renderer, compiles: () => compiles };
}

test('a draw with unlinked programs waits for them and is redrawn once; later frames do not look again', async () => {
  const { renderer, compiles } = fakeRenderer();
  const warmup = createShaderWarmup(renderer), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
  let redraws = 0;
  assert.equal(warmup.hold(scene, scene, camera, () => { redraws++; }), true);
  assert.equal(warmup.hold(scene, scene, camera, () => { redraws++; }), true, 'still linking');
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(redraws, 1);
  assert.equal(warmup.hold(scene, scene, camera, () => {}), false);
  assert.equal(compiles(), 1);
});

test('a new material after mark() is compiled; one whose program is already linked does not hold the frame', async () => {
  const { renderer } = fakeRenderer({ linkChecks: 0 });
  const warmup = createShaderWarmup(renderer), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
  assert.equal(warmup.hold(scene, scene, camera, () => {}), false, 'linked at once');
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
  warmup.mark();
  assert.equal(warmup.hold(scene, scene, camera, () => {}), false);
});

test('without KHR_parallel_shader_compile, or with a renderer that cannot compile, nothing is held', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
  assert.equal(createShaderWarmup(fakeRenderer({ parallel: false }).renderer).hold(scene, scene, camera, () => {}), false);
  assert.equal(createShaderWarmup({}).hold(scene, scene, camera, () => {}), false);
  assert.equal(createShaderWarmup(null).hold(scene, scene, camera, () => {}), false);
});

// ---- phase 7: what the warm-up covers beyond the scenery ------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { createRain } from './fx/rain.ts';

/** The fake renderer again, but compile() sees what three's compile sees: every mesh of the root, hidden ones too, in the render target now set. */
function targetRenderer() {
  const props = new WeakMap<object, { currentProgram?: { isReady(): boolean }; target?: object | null }>();
  let current: object | null = null;
  const compiled: { name: string; target: object | null }[] = [];
  const renderer = {
    extensions: { has: (name: string) => name === 'KHR_parallel_shader_compile' },
    properties: { get: (material: object) => { if (!props.has(material)) props.set(material, {}); return props.get(material)!; } },
    getRenderTarget: () => current,
    setRenderTarget: (target: object | null) => { current = target; },
    compile(root: THREE.Object3D) {
      const materials = new Set<THREE.Material>();
      root.traverse((object) => {
        const mesh = object as THREE.Mesh; if (!mesh.isMesh) return;
        const material = mesh.material as THREE.Material; materials.add(material);
        const entry = renderer.properties.get(material);
        // Like three: a program is made for a material the first time, and again when the target it is drawn into is another one.
        if (!entry.currentProgram || entry.target !== current) { let polls = 0; entry.currentProgram = { isReady: () => ++polls > 1 }; entry.target = current; compiled.push({ name: mesh.name, target: current }); }
      });
      return materials;
    },
  };
  return { renderer, compiled, current: () => current };
}

test('rain is in the warm-up: the streaks and the splashes (hidden until it moves) are linked before the first draw that shows them', async () => {
  const { renderer, compiled } = targetRenderer();
  const warmup = createShaderWarmup(renderer), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const rain = createRain({ THREE, parent: scene, tier: 'high' });
  assert.equal(rain.splashes.visible, false, 'the splashes start hidden');
  let redraws = 0;
  warmup.mark();
  assert.equal(warmup.hold(scene, scene, camera, () => { redraws += 1; }), true);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(compiled.map((c) => c.name).sort(), ['rain-drops', 'rain-splashes'], 'both shaders are compiled, the hidden one too');
  assert.equal(redraws, 1);
  rain.step(0.1); // the splashes appear: nothing left to link
  warmup.mark();
  assert.equal(warmup.hold(scene, scene, camera, () => {}), false);
  rain.dispose();
});

test('the warm-up relies on three compiling hidden meshes too (a three upgrade that stops doing so must change this file)', () => {
  const source = readFileSync(new URL('../../node_modules/three/src/renderers/WebGLRenderer.js', import.meta.url), 'utf8');
  const compile = source.slice(source.indexOf('this.compile = function'), source.indexOf('this.compileAsync'));
  assert.ok(compile.length > 200);
  assert.match(compile, /scene\.traverse\(\s*function/, 'materials are gathered with traverse, not traverseVisible');
});

test('a post stack draws the scene into its own buffer: every program is linked again for it, once, and the screen is restored', async () => {
  const { renderer, compiled, current } = targetRenderer();
  const warmup = createShaderWarmup(renderer), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const box = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); box.name = 'box';
  scene.add(box);
  const buffer = {} as THREE.WebGLRenderTarget;
  // Drawn plain first (no post yet): one program.
  assert.equal(warmup.hold(scene, scene, camera, () => {}), true);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(compiled.map((c) => c.target), [null]);
  assert.equal(warmup.hold(scene, scene, camera, () => {}), false);
  // The post stack arrives: the same material is compiled again against its buffer, and held for.
  let redraws = 0;
  assert.equal(warmup.hold(scene, scene, camera, () => { redraws += 1; }, buffer), true, 'the draw waits for the new variant');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(redraws, 1);
  assert.deepEqual(compiled.map((c) => c.target), [null, buffer]);
  assert.equal(current(), null, 'the renderer is left drawing to the screen');
  // Once is enough.
  warmup.mark();
  assert.equal(warmup.hold(scene, scene, camera, () => {}, buffer), false);
  assert.equal(compiled.length, 2);
});
