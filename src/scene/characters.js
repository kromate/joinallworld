/**
 * OWNER: scenes
 * Procedural low-poly people.
 *
 *   normalizeLook(look, seed)            → a complete look; anything missing or unknown is chosen
 *                                          deterministically from `seed` (e.g. a public player id)
 *   drawAvatar(batch, look, options)     → draws one avatar into a geometry batch (build.js).
 *                                          options.detail: 'low' (default; scenes and crowds, at
 *                                          most 600 triangles) or 'high' (the character preview)
 *   buildAvatar(kit, look, options)      → THREE.Group holding one avatar (one or two meshes)
 *   buildCrowd(kit, people, options)     → { group, tags, triangles, dispose } — every person in
 *                                          one merged mesh, with name-tag data for the DOM
 *
 * A look is `{ body, hair, outfit, fabric, skin, hairColor, outfitColor, bottomsColor }`
 * (state.onboarding.look). Option ids are listed in LOOK_OPTIONS; matching ignores case, spaces
 * and punctuation ('Low cut' = 'lowcut'). Colours may be a swatch id, a swatch index or '#rrggbb';
 * the game's own skin ids ('skin-1' … 'skin-7', content/traits.js) are understood too.
 *
 * Avatars are static: a pose is chosen when the avatar is built (POSES) and nothing animates.
 * Rules for everything under src/scene/: procedural geometry only, no downloaded models or
 * textures, no animation loops — the host (src/venue-world.js) draws on demand.
 */
import { createBatch, sceneMaterials, kitResources, releaseObjects, hash, GLOW } from './build.js';

const swatches = (entries) => entries.map(([id, hex]) => ({ id, hex }));
export const LOOK_OPTIONS = Object.freeze({
  body: ['woman', 'man'],
  hair: {
    woman: ['braids', 'afro', 'bun', 'ponytail', 'long', 'locs', 'lowcut', 'gele', 'classic'],
    man: ['lowcut', 'bald', 'curls', 'afro', 'locs', 'braids', 'classic'],
  },
  outfit: {
    woman: ['casual', 'office', 'owambe', 'sitework'],
    man: ['casual', 'hoodie', 'office', 'chill', 'sitework'],
  },
  fabric: ['plain', 'ankara', 'adire', 'asooke'],
  skin: swatches([['sand', '#c68a5e'], ['honey', '#b0764d'], ['bronze', '#9a6341'], ['chestnut', '#845236'], ['cocoa', '#6e422c'], ['umber', '#573323'], ['ebony', '#40261b']]),
  hairColor: swatches([['black', '#1c1917'], ['softblack', '#2b2320'], ['darkbrown', '#3d2a1f'], ['brown', '#5a3a26'], ['auburn', '#8a3b22'], ['blonde', '#d2a857'], ['purple', '#7a4bb0']]),
  outfitColor: swatches([['blue', '#3f72c4'], ['green', '#3f9a5a'], ['red', '#c9423a'], ['orange', '#e0822f'], ['violet', '#8055c2'], ['pink', '#dd6fa0'], ['teal', '#2f9d98'], ['navy', '#243a66'], ['cream', '#ece2c6'], ['gold', '#d6a83a']]),
});
export const POSES = Object.freeze(['stand', 'sit', 'walk', 'wave', 'work', 'dance']);
export const DETAILS = Object.freeze(['low', 'high']);
// The game's skin swatches (APPEARANCE.skin in content/traits.js), so a saved look keeps its tone in a scene.
const GAME_SKIN = { skin1: '#e0ac7e', skin2: '#c98e62', skin3: '#b0764c', skin4: '#96603c', skin5: '#7a4a2c', skin6: '#5e3620', skin7: '#3f2416' };

const key = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIASES = { female: 'woman', f: 'woman', girl: 'woman', male: 'man', m: 'man', boy: 'man', asoke: 'asooke', lowcut: 'lowcut', site: 'sitework', work: 'sitework', smart: 'office' };

function pickOption(value, list, seed) {
  const wanted = ALIASES[key(value)] || key(value);
  return list.includes(wanted) ? wanted : list[seed % list.length];
}
function pickColour(value, palette, seed) {
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim())) return value.trim().toLowerCase();
  if (Number.isInteger(value) && value >= 0 && value < palette.length) return palette[value].hex;
  const named = palette.find((swatch) => swatch.id === key(value));
  if (!named && palette === LOOK_OPTIONS.skin && GAME_SKIN[key(value)]) return GAME_SKIN[key(value)];
  return (named || palette[seed % palette.length]).hex;
}

/** Fill in a look. The same input and seed always give the same result. */
export function normalizeLook(look, seed) {
  const source = look && typeof look === 'object' ? look : {};
  const base = seed ?? source.seed ?? source.id ?? 'joinallworld';
  const pick = (part) => hash(`${base}:${part}`);
  const body = pickOption(source.body ?? source.gender, LOOK_OPTIONS.body, pick('body'));
  const outfitColor = pickColour(source.outfitColor, LOOK_OPTIONS.outfitColor, pick('outfitColor'));
  let bottomsSeed = pick('bottomsColor');
  if (LOOK_OPTIONS.outfitColor[bottomsSeed % 10].hex === outfitColor) bottomsSeed += 7;
  return {
    body,
    hair: pickOption(source.hair ?? source.hairstyle, LOOK_OPTIONS.hair[body], pick('hair')),
    // Seeded fallbacks rarely pick site work, so a crowd is not a sea of hard hats.
    outfit: pickOption(source.outfit, LOOK_OPTIONS.outfit[body], pick('outfit') % 9 === 0 ? LOOK_OPTIONS.outfit[body].indexOf('sitework') : pick('outfit') % (LOOK_OPTIONS.outfit[body].length - 1)),
    fabric: pickOption(source.fabric, LOOK_OPTIONS.fabric, source.fabric == null && pick('fabric') % 2 ? 0 : pick('fabric')),
    skin: pickColour(source.skin ?? source.skinTone, LOOK_OPTIONS.skin, pick('skin')),
    hairColor: pickColour(source.hairColor, LOOK_OPTIONS.hairColor, pick('hairColor') % 4),
    outfitColor,
    bottomsColor: pickColour(source.bottomsColor, LOOK_OPTIONS.outfitColor, bottomsSeed),
  };
}

// Joint angles per pose. arm/leg: [pitch, roll] at the shoulder/hip (negative pitch = forward);
// fore/calf: bend at the elbow/knee. Index 0 is the avatar's right side (−x), 1 its left (+x).
const POSE = {
  stand: { arm: [[0.06, 0.1], [0.06, 0.1]], fore: [-0.18, -0.18], leg: [0.03, -0.03], calf: [0, 0], lean: 0 },
  sit: { arm: [[-0.35, 0.08], [-0.35, 0.08]], fore: [-0.95, -0.95], leg: [-1.5, -1.5], calf: [1.5, 1.5], lean: -0.04 },
  walk: { arm: [[0.55, 0.1], [-0.55, 0.1]], fore: [-0.35, -0.6], leg: [-0.5, 0.42], calf: [0.15, 0.6], lean: 0.06 },
  wave: { arm: [[0.06, 0.1], [0, 2.55]], fore: [-0.18, -0.55], leg: [0.03, -0.03], calf: [0, 0], lean: 0 },
  work: { arm: [[-0.75, 0.12], [-0.75, 0.12]], fore: [-0.85, -0.85], leg: [0.03, -0.03], calf: [0, 0], lean: 0.14 },
  dance: { arm: [[-0.4, 2.2], [-1.1, 0.5]], fore: [-0.7, -1.2], leg: [-0.45, 0.12], calf: [0.75, 0.1], lean: -0.06 },
};

