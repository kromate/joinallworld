/**
 * Original procedural people for Allworld.
 *
 * Geometry is written into the game's colour-vertex batch, so an unrigged person is one opaque
 * draw call (two when it has a glowing marker). A rig uses the same drawing functions split at
 * its anatomical pivots. It owns geometry, but deliberately borrows the host kit's materials.
 * Standalone people own and dispose both their geometry and their shared opaque materials.
 *
 * @module models/people
 */
import * as THREE from 'three';
import { GLOW, createBatch, hash, kitResources, sceneMaterials } from '../../scene/build.js';

export type BodyId = 'woman' | 'man';
export type Detail = 'low' | 'medium' | 'high';
export type PoseId = 'stand' | 'walk' | 'jog' | 'sit' | 'wave' | 'dance' | 'work' | 'eat' | 'phone' | 'relax';
export type Marker = 'crown' | 'npc' | 'player';
export interface AvatarLookInput {
  body?: unknown;
  gender?: unknown;
  hair?: unknown;
  hairstyle?: unknown;
  outfit?: unknown;
  fabric?: unknown;
  skin?: unknown;
  skinTone?: unknown;
  hairColor?: unknown;
  outfitColor?: unknown;
  bottomsColor?: unknown;
  accessories?: unknown[];
  face?: unknown;
  expression?: unknown;
  /** A multiplier, or `short`, `average`, or `tall`. */
  height?: unknown;
  /** A multiplier, or `slim`, `average`, `broad`, or `soft`. */
  build?: unknown;
  seed?: unknown;
  id?: unknown;
}
export interface AvatarLook {
  body: BodyId;
  hair: string;
  outfit: string;
  fabric: string;
  skin: string;
  hairColor: string;
  outfitColor: string;
  bottomsColor: string;
  accessories: string[];
  face: string;
  expression: string;
  height: number;
  build: number;
}
export interface DrawOptions {
  x?: number;
  y?: number;
  z?: number;
  ry?: number;
  pose?: PoseId | string;
  /** Normalized gait phase; values wrap into 0..1. */
  stride?: number;
  /** Host-supplied seconds for gesture motion. */
  time?: number;
  /** Seat height for a baked sitting pose. */
  seat?: number;
  seed?: unknown;
  scale?: number;
  marker?: Marker | null;
  detail?: Detail | string;
}
export interface BuildOptions {
  x?: number;
  y?: number;
  z?: number;
  ry?: number;
  rig?: boolean;
  detail?: Detail | string;
  marker?: Marker | null;
  pose?: PoseId | string;
  stride?: number;
  time?: number;
  seat?: number;
  seed?: unknown;
  scale?: number;
}
/** Shape options the scene batch understands (see scene/build.js). */
export interface ShapeOptions { seg?: number; top?: number; rx?: number; ry?: number; rz?: number; sx?: number; sz?: number; open?: boolean; layer?: string; part?: string }
/** The subset of the scene batch (`createBatch`) that avatar drawing uses. */
export interface DrawBatch {
  box: (x: number, y: number, z: number, w: number, h: number, d: number, colour: string, o?: ShapeOptions) => unknown;
  cyl: (x: number, y: number, z: number, r: number, h: number, colour: string, o?: ShapeOptions) => unknown;
  cone: (x: number, y: number, z: number, r: number, h: number, colour: string, o?: ShapeOptions) => unknown;
  ball: (x: number, y: number, z: number, rx: number, ry: number, rz: number, colour: string, o?: ShapeOptions) => unknown;
  ico: (x: number, y: number, z: number, rx: number, ry: number, rz: number, colour: string, o?: ShapeOptions) => unknown;
  quad: (x: number, y: number, z: number, w: number, h: number, colour: string, o?: ShapeOptions) => unknown;
  at: (x: number, y: number, z: number, ry: number, draw: (b: DrawBatch) => void, rx?: number, rz?: number, scale?: number) => unknown;
  /** Present on rig batches only. */
  node?: (name: string, x: number, y: number, z: number, draw: (b: DrawBatch) => void) => unknown;
}
type SceneBatch = ReturnType<typeof createBatch>;
type Swatch = Readonly<{ id: string, hex: string }>;
interface Rotation { x?: number | undefined; y?: number | undefined; z?: number | undefined }
interface OutfitStyle { sleeve: string; legs: string; shoe: string; collar?: boolean; gown?: boolean; vest?: boolean; helmet?: boolean; hood?: boolean; bulk?: number; open?: boolean; sport?: boolean; tunic?: boolean; robe?: boolean; dress?: boolean }
type Pose = Record<'armR' | 'armL' | 'elbowR' | 'elbowL' | 'legR' | 'legL' | 'kneeR' | 'kneeL' | 'torsoX' | 'torsoY' | 'bodyY' | 'bodyX', number> & Partial<Record<'armRZ' | 'armLZ' | 'elbowRY' | 'elbowLY' | 'headY' | 'headZ', number>>;
/** A rigged avatar's controllable joints. */
export interface AvatarRig { body: THREE.Group; torso: THREE.Group; head: THREE.Group; armL: THREE.Group; armR: THREE.Group; legL: THREE.Group; legR: THREE.Group; elbowL: THREE.Group; elbowR: THREE.Group; kneeL: THREE.Group; kneeR: THREE.Group }
export interface AvatarUserData {
  look: AvatarLook; top: number; triangles: number; drawCalls: number; dispose: () => void;
  parts?: Record<string, THREE.Group | undefined>; rig?: AvatarRig; seat?: number;
}
export interface SceneKit { THREE: typeof THREE; onDispose: (callback: () => void) => void }

const swatches = (values: [string, string][]): Swatch[] => values.map(([id, hex]) => Object.freeze({ id, hex }));

/** Public option ids accepted by normalizeLook and the preview UI. */
export const LOOK_OPTIONS = Object.freeze({
  body: Object.freeze(['woman', 'man'] as BodyId[]),
  hair: Object.freeze({
    woman: Object.freeze(['braids', 'afro', 'bun', 'ponytail', 'long', 'locs', 'lowcut', 'gele', 'classic', 'cornrows', 'twists', 'bantuknots']),
    man: Object.freeze(['lowcut', 'bald', 'curls', 'afro', 'locs', 'braids', 'classic', 'fade', 'cornrows', 'twists']),
  }),
  outfit: Object.freeze({
    woman: Object.freeze(['casual', 'office', 'owambe', 'sitework', 'jersey', 'kaftan', 'gown']),
    man: Object.freeze(['casual', 'hoodie', 'office', 'chill', 'sitework', 'jersey', 'kaftan', 'agbada']),
  }),
  fabric: Object.freeze(['plain', 'ankara', 'adire', 'asooke']),
  accessories: Object.freeze(['glasses', 'sunglasses', 'cap', 'headwrap', 'fila', 'earrings', 'chain', 'watch', 'beads', 'backpack', 'handbag']),
  face: Object.freeze(['oval', 'round', 'long']),
  expression: Object.freeze(['smile', 'neutral', 'grin']),
  skin: Object.freeze(swatches([['sand', '#c68a5e'], ['honey', '#b0764d'], ['bronze', '#9a6341'], ['chestnut', '#845236'], ['cocoa', '#6e422c'], ['umber', '#573323'], ['ebony', '#40261b']])),
  hairColor: Object.freeze(swatches([['black', '#15110f'], ['softblack', '#2a211d'], ['darkbrown', '#3d2a1e'], ['brown', '#5b3a24'], ['auburn', '#8a3b22'], ['blonde', '#d9b45f'], ['purple', '#7b4bb0']])),
  outfitColor: Object.freeze(swatches([['blue', '#3b6fd4'], ['green', '#3f9a5f'], ['red', '#c8443a'], ['orange', '#e58a2f'], ['violet', '#7c55c7'], ['pink', '#e07aa6'], ['teal', '#2c9c9a'], ['navy', '#243a6b'], ['cream', '#f1e6cf'], ['gold', '#d4a72c']])),
});

/** Detail ids in increasing cost order. */
export const DETAILS = Object.freeze(['low', 'medium', 'high'] as const);
/** Every deterministic pose accepted by poseAvatar and the preview. */
export const POSES = Object.freeze(['stand', 'walk', 'jog', 'sit', 'wave', 'dance', 'work', 'eat', 'phone', 'relax'] as const);
/** Legacy part names. Rigs also expose private elbow and knee nodes through userData.rig. */
export const PARTS = Object.freeze(['body', 'torso', 'head', 'armL', 'armR', 'legL', 'legR'] as const);

