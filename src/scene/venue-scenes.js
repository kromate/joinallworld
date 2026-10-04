/**
 * OWNER: scenes
 * One procedural scene per `scene.kind` declared in src/game/content/venues.js.
 *
 * SCENES[kind] = (kit, venue) => ({
 *   group,                      // THREE.Group holding everything for this venue
 *   background,                 // clear colour
 *   camera?: { landscape: [x, y, z], portrait: [x, y, z] },   // defaults below
 *   update?(state) → boolean,   // optional: reflect game state; return true if anything changed
 * })
 * The host (src/venue-world.js) builds a scene the first time its venue is shown, caches it,
 * and draws it only on demand. Scenes are static: no requestAnimationFrame, timers or
 * per-frame work. If something must move, change it inside update() and return true — the
 * host then draws exactly one frame. Unknown kinds fall back to SCENES.generic.
 */
import { person } from './characters.js';
import { tree, lamp } from './props.js';

export const DEFAULT_CAMERA = { landscape: [16, 21, 27], portrait: [13, 24, 31] };

function park(kit) {
  const { THREE, box, round, sphere, mesh, crownGeometry } = kit;
  const group = new THREE.Group();
  box(0, -0.28, 0, 42, 0.5, 38, '#3e5141', group);
  box(1, 0.015, 2, 14, 0.05, 24, '#56624a', group);
  round(5, 0.35, -6, 4.5, 0.7, '#796a5a', group);
  round(5, 0.75, -6, 4.25, 0.15, '#917c64', group);
  for (const x of [1.5, 8.5]) {
    round(x, 2.6, -9, 0.07, 5.2, '#293e36', group);
    box(x, 5.15, -9, 0.55, 0.18, 0.6, '#ffd79a', group, true);
  }
  box(5, 4.4, -9, 7.2, 0.85, 0.14, '#32483e', group);
  for (const [x, z, w] of [[3.8, -0.8, 7.8], [3.8, 2.4, 7.8], [-4.7, 4.2, 4]]) {
    box(x, 0.65, z, w, 0.5, 0.9, '#8c9080', group);
    box(x, 1, z - 0.45, w, 0.85, 0.2, '#999a8b', group);
    for (const dx of [-w * 0.32, w * 0.32]) box(x + dx, 0.3, z, 0.5, 0.6, 0.65, '#747e72', group);
  }
  for (const [x, z, scale] of [[-9, -7, 1.15], [-11, 0, 1.2], [-9, 8, 1.35], [-4, -10, 0.95], [-13, 7, 0.9], [-5, 11, 1.05], [11, -11, 0.85]]) tree(kit, group, x, z, scale);
  for (const [x, z] of [[-8, -3], [-7, 6], [11, 2]]) lamp(kit, group, x, z);
  box(9, 0.14, 8, 5.2, 0.28, 4.2, '#898a78', group);
  box(9, 1.5, 8, 4.3, 2.8, 2.5, '#aa8642', group);
  box(9, 2.2, 6.72, 3.45, 1.2, 0.08, '#2c3631', group);
  box(9, 1.6, 6.45, 4.6, 0.18, 0.7, '#ddba75', group);
  box(9, 3.1, 7.6, 5.3, 0.23, 4, '#a54741', group);
  box(9, 2.82, 5.7, 5.3, 0.38, 0.08, '#d6ad4f', group);
  for (const x of [7.8, 8.6, 9.4, 10.2]) round(x, 1.94, 6.44, 0.075, 0.45, ['#8aab68', '#d4ad60'][Math.round(x) % 2], group);
  const kioskLight = new THREE.PointLight('#ffd080', 20, 10, 1.4);
  kioskLight.position.set(9, 2.4, 5.8);
  group.add(kioskLight);
  person(kit, group, 4, -6, '#d0a244', '#355eac', { y: 0.84, rotation: -0.4, gesture: true });
  person(kit, group, 1.5, -0.65, '#4778c7', '#263f70', { seated: true, y: 0.91, rotation: 0.3 });
  person(kit, group, 6, 2.55, '#d4a34a', '#3970ba', { seated: true, y: 0.91, rotation: -0.2, skin: '#6f4533' });
  person(kit, group, -1, 5.8, '#c77594', '#d0c2ae', { rotation: -0.7, skin: '#83543b', gesture: true });
  person(kit, group, -2.5, 7, '#496db5', '#806a4c', { rotation: 1.4 });
  person(kit, group, -6.2, 3.2, '#9eaeb4', '#333740', { rotation: 0.7, skin: '#674631' });
  person(kit, group, 6.8, 5.2, '#619489', '#293e54', { rotation: 2.2 });
  person(kit, group, 10.2, 5, '#d2b976', '#589093', { rotation: -1.6, skin: '#68422f' });
  return { group, background: '#182a25' };
}

function library(kit) {
  const { THREE, box, round, sphere } = kit;
  const group = new THREE.Group();
  box(0, -0.2, 0, 28, 0.4, 26, '#333544', group);
  box(0, 3, -10, 24, 6, 0.35, '#42445d', group);
  box(-11.5, 3, -2, 0.35, 6, 16, '#3e4259', group);
  for (const x of [-7, 0, 7]) {
    box(x, 2.25, -9.5, 5.5, 4.5, 0.75, '#615354', group);
    for (const y of [0.9, 2.1, 3.3]) {
      box(x, y, -8.9, 5.3, 0.12, 0.8, '#a18c79', group);
      for (let i = 0; i < 7; i++) box(x - 2.3 + i * 0.7, y + 0.44, -9, 0.4, 0.76, 0.43, ['#768f91', '#b6867c', '#9c986c', '#7b7394'][i % 4], group);
    }
  }
  for (const x of [-5.5, 5.5]) {
    box(x, 0.7, 2, 5, 0.9, 2, '#776789', group);
    box(x, 1.35, 1.2, 5, 1.3, 0.4, '#8d7ca0', group);
    for (const side of [-1, 1]) box(x + side * 2.3, 1, 2, 0.4, 1.1, 2.1, '#665b7b', group);
    round(x, 0.8, 5, 1.2, 0.15, '#a59b89', group);
    round(x, 0.38, 5, 0.15, 0.7, '#665f6c', group);
  }
  round(0, 0.035, 0, 3.8, 0.06, '#4f6173', group);
  sphere(0, 5.6, -1, 0.62, '#a5acbf', group);
  const violet = new THREE.PointLight('#c794fa', 55, 22, 1.3);
  violet.position.set(0, 5, 0);
  group.add(violet);
  lamp(kit, group, -9, 5);
  person(kit, group, -5.6, 2.2, '#dfb665', '#475e7b', { seated: true, y: 0.93 });
  person(kit, group, 5.5, 2.2, '#bd7e9b', '#454452', { seated: true, y: 0.93, rotation: -0.2 });
  person(kit, group, 0, -3, '#657fb2', '#35445b', { rotation: 0.6, gesture: true });
  return { group, background: '#252b3b' };
}

/** Plain ground and a marker, for venues whose scene has not been built yet. */
function generic(kit) {
  const { THREE, box, round } = kit;
  const group = new THREE.Group();
  box(0, -0.25, 0, 30, 0.5, 28, '#3e5141', group);
  round(0, 0.4, 0, 3, 0.8, '#796a5a', group);
  return { group, background: '#182a25' };
}

export const SCENES = { park, library, generic };

export function buildVenueScene(kit, venue) {
  return (SCENES[venue?.scene?.kind] || SCENES.generic)(kit, venue);
}