// What each outfit is made of. `shoe` is a shoe kind (SHOES); `bulk` pads the torso.
const OUTFIT = {
  casual: { sleeve: 'short', shoe: 'sneaker' },
  office: { sleeve: 'long', collar: true, shoe: 'dress' },
  owambe: { sleeve: 'wide', gown: true, shoe: 'heel' },
  sitework: { sleeve: 'short', vest: true, helmet: true, shoe: 'boot' },
  hoodie: { sleeve: 'long', hood: true, shoe: 'sneaker', bulk: 0.03 },
  chill: { sleeve: 'short', shorts: true, open: true, shoe: 'slide' },
};
// [upper, sole] colours.
const SHOES = { sneaker: ['#2c3340', '#f1efe9'], dress: ['#1f1c1c', '#141212'], heel: ['#c9a13a', '#a8842a'], boot: ['#8a6a3c', '#2b2622'], slide: ['#3a342e', '#d9cfb8'] };

// Body measurements. Radii are half-widths; depth = radius × aspect. Torso heights are measured
// from the hips (1.06 above the feet), where the upper body leans from.
const BODY = {
  woman: { hip: 0.252, waist: 0.172, chest: 0.222, shoulder: 0.232, aspect: 0.7, arm: 0.07, leg: 0.108, neck: 0.068, legX: 0.116 },
  man: { hip: 0.236, waist: 0.222, chest: 0.292, shoulder: 0.312, aspect: 0.6, arm: 0.09, leg: 0.116, neck: 0.088, legX: 0.112 },
};
const HIP_Y = 1.06, SHOULDER_Y = 0.672;
const HEAD = { y: 2.2, rx: 0.25, ry: 0.28, rz: 0.255 };
const CLOTH_WHITE = '#f3f0e8', INK = '#1f1a1a', GOLD = '#d9b048';

const q3 = (value) => Math.round(value * 1000) / 1000;
const channels = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const shade = (hex, amount) => toHex(channels(hex).map((v) => v * (1 + amount) + (amount > 0 ? 255 * amount * 0.25 : 0)));
const mix = (a, b, t) => { const x = channels(a), y = channels(b); return toHex(x.map((v, i) => v * (1 - t) + y[i] * t)); };

/** Colour list a fabric is woven from: [main, second, third]. */
function fabricColours(look) {
  const main = look.outfitColor, palette = LOOK_OPTIONS.outfitColor, at = palette.findIndex((swatch) => swatch.hex === main);
  const other = (step) => palette[((at < 0 ? hash(main) : at) + step) % palette.length].hex;
  if (look.fabric === 'ankara') return [main, other(3), other(7)];
  if (look.fabric === 'adire') return [main, '#e6ebf3', shade(main, -0.3)];
  if (look.fabric === 'asooke') return [main, '#e2c15a', shade(main, -0.35)];
  return [main, main, main];
}

// ---- Lofted shapes --------------------------------------------------------------------------
// A garment or a torso is a stack of tapered elliptical rings: [[y, radius], …] from the bottom up.

const torsoRings = (m, pad = 0) => [[-0.12, m.hip * 0.95], [0, m.hip], [0.25, m.waist], [0.5, m.chest], [0.655, m.shoulder], [0.735, m.shoulder * 0.7], [0.79, m.neck + 0.03]].map(([y, r]) => [y, r + pad]);
function radiusAt(rings, y) {
  if (y <= rings[0][0]) return rings[0][1];
  for (let i = 1; i < rings.length; i++) {
    if (y <= rings[i][0]) { const [y0, r0] = rings[i - 1], [y1, r1] = rings[i]; return r0 + (r1 - r0) * (y - y0) / (y1 - y0); }
  }
  return rings[rings.length - 1][1];
}
/** The part of `rings` between two heights, with new rings cut exactly at the ends. */
function clip(rings, from, to) {
  const inside = rings.filter(([y]) => y > from + 1e-6 && y < to - 1e-6);
  return [[from, radiusAt(rings, from)], ...inside, [to, radiusAt(rings, to)]];
}
function loft(b, rings, colour, { seg = 12, aspect = 1, z = 0, capped = false } = {}) {
  for (let i = 0; i < rings.length - 1; i++) {
    const [y0, r0] = rings[i], [y1, r1] = rings[i + 1];
    b.cyl(0, (y0 + y1) / 2, z, r0, y1 - y0, Array.isArray(colour) ? colour[i % colour.length] : colour, { seg, top: q3(r1 / r0), sz: aspect, open: !capped });
  }
}
/** A ring of trim lying on a loft at height y: follows the loft's taper, so it never cuts through it. */
function band(b, rings, y, height, colour, { seg = 12, aspect = 1, z = 0, lift = 0.005 } = {}) {
  const r0 = radiusAt(rings, y - height / 2) + lift, r1 = radiusAt(rings, y + height / 2) + lift;
  b.cyl(0, y, z, r0, height, colour, { seg, top: q3(r1 / r0), sz: aspect, open: true });
}
/** A strip of cloth running up a loft at angle a (0 = front), following its taper. */
function strip(b, rings, from, to, a, width, colour, { aspect = 1, lift = 0.005, thick = 0.01 } = {}) {
  const cut = clip(rings, from, to), reach = Math.hypot(Math.sin(a), aspect * Math.cos(a));
  for (let i = 0; i < cut.length - 1; i++) {
    const [y0, r0] = cut[i], [y1, r1] = cut[i + 1], mid = (y0 + y1) / 2, p = onLoft(cut, aspect, mid, a, lift);
    b.box(p.x, mid, p.z, width, Math.hypot(y1 - y0, (r1 - r0) * reach) + 0.004, thick, colour, { ry: p.ry, rx: Math.atan2((r1 - r0) * reach, y1 - y0) });
  }
}
/** A point on a loft's surface at height y and angle a (0 = front), `lift` outside it, with the turn that faces outwards. */
function onLoft(rings, aspect, y, a, lift = 0, z = 0) {
  const r = radiusAt(rings, y) + lift;
  return { x: Math.sin(a) * r, z: z + Math.cos(a) * r * aspect, ry: Math.atan2(aspect * Math.sin(a), Math.cos(a)) };
}

/**
 * Fabric print laid over a lofted garment (high detail). Ankara: bold medallions with diamond
 * centres; adire: pale resist bands with rows of dots; aso-oke: woven vertical stripes.
 */
function print(b, look, colours, rings, { aspect = 1, z = 0, from = rings[0][0], to = rings[rings.length - 1][0], size = 1, around = 6, seg = 14 } = {}) {
  const [, second, third] = colours;
  const TAU = Math.PI * 2;
  if (look.fabric === 'ankara') {
    const step = 0.185 * size;
    for (let y = from + step * 0.55, row = 0; y < to - step * 0.35; y += step, row++) {
      for (let i = 0; i < around; i++) {
        const a = (i + (row % 2) * 0.5) / around * TAU;
        const p = onLoft(rings, aspect, y, a, 0.003, z), c = onLoft(rings, aspect, y, a, 0.009, z);
        b.cyl(p.x, y, p.z, 0.07 * size, 0.008, (i + row) % 2 ? third : second, { seg: 10, rx: Math.PI / 2, ry: p.ry });
        b.quad(c.x, y, c.z, 0.056 * size, 0.056 * size, (i + row) % 2 ? second : third, { ry: c.ry, rz: Math.PI / 4 });
      }
    }
  } else if (look.fabric === 'adire') {
    const step = 0.2 * size;
    for (let y = from + step * 0.4, row = 0; y < to - 0.02; y += step, row++) {
      band(b, rings, y, 0.024 * size, second, { seg, aspect, z });
      const dotY = y + step / 2;
      if (dotY > to - 0.03) break;
      const dots = Math.round(around * 1.5);
      for (let i = 0; i < dots; i++) {
        const a = (i + (row % 2) * 0.5) / dots * TAU, p = onLoft(rings, aspect, dotY, a, 0.006, z);
        b.quad(p.x, dotY, p.z, 0.04 * size, 0.04 * size, i % 2 ? second : third, { ry: p.ry, rz: Math.PI / 4 });
      }
    }
  } else if (look.fabric === 'asooke') {
    const stripes = around * 2, cut = clip(rings, from, to);
    for (let k = 0; k < cut.length - 1; k++) {
      const [y0, r0] = cut[k], [y1, r1] = cut[k + 1];
      for (let i = 0; i < stripes; i++) {
        const a = (i + 0.5) / stripes * TAU, reach = Math.hypot(Math.sin(a), aspect * Math.cos(a));
        const p = onLoft(cut, aspect, (y0 + y1) / 2, a, 0.004, z);
        b.box(p.x, (y0 + y1) / 2, p.z, (i % 2 ? 0.02 : 0.046) * size, Math.hypot(y1 - y0, (r1 - r0) * reach) + 0.004, 0.008, i % 2 ? third : second, { ry: p.ry, rx: Math.atan2((r1 - r0) * reach, y1 - y0) });
      }
    }
  }
}

