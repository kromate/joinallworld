/**
 * OWNER: neighbourhood
 * One canonical row of actual homes and owned yard plots. Every viewer uses the same absolute
 * coordinates; only the camera starts at their own door. Real room peers keep cached avatar rigs.
 */
import type * as THREE from 'three';
import { ESTATE, HOUSE_STYLE, lgaOf, lgasOf } from '../game/content/world.ts';
import { cachedCityContent, cityRules } from '../game/cities/registry.ts';
import { CLEAR_LOOK, lookAt, lookKey } from '../game/conditions/look.ts';
import type { LookConditions } from '../game/conditions/look.ts';
import type { Weather } from './fx/weather.ts';
import { withWetQuery } from './weather-query.ts';
import { unpackStyle } from './house-style.ts';
import type { HouseStyle, HouseTierId, LifeState } from '../types/life.ts';
import type { WorldStreetResponse } from '../types/world.ts';
import type { HostRest, HostScene, HostWalk, PlayerLook } from '../venue-world.ts';
import type { Pose } from './characters.ts';
import { createBody } from './body/skinned.ts';
import type { SkinnedBody } from './body/skinned.ts';
import { createBatch, hash, releaseObjects, sceneMaterials } from './build.ts';
import type { Kit } from './kit.ts';
import { createWalkGrid } from './movement.ts';
import { lightingFor, timeOfDay } from './lighting.ts';
import type { SceneCamera, ScenePerson, SceneTag, TimeOfDay } from './types.ts';
import { ROW_HALF_WIDTH, rowX, streetRow } from '../game/neighbourhood-space.ts';
import { bodyAllowed, drawsWebGL2 } from './body/gate.ts';
import { createModelCache, createModelLayer } from './models/scene-models.ts';
import type { ModelCache, ModelLayer } from './models/scene-models.ts';
import { boxOf, fileKey, familyOf, hasFar, WINDOW_TILES } from './street/street-kit.ts';
import { BOUNDS, BUS_STOP, Z, planStreet, sceneryMix } from './street/street-plan.ts';
import type { PlanHouse, StreetPlan } from './street/street-plan.ts';
import { drawDanfo, drawKeke, drawLampGlow, drawPole, drawPoleAdverts, drawRoadBillboard, drawWires, standInFor, tone } from './street/street-standins.ts';
import type { FrameGuard, Lane, StreetChoice } from './street-life/plan.ts';
import type { StreetLife } from './street-life/draw.ts';
import type { StreetScenery } from './street-life/scenery.ts';
import type { CrossingSpec } from './street-life/furniture.ts';
import type { StreetLayout } from './street-life/street-scene.ts';

const HOME_DOOR = { x: 0, z: -6.25, ry: Math.PI, direction: 'inside' as const };
const ENTRANCE = { x: 0, y: 0, z: -3.25, ry: 0 };
const CAMERA: SceneCamera = { landscape: [15, 12, 17], portrait: [9, 10, 15], start: 1.25 };
/** What the street's model meshes may cost on top of the road and the walls (a venue scene is 17,000 triangles and 60 draw calls with its crowd). */
const MODEL_BUDGET = { triangles: 11500, drawCalls: 20 };
const FENCE_COLOUR = ['#d9c9a6', '#5d9a62', '#f6f2e6', '#c9c2b0'];
/** How lit the windows are by the time of day. */
const WINDOW_GLOW: Record<TimeOfDay, number> = { day: 0, dusk: 0.8, night: 1.5 };
const NO_MODELS: ModelCache = createModelCache({ load: () => Promise.reject(new Error('No models')), texture: () => null });
/**
 * Street life (src/scene/street-life): people along the kerb of the near pavement (they step aside round the player), on the far pavement
 * clear of the poles' line, and traffic both ways on the country's side of the road (zoom phase 5b: street-life/street-scene.ts
 * homeStreet) between the parked danfo and keke. Moves only inside a window of frames opened by the player's own movement (the venue
 * layer's rule).
 */
const STREET_LANES: readonly Lane[] = Object.freeze([
  { ax: -ROW_HALF_WIDTH, az: Z.kerb - 0.7, bx: ROW_HALF_WIDTH, bz: Z.kerb - 0.7, width: 0.9 },
  { ax: -ROW_HALF_WIDTH, az: Z.farKerb + 1.55, bx: ROW_HALF_WIDTH, bz: Z.farKerb + 1.55, width: 1.1 },
  // The pavement by the shop windows across the road: people who stop on it turn to the windows (+z).
  { ax: -ROW_HALF_WIDTH, az: Z.pavement1 - 0.55, bx: ROW_HALF_WIDTH, bz: Z.pavement1 - 0.55, width: 0.9, browse: 0 },
]);
/**
 * The crossings (zoom phase 3b): the junction's zebra (painted by render()) and one mid-street, whose stripes street life paints. People
 * wait on the pavements and cross while the lights stop the traffic (street-life/crowd.ts).
 */
