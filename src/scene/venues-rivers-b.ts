/**
 * OWNER: scenes
 * Port Harcourt's campuses, stadiums, civic and industrial places, and the props its scenes share. The variants are
 * re-exported through VARIANTS of src/scene/venues-rivers.ts, which holds the parks, markets and watersides.
 *
 *   office / ph-avenue | ph-senate | ph-college | ph-industry
 *       a campus gate with a long planted avenue to a faculty; a compact city campus round a tall senate building;
 *       a teachers' college of low classroom blocks round an assembly ground; a layout road of warehouses, a pipe
 *       yard and an open workshop
 *   viewing / ph-main-stand | ph-bowl
 *       an older city stadium: one roofed main stand over a pitch and a straight of red track; a large modern bowl
 *       under a white roof that sweeps up towards the back
 *   statehouse / ph-gra-gate    a palm-lined approach to a closed gate and a guard post; a white colonial-style house
 *                               behind the fence, a public notice board on the visitors' side
 *   walk / ph-station | ph-wharf
 *       a colonial railway station frontage with a clock gable, a water tower and the old township's shop-houses;
 *       a road along a port fence, with transit sheds, quay cranes and ships' hulls beyond it
 *   hub / ph-interchange        a road platform and bus bays beside a flyover
 *   refinery / ph-creek-view    a railed bank looking across a creek to tanks, columns and flare stacks
 *
 * Every sign is drawn from the venue's own label (context.label) or is a plain word; nothing here names a place.
 * Roofs are aluminium and zinc sheet. Scenes are static. Scene definition format: see venues-outdoor.ts.
 */
import { GLOW, GLASS } from './build.ts';
import type { Batch, Colour, SceneCamera, SceneDef, Vec3 } from './types.ts';
import {
  ground, bench, leafTree, tallTree, bush, lampPost, flag, parasol, fence, sign, signBoard, landmark, extra, table, car, crate,
  WOOD_DARK, WOOD_LIGHT, METAL, METAL_DARK, WHITE, BLACK, LEAF, LEAF_LIGHT, WARM,
} from './props.ts';
import { PI, HALF, OPEN, seeded, plain, fit, labelled, FRONT_SPARE } from './venues-common.ts';

export const ZINC: readonly Colour[] = ['#b7c1c7', '#a7b3bb', '#c5ccd0', '#98a6af'];
/** Weathered sheet: dulled, with rust coming through. */
export const OLD_ZINC: readonly Colour[] = ['#a9a195', '#9b8a7a', '#b4ada1', '#8f7a68'];
export const MANGROVE: readonly Colour[] = ['#2f6a44', '#3a7a4c', '#27583a'];
export const ASPHALT = '#4b4e53', KERB = '#c9c4b6', PAVING = '#cfc6ae', GRASS = '#5a9a50', GRASS_EDGE = '#40703a', CONCRETE = '#b9b4a6';
/** A wide open-air scene needs the camera further back than a room does, and further still in a tall window. */
export const WIDE: SceneCamera = { landscape: [17.6, 23.2, 29.8], portrait: [22, 48, 64] };
/**
 * A scene's camera. `start` above 1 begins the view further from the avatar, for a scene with something tall in it:
 * a tower, a wheel, a crane or a stand's roof is then in view from the first moment.
 */
export const view = (start?: number, landscape: Vec3 = WIDE.landscape, portrait: Vec3 = WIDE.portrait): SceneCamera => (start ? { landscape, portrait, start } : { landscape, portrait });
type Rand = () => number;

/** A gable roof of metal sheet over a w by d footprint, its eaves at height y. The ridge runs along x, or along z when turned by `ry`. */
export function zincRoof(b: Batch, x: number, y: number, z: number, w: number, d: number, tone = 0, a = 0.34, ry = 0, tones: readonly Colour[] = ZINC): void {
  const slope = d / 2 / Math.cos(a) + 0.2, rise = (Math.tan(a) * d) / 4 + 0.04;
  b.at(x, y, z, ry, () => {
    b.box(0, rise, -d / 4, w + 0.5, 0.12, slope, tones[tone % 4]!, { rx: -a });
    b.box(0, rise, d / 4, w + 0.5, 0.12, slope, tones[(tone + 1) % 4]!, { rx: a });
    b.box(0, rise * 2 + 0.05, 0, w + 0.56, 0.12, 0.3, tones[3]!);
  });
}
/** A sheet roof on posts over open ground: a market shed, a shelter, a workshop. Its roof leans down towards +z. */
export function openShed(b: Batch, x: number, z: number, w: number, d: number, h = 3, tone = 0, tones: readonly Colour[] = ZINC, post: Colour = WOOD_DARK): void {
  const n = Math.max(2, Math.round(w / 3.4) + 1);
  for (let i = 0; i < n; i++) {
    const px = x - w / 2 + 0.1 + (i * (w - 0.2)) / (n - 1);
    b.box(px, h / 2, z + d / 2 - 0.1, 0.13, h, 0.13, post); b.box(px, (h + 0.5) / 2, z - d / 2 + 0.1, 0.13, h + 0.5, 0.13, post);
  }
  b.box(x, h + 0.3, z, w + 0.5, 0.1, d + 0.6, tones[tone % 4]!, { rx: 0.5 / d });
  for (let i = 0; i < Math.round(w / 1.6); i++) b.box(x - w / 2 + 0.8 + i * 1.6, h + 0.36, z, 0.05, 0.05, d + 0.6, tones[3]!, { rx: 0.5 / d });
}
/** A building block of several floors with a strip of windows on each floor of its +z and +x faces. */
export function block(b: Batch, x: number, z: number, w: number, d: number, floors: number, wall: Colour, { fh = 2.9, glass = '#5f7f98', band = '#d8cdb0', bay = 1.9 }: { fh?: number; glass?: Colour; band?: Colour; bay?: number } = {}): void {
  const h = floors * fh, nx = Math.max(1, Math.floor((w - 0.6) / bay)), nz = Math.max(1, Math.floor((d - 0.6) / bay));
  b.box(x, h / 2, z, w, h, d, wall);
  for (let f = 0; f < floors; f++) {
    const wy = f * fh + fh * 0.58;
    for (let i = 0; i < nx; i++) b.quad(x - w / 2 + (i + 0.5) * (w / nx), wy, z + d / 2 + 0.02, (w / nx) * 0.62, fh * 0.42, glass);
    for (let i = 0; i < nz; i++) b.quad(x + w / 2 + 0.02, wy, z - d / 2 + (i + 0.5) * (d / nz), (d / nz) * 0.62, fh * 0.42, glass, { ry: HALF });
    b.box(x, (f + 1) * fh, z, w + 0.16, 0.14, d + 0.16, band);
  }
}
/** A royal palm: a smooth grey trunk, a green crownshaft and a small head of fronds. */
export function royalPalm(b: Batch, x: number, z: number, h = 6.4, s = 1): void {
  b.cyl(x, h / 2, z, 0.22 * s, h, '#b5ad9c', { seg: 5, top: 0.7 });
  b.cyl(x, h + 0.35, z, 0.17 * s, 0.9, '#5d9a52', { seg: 5 });
  for (let i = 0; i < 7; i++) b.at(x, h + 0.8, z, (i / 7) * PI * 2 + x, () => b.box(0, -0.3 * s, 1.1 * s, 0.5 * s, 0.05, 2.3 * s, i % 2 ? LEAF : LEAF_LIGHT, { rx: 0.4 }));
}
/** A mangrove: a dark crown standing on arched prop roots. */
export function mangrove(b: Batch, x: number, y: number, z: number, s = 1, tone = 0): void {
  for (let i = 0; i < 3; i++) { const a = i * 2.1 + x; b.cyl(x + Math.sin(a) * 0.5 * s, y + 0.7 * s, z + Math.cos(a) * 0.4 * s, 0.05 * s, 1.6 * s, '#5a4a38', { seg: 3, rz: Math.sin(a) * 0.35, rx: -Math.cos(a) * 0.3 }); }
  b.ico(x, y + 2.1 * s, z, 1.5 * s, 1.0 * s, 1.3 * s, MANGROVE[tone % 3]!);
  b.ico(x + 0.8 * s, y + 2.5 * s, z - 0.3 * s, 1.0 * s, 0.8 * s, 1.0 * s, MANGROVE[(tone + 1) % 3]!);
}
/** A stretch of tidal creek between z = far and z = near, lying at height y: calm brown-green water with slow ripples and no surf. */
export function creek(b: Batch, rand: Rand, far: number, near: number, y: number, ripples = 9): void {
  const mid = (far + near) / 2, d = near - far;
  b.box(0, y - 1.3, mid, 90, 2.4, d + 0.6, '#4a5a56');
  b.box(0, y, mid, 90, 0.08, d, '#587a78');
  b.box(0, y + 0.06, mid, 90, 0.05, d, '#a5c6bd', GLASS);
  for (let i = 0; i < ripples; i++) b.box(-26 + rand() * 52, y + 0.1, far + 1 + rand() * (d - 2), 2 + rand() * 2, 0.02, 0.1, '#e4efe6', GLASS);
}
/** The far bank of a creek: a low mud bank along z with a wall of mangrove on it. */
export function mangroveBank(b: Batch, rand: Rand, z: number, y: number, x0 = -32, x1 = 32, step = 3.2, far = false): void {
  b.box((x0 + x1) / 2, y + 0.1, z - 4, x1 - x0 + 20, 0.9, 9, '#4f5c3e');
  // A bank seen from far off is crowns only: the roots are too thin to show
  for (let x = x0; x <= x1; x += step) {
    const mx = x + rand() * 1.4, mz = z - rand() * 1.2, s = 1.2 + rand() * 0.6, tone = Math.floor(rand() * 3);
    if (far) b.ico(mx, y + 0.3 + 1.9 * s, mz, 1.7 * s, 1.2 * s, 1.3 * s, MANGROVE[tone]!); else mangrove(b, mx, y + 0.3, mz, s, tone);
  }
  for (let x = x0 + 1.6; x <= x1; x += step * 1.5) b.ico(x + rand() * 2, y + 4 + rand(), z - 3.4 - rand() * 2, 2.6 + rand(), 1.8 + rand() * 0.6, 2, MANGROVE[Math.floor(rand() * 3)]!);
}
/** A dug-out canoe. */
export function canoe(b: Batch, x: number, y: number, z: number, ry: number, len = 4.4, hull: Colour = '#6b4a2e'): void {
  b.at(x, y, z, ry, () => { b.ball(0, 0.18, 0, 0.5, 0.28, len / 2, hull, { seg: 6 }); b.ball(0, 0.3, 0, 0.36, 0.14, len / 2 - 0.25, '#3d2c1c', { seg: 6 }); });
}
/** A fibre passenger speedboat: a white hull with a coloured band, bench seats with life jackets on them, an outboard engine and, on some, an awning. */
export function speedboat(b: Batch, x: number, y: number, z: number, ry: number, band: Colour = '#2a6fb0', awning = false): void {
  b.at(x, y, z, ry, () => {
    b.box(0, 0.35, -0.3, 1.5, 0.6, 3.8, '#f1efe8'); b.box(0, 0.35, 1.6, 1.06, 0.6, 1.06, '#f1efe8', { ry: PI / 4 });
    b.box(0, 0.52, -0.3, 1.54, 0.16, 3.84, band); b.box(0, 0.3, -0.3, 1.2, 0.56, 3.5, '#d9d5c9');
    for (let i = 0; i < 3; i++) { b.box(0, 0.62, -1.4 + i * 1.0, 1.3, 0.08, 0.32, '#c9c4b6'); for (const s of [-1, 1]) b.box(s * 0.36, 0.8, -1.4 + i * 1.0, 0.34, 0.28, 0.22, '#f07a1e'); }
    b.box(0, 0.75, -2.35, 0.36, 0.7, 0.4, '#2a2d33');
    if (awning) { for (const sx of [-1, 1]) for (const sz of [-1.6, 0.7]) b.box(sx * 0.7, 1.3, sz, 0.05, 1.5, 0.05, METAL); b.box(0, 2.06, -0.45, 1.6, 0.06, 2.6, band); }
  });
}
/** A wooden passenger boat: a long plank hull with thwarts, life jackets and an outboard engine. */
export function woodenBoat(b: Batch, x: number, y: number, z: number, ry: number, len = 6.4, paint: Colour = '#2f8f55'): void {
  b.at(x, y, z, ry, () => {
    b.ball(0, 0.25, 0, 0.82, 0.44, len / 2, '#7a5636', { seg: 6 }); b.ball(0, 0.44, 0, 0.64, 0.2, len / 2 - 0.3, '#4a3524', { seg: 6 });
    for (const s of [-1, 1]) b.ball(0, 0.36, s * (len / 2 - 0.5), 0.4, 0.3, 0.56, paint, { seg: 5 });
    for (let i = 0; i < 4; i++) { const tz = -len * 0.27 + i * len * 0.18; b.box(0, 0.6, tz, 1.3, 0.07, 0.26, WOOD_LIGHT); if (i % 2 === 0) b.box(0.3, 0.78, tz, 0.34, 0.28, 0.22, '#f07a1e'); }
    b.box(0, 0.75, -len / 2 + 0.1, 0.3, 0.6, 0.34, '#2a2d33');
  });
}
/** A city bus of the minibus kind (its nose at +z). */
export function bus(b: Batch, x: number, z: number, ry: number, body: Colour = '#f1efe8', stripe: Colour = '#2a6fb0'): void {
  b.at(x, 0, z, ry, () => {
    b.box(0, 1.25, 0, 1.9, 1.9, 4.4, body); b.box(0, 0.75, 0, 1.94, 0.3, 4.44, stripe);
    b.box(0, 1.75, 0.1, 1.96, 0.6, 3.7, '#4f6a7a'); b.box(0, 2.24, 0, 1.7, 0.1, 4, '#d8d4c8');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(sx * 0.9, 0.36, sz * 1.45, 0.36, 0.24, BLACK, { seg: 6, rz: HALF });
    for (const sx of [-1, 1]) b.box(sx * 0.6, 0.85, 2.22, 0.3, 0.16, 0.04, WARM, GLOW);
  });
}
/** A passenger tricycle under a black hood (its nose at +z). */
export function keke(b: Batch, x: number, z: number, ry: number, body: Colour = '#e9b820'): void {
  b.at(x, 0, z, ry, () => {
    b.box(0, 0.75, -0.3, 1.3, 0.8, 1.7, body); b.box(0, 1.78, -0.1, 1.36, 0.12, 2.3, '#2a2d33');
    b.box(0, 1.28, -1.12, 1.3, 0.9, 0.08, '#2a2d33'); b.box(0, 1.25, 0.9, 1.1, 0.9, 0.06, '#8fb8cc', { rx: -0.25 });
    b.box(0, 0.6, 1.05, 0.5, 0.5, 0.7, body);
    b.cyl(0, 0.3, 1.3, 0.3, 0.16, BLACK, { seg: 6, rz: HALF }); for (const sx of [-1, 1]) b.cyl(sx * 0.62, 0.3, -0.8, 0.3, 0.18, BLACK, { seg: 6, rz: HALF });
  });
}
/** A flatbed lorry (its nose at +z): the bed's top is at y = 1.25 and runs from z = -3.6 to 1.5 in its own space. */
export function lorry(b: Batch, x: number, z: number, ry: number, cab: Colour, load?: (b: Batch) => void): void {
  b.at(x, 0, z, ry, () => {
    b.box(0, 1.05, -1.05, 2.3, 0.4, 5.1, '#6d6f72'); b.box(0, 1.5, 2.6, 2.3, 2.1, 1.9, cab); b.quad(0, 1.95, 3.56, 1.9, 0.8, '#8fb8cc');
    for (const sz of [-3, -1.9, 2.7]) for (const sx of [-1, 1]) b.cyl(sx * 1.05, 0.46, sz, 0.46, 0.34, BLACK, { seg: 7, rz: HALF });
    load?.(b);
  });
}
/** A wheelbarrow, its handles at -z. */
export function barrow(b: Batch, x: number, z: number, ry: number, fill?: Colour): void {
  b.at(x, 0, z, ry, () => {
    b.box(0, 0.62, 0, 0.9, 0.36, 1.3, '#4d7a8a'); if (fill) b.ico(0, 0.9, 0, 0.4, 0.24, 0.56, fill);
    b.cyl(0, 0.26, 0.8, 0.26, 0.14, BLACK, { seg: 6, rz: HALF }); for (const s of [-1, 1]) b.box(s * 0.36, 0.56, -1, 0.06, 0.06, 0.9, WOOD_DARK);
  });
}
/** A road bridge deck along x at height y, on piers, with parapets and lane marks. */
export function flyover(b: Batch, z: number, y: number, x0: number, x1: number, w = 4.6): void {
  const cx = (x0 + x1) / 2, len = x1 - x0;
  b.box(cx, y - 0.35, z, len, 0.7, w, '#bdb8aa'); b.box(cx, y + 0.03, z, len, 0.06, w - 0.6, ASPHALT);
  for (const s of [-1, 1]) b.box(cx, y + 0.4, z + s * (w / 2 - 0.12), len, 0.8, 0.24, '#d6d1c3');
  for (let x = x0 + 3; x < x1 - 1; x += 7) { b.box(x, (y - 0.7) / 2, z, 1.1, y - 0.7, 1.8, '#a9a496'); b.box(x, y - 0.95, z, 1.5, 0.5, w - 0.8, '#b5b0a2'); }
  for (let x = x0 + 1.5; x < x1; x += 3) b.box(x, y + 0.07, z, 1.2, 0.02, 0.12, '#e6dfc8');
}
/** Students, visitors and workers baked into a scene. */
const person = (body: string, outfit: string, outfitColor: string, more: Record<string, unknown> = {}): Record<string, unknown> => ({ body, outfit, outfitColor, ...more });

