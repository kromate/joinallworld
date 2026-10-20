/**
 * OWNER: scenes
 * Street life: shopfronts along a street's buildings (zoom phase 3b). Pure.
 *
 * frontagesOf() reads the street's own plan (the scenery buildings it already placed: a shop row, a bank, a clinic, a block of flats) and
 * finds each one's front plane and width; planShopfronts() divides every frontage into shop bays, and shopParts() turns the bays into
 * instanced parts (parts.ts): a stall riser, the window (lit from inside at dusk), a door, pilasters, a fascia with the shop's sign, an
 * awning with its valance, mannequins in a clothes shop's window, an A-board outside a café. The names are plain words for what a
 * shop sells (SHOP_NAMES): no trade marks. Everything is from the seed: the same street has the same shops on every device.
 */
import { makeRng } from '../../game/util.ts';
import { FIRST_MANNEQUIN, MANNEQUIN_CELLS, SIGN_CELLS, emptyParts } from './parts.ts';
import type { Parts } from './parts.ts';

/** What a street's plan says of a piece (street/street-plan.ts PlanPiece). */
export interface PieceLike { id: string; asset: string; x: number; z: number; ry: number; scale: number; role: string }
/** A building's front: from x0 to x1 along x, on the plane z; facing +1 when the street lies toward +z, −1 toward −z. */
export interface Frontage { id: string; x0: number; x1: number; z: number; facing: 1 | -1; height: number }

/** The buildings that get a row of shops on their ground floor. */
export const SHOP_ASSETS: ReadonlySet<string> = new Set(['shoprow', 'shops', 'bank', 'clinic', 'flats']);
/** The roles of the street plan's scenery buildings (vacant plots; across the road). */
const BUILDING_ROLES: ReadonlySet<string> = new Set(['building', 'far']);

/** Each shop building's front, from its box (street-kit.ts boxOf: minX, maxX, minZ, maxZ, height) and its turn (square turns only). */
export function frontagesOf(pieces: readonly PieceLike[], boxOf: (asset: string) => readonly number[]): Frontage[] {
  const out: Frontage[] = [];
  for (const piece of pieces) {
    if (!SHOP_ASSETS.has(piece.asset) || !BUILDING_ROLES.has(piece.role)) continue;
    const [minX = 0, maxX = 0, , maxZ = 0, height = 4] = boxOf(piece.asset), s = piece.scale;
    const quarter = ((Math.round(piece.ry / (Math.PI / 2)) % 4) + 4) % 4;
    if (quarter === 0) out.push({ id: piece.id, x0: piece.x + minX * s, x1: piece.x + maxX * s, z: piece.z + maxZ * s, facing: 1, height: height * s });
    else if (quarter === 2) out.push({ id: piece.id, x0: piece.x - maxX * s, x1: piece.x - minX * s, z: piece.z - maxZ * s, facing: -1, height: height * s });
  }
  // Two fronts on one plane never overlap: a later one starts where the earlier ends.
  out.sort((a, b) => a.facing - b.facing || a.x0 - b.x0 || a.z - b.z);
  for (let i = 1; i < out.length; i++) {
    const b = out[i]!;
    for (let j = 0; j < i; j++) {
      const a = out[j]!;
      if (a.facing === b.facing && Math.abs(a.z - b.z) < 0.6 && a.x1 > b.x0) b.x0 = Math.min(b.x1, a.x1);
    }
  }
  return out.filter((f) => f.x1 - f.x0 > 0.5);
}