const CROSSING_X = [78, 10] as const;
const STREET_CROSSINGS: readonly Lane[] = Object.freeze(CROSSING_X.map(x => ({ ax: x, az: Z.kerb - 0.35, bx: x, bz: Z.farKerb + 0.35, width: 2.4 })));
const CROSSING_SPECS: readonly CrossingSpec[] = Object.freeze(CROSSING_X.map(x => ({ x, z0: Z.kerb, z1: Z.farKerb, paint: x !== 78 })));
/** The parked danfo and keke, pulled in to the kerbs so the two lanes of moving traffic pass between them (zoom phase 5b). */
const PARKED = Object.freeze({ keke: Z.road0 + 0.8, danfoFar: Z.road1 - 1.1, danfoNear: Z.road0 + 1.1 });
const STREET_WINDOW_S = 12;


interface StreetPeer {
  id: string; name: string; lookKey: string; avatar: SkinnedBody;
  x: number; z: number; fromX: number; fromZ: number; targetX: number; targetZ: number;
  progress: number; duration: number; phase: number; tag: SceneTag; person: ScenePerson;
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function buildNeighbourhoodScene(kit: Kit): HostScene {
  let streetTime: TimeOfDay = 'day';
  const { THREE } = kit, group = new THREE.Group(), scenery = new THREE.Group();
  group.add(scenery);
  let avatar = createBody(kit, null, 'neighbourhood-player', 1);
  avatar.show('idle', false);
  group.add(avatar.object);
  let avatarLook: unknown = null, avatarSeed = 'neighbourhood-player', playerName = '', pose: Pose = 'stand';
  let sceneryObjects: (THREE.Mesh | THREE.PointLight)[] = [], nightMeshes: THREE.Mesh[] = [];
  let street: WorldStreetResponse | null = null, streetKey = '', signature = '', anchor: number | null = null, ownTier: HouseTierId = 'starter', cityId = '';
  let currentStyle: HouseStyle = { shape: 0, wall: 2, roof: 0, door: 0, windows: 0, fence: 1, yard: 0, sign: 0 };
  const peers = new Map<string, StreetPeer>();
  let easing = false, crowdKey = '';
  // The street's models: the layer draws them (and the procedural stand-in for any that is not here yet); the cache is read once per kit.
  let models: ModelCache = NO_MODELS, layer: ModelLayer | null = null, modelsStarted = false, disposed = false, notify: (() => void) | null = null;
  let focusX = 0, focusZ = 0;
  let dressing: StreetScenery | null = null, sceneryModule: typeof import('./street-life/scenery.ts') | null = null;
  let streetLife: StreetLife | null = null, streetChoice: StreetChoice | null = null, streetGuard: FrameGuard | null = null, streetWindow = 0, streetDropped = false;
  let streetLayout: StreetLayout | null = null, forget: ((layout: StreetLayout | null) => void) | null = null;
  let lit: THREE.MeshStandardMaterial[] = [];
  // The weather (src/scene/fx, one lazy chunk): rain on the street, none under the houses' roofs. A dry street never loads it. It asks for no frames
  // of its own: it moves in the same window as the street's people (stepAmbient below). True when the conditions changed.
  let weatherFx: Weather | null = null, weatherAsked = false, wetNow: LookConditions = CLEAR_LOOK;
  function syncWeather(state: LifeState): boolean {
    const city = state.estate.city, next = finite(state.t) ? withWetQuery(lookAt(city, null, cityRules(city)?.climate, state.t)) : wetNow;
    const changed = lookKey(next) !== lookKey(wetNow);
    wetNow = next;
    if (weatherFx) { weatherFx.setTime(streetTime); weatherFx.update(wetNow); return changed; }
    if (!wetNow.wet || weatherAsked || disposed) return changed;
    weatherAsked = true;
    void import('./fx/index.ts').then((fx) => fx.loadFxHere()).then(({ tier, weather: fx }) => {
      if (disposed) return;
      weatherFx = fx.createWeather({ THREE, parent: group, tier, time: streetTime, roofs: { boxes: plan.solids, bounds: [BOUNDS[0] - 8, BOUNDS[1] - 8, BOUNDS[2] + 8, BOUNDS[3] + 8], buildings: true } });
      weatherFx.update(wetNow); notify?.();
    }).catch(() => { weatherAsked = false; });
    return changed;
  }
  const masks = new Map<string, THREE.Texture | null>();
  const ownX = (): number => anchor === null ? 0 : rowX(anchor);
  const entrance = () => ({ ...ENTRANCE, x: ownX() });
  function frontages(): PlanHouse[] {
    const current = street;
    if (!current) return [{ x: ownX(), plot: anchor, tier: ownTier, wall: currentStyle.wall, roof: currentStyle.roof, door: currentStyle.door, fence: currentStyle.fence, yard: currentStyle.yard, land: [], own: true }];
    const houses = current.houses.filter(house => Number.isInteger(house.plot) && streetRow(house.plot) === streetRow(current.anchor.plot)).slice(0, ESTATE.plots).sort((a, b) => a.plot - b.plot);
    const occupied = new Set(houses.map(house => house.plot));
    return houses.map(house => {
      const look = unpackStyle(house.style);
      const land = [...new Set(house.land ?? [])].filter(plot => Number.isInteger(plot) && plot >= 0 && plot < ESTATE.streets * ESTATE.plots && streetRow(plot) === streetRow(house.plot) && !occupied.has(plot)).slice(0, 3).sort((a, b) => a - b);
      return { x: rowX(house.plot), plot: house.plot, tier: look.tier, wall: look.style.wall, roof: look.style.roof, door: look.style.door, fence: look.style.fence, yard: look.style.yard, land, own: house.plot === current.anchor.plot };
    });
  }
  const neighbours = () => { const current = street; return current ? current.houses.filter(house => Number.isInteger(house.plot) && streetRow(house.plot) === streetRow(current.anchor.plot) && house.plot !== current.anchor.plot) : []; };
  /** The street as a list of models, walls and blockers. What the city has (its venues' kinds, how dear its land is) picks the scenery. */
  function planNow(): StreetPlan {
    const city = street?.city ?? cityId, lgas = lgasOf(city), lga = lgaOf(city, street?.anchor.lga);
    const lands = lgas.map(unit => unit.land).sort((a, b) => a - b);
    const dear = Boolean(lga && lands.length > 1 && lga.land >= (lands[Math.floor(lands.length / 2)] ?? 0));
    const kinds = (cachedCityContent(city)?.venues ?? []).map(item => ({ kind: item.definition.scene.kind as string, variant: item.definition.scene.variant as string | undefined }));
    const seed = street ? `${street.anchor.lga}/${street.anchor.estate}/${streetRow(street.anchor.plot)}` : `home/${anchor ?? 0}`;
    return planStreet({ houses: frontages(), seed, mix: sceneryMix(kinds, dear) });
  }
  let plan = planNow();
  // The walk grid, and on top of it the street life's people near the player as moving circles (draw.ts blocks): the avatar slides
  // round them as round a wall. `floor` is the grid alone (where the street's own bodies may stand).
  const makeGrid = () => {
    const base = createWalkGrid({ bounds: BOUNDS, cell: 0.3, radius: 0.32, entrance: [ownX(), ENTRANCE.z, ENTRANCE.ry], block: plan.blocks });
    return { ...base, floor: base.free, free: (x: number, z: number) => base.free(x, z) && !streetLife?.blocks(x, z, avatar.object.position) };
  };
  let grid = makeGrid();

  /** A mask that is white over the windows of an atlas family, so they can be lit at dusk and night. */
  function windowMask(family: 'street' | 'older'): THREE.Texture | null {
    if (masks.has(family)) return masks.get(family)!;
    let texture: THREE.Texture | null = null;
    const canvas = globalThis.document?.createElement?.('canvas');
    const g = canvas?.getContext?.('2d');
    if (canvas && g) {
      canvas.width = canvas.height = 256;
      g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256); g.fillStyle = '#fff';
      for (const [x, y, w, h] of WINDOW_TILES[family]) g.fillRect(x / 4, y / 4, w / 4, h / 4);
      texture = new THREE.CanvasTexture(canvas); texture.flipY = false;
    }
    masks.set(family, texture);
    return texture;
  }
  const decorate = (material: THREE.Material, atlas: string): void => {
    const family = familyOf(atlas), mask = family ? windowMask(family) : null;
    if (!mask) return;
    const m = material as THREE.MeshStandardMaterial;
    m.emissiveMap = mask; m.emissive.set('#ffd9a0'); m.emissiveIntensity = WINDOW_GLOW[streetTime];
    lit.push(m);
  };
  const light = (): void => { for (const material of lit) material.emissiveIntensity = WINDOW_GLOW[streetTime]; for (const mesh of nightMeshes) mesh.visible = streetTime !== 'day'; dressing?.setTime(streetTime); };
  const lifeSeed = (): string => street ? `${street.anchor.lga}/${street.anchor.estate}/${streetRow(street.anchor.plot)}` : `home/${anchor ?? 0}`;
  const country = (): string | null => cityRules(street?.city ?? cityId)?.country.id ?? null;
  /** Street life's scenery (phase 3b): shopfronts on the plan's shop buildings, furniture along the far kerb. Rebuilt with the plan. */
  function dressStreet(): void {
    dressing?.dispose(); dressing = null;
    if (!sceneryModule || disposed) return;
    const avoid = plan.pieces.filter(item => item.z > Z.farKerb && item.z < Z.farFront + 3).map(item => ({ x: item.x, z: item.z, r: 1.6 }));
    for (let x = -ROW_HALF_WIDTH + 10; x <= ROW_HALF_WIDTH - 6; x += 26) avoid.push({ x, z: Z.farKerb + 0.7, r: 0.6 });
    dressing = sceneryModule.createStreetScenery(kit, { parent: group, frontages: sceneryModule.frontagesOf(plan.pieces, boxOf), seed: lifeSeed(), country: country(), time: streetTime,
      furniture: { half: ROW_HALF_WIDTH, lineZ: Z.farKerb + 0.45, road: -1, base: 0.05, crossings: CROSSING_SPECS, avoid, flagX: 68 } });
  }