/** Low detail: a box of cloth, split into blocks, bands or stripes according to the fabric. */
function clothLow(b, m, look, colours, bulk) {
  const [main, second, third] = colours;
  const rings = [[-0.1, m.hip + bulk], [0.25, m.waist + 0.012 + bulk], [0.52, m.chest + 0.008 + bulk], [0.77, m.shoulder * 0.92 + bulk]];
  const by = { ankara: [main, second, third], adire: [third, second, main], asooke: [main, main, main] }[look.fabric] || main;
  loft(b, rings, by, { seg: 6, aspect: m.aspect + 0.04, capped: true });
  if (look.fabric === 'asooke') for (const side of [-1, 1]) for (const [x, colour] of [[-0.09, second], [0.09, second], [0, third]]) b.quad(x, 0.32, side * (m.chest * (m.aspect + 0.04) * 0.9 + bulk + 0.012), 0.05, 0.6, colour, side < 0 ? { ry: Math.PI } : undefined);
}

// ---- Head, face and hair -------------------------------------------------------------------
// Everything below is in the avatar's own coordinates: feet at y = 0, head centre at y = 2.2, face towards +z.

const faceZ = (x, y) => HEAD.rz * Math.sqrt(Math.max(0.04, 1 - (x / HEAD.rx) ** 2 - ((y - HEAD.y) / HEAD.ry) ** 2));

function headHigh(b, look, woman) {
  const skin = look.skin, white = '#f7f3ec';
  b.ball(0, HEAD.y, 0, HEAD.rx, HEAD.ry, HEAD.rz, skin, { seg: 20 });
  const brow = mix(look.hairColor, INK, 0.45), lip = woman ? mix(skin, '#b8454c', 0.55) : mix(skin, '#3d1513', 0.6);
  for (const side of [-1, 1]) {
    const ex = side * 0.098, ey = 2.212, ez = faceZ(ex, ey), turn = side * 0.36;
    b.ball(ex, ey, ez - 0.014, 0.052, 0.058, 0.022, white, { seg: 10, ry: turn });
    b.ball(ex - side * 0.004, ey - 0.004, ez + 0.001, 0.031, 0.038, 0.014, '#2b1a12', { seg: 10, ry: turn });
    b.ball(ex + 0.012, ey + 0.016, ez + 0.012, 0.009, 0.009, 0.005, white, { seg: 6 });
    if (woman) b.box(ex + side * 0.012, ey + 0.05, ez - 0.004, 0.1, 0.013, 0.016, INK, { ry: turn, rz: side * -0.16 }); // lash line
    const by = 2.3;
    b.box(ex, by, faceZ(ex, by) + 0.002, 0.105, woman ? 0.017 : 0.026, 0.02, brow, { ry: turn, rz: side * -0.1, rx: -0.3 });
    b.ball(side * 0.247, 2.185, -0.012, 0.036, 0.068, 0.05, skin, { seg: 8 });
    b.ball(side * 0.262, 2.185, -0.004, 0.014, 0.038, 0.026, shade(skin, -0.16), { seg: 6 });
  }
  b.ball(0, 2.128, faceZ(0, 2.128) + 0.002, 0.036, 0.042, 0.04, shade(skin, -0.05), { seg: 8 });
  const my = 2.045, mz = faceZ(0, my) + 0.004;
  b.box(0, my, mz, 0.075, woman ? 0.026 : 0.017, 0.014, lip);
  for (const side of [-1, 1]) b.box(side * 0.052, my + 0.012, mz - 0.008, 0.045, woman ? 0.022 : 0.016, 0.014, lip, { rz: side * 0.5, ry: side * 0.35 });
}
function headLow(b, look) {
  b.ball(0, HEAD.y, 0, 0.26, 0.27, 0.26, look.skin, { seg: 7 });
  for (const side of [-1, 1]) b.quad(side * 0.095, 2.215, 0.249, 0.055, 0.065, INK, { ry: side * 0.3 });
  b.quad(0, 2.07, 0.238, 0.11, 0.026, mix(look.skin, '#4a1d1a', 0.55), { rx: 0.25 });
}

const capHigh = (b, c, grow = 0, o) => b.ball(0, 2.345, -0.05, 0.258 + grow, 0.18 + grow, 0.262 + grow, c, { seg: 16, rx: -0.3, ...o });
/** Points spread evenly over the upper part of a sphere (golden-angle spiral): [x, y, z] unit vectors. */
function dome(count, coverage = 0.6) {
  return Array.from({ length: count }, (_, i) => {
    const up = 1 - (i + 0.5) / count * coverage * 2, r = Math.sqrt(Math.max(0, 1 - up * up)), turn = i * 2.39996;
    return [Math.cos(turn) * r, up, Math.sin(turn) * r];
  });
}
/** Strands hanging from the scalp around the back of the head; angle 0 is the back, ±π/2 the ears. */
function strands(b, c, count, spread, { radius, length, short = length, seg = 5, from = 2.3, splay = 0, bead = null }) {
  for (let i = 0; i < count; i++) {
    const turn = (i / (count - 1) - 0.5) * 2 * spread, side = Math.abs(turn) > 1.25;
    const len = (side ? short : length) * (1 - (i % 3) * 0.06);
    const x = Math.sin(turn) * 0.262, z = -Math.cos(turn) * 0.262 - 0.03;
    const rz = Math.sin(turn) * splay, rx = -Math.cos(turn) * splay;
    b.at(x, from, z, 0, () => {
      b.cyl(0, -len / 2, 0, radius * 0.8, len, c, { seg, top: 1.25 });
      if (bead) b.ball(0, -len, 0, radius * 1.5, radius * 1.5, radius * 1.5, bead, { seg: 6 });
    }, rx, rz);
  }
}

