/**
 * OWNER: neighbourhood
 * What stands in for a street model until its file arrives, or for good when the device may not fetch it or the file fails:
 * the procedural drawing the street always had (boxes and cylinders in the scene's batch), in the model's own frame.
 */
import type { Batch } from '../types.ts';
import { boxOf } from './street-kit.ts';
import type { PlanPiece } from './street-plan.ts';

/** A hex colour darkened (k < 1) or lightened towards white (k > 1), for plinths and trim cut from the wall's own paint. */
export function tone(hex: string, k: number): string {
  const n = Number.parseInt(hex.slice(1), 16), part = (shift: number) => { const v = (n >> shift) & 255; return Math.max(0, Math.min(255, Math.round(k <= 1 ? v * k : v + (255 - v) * (k - 1)))); };
  return `#${((1 << 24) | (part(16) << 16) | (part(8) << 8) | part(0)).toString(16).slice(1)}`;
}
const TRIM = '#efe6cf', BARS = '#2f3338', LIT = '#ffe2b0', PANE = '#59707f';

/**
 * A window in the front wall (facing +z, its face at `face`): a white frame, a pane, burglar-proof bars across it, a sill.
 * Some panes are lights-on (the glow layer, which follows the time of day), the rest dark glass.
 */
function drawWindow(b: Batch, x: number, y: number, face: number, lit: boolean, bars: boolean): void {
  b.box(x, y, face + 0.03, 1.8, 1.35, 0.06, TRIM);
  if (lit) b.quad(x, y, face + 0.07, 1.5, 1.05, LIT, { layer: 'glow' }); else b.quad(x, y, face + 0.07, 1.5, 1.05, PANE);
  b.box(x, y - 0.72, face + 0.1, 2.0, 0.1, 0.2, TRIM);
  if (!bars) return;
  for (const dx of [-0.5, -0.17, 0.17, 0.5]) b.quad(x + dx, y, face + 0.09, 0.05, 1.12, BARS);
  b.quad(x, y, face + 0.09, 1.5, 0.05, BARS);
}

/**
 * A long-span roofing-sheet roof, as on most Lagos bungalows: two slopes of coloured sheets (alternating shades make the corrugation),
 * a ridge cap, gutters along the eaves and a gable end of wall paint at each side. `y0` is the top of the eaves board.
 */
function drawSheetRoof(b: Batch, x: number, z: number, width: number, depth: number, y0: number, roof: string, wall: string): void {
  const run = depth / 2, rise = 1.7, slope = Math.atan2(rise, run), length = Math.hypot(run, rise), strips = 14, strip = width / strips;
  for (const side of [1, -1]) {
    // A sheet faces up and out: +z for the front slope, -z for the back one.
    const rx = side > 0 ? slope - Math.PI / 2 : -(Math.PI / 2 + slope);
    for (let i = 0; i < strips; i++) b.quad(x - width / 2 + strip * (i + 0.5), y0 + rise / 2 + 0.02, z + side * run / 2, strip, length, tone(roof, i % 2 ? 0.8 : 1), { rx });
    b.box(x, y0 + 0.02, z + side * (run + 0.04), width, 0.13, 0.15, '#5d6166');
  }
  b.box(x, y0 + rise + 0.06, z, width + 0.04, 0.16, 0.36, tone(roof, 0.62));
  // The triangle of wall under each end of the ridge: a three-sided prism lying along the house.
  for (const side of [-1, 1]) b.cyl(x + side * (width / 2 - 0.1), y0 + rise / 3, z, 1, 0.14, wall, { seg: 3, rz: Math.PI / 2, rx: -Math.PI / 2, sx: run * 0.99 / 0.866, sz: rise / 1.5 });
}

/**
 * A house as boxes: the front wall split around the door, windows with frames and bars, a painted plinth, a door with an awning,
 * a hip roof with a fascia (a bungalow) or a flat roof behind a parapet (a storey building, with balconies and a water tank on top).
 * In the house's own frame (x centred, front at z = front).
 */