  function render(): void {
    releaseObjects(sceneryObjects); sceneryObjects = [];
    layer?.dispose(); layer = null; lit = [];
    const b = createBatch(THREE), width = ROW_HALF_WIDTH * 2, deep = Z.pavement1 - Z.back + 5;
    const slab = (x0: number, z0: number, x1: number, z1: number, top: number, thick: number, colour: string): void => { b.box((x0 + x1) / 2, top - thick / 2, (z0 + z1) / 2, x1 - x0, thick, z1 - z0, colour); };
    slab(-ROW_HALF_WIDTH, Z.back - 1, ROW_HALF_WIDTH, Z.pavement1 + 4, -0.08, 0.24, '#7f9a71');
    // The pavement the gates open onto, the kerb, the road with its markings, the far kerb and pavement.
    slab(-ROW_HALF_WIDTH, Z.pavement0, ROW_HALF_WIDTH, Z.kerb, 0.05, 0.14, '#d3cab6');
    slab(-ROW_HALF_WIDTH, Z.pavement0 - 0.3, ROW_HALF_WIDTH, Z.pavement0, 0.05, 0.14, '#b9b09b');
    slab(-ROW_HALF_WIDTH, Z.kerb, ROW_HALF_WIDTH, Z.road0, 0.13, 0.2, '#bdb6a6');
    slab(-ROW_HALF_WIDTH, Z.road0, ROW_HALF_WIDTH, Z.road1, 0.0, 0.1, '#5a5e5c');
    slab(-ROW_HALF_WIDTH, Z.road1, ROW_HALF_WIDTH, Z.farKerb, 0.13, 0.2, '#bdb6a6');
    slab(-ROW_HALF_WIDTH, Z.farKerb, ROW_HALF_WIDTH, Z.pavement1, 0.05, 0.14, '#d3cab6');
    const mid = (Z.road0 + Z.road1) / 2;
    for (let x = -ROW_HALF_WIDTH + 3; x <= ROW_HALF_WIDTH - 3; x += 6) slab(x - 1.4, mid - 0.07, x + 1.4, mid + 0.07, 0.012, 0.012, '#d9d4b8');
    slab(-ROW_HALF_WIDTH, Z.road0 + 0.05, ROW_HALF_WIDTH, Z.road0 + 0.75, 0.002, 0.004, '#4a4d4b');
    slab(-ROW_HALF_WIDTH, Z.road0 + 0.55, ROW_HALF_WIDTH, Z.road0 + 0.63, 0.012, 0.012, '#d9d4b8');
    slab(-ROW_HALF_WIDTH, Z.road1 - 0.63, ROW_HALF_WIDTH, Z.road1 - 0.55, 0.012, 0.012, '#d9d4b8');
    for (let z = Z.road0 + 1; z < Z.road1 - 0.8; z += 1.1) slab(76.6, z, 79.4, z + 0.65, 0.012, 0.012, '#e9e6d6');
    // The kerb at the junction is painted black and yellow, as Lagos kerbs are by a crossing or a stop; the paint stays off the zebra's strip.
    for (let x = 66, i = 0; x < 92; x += 1.3, i++) if (x < 75.4 || x > 80.6) slab(x, Z.kerb, x + 1.3, Z.road0, 0.137, 0.004, i % 2 ? '#2b2b2b' : '#e8b923');
    // Pavement joints near the gates, a path from every gate to its door, grass on land that belongs to a house.
    for (let x = -ROW_HALF_WIDTH + 2.4; x < ROW_HALF_WIDTH; x += 4.8) slab(x - 0.03, Z.pavement0, x + 0.03, Z.kerb, 0.052, 0.012, '#bdb4a0');
    for (const house of frontages()) slab(house.x - 1.1, Z.front, house.x + 1.1, Z.fence + 0.2, 0.02, 0.1, '#cdbf9f');
    for (const patch of plan.grass) b.box(patch.x, -0.01, -7.8, 11.5, 0.12, 11.9, '#8baf76');
    for (const wall of plan.walls) {
      const [x0, z0, x1, z1] = wall.rect, x = (x0 + x1) / 2, z = (z0 + z1) / 2, colour = FENCE_COLOUR[wall.fence] ?? FENCE_COLOUR[0]!;
      b.box(x, wall.height / 2, z, x1 - x0, wall.height, z1 - z0, colour);
      // A painted band at the foot of a block wall, and a coping on top.
      if (wall.fence !== 1) { b.box(x, 0.16, z, x1 - x0 + 0.08, 0.32, z1 - z0 + 0.08, tone(colour, 0.7)); b.box(x, wall.height + 0.06, z, x1 - x0 + 0.06, 0.12, z1 - z0 + 0.06, '#efe6cf'); }
    }
    // Utility poles with their wires along the far pavement, a pole transformer on every third, and the road's parked traffic.
    const poleZ = Z.farKerb + 0.7, poles: number[] = [];
    for (let x = -ROW_HALF_WIDTH + 10; x <= ROW_HALF_WIDTH - 6; x += 26) poles.push(x);
    poles.forEach((x, i) => { drawPole(b, x, poleZ, i % 3 === 1); if (i % 2 === 0) drawPoleAdverts(b, x, poleZ, i); if (i) drawWires(b, poles[i - 1]!, x, poleZ); });
    drawRoadBillboard(b, -ROW_HALF_WIDTH + 52, Z.farKerb + 2.2);
    // Traffic parked along the road, spread so a few are in view wherever the player's home is.
    drawDanfo(b, -32, PARKED.danfoFar); drawKeke(b, -9, PARKED.keke); drawDanfo(b, 22, PARKED.danfoFar); drawKeke(b, 52, PARKED.keke); drawDanfo(b, -62, PARKED.danfoNear);
    for (const [x, y, z] of plan.lights) b.light(x, y, z, '#ffe3a0', 4, 7);
    void width; void deep;
    // The lamps' heads and the pools of light under them: their own meshes, shown from dusk (the day has no use for them).
    const after = createBatch(THREE);
    for (const [x, y, z] of plan.lights) drawLampGlow(after, x, y - 0.1, z - 0.05);
    const built = b.build(sceneMaterials(kit)), dark = after.build(sceneMaterials(kit));
    nightMeshes = dark.meshes; nightMeshes.forEach(mesh => { mesh.visible = streetTime !== 'day'; });
    sceneryObjects = [...built.meshes, ...dark.meshes, ...built.lights];
    sceneryObjects.forEach(object => scenery.add(object));

    layer = createModelLayer(kit, models, { budget: MODEL_BUDGET, nearRadius: 30, focus: { x: focusX, z: focusZ }, decorate });
    for (const item of plan.pieces) layer.add({ near: fileKey(item.asset, item.palette), far: hasFar(item.asset) ? fileKey(item.asset, item.palette, 'far') : undefined, x: item.x, ...(item.y === undefined ? {} : { y: item.y }), z: item.z, ry: item.ry, scale: item.scale,
      tint: item.tint, ...(item.mode ? { mode: item.mode } : {}), labels: item.labels, priority: item.priority, ...(item.detail ? { detail: true } : {}), standIn: standInFor(item) });
    scenery.add(layer.group);
    layer.build();
    if (models !== NO_MODELS && notify) { const own = layer, changed = notify; void own.load(() => { if (layer === own) { light(); changed(); } }); }
    dressStreet();
  }
  render();