const HAIR_HIGH = {
  bald() {},
  lowcut(b, c) { capHigh(b, c, 0.006); },
  classic(b, c, look) {
    capHigh(b, c, 0.024);
    if (look.body === 'woman') {
      b.ball(0, 2.14, -0.075, 0.305, 0.3, 0.25, c, { seg: 16 }); // a bob framing the face
      b.ball(-0.07, 2.4, 0.15, 0.2, 0.075, 0.13, c, { seg: 10, rz: 0.3, rx: 0.3 }); // side-swept fringe
    } else {
      b.ball(0, 2.47, -0.01, 0.215, 0.1, 0.225, c, { seg: 12, rx: -0.12 }); // a fuller top over short sides
      b.ball(0.02, 2.475, 0.11, 0.17, 0.07, 0.12, c, { seg: 10, rx: 0.2 }); // quiff
    }
  },
  afro(b, c) {
    capHigh(b, c, 0.012);
    b.ball(0, 2.47, -0.085, 0.4, 0.36, 0.385, c, { seg: 16 });
    for (const [x, y, z] of dome(30, 0.74)) b.ball(x * 0.345, 2.47 + y * 0.31, -0.085 + z * 0.33, 0.1, 0.1, 0.1, y > 0.35 ? shade(c, 0.12) : c, { seg: 6 });
  },
  curls(b, c) {
    capHigh(b, c, 0.006);
    for (const [x, y, z] of dome(22, 0.42)) b.ball(x * 0.235, 2.33 + y * 0.2, -0.03 + z * 0.24, 0.078, 0.072, 0.078, y > 0.6 ? shade(c, 0.12) : c, { seg: 6 });
  },
  bun(b, c) {
    capHigh(b, c, 0.012);
    b.ball(0, 2.61, -0.13, 0.15, 0.135, 0.15, c, { seg: 12 });
    b.cyl(0, 2.5, -0.105, 0.085, 0.05, shade(c, 0.25), { seg: 10, rx: -0.5 });
  },
  ponytail(b, c) {
    capHigh(b, c, 0.012);
    b.cyl(0, 2.43, -0.3, 0.06, 0.07, GOLD, { seg: 8, rx: 1.1 });
    for (const [y, z, r, len] of [[2.38, -0.38, 0.1, 0.12], [2.2, -0.43, 0.095, 0.16], [2.0, -0.44, 0.08, 0.17], [1.82, -0.42, 0.055, 0.14]]) b.ball(0, y, z, r, len, r, c, { seg: 10 });
  },
  long(b, c) {
    capHigh(b, c, 0.03);
    b.ball(0, 1.98, -0.185, 0.29, 0.52, 0.13, c, { seg: 14 });
    for (const side of [-1, 1]) b.ball(side * 0.238, 2.06, -0.03, 0.082, 0.3, 0.16, c, { seg: 10 });
    b.box(0, 2.515, 0.03, 0.012, 0.02, 0.3, shade(c, -0.4)); // centre parting
  },
  braids(b, c) {
    capHigh(b, c, 0.012);
    for (const x of [-0.14, -0.07, 0, 0.07, 0.14]) b.box(x, 2.3 + Math.sqrt(1 - (x / 0.275) ** 2) * 0.212, -0.02, 0.01, 0.014, 0.34, shade(c, 0.55)); // cornrow partings
    strands(b, c, 15, 2.05, { radius: 0.024, length: 0.86, short: 0.46, from: 2.3, splay: 0.03, bead: GOLD });
  },
  locs(b, c) {
    capHigh(b, c, 0.026);
    for (const [x, y, z] of dome(12, 0.3)) b.ball(x * 0.24, 2.35 + y * 0.2, -0.03 + z * 0.25, 0.06, 0.05, 0.06, c, { seg: 6 });
    strands(b, c, 11, 2.0, { radius: 0.042, length: 0.52, short: 0.4, seg: 6, from: 2.34, splay: 0.14 });
  },
  gele(b, c, look, colours) {
    const main = colours[0], other = look.fabric === 'plain' ? shade(main, 0.22) : colours[1], dark = look.fabric === 'plain' ? shade(main, -0.18) : colours[2];
    b.ball(0, 2.27, -0.05, 0.257, 0.17, 0.262, c, { seg: 12 }); // hair showing at the nape and temples
    b.cyl(0, 2.43, -0.03, 0.264, 0.2, main, { seg: 16, top: 1.14, rx: -0.1 });
    b.cyl(0, 2.58, -0.045, 0.3, 0.14, other, { seg: 16, top: 1.22, rx: -0.1 });
    // The fan: broad rounded pleats standing up behind the wrap, each a little smaller and further forward.
    [[0.47, 2.69, -0.15, -0.34, main], [0.44, 2.7, -0.085, -0.2, other], [0.39, 2.69, -0.02, -0.06, dark], [0.31, 2.66, 0.045, 0.1, main]]
      .forEach(([r, y, z, tilt, colour]) => b.cyl(0, y, z, r, 0.04, colour, { seg: 18, sz: 0.5, rx: Math.PI / 2 + tilt }));
    b.ball(0.2, 2.5, 0.2, 0.09, 0.07, 0.06, other, { seg: 8 }); // knot
  },
};

const HAIR_LOW = {
  bald() {},
  lowcut(b, c) { b.ball(0, 2.31, -0.02, 0.273, 0.2, 0.27, c, { seg: 7 }); },
  classic(b, c, look) {
    b.ball(0, 2.33, -0.03, 0.285, 0.2, 0.275, c, { seg: 7 });
    if (look.body === 'woman') b.ball(0, 2.13, -0.11, 0.32, 0.32, 0.24, c, { seg: 7 });
    else b.ball(0.07, 2.46, 0.08, 0.17, 0.08, 0.14, c, { seg: 6 });
  },
  afro(b, c) { b.ball(0, 2.46, -0.09, 0.42, 0.37, 0.39, c, { seg: 8 }); },
  curls(b, c) {
    b.ball(0, 2.32, -0.03, 0.275, 0.19, 0.27, c, { seg: 7 });
    for (let i = 0; i < 5; i++) b.ico(Math.sin(i * 1.26) * 0.18, 2.48 + (i % 2) * 0.04, Math.cos(i * 1.26) * 0.16 - 0.05, 0.12, 0.11, 0.12, c);
  },
  bun(b, c) {
    b.ball(0, 2.32, -0.03, 0.275, 0.19, 0.27, c, { seg: 7 });
    b.ball(0, 2.6, -0.12, 0.16, 0.15, 0.16, c, { seg: 6 });
  },
  ponytail(b, c) {
    b.ball(0, 2.32, -0.03, 0.275, 0.19, 0.27, c, { seg: 7 });
    b.ball(0, 2.42, -0.3, 0.1, 0.1, 0.1, c, { seg: 6 });
    b.ball(0, 2.08, -0.42, 0.1, 0.34, 0.1, c, { seg: 6, rx: 0.3 });
  },
  long(b, c) {
    b.ball(0, 2.33, -0.03, 0.285, 0.2, 0.28, c, { seg: 7 });
    b.box(0, 1.86, -0.22, 0.52, 0.8, 0.12, c);
    for (const side of [-1, 1]) b.box(side * 0.265, 2.02, -0.06, 0.09, 0.46, 0.2, c);
  },
  braids(b, c) {
    b.ball(0, 2.32, -0.03, 0.275, 0.19, 0.27, c, { seg: 7 });
    for (let i = 0; i < 7; i++) {
      const turn = (i - 3) * 0.42, length = 0.62 + (i % 2) * 0.12;
      b.box(Math.sin(turn) * 0.27, 2.3 - length / 2, -Math.cos(turn) * 0.27, 0.075, length, 0.075, c);
    }
  },
  locs(b, c) {
    b.ball(0, 2.34, -0.03, 0.285, 0.2, 0.28, c, { seg: 7 });
    for (let i = 0; i < 6; i++) {
      const turn = (i - 2.5) * 0.5;
      b.box(Math.sin(turn) * 0.29, 2.08, -Math.cos(turn) * 0.28, 0.12, 0.5 + (i % 3) * 0.06, 0.12, c, { rz: Math.sin(turn) * 0.16 });
    }
  },
  gele(b, c, look, colours) {
    b.ball(0, 2.27, -0.04, 0.268, 0.16, 0.265, c, { seg: 7 });
    b.cyl(0, 2.49, -0.03, 0.27, 0.3, colours[0], { top: 1.45, seg: 8 });
    b.box(0, 2.72, -0.07, 0.8, 0.26, 0.09, colours[1], { rx: -0.25 });
    b.box(0.1, 2.78, 0.05, 0.56, 0.2, 0.08, colours[0], { rx: 0.15, rz: 0.12 });
  },
};
// Under a hard hat only hair that hangs below it is drawn in full.
const HANGING = new Set(['braids', 'locs', 'long', 'ponytail', 'bald']);

// ---- Limbs ---------------------------------------------------------------------------------

