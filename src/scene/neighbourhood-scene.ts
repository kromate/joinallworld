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
import { createBatch, GLOW, releaseObjects, sceneMaterials } from './build.ts';
import type { Kit } from './kit.ts';
import { createWalkGrid } from './movement.ts';
import type { WalkRect } from './movement.ts';
import type { SceneCamera, ScenePerson, SceneTag } from './types.ts';
import { ROW_HALF_WIDTH, ROW_PITCH, rowX, streetRow } from '../game/neighbourhood-space.ts';
import { plotOf } from '../game/home-layout.ts';
import { lightingFor, timeOfDay } from './lighting.ts';
import { bush, car } from './props.ts';

const HOME_DOOR = { x: 0, z: -6.25, ry: Math.PI, direction: 'inside' as const };
const ENTRANCE = { x: 0, y: 0, z: -3.25, ry: 0 };
const BOUNDS: WalkRect = [-ROW_HALF_WIDTH, -18, ROW_HALF_WIDTH, 11];
const CAMERA: SceneCamera = { landscape: [15, 12, 17], portrait: [9, 10, 15], start: 1.25 };
const DEFAULT_WALL = '#e6cf9f', DEFAULT_ROOF = '#a85c40', DEFAULT_DOOR = '#6b4a2b';
const GABLE_RISE = 1.25, HIP_RISE = 1.05, TWIN_RISE = 0.98;
const ROAD_CAR_Z = 3.98, ROAD_CAR_WIDTH = 1.9, ROAD_CAR_LENGTH = 4.2;
const SHRUB_Z = -4.2, SHRUB_REACH_X = 1.2, SHRUB_REACH_Z = 0.8;

function houseColour(style: HouseStyle, field: 'wall' | 'roof' | 'door', fallback: string): string {
  return HOUSE_STYLE[field][style[field]]?.hex ?? fallback;
}

