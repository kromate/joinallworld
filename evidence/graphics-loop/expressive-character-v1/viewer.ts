import * as THREE from 'three';
import { createKit } from '../../../src/scene/kit.ts';
import { normalizeLook } from '../../../src/scene/avatar-look.ts';
import { loadBody } from '../../../src/scene/body/skinned.ts';
import { loadBody as loadBaseline } from './skinned-baseline.ts';
import type { SkinnedBody } from '../../../src/scene/body/skinned.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.setClearColor('#e9e0d4'); renderer.setScissorTest(true);
const kits = [createKit(), createKit()];
const scenes = kits.map(() => {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#f7e9dd', '#736e74', 2));
  for (const [color, intensity, x, y, z] of [['#fff1d6', 2.6, -3, 4, 5], ['#d8e8ff', 1.0, 3, 2, 4], ['#ffe5c1', 2, 1, 4, -4]] as const) {
    const light = new THREE.DirectionalLight(color, intensity); light.position.set(x, y, z); scene.add(light);
  }
  return scene;
});
const camera = new THREE.PerspectiveCamera(26, 1, 0.05, 40);
let bodies: SkinnedBody[] = [], yaw = -0.12, phase = 0, seconds = 0, generation = 0, running = false;
let state = { body: 'woman', expression: 'neutral', pose: 'idle', focus: 'head' };
let frames: number[] = [];
function draw() {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / 2 / height;
  camera.position.set(0, state.focus === 'head' ? 2.36 : 1.55, state.focus === 'head' ? 1.55 : 6.1);
  camera.lookAt(0, state.focus === 'head' ? 2.27 : 1.32, 0); camera.updateProjectionMatrix();
  bodies.forEach((body, i) => {
    body.place(0, 0, 0, yaw);
    if (state.pose === 'walk') body.stride(phase, false);
    else if (state.pose === 'dance') body.sampleUse('dance', seconds);
    else body.show('idle');
    const x = i * Math.floor(width / 2);
    renderer.setViewport(x, 0, Math.floor(width / 2), height); renderer.setScissor(x, 0, Math.floor(width / 2), height);
    const start = performance.now(); renderer.render(scenes[i]!, camera); frames.push(performance.now() - start);
  });
  document.querySelector('#metrics')!.textContent = `Prototype · ${bodies.map(body => `${body.key}, wardrobe ${body.wardrobe.triangles} triangles`).join(' / ')} · last render ${frames.at(-1)?.toFixed(1)} ms. Physical-phone performance is unverified.`;
}
async function set(next: Partial<typeof state>) {
  const previous = state; state = { ...state, ...next };
  for (const key of ['body', 'expression', 'pose', 'focus'] as const) (document.querySelector(`#${key}`) as HTMLSelectElement).value = state[key];
  const look = normalizeLook({ body: state.body, hair: state.body === 'woman' ? 'bun' : 'afro', outfit: 'casual', skin: '#9a6341', hairColor: '#241b18', outfitColor: '#cb674d', bottomsColor: '#36594a', expression: state.expression, accessories: [] }, 'expressive-comparison');
  if (!bodies.length || previous.body !== state.body) {
    const ticket = ++generation;
    for (const body of bodies) body.dispose(); bodies = [];
    const loaded = await Promise.all([loadBaseline(kits[0]!, look, 'expressive-comparison', 1), loadBody(kits[1]!, look, 'expressive-comparison', 1)]);
    if (ticket !== generation) { loaded.forEach(body => body.dispose()); return; }
    bodies = loaded; bodies.forEach((body, i) => scenes[i]!.add(body.object));
  } else bodies.forEach(body => body.wear(look, 'expressive-comparison'));
  phase = 0; seconds = 0; draw();
}
for (const key of ['body', 'expression', 'pose', 'focus'] as const) document.querySelector(`#${key}`)!.addEventListener('change', event => { void set({ [key]: (event.target as HTMLSelectElement).value }); });
document.querySelector('#turn')!.addEventListener('click', () => { yaw += Math.PI / 2; draw(); });
document.querySelector('#play')!.addEventListener('click', () => {
  if (running) return; running = true;
  const start = performance.now();
  const frame = () => { seconds = (performance.now() - start) / 1000; phase = seconds / 1.35 * Math.PI * 2; draw(); if (seconds < 6) requestAnimationFrame(frame); else running = false; };
  requestAnimationFrame(frame);
});
let dragX: number | null = null;
canvas.addEventListener('pointerdown', event => { dragX = event.clientX; canvas.setPointerCapture(event.pointerId); });
canvas.addEventListener('pointermove', event => { if (dragX === null) return; yaw += (event.clientX - dragX) * 0.012; dragX = event.clientX; draw(); });
canvas.addEventListener('pointerup', () => { dragX = null; }); canvas.addEventListener('pointercancel', () => { dragX = null; });
window.addEventListener('resize', draw);
Object.assign(window, { characterReview: { set, sample(time: number, angle = yaw) { seconds = time; phase = time / 1.35 * Math.PI * 2; yaw = angle; draw(); }, snapshot() { return { state, yaw, frames, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, bodies: bodies.map(body => ({ key: body.key, wardrobe: body.wardrobe, facial: body.object.getObjectByName('avatar-facial-detail')?.type ?? null })) }; } } });
await set({}); Object.assign(window, { characterReady: true });