/** A two-part limb. Each part: { length, r0 (radius at its top), r1 (at its end), colour, extra? }. */
function limb(b, hi, x, y, z, pitch, roll, upper, bend, lower, end) {
  const seg = hi ? 10 : 5;
  const tube = (part, open) => b.cyl(0, -part.length / 2, 0, part.r1, part.length, part.colour, { seg, top: q3(part.r0 / part.r1), open });
  b.at(x, y, z, 0, () => {
    tube(upper, hi);
    upper.extra?.();
    b.at(0, -upper.length, 0, 0, () => {
      if (hi) { const r = upper.jointR ?? upper.r1 * 0.98; b.ball(0, 0, 0, r, r, r, upper.joint ?? upper.colour, { seg: 10 }); }
      if (lower) { tube(lower, true); lower.extra?.(); }
      end?.(lower ? -lower.length : 0);
    }, bend);
  }, pitch, roll);
}

function shoeHigh(b, kind, end, skin, [upper, sole] = SHOES[kind] || SHOES.sneaker) {
  if (kind === 'slide') {
    b.box(0, end - 0.105, 0.07, 0.17, 0.034, 0.37, sole);
    b.ball(0, end - 0.055, 0.07, 0.08, 0.05, 0.18, skin, { seg: 8 });
    b.box(0, end - 0.05, 0.12, 0.185, 0.07, 0.09, upper);
  } else if (kind === 'heel') {
    b.ball(0, end - 0.05, 0.02, 0.07, 0.05, 0.11, skin, { seg: 8 });
    b.ball(0, end - 0.075, 0.12, 0.074, 0.05, 0.14, upper, { seg: 10 });
    b.box(0, end - 0.075, -0.06, 0.05, 0.1, 0.05, sole);
  } else {
    const boot = kind === 'boot', dress = kind === 'dress';
    b.box(0, end - (boot ? 0.1 : 0.108), 0.075, dress ? 0.13 : 0.17, boot ? 0.06 : 0.036, dress ? 0.33 : 0.36, sole);
    b.ball(0, end - 0.08, 0.08, dress ? 0.088 : 0.1, dress ? 0.08 : 0.092, dress ? 0.21 : 0.2, upper, { seg: 12 });
    if (boot) b.cyl(0, end + 0.03, 0, 0.088, 0.16, upper, { seg: 10, top: 1.08 });
    else if (!dress) {
      b.ball(0, end - 0.085, 0.205, 0.08, 0.055, 0.08, sole, { seg: 8 }); // toe cap
      b.box(0, end - 0.0, 0.1, 0.07, 0.012, 0.13, sole, { rx: 0.5 }); // laces
    }
  }
}

function markerOf(b, marker) {
  if (marker === 'crown') {
    b.cyl(0, 3.1, 0, 0.13, 0.16, '#ffd34d', { seg: 6, top: 1.5, ...GLOW });
    b.cone(0, 2.92, 0, 0.1, 0.16, '#ffd34d', { seg: 4, rz: Math.PI, ...GLOW });
  } else if (marker === 'npc') {
    b.ico(0, 3.02, 0, 0.12, 0.12, 0.12, '#58d68a', GLOW);
  } else if (marker === 'player') {
    b.ico(0, 3.02, 0, 0.11, 0.14, 0.11, '#6fb4ff', GLOW);
  }
}

// ---- Low detail (crowds, venue and home scenes): at most 600 triangles --------------------------

function drawLow(b, look, { joints, sitting, marker }) {
  const style = OUTFIT[look.outfit] || OUTFIT.casual, m = BODY[look.body], woman = look.body === 'woman';
  const colours = fabricColours(look), top = look.outfitColor, bottoms = look.bottomsColor, skin = look.skin;
  const skirt = woman && look.outfit === 'office', bareCalf = style.shorts || skirt, bulk = style.bulk || 0;
  const shoe = (SHOES[style.shoe] || SHOES.sneaker)[style.shoe === 'slide' ? 1 : 0];
  if (!style.gown || sitting) {
    for (const side of [0, 1]) {
      limb(b, false, (side ? 1 : -1) * (m.legX + 0.025), 1.04, 0, joints.leg[side], 0,
        { length: 0.5, r0: m.leg + 0.008, r1: m.leg - 0.012, colour: style.gown || skirt ? shade(bottoms, -0.12) : bottoms },
        joints.calf[side],
        { length: 0.46, r0: m.leg - 0.02, r1: m.leg - 0.04, colour: style.gown ? bottoms : bareCalf ? skin : bottoms },
        (end) => b.box(0, end - 0.06, 0.07, 0.2, 0.13, 0.4, shoe));
    }
  } else {
    for (const side of [-1, 1]) b.box(side * 0.15, 0.065, 0.07, 0.2, 0.13, 0.4, shoe);
  }
  if (style.gown) {
    const rings = look.fabric === 'plain' ? [bottoms, bottoms, shade(bottoms, -0.15)] : [colours[0], colours[1], colours[2]];
    if (sitting) b.box(0, 1.02, 0.24, 0.56, 0.3, 0.8, rings[0]);
    else rings.forEach((colour, i) => b.cyl(0, 0.92 - i * 0.33, 0, 0.29 + i * 0.045, 0.34, colour, { seg: 8, top: 0.87 }));
  } else if (skirt) {
    if (sitting) b.box(0, 1.03, 0.2, 0.52, 0.28, 0.7, bottoms);
    else b.cyl(0, 0.84, 0, 0.31, 0.52, bottoms, { seg: 8, top: 0.82 });
  }
  b.box(0, 1.03, 0, m.hip * 1.86, 0.22, m.hip * 1.86 * m.aspect, style.gown ? colours[0] : bottoms);

  b.at(0, HIP_Y, 0, 0, () => {
    const depth = m.chest * (m.aspect + 0.04) + bulk;
    clothLow(b, m, look, colours, bulk);
    if (style.open) b.quad(0, 0.4, depth * 0.9 + 0.014, 0.15, 0.66, CLOTH_WHITE);
    if (style.collar) {
      b.box(0, 0.78, 0.02, 0.3, 0.06, 0.26, CLOTH_WHITE);
      if (!woman) b.box(0, 0.5, depth * 0.9 + 0.014, 0.07, 0.46, 0.02, colours[2] === top ? shade(top, -0.45) : colours[1]);
    }
    if (style.vest) {
      b.cyl(0, 0.42, 0, m.chest + 0.035, 0.5, '#f08a1d', { seg: 6, sz: m.aspect + 0.08, top: 1.04, open: true });
      b.cyl(0, 0.42, 0, m.chest + 0.045, 0.07, '#eeeacb', { seg: 6, sz: m.aspect + 0.08, open: true });
    }
    if (style.hood) {
      b.ball(0, 0.84, -0.15, 0.22, 0.16, 0.14, top, { seg: 6 });
      b.box(0, 0.22, depth * 0.86 + 0.014, 0.32, 0.17, 0.03, shade(top, -0.2));
    }
    if (style.gown) b.box(0, 0.46, depth * 0.9 + 0.012, 0.13, 0.8, 0.03, colours[1] === top ? shade(top, 0.35) : colours[1], { rz: 0.62 });
    b.cyl(0, 0.86, 0, m.neck, 0.18, skin, { seg: 5 });
    b.at(0, -HIP_Y, 0, 0, () => {
      headLow(b, look);
      (style.helmet && !HANGING.has(look.hair) ? HAIR_LOW.lowcut : HAIR_LOW[look.hair] || HAIR_LOW.lowcut)(b, look.hairColor, look, colours);
      if (style.helmet) {
        b.ball(0, 2.37, -0.01, 0.31, 0.2, 0.31, '#f2c230', { seg: 6 });
        b.box(0, 2.34, 0.22, 0.42, 0.04, 0.24, '#f2c230');
      }
      markerOf(b, marker);
    });
    for (const side of [0, 1]) {
      const dir = side ? 1 : -1, [pitch, roll] = joints.arm[side], wide = style.sleeve === 'wide';
      limb(b, false, dir * (m.shoulder + 0.02 + bulk), SHOULDER_Y + 0.05, 0, pitch, dir * roll,
        { length: 0.42, r0: wide ? 0.1 : m.arm + 0.02 + bulk, r1: wide ? 0.15 : m.arm + 0.012 + bulk, colour: wide && look.fabric !== 'plain' ? colours[1] : top },
        joints.fore[side],
        { length: 0.38, r0: m.arm, r1: m.arm - 0.016, colour: style.sleeve === 'long' ? top : skin },
        (end) => b.box(0, end - 0.06, 0, 0.12, 0.14, 0.1, skin));
    }
  }, joints.lean);
}