const ACCESSORY_SLOTS: Readonly<Record<string, string>> = Object.freeze({ glasses: 'eyes', sunglasses: 'eyes', cap: 'head', headwrap: 'head', fila: 'head', earrings: 'ears', chain: 'neck', watch: 'wrist', beads: 'hand', backpack: 'carry', handbag: 'carry' });
const GAME_SKIN: Readonly<Record<string, string>> = Object.freeze({ skin1: '#e0ac7e', skin2: '#c98e62', skin3: '#b0764c', skin4: '#96603c', skin5: '#7a4a2c', skin6: '#5e3620', skin7: '#3f2416' });
const HEIGHTS: Readonly<Record<string, number>> = Object.freeze({ short: 0.9, average: 1, tall: 1.1 });
const BUILDS: Readonly<Record<string, number>> = Object.freeze({ slim: 0.84, average: 1, broad: 1.17, soft: 1.1 });
const SEEDED_ACCESSORIES: readonly string[][] = Object.freeze([[], [], [], ['glasses'], ['cap'], [], ['backpack'], ['watch'], [], ['sunglasses'], ['handbag'], []]);
const ALIASES: Readonly<Record<string, string>> = Object.freeze({ female: 'woman', f: 'woman', girl: 'woman', male: 'man', m: 'man', boy: 'man', asoke: 'asooke', lowcut: 'lowcut', bantuknot: 'bantuknots', bantuknots: 'bantuknots', site: 'sitework', workwear: 'sitework', smart: 'office' });
const key = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function option(value: unknown, list: readonly string[], fallback: number): string {
  const wanted = ALIASES[key(value)] || key(value);
  return list.includes(wanted) ? wanted : list[fallback % list.length]!;
}
function colour(value: unknown, palette: readonly Swatch[], fallback: number): string {
  if (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value.trim())) return value.trim().toLowerCase();
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < palette.length) return palette[value]!.hex;
  const wanted = key(value);
  const found = palette.find((entry) => entry.id === wanted);
  return found?.hex || GAME_SKIN[wanted] || palette[fallback % palette.length]!.hex;
}
function dimension(value: unknown, words: Readonly<Record<string, number>>, fallback: number, min: number, max: number): number {
  const named = words[key(value)];
  if (named) return named;
  return Number.isFinite(value) ? clamp(Number(value), min, max) : fallback;
}
function accessories(value: unknown): string[] {
  const used = new Set<string>();
  const result: string[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    const id = key(item);
    const slot = ACCESSORY_SLOTS[id];
    if (!slot || used.has(slot)) continue;
    used.add(slot);
    result.push(id);
  }
  return result;
}

/**
 * Normalize saved or partial appearance data. Unknown values choose a deterministic fallback from
 * `seed`; known legacy punctuation variants such as `low-cut`, `site-work`, and `aso-oke` survive.
 * A recorded look wears only its recorded accessories. A missing look may receive a seeded extra.
 */
export function normalizeLook(look?: AvatarLookInput | null, seed?: unknown): AvatarLook {
  const source: AvatarLookInput = look && typeof look === 'object' ? look : {};
  const recorded = Object.keys(source).length > 0;
  const base = seed ?? source.seed ?? source.id ?? 'allworld';
  const pick = (name: string) => hash(`${base}:${name}`);
  const body = option(source.body ?? source.gender, LOOK_OPTIONS.body, pick('body')) as BodyId;
  const outfitList = LOOK_OPTIONS.outfit[body];
  const outfitColor = colour(source.outfitColor, LOOK_OPTIONS.outfitColor, pick('outfitColor'));
  let bottomSeed = pick('bottomsColor');
  if (LOOK_OPTIONS.outfitColor[bottomSeed % LOOK_OPTIONS.outfitColor.length]!.hex === outfitColor) bottomSeed += 7;
  const everyday = outfitList.filter((id) => id !== 'sitework');
  const outfitFallback = pick('outfit') % 9 === 0 ? outfitList.indexOf('sitework') : outfitList.indexOf(everyday[pick('outfit') % everyday.length]!);
  return {
    body,
    hair: option(source.hair ?? source.hairstyle, LOOK_OPTIONS.hair[body], pick('hair')),
    outfit: option(source.outfit, outfitList, Math.max(0, outfitFallback)),
    fabric: option(source.fabric, LOOK_OPTIONS.fabric, source.fabric == null && pick('fabric') % 2 ? 0 : pick('fabric')),
    skin: colour(source.skin ?? source.skinTone, LOOK_OPTIONS.skin, pick('skin')),
    hairColor: colour(source.hairColor, LOOK_OPTIONS.hairColor, pick('hairColor') % 4),
    outfitColor,
    bottomsColor: colour(source.bottomsColor, LOOK_OPTIONS.outfitColor, bottomSeed),
    accessories: accessories(recorded ? source.accessories : SEEDED_ACCESSORIES[pick('accessories') % SEEDED_ACCESSORIES.length]),
    face: option(source.face, LOOK_OPTIONS.face, recorded ? 0 : pick('face')),
    expression: option(source.expression, LOOK_OPTIONS.expression, 0),
    height: dimension(source.height, HEIGHTS, 1, 0.88, 1.12),
    build: dimension(source.build, BUILDS, 1, 0.82, 1.2),
  };
}

const TAU = Math.PI * 2;
const HIP_Y = 1.06;
const SHOULDER_Y = 1.76;
const NECK_Y = 1.91;
const INK = '#241916';
const EYE_WHITE = '#f4efe6';
const GOLD = '#d9b048';
const CLOTH_WHITE = '#f3f0e8';
const OUTFITS: Readonly<Record<string, OutfitStyle>> & { readonly casual: OutfitStyle } = Object.freeze({
  casual: { sleeve: 'short', legs: 'trousers', shoe: 'sneaker' },
  office: { sleeve: 'long', legs: 'trousers', shoe: 'dress', collar: true },
  owambe: { sleeve: 'wide', legs: 'wrapper', shoe: 'heel', gown: true },
  sitework: { sleeve: 'short', legs: 'trousers', shoe: 'boot', vest: true, helmet: true },
  hoodie: { sleeve: 'long', legs: 'trousers', shoe: 'sneaker', hood: true, bulk: 0.035 },
  chill: { sleeve: 'short', legs: 'shorts', shoe: 'slide', open: true },
  jersey: { sleeve: 'short', legs: 'shorts', shoe: 'sneaker', sport: true },
  kaftan: { sleeve: 'long', legs: 'trousers', shoe: 'dress', tunic: true },
  agbada: { sleeve: 'wide', legs: 'trousers', shoe: 'dress', tunic: true, robe: true },
  gown: { sleeve: 'cap', legs: 'dress', shoe: 'heel', dress: true },
});
const SHOES: Readonly<Record<string, string>> & { readonly sneaker: string, readonly heel: string } = Object.freeze({ sneaker: '#313846', dress: '#211b1a', heel: '#b99132', boot: '#725636', slide: '#3a342e' });