export function drawHouse(b: Batch, x: number, front: number, width: number, depth: number, wall: string, roof: string, door: string, floors = 1): void {
  const back = front - depth, half = width / 2, wallHeight = floors * 3.4, face = front + 0.12;
  const leftDoor = 0.78, doorWidth = 1.56, wallDepth = 0.24, mid = back + depth / 2;
  b.box(x - (half + leftDoor) / 2, wallHeight / 2, front, half - leftDoor, wallHeight, wallDepth, wall);
  b.box(x + (half + leftDoor) / 2, wallHeight / 2, front, half - leftDoor, wallHeight, wallDepth, wall);
  b.box(x, (wallHeight + 2.45) / 2, front, doorWidth, wallHeight - 2.45, wallDepth, wall);
  b.box(x - half, wallHeight / 2, mid, wallDepth, wallHeight, depth, wall);
  b.box(x + half, wallHeight / 2, mid, wallDepth, wallHeight, depth, wall);
  b.box(x, wallHeight / 2, back, width, wallHeight, wallDepth, wall);
  // The painted plinth round the foot of the walls, a step at the door.
  b.box(x, 0.22, mid, width + 0.16, 0.44, depth + 0.16, tone(wall, 0.66));
  b.box(x, 0.08, face + 0.35, 2.2, 0.16, 0.7, '#cdbf9f');
  // Windows: the ground floor either side of the door, then a pair on each floor above, the way a Lagos storey building has them.
  const seed = Math.round(x * 7 + width * 3);
  for (const side of [-1, 1]) drawWindow(b, x + side * 3.0, 2.0, face, (seed + side) % 3 !== 0, true);
  for (let floor = 1; floor < floors; floor++) {
    const y = floor * 3.4;
    b.box(x, y, front, width + 0.1, 0.16, 0.34, TRIM);
    for (const side of [-1, 1]) drawWindow(b, x + side * 2.2, y + 1.75, face, (seed + floor * 5 + side) % 3 !== 1, floor === 1);
    if (floor === 1) {
      // A balcony: a slab, a rail and balusters, in front of the middle of the floor.
      b.box(x, y + 0.08, face + 0.55, 3.0, 0.16, 1.1, TRIM);
      b.box(x, y + 1.1, face + 1.07, 3.0, 0.07, 0.07, TRIM);
      for (let i = 0; i < 7; i++) b.quad(x - 1.4 + i * 0.467, y + 0.62, face + 1.07, 0.06, 0.9, BARS);
    }
  }
  // The door, its frame and an awning over it.
  b.box(x, 1.2, front - 0.02, 1.7, 2.4, 0.1, tone(wall, 0.8));
  b.box(x, 1.12, front - 0.14, 1.28, 2.18, 0.1, door);
  b.box(x + 0.38, 1.1, front - 0.075, 0.07, 0.12, 0.08, '#dfbd64');
  b.box(x, 2.78, face + 0.5, 2.6, 0.1, 1.0, door, { rx: 0.18 });
  // The roof. Eaves overhang the walls and end in a pale fascia board.
  b.box(x, wallHeight + 0.1, mid, width + 0.9, 0.22, depth + 0.9, TRIM);
  if (floors === 1) drawSheetRoof(b, x, mid, width + 0.9, depth + 0.9, wallHeight + 0.21, roof, wall);
  else {
    b.box(x, wallHeight + 0.4, mid, width + 0.5, 0.4, depth + 0.5, tone(roof, 0.75));
    for (const [dx, dz, w, d] of [[0, 1, width + 0.5, 0.28], [0, -1, width + 0.5, 0.28], [1, 0, 0.28, depth + 0.5], [-1, 0, 0.28, depth + 0.5]] as const) b.box(x + dx * (width + 0.22) / 2, wallHeight + 0.95, mid + dz * (depth + 0.22) / 2, w, 0.7, d, tone(wall, 1.12));
    if (floors > 2) { b.cyl(x - half + 1.6, wallHeight + 2.0, back + 1.6, 0.85, 1.6, '#34383e'); for (const [dx, dz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]] as const) b.box(x - half + 1.6 + dx, wallHeight + 0.85, back + 1.6 + dz, 0.1, 0.9, 0.1, BARS); }
  }
}