// ---- High detail (the character preview) ---------------------------------------------------------

function drawHigh(b, look, { joints, sitting, marker }) {
  const style = OUTFIT[look.outfit] || OUTFIT.casual, m = BODY[look.body], woman = look.body === 'woman';
  const colours = fabricColours(look), top = look.outfitColor, bottoms = look.bottomsColor, skin = look.skin;
  const plain = look.fabric === 'plain', skirt = woman && look.outfit === 'office';
  const bulk = style.bulk || 0, aspect = m.aspect, trim = shade(top, -0.2), SEG = 18;
  const wrapper = plain ? [bottoms, bottoms, shade(bottoms, -0.15)] : colours;

  // Legs, shoes and the lower garment
  const shoe = skirt ? 'heel' : style.shoe, shoeColours = skirt ? SHOES.dress : SHOES[shoe];
  const legWear = style.gown || skirt ? skin : bottoms;
  if (!style.gown || sitting) {
    for (const side of [0, 1]) {
      const cloth = !style.shorts && !skirt && !style.gown;
      limb(b, true, (side ? 1 : -1) * m.legX, 1.04, 0, joints.leg[side], 0,
        { length: 0.5, r0: m.leg + (cloth ? 0.008 : 0), r1: m.leg * 0.8 + (cloth ? 0.012 : 0), colour: style.shorts ? skin : legWear,
          extra: style.shorts ? () => {
            b.cyl(0, -0.19, 0, m.leg + 0.028, 0.38, bottoms, { seg: 10, top: 0.82, open: true });
            b.cyl(0, -0.375, 0, m.leg + 0.032, 0.03, shade(bottoms, -0.18), { seg: 10, open: true });
            b.cyl(0, -0.385, 0, m.leg + 0.026, 0.004, shade(bottoms, -0.5), { seg: 10 });
          } : null },
        joints.calf[side],
        { length: 0.46, r0: m.leg * 0.78 + (cloth ? 0.012 : 0), r1: m.leg * (cloth ? 0.7 : 0.56), colour: cloth ? bottoms : skin,
          extra: cloth ? () => b.cyl(0, -0.445, 0, m.leg * 0.7 + 0.006, 0.03, shade(bottoms, -0.18), { seg: 10, open: true }) : null },
        (end) => shoeHigh(b, shoe, end, skin, shoeColours));
    }
  } else {
    for (const side of [-1, 1]) b.at(side * m.legX, 0.54, 0, 0, () => shoeHigh(b, shoe, -0.46, skin, shoeColours));
  }
  if (style.gown) {
    if (sitting) b.box(0, 1.02, 0.24, 0.56, 0.3, 0.8, wrapper[0]);
    else {
      // Iro: a wrapper from the waist to the ankles, with its overlapping edge down the front.
      const rings = [[0.1, 0.3], [0.45, 0.27], [0.95, m.hip + 0.035], [1.2, m.waist + 0.04]];
      loft(b, rings, wrapper[0], { seg: SEG, aspect: 0.8 });
      b.cyl(0, 0.115, 0, 0.303, 0.05, plain ? shade(bottoms, -0.2) : colours[2], { seg: SEG, sz: 0.8, open: true });
      print(b, look, colours, rings, { aspect: 0.8, from: 0.16, to: 1.1, around: 7, seg: SEG });
      const edge = onLoft(rings, 0.8, 0.6, 0.5, 0.012);
      b.box(edge.x, 0.62, edge.z, 0.035, 1.0, 0.02, plain ? shade(bottoms, 0.2) : colours[1], { ry: edge.ry, rz: -0.05 });
    }
  } else if (skirt) {
    if (sitting) b.box(0, 1.03, 0.2, 0.52, 0.28, 0.7, bottoms);
    else {
      const rings = [[0.6, m.hip - 0.04], [0.88, m.hip + 0.002], [0.97, m.hip - 0.012]];
      loft(b, rings, bottoms, { seg: SEG, aspect: 0.78 });
      band(b, rings, 0.615, 0.03, shade(bottoms, -0.2), { seg: SEG, aspect: 0.78 });
    }
  }
  // Hips and seat
  loft(b, [[0.8, m.hip - 0.022], [0.9, m.hip - 0.004], [0.97, m.hip - 0.012]], style.gown ? wrapper[0] : bottoms, { seg: SEG, aspect: aspect + 0.02, capped: true });

  b.at(0, HIP_Y, 0, 0, () => {
    const body = torsoRings(m), wear = torsoRings(m, 0.016 + bulk), depthAt = (y) => radiusAt(wear, y) * aspect;
    // Skin under the neckline, then the garment over it
    loft(b, clip(body, 0.55, 0.79), skin, { seg: SEG, aspect });
    b.cyl(0, 0.87, 0, m.neck, 0.2, skin, { seg: 12, top: 0.92 });
    const hem = style.hood ? -0.16 : style.gown ? -0.1 : -0.13, neckline = style.open ? 0.72 : 0.755;
    const garment = clip(wear, hem, neckline);
    loft(b, garment, style.collar && !plain ? top : top, { seg: SEG, aspect });
    band(b, wear, hem + 0.02, 0.04, style.gown && !plain ? colours[2] : trim, { seg: SEG, aspect });
    if (!plain) print(b, look, colours, garment, { aspect, from: hem + 0.05, to: style.vest ? 0.1 : 0.7, around: 6, seg: SEG });
    const front = (y, a = 0, lift = 0.008) => onLoft(wear, aspect, y, a, lift);

    if (style.open) {
      // An unbuttoned shirt over a vest: the opening runs down the front between two plackets.
      strip(b, wear, hem + 0.03, 0.72, 0, 0.13, CLOTH_WHITE, { aspect, lift: 0.004 });
      for (const side of [-1, 1]) strip(b, wear, hem + 0.03, 0.72, side * 0.3, 0.026, trim, { aspect, lift: 0.008, thick: 0.014 });
      for (const side of [-1, 1]) b.box(side * 0.1, 0.735, depthAt(0.735) + 0.01, 0.13, 0.05, 0.02, top, { rz: side * 0.55, ry: side * 0.3 });
    } else if (style.collar) {
      // A blazer: lapels over a white shirt, with a tie for men, buttons, and a breast pocket.
      const tie = colours[2] === top ? shade(top, -0.5) : colours[1];
      const v = front(0.6, 0, 0.006);
      b.quad(0, 0.61, v.z, 0.2, 0.3, CLOTH_WHITE, { rx: -0.2 });
      for (const side of [-1, 1]) {
        b.box(side * 0.118, 0.585, v.z + 0.008, 0.14, 0.37, 0.014, shade(top, -0.16), { rz: side * -0.31, rx: -0.2 });
        b.box(side * 0.07, 0.775, depthAt(0.775) * 0.75, 0.1, 0.045, 0.03, CLOTH_WHITE, { rz: side * -0.5, ry: side * 0.5 });
      }
      b.cyl(0, 0.785, 0, m.neck + 0.022, 0.05, CLOTH_WHITE, { seg: 12, top: 0.95, open: true });
      if (!woman) {
        b.box(0, 0.7, v.z + 0.024, 0.06, 0.05, 0.02, tie);
        b.box(0, 0.57, v.z + 0.026, 0.05, 0.22, 0.012, tie, { rx: -0.2 });
      } else {
        b.ball(0, 0.69, depthAt(0.7) * 0.6 + 0.01, 0.02, 0.02, 0.012, GOLD, { seg: 6 });
      }
      for (const y of [0.34, 0.2]) { const p = front(y, 0, 0.01); b.cyl(0, y, p.z, 0.02, 0.01, shade(top, -0.5), { seg: 8, rx: Math.PI / 2 }); }
      const pocket = front(0.5, 0.62, 0.01);
      b.box(pocket.x, 0.5, pocket.z, 0.09, 0.014, 0.01, CLOTH_WHITE, { ry: pocket.ry });
    } else if (style.hood) {
      band(b, wear, hem + 0.045, 0.09, trim, { seg: SEG, aspect, lift: 0.008 }); // ribbed hem
      b.ball(0, 0.77, -0.15, 0.2, 0.16, 0.13, top, { seg: 12, rx: 0.5 }); // the hood, resting behind the neck
      b.cyl(0, 0.795, -0.012, m.neck + 0.075, 0.11, top, { seg: 14, top: 1.2, sz: 1.05, open: true });
      b.cyl(0, 0.85, -0.012, (m.neck + 0.075) * 1.2, 0.012, trim, { seg: 14, sz: 1.05, open: true });
      const pouch = front(0.14, 0, 0.012);
      b.box(0, 0.15, pouch.z, 0.34, 0.19, 0.03, shade(top, -0.1));
      for (const side of [-1, 1]) {
        b.box(side * 0.165, 0.15, pouch.z + 0.006, 0.014, 0.15, 0.03, shade(top, -0.32), { rz: side * -0.35 });
        const cord = front(0.6, side * 0.22, 0.012);
        b.cyl(cord.x, 0.6, cord.z, 0.009, 0.2, CLOTH_WHITE, { seg: 5, rx: -0.12 });
        b.ball(cord.x, 0.495, cord.z + 0.012, 0.014, 0.02, 0.014, CLOTH_WHITE, { seg: 6 });
      }
    } else if (style.gown) {
      // Buba: an embroidered round neckline, a coral necklace and an ipele over the shoulder.
      band(b, wear, neckline - 0.02, 0.04, GOLD, { seg: SEG, aspect, lift: 0.006 });
      for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; b.ball(Math.sin(a) * (m.neck + 0.05), 0.79 - Math.cos(a) * 0.035 - 0.02, Math.cos(a) * (m.neck + 0.05) * 0.95 + 0.01, 0.022, 0.022, 0.022, '#d8452c', { seg: 6 }); }
      const sash = plain ? shade(top, 0.3) : colours[1];
      for (const face of [0.62, Math.PI - 0.62]) strip(b, wear, 0.2, 0.7, face, 0.12, sash, { aspect, lift: 0.012, thick: 0.022 });
      b.box(m.shoulder * 0.52, 0.735, 0, 0.12, 0.03, radiusAt(wear, 0.7) * aspect * 1.75, sash, { rz: -0.3 });
    } else {
      // A crew-neck tee: ribbed collar and a chest pocket.
      band(b, wear, neckline - 0.014, 0.03, trim, { seg: SEG, aspect, lift: 0.006 });
      if (!style.vest) { const p = front(0.5, 0.6, 0.008); b.box(p.x, 0.5, p.z, 0.095, 0.1, 0.008, shade(top, -0.12), { ry: p.ry }); }
    }
    if (style.vest) {
      // Hi-vis vest: reflective bands round the body and over both shoulders.
      const vest = torsoRings(m, 0.04), body2 = clip(vest, 0.04, 0.72), reflect = '#eef0b4';
      loft(b, body2, '#f47f1b', { seg: SEG, aspect });
      for (const y of [0.16, 0.38]) band(b, vest, y, 0.06, reflect, { seg: SEG, aspect });
      for (const side of [-1, 1]) for (const face of [0, Math.PI]) strip(b, vest, 0.41, 0.7, face + side * 0.5, 0.055, reflect, { aspect });
      strip(b, vest, 0.05, 0.7, 0, 0.02, '#c9650f', { aspect, lift: 0.004 }); // zip
    }
    b.cyl(0, hem + 0.03, 0, radiusAt(wear, hem + 0.03) - 0.006, 0.03, style.gown ? wrapper[0] : bottoms, { seg: SEG, sz: aspect }); // closes the hem, so nobody sees up into the top
    if (!style.gown && !style.hood && !skirt) {
      // Waistband or belt, where the top meets the bottoms
      const belt = style.collar ? '#2a2320' : shade(bottoms, -0.22);
      band(b, body, hem - 0.03, 0.04, belt, { seg: SEG, aspect, lift: 0.012 });
      if (style.collar && !woman) b.box(0, hem - 0.03, (radiusAt(body, hem - 0.03) + 0.012) * aspect + 0.004, 0.05, 0.036, 0.012, GOLD);
    }

    b.at(0, -HIP_Y, 0, 0, () => {
      headHigh(b, look, woman);
      const hair = style.helmet && !HANGING.has(look.hair) ? 'lowcut' : look.hair;
      (HAIR_HIGH[hair] || HAIR_HIGH.lowcut)(b, look.hairColor, look, colours);
      if (woman && (style.gown || look.hair === 'gele' || look.hair === 'bun')) for (const side of [-1, 1]) b.ball(side * 0.262, 2.1, 0, 0.026, 0.04, 0.026, GOLD, { seg: 8 }); // earrings
      if (style.helmet) {
        const hat = '#f2c230';
        b.ball(0, 2.39, -0.01, 0.3, 0.23, 0.31, hat, { seg: 16 });
        b.cyl(0, 2.36, 0.03, 0.34, 0.03, hat, { seg: 16, sz: 1.12 });
        b.box(0, 2.6, -0.01, 0.07, 0.05, 0.5, shade(hat, -0.12));
        b.cyl(0, 2.39, -0.01, 0.303, 0.035, shade(hat, -0.14), { seg: 16, sz: 1.03, open: true });
      }
      markerOf(b, marker);
    });

    // Arms
    for (const side of [0, 1]) {
      const dir = side ? 1 : -1, [pitch, roll] = joints.arm[side];
      const wide = style.sleeve === 'wide', long = style.sleeve === 'long', pad = 0.016 + bulk * 0.35;
      const sleeve = wide && !plain ? colours[1] : top, r = m.arm;
      const R = r + pad + 0.012, cap = () => b.ball(0, 0, 0, R, R * 0.9, R, wide ? sleeve : top, { seg: 12 });
      const sleeveRings = [[-0.42, r + pad], [0, R]];
      limb(b, true, dir * (m.shoulder - 0.004 + bulk), SHOULDER_Y, 0, pitch, dir * roll,
        wide ? { length: 0.42, r0: R, r1: r + 0.1, colour: sleeve, joint: skin, jointR: r, extra: () => {
          cap();
          b.cyl(0, -0.405, 0, r + 0.103, 0.04, plain ? GOLD : colours[2], { seg: 10, open: true });
          b.cyl(0, -0.418, 0, r + 0.096, 0.004, shade(sleeve, -0.45), { seg: 10 });
        } }
          : long ? { length: 0.42, r0: R, r1: r + pad, colour: top, extra: () => { cap(); if (!plain) print(b, look, colours, sleeveRings, { from: -0.4, to: -0.04, size: 0.62, around: 3, seg: 10 }); } }
            : { length: 0.42, r0: r + 0.01, r1: r, colour: skin, extra: () => {
              cap();
              b.cyl(0, -0.105, 0, R, 0.21, top, { seg: 10, open: true });
              b.cyl(0, -0.2, 0, r + pad + 0.016, 0.03, trim, { seg: 10, open: true });
              b.cyl(0, -0.212, 0, r + pad + 0.01, 0.004, shade(top, -0.5), { seg: 10 });
              if (!plain) print(b, look, colours, [[-0.2, r + pad + 0.012], [0, r + pad + 0.012]], { from: -0.19, to: -0.02, size: 0.6, around: 3, seg: 10 });
            } },
        joints.fore[side],
        long ? { length: 0.38, r0: r + pad - 0.004, r1: r + pad - 0.014, colour: top, extra: () => b.cyl(0, -0.355, 0, r + pad - 0.008, 0.05, style.collar ? CLOTH_WHITE : trim, { seg: 10, open: true }) }
          : { length: 0.38, r0: r * 0.95, r1: r * 0.74, colour: skin, extra: style.vest ? () => b.cyl(0, -0.3, 0, r * 0.8 + 0.006, 0.035, INK, { seg: 10, open: true }) : null },
        (end) => {
          b.ball(0, end - 0.07, 0, r * 0.62, 0.088, r * 0.84, skin, { seg: 10 });
          b.ball(dir * -0.01, end - 0.055, r * 0.78, 0.022, 0.045, 0.024, skin, { seg: 6, rx: 0.3 });
        });
    }
  }, joints.lean);
}

