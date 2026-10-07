/**
 * OWNER: neighbourhood
 * One canonical row of actual homes and owned yard plots. Every viewer uses the same absolute
 * coordinates; only the camera starts at their own door. Real room peers keep cached avatar rigs.
 */
import type * as THREE from 'three';
import { ESTATE, HOUSE_DESIGNS, HOUSE_STYLE, unpackStyle } from '../game/content/world.ts';
import type { HouseStyle, HouseTierId, LifeState } from '../types/life.ts';
import type { WorldStreetResponse } from '../types/world.ts';
import type { HostRest, HostScene, HostWalk, PlayerLook } from '../venue-world.ts';
import { buildAvatar, poseAvatar } from './characters.ts';
import type { AvatarGroup, Pose } from './characters.ts';
import { createBatch, releaseObjects, sceneMaterials } from './build.ts';
import type { Kit } from './kit.ts';
import { createWalkGrid } from './movement.ts';
import type { WalkRect } from './movement.ts';
import type { SceneCamera, ScenePerson, SceneTag } from './types.ts';
import { ROW_HALF_WIDTH, ROW_PITCH, rowX, streetRow } from '../game/neighbourhood-space.ts';
import { plotOf } from '../game/home-layout.ts';

const HOME_DOOR = { x: 0, z: -6.25, ry: Math.PI, direction: 'inside' as const };
const ENTRANCE = { x: 0, y: 0, z: -3.25, ry: 0 };
const BOUNDS: WalkRect = [-ROW_HALF_WIDTH, -18, ROW_HALF_WIDTH, 11];
const CAMERA: SceneCamera = { landscape: [15, 12, 17], portrait: [9, 10, 15], start: 1.25 };
const DEFAULT_WALL = '#e6cf9f', DEFAULT_ROOF = '#a85c40', DEFAULT_DOOR = '#6b4a2b';

function houseColour(style: HouseStyle, field: 'wall' | 'roof' | 'door', fallback: string): string {
  return HOUSE_STYLE[field][style[field]]?.hex ?? fallback;
}

function drawHouse(b: ReturnType<typeof createBatch>, x: number, front: number, width: number, depth: number, wall: string, roof: string, door: string, main: boolean, floors = 1): void {
  const back = front - depth, half = width / 2, wallHeight = floors * 3.4;
  const leftDoor = main ? 0.78 : 0.55, doorWidth = main ? 1.56 : 1.1;
  const wallDepth = 0.24;
  if (!main) b.box(x, wallHeight / 2, back + depth / 2, width, wallHeight, depth, wall);
  // The front facade is split around the door so the walking grid's clear approach is real.
  b.box(x - (half + leftDoor) / 2, wallHeight / 2, front, half - leftDoor, wallHeight, wallDepth, wall);
  b.box(x + (half + leftDoor) / 2, wallHeight / 2, front, half - leftDoor, wallHeight, wallDepth, wall);
  b.box(x, (wallHeight + 2.45) / 2, front, doorWidth, wallHeight - 2.45, wallDepth, wall);
  b.box(x - half, wallHeight / 2, back + depth / 2, wallDepth, wallHeight, depth, wall);
  b.box(x + half, wallHeight / 2, back + depth / 2, wallDepth, wallHeight, depth, wall);
  b.box(x, wallHeight / 2, back, width, wallHeight, wallDepth, wall);

  for (let floor = 1; floor < floors; floor++) {
    const y = floor * 3.4;
    b.box(x, y, front, width, 0.16, 0.3, '#e2d6bf');
    for (const side of [-1, 1]) {
      b.box(x + side * 2.2, y + 1.75, front - 0.14, 1.6, 1.2, 0.08, '#805a37');
      b.box(x + side * 2.2, y + 1.75, front - 0.085, 1.4, 1.02, 0.04, '#b8d8e7');
    }
  }
  b.box(x, wallHeight + 0.28, back + depth / 2, width + 0.5, 0.56, depth + 0.5, roof);
  b.box(x, wallHeight + 0.58, back + depth / 2, width + 0.5, 0.12, depth + 0.5, '#e2d6bf');
  if (main) {
    b.box(x, 1.12, front - 0.14, 1.28, 2.18, 0.1, door);
    b.box(x + 0.38, 1.1, front - 0.075, 0.07, 0.12, 0.08, '#dfbd64');
    b.box(x - 2.55, 2.35, front - 0.14, 1.6, 1.15, 0.08, '#805a37');
    b.box(x - 2.55, 2.35, front - 0.085, 1.42, 0.94, 0.04, '#b8d8e7');
    b.box(x + 2.55, 2.35, front - 0.14, 1.6, 1.15, 0.08, '#805a37');
    b.box(x + 2.55, 2.35, front - 0.085, 1.42, 0.94, 0.04, '#b8d8e7');
    b.box(x, 3.25, front - 0.18, 1.8, 0.14, 0.12, '#f0d99a');
  } else {
    b.box(x, 1.0, front - 0.15, 1.0, 1.95, 0.08, '#75543a');
    b.box(x - 2, 2.05, front - 0.15, 1.25, 0.9, 0.08, '#805a37');
    b.box(x - 2, 2.05, front - 0.1, 1.1, 0.72, 0.04, '#b8d8e7');
    b.box(x + 2, 2.05, front - 0.15, 1.25, 0.9, 0.08, '#805a37');
    b.box(x + 2, 2.05, front - 0.1, 1.1, 0.72, 0.04, '#b8d8e7');
  }
}