/** A utility pole: a timber post, a crossarm with insulators, and on some a pole transformer. */
export function drawPole(b: Batch, x: number, z: number, transformer: boolean): void {
  b.cyl(x, 3.6, z, 0.14, 7.2, '#6d5a45', { seg: 6 }); b.box(x, 6.9, z, 0.12, 0.12, 1.9, '#5d5142');
  for (const dz of [-0.8, 0, 0.8]) b.box(x, 7.05, z + dz, 0.08, 0.16, 0.08, '#3f6f8f');
  if (transformer) { b.cyl(x + 0.38, 5.9, z, 0.3, 0.8, '#8d9399', { seg: 8 }); b.box(x + 0.25, 6.3, z, 0.1, 0.08, 0.5, BARS); }
}
/** The wires between two poles, as slim boxes (three lines on the crossarm). */
export function drawWires(b: Batch, x0: number, x1: number, z: number): void {
  const length = x1 - x0, cx = (x0 + x1) / 2;
  for (const dz of [-0.8, 0, 0.8]) { b.box(cx - length / 4, 7.0, z + dz, length / 2, 0.04, 0.04, BARS, { rz: 0.012 }); b.box(cx + length / 4, 7.0, z + dz, length / 2, 0.04, 0.04, BARS, { rz: -0.012 }); }
}
/** A parked danfo: the yellow Lagos minibus with its black band, a row of windows, a roof rack and lamps. Along x, facing +x. */
export function drawDanfo(b: Batch, x: number, z: number): void {
  b.box(x, 1.25, z, 5.0, 1.7, 2.0, '#e5b52b'); b.box(x, 1.3, z, 5.04, 0.35, 2.04, '#26282b'); b.box(x, 0.45, z, 5.0, 0.5, 2.0, '#26282b');
  for (let i = 0; i < 4; i++) for (const side of [-1, 1]) b.quad(x - 1.6 + i * 1.05, 1.9, z + side * 1.011, 0.85, 0.65, PANE, { ry: side > 0 ? 0 : Math.PI });
  b.quad(x + 2.505, 1.7, z, 1.6, 0.8, PANE, { ry: Math.PI / 2 }); b.box(x - 0.2, 2.15, z, 3.6, 0.1, 1.7, '#8d9399');
  for (const side of [-1, 1]) { b.quad(x + 2.51, 0.85, z + side * 0.7, 0.3, 0.2, LIT, { ry: Math.PI / 2, layer: 'glow' }); for (const wx of [-1.6, 1.5]) b.cyl(x + wx, 0.4, z + side * 0.95, 0.4, 0.3, '#17181a', { rx: Math.PI / 2, seg: 8 }); }
}
/** A keke napep: a three-wheeled green and yellow cab with a canopy. Along x, facing +x. */
export function drawKeke(b: Batch, x: number, z: number): void {
  b.box(x, 0.85, z, 2.3, 0.9, 1.3, '#e5b52b'); b.box(x - 0.2, 1.75, z, 1.7, 0.1, 1.3, '#2c6b3a'); b.box(x - 0.2, 1.3, z, 1.7, 0.1, 1.3, '#2c6b3a');
  for (const dz of [-0.62, 0.62]) b.box(x - 1.0, 1.52, z + dz, 0.06, 0.5, 0.06, '#2c6b3a');
  b.box(x + 0.7, 1.45, z, 0.6, 0.6, 1.0, '#2c6b3a'); b.quad(x + 1.16, 0.9, z, 0.22, 0.14, LIT, { ry: Math.PI / 2, layer: 'glow' });
  for (const [wx, wz] of [[-0.8, -0.65], [-0.8, 0.65], [1.0, 0]] as const) b.cyl(x + wx, 0.3, z + wz, 0.3, 0.2, '#17181a', { rx: Math.PI / 2, seg: 8 });
}

