/**
 * OWNER: neighbourhood
 * Development-only street viewer (see street-harness.html): the neighbourhood street drawn once with the host's lights.
 * ?models=1 loads the street's model files the way the game does on a device that may fetch them (without it, the procedural stand-ins every device draws first and a low-end one keeps).
 * ?houses=1 draws a street of five neighbours (as the game does once you are settled) instead of one home.
 * ?x=<along the street> ?z=<camera z> ?up=<height> ?lx= ?lz= (look-at)  ?time=day|dusk|night. Nothing here runs in the game.
 * ?streetlife=on draws the street's far crowd and traffic (src/scene/street-life) and keeps them moving for one window of frames, with
 * its shopfronts and street furniture; &streetperf=1 adds the measured frame time and the counts (top left).
 * ?city=<id> another city's street (its country's driving side, liveries and traffic mix; default lagos). ?eye=1 (with ?streetlife=on)
 * looks from the street's start pose, where the map's dive ends on the home street (src/scene/street-life/street-scene.ts): eye height
 * on the near pavement, looking along the street. ?at=<ms> stops the street's clock at that instant (for screenshots).
 * ?px=&pz= stands the player's avatar there (the crowd gives way round it).
 * ?post=1 draws through the high tier's post stack (src/scene/fx/post.ts; its ambient occlusion is on, &ao=0 turns it off; use &quality=high); window.__post has the stack and a timing helper.
 */
import { createKit } from './kit.ts';
import { buildNeighbourhoodScene } from './neighbourhood-scene.ts';
import { createHostLights } from '../venue-world.ts';
import { applyRendererLook, renderTier, createSky } from './look.ts';
import { lightingFor } from './lighting.ts';

const params = new URLSearchParams(location.search), num = (key: string, fallback: number) => Number(params.get(key) ?? fallback);
const time = (params.get('time') || 'day') as 'day' | 'dusk' | 'night';
const cityId = params.get('city') || 'lagos';
await (await import('../game/cities/registry.ts')).loadCityContent(cityId);
// A pinned clock: street life places everyone from Date.now(), so a fixed ?at= gives the same street every time.
if (params.has('at')) { const pinned = num('at', 0); Date.now = () => pinned; }
const kit = createKit(), { THREE } = kit;
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
applyRendererLook(THREE, renderer, renderTier());
document.getElementById('stage')!.appendChild(renderer.domElement);
const streetView = params.get('houses') === '1', camera = new THREE.PerspectiveCamera(num('fov', streetView ? 80 : 48), 1, 0.1, 360);
const lights = createHostLights(THREE, scene);
const sky = createSky(THREE);
scene.background = sky.texture;
const street = buildNeighbourhoodScene(kit);
const { createLife } = await import('../life.ts');
street.update?.(createLife({ location: 'home' }, { cityId, now: Date.UTC(2026, 0, 5, time === 'day' ? 12 : time === 'dusk' ? 17 : 21) }));
if (params.get('houses') === '1') {
  const { packStyle } = await import('../game/content/world.ts'), tiers = ['starter', 'bq', 'bungalow', 'duplex', 'villa'] as const;
  const houses = [3, 4, 5, 6, 7].map((plot, i) => ({ plot, style: packStyle({ shape: i % 4, wall: (i * 3) % 8, roof: (i * 2 + 1) % 8, door: i % 4, windows: i % 4, fence: (i + 1) % 4, yard: [5, 4, 7, 1, 3][i]!, sign: 0 }, tiers[i]!), land: [], owner: { id: `n${i}`, name: `Neighbour ${i}` } }));
  street.setStreet?.({ city: cityId, anchor: { lga: 'ikeja', estate: 0, plot: 5 }, land: [], houses } as never);
}
scene.add(street.group);
// ?px= ?pz=: where the player's avatar stands (street life gives way round it, and vehicles stop short of it on the road).
if (params.has('px') || params.has('pz')) street.walk?.move(num('px', 0), 0, num('pz', 0), Math.PI / 2);
const stage = document.getElementById('stage')!, { clientWidth: width, clientHeight: height } = stage;
const x = num('x', streetView ? -18 : 74);
camera.aspect = width / height;
// With ?houses=1 the default frame is the whole row from above the road: about four houses, the road with its traffic, the poles and wires.
camera.position.set(x + num('dx', streetView ? 0 : -6), num('up', streetView ? 46 : 7), num('z', streetView ? 14 : 22));
camera.lookAt(num('lx', x), 0.3, num('lz', streetView ? 2 : 6));
camera.updateProjectionMatrix();
renderer.setSize(width, height, false);
// ?post=1: the high tier's post stack in place of the plain draw, graded for the street's time of day.
const post = params.get('post') === '1' ? await (await import('./quality.ts')).createBloom(THREE, renderer, width, height, 0.85, { kind: params.get('grade') as 'clear' | 'rains' | 'harmattan' || 'clear', band: time === 'day' ? 'day' : time === 'dusk' ? 'dusk' : 'night' }) : null;
lights.apply(lightingFor('outdoor', time));
lights.aim(camera);
sky.set(...street.sky!);
renderer.setClearColor(street.background!);
// ?eye=1: once the street has noted its layout, the camera takes its start pose (a person's eye on the pavement, looking along the street).
const streets = params.get('eye') === '1' ? await import('./street-life/street-scene.ts') : null;
let eyed = false;
const eye = (): void => {
  const pose = streets?.streetOf('neighbourhood')?.pose;
  if (!pose || eyed) return;
  eyed = true;
  camera.fov = num('fov', 62); camera.position.set(...pose.eye); camera.lookAt(...pose.look); camera.updateProjectionMatrix();
  lights.aim(camera);
};
const draw = () => { eye(); street.look?.(camera.position.x, camera.position.z); (post ?? renderer).render(scene, camera); document.getElementById('info')!.textContent = `${cityId} · ${streets ? (eyed ? 'eye pose · ' : 'waiting for the street · ') : ''}street · ${time}${params.get('models') === '1' ? ' · models' : ' · stand-ins'} · ${renderer.info.render.calls} calls · ${renderer.info.render.triangles} tris`; (window as unknown as { __diag: unknown }).__diag = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }; };
draw();
if (params.has('bench')) (window as unknown as Record<string, unknown>).__bench = (frames: number, through: 'plain' | 'post'): number => { const gl = renderer.getContext() as WebGL2RenderingContext, px = new Uint8Array(4); const t0 = performance.now(); for (let i = 0; i < frames; i += 1) { (through === 'post' && post ? post : renderer).render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } return (performance.now() - t0) / frames; };
// Redraw a bounded number of times while the models arrive (a timeout chain: scene sources hold no interval).
const redraw = (left: number): void => { draw(); if (left > 0) setTimeout(() => redraw(left - 1), 700) }
if (params.get('models') === '1' || params.has('streetlife')) { street.startCrowd?.(renderer as never, draw); redraw(30); }
// ?streetlife=on: about twelve seconds of the street moving (a bounded timeout chain, like the redraws above), then it stands still.
if (params.has('streetlife')) {
  let last = performance.now(), started = false;
  const frame = (left: number): void => {
    const now = performance.now();
    if (!started) started = street.wakeAmbient?.() ?? false;
    const more = street.stepAmbient?.(Math.min(0.1, (now - last) / 1000)) ?? false; last = now; draw();
    if (left > 0 && (more || !started)) setTimeout(() => frame(left - 1), 16);
  };
  frame(800);
}