interface StreetPeer {
  id: string; name: string; lookKey: string; avatar: AvatarGroup;
  x: number; z: number; fromX: number; fromZ: number; targetX: number; targetZ: number;
  progress: number; duration: number; phase: number; tag: SceneTag; person: ScenePerson;
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const tierFloors = (tier: HouseTierId): number => plotOf(HOUSE_DESIGNS[tier].grid, true).floors;

export function buildNeighbourhoodScene(kit: Kit): HostScene {
  const { THREE } = kit, group = new THREE.Group(), scenery = new THREE.Group();
  group.add(scenery);
  const avatar: AvatarGroup = buildAvatar(kit, null, { rig: true, seed: 'neighbourhood-player', marker: 'crown' });
  group.add(avatar);
  let avatarDispose = avatar.userData.dispose;
  let avatarLook: unknown = null, avatarSeed = 'neighbourhood-player', playerName = '', pose: Pose = 'stand';
  let sceneryObjects: (THREE.Mesh | THREE.PointLight)[] = [];
  let street: WorldStreetResponse | null = null, streetKey = '', signature = '', anchor: number | null = null, ownFloors = 1;
  let currentStyle: HouseStyle = { shape: 0, wall: 2, roof: 0, door: 0, windows: 0, fence: 1, yard: 0, sign: 0 };
  const peers = new Map<string, StreetPeer>();
  let easing = false, crowdKey = '';
  const ownX = (): number => anchor === null ? 0 : rowX(anchor);
  const entrance = () => ({ ...ENTRANCE, x: ownX() });
  function frontages(): { x: number; plot: number | null; style: HouseStyle; floors: number; land: number[] }[] {
    const current = street;
    if (!current) return [{ x: ownX(), plot: anchor, style: currentStyle, floors: ownFloors, land: [] }];
    const houses = current.houses.filter(house => Number.isInteger(house.plot) && streetRow(house.plot) === streetRow(current.anchor.plot)).slice(0, ESTATE.plots).sort((a, b) => a.plot - b.plot);
    const occupied = new Set(houses.map(house => house.plot));
    return houses.map(house => {
      const look = unpackStyle(house.style);
      const land = [...new Set(house.land ?? [])].filter(plot => Number.isInteger(plot) && plot >= 0 && plot < ESTATE.streets * ESTATE.plots && streetRow(plot) === streetRow(house.plot) && !occupied.has(plot)).slice(0, 3).sort((a, b) => a - b);
      return { x: rowX(house.plot), plot: house.plot, style: look.style, floors: tierFloors(look.tier), land };
    });
  }
  const neighbours = () => { const current = street; return current ? current.houses.filter(house => Number.isInteger(house.plot) && streetRow(house.plot) === streetRow(current.anchor.plot) && house.plot !== current.anchor.plot) : []; };
  function compounds(): { left: number; right: number; gate: number }[] {
    return frontages().map(house => {
      if (house.plot === null) return { left: house.x - ROW_PITCH / 2, right: house.x + ROW_PITCH / 2, gate: house.x };
      // Only a chain attached to this actual house forms its compound; never fence over a vacant gap.
      let first = house.plot, last = house.plot;
      while (house.land.includes(first - 1)) first--;
      while (house.land.includes(last + 1)) last++;
      return { left: rowX(first) - ROW_PITCH / 2, right: rowX(last) + ROW_PITCH / 2, gate: house.x };
    });
  }
  const fences = (): WalkRect[] => compounds().flatMap(({ left, right, gate }) => [
    [left + 0.15, -14, left + 0.42, -1.65], [right - 0.42, -14, right - 0.15, -1.65],
    [left + 0.15, -14.15, right - 0.15, -13.88],
    [left + 0.15, -1.9, gate - 1.45, -1.62], [gate + 1.45, -1.9, right - 0.15, -1.62],
  ]);
  const lamps = Array.from({ length: Math.ceil(ESTATE.plots / 3) }, (_, i) => rowX(i * 3) + 5);
  const makeGrid = () => createWalkGrid({ bounds: BOUNDS, cell: 0.3, radius: 0.32, entrance: [ownX(), ENTRANCE.z, ENTRANCE.ry], block: [
    ...frontages().map((house): WalkRect => [house.x - 4.52, -13.3, house.x + 4.52, -7]), ...fences(),
    ...lamps.map((x): WalkRect => [x - 0.2, -0.7, x + 0.2, -0.3]),
  ] });
  let grid = makeGrid();

  function render(): void {
    releaseObjects(sceneryObjects); sceneryObjects = [];
    const b = createBatch(THREE), width = ROW_HALF_WIDTH * 2;
    b.box(0, -0.2, -3.5, width, 0.24, 29, '#7f9a71');
    b.box(0, 0.015, -0.45, width, 0.08, 2.4, '#d7c7a4');
    b.box(0, 0.02, 1.4, width, 0.1, 1.2, '#c3b48f');
    b.box(0, -0.03, 2.22, width, 0.1, 0.24, '#736f61');
    b.box(0, -0.04, 6.7, width, 0.08, 7.9, '#5e625e');
    for (let x = -ROW_HALF_WIDTH + 3; x <= ROW_HALF_WIDTH - 3; x += 6) b.box(x, 0.01, 6.7, 2.8, 0.015, 0.12, '#c5b889');
    b.box(0, 0.06, 2.6, width, 0.1, 0.28, '#b6a786');
    b.box(0, 0.06, 10.72, width, 0.1, 0.28, '#b6a786');
    for (const z of [-2.6, 2.6]) b.box(81, 1.5, z, 0.35, 3, 0.35, '#73553b');
    b.box(81, 3, 0, 0.35, 0.3, 5.55, '#73553b');
    for (const house of frontages()) {
      drawHouse(b, house.x, -7.15, 8.8, 6.1, houseColour(house.style, 'wall', DEFAULT_WALL), houseColour(house.style, 'roof', DEFAULT_ROOF), houseColour(house.style, 'door', DEFAULT_DOOR), true, house.floors);
      for (const plot of house.land) b.box(rowX(plot), -0.01, -7.8, 11.5, 0.12, 11.9, '#8baf76');
    }
    for (const [x0, z0, x1, z1] of fences()) {
      const x = (x0 + x1) / 2, z = (z0 + z1) / 2;
      b.box(x, 0.46, z, x1 - x0, 0.92, z1 - z0, '#c8b592');
      b.box(x, 0.96, z, x1 - x0 + 0.05, 0.12, z1 - z0 + 0.05, '#73553b');
    }
    for (const compound of compounds()) for (const side of [-1, 1]) {
      const x = compound.gate + side * 1.08;
      b.box(x, 0.68, -1.72, 0.1, 0.84, 1.55, '#8b6b48', { ry: side * 0.58 });
    }
    for (const x of lamps) {
      b.cyl(x, 0.62, -0.5, 0.12, 1.24, '#5d5142');
      b.cyl(x, 1.28, -0.5, 0.46, 0.08, '#d5c29d');
      b.cyl(x, 1.48, -0.5, 0.32, 0.38, '#e9c97c', { seg: 8, top: 0.88 });
      b.light(x, 1.52, -0.5, '#ffe3a0', 4, 7);
    }
    const built = b.build(sceneMaterials(kit));
    sceneryObjects = [...built.meshes, ...built.lights];
    sceneryObjects.forEach(object => scenery.add(object));
  }
  render();

  function placePeer(peer: StreetPeer): void {
    peer.avatar.position.set(peer.x, 0, peer.z);
    peer.tag.position.x = peer.person.x = peer.x; peer.tag.position.z = peer.person.z = peer.z;
  }
  function dropPeer(peer: StreetPeer): void { peer.avatar.userData.dispose(); peers.delete(peer.id); }
  function setCrowd(value: unknown): boolean {
    const incoming: { id: string; name: string; x: number; z: number; look: unknown; seed: string }[] = [];
    const seen = new Set<string>();
    if (Array.isArray(value)) for (const person of value.slice(0, 12)) {
      if (incoming.length >= 12) break;
      if (!record(person) || person.kind !== 'player' || typeof person.id !== 'string' || !person.id || person.id === avatarSeed || seen.has(person.id) || typeof person.name !== 'string' || !finite(person.x) || !finite(person.z)) continue;
      seen.add(person.id);
      incoming.push({ id: person.id, name: person.name, x: Math.max(BOUNDS[0], Math.min(BOUNDS[2], person.x)), z: Math.max(BOUNDS[1], Math.min(BOUNDS[3], person.z)), look: person.look ?? null, seed: typeof person.seed === 'string' ? person.seed : person.id });
    }
    const key = JSON.stringify(incoming);
    if (key === crowdKey) return false;
    crowdKey = key;
    for (const peer of peers.values()) if (!seen.has(peer.id)) dropPeer(peer);
    for (const person of incoming) {
      const lookKey = JSON.stringify([person.look, person.seed]);
      let peer = peers.get(person.id);
      if (peer && peer.lookKey !== lookKey) { dropPeer(peer); peer = undefined; }
      if (!peer) {
        const body = buildAvatar(kit, person.look, { rig: true, seed: person.seed, marker: 'player' });
        const top = body.userData.top;
        peer = { id: person.id, name: person.name, lookKey, avatar: body, x: person.x, z: person.z, fromX: person.x, fromZ: person.z, targetX: person.x, targetZ: person.z, progress: 1, duration: 0.2, phase: 0,
          tag: { id: person.id, kind: 'player', name: person.name, text: `@${person.name}`, marker: 'tag', position: { x: person.x, y: top, z: person.z } },
          person: { id: person.id, kind: 'player', x: person.x, z: person.z, top } };
        peers.set(person.id, peer); group.add(body); placePeer(peer);
      }
      peer.name = peer.tag.name = person.name; peer.tag.text = `@${person.name}`;
      if (Math.hypot(peer.targetX - person.x, peer.targetZ - person.z) > 0.01) {
        peer.fromX = peer.x; peer.fromZ = peer.z; peer.targetX = person.x; peer.targetZ = person.z;
        const distance = Math.hypot(peer.targetX - peer.x, peer.targetZ - peer.z);
        peer.duration = Math.max(0.14, Math.min(0.35, distance / 3.92)); peer.progress = distance > 24 ? 1 : 0;
        if (peer.progress === 1) { peer.x = person.x; peer.z = person.z; placePeer(peer); poseAvatar(peer.avatar, { pose: 'stand' }); }
      }
    }
    easing = [...peers.values()].some(peer => peer.progress < 1);
    return true;
  }
  function stepCrowd(dt: number): boolean {
    const step = finite(dt) ? Math.max(0, Math.min(dt, 0.08)) : 0;
    for (const peer of peers.values()) {
      if (peer.progress >= 1) continue;
      const beforeX = peer.x, beforeZ = peer.z;
      peer.progress = Math.min(1, peer.progress + step / peer.duration);
      peer.x = peer.fromX + (peer.targetX - peer.fromX) * peer.progress; peer.z = peer.fromZ + (peer.targetZ - peer.fromZ) * peer.progress;
      peer.phase = (peer.phase + Math.hypot(peer.x - beforeX, peer.z - beforeZ) / 1.83) % 1;
      const angle = Math.atan2(peer.targetX - peer.fromX, peer.targetZ - peer.fromZ), turn = Math.atan2(Math.sin(angle - peer.avatar.rotation.y), Math.cos(angle - peer.avatar.rotation.y));
      peer.avatar.rotation.y += Math.sign(turn) * Math.min(Math.abs(turn), 14 * step);
      poseAvatar(peer.avatar, { pose: peer.progress < 1 ? 'walk' : 'stand', stride: peer.phase }); placePeer(peer);
    }
    easing = [...peers.values()].some(peer => peer.progress < 1);
    return easing;
  }
  function settleCrowd(): void { for (const peer of peers.values()) { peer.x = peer.targetX; peer.z = peer.targetZ; peer.progress = 1; poseAvatar(peer.avatar, { pose: 'stand' }); placePeer(peer); } easing = false; }

  const walk: HostWalk = {
    get grid() { return grid; }, get entrance() { return entrance(); }, open: true, scale: 1,
    get centre(): [number, number, number] { return [ownX(), 0.9, -2.6]; }, get avatar() { return avatar; }, drive() {},
    rest(): HostRest { return { spot: null, ...entrance(), pose: 'stand', busy: false, leaving: false, fixed: false, approach: null, steps: [] }; },
    spots() { return []; }, things() { return []; }, people() { return [...peers.values()].map(peer => peer.person); },
    get solids() { return [
      ...frontages().map((house): [number, number, number, number, number, number] => [house.x - 4.5, 0, -13.3, house.x + 4.5, house.floors * 3.4, -7]),
      ...fences().map(([x0, z0, x1, z1]): [number, number, number, number, number, number] => [x0, 0, z0, x1, 1.02, z1]),
    ]; },
    move(x, y, z, ry) { avatar.position.set(x, y, z); avatar.rotation.y = ry; },
    pose(name = 'stand') { const next: Pose = name === 'sit' || name === 'walk' || name === 'wave' || name === 'work' || name === 'dance' || name === 'relax' || name === 'jog' ? name : 'stand'; if (pose === next) return false; pose = next; poseAvatar(avatar, { pose }); return true; },
    gait(_step, phase = 0, jog = false) { pose = jog ? 'jog' : 'walk'; poseAvatar(avatar, { pose, stride: finite(phase) ? ((phase / (2 * Math.PI)) % 1 + 1) % 1 : 0 }); return true; },
    heightAt() { return 0; }, near() { return false; }, goal() { return false; },
  };
  return {
    group, camera: CAMERA, background: '#9cc4d2', sky: ['#d2e0d6', '#8eb8c4'], ground: '#7f9a71', walk,
    get homeDoor() { return { ...HOME_DOOR, x: ownX() }; },
    streetGate: { x: 81, z: 0, ry: Math.PI / 2 },
    setStreet(next) {
      const key = JSON.stringify(next ? [next.city, next.anchor, next.land, next.houses.map(house => [house.plot, house.style, house.land, house.owner?.id, house.owner?.name])] : null);
      street = next;
      if (key === streetKey) return false;
      streetKey = key;
      if (next) anchor = next.anchor.plot;
      grid = makeGrid(); render(); return true;
    },
    neighbourDoors: () => neighbours().flatMap(house => house.owner && street ? [{ id: house.owner.id, name: house.owner.name, plot: { ...street.anchor, plot: house.plot }, x: rowX(house.plot), z: HOME_DOOR.z, ry: Math.PI }] : []),
    tags: () => [
      { id: 'city-gate', kind: 'city-gate', name: 'Explore city streets', text: 'City streets', marker: 'tag', position: { x: 81, y: 3.6, z: 0 } },
      { id: 'home-door', kind: 'home-door', name: 'Go inside', text: 'Go inside', marker: 'tag', position: { x: ownX(), y: 2.6, z: HOME_DOOR.z } },
      ...neighbours().flatMap(house => house.owner ? [{ id: `door:${house.owner.id}`, kind: 'neighbour-door', name: `${house.owner.name}'s home`, text: `${house.owner.name}'s home`, marker: 'tag', position: { x: rowX(house.plot), y: 2.6, z: HOME_DOOR.z } }] : []),
      ...[...peers.values()].map(peer => peer.tag),
      ...(playerName ? [{ id: 'self', kind: 'self', text: playerName, name: playerName, marker: 'crown', colour: '#ffd34d', position: { x: avatar.position.x, y: avatar.position.y + 3, z: avatar.position.z } }] : []),
    ],
    setCrowd, get easing() { return easing; }, stepCrowd, settleCrowd,
    setPlayer({ look, seed, name }: Partial<PlayerLook>) {
      let changed = false, appearance = false;
      if (look !== undefined && JSON.stringify(look) !== JSON.stringify(avatarLook)) { avatarLook = look; changed = appearance = true; }
      if (seed !== undefined && seed !== avatarSeed) { avatarSeed = seed; changed = appearance = true; }
      if (name !== undefined && name !== playerName) { playerName = name; changed = true; }
      if (appearance) {
        const next = buildAvatar(kit, avatarLook, { rig: true, seed: avatarSeed, marker: 'crown' }), parent = avatar.parent;
        parent?.remove(avatar); avatarDispose(); avatar.clear();
        for (const child of [...next.children]) avatar.add(child);
        avatar.userData = next.userData; avatarDispose = next.userData.dispose; next.clear(); parent?.add(avatar);
      }
      return changed;
    },
    update(state: LifeState) {
      const next = JSON.stringify([state.estate.style, state.estate.tier, state.estate.living, state.estate.plot]);
      if (next === signature) return false;
      signature = next; currentStyle = state.estate.style; ownFloors = state.estate.living === 'own' ? tierFloors(state.estate.tier) : 1;
      if (state.estate.plot) anchor = state.estate.plot.plot;
      grid = makeGrid(); render(); return true;
    },
    look() { return false; },
    dispose() { for (const peer of peers.values()) dropPeer(peer); releaseObjects(sceneryObjects); avatarDispose(); group.parent?.remove(group); },
  } satisfies HostScene;
}