const channels = (hex: string): [number, number, number] => { const n = Number.parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const hex = (values: number[]) => `#${values.map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: string, b: string, amount: number) => { const aa = channels(a); const bb = channels(b); return hex(aa.map((value, index) => value + (bb[index]! - value) * amount)); };
const shade = (value: string, amount: number) => hex(channels(value).map((channel) => amount >= 0 ? channel + (255 - channel) * amount : channel * (1 + amount)));
const fabricPalette = (look: AvatarLook): [string, string, string] => {
  const at = Math.max(0, LOOK_OPTIONS.outfitColor.findIndex((entry) => entry.hex === look.outfitColor));
  const next = (step: number) => LOOK_OPTIONS.outfitColor[(at + step) % LOOK_OPTIONS.outfitColor.length]!.hex;
  if (look.fabric === 'ankara') return [look.outfitColor, next(3), next(7)];
  if (look.fabric === 'adire') return [shade(look.outfitColor, -0.2), '#e4e9ef', shade(look.outfitColor, -0.48)];
  if (look.fabric === 'asooke') return [look.outfitColor, '#e2c15a', shade(look.outfitColor, -0.42)];
  return [look.outfitColor, look.outfitColor, look.outfitColor];
};

function detailOf(value: unknown): Detail { return (DETAILS as readonly unknown[]).includes(value) ? value as Detail : 'low'; }
function segments(detail: Detail) { return detail === 'high' ? 16 : detail === 'medium' ? 7 : 3; }

function gait(pose: string, stride: number | undefined): Pose {
  const phase = ((Number.isFinite(stride) ? stride! : 0.25) % 1 + 1) % 1 * TAU;
  const jog = pose === 'jog';
  const swing = Math.sin(phase);
  const reach = jog ? 0.76 : 0.48;
  return {
    armR: reach * 0.9 * swing, armL: -reach * 0.9 * swing,
    elbowR: -(jog ? 1.05 : 0.24) - 0.2 * Math.max(0, -swing), elbowL: -(jog ? 1.05 : 0.24) - 0.2 * Math.max(0, swing),
    legR: -reach * swing, legL: reach * swing,
    kneeR: (jog ? 0.25 : 0.05) + (jog ? 1.05 : 0.55) * Math.max(0, Math.cos(phase)),
    kneeL: (jog ? 0.25 : 0.05) + (jog ? 1.05 : 0.55) * Math.max(0, -Math.cos(phase)),
    torsoX: jog ? 0.14 : 0.055, torsoY: -swing * 0.07, bodyY: (jog ? 0.042 : 0.022) * Math.cos(phase * 2), bodyX: 0,
  };
}
function bakedPose(pose: string, stride: number | undefined, time = 0): Pose {
  if (pose === 'walk' || pose === 'jog') return gait(pose, stride);
  const wave = Math.sin(time * 7) * 0.25;
  const beat = Math.sin(time * 4);
  const value: Pose = { armR: 0.04, armL: -0.04, elbowR: -0.18, elbowL: -0.18, legR: 0.02, legL: -0.02, kneeR: 0, kneeL: 0, torsoX: 0, torsoY: 0, bodyY: 0, bodyX: 0 };
  if (pose === 'sit') Object.assign(value, { armR: -0.32, armL: -0.32, elbowR: -0.85, elbowL: -0.85, legR: -1.48, legL: -1.48, kneeR: 1.48, kneeL: 1.48, torsoX: -0.04 });
  else if (pose === 'wave') Object.assign(value, { armL: -0.18, elbowL: -1.15, armLZ: -2.35, elbowLY: wave });
  else if (pose === 'dance') Object.assign(value, { armR: -0.45 - beat * 0.15, armL: -0.95 + beat * 0.2, armRZ: 1.8, armLZ: -0.8, elbowR: -0.75, elbowL: -1.1, legR: -0.25, legL: 0.16, kneeR: 0.55, torsoY: beat * 0.16, bodyY: Math.abs(beat) * 0.035 });
  else if (pose === 'work') Object.assign(value, { armR: -0.82, armL: -0.82, elbowR: -0.9, elbowL: -0.9, torsoX: 0.13 });
  else if (pose === 'eat') Object.assign(value, { armR: -0.68, armL: -0.35, elbowR: -1.35, elbowL: -0.92, torsoX: 0.04 });
  else if (pose === 'phone') Object.assign(value, { armL: -0.15, armLZ: -1.95, elbowL: -1.7, headZ: -0.08 });
  else if (pose === 'relax') Object.assign(value, { armR: 0.08, armL: -0.02, elbowR: -0.32, elbowL: -0.24, legL: -0.07, kneeL: 0.12, bodyX: 0.025 });
  else if (pose === 'stand' && Number.isFinite(time)) Object.assign(value, { bodyX: Math.sin(time * 1.7) * 0.012, headY: Math.sin(time * 0.7) * 0.035 });
  return value;
}

function at(b: DrawBatch, x: number, y: number, z: number, rotation: Rotation | null, draw: (b: DrawBatch) => void): void {
  const rx = rotation?.x || 0, ry = rotation?.y || 0, rz = rotation?.z || 0;
  b.at(x, y, z, ry, () => draw(b), rx, rz);
}
function node(b: DrawBatch, name: string, x: number, y: number, z: number, rotation: Rotation | null, draw: (b: DrawBatch) => void): void {
  if (typeof b.node === 'function') b.node(name, x, y, z, draw);
  else at(b, x, y, z, rotation, draw);
}
function tube(b: DrawBatch, y: number, length: number, topRadius: number, bottomRadius: number, color: string, seg: number, extra?: ShapeOptions): void {
  b.cyl(0, y - length / 2, 0, bottomRadius, length, color, { seg, top: topRadius / bottomRadius, ...extra });
}
function sphereCluster(b: DrawBatch, points: number[][], color: string, seg: number): void {
  for (const point of points) b.ball(point[0]!, point[1]!, point[2]!, point[3]!, point[4] ?? point[3]!, point[5] ?? point[3]!, color, { seg });
}
type Vec3 = [number, number, number];
function rod(b: DrawBatch, a: Vec3, c: Vec3, radius: number, color: string, seg: number): void {
  const dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2];
  const length = Math.hypot(dx, dy, dz) || 1e-6;
  b.cyl((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2, radius, length, color, { seg, rx: Math.acos(clamp(dy / length, -1, 1)), ry: Math.atan2(dx, dz) });
}

function drawFabric(b: DrawBatch, look: AvatarLook, radius: number, y0: number, y1: number, aspect: number, detail: Detail): void {
  if (look.fabric === 'plain') return;
  const colors = fabricPalette(look);
  if (detail === 'low') {
    if (look.fabric === 'ankara') {
      b.quad(0, (y0 + y1) / 2, radius * aspect * 1.02, 0.12, 0.12, colors[1], { rz: Math.PI / 4 });
      b.quad(0, (y0 + y1) / 2, radius * aspect * 1.025, 0.055, 0.055, colors[2]);
    } else if (look.fabric === 'adire') {
      b.cyl(0, (y0 + y1) / 2, 0, radius * 1.01, 0.018, colors[1], { seg: 3, sz: aspect, open: true });
    } else {
      b.box(-0.07, (y0 + y1) / 2, radius * aspect * 1.02, 0.025, y1 - y0, 0.01, colors[1]);
      b.box(0.07, (y0 + y1) / 2, radius * aspect * 1.02, 0.025, y1 - y0, 0.01, colors[2]);
    }
    return;
  }
  const around = detail === 'high' ? 10 : detail === 'medium' ? 6 : 3;
  const rows = detail === 'high' ? 5 : detail === 'medium' ? 3 : 2;
  if (look.fabric === 'asooke') {
    for (let i = 0; i < around; i++) {
      const a = i / around * TAU;
      b.box(Math.sin(a) * radius * 1.012, (y0 + y1) / 2, Math.cos(a) * radius * aspect * 1.012, i % 3 === 0 ? 0.026 : 0.012, y1 - y0, 0.009, i % 3 === 0 ? colors[1] : colors[2], { ry: a });
    }
    return;
  }
  for (let row = 0; row < rows; row++) for (let i = 0; i < around; i++) {
    const a = (i + (row % 2) * 0.5) / around * TAU;
    const y = y0 + (row + 0.65) / rows * (y1 - y0);
    const x = Math.sin(a) * radius * 1.016, z = Math.cos(a) * radius * aspect * 1.016;
    if (look.fabric === 'ankara') {
      b.quad(x, y, z, detail === 'high' ? 0.055 : 0.075, detail === 'high' ? 0.055 : 0.075, (i + row) % 2 ? colors[1] : colors[2], { ry: a, rz: Math.PI / 4 });
      if (detail === 'high') b.quad(x, y, z + 0.004, 0.026, 0.026, colors[0], { ry: a });
    } else {
      b.quad(x, y, z, 0.045, 0.045, colors[1], { ry: a, rz: Math.PI / 4 });
    }
  }
  if (look.fabric === 'adire') for (let row = 1; row < rows; row++) b.cyl(0, y0 + row / rows * (y1 - y0), 0, radius * 1.01, 0.012, colors[1], { seg: Math.max(6, around * 2), sz: aspect, open: true });
}

function drawHead(b: DrawBatch, look: AvatarLook, detail: Detail): void {
  const seg = segments(detail);
  const featureSeg = detail === 'high' ? 14 : 6;
  const minorSeg = detail === 'high' ? 8 : 5;
  const round = look.face === 'round';
  const long = look.face === 'long';
  const skin = look.skin;
  const shadow = shade(skin, -0.18);
  const lip = mix(shade(skin, channels(skin)[0] < 115 ? 0.12 : -0.08), '#7a2f32', 0.34);
  const cheekX = round ? 0.154 : long ? 0.134 : 0.144;
  const cheekWidth = round ? 0.074 : long ? 0.064 : 0.069;
  const headY = 0.31;
  b.ball(0, headY, 0, round ? 0.285 : long ? 0.247 : 0.263, long ? 0.335 : round ? 0.29 : 0.315, 0.25, skin, { seg });
  if (detail === 'low') return;
  // A shallow jaw and mostly embedded cheek planes keep one continuous face silhouette.
  b.ball(0, 0.19, 0.012, round ? 0.248 : 0.218, long ? 0.215 : 0.19, 0.218, skin, { seg });
  b.ball(-cheekX, 0.275, 0.162, cheekWidth, 0.062, 0.045, shade(skin, 0.018), { seg: featureSeg });
  b.ball(cheekX, 0.275, 0.162, cheekWidth, 0.062, 0.045, shade(skin, 0.018), { seg: featureSeg });
  b.ball(0, 0.075, 0.155, long ? 0.068 : round ? 0.078 : 0.073, 0.052, 0.035, skin, { seg: featureSeg });
  for (const side of [-1, 1]) {
    b.ball(side * 0.253, 0.31, -0.004, 0.04, 0.071, 0.029, skin, { seg: featureSeg });
    b.ball(side * 0.095, 0.355, 0.226, 0.054, 0.03, 0.013, EYE_WHITE, { seg: featureSeg });
    b.ball(side * 0.095, 0.354, 0.239, 0.014, 0.017, 0.006, '#30231e', { seg: minorSeg });
    // Upper lid and softly lifted outer brow are laid along the face, not projected out of it.
    b.cyl(side * 0.095, 0.384, 0.229, 0.005, 0.102, mix(skin, shadow, 0.32), { seg: 5, rz: Math.PI / 2 + side * 0.04 });
    b.cyl(side * 0.095, 0.416, 0.225, 0.007, 0.105, shade(look.hairColor, 0.12), { seg: 5, rz: Math.PI / 2 + side * 0.12 });
    if (detail === 'high') {
      b.cyl(side * 0.095, 0.326, 0.229, 0.004, 0.092, mix(skin, shadow, 0.22), { seg: 5, rz: Math.PI / 2 - side * 0.03 });
      b.ball(side * 0.091, 0.359, 0.246, 0.005, 0.006, 0.003, '#f6eee1', { seg: 6 });
    }
  }
  b.cyl(0, 0.306, 0.205, 0.022, 0.09, shade(skin, 0.015), { seg: featureSeg, rx: Math.PI / 2, top: 0.62 });
  b.ball(0, 0.262, 0.244, 0.038, 0.027, 0.025, skin, { seg: featureSeg });
  for (const side of [-1, 1]) b.ball(side * 0.026, 0.244, 0.258, 0.009, 0.007, 0.005, shadow, { seg: 5 });
  const corner = look.expression === 'neutral' ? 0.139 : look.expression === 'grin' ? 0.164 : 0.153;
  rod(b, [-0.078, corner, 0.226], [0, 0.136, 0.235], 0.008, lip, 6);
  rod(b, [0, 0.136, 0.235], [0.078, corner, 0.226], 0.008, lip, 6);
  rod(b, [-0.061, 0.129, 0.225], [0.061, 0.129, 0.225], 0.006, shade(lip, 0.14), 6);
  if (look.expression === 'grin') b.quad(0, 0.145, 0.237, 0.095, 0.018, EYE_WHITE);
}

function drawHair(b: DrawBatch, look: AvatarLook, detail: Detail, covered = false): void {
  if (look.hair === 'bald') return;
  const c = look.hairColor;
  const hi = mix(c, '#6a4635', 0.28);
  const seg = detail === 'high' ? 12 : detail === 'medium' ? 7 : 4;
  const cap = (color = c, sy = 0.18) => b.ball(0, 0.52, -0.025, 0.27, sy, 0.255, color, { seg });
  if (look.hair === 'lowcut' || look.hair === 'fade') {
    b.ball(0, 0.505, -0.02, 0.268, 0.17, 0.253, look.hair === 'fade' ? mix(c, look.skin, 0.42) : c, { seg });
    b.box(0, 0.43, 0.224, 0.31, 0.035, 0.02, c);
    if (look.hair === 'fade') b.ball(0, 0.59, -0.02, 0.225, 0.115, 0.225, c, { seg });
    return;
  }
  if (look.hair === 'cornrows') {
    b.ball(0, 0.5, -0.02, 0.266, 0.17, 0.252, mix(c, look.skin, 0.52), { seg });
    const count = detail === 'high' ? 7 : detail === 'medium' ? 5 : 3;
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * 0.065;
      const z = 0.14 - Math.abs(x) * 0.5;
      rod(b, [x, 0.42, 0.23], [x * 0.75, 0.63 - Math.abs(x) * 0.18, -0.16], detail === 'high' ? 0.018 : 0.024, i % 2 ? c : hi, detail === 'low' ? 3 : 6);
    }
    return;
  }
  if (look.hair === 'classic' && detail !== 'high') {
    cap(c, 0.19);
    if (look.body === 'woman') b.ball(0, 0.27, -0.16, 0.31, 0.3, 0.18, c, { seg });
    else b.ball(0.07, 0.68, 0.06, 0.18, 0.09, 0.15, hi, { seg });
    return;
  }
  if (look.hair === 'afro' && detail === 'low') {
    b.ball(0, 0.58, -0.06, 0.39, 0.34, 0.37, c, { seg: 5 });
    b.box(0, 0.43, 0.225, 0.32, 0.035, 0.02, hi);
    return;
  }
  if (look.hair === 'afro' && detail === 'medium') {
    b.ball(0, 0.58, -0.06, 0.37, 0.32, 0.35, c, { seg: 8 });
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU;
      b.ball(Math.sin(a) * 0.26, 0.6 + Math.cos(a) * 0.08, Math.cos(a) * 0.24 - 0.055, 0.13, 0.12, 0.13, i % 2 ? c : hi, { seg: 6 });
    }
    b.box(0, 0.43, 0.225, 0.32, 0.035, 0.02, hi);
    return;
  }
  if (look.hair === 'afro' && detail === 'high') {
    // One continuous crown with small embedded curl masses and a crisp warm hairline.
    b.ball(0, 0.575, -0.06, 0.385, 0.34, 0.365, c, { seg: 14 });
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU;
      b.ball(Math.sin(a) * 0.285, 0.62 + Math.cos(a) * 0.055, Math.cos(a) * 0.255 - 0.065, 0.125, 0.115, 0.125, i % 2 ? c : hi, { seg: 8 });
    }
    b.cyl(0, 0.43, 0.216, 0.009, 0.31, hi, { seg: 5, rz: Math.PI / 2 });
    return;
  }
  if (look.hair === 'classic' && look.body === 'man' && detail === 'high') {
    // Keep the men's classic cut distinct from curls at preview detail: a short asymmetric quiff.
    cap(c, 0.19);
    b.ball(0.075, 0.68, 0.02, 0.16, 0.1, 0.14, hi, { seg });
    b.ball(-0.025, 0.72, -0.015, 0.12, 0.08, 0.11, c, { seg });
    return;
  }
  if (look.hair === 'curls' && detail === 'low') {
    cap(c, 0.18);
    for (const x of [-0.12, 0.12]) b.ico(x, 0.62, 0.02, 0.11, 0.1, 0.1, x > 0 ? hi : c);
    return;
  }
  if (look.hair === 'curls' && detail === 'medium') {
    cap(c, 0.19);
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * TAU;
      b.ico(Math.sin(a) * 0.23, 0.62 + Math.cos(a) * 0.06, Math.cos(a) * 0.2 - 0.02, 0.105, 0.1, 0.105, i % 2 ? hi : c);
    }
    return;
  }
  if (look.hair === 'curls' || look.hair === 'classic') {
    const points: number[][] = [];
    const rings = detail === 'high' ? 3 : detail === 'medium' ? 2 : 1;
    for (let ring = 0; ring < rings; ring++) {
      const count = ring === 0 ? 8 : ring === 1 ? 6 : 4;
      const radius = 0.28 - ring * 0.07;
      for (let i = 0; i < count; i++) {
        const a = i / count * TAU + ring * 0.37;
        points.push([Math.sin(a) * radius, 0.57 + ring * 0.1 + Math.cos(a) * 0.035, Math.cos(a) * radius - 0.055, 0.115]);
      }
    }
    sphereCluster(b, points, c, seg);
    if (look.hair === 'classic' && look.body === 'woman') b.ball(0, 0.28, -0.16, 0.31, 0.29, 0.18, c, { seg });
    return;
  }
  if (look.hair === 'gele') {
    cap(c, 0.13);
    b.cyl(0, 0.62, -0.03, 0.27, 0.28, look.outfitColor, { seg, top: 1.32 });
    if (detail === 'low') {
      b.box(0, 0.8, -0.04, 0.56, 0.25, 0.065, fabricPalette(look)[1], { rx: -0.12 });
      return;
    }
    const folds = detail === 'high' ? 7 : detail === 'medium' ? 5 : 3;
    for (let i = 0; i < folds; i++) b.box((i - (folds - 1) / 2) * 0.105, 0.79 + Math.abs(i - (folds - 1) / 2) * 0.018, -0.04 + i * 0.008, 0.12, 0.32 - Math.abs(i - (folds - 1) / 2) * 0.025, 0.065, i % 2 ? fabricPalette(look)[1] : look.outfitColor, { rz: (i - (folds - 1) / 2) * 0.065, rx: -0.12 });
    return;
  }
  if (look.hair === 'braids' || look.hair === 'locs' || look.hair === 'twists') {
    if (!covered) {
      b.ball(0, 0.5, -0.035, 0.263, 0.145, 0.245, c, { seg });
      if (detail === 'low') b.quad(0, 0.425, 0.216, 0.3, 0.022, hi);
      else b.cyl(0, 0.425, 0.216, 0.008, 0.3, hi, { seg: 5, rz: Math.PI / 2 });
      if (detail === 'high') {
        for (const x of [-0.12, -0.04, 0.04, 0.12]) rod(b, [x, 0.43, 0.214], [x * 0.35, 0.625 - Math.abs(x) * 0.15, -0.12], 0.006, mix(look.skin, c, 0.45), 5);
      }
    }
    const count: number = covered
      ? (detail === 'high' ? 8 : detail === 'medium' ? 5 : 2)
      : look.hair === 'twists' ? (detail === 'high' ? 9 : detail === 'medium' ? 6 : 3) : detail === 'high' ? 11 : detail === 'medium' ? 7 : 3;
    for (let i = 0; i < count; i++) {
      // Spread roots along the side/back scalp arc. No strand begins on the forehead or chin.
      const a = Math.PI * (0.62 + (count === 1 ? 0.38 : i / (count - 1) * 0.76));
      const edge = Math.abs(i - (count - 1) / 2) / Math.max(1, (count - 1) / 2);
      const length = look.hair === 'locs' ? 0.46 + (i % 3) * 0.055 : look.hair === 'twists' ? 0.28 + (i % 2) * 0.06 : 0.56 + (i % 3) * 0.055;
      const rootX = Math.sin(a) * 0.205, rootZ = Math.cos(a) * 0.185 - 0.035;
      const endX = Math.sin(a) * (0.28 + edge * 0.025), endZ = Math.cos(a) * 0.25 - 0.07;
      rod(b, [rootX, 0.58 - edge * 0.06, rootZ], [endX, 0.58 - length, endZ], look.hair === 'locs' ? 0.036 : look.hair === 'twists' ? 0.025 : 0.02, i % 3 ? c : hi, detail === 'high' ? 7 : detail === 'medium' ? 5 : 3);
      if (detail === 'high' && look.hair === 'braids' && i % 3 === 0) b.ball(endX, 0.565 - length, endZ, 0.027, 0.022, 0.027, GOLD, { seg: 6 });
    }
    return;
  }
  if (!covered) cap(c, 0.145);
  if (look.hair === 'bun') { b.ball(0, 0.77, -0.12, 0.16, 0.15, 0.16, c, { seg }); return; }
  if (look.hair === 'ponytail') {
    if (detail === 'low') b.box(0, 0.2, -0.36, 0.16, 0.68, 0.14, c, { rx: 0.18 });
    else { b.ball(0, 0.58, -0.27, 0.1, 0.1, 0.1, c, { seg }); b.ball(0, 0.18, -0.38, 0.12, 0.38, 0.11, c, { seg, rx: 0.22 }); }
    return;
  }
  if (look.hair === 'long') { b.ball(0, 0.08, -0.19, 0.31, 0.52, 0.16, c, { seg }); return; }
  if (look.hair === 'bantuknots') {
    const knots: Vec3[] = [[0, 0.75, -0.03], [-0.18, 0.65, 0.02], [0.18, 0.65, 0.02], [-0.17, 0.62, -0.17], [0.17, 0.62, -0.17]];
    if (detail === 'low') for (const p of knots.slice(0, 3)) b.cone(p[0], p[1], p[2], 0.075, 0.12, c, { seg: 3, top: 0.55 });
    else for (const p of knots) { b.cyl(p[0], p[1], p[2], 0.065, 0.1, c, { seg: detail === 'high' ? 6 : 5, top: 0.65 }); b.ball(p[0], p[1] + 0.055, p[2], 0.075, 0.065, 0.075, hi, { seg: detail === 'high' ? 7 : 6 }); }
    return;
  }
}

function drawHeadwearAndFaceAccessories(b: DrawBatch, look: AvatarLook, detail: Detail): void {
  const headwear = look.accessories.find((id) => ACCESSORY_SLOTS[id] === 'head');
  const cloth = fabricPalette(look)[1];
  if (headwear === 'cap') { b.ball(0, 0.53, -0.015, 0.285, 0.19, 0.27, cloth, { seg: segments(detail) }); b.box(0, 0.49, 0.285, 0.31, 0.035, 0.23, cloth); }
  if (headwear === 'headwrap') {
    b.ball(0, 0.56, -0.02, 0.29, 0.22, 0.28, cloth, { seg: segments(detail) });
    if (detail === 'low') b.box(0, 0.7, -0.03, 0.43, 0.16, 0.065, shade(cloth, 0.08), { rx: -0.1 });
    else for (let i = -2; i <= 2; i++) b.box(i * 0.09, 0.69 + Math.abs(i) * 0.015, -0.03, 0.11, 0.18, 0.06, i % 2 ? cloth : shade(cloth, 0.1), { rz: i * 0.08 });
  }
  if (headwear === 'fila') b.cyl(0.02, 0.62, -0.02, 0.27, 0.25, cloth, { seg: segments(detail), top: 1.08, rz: -0.12 });
  const eyes = look.accessories.find((id) => ACCESSORY_SLOTS[id] === 'eyes');
  if (eyes) {
    const c = eyes === 'sunglasses' ? '#15171c' : '#4b382d';
    if (detail !== 'high') b.box(0, 0.36, 0.282, 0.34, 0.075, 0.022, c);
    else {
      for (const side of [-1, 1]) b.cyl(side * 0.1, 0.36, 0.282, 0.076, 0.012, c, { seg: detail === 'high' ? 12 : 7, rx: Math.PI / 2, sx: 1.25 });
      b.box(0, 0.36, 0.282, 0.055, 0.014, 0.014, c);
    }
  }
  if (look.accessories.includes('earrings')) for (const side of [-1, 1]) {
    if (detail !== 'high') b.box(side * 0.285, 0.22, 0.01, 0.045, 0.055, 0.02, GOLD, { rz: Math.PI / 4 });
    else b.cyl(side * 0.285, 0.22, 0.01, 0.035, 0.012, GOLD, { seg: detail === 'high' ? 8 : 6, rx: Math.PI / 2 });
  }
}

function drawHand(b: DrawBatch, look: AvatarLook, detail: Detail, side: number): void {
  const seg = detail === 'high' ? 7 : detail === 'medium' ? 8 : 6;
  b.ball(0, -0.075, 0, 0.075, 0.105, 0.05, look.skin, { seg });
  if (detail === 'high') {
    for (let i = 0; i < 4; i++) rod(b, [-0.042 + i * 0.028, -0.12, 0.005], [-0.046 + i * 0.031, -0.22 + Math.abs(1.5 - i) * 0.013, 0.012], 0.011, look.skin, 5);
    rod(b, [side * -0.055, -0.075, 0.014], [side * -0.1, -0.145, 0.035], 0.014, look.skin, 5);
  } else b.ball(side * -0.055, -0.09, 0.025, 0.027, 0.055, 0.027, look.skin, { seg: 6, rz: side * 0.45 });
  if (look.accessories.includes('beads')) {
    if (detail !== 'high') b.quad(0, -0.015, 0.054, 0.12, 0.035, GOLD);
    else for (let i = 0; i < 5; i++) b.ball(-0.045 + i * 0.022, -0.015, 0.054, 0.013, 0.013, 0.013, i % 2 ? GOLD : '#b5372d', { seg: 6 });
  }
}

function drawArm(b: DrawBatch, look: AvatarLook, detail: Detail, side: number, pose: Pose): void {
  const style = OUTFITS[look.outfit] || OUTFITS.casual;
  const seg = segments(detail);
  const cloth = look.outfitColor;
  const wide = style.sleeve === 'wide';
  const upperColor = style.sleeve === 'short' || style.sleeve === 'cap' ? look.skin : cloth;
  const upperR = (look.body === 'man' ? 0.094 : 0.078) * look.build;
  if (wide) b.cyl(0, -0.23, 0, 0.18, 0.48, cloth, { seg, top: 1.35, sz: 0.75, open: false });
  else tube(b, 0, 0.43, upperR * 0.82, upperR, upperColor, seg);
  if (style.sleeve === 'short') b.cyl(0, -0.12, 0, upperR * 1.08, 0.22, cloth, { seg, top: 1.08 });
  if (style.sleeve === 'cap') b.cyl(0, -0.075, 0, upperR * 1.12, 0.15, cloth, { seg, top: 1.18 });
  if (detail === 'high') b.ball(0, -0.035, 0, wide ? 0.205 : upperR * 1.28, wide ? 0.14 : upperR * 1.22, wide ? 0.15 : upperR * 1.15, cloth, { seg: 12 });
  else if (detail === 'medium') b.ico(0, -0.035, 0, wide ? 0.19 : upperR * 1.18, wide ? 0.13 : upperR * 1.12, wide ? 0.14 : upperR * 1.08, cloth);
  node(b, side < 0 ? 'elbowR' : 'elbowL', 0, -0.43, 0, { x: side < 0 ? pose.elbowR : pose.elbowL, y: side < 0 ? pose.elbowRY : pose.elbowLY }, (forearm) => {
    const forearmColor = style.sleeve === 'long' || wide ? cloth : look.skin;
    tube(forearm, 0, 0.4, 0.048 * look.build, upperR * 0.76, forearmColor, seg);
    if (detail === 'high') forearm.ball(0, -0.008, 0, upperR * 0.8, upperR * 0.72, upperR * 0.76, forearmColor, { seg: 10 });
    else if (detail === 'medium') forearm.ico(0, -0.008, 0, upperR * 0.78, upperR * 0.7, upperR * 0.74, forearmColor);
    if (look.accessories.includes('watch') && side > 0) {
      if (detail !== 'high') forearm.box(0, -0.345, 0, 0.12, 0.05, 0.09, '#292d35');
      else forearm.cyl(0, -0.345, 0, 0.062, 0.045, '#292d35', { seg, open: true });
    }
    at(forearm, 0, -0.4, 0, null, (hand) => drawHand(hand, look, detail, side));
  });
}

function drawFoot(b: DrawBatch, look: AvatarLook, detail: Detail, shoe: string): void {
  const seg = segments(detail);
  b.ball(0, -0.06, 0.085, 0.115, 0.075, 0.205, SHOES[shoe] || SHOES.sneaker, { seg, rx: -0.08 });
  if (shoe === 'sneaker') b.box(0, -0.105, 0.1, 0.22, 0.035, 0.34, CLOTH_WHITE);
  if (shoe === 'heel') b.box(0, -0.125, -0.035, 0.055, 0.12, 0.055, SHOES.heel);
}

function drawLeg(b: DrawBatch, look: AvatarLook, detail: Detail, side: number, pose: Pose): void {
  const style = OUTFITS[look.outfit] || OUTFITS.casual;
  const seg = segments(detail);
  const bare = style.legs === 'shorts';
  const color = bare ? look.skin : look.bottomsColor;
  const r = 0.112 * look.build;
  tube(b, 0, 0.48, r * 0.75, r, color, seg);
  node(b, side < 0 ? 'kneeR' : 'kneeL', 0, -0.48, 0, { x: side < 0 ? pose.kneeR : pose.kneeL }, (shin) => {
    tube(shin, 0, 0.44, 0.055 * look.build, r * 0.78, bare ? look.skin : look.bottomsColor, seg);
    const kneeColor = bare ? look.skin : look.bottomsColor;
    if (detail === 'high') shin.ball(0, -0.008, 0, r * 0.82, r * 0.75, r * 0.78, kneeColor, { seg: 10 });
    else if (detail === 'medium') shin.ico(0, -0.008, 0, r * 0.8, r * 0.72, r * 0.76, kneeColor);
    at(shin, 0, -0.44, 0, null, (foot) => drawFoot(foot, look, detail, style.shoe));
  });
}

function drawTorso(b: DrawBatch, look: AvatarLook, detail: Detail): void {
  const style = OUTFITS[look.outfit] || OUTFITS.casual;
  const seg = segments(detail);
  const woman = look.body === 'woman';
  const build = look.build;
  const shoulder = (woman ? 0.265 : 0.325) * build;
  const waist = (woman ? 0.19 : 0.235) * build;
  const hip = (woman ? 0.27 : 0.245) * build;
  const depth = (woman ? 0.72 : 0.64);
  const colors = fabricPalette(look);
  const bulk = style.bulk || 0;
  const rings: [number, number][] = [[-0.05, hip + bulk], [0.22, waist + bulk], [0.5, shoulder * 0.92 + bulk], [0.65, shoulder + bulk], [0.73, 0.12 + bulk]];
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i]!, c = rings[i + 1]!;
    b.cyl(0, (a[0] + c[0]) / 2, 0, a[1], c[0] - a[0], i % 3 === 1 && look.fabric !== 'plain' ? colors[1] : colors[0], { seg, top: c[1] / a[1], sz: depth });
  }
  if (style.tunic) b.cyl(0, -0.22, 0, hip + 0.035, 0.5, colors[0], { seg, top: 0.88, sz: Math.max(depth, 0.82), open: false });
  if (style.robe) {
    b.cyl(0, 0.08, -0.015, 0.47, 1.08, colors[0], { seg, top: 0.7, sz: 0.52, open: true });
    b.box(0, 0.34, 0.245, 0.2, 0.43, 0.025, GOLD);
  }
  if (style.hood) { b.ball(0, 0.68, -0.12, 0.22, 0.18, 0.15, colors[0], { seg }); b.box(0, 0.22, shoulder * depth + 0.025, 0.28, 0.16, 0.025, shade(colors[0], -0.2)); }
  if (style.collar) {
    b.box(-0.08, 0.66, shoulder * depth + 0.018, 0.14, 0.18, 0.022, CLOTH_WHITE, { rz: -0.32 });
    b.box(0.08, 0.66, shoulder * depth + 0.018, 0.14, 0.18, 0.022, CLOTH_WHITE, { rz: 0.32 });
    if (!woman) b.box(0, 0.46, shoulder * depth + 0.027, 0.055, 0.35, 0.018, colors[2]);
  }
  if (style.vest) { b.cyl(0, 0.35, 0, shoulder + 0.02, 0.48, '#ef8a1f', { seg, top: 0.9, sz: depth + 0.05, open: true }); b.cyl(0, 0.34, 0, shoulder + 0.027, 0.055, '#f4edc9', { seg, sz: depth + 0.055, open: true }); }
  if (style.sport) { for (const side of [-1, 1]) b.box(side * shoulder, 0.36, 0, 0.035, 0.56, 0.18, CLOTH_WHITE); b.quad(0, 0.4, shoulder * depth + 0.025, 0.12, 0.15, CLOTH_WHITE); }
  drawFabric(b, look, (waist + shoulder) / 2 + bulk, 0.03, 0.62, depth, detail);
  if (look.accessories.includes('chain')) {
    if (detail !== 'high') b.quad(0, 0.66, shoulder * depth + 0.045, 0.2, 0.05, GOLD);
    else b.cyl(0, 0.66, shoulder * depth + 0.045, 0.12, 0.012, GOLD, { seg: detail === 'high' ? 16 : 7, rx: Math.PI / 2, sx: 1.25 });
  }
  if (look.accessories.includes('backpack')) { b.box(0, 0.36, -shoulder * depth - 0.11, 0.42, 0.55, 0.17, shade(colors[2], -0.15)); if (detail === 'high') for (const side of [-1, 1]) b.cyl(side * 0.18, 0.45, -shoulder * depth - 0.02, 0.025, 0.56, colors[2], { seg: 6, rz: side * 0.18 }); }
  if (look.accessories.includes('handbag')) { b.box(woman ? 0.39 : -0.39, -0.08, 0.04, 0.3, 0.34, 0.13, colors[2]); if (detail === 'high') b.cyl(woman ? 0.39 : -0.39, 0.16, 0.04, 0.12, 0.018, GOLD, { seg: 8, rx: Math.PI / 2, sx: 1.3 }); }
}

function drawHipsAndLowerGarment(b: DrawBatch, look: AvatarLook, detail: Detail): void {
  const style = OUTFITS[look.outfit] || OUTFITS.casual;
  const seg = segments(detail);
  const hip = (look.body === 'woman' ? 0.27 : 0.245) * look.build;
  if (style.legs === 'wrapper' || style.legs === 'dress') {
    const colors = fabricPalette(look);
    b.cyl(0, -0.38, 0, hip * 1.28, 0.82, colors[0], { seg, top: 0.78, sz: 0.78 });
    drawFabric(b, look, hip * 1.16, -0.72, -0.05, 0.78, detail);
  } else b.cyl(0, -0.04, 0, hip, 0.18, look.bottomsColor, { seg, top: 0.94, sz: 0.72 });
}

function drawMarker(b: DrawBatch, marker: Marker | null, top: number): void {
  if (marker === 'crown') {
    for (const x of [-0.08, 0, 0.08]) b.quad(x, top + 0.23 + (x === 0 ? 0.03 : 0), 0, 0.085, 0.16, '#ffd34d', { rz: Math.PI / 4, ...GLOW });
  } else if (marker === 'npc') b.ico(0, top + 0.18, 0, 0.11, 0.11, 0.11, '#58d68a', GLOW);
  else if (marker === 'player') b.ico(0, top + 0.18, 0, 0.1, 0.13, 0.1, '#6fb4ff', GLOW);
}

function drawFigure(b: DrawBatch, look: AvatarLook, detail: Detail, pose: Pose, marker: Marker | null): void {
  const shoulderX = (look.body === 'woman' ? 0.25 : 0.31) * look.build;
  node(b, 'body', 0, pose.bodyY || 0, 0, { x: pose.bodyX }, (body) => {
    at(body, 0, HIP_Y, 0, null, (hips) => drawHipsAndLowerGarment(hips, look, detail));
    for (const side of [-1, 1]) node(body, side < 0 ? 'legR' : 'legL', side * 0.125 * look.build, HIP_Y, 0, { x: side < 0 ? pose.legR : pose.legL }, (leg) => drawLeg(leg, look, detail, side, pose));
    node(body, 'torso', 0, HIP_Y, 0, { x: pose.torsoX, y: pose.torsoY }, (torso) => {
      drawTorso(torso, look, detail);
      for (const side of [-1, 1]) node(torso, side < 0 ? 'armR' : 'armL', side * shoulderX, SHOULDER_Y - HIP_Y, 0, { x: side < 0 ? pose.armR : pose.armL, z: side < 0 ? -(pose.armRZ || 0) : (pose.armLZ || 0) }, (arm) => drawArm(arm, look, detail, side, pose));
      node(torso, 'head', 0, NECK_Y - HIP_Y, 0, { y: pose.headY, z: pose.headZ }, (head) => {
        head.cyl(0, 0.02, 0, (look.body === 'man' ? 0.085 : 0.067) * look.build, 0.2, look.skin, { seg: segments(detail) });
        at(head, 0, 0, 0, null, (face) => {
          drawHead(face, look, detail);
          const style = OUTFITS[look.outfit] || OUTFITS.casual;
          const headwear = look.accessories.find((id) => ACCESSORY_SLOTS[id] === 'head');
          const hanging = ['braids', 'locs', 'long', 'ponytail'].includes(look.hair);
          if (!style.helmet && (!headwear || hanging)) drawHair(face, look, detail, Boolean(headwear));
          if (style.helmet) {
            face.ball(0, 0.54, -0.015, 0.29, 0.19, 0.275, '#f2c230', { seg: segments(detail) });
            face.box(0, 0.5, 0.29, 0.38, 0.045, 0.24, '#f2c230');
          } else drawHeadwearAndFaceAccessories(face, look, detail);
        });
      });
    });
    drawMarker(body, marker, 2.83);
  });
}

/**
 * Draw one avatar into a compatible scene batch. The function returns the normalized look and the
 * world-space label height. Triangle cost includes every garment, accessory, finger, and marker.
 */
export function drawAvatar(batch: DrawBatch, input?: AvatarLookInput | null, options: DrawOptions = {}): { look: AvatarLook, top: number } {
  const { x = 0, y = 0, z = 0, ry = 0, pose = 'stand', stride, time = 0, seat = 0.6, seed, scale = 1, marker = null } = options;
  const detail = detailOf(options.detail);
  const look = normalizeLook(input, seed);
  const joints = bakedPose((POSES as readonly string[]).includes(pose) ? pose : 'stand', stride, time);
  const sittingLift = pose === 'sit' ? seat + 0.11 - HIP_Y : 0;
  const bodyScale = scale * look.height;
  batch.at(x, y + sittingLift * bodyScale, z, ry, () => drawFigure(batch, look, detail, joints, marker), 0, 0, bodyScale);
  return { look, top: y + (marker ? 3.2 : 2.91) * bodyScale + sittingLift * bodyScale };
}

interface RigRecord { name: string; batch: SceneBatch; parent: string | null; pivot: { x: number, y: number, z: number } }
interface RigBatch extends DrawBatch {
  isBatch: true;
  node: NonNullable<DrawBatch['node']>;
  readonly triangles: number;
  records: Map<string, RigRecord>;
}

function createRigBatch(Three: typeof THREE): RigBatch {
  const records = new Map<string, RigRecord>();
  const root: RigRecord = { name: 'root', batch: createBatch(Three), parent: null, pivot: { x: 0, y: 0, z: 0 } };
  records.set('root', root);
  let current = root;
  const rig: RigBatch = {
    isBatch: true,
    node(name, x, y, z, draw) {
      let record = records.get(name);
      if (!record) {
        record = { name, batch: createBatch(Three), parent: current.name, pivot: { x, y, z } };
        records.set(name, record);
      }
      const previous = current;
      current = record;
      try { draw(rig); } finally { current = previous; }
      return rig;
    },
    get triangles() { let total = 0; for (const record of records.values()) total += record.batch.triangles; return total; },
    records,
    // Shape methods are forwarded to the active record's batch below (box, cyl, cone, ball, ico, quad, disc, light, world).
    box: () => undefined, cyl: () => undefined, cone: () => undefined, ball: () => undefined, ico: () => undefined, quad: () => undefined,
    at: () => undefined,
  };
  // Forwarded by name, so the batch is reached through an untyped method table.
  const forward = rig as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of ['box', 'cyl', 'cone', 'ball', 'ico', 'quad', 'disc', 'light', 'world']) forward[name] = (...args: unknown[]) => (current.batch as unknown as Record<string, (...args: unknown[]) => unknown>)[name]!(...args);
  rig.at = (x, y, z, ry, draw, rx = 0, rz = 0, scale = 1) => { current.batch.at(x, y, z, ry, () => draw(rig), rx, rz, scale); return rig; };
  return rig;
}

type Meshes = THREE.Mesh[];
type Materials = Record<string, THREE.Material>;
function removeAndDispose(objects: Meshes, group: THREE.Group, ownedMaterials: Materials | null, unregister: (() => void) | null): () => void {
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    unregister?.();
    group.parent?.remove(group);
    for (const object of objects) { object.parent?.remove(object); object.geometry?.dispose(); }
    objects.length = 0;
    if (ownedMaterials) for (const material of Object.values(ownedMaterials)) material.dispose();
    group.clear();
  };
}

function buildWithMaterials(materials: Materials, input: AvatarLookInput | null | undefined, options: BuildOptions, register: Set<() => void> | null, ownedMaterials: Materials | null): THREE.Group {
  const { x = 0, y = 0, z = 0, ry = 0, rig = false, scale = 1, pose = 'stand', stride, time = 0, ...rest } = options;
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = ry;
  group.scale.setScalar(scale);
  const objects: Meshes = [];
  const addMeshes = (target: THREE.Object3D, built: { meshes: THREE.Mesh[] }) => {
    for (const mesh of built.meshes) { mesh.castShadow = false; mesh.receiveShadow = false; objects.push(mesh); target.add(mesh); }
  };
  if (!rig) {
    const batch = createBatch(THREE);
    const drawn = drawAvatar(batch, input, { ...rest, pose, stride, time, scale: 1 });
    const built = batch.build(materials);
    addMeshes(group, built);
    let dispose: () => void = () => undefined;
    const unregister = register ? () => register.delete(dispose) : null;
    dispose = removeAndDispose(objects, group, ownedMaterials, unregister);
    register?.add(dispose);
    group.userData = { look: drawn.look, top: y + drawn.top * scale, triangles: built.triangles, drawCalls: built.meshes.length, dispose };
    return group;
  }
  const look = normalizeLook(input, rest.seed);
  const detail = detailOf(rest.detail);
  group.scale.setScalar(scale * look.height);
  const rigBatch = createRigBatch(THREE);
  drawFigure(rigBatch, look, detail, bakedPose('stand', 0, 0), rest.marker ?? null);
  const nodes = new Map<string, THREE.Group>();
  nodes.set('root', group);
  for (const [name, record] of rigBatch.records) {
    if (name === 'root') continue;
    const parent = (record.parent === null ? undefined : nodes.get(record.parent)) || group;
    const holder = new THREE.Group();
    holder.name = name;
    holder.rotation.order = 'YXZ';
    holder.position.set(record.pivot.x, record.pivot.y, record.pivot.z);
    parent.add(holder);
    nodes.set(name, holder);
  }
  let drawCalls = 0;
  for (const [name, record] of rigBatch.records) {
    const target = nodes.get(name) || group;
    const built = record.batch.build(materials);
    drawCalls += built.meshes.length;
    addMeshes(target, built);
  }
  const parts = { body: nodes.get('body'), torso: nodes.get('torso'), head: nodes.get('head'), armL: nodes.get('armL'), armR: nodes.get('armR'), legL: nodes.get('legL'), legR: nodes.get('legR') };
  const controls = { ...parts, elbowL: nodes.get('elbowL'), elbowR: nodes.get('elbowR'), kneeL: nodes.get('kneeL'), kneeR: nodes.get('kneeR') };
  let dispose: () => void = () => undefined;
  const unregister = register ? () => register.delete(dispose) : null;
  dispose = removeAndDispose(objects, group, ownedMaterials, unregister);
  register?.add(dispose);
  group.userData = { look, top: y + 2.91 * look.height * scale, triangles: rigBatch.triangles, drawCalls, dispose, parts, rig: controls, seat: Number.isFinite(rest.seat) ? rest.seat : 0.6 };
  return poseAvatar(group, { pose, stride, time });
}

/**
 * Legacy drop-in builder. Returns a THREE.Group and borrows the host kit's shared materials.
 * `group.userData.dispose()` frees only this avatar's geometry and is safe to call repeatedly.
 */
export function buildAvatar(kit: SceneKit, look?: AvatarLookInput | null, options: BuildOptions = {}): THREE.Group {
  if (!kit?.THREE || typeof kit.onDispose !== 'function') throw new TypeError('buildAvatar requires a scene kit');
  const resources = kitResources(kit);
  return buildWithMaterials(sceneMaterials(kit), look, options, resources.disposers, null);
}

function standaloneMaterials(): Materials {
  return {
    solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0, transparent: false }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: false }),
    glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0, transparent: false }),
  };
}

/**
 * Standalone builder for model previews and tools that have no scene kit. It imports Three.js,
 * creates its own opaque materials, and returns both the object and its ownership metadata.
 */
export function buildPerson(look?: AvatarLookInput | null, options: BuildOptions = {}): { object3D: THREE.Group, userData: AvatarUserData } {
  const materials = standaloneMaterials();
  const object3D = buildWithMaterials(materials, look, options, null, materials);
  return { object3D, userData: object3D.userData as AvatarUserData };
}

/**
 * Reset and pose a rigged avatar using only existing transforms. The host supplies `time`; this
 * function does not schedule frames and allocates no objects or arrays while posing.
 */
export function poseAvatar(avatar: THREE.Group, options: { pose?: PoseId | string, stride?: number, time?: number } = {}): THREE.Group {
  const rig = avatar?.userData?.rig as AvatarRig | undefined;
  if (!rig) return avatar;
  const pose = (POSES as readonly unknown[]).includes(options.pose) ? options.pose : 'stand';
  const stride = Number.isFinite(options.stride) ? options.stride! : 0.25;
  const time = Number.isFinite(options.time) ? options.time! : 0;
  const phase = ((stride % 1) + 1) % 1 * TAU;
  const swing = Math.sin(phase);
  const cosine = Math.cos(phase);
  let armR = 0.04, armL = -0.04, armRZ = 0, armLZ = 0, elbowR = -0.18, elbowL = -0.18;
  let elbowRY = 0, elbowLY = 0, legR = 0.02, legL = -0.02, kneeR = 0, kneeL = 0;
  let torsoX = 0, torsoY = 0, bodyY = 0, bodyX = 0, headY = 0, headZ = 0;
  if (pose === 'walk' || pose === 'jog') {
    const jog = pose === 'jog', reach = jog ? 0.76 : 0.48;
    armR = reach * 0.9 * swing; armL = -reach * 0.9 * swing;
    elbowR = -(jog ? 1.05 : 0.24) - 0.2 * Math.max(0, -swing); elbowL = -(jog ? 1.05 : 0.24) - 0.2 * Math.max(0, swing);
    legR = -reach * swing; legL = reach * swing;
    kneeR = (jog ? 0.25 : 0.05) + (jog ? 1.05 : 0.55) * Math.max(0, cosine);
    kneeL = (jog ? 0.25 : 0.05) + (jog ? 1.05 : 0.55) * Math.max(0, -cosine);
    torsoX = jog ? 0.14 : 0.055; torsoY = -swing * 0.07; bodyY = (jog ? 0.042 : 0.022) * Math.cos(phase * 2);
  } else if (pose === 'sit') {
    armR = -0.32; armL = -0.32; elbowR = -0.85; elbowL = -0.85; legR = -1.48; legL = -1.48; kneeR = 1.48; kneeL = 1.48; torsoX = -0.04; bodyY = (Number.isFinite(avatar.userData.seat) ? avatar.userData.seat : 0.6) + 0.11 - HIP_Y;
  } else if (pose === 'wave') {
    armL = -0.18; armLZ = -2.35; elbowL = -1.15; elbowLY = Math.sin(time * 7) * 0.25;
  } else if (pose === 'dance') {
    const beat = Math.sin(time * 4);
    armR = -0.45 - beat * 0.15; armL = -0.95 + beat * 0.2; armRZ = 1.8; armLZ = -0.8; elbowR = -0.75; elbowL = -1.1; legR = -0.25; legL = 0.16; kneeR = 0.55; torsoY = beat * 0.16; bodyY = Math.abs(beat) * 0.035;
  } else if (pose === 'work') {
    armR = -0.82; armL = -0.82; elbowR = -0.9; elbowL = -0.9; torsoX = 0.13;
  } else if (pose === 'eat') {
    armR = -0.68; armL = -0.35; elbowR = -1.35; elbowL = -0.92; torsoX = 0.04;
  } else if (pose === 'phone') {
    armL = -0.15; armLZ = -1.95; elbowL = -1.7; headZ = -0.08;
  } else if (pose === 'relax') {
    armR = 0.08; armL = -0.02; elbowR = -0.32; elbowL = -0.24; legL = -0.07; kneeL = 0.12; bodyX = 0.025;
  } else {
    bodyX = Math.sin(time * 1.7) * 0.012; headY = Math.sin(time * 0.7) * 0.035;
  }
  rig.body.position.set(0, bodyY, 0); rig.body.rotation.set(bodyX, 0, 0);
  rig.torso.rotation.set(torsoX, torsoY, 0);
  rig.head.rotation.set(0, headY, headZ);
  rig.armR.rotation.set(armR, 0, -armRZ); rig.armL.rotation.set(armL, 0, armLZ);
  rig.elbowR.rotation.set(elbowR, elbowRY, 0); rig.elbowL.rotation.set(elbowL, elbowLY, 0);
  rig.legR.rotation.set(legR, 0, 0); rig.legL.rotation.set(legL, 0, 0);
  rig.kneeR.rotation.set(kneeR, 0, 0); rig.kneeL.rotation.set(kneeL, 0, 0);
  return avatar;
}