  function placePeer(peer: StreetPeer): void {
    peer.avatar.place(peer.x, 0, peer.z, peer.avatar.object.rotation.y);
    peer.tag.position.x = peer.person.x = peer.x; peer.tag.position.z = peer.person.z = peer.z;
  }
  function dropPeer(peer: StreetPeer): void { peer.avatar.dispose(); peers.delete(peer.id); }
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
        const body = createBody(kit, person.look, person.seed, 1, { detail: 'lod', wardrobeDetail: 'ambient' });
        body.show('idle', false);
        const top = 2.95;
        peer = { id: person.id, name: person.name, lookKey, avatar: body, x: person.x, z: person.z, fromX: person.x, fromZ: person.z, targetX: person.x, targetZ: person.z, progress: 1, duration: 0.2, phase: 0,
          tag: { id: person.id, kind: 'player', name: person.name, text: `@${person.name}`, marker: 'tag', position: { x: person.x, y: top, z: person.z } },
          person: { id: person.id, kind: 'player', x: person.x, z: person.z, top } };
        peers.set(person.id, peer); group.add(body.object); placePeer(peer);
      }
      peer.name = peer.tag.name = person.name; peer.tag.text = `@${person.name}`;
      if (Math.hypot(peer.targetX - person.x, peer.targetZ - person.z) > 0.01) {
        peer.fromX = peer.x; peer.fromZ = peer.z; peer.targetX = person.x; peer.targetZ = person.z;
        const distance = Math.hypot(peer.targetX - peer.x, peer.targetZ - peer.z);
        peer.duration = Math.max(0.14, Math.min(0.35, distance / 3.92)); peer.progress = distance > 24 ? 1 : 0;
        if (peer.progress === 1) { peer.x = person.x; peer.z = person.z; placePeer(peer); peer.avatar.show('idle', false); }
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
      peer.phase = (peer.phase + Math.hypot(peer.x - beforeX, peer.z - beforeZ) / peer.avatar.cycleDistance(false)) % 1;
      const angle = Math.atan2(peer.targetX - peer.fromX, peer.targetZ - peer.fromZ), turn = Math.atan2(Math.sin(angle - peer.avatar.object.rotation.y), Math.cos(angle - peer.avatar.object.rotation.y));
      peer.avatar.object.rotation.y += Math.sign(turn) * Math.min(Math.abs(turn), 14 * step);
      if (peer.progress < 1) peer.avatar.stride(peer.phase * Math.PI * 2, false, 0, true); else peer.avatar.show('idle', false);
      placePeer(peer); peer.avatar.step(step);
    }
    easing = [...peers.values()].some(peer => peer.progress < 1);
    return easing;
  }
  function settleCrowd(): void { for (const peer of peers.values()) { peer.x = peer.targetX; peer.z = peer.targetZ; peer.progress = 1; peer.avatar.show('idle', false); peer.avatar.settle(); placePeer(peer); } easing = false; }

  const walk: HostWalk = {
    get grid() { return grid; }, get entrance() { return entrance(); }, open: true, scale: 1,
    get centre(): [number, number, number] { return [ownX(), 0.9, -2.6]; }, get avatar() { return avatar.object; }, drive() {},
    rest(): HostRest { return { spot: null, ...entrance(), pose: 'stand', busy: false, leaving: false, fixed: false, approach: null, steps: [] }; },
    spots() { return []; }, things() { return []; }, people() { return [...peers.values()].map(peer => peer.person); },
    get solids() { return plan.solids; },
    move(x, y, z, ry) { avatar.place(x, y, z, ry); },
    pose(name = 'stand') { const next: Pose = name === 'sit' || name === 'walk' || name === 'wave' || name === 'work' || name === 'dance' || name === 'relax' || name === 'jog' ? name : 'stand'; if (pose === next) return false; pose = next; avatar.show(next === 'sit' ? 'sit' : next === 'walk' ? 'walk' : next === 'jog' ? 'jog' : next === 'dance' ? 'dance' : next === 'wave' || next === 'work' ? 'interact' : 'idle', false); return true; },
    gait(_step, phase = 0, jog = false) { pose = jog ? 'jog' : 'walk'; avatar.stride(finite(phase) ? phase : 0, jog, 0, true); return true; },
    heightAt() { return 0; }, near() { return false; }, goal() { return false; },
  };
  return {
    group, camera: CAMERA, ground: '#7f9a71', walk,
    cycleDistance(jog:boolean){return avatar.cycleDistance(jog);},
    stepCharacter(dt:number){return avatar.step(dt);},
    get background() { return lightingFor('outdoor', streetTime).sky[0]; },
    get sky() { return lightingFor('outdoor', streetTime).sky; },
    lighting() { return lightingFor('outdoor', streetTime); },
    get homeDoor() { return { ...HOME_DOOR, x: ownX() }; },
    streetGate: { x: BUS_STOP.x, z: 0, ry: Math.PI / 2 },
    setStreet(next) {
      const key = JSON.stringify(next ? [next.city, next.anchor, next.land, next.houses.map(house => [house.plot, house.style, house.land, house.owner?.id, house.owner?.name])] : null);
      street = next;
      if (key === streetKey) return false;
      streetKey = key;
      if (next) anchor = next.anchor.plot;
      plan = planNow(); grid = makeGrid(); render(); return true;
    },
    neighbourDoors: () => neighbours().flatMap(house => house.owner && street ? [{ id: house.owner.id, name: house.owner.name, plot: { ...street.anchor, plot: house.plot }, x: rowX(house.plot), z: HOME_DOOR.z, ry: Math.PI }] : []),
    tags: () => [
      { id: 'city-gate', kind: 'city-gate', name: 'Explore city streets', text: 'City streets', marker: 'tag', position: { x: BUS_STOP.x, y: 3.6, z: BUS_STOP.z } },
      { id: 'home-door', kind: 'home-door', name: 'Go inside', text: 'Go inside', marker: 'tag', position: { x: ownX(), y: 2.6, z: HOME_DOOR.z } },
      ...neighbours().flatMap(house => house.owner ? [{ id: `door:${house.owner.id}`, kind: 'neighbour-door', name: `${house.owner.name}'s home`, text: `${house.owner.name}'s home`, marker: 'tag', position: { x: rowX(house.plot), y: 2.6, z: HOME_DOOR.z } }] : []),
      ...[...peers.values()].map(peer => peer.tag),
      ...(playerName ? [{ id: 'self', kind: 'self', text: playerName, name: playerName, marker: 'crown', colour: '#ffd34d', position: { x: avatar.object.position.x, y: avatar.object.position.y + 3, z: avatar.object.position.z } }] : []),
    ],
    setCrowd, get easing() { return easing; }, stepCrowd, settleCrowd,
    setPlayer({ look, seed, name }: Partial<PlayerLook>) {
      let changed = false, appearance = false;
      if (look !== undefined && JSON.stringify(look) !== JSON.stringify(avatarLook)) { avatarLook = look; changed = appearance = true; }
      if (seed !== undefined && seed !== avatarSeed) { avatarSeed = seed; changed = appearance = true; }
      if (name !== undefined && name !== playerName) { playerName = name; changed = true; }
      if (appearance) {
        const old = avatar;
        avatar = createBody(kit, avatarLook, avatarSeed, 1);
        avatar.object.visible = old.object.visible;
        avatar.place(old.object.position.x, old.object.position.y, old.object.position.z, old.object.rotation.y);
        avatar.show(pose === 'sit' ? 'sit' : pose === 'walk' ? 'walk' : pose === 'jog' ? 'jog' : pose === 'dance' ? 'dance' : pose === 'wave' || pose === 'work' ? 'interact' : 'idle', false);
        group.add(avatar.object); old.dispose();
      }
      return changed;
    },
    update(state: LifeState) {
      const nextTime = finite(state.t) ? timeOfDay(state.t) : streetTime;
      const timeChanged = nextTime !== streetTime;
      streetTime = nextTime;
      if (timeChanged) light();
      const weatherChanged = syncWeather(state);
      const next = JSON.stringify([state.estate.style, state.estate.tier, state.estate.living, state.estate.plot]);
      if (next === signature) return timeChanged || weatherChanged;
      signature = next; currentStyle = state.estate.style; ownTier = state.estate.tier; cityId = state.estate.city;
      if (state.estate.plot) anchor = state.estate.plot.plot;
      plan = planNow(); grid = makeGrid(); render(); return true;
    },
    /** The camera's place: near and far versions of the street's models follow it (a rebuild, drawn by the frame that is being drawn anyway). */
    look(x: number, z: number) { focusX = x; focusZ = z; return layer?.focus(x, z) ?? false; },
    /** Called after every frame: the first time, fetch the street's models if this device may (stand-ins stay when it may not or a file fails). */
    startCrowd(renderer: { getContext?: () => unknown }, changed: () => void) {
      if (modelsStarted || disposed) return;
      modelsStarted = true; notify = changed;
      // The gate and the drawing are chunks of their own (the shared scene chunk never names them): street life, src/scene/street-life.
      const webgl = drawsWebGL2(renderer);
      void Promise.all([import('./street-life/plan.ts'), import('./street-life/street-scene.ts')]).then(([gate, streets]) => {
        const choice = gate.streetLifeFor({ ambientTier: bodyAllowed() ? 'full' : 'light', webgl, hints: gate.deviceHints(), forced: gate.pageForced() });
        forget = layout => streets.forgetStreet('neighbourhood', layout);
        if (!choice || disposed) { if (!disposed) streets.noteStreet('neighbourhood', null); return; }
        streetChoice = choice; streetGuard = gate.createFrameGuard();
        return Promise.all([import('./street-life/draw.ts'), import('./street-life/scenery.ts')]).then(([module, sceneryChunk]) => {
          if (disposed || streetDropped) return;
          sceneryModule = sceneryChunk; dressStreet();
          // The street as a street scene (zoom phase 5b): two-way traffic on the country's side, and the shop windows the browsers stop at.
          const browse = STREET_LANES[2]!, windows = sceneryChunk.planShopfronts(sceneryChunk.frontagesOf(plan.pieces, boxOf), lifeSeed())
            .filter(bay => bay.facing === -1 && Math.abs(bay.z - browse.az) < 3).map(bay => bay.x - browse.ax);
          const lanes = STREET_LANES.map(lane => lane === browse ? { ...lane, windows } : lane);
          // The final guard: the street is used only when all of it (lanes, roads, crossings) lies inside the street's walkable bounds, and
          // its start pose only when the eye stands on a walkable cell; otherwise none (the phase-3b lanes, no traffic, no street pose).
          const layout = streets.fitStreet(streets.homeStreet(country(), ownX(), lanes, ROW_HALF_WIDTH, BOUNDS), (x, z) => grid.floor(x, z));
          // The near crowd's bodies only on the walk grid (bodyFloor); the far pavement's cut-outs are kept by the bounds guard alone.
          streetLife = module.createStreetLife(kit, { parent: group, seed: lifeSeed(), lanes: layout?.lanes ?? STREET_LANES, roads: layout?.roads ?? [], crossings: layout ? STREET_CROSSINGS : [],
            // A believable crowd for the street's length (plan.ts streetCrowd: 10 to 18, half on a lite device), not the tier's whole cap.
            country: country(), crowd: gate.streetCrowd(choice, 2 * ROW_HALF_WIDTH), vehicles: layout ? choice.vehicles : 0, narrow: streets.HOME_NARROW, bounds: BOUNDS, at: Date.now(),
            context: 'street', tier: choice.tier, ready: changed, bodyFloor: (x, z) => grid.floor(x, z), others: () => [...peers.values()].map(peer => peer.person) });
          streetLife.step(Date.now(), avatar.object.position);
          streetLayout = layout; streets.noteStreet('neighbourhood', layout);
          streetWindow = STREET_WINDOW_S; changed();
        });
      }).catch(() => { streetDropped = true; });
      if (!bodyAllowed() || !drawsWebGL2(renderer)) return;
      void import('./street/street-models.ts').then(module => {
        if (disposed) return;
        models = module.streetModels(kit);
        render(); changed();
      }).catch(() => undefined);
    },
    /** Street life's window of frames (the host's ambient hooks): opened when the player moves, it keeps the people and cars going a while. */
    stepAmbient(dt: number) {
      const weather = weatherFx?.step(dt) ?? false;
      if (!streetLife || streetWindow <= 0) return weather;
      streetWindow = Math.max(0, streetWindow - dt);
      if (!streetChoice?.forced && streetGuard?.frame(dt) === 'slow') { streetLife.dispose(); streetLife = null; streetDropped = true; streetWindow = 0; return weather; }
      streetLife.step(Date.now(), avatar.object.position, dt);
      return streetWindow > 0 || weather;
    },
    wakeAmbient() { const weather = weatherFx?.wake() ?? false; if (!streetLife) return weather; if (streetWindow <= 0) streetGuard?.reset(); streetWindow = STREET_WINDOW_S; return true; },
    settleAmbient() { streetWindow = 0; streetLife?.step(Date.now(), avatar.object.position); weatherFx?.settle(); },
    get ambientAwake() { return (streetLife !== null && streetWindow > 0) || (weatherFx?.awake ?? false); },
    dispose() { disposed = true; weatherFx?.dispose(); weatherFx = null; forget?.(streetLayout); streetLife?.dispose(); streetLife = null; dressing?.dispose(); dressing = null; for (const peer of peers.values()) dropPeer(peer); releaseObjects(sceneryObjects); layer?.dispose(); layer = null; for (const mask of masks.values()) mask?.dispose(); avatar.dispose(); group.parent?.remove(group); },
  } satisfies HostScene;
}