function drawHouse(b: ReturnType<typeof createBatch>, x: number, front: number, width: number, depth: number, wall: string, roof: string, door: string, main: boolean, floors: number, style: HouseStyle): void {
  const back = front - depth, half = width / 2, wallHeight = floors * 3.4;
  const leftDoor = main ? 0.78 : 0.55, doorWidth = main ? 1.56 : 1.1;
  const wallDepth = 0.24;
  if (!main) b.box(x, wallHeight / 2, back + depth / 2, width, wallHeight, depth, wall);
  const windows = main && width >= 8 ? Array.from({ length: floors }, (_, floor) => [-1, 1].map(side => ({
    x: x + side * (floor === 0 ? 2.55 : 2.2), y: floor === 0 ? 2.35 : floor * 3.4 + 1.75,
    w: floor === 0 ? 1.6 : 1.6, h: floor === 0 ? 1.15 : 1.2,
  }))).flat() : [];
  // The front wall is a small cell grid around openings; the same window centers stay on each
  // storey while the central ground-floor door gap remains exactly where the walk approach is.
  if (windows.length) {
    const yCuts = [...new Set([0, wallHeight, 2.45, ...windows.flatMap(win => [win.y - win.h / 2, win.y + win.h / 2])])].sort((a, c) => a - c);
    for (let band = 0; band < yCuts.length - 1; band++) {
      const bottom = yCuts[band]!, top = yCuts[band + 1]!, mid = (bottom + top) / 2;
      const course = mid < 1.775 ? '#c9c2b0' : wall;
      const gaps = windows.filter(win => mid > win.y - win.h / 2 && mid < win.y + win.h / 2).map(win => [win.x - x - win.w / 2, win.x - x + win.w / 2]);
      if (mid < 2.45) gaps.push([-doorWidth / 2, doorWidth / 2]);
      gaps.sort((a, c) => a[0]! - c[0]!);
      let edge = -half;
      for (const [gapStart, gapEnd] of gaps) {
        const start = Math.max(-half, gapStart!), end = Math.min(half, gapEnd!);
        if (start > edge + 0.01) b.box(x + (edge + start) / 2, mid, front, start - edge, top - bottom, wallDepth, course);
        edge = Math.max(edge, end);
      }
      if (edge < half - 0.01) b.box(x + (edge + half) / 2, mid, front, half - edge, top - bottom, wallDepth, course);
    }
    const pane = style.windows === 3 ? '#bfe0f0' : HOUSE_STYLE.windows[style.windows]?.hex ?? '#bfe0f0';
    const trim = '#805a37';
    for (const win of windows) {
      b.quad(win.x, win.y, front + 0.035, win.w - 0.2, win.h - 0.2, pane);
      if (style.windows === 1) b.quad(win.x, win.y, front + 0.055, win.w - 0.3, win.h - 0.3, pane, GLOW);
      b.box(win.x - win.w / 2 + 0.06, win.y, front, 0.12, win.h, wallDepth, trim);
      b.box(win.x + win.w / 2 - 0.06, win.y, front, 0.12, win.h, wallDepth, trim);
      b.box(win.x, win.y - win.h / 2 + 0.06, front, win.w - 0.24, 0.12, wallDepth, trim);
      b.box(win.x, win.y + win.h / 2 - 0.06, front, win.w - 0.24, 0.12, wallDepth, trim);
      if (style.windows === 3) for (const side of [-1, 1]) b.box(win.x + side * (win.w / 2 + 0.2), win.y, front + 0.22, 0.28, win.h * 0.84, 0.1, '#e9e2cf');
    }
  } else {
    b.box(x - (half + leftDoor) / 2, wallHeight / 2, front, half - leftDoor, wallHeight, wallDepth, wall);
    b.box(x + (half + leftDoor) / 2, wallHeight / 2, front, half - leftDoor, wallHeight, wallDepth, wall);
  }
  if (!windows.length) b.box(x, (wallHeight + 2.45) / 2, front, doorWidth, wallHeight - 2.45, wallDepth, wall);
  const sideWindows = main && width >= 8 ? Array.from({ length: floors }, (_, floor) => ({
    z: front - depth / 2, y: floor === 0 ? 2.35 : floor * 3.4 + 1.75, w: 1.35, h: floor === 0 ? 1.15 : 1.2,
  })) : [];
  for (const side of [-1, 1]) {
    if (!sideWindows.length) {
      b.box(x + side * half, wallHeight / 2, back + depth / 2, wallDepth, wallHeight, depth, wall);
      continue;
    }
    const yCuts = [...new Set([0, wallHeight, ...sideWindows.flatMap(win => [win.y - win.h / 2, win.y + win.h / 2])])].sort((a, c) => a - c);
    for (let band = 0; band < yCuts.length - 1; band++) {
      const bottom = yCuts[band]!, top = yCuts[band + 1]!, mid = (bottom + top) / 2;
      const course = mid < 1.775 ? '#c9c2b0' : wall;
      const gaps = sideWindows.filter(win => mid > win.y - win.h / 2 && mid < win.y + win.h / 2).map(win => [win.z - win.w / 2, win.z + win.w / 2]);
      gaps.sort((a, c) => a[0]! - c[0]!);
      let edge = back;
      for (const [gapStart, gapEnd] of gaps) {
        const start = Math.max(back, gapStart!), end = Math.min(front, gapEnd!);
        if (start > edge + 0.01) b.box(x + side * half, mid, (edge + start) / 2, wallDepth, top - bottom, start - edge, course);
        edge = Math.max(edge, end);
      }
      if (edge < front - 0.01) b.box(x + side * half, mid, (edge + front) / 2, wallDepth, top - bottom, front - edge, course);
    }
    const pane = style.windows === 3 ? '#bfe0f0' : HOUSE_STYLE.windows[style.windows]?.hex ?? '#bfe0f0';
    const trim = '#805a37', windowX = x + side * (half + 0.035), frameX = x + side * half;
    for (const win of sideWindows) {
      b.quad(windowX, win.y, win.z, win.w - 0.2, win.h - 0.2, pane, { ry: side * Math.PI / 2 });
      if (style.windows === 1) b.quad(x + side * (half + 0.055), win.y, win.z, win.w - 0.3, win.h - 0.3, pane, { ...GLOW, ry: side * Math.PI / 2 });
      for (const dz of [-1, 1]) b.box(frameX, win.y, win.z + dz * (win.w / 2 - 0.06), wallDepth, win.h, 0.12, trim);
      for (const dy of [-1, 1]) b.box(frameX, win.y + dy * (win.h / 2 - 0.06), win.z, wallDepth, 0.12, win.w - 0.24, trim);
      if (style.windows === 3) for (const dz of [-1, 1]) b.box(x + side * (half + 0.22), win.y, win.z + dz * (win.w / 2 + 0.2), 0.1, win.h * 0.84, 0.28, '#e9e2cf');
    }
  }
  b.box(x, wallHeight / 2, back, width, wallHeight, wallDepth, wall);

  for (let floor = 1; floor < floors; floor++) {
    const y = floor * 3.4;
    b.box(x, y, front, width, 0.16, 0.3, '#e2d6bf');
  }
  const roofZ = back + depth / 2, roofW = width + 0.5, roofD = depth + 0.5;
  const closeGables = (peaks: number[], run: number, rise: number) => {
    const capRise = rise - 0.04, capWidth = run * 2 - 0.04;
    for (const peak of peaks) for (const z of [front, back]) {
      b.cyl(x + peak, wallHeight + capRise / 3, z, 1, wallDepth, wall, {
        seg: 3, rx: -Math.PI / 2, sx: capWidth / Math.sqrt(3), sz: capRise / 1.5,
      });
    }
  };
  const drawHipRoof = (rise: number) => {
    const depthRun = roofD / 2, widthRun = roofW / 2;
    const frontLength = Math.hypot(depthRun, rise), sideLength = Math.hypot(widthRun, rise);
    const panel = (px: number, pz: number, rx: number, ry: number, base: number, slope: number) =>
      b.cyl(px, wallHeight + rise / 3, pz, 1, 0.002, roof, { seg: 3, rx, ry, sx: base / Math.sqrt(3), sz: slope / 1.5 });
    // Each triangular prism's capped face is one roof plane. The four bases meet exactly at the
    // rectangular eaves and their apex edges meet at the centre; no diagonal cone footprint.
    const frontPitch = Math.atan2(rise, depthRun), sidePitch = Math.atan2(rise, widthRun);
    panel(x, roofZ + roofD / 3, -Math.PI + frontPitch, 0, roofW, frontLength);
    panel(x, roofZ - roofD / 3, -frontPitch, 0, roofW, frontLength);
    panel(x + widthRun * 2 / 3, roofZ, -sidePitch, -Math.PI / 2, roofD, sideLength);
    panel(x - widthRun * 2 / 3, roofZ, -sidePitch, Math.PI / 2, roofD, sideLength);
  };
  if (style.shape === 0 || style.shape === 3) {
    const peaks = style.shape === 3 ? [-width / 4, width / 4] : [0], run = (style.shape === 3 ? width / 4 : roofW / 2), rise = style.shape === 3 ? TWIN_RISE : GABLE_RISE;
    const pitch = Math.atan2(rise, run), length = Math.hypot(run, rise);
    for (const peak of peaks) {
      for (const side of [-1, 1]) b.box(x + peak + side * run / 2, wallHeight + rise / 2, roofZ, length, 0.24, roofD, roof, { rz: -side * pitch });
      b.box(x + peak, wallHeight + rise, roofZ, 0.24, 0.16, roofD + 0.12, roof);
    }
    closeGables(peaks, run, rise);
  } else if (style.shape === 1) {
    const rise = HIP_RISE;
    drawHipRoof(rise);
  } else {
    b.box(x, wallHeight + 0.28, roofZ, roofW, 0.56, roofD, roof);
    b.box(x, wallHeight + 0.58, roofZ, roofW, 0.12, roofD, '#e2d6bf');
  }
  if (main) {
    b.box(x, 1.12, front - 0.14, 1.28, 2.18, 0.1, door);
    b.box(x - 0.72, 1.15, front + 0.14, 0.12, 2.3, 0.12, '#e2d6bf');
    b.box(x + 0.72, 1.15, front + 0.14, 0.12, 2.3, 0.12, '#e2d6bf');
    b.box(x, 2.32, front + 0.14, 1.56, 0.14, 0.12, '#e2d6bf');
    b.box(x + 0.38, 1.1, front - 0.075, 0.07, 0.12, 0.08, '#dfbd64');
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
interface RoadsideDressing { carX: number; shrubs: { plot: number; x: number; z: number }[]; blockers: WalkRect[]; solids: [number, number, number, number, number, number][] }
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
  let carGlowColors: Float32Array | null = null;
  let warmWindowVertices: number[] = [];
  let streetTime: 'day' | 'dusk' | 'night' = 'day';
  let dressing: RoadsideDressing = { carX: 0, shrubs: [], blockers: [], solids: [] };
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
  function buildRoadsideDressing(): RoadsideDressing {
    if (!street) return { carX: 0, shrubs: [], blockers: [], solids: [] };
    const rowStart = streetRow(street.anchor.plot) * ESTATE.plots;
    const carX = rowX(rowStart + Math.floor(ESTATE.plots / 3));
    const houses = frontages(), fencesForHouse = compounds();
    const landPlots = [...new Set(houses.flatMap(house => house.land))].sort((a, b) => a - b);
    const shrubs: { plot: number; x: number; z: number }[] = [];
    for (const plot of landPlots) {
      const owner = houses.find(house => house.land.includes(plot));
      const compound = fencesForHouse.find(item => item.gate === owner?.x);
      const x = rowX(plot);
      // Keep planted scenery inside its actual compound, away from house footprints and gates.
      if (!owner || !compound || x <= compound.left + 1.3 || x >= compound.right - 1.3) continue;
      if (houses.some(house => Math.abs(house.x - x) < 5.7)) continue;
      shrubs.push({ plot, x, z: SHRUB_Z });
      if (shrubs.length === 2) break;
    }
    const halfX = ROAD_CAR_LENGTH / 2, halfZ = ROAD_CAR_WIDTH / 2;
    const blockers: WalkRect[] = [
      [carX - halfX, ROAD_CAR_Z - halfZ, carX + halfX, ROAD_CAR_Z + halfZ],
      ...shrubs.map(({ x, z }): WalkRect => [x - SHRUB_REACH_X, z - SHRUB_REACH_Z, x + SHRUB_REACH_X, z + SHRUB_REACH_Z]),
    ];
    return {
      carX, shrubs, blockers,
      solids: [
        [carX - halfX, 0, ROAD_CAR_Z - halfZ, carX + halfX, 1.5, ROAD_CAR_Z + halfZ],
        ...shrubs.map(({ x, z }): [number, number, number, number, number, number] => [x - SHRUB_REACH_X, 0, z - SHRUB_REACH_Z, x + SHRUB_REACH_X, 1.16, z + SHRUB_REACH_Z]),
      ],
    };
  };
  const makeGrid = () => createWalkGrid({ bounds: BOUNDS, cell: 0.3, radius: 0.32, entrance: [ownX(), ENTRANCE.z, ENTRANCE.ry], block: [
    ...frontages().map((house): WalkRect => [house.x - 4.52, -13.3, house.x + 4.52, -7]), ...fences(),
    ...lamps.map((x): WalkRect => [x - 0.2, -0.7, x + 0.2, -0.3]),
    ...dressing.blockers,
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
      drawHouse(b, house.x, -7.15, 8.8, 6.1, houseColour(house.style, 'wall', DEFAULT_WALL), houseColour(house.style, 'roof', DEFAULT_ROOF), houseColour(house.style, 'door', DEFAULT_DOOR), true, house.floors, house.style);
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
    if (street) {
      // One unowned, parked visual per row. Its stable location is derived from the row, never
      // from the requesting player's plot, and it is deliberately not exposed as a game object.
      car(b, dressing.carX, ROAD_CAR_Z, { ry: Math.PI / 2, color: '#49535a', glass: '#7395a2' });
      for (const shrub of dressing.shrubs) bush(b, shrub.x, shrub.z, { s: 1.1, color: '#64814d' });
    }
    for (const x of lamps) {
      b.cyl(x, 0.62, -0.5, 0.12, 1.24, '#5d5142');
      b.cyl(x, 1.28, -0.5, 0.46, 0.08, '#d5c29d');
      b.cyl(x, 1.48, -0.5, 0.32, 0.38, '#e9c97c', { seg: 8, top: 0.88 });
      b.light(x, 1.52, -0.5, '#ffe3a0', 4, 7);
    }
    const built = b.build(sceneMaterials(kit));
    const glow = built.meshes.find(mesh => mesh.name === 'glow')?.geometry.getAttribute('color');
    carGlowColors = glow ? new Float32Array(glow.array as Float32Array) : null;
    warmWindowVertices = [];
    const glowMesh = built.meshes.find(mesh => mesh.name === 'glow');
    const glowPosition = glowMesh?.geometry.getAttribute('position');
    if (glow && glowPosition) {
      const warm = new THREE.Color(HOUSE_STYLE.windows[1]!.hex);
      for (let i = 0; i < glow.count; i++) {
        if (glowPosition.getY(i) > 1.5 && Math.abs(glow.getX(i) - warm.r) < 0.001 && Math.abs(glow.getY(i) - warm.g) < 0.001 && Math.abs(glow.getZ(i) - warm.b) < 0.001) warmWindowVertices.push(i * 3);
      }
    }
    sceneryObjects = [...built.meshes, ...built.lights];
    sceneryObjects.forEach(object => scenery.add(object));
    applyCarLighting(streetTime);
  }

  function applyCarLighting(time: 'day' | 'dusk' | 'night'): void {
    streetTime = time;
    const mesh = sceneryObjects.find((object): object is THREE.Mesh => (object as THREE.Mesh).isMesh && object.name === 'glow');
    const colors = mesh?.geometry.getAttribute('color');
    if (!colors || !carGlowColors) return;
    const intensity = time === 'night' ? 1 : time === 'dusk' ? 0.45 : 0.08;
    const values = colors.array as Float32Array;
    for (let i = 0; i < values.length; i++) values[i] = carGlowColors[i]! * intensity;
    const windowIntensity = time === 'night' ? 1.25 : time === 'dusk' ? 0.75 : 0.38;
    for (const i of warmWindowVertices) {
      values[i] = carGlowColors[i]! * windowIntensity;
      values[i + 1] = carGlowColors[i + 1]! * windowIntensity;
      values[i + 2] = carGlowColors[i + 2]! * windowIntensity;
    }
    colors.needsUpdate = true;
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
      ...dressing.solids,
    ]; },
    move(x, y, z, ry) { avatar.position.set(x, y, z); avatar.rotation.y = ry; },
    pose(name = 'stand') { const next: Pose = name === 'sit' || name === 'walk' || name === 'wave' || name === 'work' || name === 'dance' || name === 'relax' || name === 'jog' ? name : 'stand'; if (pose === next) return false; pose = next; poseAvatar(avatar, { pose }); return true; },
    gait(_step, phase = 0, jog = false) { pose = jog ? 'jog' : 'walk'; poseAvatar(avatar, { pose, stride: finite(phase) ? ((phase / (2 * Math.PI)) % 1 + 1) % 1 : 0 }); return true; },
    heightAt() { return 0; }, near() { return false; }, goal() { return false; },
  };
  return {
    group, camera: CAMERA, ground: '#7f9a71', walk,
    get background() { return lightingFor('outdoor', streetTime).sky[0]; },
    get sky() { return lightingFor('outdoor', streetTime).sky; },
    lighting() { return lightingFor('outdoor', streetTime); },
    get homeDoor() { return { ...HOME_DOOR, x: ownX() }; },
    streetGate: { x: 81, z: 0, ry: Math.PI / 2 },
    setStreet(next) {
      const key = JSON.stringify(next ? [next.city, next.anchor, next.land, next.houses.map(house => [house.plot, house.style, house.land, house.owner?.id, house.owner?.name])] : null);
      street = next;
      if (key === streetKey) return false;
      streetKey = key;
      if (next) anchor = next.anchor.plot;
      dressing = buildRoadsideDressing();
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
      const nextTime = finite(state.t) ? timeOfDay(state.t) : streetTime;
      const timeChanged = nextTime !== streetTime;
      if (timeChanged) applyCarLighting(nextTime);
      const next = JSON.stringify([state.estate.style, state.estate.tier, state.estate.living, state.estate.plot]);
      if (next === signature) return timeChanged;
      signature = next; currentStyle = state.estate.style; ownFloors = state.estate.living === 'own' ? tierFloors(state.estate.tier) : 1;
      if (state.estate.plot) anchor = state.estate.plot.plot;
      grid = makeGrid(); render(); return true;
    },
    look() { return false; },
    dispose() { for (const peer of peers.values()) dropPeer(peer); releaseObjects(sceneryObjects); avatarDispose(); group.parent?.remove(group); },
  } satisfies HostScene;
}
