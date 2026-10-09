import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { createKit } from '../../../src/scene/kit.ts';
import { normalizeLook } from '../../../src/scene/avatar-look.ts';
import { loadBody } from '../expressive-character-v1/skinned-baseline.ts';
import { loadBody as loadFittedBody } from './skinned-fit.ts';
import type { SkinnedBody } from '../../../src/scene/body/skinned.ts';
import { attachAuthoredHead } from './fit-authored-head.ts';
import { createAuthoredHair } from './authored-hair.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.setClearColor('#ebe2d4');
renderer.setScissorTest(true);
const kits = [createKit(), createKit()];
const scenes = kits.map(() => {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#fff0db', '#7a7972', 2));
  for (const [color, intensity, x, y, z] of [['#fff1d6', 2.6, -3, 4, 5], ['#d8e8ff', 1, 3, 2, 4], ['#ffe5c1', 2, 1, 4, -4]] as const) {
    const light = new THREE.DirectionalLight(color, intensity);
    light.position.set(x, y, z); scene.add(light);
  }
  return scene;
});
const camera = new THREE.PerspectiveCamera(28, 1, .05, 40);
const template = (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(new URL('../authored-head-spike-v1/generated/expressive-head-compressed.glb', import.meta.url).href)).scene;
template.traverse(node => {
  if (!(node instanceof THREE.Mesh)) return;
  for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
    if (material instanceof THREE.MeshStandardMaterial && material.name === 'VitSkin') material.color.set('#c99c7c');
  }
});
let bodies: SkinnedBody[] = [];
let head: ReturnType<typeof attachAuthoredHead> | null = null;
let hair: ReturnType<typeof createAuthoredHair> | null = null;
let yaw = -.2, seconds = 0, running = false, generation = 0;
let state = { body: 'woman', expression: 'grin', pose: 'idle', focus: 'body' };
let frames: number[] = [];
function draw() {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / 2 / height;
  const face = state.focus === 'head';
  const target = face ? 2.26 : 1.3;
  const span = face ? .65 : 2.95;
  const distance = Math.max(span / (2 * Math.tan(14 * Math.PI / 180)), (face ? .52 : 1.3) / (2 * Math.tan(14 * Math.PI / 180) * camera.aspect));
  camera.position.set(0, target + (face ? .02 : .12), distance);
  camera.lookAt(0, target, 0); camera.updateProjectionMatrix();
  for (const body of bodies) {
    body.place(0, 0, 0, yaw);
    if (state.pose === 'walk') body.stride(seconds / 1.35 * Math.PI * 2, false);
    else if (state.pose === 'dance') body.sampleUse('dance', seconds);
    else body.show('idle');
  }
  head?.setExpression(state.expression as 'neutral' | 'smile' | 'grin' | 'talk' | 'blink', seconds);
  scenes.forEach((scene, index) => {
    const x = index * Math.floor(width / 2);
    renderer.setViewport(x, 0, Math.floor(width / 2), height); renderer.setScissor(x, 0, Math.floor(width / 2), height);
    const start = performance.now(); renderer.render(scene, camera);
    frames.push(performance.now() - start);
    if (frames.length > 600) frames.shift();
  });
  document.querySelector('#metrics')!.textContent = 'Animated body fitting experiment. Original wardrobe remains. Family shapes, game integration and physical-phone performance remain unfinished.';
}
async function set(next: Partial<typeof state>) {
  const previous = state; state = { ...state, ...next };
  for (const key of ['body', 'expression', 'pose', 'focus'] as const) (document.querySelector(`#${key}`) as HTMLSelectElement).value = state[key];
  const seed = 'authored-character-fit';
  const look = (candidate: boolean) => normalizeLook({ body: state.body, hair: candidate ? 'lowcut' : state.body === 'woman' ? 'bun' : 'afro', outfit: 'casual', skin: '#9a6341', hairColor: '#241b18', outfitColor: '#cb674d', bottomsColor: '#36594a', expression: state.expression === 'grin' ? 'grin' : state.expression === 'smile' ? 'smile' : 'neutral', accessories: [] }, seed);
  if (!bodies.length || previous.body !== state.body) {
    const ticket = ++generation;
    hair?.dispose(); head = null; hair = null;
    bodies.forEach(body => body.dispose()); bodies = [];
    const prepared: { head?: ReturnType<typeof attachAuthoredHead> } = {};
    const loaded = await Promise.all([loadBody(kits[0]!, look(false), seed, 1), loadFittedBody(kits[1]!, look(true), seed, 1, actor => {
      prepared.head = attachAuthoredHead(actor, template);
      return prepared.head.dispose;
    })]);
    if (ticket !== generation) { loaded.forEach(body => body.dispose()); return; }
    if (!prepared.head) throw new Error('Authored head was not attached before wardrobe fitting');
    head = prepared.head;
    bodies = loaded; bodies.forEach((body, index) => scenes[index]!.add(body.object));
    hair = createAuthoredHair(state.body === 'woman' ? 'bun' : 'short', '#241b18', seed);
    head.object.add(hair.object);
  } else bodies[0]!.wear(look(false), seed);
  seconds = 0; draw();
}
for (const key of ['body', 'expression', 'pose', 'focus'] as const) document.querySelector(`#${key}`)!.addEventListener('change', event => void set({ [key]: (event.target as HTMLSelectElement).value }));
document.querySelector('#turn')!.addEventListener('click', () => { yaw += Math.PI / 2; draw(); });
document.querySelector('#play')!.addEventListener('click', () => {
  if (running) return;
  running = true; frames = [];
  const start = performance.now();
  function frame() {
    seconds = (performance.now() - start) / 1000; draw();
    if (seconds < 6) requestAnimationFrame(frame); else running = false;
  }
  requestAnimationFrame(frame);
});
let drag: number | null = null;
canvas.addEventListener('pointerdown', event => { drag = event.clientX; canvas.setPointerCapture(event.pointerId); });
canvas.addEventListener('pointermove', event => { if (drag === null) return; yaw += (event.clientX - drag) * .012; drag = event.clientX; draw(); });
for (const type of ['pointerup', 'pointercancel']) canvas.addEventListener(type, () => { drag = null; });
window.addEventListener('resize', draw);
Object.assign(window, { characterReview: {
  set,
  sample(time: number, angle = yaw) { seconds = time; yaw = angle; draw(); },
  snapshot() { return { state, yaw, seconds, frames, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, fit: head?.metrics, hair: hair && { triangles: hair.triangles, drawCalls: hair.drawCalls } }; },
} });
await set({}); Object.assign(window, { characterReady: true });