/**
 * Draw one avatar into a batch.
 * options: { x, y, z, ry, pose ('stand' | 'sit' | 'walk' | 'wave' | 'work' | 'dance'), seat (seat
 * height when sitting), seed, scale, marker ('crown' = you, 'npc' = green dot, 'player' = blue dot),
 * detail ('low' — the default, at most 600 triangles, for scenes and crowds; 'high' — a few
 * thousand, with a face, hands, shoes, garment detail and printed fabric, for the character preview) }
 * Returns { look, top } where top is the height just above the head, for a name tag.
 */
export function drawAvatar(b, input, { x = 0, y = 0, z = 0, ry = 0, pose = 'stand', seat = 0.6, seed, scale = 1, marker = null, detail = 'low' } = {}) {
  const look = normalizeLook(input, seed);
  const joints = POSE[pose] || POSE.stand, sitting = pose === 'sit';
  const lift = sitting ? seat + 0.13 - 1.05 : 0;
  b.at(x, y + lift * scale, z, ry, () => (detail === 'high' ? drawHigh : drawLow)(b, look, { joints, sitting, marker }), 0, 0, scale);
  return { look, top: y + (lift + 2.95) * scale };
}

/** One avatar as its own THREE.Group. Call group.userData.dispose() (or dispose the kit) to free it. */
export function buildAvatar(kit, look, options = {}) {
  const { THREE } = kit;
  const { x = 0, y = 0, z = 0, ry = 0, ...rest } = options;
  const batch = createBatch(THREE);
  const drawn = drawAvatar(batch, look, rest);
  const built = batch.build(sceneMaterials(kit));
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = ry;
  built.meshes.forEach((mesh) => group.add(mesh));
  const registry = kitResources(kit).disposers;
  const dispose = () => { registry.delete(dispose); releaseObjects(built.meshes); group.parent?.remove(group); };
  registry.add(dispose);
  group.userData = { look: drawn.look, top: drawn.top, triangles: built.triangles, dispose };
  return group;
}