/** What a shop sells: its sign's words, its window's light, and what stands in the window. */
export interface ShopKind { name: string; glow: string; mannequins: number; board: boolean }
export const SHOP_NAMES: readonly ShopKind[] = Object.freeze([
  { name: 'CAFÉ', glow: '#ffcf8a', mannequins: 0, board: true },
  { name: 'COFFEE & TEA', glow: '#ffc27a', mannequins: 0, board: true },
  { name: 'BAKERY', glow: '#ffd59a', mannequins: 0, board: true },
  { name: 'FRUIT & VEG', glow: '#f2e6a8', mannequins: 0, board: false },
  { name: 'PHARMACY', glow: '#d8f0e6', mannequins: 0, board: false },
  { name: 'FASHION', glow: '#ffe2c4', mannequins: 3, board: false },
  { name: 'BOUTIQUE', glow: '#ffd8d0', mannequins: 2, board: false },
  { name: 'SHOES', glow: '#fff0d6', mannequins: 0, board: false },
  { name: 'PHONES & REPAIRS', glow: '#d6e8ff', mannequins: 0, board: true },
  { name: 'BOOKS', glow: '#ffe4b0', mannequins: 0, board: false },
  { name: 'HAIR SALON', glow: '#ffd6ea', mannequins: 1, board: true },
  { name: 'HARDWARE', glow: '#f0e8d0', mannequins: 0, board: false },
  { name: 'FLOWERS', glow: '#f6ffd6', mannequins: 0, board: false },
  { name: 'TAILOR', glow: '#ffe8c8', mannequins: 2, board: false },
  { name: 'JEWELLERY', glow: '#fff4d0', mannequins: 0, board: false },
  { name: 'NOODLE BAR', glow: '#ffc890', mannequins: 0, board: true },
  { name: 'GRILL', glow: '#ffb880', mannequins: 0, board: true },
  { name: 'MINI MARKET', glow: '#f4f4e0', mannequins: 0, board: false },
  { name: 'OPTICIAN', glow: '#e6f2ff', mannequins: 0, board: false },
  { name: 'SPORTSWEAR', glow: '#e8f0ff', mannequins: 3, board: false },
] satisfies ShopKind[]);
/** Each sign's own colours (background, letters), by the shop's index. */
export const SIGN_COLOURS: readonly (readonly [string, string])[] = Object.freeze([
  ['#2f4a3a', '#f4ead2'], ['#5a2f2a', '#f6e7c8'], ['#f4e6c8', '#6b3a1f'], ['#2f6f3a', '#f4f4ea'], ['#f4f4ef', '#1f7a4a'],
  ['#1d1f22', '#f4f0e8'], ['#e9d8d0', '#5a2f3f'], ['#2b3a5a', '#f2e6c8'], ['#1f5fa8', '#ffffff'], ['#6b2f2f', '#f2e2b8'],
  ['#f2d0e0', '#5a2f4a'], ['#d9822b', '#1d1f22'], ['#e6f0d8', '#2f6f3a'], ['#3a2f2a', '#e8d2a8'], ['#1d1f22', '#d9b860'],
  ['#c8102e', '#fff4e0'], ['#2b2b2b', '#f2a03a'], ['#f2c12e', '#1d1f22'], ['#eef3f8', '#2b5c9a'], ['#1f2630', '#7fd1ff'],
]);
export const AWNINGS = ['#b8322a', '#2f6f4a', '#2b4a7a', '#d9a441', '#6b3a5a', '#e8e0cc', '#1f2630', '#c0562f'] as const;

export interface Bay { x: number; z: number; width: number; facing: 1 | -1; shop: number; awning: string; scale: number; door: -1 | 1 }
/** The width a bay is aimed at, and the narrowest that still gets a shop. */
export const BAY_WIDTH = 4.4, BAY_MIN = 2.6;

/** Every frontage cut into bays of about BAY_WIDTH, each a shop of its own; a building shorter than a full storefront gets a lower one. */
export function planShopfronts(frontages: readonly Frontage[], seed: string): Bay[] {
  const next = makeRng(`street-life|shops|${seed}`), out: Bay[] = [];
  for (const f of frontages) {
    const span = f.x1 - f.x0 - 0.4, n = Math.max(1, Math.round(span / BAY_WIDTH)), width = span / n;
    if (width < BAY_MIN) continue;
    const scale = Math.max(0.7, Math.min(1, f.height / 4.6));
    for (let i = 0; i < n; i++) {
      out.push({ x: f.x0 + 0.2 + width * (i + 0.5), z: f.z, width, facing: f.facing, shop: Math.floor(next() * SHOP_NAMES.length) % SHOP_NAMES.length,
        awning: AWNINGS[Math.floor(next() * AWNINGS.length) % AWNINGS.length]!, scale, door: next() < 0.5 ? -1 : 1 });
    }
  }
  return out;
}