/** Small adverts stapled to a pole at head height (a loan, a lesson, a cure): flat coloured boards facing the street both ways. */
export function drawPoleAdverts(b: Batch, x: number, z: number, seed: number): void {
  const paints = ['#e5b52b', '#d8473a', '#3f8a57', '#f3eee0', '#3f6f8f'];
  for (let i = 0; i < 2; i++) for (const side of [-1, 1]) b.quad(x, 2.2 + i * 0.95, z + side * 0.16, 0.55, 0.7, paints[(seed + i * 2 + (side > 0 ? 1 : 0)) % paints.length]!, { ry: side > 0 ? 0 : Math.PI });
}
/** A roadside billboard on two posts: a bold panel with banded colours and a lit strip, facing -z (toward the houses). */
export function drawRoadBillboard(b: Batch, x: number, z: number): void {
  for (const dx of [-2.3, 2.3]) b.box(x + dx, 2.0, z, 0.2, 4.0, 0.2, DARK);
  b.box(x, 4.4, z, 6.2, 2.6, 0.18, '#f3eee0');
  for (const [dy, h, colour] of [[0.85, 0.7, '#1f5a3a'], [0, 0.7, '#e5b52b'], [-0.85, 0.7, '#d8473a']] as const) b.quad(x, 4.4 + dy, z - 0.1, 5.8, h, colour, { ry: Math.PI });
  b.quad(x, 4.4, z - 0.11, 4.6, 0.3, LIT, { ry: Math.PI, layer: 'glow' });
}
/**
 * The glow of a street lamp after dark: a bright head and, when `discs` is set (the phone tier, which has no light-pool mesh), a soft warm
 * pool on the pavement as flat discs in the glow batch (drawn only at dusk and night). Other tiers get the pool as one instanced
 * quad for all the lamps (street/light-pools.ts).
 */
export function drawLampGlow(b: Batch, x: number, y: number, z: number, discs = true): void {
  b.ball(x, y, z, 0.42, 0.28, 0.42, LIT, { seg: 6, layer: 'glow' });
  if (discs) for (const [i, radius, colour] of [[0, 3.6, '#686c76'], [1, 2.5, '#797567'], [2, 1.4, '#8d8268']] as const) b.disc(x, 0.07 + i * 0.004, z, radius, colour, { seg: 16, layer: 'glow' });
}

const SAND = '#d9c9a6', GREEN = '#3f8a57', DARK = '#3b3f46';