/** Name-tag record for the DOM layer. `position` is in the scene's own coordinates. */
function tagFor(person, index, top) {
  const kind = person.kind === 'npc' || person.kind === 'self' ? person.kind : 'player';
  const name = String(person.name ?? person.id ?? '');
  return {
    id: String(person.id ?? `person-${index}`),
    name,
    kind,
    text: kind === 'player' ? `@${name}` : name,
    marker: kind === 'npc' ? 'dot' : kind === 'self' ? 'crown' : 'tag',
    colour: kind === 'npc' ? '#58d68a' : kind === 'self' ? '#ffd34d' : '#6fb4ff',
    position: { x: person.x || 0, y: top, z: person.z || 0 },
  };
}

/** Draw people into an existing batch; returns their name tags. */
export function drawCrowd(b, people = []) {
  return people.map((person, index) => {
    const kind = person.kind === 'npc' ? 'npc' : person.kind === 'self' ? 'crown' : 'player';
    const drawn = drawAvatar(b, person.look, {
      x: person.x || 0, y: person.y || 0, z: person.z || 0, ry: person.ry || 0, pose: person.pose, seat: person.seat,
      seed: person.seed ?? person.id ?? person.name ?? index, marker: person.marker === undefined ? kind : person.marker,
    });
    return tagFor(person, index, drawn.top);
  });
}

/**
 * A small crowd of other players and NPCs, merged into at most two meshes.
 * people: [{ id, name, kind: 'player' | 'npc', look?, seed?, x, z, y?, ry?, pose?, seat? }]
 * Returns { group, tags, triangles, dispose }. tags: [{ id, name, kind, text ('@name' for
 * players), marker ('tag' | 'dot' | 'crown'), colour, position: { x, y, z } }] — the host
 * projects `position` through its camera and draws the label in the DOM.
 */
export function buildCrowd(kit, people = []) {
  const { THREE } = kit;
  const batch = createBatch(THREE);
  const tags = drawCrowd(batch, people);
  const built = batch.build(sceneMaterials(kit));
  const group = new THREE.Group();
  built.meshes.forEach((mesh) => group.add(mesh));
  const registry = kitResources(kit).disposers;
  const dispose = () => { registry.delete(dispose); releaseObjects(built.meshes); group.parent?.remove(group); };
  registry.add(dispose);
  return { group, tags, triangles: built.triangles, dispose };
}

/** Colours for the original kit-based person(): kept for callers that still use it. */
export function appearanceToLook(appearance, seed) {
  const look = normalizeLook(appearance, seed);
  return { shirt: look.outfitColor, pants: look.bottomsColor, skin: look.skin, hair: look.hairColor };
}

/** person(kit, parent, x, z, shirtColour, trouserColour, { seated, rotation, skin, hair, y, gesture }) → THREE.Group (original kit-based figure) */
export function person(kit, parent, x, z, shirt, pants, { seated = false, rotation = 0, skin = '#986345', hair = '#211d1c', y = 0, gesture = false } = {}) {
  const { THREE, box, round, sphere, mesh, sphereGeometry } = kit;
  const person = new THREE.Group();
  person.position.set(x, y, z);
  person.rotation.y = rotation;
  parent.add(person);
  const body = new THREE.Group();
  person.add(body);
  box(0, 1.47, 0, 0.6, 0.72, 0.34, shirt, body);
  round(0, 1.94, 0, 0.1, 0.2, skin, body);
  sphere(0, 2.2, 0, 0.26, skin, body);
  mesh(sphereGeometry, 0, 2.34, -0.025, 0.28, 0.19, 0.27, hair, body);
  box(0, 1.04, 0, 0.5, 0.24, 0.3, pants, body);
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.38, 1.78, 0);
    arm.rotation.z = side * -0.12;
    body.add(arm);
    round(0, -0.21, 0, 0.105, 0.43, shirt, arm);
    const forearm = new THREE.Group();
    forearm.position.y = -0.43;
    forearm.rotation.x = seated ? -0.9 : gesture && side === 1 ? -1.2 : -0.14;
    arm.add(forearm);
    round(0, -0.19, 0, 0.078, 0.38, skin, forearm);
    sphere(0, -0.4, 0, 0.085, skin, forearm);
    const leg = new THREE.Group();
    leg.position.set(side * 0.17, 1.02, 0);
    leg.rotation.x = seated ? -Math.PI / 2 : side * 0.035;
    body.add(leg);
    round(0, -0.24, 0, 0.115, 0.49, pants, leg);
    const calf = new THREE.Group();
    calf.position.y = -0.49;
    calf.rotation.x = seated ? Math.PI / 2 : 0;
    leg.add(calf);
    round(0, -0.23, 0, 0.095, 0.46, pants, calf);
    box(0, -0.47, 0.08, 0.24, 0.14, 0.43, '#252c32', calf);
  }
  if (seated) body.position.y = -0.85;
  return person;
}