/** How far the awning reaches out from the wall, and its slope (radians). */
export const AWNING_DEPTH = 1.3, AWNING_TILT = 0.32;
/** The bays as parts. Everything stands just proud of the wall, on the street's side. */
export function shopParts(bays: readonly Bay[], base = 0.05): Parts {
  const p = emptyParts();
  bays.forEach((bay, bayIndex) => {
    const { x, z, width: w, facing: f, scale: k } = bay, ry = f > 0 ? 0 : Math.PI, at = (out: number): number => z + f * out;
    const kind = SHOP_NAMES[bay.shop]!, top = base + 3.3 * k;
    p.boxes.push({ x, y: base + 0.22, z: at(0.07), w: w - 0.3, h: 0.44, d: 0.14, ry, colour: '#3a3d42' });                    // the stall riser
    p.glows.push({ x, y: base + 0.44 + 1.0 * k, z: at(0.05), w: w - 0.35, h: 2.0 * k, d: 0.06, ry, colour: kind.glow, bay: bayIndex });          // the window
    const doorX = x + bay.door * (w / 2 - 0.75);
    p.boxes.push({ x: doorX, y: base + 1.12 * k, z: at(0.09), w: 0.95, h: 2.24 * k, d: 0.05, ry, colour: '#2b2f33' });          // the door
    for (const side of [-1, 1]) p.boxes.push({ x: x + side * (w / 2 - 0.08), y: base + 1.65 * k, z: at(0.1), w: 0.2, h: 3.3 * k, d: 0.2, ry, colour: '#d9d2c2' });
    p.boxes.push({ x, y: top - 0.38 * k, z: at(0.09), w, h: 0.76 * k, d: 0.12, ry, colour: '#26292d' });                       // the fascia
    p.quads.push({ x, y: top - 0.38 * k, z: at(0.16), w: w - 0.5, h: 0.58 * k, ry, cell: bay.shop % SIGN_CELLS, lit: true, bay: bayIndex });  // the sign
    // The awning slopes down away from the wall, over the window; its valance hangs from the outer edge.
    const ay = base + 2.62 * k, mid = 0.08 + AWNING_DEPTH / 2 * Math.cos(AWNING_TILT);
    p.boxes.push({ x, y: ay, z: at(mid), w: w - 0.2, h: 0.05, d: AWNING_DEPTH, ry, tilt: AWNING_TILT, colour: bay.awning });
    const edge = 0.08 + AWNING_DEPTH * Math.cos(AWNING_TILT), drop = ay - (AWNING_DEPTH / 2) * Math.sin(AWNING_TILT);
    p.boxes.push({ x, y: drop - 0.13, z: at(edge), w: w - 0.2, h: 0.26, d: 0.03, ry, colour: bay.awning === '#e8e0cc' ? '#b8322a' : '#f2efe6' });
    // Mannequins stand in the window, away from the door.
    for (let m = 0; m < kind.mannequins; m++) {
      const mx = x - bay.door * (w / 2 - 0.55) + bay.door * ((m + 0.5) / kind.mannequins) * (w - 2.1);
      p.quads.push({ x: mx, y: base + 0.48 + 0.85 * k, z: at(0.1), w: 0.62 * k, h: 1.7 * k, ry, cell: FIRST_MANNEQUIN + ((bay.shop + m) % MANNEQUIN_CELLS) });
    }
    if (kind.board) p.boxes.push({ x: doorX + bay.door * 1.1, y: base + 0.45, z: at(0.38), w: 0.6, h: 0.9, d: 0.08, ry, tilt: -0.12, colour: '#1d1f22' });
  });
  return p;
}