/** The stand-in for a piece, drawn in the model's own frame (the layer applies the piece's position, turn and scale). */
export function standInFor(item: PlanPiece): ((b: Batch) => void) | undefined {
  const [minX, maxX, minZ, maxZ, height] = boxOf(item.asset);
  const width = maxX - minX, depth = maxZ - minZ, midX = (minX + maxX) / 2, midZ = (minZ + maxZ) / 2;
  switch (item.asset) {
    case 'bungalow': case 'house2': case 'flats': {
      const paint = item.paint ?? { wall: '#e6cf9f', roof: '#a85c40', door: '#6b4a2b' };
      const floors = item.asset === 'bungalow' ? 1 : item.asset === 'house2' ? 2 : 3;
      return (b) => drawHouse(b, 0, maxZ, width * 0.92, depth * 0.62, paint.wall, paint.roof, paint.door, floors);
    }
    case 'shops': case 'shoprow': case 'church': case 'mosque': case 'school': case 'clinic': case 'filling': case 'bank': case 'unfinished':
      return (b) => {
        const face = midZ + depth * 0.45, wall = '#e2d3b0', rows = Math.max(1, Math.round(height / 3.8));
        b.box(midX, height * 0.4, midZ, width * 0.94, height * 0.8, depth * 0.9, wall); b.box(midX, height * 0.84, midZ, width, height * 0.1, depth * 1.02, '#a85c40'); b.box(midX, 0.2, midZ, width * 0.97, 0.4, depth * 0.93, tone(wall, 0.66));
        // A door, a signboard over it (lit at night), and at least two windows a floor.
        b.box(midX, 1.1, face + 0.04, 1.5, 2.2, 0.12, '#6b4a2b'); b.box(midX, 2.75, face + 0.1, Math.min(width * 0.5, 5), 0.7, 0.12, '#1f5a3a'); b.quad(midX, 2.75, face + 0.17, Math.min(width * 0.5, 5) - 0.3, 0.4, LIT, { layer: 'glow' });
        for (let row = 0; row < rows; row++) for (const side of [-1, 1]) drawWindow(b, midX + side * Math.min(width * 0.3, 3.4), 2.0 + row * 3.4 + (row ? 0.4 : 0), face, (row + (side > 0 ? 1 : 0)) % 2 === 0, row === 0);
      };
    case 'fencegate':
      // Two piers with caps, and the leaves of the gate swung open against the yard: dark steel with a bar rail.
      return (b) => { for (const side of [-1, 1]) {
        b.box(side * 1.65, 0.9, 0, 0.5, 1.8, 0.5, SAND); b.box(side * 1.65, 1.85, 0, 0.64, 0.12, 0.64, '#efe6cf'); b.box(side * 1.65, 0.12, 0, 0.6, 0.24, 0.6, tone(SAND, 0.7));
        b.box(side * 2.0, 0.95, -0.9, 0.07, 1.5, 1.3, DARK); b.box(side * 2.0, 1.75, -0.9, 0.09, 0.1, 1.3, BARS);
      }
      // The electricity meter box on one pier (which one is fixed by where the gate stands): a grey case with a window and a red lamp.
      const meter = Math.round(item.x / 12) % 2 ? 1 : -1;
      b.box(meter * 1.65, 1.15, 0.31, 0.34, 0.46, 0.12, '#cfd1cc'); b.quad(meter * 1.65, 1.18, 0.38, 0.22, 0.2, '#2c3a46'); b.quad(meter * 1.65, 0.98, 0.38, 0.05, 0.05, '#d8473a', { layer: 'glow' }); };
    case 'lamp':
      return (b) => { b.cyl(0, 2.6, 0, 0.12, 5.2, '#5d5142'); b.box(0.7, 5.3, 0, 1.5, 0.12, 0.2, '#5d5142'); b.cyl(1.4, 5.2, 0, 0.3, 0.3, LIT, { seg: 8, layer: 'glow' }); };
    case 'busstop':
      return (b) => { for (const side of [-1, 1]) b.box(side * 1.9, 1.2, -0.7, 0.14, 2.4, 0.14, DARK); b.box(0, 2.5, 0, 4.4, 0.14, 2.1, '#8d9399'); b.box(0, 0.5, -0.7, 3.4, 0.1, 0.5, '#73553b'); };
    case 'kiosk': case 'stall':
      // A kiosk or stall: a timber box with a serving window lit from inside, a striped awning and a signboard.
      return (b) => { b.box(midX, 1.1, midZ, width * 0.8, 2.2, depth * 0.8, '#c69a4e'); b.box(midX, 2.35, midZ, width, 0.18, depth, '#b5483f'); b.quad(midX, 1.3, midZ + depth * 0.4 + 0.02, width * 0.5, 0.8, LIT, { layer: 'glow' }); b.box(midX, 0.55, midZ + depth * 0.4 + 0.15, width * 0.6, 0.1, 0.35, '#73553b'); b.box(midX, 2.75, midZ + depth * 0.4, width * 0.6, 0.45, 0.1, '#1f5a3a'); };
    case 'shadetree': case 'palm': case 'pawpaw': case 'plantain':
      return (b) => { b.cyl(0, height * 0.3, 0, 0.3, height * 0.6, '#73553b'); b.ico(0, height * 0.72, 0, width * 0.42, height * 0.26, depth * 0.42, GREEN); };
    case 'hedge':
      return (b) => b.box(0, 0.5, 0, width, 1.0, depth, GREEN);
    case 'bin':
      return (b) => b.cyl(0, 0.55, 0, 0.36, 1.1, '#3f6f4c');
    case 'tank':
      // An overhead water tank: a dark-blue plastic drum with ribs and a domed lid, on a steel stand with a platform.
      return (b) => { b.cyl(0, 3.3, 0, 0.95, 1.8, '#1d3452'); b.cyl(0, 4.4, 0, 0.95, 0.5, '#2a4a74', { top: 0.45 }); for (const y of [2.8, 3.5]) b.cyl(0, y, 0, 1.0, 0.1, '#14243b'); b.cyl(0, 4.7, 0, 0.18, 0.12, '#14243b', { seg: 6 });
        b.box(0, 2.35, 0, 2.2, 0.12, 2.2, DARK); for (const [x, z] of [[-0.95, -0.95], [0.95, -0.95], [-0.95, 0.95], [0.95, 0.95]] as const) b.box(x, 1.15, z, 0.12, 2.3, 0.12, DARK); b.box(0, 0.9, 0.95, 1.9, 0.08, 0.08, DARK); };
    case 'generator':
      // A petrol generator: a red cabinet with a dark control panel, a fuel tank on top, a tubular frame and an exhaust.
      return (b) => { b.box(0, 0.6, 0, 1.2, 0.9, 0.8, '#b5483f'); b.quad(-0.15, 0.62, 0.41, 0.7, 0.5, '#2f3338'); b.quad(0.4, 0.62, 0.41, 0.2, 0.3, '#e8c24a'); b.box(0, 1.2, 0, 0.8, 0.3, 0.6, '#d9d3c4'); b.box(0, 0.08, 0, 1.4, 0.16, 1.0, DARK);
        for (const x of [-0.62, 0.62]) b.box(x, 0.85, 0, 0.06, 0.06, 1.0, DARK); b.cyl(0.78, 0.7, -0.3, 0.07, 1.0, BARS, { seg: 6 }); };
    case 'billboard':
      return (b) => { for (const side of [-1, 1]) b.box(side * 2, 2.6, 0, 0.2, 5.2, 0.2, DARK); b.box(0, 5.2, 0, 6.3, 3, 0.2, '#f3eee0'); };
    case 'trafficlight':
      return (b) => { b.cyl(0, 2.5, 0, 0.1, 5, DARK); b.box(1.6, 4.9, 0, 3.2, 0.1, 0.1, DARK); b.box(3.2, 4.4, 0, 0.5, 1.2, 0.4, DARK); };
    case 'table':
      return (b) => b.box(0, 0.9, 0, 2, 0.1, 1, '#8a6644');
    case 'detail-gatehouse':
      // The gateman's hut: a block room with a barred window, a door and a flat roof with a lip.
      return (b) => { b.box(0, 1.1, 0, 1.8, 2.2, 1.5, SAND); b.box(0, 2.28, 0, 2.1, 0.16, 1.8, '#a85c40'); b.box(0, 2.42, 0, 2.1, 0.12, 1.8, '#efe6cf'); b.quad(-0.4, 1.3, 0.76, 0.6, 0.6, '#59707f'); for (const dx of [-0.6, -0.4, -0.2]) b.quad(-0.4 + dx + 0.2, 1.3, 0.78, 0.04, 0.6, BARS); b.box(0.5, 0.95, 0.76, 0.5, 1.7, 0.06, '#6b4a2b'); };
    case 'detail-generator-hut':
      // A generator shed: a block box, a louvred vent, a steel door and the exhaust stack.
      return (b) => { b.box(0, 1.1, 0, 1.8, 2.2, 1.5, SAND); b.box(0, 2.28, 0, 2.0, 0.14, 1.7, '#8d9399'); for (let i = 0; i < 4; i++) b.box(0.5, 1.2 + i * 0.22, 0.77, 0.6, 0.08, 0.05, BARS); b.box(-0.4, 0.95, 0.76, 0.6, 1.7, 0.06, '#3b6e8f'); b.cyl(0.75, 2.8, -0.4, 0.07, 1.2, BARS, { seg: 6 }); };
    case 'detail-ac-external':
      // A split AC's outdoor unit: a pale cabinet with a dark fan grille, on a bracket.
      return (b) => { b.box(0, 0.28, 0.2, 0.8, 0.5, 0.38, '#e6e6e0'); b.quad(-0.1, 0.28, 0.4, 0.42, 0.36, '#3a3d42'); b.box(0.3, 0.28, 0.4, 0.12, 0.34, 0.02, '#c9cac4'); b.box(0, 0.02, 0.2, 0.7, 0.04, 0.3, BARS); };
    case 'detail-dish':
      // A DSTV dish: a tilted disc on an arm, its receiver at the focus.
      return (b) => { b.cyl(0, 0.3, 0.05, 0.04, 0.6, BARS, { seg: 6 }); b.cyl(0, 0.72, 0.14, 0.34, 0.06, '#e9e9e6', { seg: 10, rx: 1.15 }); b.box(0, 0.74, 0.42, 0.05, 0.05, 0.22, BARS, { rx: 0.4 }); };
    case 'detail-security-light':
      return (b) => { b.box(0, 0.14, 0.16, 0.26, 0.2, 0.24, DARK); b.quad(0, 0.1, 0.29, 0.2, 0.12, LIT, { layer: 'glow' }); };
    default:
      return undefined;
  }
}