// ---------------------------------------------------------------------------------------------
// Campus gate and avenue: a wide gate across a dual road, and beyond it a long planted avenue to a faculty building.

const avenue: SceneDef = {
  mood: 'outdoor', accent: '#2a5fa8', camera: view(2.5), walk: OPEN,
  build(b, context) {
    ground(b, { w: 30, d: 26, color: GRASS, edge: GRASS_EDGE });
    b.box(-1, 0.03, 0, 7.6, 0.04, 26, ASPHALT);
    for (const s of [-1, 1]) { b.box(-1 + s * 3.95, 0.1, 0, 0.3, 0.2, 26, KERB); b.box(-1 + s * 5.3, 0.03, 0, 2.2, 0.04, 26, PAVING); }
    b.box(-1, 0.12, -2.4, 0.9, 0.2, 11, '#6aa056');
    for (let i = 0; i < 4; i++) bush(b, -1, -6.6 + i * 2.8, { s: 0.55, color: i % 2 ? '#c0407e' : LEAF });
    for (let i = 0; i < 9; i++) for (const s of [-1, 1]) b.box(-1 + s * 2.1, 0.06, -11.4 + i * 2.8, 0.14, 0.02, 1.4, '#e6dfc8');
    // The gate: two slim pylons under a light beam that carries the name, the gatehouse beside it; one lane's barrier is up
    for (const s of [-1, 1]) { b.box(-1 + s * 4.9, 2.8, 7.6, 1.2, 5.6, 1.2, '#f0e8d2'); b.box(-1 + s * 4.9, 0.4, 7.6, 1.5, 0.8, 1.5, '#2a5fa8'); }
    b.box(-1, 5.4, 7.6, 11.4, 1, 0.5, '#2a5fa8'); b.box(-1, 6, 7.6, 11.8, 0.2, 0.8, '#f0e8d2');
    labelled(b, context.label, -1, 5.4, 7.87, 10, 0.42, WHITE, '#2a5fa8', true);
    b.box(-3, 1, 8.3, 3.4, 0.12, 0.12, '#c9423a'); b.box(-4.7, 0.6, 8.3, 0.3, 1.2, 0.3, METAL_DARK);
    b.box(2.5, 2.3, 8.3, 0.12, 2.8, 0.12, '#c9423a', { rz: 0.25 }); b.box(2.85, 0.6, 8.3, 0.3, 1.2, 0.3, METAL_DARK);
    fence(b, [-6.6, 7.6], [-14.6, 7.6], { h: 1.5, color: '#f0e8d2', gap: 1.9 }); fence(b, [4.6, 7.6], [14.6, 7.6], { h: 1.5, color: '#f0e8d2', gap: 1.9 });
    b.box(8, 1.4, 9.4, 2.8, 2.8, 2.2, '#f0e8d2'); b.box(8, 2.9, 9.5, 3.3, 0.2, 2.8, '#2a5fa8'); b.quad(8, 1.7, 10.52, 1.6, 1, '#5f7f98');
    extra(b, 'ph-avenue-guard', 5.6, 9.6, 0.3, 'stand', { look: person('man', 'office', 'navy', { accessories: ['cap'] }) });
    // The avenue's trees and lamps
    for (let i = 0; i < 5; i++) { leafTree(b, -8.8, 5 - i * 3, { s: 1, tone: i }); royalPalm(b, 6.9, 5 - i * 3, 5.4 + (i % 2) * 0.5); }
    leafTree(b, -12, 10.8, { s: 0.9, tone: 1 }); leafTree(b, 12.6, 11, { s: 0.85, tone: 2 });
    lampPost(b, -5.4, 2.6); lampPost(b, 3.4, -1.8, { light: true }); lampPost(b, -5.4, -6.4); lampPost(b, 3.4, 4.4);
    // The faculty at the far end, a lecture block at the left, a low annexe and a bus shelter at the right
    block(b, -1, -10.8, 16, 3.6, 3, '#e9dfc6'); zincRoof(b, -1, 8.7, -10.8, 16.4, 4.4, 0, 0.3);
    b.box(-1, 4.6, -8.8, 3.6, 9.2, 0.8, '#d6c9a8'); b.box(-1, 1.4, -8.38, 2, 2.8, 0.06, '#30363c'); b.box(-1, 0.05, -8, 13, 0.04, 2, PAVING);
    block(b, -12.6, -3, 3.4, 8.4, 2, '#e6d8b8'); zincRoof(b, -12.6, 5.8, -3, 8.8, 3.8, 1, 0.3, HALF);
    block(b, 11.2, -10.4, 5.6, 4, 1, '#e6d8b8', { fh: 3.2 }); zincRoof(b, 11.2, 3.2, -10.4, 6, 4.4, 2);
    bus(b, 0.9, -3, 0, '#f1efe8', '#2a5fa8');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(10.8 + sx * 1.7, 1.3, -2.8 + sz * 0.8, 0.12, 2.6, 0.12, METAL_DARK);
    b.box(10.8, 2.7, -2.8, 4, 0.12, 2.3, ZINC[0]!); bench(b, 10.8, -3, { w: 2.6, back: true });
    extra(b, 'ph-avenue-wait', 10.8, -3, 0, 'sit', { seat: 0.6 });
    extra(b, 'ph-avenue-student-1', 4.4, 2.4, PI, 'walk', { look: person('woman', 'casual', 'teal', { accessories: ['backpack'] }) });
    extra(b, 'ph-avenue-student-2', -5.2, -4, 0.3, 'walk', { look: person('man', 'casual', 'orange', { accessories: ['backpack'] }) });
    return {
      spots: [
        landmark('lab', /lab|research|room|faculty|study|class/, 1.8, -6.4, PI),
        landmark('work', /work|staff|gate|office|job|shift/, 5.6, 11, 0, { act: { pose: 'work' } }),
        landmark('people', /people|crowd|meet|avenue/, -2.4, 10.4, 0),
      ],
      crowd: [[2.2, 10.4, 0.4], [-5.4, 10.6, -0.5], [11, 11.4, 2.4], [-8.6, 10, 1.2], [1.2, 4.6, 0.8], [3.2, 11.6, 2.8], [-5.4, 4.6, 2.4], [4.4, -3.6, 1.6], [4.4, 1, -0.4], [-5.6, -2, 3.1], [3.6, -7.6, 0.6], [-4.2, -7.6, 0.2]],
      spare: [[-4, 10.6], [1, 9.6], [-6, 11.4], [4, 6]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// City campus: a tall senate building over a tight paved court with a roundabout, hemmed in by faculty blocks.

const senate: SceneDef = {
  mood: 'outdoor', accent: '#1f6f8f', camera: view(3.5, [18, 27, 34], [21, 49, 64]), walk: OPEN,
  build(b, context) {
    ground(b, { w: 30, d: 26, color: PAVING, edge: '#8f8872' });
    b.box(1, 0.03, 2.4, 18, 0.04, 14.4, '#6b6e72');
    // The senate building: a tower of five floors between lower wings, a canopy over its steps
    block(b, -3, -10, 9, 5, 5, '#ece6d6', { fh: 2.2, glass: '#3f6f98', band: '#1f6f8f' });
    b.box(-3, 11.4, -10, 9.4, 0.8, 5.4, '#1f6f8f'); b.box(-3, 12.1, -10, 3, 0.7, 2.4, '#d8d2c2');
    for (const s of [-1, 1]) b.box(-3 + s * 4.3, 5.5, -7.4, 0.5, 11, 0.3, '#d8d2c2');
    block(b, -11.4, -10.2, 7, 4.2, 3, '#ddd3b8', { fh: 2.6 }); block(b, 6, -10.2, 8.6, 4.2, 2, '#ddd3b8', { fh: 2.6 });
    b.box(-3, 3.3, -6.3, 5.6, 0.3, 2.6, '#1f6f8f'); for (const s of [-1, 1]) b.cyl(-3 + s * 2.4, 1.6, -5.4, 0.18, 3.2, WHITE, { seg: 6 });
    b.box(-3, 0.12, -6.2, 6, 0.24, 2.8, '#d8d2c2'); b.box(-3, 1.4, -7.46, 2.4, 2.8, 0.06, '#27323a');
    labelled(b, context.label, -3, 4, -5.1, 5.4, 0.42, WHITE, '#1f6f8f', true);
    // The roundabout: a ring of flowers round an open book on a pedestal
    b.cyl(-3, 0.15, -0.6, 2.7, 0.3, '#d8d2c2', { seg: 14 }); b.disc(-3, 0.31, -0.6, 2.4, '#6aa056', { seg: 14 });
    for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2; b.ico(-3 + Math.sin(a) * 1.8, 0.5, -0.6 + Math.cos(a) * 1.8, 0.4, 0.3, 0.4, i % 2 ? '#d9482f' : '#f2c14e'); }
    b.box(-3, 1, -0.6, 0.9, 1.6, 0.9, '#cfc8b6');
    for (const s of [-1, 1]) b.box(-3 + s * 0.42, 2.02, -0.6, 0.86, 0.1, 1.1, WHITE, { rz: s * 0.3 });
    // Faculty blocks close in on the left; cars, hedges and a notice board fill what is left of the court
    block(b, -12.6, 1.4, 3.4, 9.6, 3, '#e3d9bf', { fh: 2.7 }); zincRoof(b, -12.6, 8.1, 1.4, 10, 3.8, 0, 0.3, HALF);
    b.box(-10.86, 1.3, 0.2, 0.06, 2.6, 1.6, '#27323a'); b.box(-10.2, 2.9, 0.2, 1.4, 0.14, 2.6, '#1f6f8f');
    block(b, 11.6, -4.4, 4.6, 5, 1, '#e3d9bf', { fh: 3 }); zincRoof(b, 11.6, 3, -4.4, 5, 5.4, 2);
    for (const [x, z, c] of ([[6.4, 0.8, '#c9423a'], [9, 0.8, '#e8e4d8'], [11.6, 0.8, '#3a4a66']] as [number, number, Colour][])) car(b, x, z, { color: c });
    for (const x of [-7.6, -5.6, 2.6]) b.box(x, 0.4, 9.4, 1.8, 0.8, 0.7, '#3f8a57');
    for (const [x, z] of ([[13, 8.6], [-13.4, 10.6]] as [number, number][])) leafTree(b, x, z, { s: 0.95, tone: 1 });
    royalPalm(b, -8.8, -5.4, 6); royalPalm(b, 2.8, -5.4, 6);
    signBoard(b, 8.4, 7.6, 'NOTICES', { y: 2, size: 0.3, board: '#1f6f8f' });
    lampPost(b, 1.4, 3.6, { light: true }); lampPost(b, -9.4, 7);
    extra(b, 'ph-senate-student-1', -6.6, 3.4, 1.2, 'walk', { look: person('woman', 'office', 'teal') });
    extra(b, 'ph-senate-student-2', 3.2, -2.6, -0.6, 'stand', { look: person('man', 'casual', 'blue', { accessories: ['backpack'] }) });
    extra(b, 'ph-senate-mentor', -9.4, -0.8, HALF, 'wave', { look: person('man', 'office', 'cream', { accessories: ['glasses'] }) });
    return {
      spots: [
        landmark('lab', /lab|project|workshop|room|class/, -9, 1.6, -HALF),
        landmark('work', /work|staff|office|job|shift|desk/, 0.2, -4.4, PI, { act: { pose: 'work' } }),
        landmark('senate', /senate|court|round/, -3, 3.2, PI),
        landmark('people', /people|crowd|meet/, 2.6, 6.8, 0),
      ],
      crowd: [[2.4, 8.8, 0.4], [-2.4, 7.6, -0.5], [5.6, 4.6, 2.4], [-6, 6.6, 1.2], [9.6, 10, -0.8], [-8.6, 10.6, 0.8], [3, 10.8, 2.8], [-4.6, 10.8, 2.4], [-7.4, -3, 1.6], [11, 5.6, -0.4], [0.6, 1, 3.1], [5.4, -4.4, 0.6]],
      spare: FRONT_SPARE.map(([x, z]) => [x, z] as [number, number]),
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Teachers' college: low classroom blocks with verandahs round a sandy assembly ground, and a lesson under a tree.

/** A single-storey classroom block facing +z: doors and louvre windows behind a verandah, under a sheet roof. */
function classroomBlock(b: Batch, x: number, z: number, w: number, ry: number, tone: number): void {
  b.at(x, 0, z, ry, () => {
    b.box(0, 0.15, 0.6, w + 0.4, 0.3, 6.4, '#bdb6a4');
    b.box(0, 1.9, -0.6, w, 3.2, 4, '#efe3c2'); b.box(0, 0.9, -0.58, w + 0.02, 1.2, 4.02, '#8a5a44');
    const rooms = Math.round(w / 5);
    for (let i = 0; i < rooms; i++) {
      const cx = -w / 2 + (i + 0.5) * (w / rooms);
      b.box(cx - 1.5, 1.5, 1.42, 1, 2.3, 0.06, '#3f6f5c');
      for (const dx of [0.1, 1.5]) { b.box(cx + dx, 2.1, 1.42, 1.1, 1.1, 0.06, '#6d8a96'); for (let k = 0; k < 3; k++) b.box(cx + dx, 1.75 + k * 0.35, 1.46, 1.1, 0.05, 0.04, '#d8d4c8'); }
    }
    for (let i = 0; i <= rooms * 2; i++) b.box(-w / 2 + (i * w) / (rooms * 2), 1.75, 3.3, 0.16, 3, 0.16, WHITE);
    zincRoof(b, 0, 3.45, 0.5, w + 0.4, 6.6, tone, 0.26);
  });
}

const college: SceneDef = {
  mood: 'outdoor', accent: '#3f6f5c', walk: OPEN,
  build(b, context) {
    const label = plain(context.label);
    ground(b, { w: 30, d: 26, color: '#d9c59a', edge: '#a8925f' });
    for (const [x, z, w, d] of ([[10.6, 8.6, 8, 8], [-12.6, 10.4, 4, 4.4], [12.4, -5.6, 4.6, 5]] as [number, number, number, number][])) b.box(x, 0.03, z, w, 0.04, d, '#6aa056');
    classroomBlock(b, -3.2, -9.4, 20, 0, 0);
    classroomBlock(b, -11.4, 1.6, 10, HALF, 2);
    // A two-storey block at the back right
    block(b, 11, -10.2, 6.4, 4.4, 2, '#efe3c2', { fh: 3, glass: '#6d8a96', band: '#8a5a44' }); zincRoof(b, 11, 6, -10.2, 6.8, 4.8, 1, 0.28);
    b.box(11, 0.9, -8.02, 6.4, 1.2, 0.06, '#8a5a44');
    // The assembly ground: a flag on a stepped base, whitewashed stones along the path
    b.box(0, 0.15, -1.8, 2.2, 0.3, 2.2, '#d8d2c2'); flag(b, 0, -1.8, { h: 7 });
    for (let i = 0; i < 9; i++) for (const s of [-1, 1]) b.ball(s * 1.9, 0.12, 9.6 - i * 1.2, 0.2, 0.16, 0.2, WHITE, { seg: 4 });
    signBoard(b, -5.6, 8.6, label, { y: 2.3, size: fit(label, 8, 0.34), color: WHITE, board: '#3f6f5c' });
    // A practice lesson in the shade: a blackboard on an easel, benches, a student teacher
    tallTree(b, 12.6, 4.4, { h: 5.4, s: 1.15, tone: 2 });
    b.box(8.6, 1.9, 2.2, 3, 1.7, 0.1, '#2f4a3d'); for (const s of [-1, 1]) b.box(8.6 + s * 1.3, 1, 2.1, 0.1, 2, 0.1, WOOD_DARK, { rx: -0.12 });
    sign(b, 8.6, 2.2, 2.27, 'A B C', { size: 0.32, color: '#f4f1e6' }); sign(b, 8.6, 1.6, 2.27, '1 + 2', { size: 0.26, color: '#f4f1e6' });
    for (const [x, z] of ([[7.6, 5], [10, 5], [7.6, 6.8], [10, 6.8]] as [number, number][])) bench(b, x, z, { w: 2, ry: PI, color: WOOD_LIGHT });
    extra(b, 'ph-college-teacher', 6.6, 2.9, 0.5, 'wave', { look: person('woman', 'office', 'green', { hair: 'bun' }) });
    extra(b, 'ph-college-pupil-1', 7.6, 5, PI, 'sit', { seat: 0.6 }); extra(b, 'ph-college-pupil-2', 10, 6.8, PI, 'sit', { seat: 0.6 });
    // The staff table on the back verandah, a camera on a tripod by the ground
    table(b, -4.4, -7.2, { w: 2.2, d: 0.9 }); b.box(-4.4, 1.12, -7.2, 0.5, 0.06, 0.36, WHITE);
    for (let i = 0; i < 3; i++) b.cyl(-6.4 + Math.sin(i * 2.1) * 0.3, 0.7, 2.6 + Math.cos(i * 2.1) * 0.3, 0.03, 1.5, METAL_DARK, { seg: 3, rz: Math.sin(i * 2.1) * 0.2, rx: -Math.cos(i * 2.1) * 0.2 });
    b.box(-6.4, 1.55, 2.6, 0.3, 0.26, 0.44, BLACK);
    extra(b, 'ph-college-media', -7.2, 3, 2.2, 'work', { look: person('man', 'casual', 'violet') });
    for (const [x, z, s, t] of ([[-13.4, -5.6, 1.1, 0], [13.2, 10.4, 0.9, 1], [4.6, -4.6, 0.8, 2]] as [number, number, number, number][])) leafTree(b, x, z, { s, tone: t });
    lampPost(b, 3.4, 4.6, { light: true });
    return {
      spots: [
        landmark('class', /class|teach|studio|lesson|workshop|lab/, 5.6, 5.2, HALF),
        landmark('work', /work|staff|office|job|shift|desk/, -4.4, -5.6, PI, { act: { pose: 'work' } }),
        landmark('ground', /ground|assembly|flag/, 0, 1.4, PI),
        landmark('people', /people|crowd|meet/, 1.4, 7.4, 0),
      ],
      crowd: [[2.6, 9.2, 0.4], [-2.4, 7.6, -0.5], [4.4, 8.8, 2.4], [-6, 5.4, 1.2], [-3.4, 3.4, -0.8], [-8.4, 10.4, 0.8], [3, 10.8, 2.8], [-5.2, 11, 2.4], [-2.6, -3.4, 1.6], [3.4, -3.6, -0.4], [0.2, 10, 3.1], [3.6, 0.6, 0.6]],
      spare: FRONT_SPARE.map(([x, z]) => [x, z] as [number, number]),
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Industrial layout road: a warehouse, a pipe yard behind wire and an open workshop along a road with a pipe lorry.

/** A pyramid of steel pipes lying along x. */
function pipeStack(b: Batch, x: number, z: number, len: number, rows: number, r: number, tone: Colour): void {
  for (let row = 0; row < rows; row++) for (let i = 0; i < rows - row; i++) {
    const pz = z + (i - (rows - row - 1) / 2) * r * 2, py = r + row * r * 1.74;
    b.cyl(x, py, pz, r, len, tone, { seg: 7, rz: HALF }); b.cyl(x + len / 2, py, pz, r * 0.74, 0.04, '#23262b', { seg: 7, rz: HALF });
  }
  for (const s of [-1, 1]) b.box(x + s * len * 0.3, 0.06, z, 0.3, 0.12, rows * r * 2 + 0.4, WOOD_DARK);
}

const industry: SceneDef = {
  mood: 'outdoor', accent: '#e0822f', camera: view(2.5), walk: OPEN,
  build(b, context) {
    const label = plain(context.label);
    ground(b, { w: 30, d: 26, color: '#b9b2a2', edge: '#7d776a' });
    // The layout road, with open drains on both sides
    b.box(0, 0.03, 3.6, 30, 0.04, 5.4, ASPHALT);
    for (let i = 0; i < 10; i++) b.box(-13.4 + i * 3, 0.06, 3.6, 1.5, 0.02, 0.14, '#e6dfc8');
    for (const z of [0.6, 6.6]) { b.box(0, 0.05, z, 30, 0.06, 0.7, '#6d6a62'); for (let i = 0; i < 5; i++) b.box(-12 + i * 6, 0.1, z, 2.2, 0.08, 0.9, KERB); }
    // The warehouse: tall sheet walls under a low roof, one roller door open
    b.box(-9, 2.8, -7.4, 10, 5.6, 9, '#d6d2c6'); b.box(-9, 0.6, -7.38, 10.04, 1.2, 9.04, '#2f6f8f'); zincRoof(b, -9, 5.6, -7.4, 10.2, 9.4, 0, 0.2);
    b.box(-11.4, 2, -2.87, 3.2, 4, 0.08, '#22262b'); b.box(-6.8, 2, -2.87, 3.2, 4, 0.08, '#8f989e');
    for (let i = 0; i < 8; i++) b.box(-6.8, 0.3 + i * 0.5, -2.82, 3.2, 0.05, 0.04, '#727a80');
    crate(b, -11.9, 0, -2.2, { s: 1 }); crate(b, -10.8, 0, -2.3, { s: 0.9, color: '#9a8a62' });
    // A water tower and a tank behind
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.6 + sx * 0.9, 3.4, -11.4 + sz * 0.9, 0.16, 6.8, 0.16, METAL);
    b.cyl(0.6, 7.8, -11.4, 1.6, 2, '#c9cdd0', { seg: 10 }); b.cyl(0.6, 9, -11.4, 1.6, 0.5, '#aab0b3', { seg: 10, top: 0.2 });
    // The pipe yard behind a wire fence, its gate open
    pipeStack(b, 0.2, -4.4, 7, 4, 0.36, '#8a8f95'); pipeStack(b, 0.6, -7.8, 6, 3, 0.46, '#7c6a5c');
    for (let i = 0; i < 5; i++) b.cyl(-2.4 + i * 0.5, 0.2, -1.6, 0.16, 5.6, '#9aa0a6', { seg: 5, rz: HALF });
    for (let x = -3.4; x <= 6; x += 2.35) { if (Math.abs(x - 1.3) < 1.3) continue; b.box(x, 1, -0.2, 0.1, 2, 0.1, METAL_DARK); }
    b.box(-2.3, 1, -0.2, 2.3, 1.9, 0.03, '#aab4b8', GLASS); b.box(4.8, 1, -0.2, 2.4, 1.9, 0.03, '#aab4b8', GLASS);
    // A forklift in the yard
    b.at(3.6, 0, -2, -0.5, () => {
      b.box(0, 0.8, 0, 1.2, 1, 1.9, '#e0a43a'); b.box(0, 1.9, -0.2, 1.1, 0.08, 1.3, METAL_DARK); for (const s of [-1, 1]) for (const z of [-0.7, 0.4]) b.box(s * 0.5, 1.4, z, 0.07, 1, 0.07, METAL_DARK);
      for (const s of [-1, 1]) { b.box(s * 0.35, 1.3, 1.05, 0.1, 2.4, 0.1, METAL_DARK); b.box(s * 0.35, 0.3, 1.6, 0.12, 0.06, 1.1, METAL); }
      for (const s of [-1, 1]) for (const z of [-0.6, 0.6]) b.cyl(s * 0.62, 0.3, z, 0.3, 0.2, BLACK, { seg: 6, rz: HALF });
    });
    // The workshop: an open-fronted shed, a welder at a bench, drums and gas bottles
    openShed(b, 10.6, -5.4, 6.4, 6.4, 3.4, 1, OLD_ZINC, METAL_DARK);
    b.box(10.6, 2, -8.5, 6.4, 4, 0.14, '#9aa39a'); b.box(13.76, 2, -5.4, 0.14, 4, 6.2, '#a9b1a8');
    table(b, 10.2, -5.6, { w: 2.6, d: 1.1, color: METAL, leg: METAL_DARK }); b.box(10.2, 1.2, -5.6, 1.2, 0.2, 0.3, '#5d646b');
    b.ball(9.9, 1.36, -5.5, 0.12, 0.12, 0.12, '#bfe3ff', { seg: 5, ...GLOW });
    extra(b, 'ph-industry-welder', 10.2, -4.5, PI, 'work', { look: person('man', 'sitework', 'navy') });
    for (const [x, z, c] of ([[12.8, -3, '#2a6fb0'], [13.2, -2.2, '#c9423a'], [12.2, -2.2, '#2a6fb0']] as [number, number, Colour][])) b.cyl(x, 0.55, z, 0.36, 1.1, c, { seg: 8 });
    for (const x of [8, 8.5]) { b.cyl(x, 0.75, -7.8, 0.16, 1.5, '#8a3a2e', { seg: 6 }); b.cyl(x, 1.6, -7.8, 0.06, 0.2, METAL, { seg: 5 }); }
    sign(b, 10.6, 4.2, -2.2, 'WORKSHOP', { size: 0.4, color: WHITE, board: '#e0822f', pad: 0.2 });
    // A lorry of pipes on the road, a tricycle, a route board and lamps on the near verge
    lorry(b, -7.4, 4.6, HALF, '#2f6f8f', (l) => { for (let i = 0; i < 3; i++) l.cyl(-0.6 + i * 0.6, 1.6, -1, 0.28, 5.2, '#8a8f95', { seg: 6, rx: HALF }); for (let i = 0; i < 2; i++) l.cyl(-0.3 + i * 0.6, 2.1, -1, 0.28, 5.2, '#9aa0a6', { seg: 6, rx: HALF }); });
    keke(b, 8.4, 2.6, -HALF);
    signBoard(b, -4.6, 9.2, label, { y: 2.2, size: fit(label, 8, 0.34), color: WHITE, board: '#3d444b' });
    lampPost(b, 4.4, 7.4, { light: true }); lampPost(b, -11, 7.4); lampPost(b, 7.6, -0.4);
    extra(b, 'ph-industry-planner', 1.4, 8.2, -0.6, 'stand', { look: person('woman', 'sitework', 'orange') });
    leafTree(b, 13, 10.2, { s: 0.9, tone: 2 }); leafTree(b, -13.4, 10.6, { s: 0.85, tone: 0 }); bush(b, 9.4, 10.6, { s: 0.8 });
    return {
      spots: [
        landmark('route', /route|industry|walk|road|layout/, 2.4, 8.6, PI),
        landmark('work', /work|staff|shop|job|shift|bench/, 8.6, -2.4, PI, { act: { pose: 'work' } }),
        landmark('yard', /yard|pipe|gate/, 1.3, 0.2, PI),
        landmark('people', /people|crowd|meet/, -1.6, 9.6, 0),
      ],
      crowd: [[4.4, 9.6, 0.4], [-2.6, 8, -0.5], [7.6, 8.6, 2.4], [-7, 8.4, 1.2], [9.6, 10.4, -0.8], [-9.4, 10.2, 0.8], [0.6, 11, 2.8], [-6, 10.8, 2.4], [-12, 8.6, 1.6], [11.6, 8.2, -0.4], [5.6, 1.4, 3.1], [-1.4, 1.6, 0.6]],
      spare: FRONT_SPARE.map(([x, z]) => [x, z + 0.6] as [number, number]),
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Stadiums.

function pitch(b: Batch, cx: number, cz: number, w: number, d: number, stripes = 8): void {
  for (let i = 0; i < stripes; i++) b.box(cx - w / 2 + (i + 0.5) * (w / stripes), 0.05, cz, w / stripes, 0.04, d, i % 2 ? '#58a24c' : '#4e9944');
  const line = '#f4f1e6', y = 0.08;
  for (const s of [-1, 1]) { b.box(cx, y, cz + s * (d / 2 - 0.2), w - 0.3, 0.02, 0.1, line); b.box(cx + s * (w / 2 - 0.2), y, cz, 0.1, 0.02, d - 0.3, line); }
  b.box(cx, y, cz, 0.1, 0.02, d - 0.3, line); b.disc(cx, y, cz, 1.5, line, { seg: 16 }); b.disc(cx, y + 0.01, cz, 1.38, '#54a048', { seg: 16 });
  for (const s of [-1, 1]) { b.box(cx + s * (w / 2 - 1.7), y, cz, 0.1, 0.02, 4.6, line); for (const t of [-1, 1]) b.box(cx + s * (w / 2 - 0.95), y, cz + t * 2.3, 1.6, 0.02, 0.1, line); }
}
/** A goal standing on a goal line that runs along z; its net falls away towards -x in its own space. */
function goal(b: Batch, x: number, z: number, ry: number): void {
  b.at(x, 0, z, ry, () => { for (const s of [-1, 1]) b.box(0, 1.2, s * 1.8, 0.12, 2.4, 0.12, WHITE); b.box(0, 2.4, 0, 0.12, 0.12, 3.72, WHITE); b.box(-0.5, 1.2, 0, 0.04, 2.4, 3.6, '#d9d6cc', GLASS); });
}
function floodlight(b: Batch, x: number, z: number, h = 10): void {
  b.cyl(x, h / 2, z, 0.18, h, METAL, { seg: 5, top: 0.6 }); b.box(x, h + 0.3, z, 1.8, 1, 0.3, METAL_DARK);
  for (let i = 0; i < 4; i++) b.quad(x - 0.65 + i * 0.43, h + 0.3, z + 0.17, 0.36, 0.36, '#fff3c4', GLOW);
}
/** Rows of terracing that step up and back (towards -z in their own space) from x, z, with seat strips and, where `fill` is given, spectators. */
function terrace(b: Batch, x: number, z: number, w: number, rows: number, ry: number, seats: readonly Colour[], rand?: Rand, fill = 0.4, tread = 0.95, rise = 0.7): void {
  const shirts: Colour[] = ['#c9423a', '#2f8f55', '#e0a43a', '#2a4fa6', '#f1efe8', '#dd6fa0', '#4a3224'];
  b.at(x, 0, z, ry, () => {
    for (let i = 0; i < rows; i++) {
      const top = (i + 1) * rise;
      b.box(0, top / 2, -i * tread, w, top, tread, '#c9c4b6'); b.box(0, top + 0.05, -i * tread, w - 0.4, 0.12, tread * 0.7, seats[i % seats.length]!);
      if (rand) for (let k = 0; k < Math.floor(w / 0.9); k++) if (rand() < fill) b.ball(-w / 2 + 0.45 + k * 0.9, top + 0.42, -i * tread, 0.2, 0.3, 0.2, shirts[Math.floor(rand() * shirts.length)]!, { seg: 4 });
    }
  });
}
const kit = (colour: string): Record<string, unknown> => ({ body: 'man', outfit: 'jersey', outfitColor: colour, hair: 'lowcut' });

/** The older city stadium: one main stand under a flat roof on columns, bare terraces at the end, a straight of track. */
const mainStand: SceneDef = {
  mood: 'outdoor', accent: '#2f8f55', camera: view(3.5, [18, 27, 33.5], [21, 49, 64]),
  walk: { bounds: [-13.6, -7.4, 13.6, 12.2], entrance: [0, 11.4], open: true },
  build(b, context) {
    const rand = seeded(61);
    ground(b, { w: 30, d: 26, color: '#b7b09a', edge: '#7d776a' });
    pitch(b, 0, -3.4, 23, 7.4);
    goal(b, -11.3, -3.4, 0); goal(b, 11.3, -3.4, PI);
    // The straight of the running track along the near touchline
    b.box(0, 0.04, 2.2, 30, 0.04, 3.2, '#b5523a'); for (let i = 0; i < 5; i++) b.box(0, 0.07, 0.7 + i * 0.75, 30, 0.02, 0.06, '#f4f1e6');
    // The main stand: terracing under a flat concrete roof on columns, a glazed box in the middle, a wall behind
    terrace(b, 0, -8.2, 24, 7, 0, ['#2f8f55', '#f1efe8'], rand, 0.36);
    b.box(0, 4.3, -14.9, 25, 8.6, 0.4, '#cfc8b6'); for (const s of [-1, 1]) b.box(s * 12.2, 2.5, -11.2, 0.4, 5, 6.6, '#cfc8b6');
    b.box(0, 8.9, -11.2, 25.6, 0.3, 8.4, '#e7e2d4', { rx: -0.07 }); b.box(0, 8.3, -7, 25.6, 0.9, 0.2, '#1f6f4a');
    for (let i = 0; i < 6; i++) b.box(-11 + i * 4.4, 6.2, -11.4, 0.26, 5, 0.26, '#e7e2d4');
    b.box(0, 5.9, -13.4, 6.4, 1.7, 2, '#e8e4d8'); b.box(0, 6, -12.38, 6, 1, 0.04, '#7fb0c9', GLASS);
    labelled(b, context.label, 0, 8.3, -6.88, 15, 0.5, WHITE, '#1f6f4a', true);
    // Bare terraces at the left end, a hand-set scoreboard at the right, four pylons of lights
    terrace(b, -13, -3.4, 8, 4, HALF, ['#c9c4b6'], rand, 0.22);
    b.box(12.6, 3.6, -8.4, 3.2, 1.8, 0.3, '#22262b'); for (const s of [-1, 1]) b.box(12.6 + s * 1.2, 1.4, -8.4, 0.2, 2.8, 0.2, METAL_DARK);
    sign(b, 12.6, 3.7, -8.2, '1 0', { size: 0.7, color: '#f4f1e6' });
    for (const [x, z] of ([[-14, -15], [14, -15], [-14.4, 10.4], [14.4, 10.4]] as [number, number][])) floodlight(b, x, z, 10);
    // The apron: a low rail with gaps, the dugouts, a warm-up patch of grass, the players
    for (const [x0, x1] of ([[-13.8, -6.6], [-3.4, 3.2]] as [number, number][])) fence(b, [x0, 4.2], [x1, 4.2], { h: 1, color: '#e7e2d4', gap: 1.7 });
    for (const x of [-5, 5]) { b.box(x, 1.5, -8.05, 3, 0.1, 1.2, '#e7e2d4'); for (const s of [-1, 1]) b.box(x + s * 1.4, 0.75, -7.6, 0.08, 1.5, 0.08, METAL); }
    b.box(8.6, 0.03, 6.4, 9.6, 0.04, 4.8, '#5aa24e');
    for (let i = 0; i < 4; i++) b.cone(5 + i * 0.8, 0.2, 9.6, 0.14, 0.4, '#e0822f', { seg: 5 });
    extra(b, 'ph-stand-p1', -4, -4, 0.6, 'jog', { look: kit('green') }); extra(b, 'ph-stand-p2', 3, -2.4, -2.4, 'walk', { look: kit('red') });
    extra(b, 'ph-stand-ref', 0.4, -4.6, 0.3, 'stand', { look: kit('gold') });
    extra(b, 'ph-stand-runner', -9.6, 2.2, HALF, 'jog', { look: person('woman', 'jersey', 'orange') });
    b.ball(0.8, 0.22, -3, 0.2, 0.2, 0.2, WHITE, { seg: 6 });
    bench(b, -9.6, 7.4, { w: 3, back: true }); flag(b, -11.6, 10.8, { h: 5.4 });
    return {
      spots: [
        landmark('stand', /stand|match|watch|view|seat|fan|touchline/, 1.6, 6.4, PI),
        landmark('work', /work|staff|ticket|office|job|shift|train/, -5, 7.2, 0.4, { act: { pose: 'work' } }),
        landmark('pitch', /pitch|play|warm/, -5, -1.2, PI),
        landmark('people', /people|crowd|meet/, 0.6, 9.6, 0),
      ],
      crowd: [[-1.6, 8.4, 0.4], [-7.2, 9.6, -0.5], [3.4, 10.4, 2.4], [-11.4, 8, 1.2], [-3.4, 10.8, -0.8], [-9, 11, 0.8], [2.6, 8.2, 2.8], [12.6, 10.4, 2.4], [-12.4, 5.6, 1.6], [12.8, 2.4, -0.4], [5.6, 2.2, 3.1], [-2.4, 5.4, 0.6]],
      spare: [[-6, 9.6], [2, 10.8], [-3, 7.6], [-8, 6.4]],
    };
  },
};

/** The large modern stadium: a ring of blue stands under a white roof that sweeps up to the back, open towards the gates. */
const bowl: SceneDef = {
  mood: 'outdoor', accent: '#2a6fb0', camera: view(3.5, [18, 28, 34], [21, 50, 65]),
  walk: { bounds: [-13.6, -8.4, 13.6, 12.2], entrance: [0, 11.4], open: true },
  build(b, context) {
    const rand = seeded(67), label = plain(context.label);
    ground(b, { w: 30, d: 26, color: '#cdc8ba', edge: '#8a8678' });
    const cx = 0, cz = -3, A = 10.8, B = 7, N = 24;
    b.disc(cx, 0.04, cz, 1, '#8f9aa0', { seg: 28, sx: A - 0.2, sz: B - 0.2 });
    pitch(b, cx, cz, 14.4, 8);
    goal(b, cx - 7, cz, 0); goal(b, cx + 7, cz, PI);
    const shirts: Colour[] = ['#f1efe8', '#2a4fa6', '#e0a43a', '#c9423a', '#2f8f55'];
    for (let i = 0; i < N; i++) {
      const t = (i / N) * PI * 2, sx = Math.sin(t), cs = Math.cos(t);
      if (cs > 0.62) continue;                                   // the side towards the gates is left open
      const arc = Math.hypot(A * cs, B * sx) * ((PI * 2) / N), high = 6.2 + 3.4 * cs * cs + (cs < 0 ? 0.6 : 0);
      b.at(cx + sx * A, 0, cz + cs * B, Math.atan2(sx / A, cs / B), () => {
        for (let k = 0; k < 5; k++) {
          const w = arc * (1 + k * 0.09) + 0.34, top = (k + 1) * 0.8;
          b.box(0, top / 2, 0.45 + k * 0.9, w, top, 0.9, '#cfcabb'); b.box(0, top + 0.05, 0.45 + k * 0.9, w - 0.1, 0.12, 0.62, (i + k) % 5 === 0 ? '#f1efe8' : k % 2 ? '#2a6fb0' : '#3f86c8');
          for (let j = 0; j < 3; j++) if (rand() < 0.17) b.ball((j - 1) * (w / 3), top + 0.42, 0.45 + k * 0.9, 0.2, 0.3, 0.2, shirts[Math.floor(rand() * shirts.length)]!, { seg: 4 });
        }
        const w = arc * 1.5 + 0.4;
        b.box(0, 2.7, 5.1, w, 5.4, 0.5, '#ece8dc'); b.box(0, 3.4, 5.37, w * 0.5, 2.6, 0.06, '#7f9fb4');
        b.box(0, high + 0.5, 2.5, w + 0.2, 0.18, 6.2, '#f7f5ef', { rx: 0.17 });
        b.cyl(0, (high + 3) / 2, 5.7, 0.12, high + 3, '#f7f5ef', { seg: 5, rx: 0.1 }); b.box(0, high + 1.9, 2.9, 0.06, 0.06, 6.2, '#dcdcd6', { rx: -0.3 });
      });
    }
    // A lit board over the back stand carries the name
    b.box(0, 7.4, -13.2, 9.6, 1.5, 0.3, '#16222e'); labelled(b, label, 0, 7.4, -13, 8.8, 0.46, '#ffe9a8', '#16222e', true);
    // The gates: ticket cabins and turnstiles either side of the way in, flags, a low name wall
    for (const s of [-1, 1]) {
      b.box(s * 9.4, 1.5, 8.4, 3.4, 3, 2.4, '#ece8dc'); b.box(s * 9.4, 3.1, 8.5, 3.9, 0.2, 3, '#2a6fb0'); b.quad(s * 9.4, 1.8, 9.62, 2, 0.9, '#30363c');
      for (let i = 0; i < 3; i++) { b.box(s * (5.2 + i * 1.1), 0.55, 8.4, 0.2, 1.1, 1.2, METAL); b.box(s * (5.2 + i * 1.1) + 0.3, 0.9, 8.4, 0.5, 0.06, 0.06, METAL_DARK); }
      flag(b, s * 12.8, 10.6, { h: 6 });
    }
    sign(b, -9.4, 3.6, 9.9, 'TICKETS', { size: 0.3, color: WHITE, board: '#2a6fb0', pad: 0.16 });
    extra(b, 'ph-bowl-p1', -3, -3.6, 0.6, 'jog', { look: kit('blue') }); extra(b, 'ph-bowl-p2', 2.4, -1.6, -2.4, 'walk', { look: kit('red') });
    b.ball(0.8, 0.22, -2.6, 0.2, 0.2, 0.2, WHITE, { seg: 6 });
    extra(b, 'ph-bowl-steward', -7, 9.6, 0.5, 'stand', { look: person('man', 'sitework', 'orange') });
    for (const [x, z] of ([[13.4, 4.6], [-13.4, 4.6]] as [number, number][])) royalPalm(b, x, z, 5.4);
    lampPost(b, 3.4, 9.4, { light: true }); lampPost(b, -3.4, 9.4);
    return {
      spots: [
        landmark('stand', /stand|match|watch|view|seat|fan|event/, 2.6, 3.6, PI),
        landmark('work', /work|staff|ticket|office|job|shift|train/, -6.6, 11, 0, { act: { pose: 'work' } }),
        landmark('pitch', /pitch|play|warm/, -2.6, -0.4, PI),
        landmark('people', /people|crowd|meet/, 0.4, 8, 0),
      ],
      crowd: [[-1.6, 6.4, 0.4], [-4.6, 7.4, -0.5], [5.4, 6.2, 2.4], [-2.4, 10.4, 1.2], [1.6, 10.8, -0.8], [-10, 11.2, 0.8], [3.4, 11.4, 2.8], [10.4, 11.2, 2.4], [-5.4, 2.6, 1.6], [5.6, 2.2, -0.4], [0.4, 3.6, 3.1], [-1, 1, 0.6]],
      spare: [[-3, 8.6], [3, 8], [-1, 5.4], [1.6, 6]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// State house approach: a palm-lined road to a closed gate with a guard post. The white house stands behind the
// fence; visitors keep to the near side, where the public notice board is.

function colonialHouse(b: Batch, x: number, z: number): void {
  const w = 17, d = 5.6, front = z + d / 2;
  b.box(x, 0.2, z + 0.9, w + 1.6, 0.4, d + 3.4, '#d8d2c2');
  b.box(x, 3.5, z, w, 6.2, d, '#f4f1e8');
  // Two floors of deep verandah across the front: slabs, a balustrade, slender columns
  b.box(x, 3.5, front + 1, w + 0.4, 0.22, 2.2, '#e6e2d6'); b.box(x, 6.6, front + 1, w + 0.6, 0.26, 2.4, '#e6e2d6');
  for (let i = 0; i <= 8; i++) { const cx = x - w / 2 + (i * w) / 8; b.cyl(cx, 1.95, front + 1.9, 0.16, 3.1, WHITE, { seg: 6 }); b.cyl(cx, 5.05, front + 1.9, 0.13, 2.9, WHITE, { seg: 6 }); }
  b.box(x, 4.15, front + 2, w, 0.08, 0.1, WHITE); for (let i = 0; i < 24; i++) b.box(x - w / 2 + 0.35 + i * ((w - 0.7) / 23), 3.9, front + 2, 0.08, 0.5, 0.08, WHITE);
  for (let i = 0; i < 8; i++) { const cx = x - w / 2 + (i + 0.5) * (w / 8); b.box(cx, 1.9, front + 0.03, 1, 2.2, 0.06, i === 3 || i === 4 ? '#4a3a2c' : '#3f6f5c'); b.box(cx, 5, front + 0.03, 1, 1.9, 0.06, '#3f6f5c'); }
  // A hipped roof of sheet with a small pediment over the middle
  for (const s of [-1, 1]) b.box(x, 7.5, z + 0.8 + s * 2.1, w + 1.4, 0.16, 4.6, ZINC[s < 0 ? 1 : 0]!, { rx: -s * 0.36 });
  b.box(x, 8.3, z + 0.8, w + 1.4, 0.16, 0.34, ZINC[3]!);
  b.box(x, 7.5, front + 2.1, 4.4, 1.5, 0.3, '#f4f1e8'); for (const s of [-1, 1]) b.box(x + s * 1.15, 8.5, front + 2.1, 2.7, 0.14, 0.5, ZINC[3]!, { rz: -s * 0.42 });
}

const graGate: SceneDef = {
  mood: 'outdoor', accent: '#2f8f55', camera: view(2.5), walk: OPEN,
  build(b, context) {
    const label = plain(context.label);
    ground(b, { w: 30, d: 26, color: GRASS, edge: GRASS_EDGE });
    b.box(0, 0.03, 4, 5.4, 0.04, 18, ASPHALT); for (const s of [-1, 1]) b.box(s * 2.85, 0.1, 4.4, 0.3, 0.2, 17.2, KERB);
    for (let i = 0; i < 6; i++) b.box(0, 0.06, -3.4 + i * 3, 0.14, 0.02, 1.5, '#e6dfc8');
    b.box(0, 0.03, -6.2, 5.4, 0.04, 3, ASPHALT); b.disc(0, 0.05, -6.6, 3.6, ASPHALT, { seg: 16 }); b.disc(0, 0.07, -6.6, 2, '#6aa056', { seg: 14 });
    colonialHouse(b, 0, -11);
    flag(b, 0, -6.6, { h: 7.4 });
    // The fence: a white dwarf wall with piers and iron railings, and the closed gate in it
    for (const s of [-1, 1]) {
      b.box(s * 9.2, 0.45, -4.8, 11.6, 0.9, 0.4, '#f1eee4'); b.box(s * 9.2, 2.3, -4.8, 11.6, 0.08, 0.08, '#27322c');
      for (let i = 0; i < 5; i++) { b.box(s * (3.4 + i * 2.9), 1.3, -4.8, 0.5, 2.6, 0.5, '#f1eee4'); b.box(s * (3.4 + i * 2.9), 2.7, -4.8, 0.66, 0.16, 0.66, '#d8d2c2'); }
      for (let i = 0; i < 23; i++) b.box(s * (3.9 + i * 0.5), 1.6, -4.8, 0.05, 1.5, 0.05, '#27322c');
      b.box(s * 3.4, 3.1, -4.8, 0.34, 0.5, 0.34, WARM, GLOW);
      b.box(s * 1.55, 1.4, -4.8, 3, 0.1, 0.1, '#27322c'); b.box(s * 1.55, 0.3, -4.8, 3, 0.1, 0.1, '#27322c'); b.box(s * 1.55, 2.5, -4.8, 3, 0.1, 0.1, '#27322c');
      for (let i = 0; i < 8; i++) b.box(s * (0.2 + i * 0.4), 1.4, -4.8, 0.06, 2.3, 0.06, '#27322c');
    }
    // The guard post beside the gate
    b.box(5.4, 1.4, -2.6, 2, 2.8, 2, '#f1eee4'); b.box(5.4, 2.95, -2.6, 2.6, 0.18, 2.6, '#2f6f4f'); b.quad(5.4, 1.7, -1.58, 1.2, 0.9, '#4f6a7a'); b.quad(4.38, 1.7, -2.6, 1.2, 0.9, '#4f6a7a', { ry: -HALF });
    extra(b, 'ph-gra-guard', 3.6, -2.4, -0.4, 'stand', { look: person('man', 'office', 'navy', { accessories: ['cap'] }) });
    b.box(-1.5, 0.5, -3, 0.5, 1, 0.5, '#c9423a'); b.box(1.5, 0.5, -3, 0.5, 1, 0.5, '#c9423a');
    // Royal palms along the approach, old trees behind them
    for (const z of [11, 7.6, 3, -0.6]) royalPalm(b, -6.2, z, 6.2); for (const z of [11, 7.6, 0.2]) royalPalm(b, 6.2, z, 6.2);
    for (const [x, z, h, s, t] of ([[-13, -1.4, 6.6, 1.4, 0], [-12.6, 8.8, 6, 1.3, 1], [13.4, -1.6, 5.6, 1.05, 2], [-9.6, -9.6, 7, 1.3, 1], [10.6, -9.6, 7, 1.3, 0]] as [number, number, number, number, number][])) tallTree(b, x, z, { h, s, tone: t });
    for (let i = 0; i < 5; i++) for (const s of [-1, 1]) bush(b, s * (4 + (i % 2) * 0.4), 10 - i * 2.9, { s: 0.6, color: i % 2 ? '#c0407e' : '#d9482f' });
    // The public notice board on the visitors' side, and an information table
    b.at(-8.4, 0, 2.6, 0.25, () => {
      for (const s of [-1, 1]) b.box(s * 2.3, 1.5, 0, 0.16, 3, 0.16, WOOD_DARK);
      b.box(0, 1.75, 0, 4.6, 2.1, 0.12, '#2f4a3d'); b.box(0, 3.1, 0.2, 5.2, 0.12, 1.1, ZINC[0]!, { rx: 0.3 });
      sign(b, 0, 2.5, 0.08, label, { size: fit(label, 4.2, 0.24), color: WHITE });
      for (let i = 0; i < 4; i++) b.quad(-1.6 + i * 1.07, 1.5 + (i % 2) * 0.1, 0.08, 0.8, 1, i % 2 ? '#f4f1e6' : '#f1e6c4');
    });
    table(b, 9.4, 4.4, { w: 2.4, d: 1 }); parasol(b, 9.4, 3.6, { colors: ['#2f8f55', WHITE] });
    sign(b, 9.4, 0.6, 4.94, 'INFORMATION', { size: 0.18, color: WHITE, board: '#2f6f4f', pad: 0.12 });
    extra(b, 'ph-gra-reader', -9.8, 4.2, PI - 0.5, 'stand', { look: person('woman', 'office', 'cream') });
    lampPost(b, -3.4, 0.4, { light: true }); lampPost(b, 3.4, 6);
    bench(b, -10.6, 7.4, { w: 2.6, back: true });
    return {
      spots: [
        landmark('office', /office|public|information|notice|session|civic/, -7.4, 4.4, PI),
        landmark('work', /work|staff|desk|job|shift|help/, 10.6, 3.4, 0, { act: { pose: 'work' } }),
        landmark('gate', /gate|fence|approach/, -1.4, -1.6, PI),
        landmark('people', /people|crowd|meet/, 1, 8, 0),
      ],
      crowd: [[1.6, 6, 0.4], [-1.4, 9.6, -0.5], [6.8, 7.6, 2.4], [-5.6, 7.6, 1.2], [9.6, 9.6, -0.8], [-9.6, 10.4, 0.8], [1.2, 10.8, 2.8], [-6.4, 10.6, 2.4], [-11.4, 4.6, 1.6], [11.4, 7.6, -0.4], [-1, 3, 3.1], [8.4, 0.6, 0.6]],
      spare: [[-3, 6.4], [3, 9], [-2, 10.6], [2, 3.4]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Old railway station: a long colonial frontage with a clock gable and an iron verandah, a water tower and an engine
// at the platform end, and the old township's shop-houses down the left side of the forecourt.

const OXIDE: readonly Colour[] = ['#8f4a38', '#9a5340', '#84432f', '#74392a'];

function shopHouse(b: Batch, x: number, z: number, w: number, wall: Colour, tone: number): void {
  // Faces +x: a shop below, a railed verandah above, wooden shutters, a sheet roof
  b.at(x, 0, z, HALF, () => {
    b.box(0, 3, -0.4, w, 6, 3.6, wall);
    b.box(0, 3.1, 1.9, w + 0.2, 0.2, 1.4, '#cfc8b6'); b.box(0, 3.75, 2.5, w, 0.08, 0.08, WOOD_DARK);
    const bays = Math.round(w / 1.6);
    for (let i = 0; i <= bays; i++) { const cx = -w / 2 + (i * w) / bays; b.box(cx, 1.5, 2.5, 0.14, 3, 0.14, WOOD_DARK); b.box(cx, 4.7, 2.5, 0.12, 3, 0.12, WOOD_DARK); }
    for (let i = 0; i < bays; i++) { const cx = -w / 2 + (i + 0.5) * (w / bays); b.box(cx, 1.3, 1.42, 1, 2.3, 0.06, i % 2 ? '#3a2c22' : '#3f6f5c'); b.box(cx, 4.6, 1.42, 0.8, 1.5, 0.06, '#3f6f5c'); }
    b.box(0, 6.4, 0.5, w + 0.6, 0.12, 5.6, OLD_ZINC[tone % 4]!, { rx: 0.16 });
  });
}

const station: SceneDef = {
  mood: 'outdoor', accent: '#8f4a38', camera: view(3), walk: OPEN,
  build(b, context) {
    const label = plain(context.label);
    ground(b, { w: 30, d: 26, color: '#b8ad98', edge: '#857a66' });
    b.box(2, 0.03, 3.4, 22, 0.04, 9, '#6b6862');
    // The line behind the station: sleepers and rails, an engine and a coach standing at the platform end
    b.box(0, 0.06, -12.2, 30, 0.1, 1.9, '#77705f'); for (const s of [-1, 1]) b.box(0, 0.2, -12.2 + s * 0.6, 30, 0.12, 0.1, '#4a4d52');
    for (let i = 0; i < 9; i++) b.box(-14.4 + i * 1.1, 0.12, -12.2, 0.3, 0.1, 1.7, WOOD_DARK);
    b.at(-11.4, 0, -12.2, 0, () => {
      b.box(0, 1.6, 0, 6, 2.2, 2, '#2f5f8f'); b.box(1.9, 3, 0, 2.2, 0.8, 2, '#2f5f8f'); b.box(0, 1.1, 0, 6.04, 0.3, 2.04, '#e6c84a'); b.quad(1.9, 3.05, 1.02, 1.8, 0.5, '#8fb8cc');
      b.box(0, 0.42, 0, 5.6, 0.36, 1.6, '#22262b'); b.box(-2.6, 2.9, 0, 0.5, 0.4, 0.5, '#22262b');
    });
    b.box(-5, 1.9, -12.2, 5.6, 2.6, 2, '#8a3a2e'); b.box(-5, 3.3, -12.2, 5.7, 0.2, 2.1, '#c9c4b6'); for (let i = 0; i < 5; i++) b.quad(-7.2 + i * 1.1, 2.3, -11.18, 0.7, 0.7, '#d8d4c8');
    // The water tower
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(-12.4 + sx * 1, 3.2, -8 + sz * 1, 0.2, 6.4, 0.2, '#3f4a44');
    for (const y of [2, 4.4]) b.box(-12.4, y, -8, 2.2, 0.1, 2.2, '#3f4a44');
    b.cyl(-12.4, 7.4, -8, 1.7, 2.1, OXIDE[0]!, { seg: 10 }); b.cyl(-12.4, 8.7, -8, 1.8, 0.6, OXIDE[3]!, { seg: 10, top: 0.1 });
    // The station: a long cream range, a taller gabled middle with a clock, arched openings, an oxide-red roof
    const cx = 3.4, w = 20;
    b.box(cx, 0.15, -6.6, w + 1, 0.3, 8, '#bdb6a4');
    b.box(cx, 2.3, -8.6, w, 4, 4.4, '#ead9a6'); b.box(cx, 0.85, -8.58, w + 0.04, 1.1, 4.44, '#a8704a');
    zincRoof(b, cx, 4.3, -8.6, w + 0.4, 5, 0, 0.42, 0, OXIDE);
    b.box(cx, 3.6, -7.4, 6.4, 6.6, 3.4, '#ead9a6'); zincRoof(b, cx, 6.9, -7.4, 3.6, 6.8, 1, 0.5, HALF, OXIDE);
    b.box(cx, 7.5, -5.66, 5.2, 1.3, 0.1, '#ead9a6'); for (const s of [-1, 1]) b.box(cx + s * 1.6, 8, -5.62, 3.9, 0.3, 0.2, '#f4ecd0', { rz: -s * 0.5 });
    b.cyl(cx, 6.4, -5.66, 0.8, 0.12, '#f4f1e6', { seg: 14, rx: HALF }); b.box(cx, 6.6, -5.58, 0.07, 0.5, 0.03, BLACK); b.box(cx + 0.18, 6.4, -5.58, 0.4, 0.07, 0.03, BLACK);
    sign(b, cx, 5.1, -5.68, 'STATION', { size: 0.34, color: '#4a3224' });
    for (let i = 0; i < 8; i++) {
      const x = cx - w / 2 + 1.3 + i * ((w - 2.6) / 7), middle = Math.abs(x - cx) < 3, z = middle ? -5.66 : -6.36;
      b.box(x, 1.5, z, 1.3, 2.4, 0.08, i % 3 === 1 ? '#5a4030' : '#3a2c22'); b.cyl(x, 2.7, z, 0.65, 0.08, i % 3 === 1 ? '#5a4030' : '#3a2c22', { seg: 10, rx: HALF });
    }
    // The verandah along the front: a sheet canopy on iron posts with a fretwork valance
    for (const [x0, x1] of ([[cx - w / 2, cx - 3.4], [cx + 3.4, cx + w / 2]] as [number, number][])) {
      const mid = (x0 + x1) / 2, len = x1 - x0;
      b.box(mid, 3.5, -5.2, len, 0.12, 2.6, OXIDE[1]!, { rx: 0.14 }); b.box(mid, 3.12, -3.96, len, 0.3, 0.06, '#f4ecd0');
      for (let i = 0; i < 4; i++) { const x = x0 + 0.2 + (i * (len - 0.4)) / 3; b.cyl(x, 1.6, -4, 0.09, 3.2, '#2f4a3d', { seg: 5 }); b.box(x, 3, -4, 0.7, 0.3, 0.06, '#2f4a3d'); }
    }
    bench(b, cx - 6.6, -5.6, { w: 2.6, back: true, color: '#3f6f5c', leg: '#2f4a3d' }); bench(b, cx + 6.6, -5.6, { w: 2.6, back: true, color: '#3f6f5c', leg: '#2f4a3d' });
    extra(b, 'ph-station-sitter', cx + 6.6, -5.6, 0, 'sit', { seat: 0.6 });
    // The old township street down the left: shop-houses with verandahs
    shopHouse(b, -13, -1.6, 5.6, '#e6d3a8', 0); shopHouse(b, -13, 4.6, 5.6, '#cfd8c4', 2); shopHouse(b, -13, 10.2, 4.4, '#e3c9b6', 1);
    // The forecourt: a semaphore signal, a history board, old lamps, a taxi and a tricycle waiting
    b.box(-7.6, 3.4, -5.4, 0.16, 6.8, 0.16, '#f4f1e6'); b.box(-7, 6.3, -5.4, 1.4, 0.3, 0.08, '#c9423a', { rz: -0.4 }); b.box(-7.6, 0.4, -5.4, 0.5, 0.8, 0.5, '#22262b');
    signBoard(b, 6.4, 1.6, label, { y: 2.1, size: fit(label, 7.4, 0.32), color: '#f1e6c4', board: '#4a3224' });
    b.box(6.4, 1, 1.56, 5, 0.9, 0.06, '#f1e6c4'); for (let i = 0; i < 4; i++) b.box(6.4, 1.3 - i * 0.2, 1.6, 4.4, 0.05, 0.02, '#6a5a48');
    lampPost(b, -2.4, 0.6, { light: true, color: '#2f4a3d' }); lampPost(b, 11.6, 0.6, { color: '#2f4a3d' }); lampPost(b, -7.4, 8, { color: '#2f4a3d' });
    car(b, 11, 5.6, { ry: -HALF, color: '#e0c23a' }); keke(b, 10.6, 8.6, -HALF);
    leafTree(b, 13.4, -4.6, { s: 1.1, tone: 0 }); leafTree(b, -8.6, 11.4, { s: 0.8, tone: 2 });
    extra(b, 'ph-station-walker', -6.4, 2.4, 0.9, 'walk', { look: person('man', 'casual', 'cream') });
    extra(b, 'ph-station-reader', 4.6, 3, PI - 0.3, 'stand', { look: person('woman', 'casual', 'violet', { accessories: ['glasses'] }) });
    return {
      spots: [
        landmark('station', /station|rail|front|history|learn|story/, 1.6, -1.4, PI),
        landmark('street', /street|township|walk|old/, -8, 5.4, -HALF),
        landmark('people', /people|crowd|meet/, 1, 7.6, 0),
      ],
      crowd: [[2.4, 5.6, 0.4], [-2.4, 7.6, -0.5], [6.6, 6.4, 2.4], [-5.6, 9.6, 1.2], [5.6, 9.6, -0.8], [-8.4, 10.6, 0.8], [3, 10.8, 2.8], [-3.6, 10.6, 2.4], [-4.4, -2.6, 1.6], [8.4, -2.4, -0.4], [0.2, 9.4, 3.1], [-1.4, 2.6, 0.6]],
      spare: FRONT_SPARE.map(([x, z]) => [x, z] as [number, number]),
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Wharf road: the road runs along the port fence. Beyond the wire are transit sheds, quay cranes and the hulls
// of ships at the quay. The gate is shut: the port is looked at from the road.

function quayCrane(b: Batch, x: number, z: number, ry: number, tone: Colour): void {
  b.at(x, 0, z, ry, () => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 1.5, 2.3, sz * 1.3, 0.3, 4.6, 0.3, tone);
    b.box(0, 4.7, 0, 3.6, 0.4, 3.2, tone); b.box(0, 6.1, 0.3, 2.4, 2.4, 2.6, '#e8e4d8'); b.quad(1.21, 6.4, 0.3, 1.6, 0.8, '#4f6a7a', { ry: HALF });
    b.box(0, 8.8, 0.6, 0.3, 3.2, 0.3, tone);
    b.box(0, 9.3, -4.2, 0.4, 0.4, 9.4, tone, { rx: 0.56 }); b.box(0, 11.2, -3.7, 0.08, 0.08, 9, METAL_DARK, { rx: 0.17 });
    b.box(0, 9, -8.1, 0.06, 5.4, 0.06, METAL_DARK); b.box(0, 6.2, -8.1, 0.4, 0.4, 0.4, '#e0a43a');
  });
}
function ship(b: Batch, x: number, z: number, len: number, hull: Colour, y: number): void {
  b.at(x, y, z, 0, () => {
    b.box(0, 2.2, 0, len, 4.4, 4.4, hull); b.box(len / 2, 2.2, 0, 3.1, 4.4, 3.1, hull, { ry: PI / 4 });
    b.box(0, 0.5, 0, len + 0.06, 1, 4.46, '#8a3a2e'); b.box(0, 4.45, 0, len, 0.1, 4.2, '#7d6a58');
    // The accommodation aft, the funnel, the hatches and a derrick forward
    b.box(-len / 2 + 2.6, 6, 0, 4.2, 3, 3.8, '#f1efe8'); b.box(-len / 2 + 2.9, 8, 0, 3.2, 1.2, 3.4, '#f1efe8');
    b.quad(-len / 2 + 2.9, 8.1, 1.71, 2.8, 0.5, '#4f6a7a'); for (let i = 0; i < 4; i++) b.quad(-len / 2 + 1.2 + i * 0.95, 6.2, 1.91, 0.5, 0.5, '#4f6a7a');
    b.cyl(-len / 2 + 1.6, 9.5, 0, 0.6, 2, '#2a2d33', { seg: 8 }); b.cyl(-len / 2 + 1.6, 9.9, 0, 0.62, 0.5, '#e0a43a', { seg: 8 });
    for (let i = 0; i < 3; i++) b.box(-len / 2 + 7.4 + i * 3.4, 4.8, 0, 2.6, 0.6, 3, '#6d7a70');
    b.box(len / 2 - 2.4, 6.6, 0, 0.24, 4.4, 0.24, '#e0c23a'); b.box(len / 2 - 4.2, 7.4, 0, 4, 0.14, 0.14, '#e0c23a', { rz: -0.4 });
  });
}

const wharf: SceneDef = {
  mood: 'outdoor', accent: '#2a6fb0', camera: view(3.5, [19, 28, 35], [21, 49, 64]),
  walk: { bounds: [-14.2, 1.4, 14.2, 12.2], entrance: [0, 11.4], open: true },
  build(b, context) {
    const label = plain(context.label), rand = seeded(71);
    // The road and its two pavements; the port apron beyond the fence; the quay edge and the river
    b.box(0, -0.3, 1.4, 31, 0.5, 24.2, '#77736a'); b.box(0, -0.02, 6.8, 30, 0.1, 12.4, '#b9b4a6');
    b.box(0, 0.03, 6, 30, 0.04, 5, ASPHALT); for (let i = 0; i < 10; i++) b.box(-13.4 + i * 3, 0.06, 6, 1.5, 0.02, 0.14, '#e6dfc8');
    for (const z of [3.4, 8.6]) b.box(0, 0.1, z, 30, 0.2, 0.3, KERB);
    b.box(0, -0.02, -4.6, 30, 0.1, 10.4, '#a39d8f');
    creek(b, rand, -34, -10.2, -1.5, 6); mangroveBank(b, rand, -32, -1.5, -40, 40, 5, true);
    // Ships at the quay: a black hull alongside, a rust-red one lying off astern of it
    ship(b, -3, -12.8, 22, '#22262b', -1.6); ship(b, 16, -19, 18, '#7a3a2c', -1.6);
    // Two transit sheds end to end, with a gap between them
    for (const [x, w, t] of ([[-7.6, 11.6, 0], [7.4, 11, 2]] as [number, number, number][])) {
      b.box(x, 1.7, -3.4, w, 3.4, 4.6, '#c9c2b0'); zincRoof(b, x, 3.4, -3.4, w + 0.2, 5, t, 0.36, 0, OLD_ZINC); b.box(x, 4.5, -3.4, w * 0.7, 0.3, 0.7, OLD_ZINC[3]!);
      for (const s of [-1, 1]) b.box(x + s * w * 0.24, 1.4, -1.07, 2.4, 2.8, 0.08, '#4a6a7a');
    }
    sign(b, -7.6, 3, -1.04, '1', { size: 0.5, color: WHITE }); sign(b, 7.4, 3, -1.04, '2', { size: 0.5, color: WHITE });
    // Stacked boxes and two cranes on the quay
    for (const [x, z, c, up] of ([[-0.4, -7.2, '#c9423a', 0], [-0.4, -7.2, '#2a6fb0', 1], [0.2, -4.4, '#2f8f55', 0], [12.6, -7.6, '#e0a43a', 0], [12.6, -7.6, '#8a3a2e', 1]] as [number, number, Colour, number][])) b.box(x, 0.7 + up * 1.4, z, 1.3, 1.36, 3.2, c);
    quayCrane(b, -6.6, -8, 0.9, '#e0a43a'); quayCrane(b, 6.6, -8.2, -0.7, '#3f8a8f');
    // The fence: concrete posts, wire, a strand of barbed wire, the gate shut with a guard cabin behind it
    for (let x = -14.4; x <= 14.4; x += 2.4) { b.box(x, 1.5, 0.6, 0.22, 3, 0.22, '#cfcabb'); b.box(x, 3.1, 0.5, 0.1, 0.5, 0.1, '#cfcabb', { rx: -0.5 }); }
    b.box(0, 1.5, 0.6, 28.8, 2.6, 0.03, '#aab4b8', GLASS); b.box(0, 2.8, 0.6, 28.8, 0.05, 0.05, METAL_DARK); b.box(0, 3.2, 0.4, 28.8, 0.03, 0.03, METAL_DARK);
    b.box(-9.6, 1.5, 0.7, 4.6, 2.9, 0.1, '#2a6fb0'); for (let i = 0; i < 5; i++) b.box(-11.6 + i, 1.5, 0.76, 0.08, 2.9, 0.04, '#1f5488');
    sign(b, -9.6, 2.1, 0.78, 'NO ENTRY', { size: 0.34, color: WHITE, board: '#c9423a', pad: 0.16 });
    b.box(-12.6, 1.3, -0.9, 1.8, 2.6, 1.8, '#e8e4d8'); b.box(-12.6, 2.7, -0.9, 2.2, 0.16, 2.2, ZINC[1]!);
    // The road: a lorry with a box, a handcart, a board about the port, lamps, a bench facing the wire
    lorry(b, 7.6, 7, -HALF, '#c9423a', (l) => l.box(0, 2.6, -1.05, 2.3, 2.7, 5, '#3f6f8f'));
    barrow(b, -5.4, 2.4, 2, '#d9cdaa');
    b.at(3.6, 0, 2.2, 0, () => {
      for (const s of [-1, 1]) b.box(s * 2.2, 1.1, 0, 0.12, 2.2, 0.12, METAL_DARK);
      b.box(0, 1.6, 0, 4.6, 1.5, 0.1, '#f1e6c4'); sign(b, 0, 2.05, 0.07, label, { size: fit(label, 4.2, 0.26), color: '#27323a' });
      for (let i = 0; i < 4; i++) b.box(0, 1.6 - i * 0.2, 0.06, 3.8, 0.05, 0.02, '#6a5a48');
    });
    bench(b, -1.4, 2.2, { w: 2.6, back: false, color: '#8f8a7d', leg: '#6a665c' });
    lampPost(b, 0.6, 9.2, { light: true }); lampPost(b, -11.4, 9.2); lampPost(b, 11.6, 2.4);
    for (const x of [-13, 12.6]) leafTree(b, x, 11.4, { s: 0.85, tone: 1 });
    extra(b, 'ph-wharf-porter', -6.6, 2.6, HALF, 'walk', { look: person('man', 'chill', 'green') });
    extra(b, 'ph-wharf-reader', 5.6, 2.8, PI + 0.5, 'stand', { look: person('woman', 'casual', 'blue') });
    return {
      spots: [
        landmark('view', /view|wharf|port|road|learn|history|fence/, 1.2, 2.6, PI),
        landmark('people', /people|crowd|meet/, 1, 10.2, 0),
      ],
      crowd: [[2.6, 10, 0.4], [-2.6, 9.6, -0.5], [-3.6, 2.6, 2.6], [-8.4, 10.4, 1.2], [5.4, 10.8, -0.8], [-5.6, 11, 0.8], [8.6, 2.4, 2.8], [10.4, 10.6, 2.4], [-11, 2.6, 1.6], [-12, 10.4, -0.4], [0.2, 11.2, 3.1], [12.6, 2.6, 0.6]],
      spare: [[-4, 10], [4, 9.8], [-2, 11], [2.6, 11]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Interchange: a road platform with a shelter and bus bays, beside a flyover that carries the main road over.

const interchange: SceneDef = {
  mood: 'outdoor', accent: '#2a6fb0', camera: view(2.5), walk: OPEN,
  build(b, context) {
    const label = plain(context.label);
    ground(b, { w: 30, d: 26, color: '#a9a394', edge: '#77736a' });
    b.box(0, 0.03, -1.6, 30, 0.04, 9.4, ASPHALT); for (let i = 0; i < 10; i++) b.box(-13.4 + i * 3, 0.06, 0.6, 1.5, 0.02, 0.14, '#e6dfc8');
    flyover(b, -7.6, 5, -16, 16, 5.2);
    b.at(0, 5.06, 0, 0, () => { car(b, -7, -7.6, { ry: HALF, color: '#c9423a' }); bus(b, 5.4, -7.6, -HALF, '#f1efe8', '#2f8f55'); });
    for (const x of [-11, 4.6, 11.6]) leafTree(b, x, -11.6, { s: 1.1, tone: Math.abs(Math.round(x)) });
    // The platform: a raised kerb with a long shelter, benches and the name; buses and tricycles in the bays
    b.box(0, 0.1, 4.8, 22, 0.2, 2.6, KERB); b.box(0, 0.21, 4.8, 21.6, 0.02, 2.2, PAVING);
    for (const x of [-8.4, -2.8, 2.8, 8.4]) for (const sz of [-1, 1]) b.box(x, 1.5, 4.8 + sz * 0.9, 0.14, 3, 0.14, METAL_DARK);
    b.box(0, 3.1, 4.8, 18.4, 0.12, 3.2, ZINC[0]!, { rx: 0.08 }); b.box(0, 2.86, 6.34, 18.4, 0.5, 0.08, '#2a6fb0');
    labelled(b, label, 0, 2.86, 6.4, 9, 0.3, WHITE, '#2a6fb0', true);
    bench(b, -5.6, 4.4, { w: 3, back: true }); bench(b, 5.6, 4.4, { w: 3, back: true });
    extra(b, 'ph-interchange-wait', -5.6, 4.4, 0, 'sit', { seat: 0.6 });
    bus(b, -6.4, 1.8, HALF, '#f1efe8', '#2a6fb0'); bus(b, 3.4, 1.8, HALF, '#2a6fb0', '#f1efe8');
    keke(b, 10, 1.6, HALF); keke(b, -12, -1.8, -HALF); bus(b, 8, -2.4, -HALF, '#f1efe8', '#2a6fb0');
    extra(b, 'ph-interchange-helper', 0.6, 3, PI - 0.4, 'wave', { look: person('man', 'casual', 'blue', { accessories: ['cap'] }) });
    // The near side: sellers under umbrellas, lamps, a route board
    for (const [x, z, c] of ([[-11, 9.4, '#e9614b'], [-8.4, 10.6, '#2f8f55'], [11.4, 9.6, '#f2c14e']] as [number, number, Colour][])) { parasol(b, x, z, { colors: [c, WHITE] }); table(b, x + 0.4, z + 0.6, { w: 1.4, d: 0.8, h: 0.8 }); b.ico(x + 0.4, 1, z + 0.6, 0.4, 0.2, 0.3, '#e8a13a'); }
    extra(b, 'ph-interchange-seller', -11.4, 10, 0.6, 'sit', { seat: 0.45, look: person('woman', 'casual', 'pink', { accessories: ['headwrap'] }) });
    signBoard(b, 8.4, 7.8, 'ROUTES', { y: 2.2, size: 0.3, board: '#2a6fb0' });
    lampPost(b, -10.4, 7.2, { light: true, h: 5 }); lampPost(b, 12.6, 6.6, { h: 5 }); lampPost(b, -13, 6.6, { h: 5 });
    return {
      spots: [
        landmark('platform', /platform|road|bus|wait|transport|board/, 1.6, 6.8, PI),
        landmark('people', /people|crowd|meet/, -1.4, 9.4, 0),
      ],
      crowd: [[3.6, 8.6, 0.4], [-3.6, 8.2, -0.5], [6.4, 9.8, 2.4], [-5.6, 9.6, 1.2], [5.4, 11.2, -0.8], [-5.4, 11.4, 0.8], [2.4, 10.8, 2.8], [-2.2, 11, 2.4], [-9.6, 7.4, 1.6], [10.4, 7.4, -0.4], [0.2, 4.6, 3.1], [8.6, 4.8, 0.6]],
      spare: [[-4, 7.6], [4.4, 7.4], [-1, 10.6], [3, 9.6]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Creek viewpoint: a railed bank with a board and a telescope, a tidal creek, and on the far bank the tank farm,
// the columns and the flare stacks of a refinery behind a fringe of mangrove.

function tank(b: Batch, x: number, y: number, z: number, r: number, h: number, band: Colour): void {
  b.cyl(x, y + h / 2, z, r, h, '#e8e6de', { seg: 12 }); b.cyl(x, y + h + 0.2, z, r * 0.98, 0.4, '#c9cdca', { seg: 12, top: 0.4 });
  b.cyl(x, y + h * 0.7, z, r * 1.01, 0.4, band, { seg: 12 });
}

const creekView: SceneDef = {
  mood: 'outdoor', accent: '#f2a230', camera: view(3.5, [17.5, 26, 33.5], [21, 50, 65]),
  walk: { bounds: [-13.6, 3.2, 13.6, 12.2], entrance: [0, 11.4], open: true },
  build(b, context) {
    const label = plain(context.label), rand = seeded(73);
    // The near bank
    b.box(0, -0.6, 8, 31, 1.1, 11.4, '#6e5a3c'); b.box(0, -0.02, 8, 30, 0.1, 10.8, '#62a04f'); b.box(0, 0.03, 4.6, 30, 0.04, 3, PAVING);
    b.box(0, 0.03, 9.2, 2.6, 0.04, 6.4, PAVING);
    creek(b, rand, -9, 2.6, -1, 8);
    // The far bank, its mangrove fringe, and the plant on it
    const y = -0.4;
    b.box(0, y - 0.6, -24, 96, 1.2, 30, '#8a8f78');
    for (let x = -30; x <= 30; x += 3) mangrove(b, x + rand() * 1.6, y - 0.4, -9.6 - rand(), 1 + rand() * 0.5, Math.floor(rand() * 3));
    for (const [x, z, r, h, c] of ([[-22, -15, 2.8, 3.6, '#2a6fb0'], [-15.4, -15.4, 2.8, 3.6, '#2a6fb0'], [-18.6, -21, 3, 3.8, '#c9423a'], [-11.4, -21.4, 3, 3.8, '#c9423a'], [-8.6, -15, 2.4, 3.2, '#2a6fb0'], [22, -20, 3, 3.6, '#2a6fb0']] as [number, number, number, number, Colour][])) tank(b, x, y, z, r, h, c);
    for (let i = 0; i < 3; i++) { b.ball(15 + i * 3.4, y + 2.6, -22, 1.5, 1.5, 1.5, '#e8e6de', { seg: 8 }); for (const s of [-1, 1]) b.box(15 + i * 3.4 + s * 0.9, y + 0.7, -22, 0.14, 1.6, 0.14, METAL); }
    for (const [x, z, r, h] of ([[-2.6, -16, 0.8, 8.6], [-0.2, -17, 0.6, 6.8], [2.4, -15.6, 0.9, 10], [5, -17, 0.55, 5.8]] as [number, number, number, number][])) {
      b.cyl(x, y + h / 2, z, r, h, '#b4babd', { seg: 8 }); b.cyl(x, y + h + 0.25, z, r, 0.5, '#8a8f95', { seg: 8, top: 0.3 });
      for (let level = 1; level <= 3; level++) b.cyl(x, y + (h / 4) * level + 0.6, z, r * 1.7, 0.1, METAL_DARK, { seg: 8 });
    }
    b.box(1, y + 1.2, -13.6, 12, 0.3, 0.8, '#8a8f95'); for (let i = 0; i < 6; i++) b.box(-4.4 + i * 2.2, y + 0.6, -13.6, 0.14, 1.2, 0.6, METAL_DARK);
    b.box(8, y + 1.6, -15.4, 3, 3.2, 2.6, '#c9c4b6'); for (const x of [7.4, 8.6]) { b.cyl(x, y + 5.6, -15.4, 0.3, 5, '#c9c4b6', { seg: 6 }); b.cyl(x, y + 7.4, -15.4, 0.32, 0.7, '#c9423a', { seg: 6 }); }
    for (const [x, z, h] of ([[11.4, -18, 11], [-6, -20, 9.4]] as [number, number, number][])) {
      b.cyl(x, y + h / 2, z, 0.2, h, '#9aa0a6', { seg: 5 }); for (const s of [-1, 1]) b.box(x + s * 1.6, y + h * 0.35, z, 0.05, h * 0.74, 0.05, METAL_DARK, { rz: s * 0.3 });
      b.cone(x, y + h + 1, z, 0.55, 2, '#ff8a2c', { seg: 6, ...GLOW }); b.cone(x + 0.1, y + h + 0.7, z, 0.3, 1.3, '#ffe07a', { seg: 5, ...GLOW });
    }
    // A loading jetty on the far side with a barge
    b.box(-9, -0.6, -8.4, 1.2, 0.3, 4.4, '#8e8a7e'); b.box(-9, -0.55, -6, 6.4, 1, 1.9, '#3a4a55'); b.box(-9, 0, -6, 6, 0.1, 1.6, '#6d7a70'); b.box(-11.4, 0.6, -6, 1.2, 1.2, 1.5, '#e8e4d8');
    canoe(b, 6, -0.95, -2.4, 1.2);
    // The viewpoint: a rail along the bank, a board with the name, a telescope, benches, lamps
    for (let x = -13.6; x <= 13.6; x += 2.1) b.cyl(x, 0.6, 2.9, 0.06, 1.2, METAL_DARK, { seg: 4 });
    b.box(0, 1.15, 2.9, 27.4, 0.07, 0.09, METAL_DARK); b.box(0, 0.6, 2.9, 27.4, 0.05, 0.06, METAL_DARK);
    b.at(-4.6, 0, 4.2, 0.2, () => {
      for (const s of [-1, 1]) b.box(s * 2.3, 0.9, 0, 0.12, 1.8, 0.12, METAL_DARK);
      b.box(0, 1.4, 0, 4.8, 1.5, 0.1, '#27323a', { rx: -0.2 }); sign(b, 0, 1.75, 0.16, label, { size: fit(label, 4.4, 0.24), color: '#f2c98a' });
      for (let i = 0; i < 3; i++) b.box(0, 1.4 - i * 0.22, 0.1 - i * 0.045, 4, 0.05, 0.02, '#8a8f95');
    });
    b.box(4.4, 0.8, 3.8, 0.24, 1.6, 0.24, '#34413f'); b.box(4.4, 1.7, 3.7, 0.3, 0.3, 0.9, '#34413f', { rx: 0.2 });
    bench(b, 9, 5.4, { w: 2.6, ry: PI, back: true }); bench(b, -10.4, 5.4, { w: 2.6, ry: PI, back: true });
    extra(b, 'ph-creek-view-sitter', 9, 5.4, PI, 'sit', { seat: 0.6 });
    extra(b, 'ph-creek-view-student', -6.8, 5.2, PI + 0.3, 'stand', { look: person('woman', 'sitework', 'orange', { accessories: ['glasses'] }) });
    lampPost(b, 1.8, 6.4, { light: true }); lampPost(b, -12.6, 8.6);
    for (const [x, z, s, t] of ([[-12.6, 10.6, 1.1, 0], [12.4, 9.6, 1.15, 1]] as [number, number, number, number][])) leafTree(b, x, z, { s, tone: t });
    bush(b, 6.6, 9.6, { s: 0.9 }); bush(b, -6.4, 10.4, { s: 0.8, color: '#c0407e' });
    return {
      spots: [
        landmark('view', /view|civic|learn|corridor|creek|rail/, 1.4, 4.4, PI),
        landmark('people', /people|crowd|meet/, 1.4, 8.6, 0),
      ],
      crowd: [[3.4, 7.6, 0.4], [-2.6, 7.4, -0.5], [6.6, 6.6, 2.4], [-3.4, 4.6, 2.8], [8.6, 9.4, -0.8], [-8.4, 8.6, 0.8], [3, 10.6, 2.8], [-4.4, 10.2, 2.4], [-12, 5.6, 2.6], [11.6, 6.6, 3], [-2.2, 9.4, 3.1], [7, 4.4, 3]],
      spare: [[-4, 6.8], [4, 7], [-2, 9.4], [3.4, 9.6]],
    };
  },
};

/** The variants of this file by scene kind; src/scene/venues-rivers.ts merges them with its own. */
export const INLAND: Readonly<Record<string, Readonly<Record<string, SceneDef>>>> = {
  office: { 'ph-avenue': avenue, 'ph-senate': senate, 'ph-college': college, 'ph-industry': industry },
  viewing: { 'ph-main-stand': mainStand, 'ph-bowl': bowl },
  statehouse: { 'ph-gra-gate': graGate },
  walk: { 'ph-station': station, 'ph-wharf': wharf },
  hub: { 'ph-interchange': interchange },
  refinery: { 'ph-creek-view': creekView },
};
