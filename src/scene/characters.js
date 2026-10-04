/**
 * OWNER: scenes
 * Procedural people.
 *
 *   normalizeLook(look, seed)            → a complete look; anything missing or unknown is chosen
 *                                          deterministically from `seed` (e.g. a public player id)
 *   drawAvatar(batch, look, options)     → draws one avatar into a geometry batch (build.js).
 *                                          options.detail (per avatar, so one batch may mix them):
 *                                            'low'    default; crowds and scenes, at most 600 triangles
 *                                            'medium' the same model as 'high' with fewer segments and
 *                                                     without the smallest parts, about 2,000 triangles —
 *                                                     for the player's own avatar in a scene
 *                                            'high'   the character preview: a full model with a face,
 *                                                     hands, shoes, layered garments and printed fabric
 *   buildAvatar(kit, look, options)      → THREE.Group holding one avatar (one or two meshes); with
 *                                          `rig: true` it is built as movable parts
 *                                          (userData.parts) that poseAvatar() turns
 *   poseAvatar(avatar, { pose, stride }) → poses a rigged avatar by rotating its parts: no rebuild
 *   buildCrowd(kit, people, options)     → { group, tags, triangles, dispose } — every person in
 *                                          one merged mesh, with name-tag data for the DOM
 *
 * A look is `{ body, hair, outfit, fabric, skin, hairColor, outfitColor, bottomsColor }` plus the
 * optional `accessories` (a list), `face` and `expression` (state.onboarding.look). Option ids are
 * listed in LOOK_OPTIONS; matching ignores case, spaces and punctuation ('Low cut' = 'lowcut').
 * Colours may be a swatch id, a swatch index or '#rrggbb'; the game's own skin ids ('skin-1' …
 * 'skin-7', content/traits.js) are understood too.
 *
 * WALKING. `pose: 'walk'` or `'jog'` with `stride` (0 … 1, one full cycle; it wraps) gives every
 * frame of the cycle at every detail level: 0 and 0.5 are the passing positions, 0.25 and 0.75
 * the two contacts, with opposite arm swing, a slight lean and a bob. A scene can either redraw
 * with a new stride, or — cheaper — build its player once with buildAvatar(kit, look, { rig:
 * true, detail: 'medium' }) and call poseAvatar(avatar, { pose: 'walk', stride }) per step, which
 * only rotates transforms.
 *
 * Nothing here animates by itself: a pose is chosen when the avatar is drawn or posed (POSES).
 * Rules for everything under src/scene/: procedural geometry only, no downloaded models or
 * textures, no animation loops — the host (src/venue-world.js) draws on demand.
 */
import { createBatch, sceneMaterials, kitResources, releaseObjects, hash, GLOW } from './build.js';

const swatches = (entries) => entries.map(([id, hex]) => ({ id, hex }));
export const LOOK_OPTIONS = Object.freeze({
  body: ['woman', 'man'],
  hair: {
    woman: ['braids', 'afro', 'bun', 'ponytail', 'long', 'locs', 'lowcut', 'gele', 'classic', 'cornrows', 'twists', 'bantuknots'],
    man: ['lowcut', 'bald', 'curls', 'afro', 'locs', 'braids', 'classic', 'fade', 'cornrows', 'twists'],
  },
  outfit: {
    woman: ['casual', 'office', 'owambe', 'sitework', 'jersey', 'kaftan', 'gown'],
    man: ['casual', 'hoodie', 'office', 'chill', 'sitework', 'jersey', 'kaftan', 'agbada'],
  },
  fabric: ['plain', 'ankara', 'adire', 'asooke'],
  accessories: ['glasses', 'sunglasses', 'cap', 'headwrap', 'fila', 'earrings', 'chain', 'watch', 'beads', 'backpack', 'handbag'],
  face: ['oval', 'round', 'long'],
  expression: ['smile', 'neutral', 'grin'],
  skin: swatches([['sand', '#c68a5e'], ['honey', '#b0764d'], ['bronze', '#9a6341'], ['chestnut', '#845236'], ['cocoa', '#6e422c'], ['umber', '#573323'], ['ebony', '#40261b']]),
  hairColor: swatches([['black', '#1c1917'], ['softblack', '#2b2320'], ['darkbrown', '#3d2a1f'], ['brown', '#5a3a26'], ['auburn', '#8a3b22'], ['blonde', '#d2a857'], ['purple', '#7a4bb0']]),
  outfitColor: swatches([['blue', '#3f72c4'], ['green', '#3f9a5a'], ['red', '#c9423a'], ['orange', '#e0822f'], ['violet', '#8055c2'], ['pink', '#dd6fa0'], ['teal', '#2f9d98'], ['navy', '#243a66'], ['cream', '#ece2c6'], ['gold', '#d6a83a']]),
});
/** Accessories that share a slot replace each other: only the first of a slot is drawn. */
export const ACCESSORY_SLOTS = Object.freeze({ glasses: 'eyes', sunglasses: 'eyes', cap: 'head', headwrap: 'head', fila: 'head', earrings: 'ears', chain: 'neck', watch: 'wrist', beads: 'hand', backpack: 'carry', handbag: 'carry' });
export const POSES = Object.freeze(['stand', 'sit', 'walk', 'wave', 'work', 'dance', 'relax', 'jog']);
/** The limbs and body sections of a rigged avatar (buildAvatar with `rig: true`). */
export const PARTS = Object.freeze(['torso', 'head', 'armL', 'armR', 'legL', 'legR']);
export const DETAILS = Object.freeze(['low', 'medium', 'high']);
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
/** Known accessories, one per slot, in the order given. */
function pickAccessories(value) {
  const slots = new Set(), out = [];
  for (const item of Array.isArray(value) ? value : []) {
    const id = key(item), slot = ACCESSORY_SLOTS[id];
    if (!slot || slots.has(slot)) continue;
    slots.add(slot); out.push(id);
  }
  return out;
}
// What a passer-by with no recorded look may carry (most carry nothing).
const SEEDED_ACCESSORIES = [[], [], [], ['glasses'], ['cap'], [], ['backpack'], ['watch'], [], ['sunglasses'], ['handbag'], []];

/** Fill in a look. The same input and seed always give the same result. */
export function normalizeLook(look, seed) {
  const source = look && typeof look === 'object' ? look : {};
  const recorded = Object.keys(source).length > 0;
  const base = seed ?? source.seed ?? source.id ?? 'joinallworld';
  const pick = (part) => hash(`${base}:${part}`);
  const body = pickOption(source.body ?? source.gender, LOOK_OPTIONS.body, pick('body'));
  const outfitColor = pickColour(source.outfitColor, LOOK_OPTIONS.outfitColor, pick('outfitColor'));
  let bottomsSeed = pick('bottomsColor');
  if (LOOK_OPTIONS.outfitColor[bottomsSeed % 10].hex === outfitColor) bottomsSeed += 7;
  // Seeded fallbacks rarely pick site work, so a crowd is not a sea of hard hats.
  const outfits = LOOK_OPTIONS.outfit[body], everyday = outfits.filter((id) => id !== 'sitework');
  const outfitSeed = outfits.indexOf(pick('outfit') % 9 === 0 ? 'sitework' : everyday[pick('outfit') % everyday.length]);
  return {
    body,
    hair: pickOption(source.hair ?? source.hairstyle, LOOK_OPTIONS.hair[body], pick('hair')),
    outfit: pickOption(source.outfit, outfits, outfitSeed),
    fabric: pickOption(source.fabric, LOOK_OPTIONS.fabric, source.fabric == null && pick('fabric') % 2 ? 0 : pick('fabric')),
    skin: pickColour(source.skin ?? source.skinTone, LOOK_OPTIONS.skin, pick('skin')),
    hairColor: pickColour(source.hairColor, LOOK_OPTIONS.hairColor, pick('hairColor') % 4),
    outfitColor,
    bottomsColor: pickColour(source.bottomsColor, LOOK_OPTIONS.outfitColor, bottomsSeed),
    // A recorded look wears exactly what it lists (nothing, if it lists nothing).
    accessories: pickAccessories(recorded ? source.accessories : SEEDED_ACCESSORIES[pick('accessories') % SEEDED_ACCESSORIES.length]),
    face: pickOption(source.face, LOOK_OPTIONS.face, recorded ? 0 : pick('face')),
    expression: pickOption(source.expression, LOOK_OPTIONS.expression, 0),
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
  // At ease: weight on one leg, the other knee soft, arms a little away from the body and bent.
  relax: { arm: [[0.1, 0.17], [-0.04, 0.15]], fore: [-0.36, -0.26], leg: [0.015, -0.075], calf: [0, 0.13], lean: 0.01 },
};

// What each outfit is made of. sleeve: short | long | wide | cap. legs: trousers | shorts | skirt |
// wrapper | dress. `hem` is where the top ends, measured from the hips; `bulk` pads the torso.
/**
 * A walk or jog cycle. `stride` is the phase, 0 … 1 for one full cycle (it wraps): 0 and 0.5 are
 * the passing positions (legs together, body at its highest), 0.25 and 0.75 the two contacts
 * (right foot forward, then left; body at its lowest). Arms swing opposite to the legs, the
 * swinging leg's knee bends, the torso leans a little and `bob` moves the body up and down.
 */
function gait(stride, jog) {
  const p = (Number.isFinite(stride) ? stride : 0.25) * TAU, swing = Math.sin(p);
  const reach = jog ? 0.78 : 0.5, knee = jog ? 1.25 : 0.62, elbow = jog ? -1.35 : -0.35;
  // Index 0 is the right side. A leg's knee bends while that leg is travelling forwards.
  const leg = [-reach * swing, reach * swing];
  const calf = [(jog ? 0.3 : 0.08) + knee * Math.max(0, Math.cos(p)), (jog ? 0.3 : 0.08) + knee * Math.max(0, -Math.cos(p))];
  const arm = [[reach * 0.9 * swing, 0.1], [-reach * 0.9 * swing, 0.1]];
  return { arm, fore: [elbow - 0.15 * Math.max(0, -swing), elbow - 0.15 * Math.max(0, swing)], leg, calf, lean: jog ? 0.17 : 0.06, bob: (jog ? 0.045 : 0.02) * Math.cos(2 * p) };
}
/** Joint angles for a pose (an unknown pose stands). 'walk' and 'jog' take `stride`; 'walk' without one is the classic mid-stride figure. */
function jointsOf(pose, stride) {
  if (pose === 'jog' || (pose === 'walk' && Number.isFinite(stride))) return gait(stride, pose === 'jog');
  return POSE[pose] || POSE.stand;
}
/** Draw `fn` in a frame at (x, y, z) turned by rx, rz. On a rig this is a separate, movable part with its pivot there. */
function part(b, name, x, y, z, fn, rx = 0, rz = 0) {
  if (b.part) b.part(name, x, y, z, fn, rx, rz);
  else b.at(x, y, z, 0, fn, rx, rz);
}

const OUTFIT = {
  casual: { sleeve: 'short', legs: 'trousers', shoe: 'sneaker', hem: -0.13 },
  office: { sleeve: 'long', legs: 'trousers', shoe: 'dress', hem: -0.13, collar: true },
  owambe: { sleeve: 'wide', legs: 'wrapper', shoe: 'heel', hem: -0.1, gown: true },
  sitework: { sleeve: 'short', legs: 'trousers', shoe: 'boot', hem: -0.13, vest: true, helmet: true },
  hoodie: { sleeve: 'long', legs: 'trousers', shoe: 'sneaker', hem: -0.16, hood: true, bulk: 0.03 },
  chill: { sleeve: 'short', legs: 'shorts', shoe: 'slide', hem: -0.13, open: true },
  jersey: { sleeve: 'short', legs: 'shorts', shoe: 'sneaker', hem: -0.15, sport: true, socks: true },
  kaftan: { sleeve: 'long', legs: 'trousers', shoe: 'dress', hem: -0.52, tunic: true },
  agbada: { sleeve: 'long', legs: 'trousers', shoe: 'dress', hem: -0.2, robe: true },
  gown: { sleeve: 'cap', legs: 'dress', shoe: 'heel', hem: -0.1, dress: true },
};
// [upper, sole] colours.
const SHOES = { sneaker: ['#2c3340', '#f1efe9'], dress: ['#1f1c1c', '#141212'], heel: ['#c9a13a', '#a8842a'], boot: ['#8a6a3c', '#2b2622'], slide: ['#3a342e', '#d9cfb8'] };

// Body measurements. Radii are half-widths; depth = radius × aspect. Torso heights are measured
// from the hips (1.06 above the feet), where the upper body leans from.
const BODY = {
  woman: { hip: 0.252, waist: 0.172, chest: 0.222, shoulder: 0.232, aspect: 0.7, arm: 0.07, elbow: 0.058, wrist: 0.044, leg: 0.108, knee: 0.08, calf: 0.078, ankle: 0.05, neck: 0.066, legX: 0.116 },
  man: { hip: 0.236, waist: 0.222, chest: 0.292, shoulder: 0.312, aspect: 0.6, arm: 0.09, elbow: 0.074, wrist: 0.054, leg: 0.104, knee: 0.086, calf: 0.086, ankle: 0.056, neck: 0.088, legX: 0.112 },
};
const HIP_Y = 1.06, SHOULDER_Y = 0.672;
const HEAD = { y: 2.2, rx: 0.25, ry: 0.28, rz: 0.255 };
const CLOTH_WHITE = '#f3f0e8', INK = '#1f1a1a', GOLD = '#d9b048', CORAL = '#d8452c';
const TAU = Math.PI * 2;

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
// A garment, a torso or a limb is a stack of tapered elliptical rings: [[y, radius], …] from the bottom up.

/** Rings through `keys` with `per` steps between each pair, rounded with a Catmull-Rom curve. */
function smooth(keys, per = 3) {
  if (per <= 1) return keys.map((ring) => [...ring]);
  const out = [];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[Math.max(0, i - 1)][1], b = keys[i][1], c = keys[i + 1][1], d = keys[Math.min(keys.length - 1, i + 2)][1];
    for (let s = 0; s < per; s++) {
      const t = s / per, t2 = t * t, t3 = t2 * t;
      out.push([keys[i][0] + (keys[i + 1][0] - keys[i][0]) * t, 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3)]);
    }
  }
  out.push([...keys[keys.length - 1]]);
  return out;
}
const torsoKeys = (m) => [[-0.14, m.hip * 0.93], [-0.02, m.hip], [0.25, m.waist], [0.5, m.chest], [0.655, m.shoulder], [0.725, m.shoulder * 0.8], [0.775, m.shoulder * 0.5], [0.8, m.neck + 0.022]];
const padded = (rings, pad) => rings.map(([y, r]) => [y, r + pad]);
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
    if (y1 - y0 < 1e-5) continue;
    b.cyl(0, (y0 + y1) / 2, z, r0, y1 - y0, Array.isArray(colour) ? colour[i % colour.length] : colour, { seg, top: q3(r1 / r0), sz: aspect, open: !capped });
  }
}
/** A ring of trim lying on a loft at height y: follows the loft's taper, so it never cuts through it. */
function band(b, rings, y, height, colour, { seg = 12, aspect = 1, z = 0, lift = 0.005 } = {}) {
  const r0 = radiusAt(rings, y - height / 2) + lift, r1 = radiusAt(rings, y + height / 2) + lift;
  b.cyl(0, y, z, r0, height, colour, { seg, top: q3(r1 / r0), sz: aspect, open: true });
}
/** A point on a loft's surface at height y and angle a (0 = front), `lift` outside it, with the turn that faces outwards. */
function onLoft(rings, aspect, y, a, lift = 0, z = 0) {
  const r = radiusAt(rings, y) + lift;
  return { x: Math.sin(a) * r, y, z: z + Math.cos(a) * r * aspect, ry: Math.atan2(aspect * Math.sin(a), Math.cos(a)) };
}
/** A strip of cloth running up a loft at angle a (0 = front), following its taper. */
function strip(b, rings, from, to, a, width, colour, { aspect = 1, lift = 0.005, thick = 0.01 } = {}) {
  const cut = clip(rings, from, to), reach = Math.hypot(Math.sin(a), aspect * Math.cos(a));
  for (let i = 0; i < cut.length - 1; i++) {
    const [y0, r0] = cut[i], [y1, r1] = cut[i + 1], mid = (y0 + y1) / 2, p = onLoft(cut, aspect, mid, a, lift);
    b.box(p.x, mid, p.z, width, Math.hypot(y1 - y0, (r1 - r0) * reach) + 0.004, thick, colour, { ry: p.ry, rx: Math.atan2((r1 - r0) * reach, y1 - y0) });
  }
}
/** A tapered rod from A to B (points [x, y, z]): fingers, strands of hair, straps, frames. */
function stick(b, A, B, rA, rB, colour, seg = 6) {
  const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], length = Math.hypot(dx, dy, dz) || 1e-6;
  b.cyl((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2, rA, length, colour, { seg, top: q3(rB / rA), rx: Math.acos(Math.max(-1, Math.min(1, dy / length))), ry: Math.atan2(dx, dz) });
}
/** Rods through a list of points, tapering from r0 to r1. */
function chain(b, points, r0, r1, colour, seg = 6) {
  for (let i = 0; i < points.length - 1; i++) {
    const t0 = i / (points.length - 1), t1 = (i + 1) / (points.length - 1);
    stick(b, points[i], points[i + 1], r0 + (r1 - r0) * t0, r0 + (r1 - r0) * t1, colour, seg);
  }
}
/** A strap across a loft from [y, angle] to [y, angle], lying on its surface. */
function sling(b, rings, aspect, from, to, radius, colour, steps = 7, lift = 0.012) {
  const points = Array.from({ length: steps + 1 }, (_, i) => { const t = i / steps, p = onLoft(rings, aspect, from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, lift); return [p.x, p.y, p.z]; });
  chain(b, points, radius, radius, colour, 5);
}

/**
 * Fabric print laid over a lofted garment. Ankara: rows of wax-print medallions (a disc, a ring
 * and a centre) with small diamonds between them; adire: indigo resist — fine pale double lines
 * and rows of ringed dots; aso-oke: narrow woven stripes with a bright thread between them.
 */
function print(b, look, colours, rings, { aspect = 1, z = 0, from = rings[0][0], to = rings[rings.length - 1][0], size = 1, around = 8, seg = 14 } = {}) {
  const [main, second, third] = colours;
  const flat = (p, y, r, colour, sides, lift) => { const q = onLoft(rings, aspect, y, p, lift, z); b.cyl(q.x, y, q.z, r, 0.004, colour, { seg: sides, rx: Math.PI / 2, ry: q.ry }); };
  const diamond = (a, y, s, colour, lift) => { const q = onLoft(rings, aspect, y, a, lift, z); b.quad(q.x, y, q.z, s, s, colour, { ry: q.ry, rz: Math.PI / 4 }); };
  if (look.fabric === 'ankara') {
    const step = 0.15 * size;
    for (let y = from + step * 0.5, row = 0; y < to - step * 0.3; y += step, row++) {
      for (let i = 0; i < around; i++) {
        const a = (i + (row % 2) * 0.5) / around * TAU, swap = (i + row) % 2;
        flat(a, y, 0.054 * size, swap ? third : second, 8, 0.003);
        flat(a, y, 0.034 * size, swap ? second : third, 6, 0.006);
        diamond(a, y, 0.026 * size, main, 0.01);
        diamond(a + Math.PI / around, y + step * 0.02, 0.03 * size, swap ? second : third, 0.004);
      }
    }
  } else if (look.fabric === 'adire') {
    const step = 0.17 * size;
    for (let y = from + step * 0.35, row = 0; y < to - 0.02; y += step, row++) {
      band(b, rings, y - 0.012 * size, 0.008 * size, second, { seg, aspect, z });
      band(b, rings, y + 0.012 * size, 0.008 * size, second, { seg, aspect, z });
      const dotY = y + step / 2;
      if (dotY > to - 0.03) break;
      const dots = Math.round(around * 1.5);
      for (let i = 0; i < dots; i++) {
        const a = (i + (row % 2) * 0.5) / dots * TAU;
        if (i % 2) { flat(a, dotY, 0.026 * size, second, 8, 0.004); flat(a, dotY, 0.014 * size, third, 6, 0.007); }
        else diamond(a, dotY, 0.03 * size, second, 0.005);
      }
    }
  } else if (look.fabric === 'asooke') {
    const stripes = around * 3, cut = clip(rings, from, to);
    for (let k = 0; k < cut.length - 1; k++) {
      const [y0, r0] = cut[k], [y1, r1] = cut[k + 1];
      for (let i = 0; i < stripes; i++) {
        const a = (i + 0.5) / stripes * TAU, reach = Math.hypot(Math.sin(a), aspect * Math.cos(a)), kind = i % 3;
        const p = onLoft(cut, aspect, (y0 + y1) / 2, a, 0.004, z);
        b.box(p.x, (y0 + y1) / 2, p.z, (kind === 0 ? 0.034 : kind === 1 ? 0.008 : 0.018) * size, Math.hypot(y1 - y0, (r1 - r0) * reach) + 0.004, 0.008, kind === 0 ? third : kind === 1 ? second : shade(second, -0.25), { ry: p.ry, rx: Math.atan2((r1 - r0) * reach, y1 - y0) });
      }
    }
  }
}
/** Coarse fabric for the cheaper levels: the garment's own rings take the fabric's colours. */
const weave = (look, colours) => ({ ankara: [colours[0], colours[1], colours[0], colours[2]], adire: [colours[0], colours[0], colours[1], colours[0]], asooke: [colours[0], colours[2]] }[look.fabric] || colours[0]);

// ---- Low detail (crowds, venue and home scenes): at most 600 triangles --------------------------

const LOW_BUDGET = 600;
function headLow(b, look) {
  b.ball(0, HEAD.y, 0, 0.26, 0.27, 0.26, look.skin, { seg: 8 });
  for (const side of [-1, 1]) b.quad(side * 0.095, 2.215, 0.249, 0.055, 0.065, INK, { ry: side * 0.3 });
  b.quad(0, 2.07, 0.238, 0.11, 0.026, mix(look.skin, '#4a1d1a', 0.55), { rx: 0.25 });
}
const capLow = (b, c) => b.ball(0, 2.32, -0.03, 0.275, 0.19, 0.27, c, { seg: 7 });
const HAIR_LOW = {
  bald() {},
  lowcut(b, c) { b.ball(0, 2.31, -0.02, 0.273, 0.2, 0.27, c, { seg: 7 }); },
  fade(b, c, look) {
    b.ball(0, 2.27, -0.03, 0.266, 0.17, 0.264, mix(c, look.skin, 0.55), { seg: 6 });
    b.ball(0, 2.39, -0.01, 0.23, 0.13, 0.235, c, { seg: 6 });
  },
  classic(b, c, look) {
    b.ball(0, 2.33, -0.03, 0.285, 0.2, 0.275, c, { seg: 7 });
    if (look.body === 'woman') b.ball(0, 2.13, -0.11, 0.32, 0.32, 0.24, c, { seg: 7 });
    else b.ball(0.07, 2.46, 0.08, 0.17, 0.08, 0.14, c, { seg: 6 });
  },
  afro(b, c) { b.ball(0, 2.46, -0.09, 0.42, 0.37, 0.39, c, { seg: 8 }); },
  curls(b, c) {
    capLow(b, c);
    for (let i = 0; i < 5; i++) b.ico(Math.sin(i * 1.26) * 0.18, 2.48 + (i % 2) * 0.04, Math.cos(i * 1.26) * 0.16 - 0.05, 0.12, 0.11, 0.12, c);
  },
  bun(b, c) { capLow(b, c); b.ball(0, 2.6, -0.12, 0.16, 0.15, 0.16, c, { seg: 6 }); },
  ponytail(b, c) {
    capLow(b, c);
    b.ball(0, 2.42, -0.3, 0.1, 0.1, 0.1, c, { seg: 5 });
    b.ball(0, 2.08, -0.42, 0.1, 0.34, 0.1, c, { seg: 5, rx: 0.3 });
  },
  long(b, c) {
    b.ball(0, 2.33, -0.03, 0.285, 0.2, 0.28, c, { seg: 7 });
    b.box(0, 1.86, -0.22, 0.52, 0.8, 0.12, c);
    for (const side of [-1, 1]) b.box(side * 0.265, 2.02, -0.06, 0.09, 0.46, 0.2, c);
  },
  braids(b, c) {
    capLow(b, c);
    for (let i = 0; i < 5; i++) {
      const turn = (i - 2) * 0.6, length = 0.62 + (i % 2) * 0.12;
      b.box(Math.sin(turn) * 0.27, 2.3 - length / 2, -Math.cos(turn) * 0.27, 0.085, length, 0.085, c);
    }
  },
  locs(b, c) {
    b.ball(0, 2.34, -0.03, 0.285, 0.2, 0.28, c, { seg: 7 });
    for (let i = 0; i < 5; i++) {
      const turn = (i - 2) * 0.6;
      b.box(Math.sin(turn) * 0.29, 2.08, -Math.cos(turn) * 0.28, 0.13, 0.5 + (i % 3) * 0.06, 0.13, c, { rz: Math.sin(turn) * 0.16 });
    }
  },
  cornrows(b, c, look) {
    b.ball(0, 2.31, -0.02, 0.268, 0.19, 0.266, mix(c, look.skin, 0.4), { seg: 7 });
    for (const x of [-0.14, -0.05, 0.05, 0.14]) b.box(x, 2.3 + Math.sqrt(1 - (x / 0.27) ** 2) * 0.19, -0.03, 0.05, 0.03, 0.42, c);
  },
  twists(b, c, look) {
    capLow(b, c);
    const drop = look.body === 'woman' ? 0.34 : 0.12;
    for (let i = 0; i < 6; i++) { const turn = i / 6 * TAU + 0.5; b.box(Math.sin(turn) * 0.24, 2.36 - drop / 2 + (look.body === 'woman' ? 0 : 0.14), Math.cos(turn) * 0.23 - 0.03, 0.07, drop, 0.07, c, { rz: Math.sin(turn) * 0.3, rx: -Math.cos(turn) * 0.3 }); }
  },
  bantuknots(b, c) {
    capLow(b, c);
    for (const [x, y, z] of [[0, 2.56, -0.02], [-0.17, 2.47, 0.06], [0.17, 2.47, 0.06], [-0.18, 2.45, -0.16], [0.18, 2.45, -0.16]]) b.cone(x, y, z, 0.075, 0.12, c, { seg: 5 });
  },
  gele(b, c, look, colours) {
    b.ball(0, 2.27, -0.04, 0.268, 0.16, 0.265, c, { seg: 7 });
    b.cyl(0, 2.49, -0.03, 0.27, 0.3, colours[0], { top: 1.45, seg: 8 });
    b.box(0, 2.72, -0.07, 0.8, 0.26, 0.09, colours[1], { rx: -0.25 });
    b.box(0.1, 2.78, 0.05, 0.56, 0.2, 0.08, colours[0], { rx: 0.15, rz: 0.12 });
  },
};
// Under a hat only hair that hangs below it is drawn in full; the rest is cut short.
const HANGING = new Set(['braids', 'locs', 'long', 'ponytail', 'bald', 'cornrows', 'fade', 'lowcut']);

function limbLow(b, name, x, y, z, pitch, roll, upper, bend, lower, end) {
  const tube = (part, open) => b.cyl(0, -part.length / 2, 0, part.r1, part.length, part.colour, { seg: 5, top: q3(part.r0 / part.r1), open });
  part(b, name, x, y, z, () => {
    tube(upper, false);
    b.at(0, -upper.length, 0, 0, () => { tube(lower, true); end?.(-lower.length); }, bend);
  }, pitch, roll);
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
const accessoryColour = (look, colours) => (look.fabric === 'plain' ? shade(look.outfitColor, -0.25) : colours[1]);

function drawLow(b, look, { joints, sitting, marker }) {
  const style = OUTFIT[look.outfit] || OUTFIT.casual, m = BODY[look.body], woman = look.body === 'woman';
  const colours = fabricColours(look), top = look.outfitColor, bottoms = look.bottomsColor, skin = look.skin;
  // Accessories are drawn only while they fit the budget: `reserve` is what the rest of the body still needs.
  const start = b.triangles;
  let reserve = 84 + (marker ? (marker === 'crown' ? 32 : 20) : 0);
  const room = (cost) => b.triangles - start + cost + reserve <= LOW_BUDGET;
  const skirt = woman && look.outfit === 'office', long = style.legs === 'wrapper' || style.legs === 'dress';
  const bareCalf = style.legs === 'shorts' || skirt, bulk = style.bulk || 0;
  const shoe = (SHOES[skirt ? 'dress' : style.shoe] || SHOES.sneaker)[style.shoe === 'slide' ? 1 : 0];
  const has = (id) => look.accessories.includes(id);
  if (!long || sitting) {
    for (const side of [0, 1]) {
      limbLow(b, side ? 'legL' : 'legR', (side ? 1 : -1) * (m.legX + 0.025), 1.04, 0, joints.leg[side], 0,
        { length: 0.5, r0: m.leg + 0.008, r1: m.leg - 0.012, colour: long || skirt ? shade(bottoms, -0.12) : bottoms },
        joints.calf[side],
        { length: 0.46, r0: m.leg - 0.02, r1: m.leg - 0.04, colour: long ? bottoms : bareCalf ? (style.socks ? CLOTH_WHITE : skin) : bottoms },
        (end) => b.box(0, end - 0.06, 0.07, 0.19, 0.13, 0.38, shoe));
    }
  } else {
    for (const side of [-1, 1]) part(b, side > 0 ? 'legL' : 'legR', side * 0.14, 1.04, 0, () => b.box(0, -0.975, 0.07, 0.19, 0.13, 0.38, shoe));
  }
  if (long) {
    const dress = style.dress, rings = dress ? [top, top, bottoms] : look.fabric === 'plain' ? [bottoms, bottoms, shade(bottoms, -0.15)] : [colours[0], colours[1], colours[2]];
    if (sitting) b.box(0, 1.02, 0.24, 0.56, 0.3, 0.8, rings[0]);
    else rings.forEach((colour, i) => b.cyl(0, 0.92 - i * 0.33, 0, 0.28 + i * (dress ? 0.075 : 0.045), 0.34, colour, { seg: 8, top: dress ? 0.8 : 0.87 }));
  } else if (skirt) {
    if (sitting) b.box(0, 1.03, 0.2, 0.52, 0.28, 0.7, bottoms);
    else b.cyl(0, 0.84, 0, 0.31, 0.52, bottoms, { seg: 8, top: 0.82 });
  }
  b.box(0, 1.03, 0, m.hip * 1.86, 0.22, m.hip * 1.86 * m.aspect, long ? (style.dress ? top : colours[0]) : bottoms);

  b.at(0, HIP_Y, 0, 0, () => {
    const depth = m.chest * (m.aspect + 0.04) + bulk, aspect = m.aspect + 0.04;
    const hem = style.tunic && !sitting ? (woman ? -0.62 : -0.45) : -0.1;
    const rings = [[hem, m.hip + bulk + (style.tunic ? 0.03 : 0)], [0.25, m.waist + 0.012 + bulk], [0.52, m.chest + 0.008 + bulk], [0.77, m.shoulder * 0.92 + bulk]];
    const by = { ankara: [colours[0], colours[1], colours[2]], adire: [colours[2], colours[1], colours[0]] }[look.fabric] || [top, top, top];
    loft(b, rings.slice(0, -1), by, { seg: 8, aspect });
    loft(b, rings.slice(-2), by[2], { seg: 8, aspect, capped: true });
    const front = (y) => radiusAt(rings, y) * aspect + 0.012;
    if (look.fabric === 'asooke') for (const side of [-1, 1]) b.quad(0, 0.32, side * front(0.32), 0.06, 0.6, colours[1], side < 0 ? { ry: Math.PI } : undefined);
    if (style.open) b.quad(0, 0.4, front(0.4), 0.15, 0.66, CLOTH_WHITE);
    if (style.collar) {
      b.box(0, 0.78, 0.02, 0.3, 0.06, 0.26, CLOTH_WHITE);
      if (!woman) b.box(0, 0.5, front(0.5), 0.07, 0.46, 0.02, colours[2] === top ? shade(top, -0.45) : colours[1]);
    }
    if (style.vest) {
      b.cyl(0, 0.42, 0, m.chest + 0.035, 0.5, '#f08a1d', { seg: 8, sz: m.aspect + 0.08, top: 1.04, open: true });
      b.cyl(0, 0.42, 0, m.chest + 0.045, 0.07, '#eeeacb', { seg: 8, sz: m.aspect + 0.08, open: true });
    }
    if (style.hood) {
      b.ball(0, 0.84, -0.15, 0.22, 0.16, 0.14, top, { seg: 6 });
      b.box(0, 0.22, front(0.22), 0.32, 0.17, 0.03, shade(top, -0.2));
    }
    if (style.gown) b.box(0, 0.46, front(0.46), 0.13, 0.8, 0.03, colours[1] === top ? shade(top, 0.35) : colours[1], { rz: 0.62 });
    if (style.sport) {
      for (const side of [-1, 1]) b.quad(side * (m.chest + 0.02 + bulk), 0.36, 0, 0.16, 0.62, CLOTH_WHITE, { ry: side * Math.PI / 2 });
      b.quad(0, 0.5, front(0.5), 0.13, 0.17, CLOTH_WHITE);
    }
    if (style.tunic) { b.quad(0, 0.52, front(0.52), 0.05, 0.44, GOLD); b.box(0, 0.79, 0, 0.2, 0.05, 0.2, shade(top, -0.2)); }
    if (style.robe) {
      // Agbada: a wide open robe over the tunic, embroidered at the chest.
      b.cyl(0, 0.2, 0, 0.44, 1.14, top, { seg: 8, sz: 0.5, top: 0.72, open: true });
      b.quad(0, 0.5, 0.2, 0.2, 0.36, GOLD, { rx: -0.12 });
    }
    if (style.dress) b.cyl(0, 0.2, 0, m.waist + 0.03 + bulk, 0.07, bottoms, { seg: 8, sz: aspect, open: true });
    b.cyl(0, 0.86, 0, m.neck, 0.18, skin, { seg: 6 });
    part(b, 'head', 0, 0.86, 0, () => b.at(0, -HIP_Y - 0.86, 0, 0, () => {
      headLow(b, look);
      const head = style.helmet || look.hair === 'gele' ? null : look.accessories.find((id) => ACCESSORY_SLOTS[id] === 'head');
      const covered = style.helmet || head;
      if (!head || HANGING.has(look.hair)) (covered && !HANGING.has(look.hair) ? HAIR_LOW.lowcut : HAIR_LOW[look.hair] || HAIR_LOW.lowcut)(b, look.hairColor, look, colours); // a hat or wrap hides short hair
      if (style.helmet) {
        b.ball(0, 2.37, -0.01, 0.31, 0.2, 0.31, '#f2c230', { seg: 6 });
        b.box(0, 2.34, 0.22, 0.42, 0.04, 0.24, '#f2c230');
      }
      const cloth = accessoryColour(look, colours);
      if (head === 'cap' && room(48)) { b.ball(0, 2.36, -0.01, 0.295, 0.2, 0.3, cloth, { seg: 6 }); b.box(0, 2.34, 0.3, 0.3, 0.03, 0.22, cloth); }
      if (head === 'headwrap' && room(48)) { b.ball(0, 2.33, -0.03, 0.295, 0.22, 0.3, cloth, { seg: 6 }); b.box(0, 2.2, -0.3, 0.12, 0.2, 0.06, cloth); }
      if (head === 'fila' && room(24)) b.cyl(0.02, 2.5, -0.02, 0.27, 0.24, cloth, { seg: 6, top: 1.08, rz: -0.12 });
      if (has('sunglasses') && room(12)) b.box(0, 2.215, 0.25, 0.34, 0.085, 0.03, '#15171c');
      else if (has('glasses') && room(12)) b.box(0, 2.215, 0.25, 0.32, 0.03, 0.03, INK);
      if (has('earrings') && room(24)) for (const side of [-1, 1]) b.box(side * 0.265, 2.1, 0, 0.03, 0.07, 0.03, GOLD);
      markerOf(b, marker);
      reserve = 84;
    }));
    if (has('chain') && room(12)) b.box(0, 0.7, front(0.7) - 0.01, 0.2, 0.035, 0.02, GOLD);
    if (has('backpack') && room(12)) b.box(0, 0.42, -(depth + 0.09), 0.36, 0.46, 0.18, '#3b4658');
    if (has('handbag') && room(12)) b.box(m.hip + 0.13, -0.08, 0.02, 0.09, 0.2, 0.26, '#b5763a');
    for (const side of [0, 1]) {
      const dir = side ? 1 : -1, [pitch, roll] = joints.arm[side], wide = style.sleeve === 'wide', bare = style.sleeve === 'cap';
      limbLow(b, side ? 'armL' : 'armR', dir * (m.shoulder + 0.02 + bulk), SHOULDER_Y + 0.05, 0, pitch, dir * (style.robe ? Math.max(roll, 0.3) : roll),
        { length: 0.42, r0: wide ? 0.1 : m.arm + 0.02 + bulk, r1: wide ? 0.15 : m.arm + 0.012 + bulk, colour: bare ? skin : wide && look.fabric !== 'plain' ? colours[1] : top },
        joints.fore[side],
        { length: 0.38, r0: m.arm, r1: m.arm - 0.016, colour: style.sleeve === 'long' ? top : skin },
        (end) => {
          b.box(0, end - 0.06, 0, 0.11, 0.14, 0.1, skin);
          reserve = side ? 0 : 42;
          if (side && has('watch') && room(12)) b.box(0, end + 0.03, 0, 0.14, 0.05, 0.14, '#23262d');
          if (!side && has('beads') && room(12)) b.box(0, end + 0.03, 0, 0.14, 0.04, 0.14, CORAL);
        });
    }
  }, joints.lean);
}

// ---- Medium and high detail: one model, drawn with fewer segments and fewer small parts at medium ----

/** The same batch with every curved primitive drawn with fewer segments. */
function coarse(b, scale) {
  const fewer = (o, least) => ({ ...o, seg: Math.max(least, Math.round((o?.seg || 8) * scale)) });
  // The smallest spheres a sphere template allows are 5 round by 4 high.
  const lite = Object.create(b);
  lite.ball = (x, y, z, rx, ry, rz, colour, o) => b.ball(x, y, z, rx, ry, rz, colour, fewer(o, 5));
  lite.cyl = (x, y, z, r, h, colour, o) => b.cyl(x, y, z, r, h, colour, fewer(o, 5));
  return lite;
}
const cover = (b, rings, from, to, pad, colour, seg) => loft(b, padded(clip(rings, from, to), pad), colour, { seg });
/** Rods through points with a ball at every joint, so a bent rope has no gaps. */
function rope(b, points, r0, r1, colour, seg = 8) {
  chain(b, points, r0, r1, colour, seg);
  for (let i = 1; i < points.length; i++) { const r = r0 + (r1 - r0) * i / (points.length - 1); b.ball(points[i][0], points[i][1], points[i][2], r, r, r, colour, { seg: Math.min(seg, 8) }); }
}

// Everything about the head is in the avatar's own coordinates: feet at y = 0, head centre at y = 2.2, face towards +z.
// Face shapes: the height of the head (its top stays where the hair expects it).
const FACES = { oval: { ry: HEAD.ry, jaw: 0 }, round: { ry: 0.256, jaw: 0 }, long: { ry: 0.3, jaw: 0 } };
const JAW = { y: 2.07, z: 0.016, ry: 0.165, rz: 0.214 };
/** How far forward the face is at (x, y): the skull or the jaw, whichever is in front. */
function faceZ(x, y, face = FACES.oval) {
  const skull = HEAD.rz * Math.sqrt(Math.max(0.04, 1 - (x / HEAD.rx) ** 2 - ((y - HEAD.y - HEAD.ry + face.ry) / face.ry) ** 2));
  const inside = face.jaw ? 1 - (x / face.jaw) ** 2 - ((y - JAW.y) / JAW.ry) ** 2 : 0;
  return Math.max(skull, inside > 0 ? JAW.z + JAW.rz * Math.sqrt(inside) : 0);
}
/** A point on the scalp: az turns from the face (0) round to the back (π); el rises from the ears (0) to the crown (π/2). */
const scalp = (az, el, lift = 0) => [Math.sin(az) * Math.cos(el) * (HEAD.rx + lift), HEAD.y + Math.sin(el) * (HEAD.ry + lift), Math.cos(az) * Math.cos(el) * (HEAD.rz + lift)];
/** Points spread evenly over the upper part of a sphere (golden-angle spiral): [x, y, z] unit vectors. */
function dome(count, coverage = 0.6) {
  return Array.from({ length: count }, (_, i) => {
    const up = 1 - (i + 0.5) / count * coverage * 2, r = Math.sqrt(Math.max(0, 1 - up * up)), turn = i * 2.39996;
    return [Math.cos(turn) * r, up, Math.sin(turn) * r];
  });
}

function headHigh(b, look, woman, fine) {
  // A clean stylised face: every part is a deliberate shape (primitives cannot be blended into one another).
  const skin = look.skin, F = FACES[look.face] || FACES.oval, mood = look.expression;
  const dark = channels(skin).reduce((sum, v) => sum + v, 0) < 250; // the two darkest tones: features are lifted, not darkened
  const deep = shade(skin, -0.22), white = '#f6f1e7', fz = (x, y) => faceZ(x, y, F), relief = shade(skin, dark ? 0.1 : -0.05);
  b.ball(0, HEAD.y + HEAD.ry - F.ry, 0, HEAD.rx, F.ry, HEAD.rz, skin, { seg: 28 });
  if (F.jaw) b.ball(0, JAW.y, JAW.z, F.jaw, JAW.ry, JAW.rz, skin, { seg: 24 });
  const brow = mix(look.hairColor, INK, 0.5), grin = mood === 'grin', flat = mood === 'neutral';
  for (const side of [-1, 1]) {
    const ex = side * 0.1, ey = 2.214, ez = fz(ex, ey), turn = side * 0.38;
    b.ball(ex, ey, ez - 0.01, 0.052, 0.05, 0.022, white, { seg: 10, ry: turn });
    b.ball(ex - side * 0.004, ey - 0.003, ez + 0.003, 0.032, 0.036, 0.013, '#3d2515', { seg: 9, ry: turn });
    if (fine) {
      b.ball(ex - side * 0.004, ey - 0.003, ez + 0.011, 0.017, 0.019, 0.007, '#0d0a09', { seg: 8, ry: turn });
      b.ball(ex + 0.012, ey + 0.012, ez + 0.017, 0.008, 0.008, 0.004, white, { seg: 6 });
    }
    // Upper lid and lash line; a grin narrows the eye.
    const lid = ey + (grin ? 0.046 : 0.06);
    b.ball(ex, lid, ez - 0.01, 0.054, 0.014, 0.024, skin, { seg: 9, ry: turn });
    b.box(ex + side * 0.004, lid - 0.012, ez + 0.011, 0.098, woman ? 0.009 : 0.005, 0.012, woman ? INK : mix(skin, INK, 0.7), { ry: turn, rz: side * -0.03 });
    if (woman && fine) b.box(ex + side * 0.054, lid - 0.006, ez + 0.002, 0.03, 0.01, 0.01, INK, { ry: turn, rz: side * 0.55 }); // lash flick
    if (grin && fine) b.ball(ex, ey - 0.046, ez - 0.008, 0.05, 0.014, 0.022, shade(skin, -0.06), { seg: 8, ry: turn });
    // Brows: slim, set a little above the lid, and lifted at the INNER end — an open, friendly face at rest
    // (a brow that dips towards the nose reads as a scowl at phone size). Neutral keeps them level.
    const by = 2.318 - (flat ? 0.016 : 0);
    b.ball(ex + side * 0.004, by, fz(ex, by) + 0.003, 0.058, woman ? 0.0105 : 0.0135, 0.012, brow, { seg: 8, ry: turn, rz: side * (flat ? 0 : -0.07) });
    // Ear: the outer shell and its hollow.
    b.ball(side * 0.247, 2.19, -0.012, 0.034, 0.066, 0.048, skin, { seg: 10 });
    if (fine) b.ball(side * 0.266, 2.195, -0.004, 0.016, 0.042, 0.027, deep, { seg: 6 });
  }
  // Nose: a tip with a wing each side.
  b.ball(0, 2.126, fz(0, 2.126) + 0.006, 0.034, 0.032, 0.04, relief, { seg: 10 });
  if (fine) for (const side of [-1, 1]) b.ball(side * 0.03, 2.116, fz(0, 2.116) - 0.004, 0.022, 0.02, 0.026, relief, { seg: 7 });
  // Mouth: a line with lifted corners, a two-part upper lip and a fuller lower one.
  const lip = woman ? mix(skin, dark ? '#c9606a' : '#b8454c', 0.6) : mix(skin, dark ? '#a8605a' : '#8a3f3a', dark ? 0.5 : 0.4), line = dark ? '#150a09' : mix(skin, '#2a0f0d', 0.72);
  const my = 2.036, mz = fz(0, my) + 0.002, wide = grin ? 0.12 : 0.1, full = woman ? 1 : 0.78;
  if (grin) b.box(0, my + 0.002, mz + 0.004, 0.092, 0.024, 0.012, white);
  else b.box(0, my + 0.003, mz + 0.006, wide, 0.007, 0.012, line);
  for (const side of [-1, 1]) {
    if (!flat) b.box(side * (wide / 2 + 0.01), my + 0.017, mz - 0.004, 0.042, 0.007, 0.012, line, { rz: side * 0.78, ry: side * 0.45 }); // the corners of a smile
    b.ball(side * 0.019, my + (grin ? 0.024 : 0.014), mz + 0.002, 0.03 * full, 0.0105 * full, 0.015, lip, { seg: 8, rz: side * -0.16, ry: side * 0.2 });
  }
  b.ball(0, my - (grin ? 0.022 : 0.011), mz + 0.003, (grin ? 0.048 : 0.04) * full, 0.0145 * full, 0.017, shade(lip, 0.08), { seg: 9 });
}

// ---- Hair ----------------------------------------------------------------------------------------

/** The scalp's covering of hair: an ellipsoid tipped back so its edge is the hairline. */
const capHigh = (b, c, grow = 0, o) => b.ball(0, 2.345, -0.05, 0.258 + grow, 0.18 + grow, 0.262 + grow, c, { seg: 24, rx: -0.3, ...o });
/** A point on that covering (or `lift` outside it), from a unit vector [x, y, z] with y up and z towards the face. */
function onCap([x, y, z], grow = 0, lift = 0) {
  const px = x * (0.258 + grow + lift), py = y * (0.18 + grow + lift), pz = z * (0.262 + grow + lift), c = Math.cos(-0.3), sn = Math.sin(-0.3);
  return [px, 2.345 + py * c - pz * sn, -0.05 + py * sn + pz * c];
}
/**
 * Strands hanging from the head, round the back from ear to ear. spread: how far round they go
 * (π/2 = the ears); each strand is a tapered rope with `bead` (a colour) at its end.
 */
function hang(b, c, count, spread, { length, short = length, r0, r1, from = 0.5, splay = 0.03, seg = 5, bead = null, offset = 0, knots = false }) {
  for (let i = 0; i < count; i++) {
    const az = Math.PI + ((i + 0.5 + offset) / count - 0.5) * 2 * spread, side = Math.abs(az - Math.PI) > 1.2;
    const len = (side ? short : length) * (1 - ((i * 7) % 5) * 0.035);
    const a = scalp(az, from, 0.012), mid = scalp(az, 0.02, 0.028), out = 1 + splay * 4;
    const low = [mid[0] * out, mid[1] - len * 0.45, mid[2] * out - (side ? 0 : 0.02)], end = [mid[0] * (out + splay), mid[1] - len, mid[2] * (out + splay) - (side ? 0 : 0.03)];
    (knots ? rope : chain)(b, [a, mid, low, end], r0, r1, c, seg);
    if (bead) b.ball(end[0], end[1] - r1, end[2], r1 * 1.5, r1 * 1.7, r1 * 1.5, bead, { seg: 5 });
  }
}
/** Rows of plaits over the scalp from the hairline to the nape, each `u` across the head (−1 … 1). */
function rows(b, c, list, radius, { tail = 0, bead = null, steps = 8 } = {}) {
  for (const u of list) {
    const w = Math.sqrt(1 - u * u), points = [];
    for (let i = 0; i <= steps; i++) { const t = 0.05 + (Math.PI - 0.3) * i / steps; points.push(onCap([u, w * Math.sin(t), w * Math.cos(t)], 0, radius * 0.3)); }
    if (tail) { const last = points[points.length - 1]; points.push([last[0] * 1.05, last[1] - tail * 0.5, last[2] - 0.02], [last[0] * 1.08, last[1] - tail, last[2] - 0.03]); }
    chain(b, points, radius, radius * 0.85, c, 6);
    if (bead && tail) { const end = points[points.length - 1]; b.ball(end[0], end[1] - 0.015, end[2], radius * 1.4, radius * 1.6, radius * 1.4, bead, { seg: 6 }); }
  }
}

const HAIR_HIGH = {
  bald() {},
  lowcut(b, c, look) {
    b.ball(0, 2.33, -0.05, 0.256, 0.184, 0.26, mix(c, look.skin, 0.45), { seg: 24, rx: -0.27 }); // a soft edge at the hairline
    capHigh(b, c, 0.006);
  },
  fade(b, c, look) {
    // Skin fade: three bands from almost skin at the ears to full colour on a squared-off top.
    b.ball(0, 2.275, -0.04, 0.2545, 0.2, 0.26, mix(c, look.skin, 0.66), { seg: 24, rx: -0.2 });
    b.ball(0, 2.33, -0.045, 0.2575, 0.186, 0.263, mix(c, look.skin, 0.34), { seg: 24, rx: -0.27 });
    b.ball(0, 2.4, -0.035, 0.232, 0.14, 0.245, c, { seg: 24, rx: -0.2 });
    b.cyl(0, 2.47, -0.035, 0.2, 0.09, c, { seg: 20, sz: 1.08, top: 0.9 });
  },
  classic(b, c, look, colours, fine) {
    capHigh(b, c, 0.024);
    if (look.body === 'woman') {
      b.ball(0, 2.14, -0.075, 0.305, 0.3, 0.25, c, { seg: 24 }); // a bob framing the face
      b.ball(-0.07, 2.4, 0.15, 0.2, 0.075, 0.13, c, { seg: 14, rz: 0.3, rx: 0.3 }); // side-swept fringe
      for (const side of [-1, 1]) b.ball(side * 0.255, 1.99, 0.02, 0.07, 0.11, 0.13, c, { seg: 12 }); // ends curling in at the jaw
    } else {
      b.ball(0, 2.47, -0.01, 0.215, 0.1, 0.225, c, { seg: 18, rx: -0.12 }); // a fuller top over short sides
      b.ball(0.02, 2.475, 0.11, 0.17, 0.07, 0.12, c, { seg: 14, rx: 0.2 }); // quiff
      if (fine) b.box(-0.12, 2.52, 0.0, 0.012, 0.02, 0.3, shade(c, 0.4), { rz: 0.45 }); // side parting
    }
  },
  afro(b, c, look, colours, fine) {
    // One rounded mass: a core with broad shallow swells for a soft, uneven outline.
    capHigh(b, c, 0.012);
    b.ball(0, 2.47, -0.085, 0.385, 0.35, 0.37, c, { seg: 28 });
    for (const [x, y, z] of dome(fine ? 26 : 10, 0.86)) b.ball(x * 0.262, 2.47 + y * 0.232, -0.085 + z * 0.25, 0.15, 0.148, 0.15, c, { seg: 10 });
  },
  curls(b, c, look, colours, fine) {
    // Short coils: many low overlapping swells that read as one textured cap.
    capHigh(b, c, 0.01);
    for (const v of dome(fine ? 70 : 24, 0.5)) {
      if (v[2] > 0.55 && v[1] < 0.42) continue; // keep the forehead clear
      const [x, y, z] = onCap(v, 0.01, -0.022);
      b.ball(x, y, z, 0.06, 0.06, 0.06, c, { seg: 8 });
    }
  },
  bun(b, c, look, colours, fine) {
    capHigh(b, c, 0.012);
    b.ball(0, 2.61, -0.13, 0.15, 0.135, 0.15, c, { seg: 18 });
    b.cyl(0, 2.5, -0.105, 0.085, 0.05, GOLD, { seg: 14, rx: -0.5 });
    if (fine) for (const tilt of [-0.5, 0.2, 0.9]) b.cyl(0, 2.61, -0.13, 0.152, 0.02, shade(c, 0.2), { seg: 18, rx: tilt, rz: tilt * 0.6, open: true }); // the wrap of the bun
  },
  ponytail(b, c) {
    capHigh(b, c, 0.012);
    b.cyl(0, 2.43, -0.3, 0.06, 0.07, GOLD, { seg: 12, rx: 1.1 });
    rope(b, [[0, 2.44, -0.29], [0, 2.38, -0.4], [0, 2.2, -0.455], [0, 2.0, -0.45], [0, 1.84, -0.42], [0, 1.74, -0.4]], 0.07, 0.03, c, 12);
    b.ball(0, 2.3, -0.43, 0.095, 0.13, 0.085, c, { seg: 12 });
  },
  long(b, c, look, colours, fine) {
    capHigh(b, c, 0.03);
    b.ball(0, 1.98, -0.185, 0.29, 0.52, 0.13, c, { seg: 24 });
    for (const side of [-1, 1]) b.ball(side * 0.238, 2.06, -0.03, 0.082, 0.3, 0.16, c, { seg: 14 });
    b.box(0, 2.515, 0.03, 0.012, 0.02, 0.3, shade(c, 0.45)); // centre parting
    if (fine) for (let i = -4; i <= 4; i++) b.box(i * 0.058, 1.86, -0.312 + i * i * 0.0028, 0.009, 0.6, 0.009, shade(c, 0.2)); // strands
  },
  braids(b, c, look, colours, fine) {
    capHigh(b, c, 0.012);
    if (fine) for (const x of [-0.14, -0.07, 0, 0.07, 0.14]) b.box(x, 2.3 + Math.sqrt(1 - (x / 0.275) ** 2) * 0.212, -0.02, 0.008, 0.012, 0.34, mix(c, look.skin, 0.6)); // partings
    hang(b, c, fine ? 19 : 7, 2.05, { length: 0.82, short: 0.42, r0: fine ? 0.024 : 0.034, r1: fine ? 0.016 : 0.024, bead: fine ? GOLD : null });
    if (fine) hang(b, c, 18, 1.95, { length: 0.62, short: 0.36, r0: 0.022, r1: 0.015, from: 0.36, splay: 0.05, bead: GOLD, offset: 0.5 });
  },
  locs(b, c, look, colours, fine) {
    capHigh(b, c, 0.026);
    for (const [x, y, z] of dome(fine ? 14 : 6, 0.3)) b.ball(x * 0.235, 2.35 + y * 0.2, -0.03 + z * 0.245, 0.062, 0.05, 0.062, c, { seg: 8 });
    hang(b, c, fine ? 13 : 6, 2.0, { length: 0.5, short: 0.36, r0: 0.04, r1: 0.027, from: 0.55, splay: 0.07, seg: 6 });
    if (fine) hang(b, c, 12, 1.9, { length: 0.4, short: 0.3, r0: 0.036, r1: 0.025, from: 0.75, splay: 0.11, seg: 6, offset: 0.5 });
  },
  cornrows(b, c, look, colours, fine) {
    b.ball(0, 2.335, -0.05, 0.257, 0.184, 0.261, mix(c, look.skin, 0.28), { seg: 24, rx: -0.3 }); // the scalp between the rows
    const woman = look.body === 'woman';
    rows(b, c, fine ? [-0.9, -0.72, -0.52, -0.31, -0.1, 0.1, 0.31, 0.52, 0.72, 0.9] : [-0.7, -0.24, 0.24, 0.7], fine ? 0.03 : 0.045, { tail: woman ? 0.34 : 0.05, bead: woman ? GOLD : null, steps: fine ? 8 : 4 });
  },
  twists(b, c, look, colours, fine) {
    capHigh(b, c, 0.014);
    if (look.body === 'woman') {
      // Two-strand twists to the jaw: knotted ropes in two layers.
      hang(b, c, fine ? 17 : 7, 2.15, { length: 0.42, short: 0.3, r0: 0.03, r1: 0.022, from: 0.5, splay: 0.02, knots: fine });
      if (fine) hang(b, c, 14, 2.0, { length: 0.34, short: 0.26, r0: 0.028, r1: 0.02, from: 0.8, splay: 0.045, knots: true, offset: 0.5 });
      for (const [x, y, z] of dome(fine ? 10 : 5, 0.22)) b.ball(x * 0.24, 2.38 + y * 0.12, -0.03 + z * 0.24, 0.05, 0.04, 0.05, c, { seg: 8 });
    } else {
      // Short twists all over, each drooping a little under its own weight.
      for (const v of dome(fine ? 46 : 16, 0.5)) {
        if (v[2] > 0.55 && v[1] < 0.42) continue;
        const root = onCap(v, 0.014, -0.01), tip = onCap(v, 0.014, 0.05);
        tip[1] -= 0.028 + (1 - v[1]) * 0.03;
        stick(b, root, tip, 0.027, 0.02, c, 6);
        b.ball(tip[0], tip[1], tip[2], 0.021, 0.021, 0.021, c, { seg: 6 });
      }
    }
  },
  bantuknots(b, c, look, colours, fine) {
    capHigh(b, c, 0.008);
    for (const [x, y, z] of dome(fine ? 9 : 6, 0.3)) {
      if (z > 0.5 && y < 0.75) continue;
      const at = (r) => [x * (0.25 + r), 2.2 + y * (0.28 + r) + 0.012, z * (0.255 + r) - 0.03];
      const [p, q] = [at(0.035), at(0.095)];
      b.ball(p[0], p[1], p[2], 0.07, 0.07, 0.07, c, { seg: 12 });
      b.ball(q[0], q[1], q[2], 0.045, 0.045, 0.045, c, { seg: 10 });
    }
  },
  gele(b, c, look, colours) {
    const main = colours[0], other = look.fabric === 'plain' ? shade(main, 0.22) : colours[1], dark = look.fabric === 'plain' ? shade(main, -0.18) : colours[2];
    b.ball(0, 2.27, -0.05, 0.257, 0.17, 0.262, c, { seg: 18 }); // hair showing at the nape and temples
    b.cyl(0, 2.43, -0.03, 0.264, 0.2, main, { seg: 28, top: 1.14, rx: -0.1 });
    b.cyl(0, 2.58, -0.045, 0.3, 0.14, other, { seg: 28, top: 1.22, rx: -0.1 });
    b.cyl(0, 2.505, -0.04, 0.304, 0.018, dark, { seg: 28, rx: -0.1, open: true });
    // The fan: broad rounded pleats standing up behind the wrap, each a little smaller and further forward.
    [[0.47, 2.69, -0.15, -0.34, main], [0.44, 2.7, -0.085, -0.2, other], [0.39, 2.69, -0.02, -0.06, dark], [0.31, 2.66, 0.045, 0.1, main]]
      .forEach(([r, y, z, tilt, colour]) => b.cyl(0, y, z, r, 0.04, colour, { seg: 28, sz: 0.5, rx: Math.PI / 2 + tilt }));
    b.ball(0, 2.64, -0.07, 0.4, 0.2, 0.1, main, { seg: 20, rx: -0.2 }); // the body of cloth behind the pleats
    b.ball(0.2, 2.5, 0.2, 0.09, 0.07, 0.06, other, { seg: 12 }); // knot
  },
};

// ---- Hands and shoes -----------------------------------------------------------------------------

/** A relaxed hand below the wrist at y = end: palm, four fingers curling towards the body, and a thumb. dir: +1 on the avatar's left. */
function handHigh(b, m, end, dir, skin) {
  // Hands are drawn a fifth larger than the wrist would give: they carry every gesture and vanish at phone size otherwise.
  const w = m.wrist * 1.2, inwards = -dir;
  b.ball(0, end - 0.058, 0.004, w * 0.5, 0.064, w * 0.98, skin, { seg: 12 });
  for (let i = 0; i < 4; i++) {
    const z = (i - 1.5) * w * 0.47 + 0.004, long = [0.062, 0.072, 0.068, 0.054][i], y0 = end - 0.1;
    rope(b, [[0, y0, z], [inwards * 0.008, y0 - long * 0.55, z], [inwards * 0.026, y0 - long, z * 0.94]], w * 0.24, w * 0.19, skin, 5);
  }
  rope(b, [[inwards * 0.006, end - 0.035, w * 0.8], [inwards * 0.014, end - 0.075, w * 1.28], [inwards * 0.024, end - 0.112, w * 1.32]], w * 0.3, w * 0.22, skin, 5);
}

/** A shoe on a foot whose ankle is at y = end; the ground is 0.08 below it and the toes point to +z. */
function shoeHigh(b, kind, end, skin, [upper, sole] = SHOES[kind] || SHOES.sneaker, fine = true) {
  const ground = end - 0.08;
  const foot = () => { b.ball(0, ground + 0.045, 0.05, 0.047, 0.036, 0.122, skin, { seg: 12 }); b.ball(0, end - 0.01, -0.005, 0.045, 0.05, 0.05, skin, { seg: 10 }); };
  if (kind === 'slide') {
    b.cyl(0, ground + 0.007, 0.06, 0.06, 0.014, upper, { seg: 18, sz: 2.2 }); // outsole
    b.cyl(0, ground + 0.024, 0.06, 0.058, 0.022, sole, { seg: 18, sz: 2.2 }); // footbed
    foot();
    if (fine) for (let i = 0; i < 5; i++) b.ball((i - 2) * 0.019, ground + 0.045, 0.168 - Math.abs(i - 1.5) * 0.008, 0.011, 0.012, 0.018, skin, { seg: 6 });
    b.ball(0, ground + 0.055, 0.085, 0.058, 0.04, 0.05, upper, { seg: 14 }); // the strap over the foot
    if (fine) b.box(0, ground + 0.094, 0.085, 0.05, 0.004, 0.03, sole);
  } else if (kind === 'heel') {
    b.cyl(0, ground + 0.006, 0.1, 0.046, 0.012, sole, { seg: 16, sz: 1.75 }); // the sole under the toes
    b.ball(0, ground + 0.05, 0.03, 0.043, 0.034, 0.105, skin, { seg: 12, rx: 0.22 });
    b.ball(0, end - 0.008, -0.01, 0.043, 0.05, 0.046, skin, { seg: 10 });
    b.ball(0, ground + 0.034, 0.128, 0.047, 0.03, 0.062, upper, { seg: 14 }); // toe box
    b.ball(0, ground + 0.058, -0.052, 0.042, 0.04, 0.034, upper, { seg: 12 }); // heel cup
    stick(b, [0, ground, -0.066], [0, ground + 0.06, -0.06], 0.008, 0.02, sole, 8); // the heel itself
    if (fine) b.cyl(0, end + 0.006, -0.012, 0.05, 0.014, upper, { seg: 14, sz: 1.05 }); // ankle strap
  } else if (kind === 'boot') {
    b.cyl(0, ground + 0.02, 0.06, 0.068, 0.04, sole, { seg: 18, sz: 2.05 });
    if (fine) b.cyl(0, ground + 0.036, 0.06, 0.07, 0.008, shade(upper, 0.3), { seg: 18, sz: 2.05 }); // welt
    b.ball(0, ground + 0.064, 0.068, 0.064, 0.05, 0.122, upper, { seg: 16 });
    b.ball(0, ground + 0.058, 0.152, 0.06, 0.042, 0.05, shade(upper, -0.18), { seg: 12 }); // toe cap
    b.cyl(0, end + 0.045, -0.008, 0.066, 0.16, upper, { seg: 16, top: 1.06 });
    b.cyl(0, end + 0.122, -0.008, 0.072, 0.03, shade(upper, -0.22), { seg: 16 }); // padded collar
    if (fine) for (let i = 0; i < 4; i++) b.box(0, end - 0.015 + i * 0.034, 0.064 - i * 0.012, 0.062, 0.008, 0.012, sole, { rx: -0.5 }); // laces
  } else if (kind === 'dress') {
    b.cyl(0, ground + 0.007, 0.062, 0.05, 0.014, sole, { seg: 18, sz: 2.55 });
    b.box(0, ground + 0.016, -0.04, 0.086, 0.032, 0.07, sole); // heel block
    b.ball(0, ground + 0.045, 0.05, 0.051, 0.04, 0.122, upper, { seg: 16 });
    b.ball(0, ground + 0.034, 0.148, 0.04, 0.026, 0.052, upper, { seg: 12 }); // a slim toe
    b.cyl(0, end - 0.012, -0.012, 0.05, 0.036, upper, { seg: 14, top: 1.06 });
    if (fine) { b.box(0, ground + 0.086, 0.062, 0.03, 0.004, 0.07, shade(upper, 0.5), { rx: 0.42 }); for (let i = 0; i < 3; i++) b.box(0, ground + 0.094 - i * 0.012, 0.045 + i * 0.026, 0.04, 0.005, 0.007, sole, { rx: 0.42 }); }
  } else {
    // Sneaker: a thick sole, a toe cap, laces and a stripe.
    b.cyl(0, ground + 0.016, 0.058, 0.06, 0.032, sole, { seg: 18, sz: 2.05 });
    b.ball(0, ground + 0.064, 0.056, 0.06, 0.058, 0.122, upper, { seg: 16 });
    b.ball(0, ground + 0.05, 0.158, 0.056, 0.036, 0.046, sole, { seg: 12 }); // toe cap
    b.cyl(0, end - 0.004, -0.012, 0.055, 0.05, upper, { seg: 14, top: 1.08 }); // collar
    b.ball(0, end + 0.004, -0.07, 0.022, 0.03, 0.016, sole, { seg: 8 }); // heel tab
    if (fine) {
      b.box(0, ground + 0.116, 0.07, 0.04, 0.006, 0.1, shade(upper, 0.5), { rx: 0.4 }); // tongue
      for (let i = 0; i < 4; i++) b.box(0, ground + 0.122 - i * 0.012, 0.044 + i * 0.027, 0.058, 0.006, 0.009, sole, { rx: 0.4 });
      for (const side of [-1, 1]) b.box(side * 0.06, ground + 0.064, 0.05, 0.004, 0.022, 0.09, sole, { rx: -0.35 });
    }
  }
}

function limbHigh(b, name, x, y, z, pitch, roll, upper, bend, lower, end) {
  const piece = (p) => { loft(b, p.rings, p.colour, { seg: 14 }); p.extra?.(); };
  part(b, name, x, y, z, () => {
    piece(upper);
    b.at(0, -upper.length, 0, 0, () => {
      const r = upper.rings[0][1] * 0.975; // just inside both tubes, so a bent joint is filled and a straight one shows no seam
      b.ball(0, 0, 0, r, r, r, upper.joint ?? upper.colour, { seg: 12 });
      piece(lower);
      end?.(-lower.length);
    }, bend);
  }, pitch, roll);
}

// ---- Accessories ---------------------------------------------------------------------------------

function headwear(b, kind, cloth, fine) {
  const dark = shade(cloth, -0.22);
  if (kind === 'cap') {
    b.ball(0, 2.385, -0.015, 0.27, 0.172, 0.278, cloth, { seg: 24, rx: -0.08 });
    b.cyl(0, 2.322, 0.262, 0.152, 0.016, dark, { seg: 22, sz: 1.2, rx: 0.16 }); // brim
    b.ball(0, 2.556, -0.03, 0.024, 0.012, 0.024, dark, { seg: 8 });
    if (fine) {
      b.cyl(0, 2.33, -0.012, 0.262, 0.03, dark, { seg: 24, sz: 1.03, rx: -0.08, open: true }); // sweatband edge
      b.box(0, 2.42, 0.258, 0.1, 0.07, 0.01, CLOTH_WHITE, { rx: -0.3 }); // front patch
    }
  } else if (kind === 'headwrap') {
    b.ball(0, 2.36, -0.035, 0.266, 0.19, 0.276, cloth, { seg: 24, rx: -0.24 });
    b.ball(0, 2.14, -0.2, 0.15, 0.13, 0.07, cloth, { seg: 12 }); // the flap at the nape
    b.ball(0, 2.25, -0.275, 0.05, 0.04, 0.04, dark, { seg: 10 }); // knot
    for (const side of [-1, 1]) chain(b, [[side * 0.02, 2.24, -0.29], [side * 0.05, 2.08, -0.31], [side * 0.075, 1.93, -0.3]], 0.024, 0.012, dark, 6);
    if (fine) b.box(0, 2.47, 0.0, 0.008, 0.012, 0.5, dark, { rx: -0.1 }); // centre seam
  } else if (kind === 'fila') {
    b.cyl(0, 2.46, -0.02, 0.264, 0.2, cloth, { seg: 26, top: 1.03, rz: -0.05, rx: -0.06 });
    b.ball(0.02, 2.56, -0.025, 0.272, 0.062, 0.272, cloth, { seg: 22, rz: -0.14 });
    b.ball(0.17, 2.52, -0.03, 0.12, 0.085, 0.2, cloth, { seg: 14, rz: -0.5 }); // the slouch to one side
    b.cyl(0, 2.375, -0.016, 0.268, 0.035, dark, { seg: 26, rx: -0.06, open: true });
    if (fine) for (const y of [2.44, 2.5]) b.cyl(0, y, -0.02, 0.269, 0.008, GOLD, { seg: 26, rz: -0.05, rx: -0.06, open: true });
  }
}
function eyewear(b, kind, face, fine) {
  const y = 2.214, frame = kind === 'sunglasses' ? '#17181c' : INK;
  for (const side of [-1, 1]) {
    const x = side * 0.1, z = faceZ(x, y, face) + 0.04, turn = side * 0.16;
    if (kind === 'sunglasses') {
      b.ball(x, y - 0.006, z, 0.064, 0.046, 0.008, '#101216', { seg: 14, ry: turn });
      if (fine) b.ball(x - 0.014, y + 0.012, z + 0.008, 0.016, 0.007, 0.002, '#59616f', { seg: 6, ry: turn, rz: 0.5 });
    } else {
      b.box(x, y + 0.034, z, 0.1, 0.009, 0.008, frame, { ry: turn });
      b.box(x, y - 0.036, z, 0.092, 0.007, 0.008, frame, { ry: turn });
      for (const edge of [-1, 1]) b.box(x + edge * 0.047, y - 0.001, z - (edge * side > 0 ? 0.007 : -0.007), 0.007, 0.07, 0.008, frame, { ry: turn });
    }
    stick(b, [side * 0.15, y + 0.024, z - 0.012], [side * 0.257, 2.222, 0.0], 0.005, 0.005, frame, 4);
  }
  const mid = faceZ(0, y, face) + 0.05;
  b.box(0, y + (kind === 'sunglasses' ? 0.03 : 0.018), mid, kind === 'sunglasses' ? 0.3 : 0.05, kind === 'sunglasses' ? 0.012 : 0.008, 0.008, frame);
}

// ---- The model -----------------------------------------------------------------------------------

function drawHigh(b0, look, { joints, sitting, marker }, fine) {
  const b = fine ? b0 : coarse(b0, 0.36);
  const per = fine ? 3 : 1, SEG = 24;
  const style = OUTFIT[look.outfit] || OUTFIT.casual, m = BODY[look.body], woman = look.body === 'woman';
  const colours = fabricColours(look), top = look.outfitColor, bottoms = look.bottomsColor, skin = look.skin;
  const plain = look.fabric === 'plain', has = (id) => look.accessories.includes(id);
  const skirt = woman && look.outfit === 'office', legs = skirt ? 'skirt' : style.legs;
  const shoe = skirt ? 'heel' : style.shoe, shoeColours = skirt ? SHOES.dress : SHOES[shoe];
  const bulk = style.bulk || 0, aspect = m.aspect, trim = shade(top, -0.2);
  const wrapper = plain ? [bottoms, bottoms, shade(bottoms, -0.15)] : colours;
  const long = (legs === 'wrapper' || legs === 'dress') && !sitting;
  const cloth = (rings, o) => { if (fine && !plain) print(b, look, colours, rings, o); };
  const dyed = fine || plain ? top : weave(look, colours);
  const body = smooth(torsoKeys(m), per);

  // Legs and shoes
  if (!long) {
    const trousers = legs === 'trousers', pad = trousers ? 0.014 : 0, legColour = trousers ? bottoms : skin;
    const thigh = smooth([[-0.5, m.knee + pad], [-0.25, (m.leg + m.knee) / 2 + 0.008 + pad], [0, m.leg + pad]], per);
    const shin = smooth(trousers ? [[-0.46, m.ankle + 0.03], [-0.2, m.calf + pad], [0, m.knee + pad]] : [[-0.46, m.ankle], [-0.36, m.ankle + 0.012], [-0.16, m.calf], [0, m.knee]], per);
    for (const side of [0, 1]) {
      const dir = side ? 1 : -1;
      limbHigh(b, side ? 'legL' : 'legR', dir * m.legX, 1.04, 0, joints.leg[side], 0,
        { length: 0.5, rings: thigh, colour: legColour, extra: legs === 'shorts' ? () => {
          cover(b, thigh, -0.36, -0.08, 0.03, bottoms, 16);
          cover(b, thigh, -0.08, 0, 0.004, bottoms, 16);
          b.cyl(0, -0.35, 0, radiusAt(thigh, -0.35) + 0.033, 0.03, shade(bottoms, -0.18), { seg: 16, open: true });
          b.cyl(0, -0.362, 0, radiusAt(thigh, -0.36) + 0.028, 0.004, shade(bottoms, -0.55), { seg: 16 });
          if (style.sport) b.box(dir * (radiusAt(thigh, -0.18) + 0.032), -0.18, 0, 0.008, 0.34, 0.05, CLOTH_WHITE);
        } : trousers && fine && (style.collar || style.tunic || style.robe) ? () => b.box(0, -0.25, radiusAt(thigh, -0.25) + 0.002, 0.008, 0.5, 0.006, shade(bottoms, -0.14)) : null },
        joints.calf[side],
        { length: 0.46, rings: shin, colour: legColour, extra: () => {
          if (trousers) {
            b.cyl(0, -0.452, 0, m.ankle + 0.034, 0.018, shade(bottoms, -0.2), { seg: 16, open: true }); // hem
            b.cyl(0, -0.46, 0, m.ankle + 0.028, 0.004, shade(bottoms, -0.6), { seg: 16 });
            if (fine) b.cyl(0, -0.39, 0, radiusAt(shin, -0.39) + 0.003, 0.012, shade(bottoms, -0.1), { seg: 16, open: true }); // the break above the shoe
          } else if (style.socks) {
            cover(b, shin, -0.46, -0.2, 0.008, CLOTH_WHITE, 16);
            for (const y of [-0.225, -0.255]) b.cyl(0, y, 0, radiusAt(shin, y) + 0.011, 0.014, top, { seg: 16, open: true });
          }
        } },
        (end) => shoeHigh(b, shoe, end, skin, shoeColours, fine));
    }
  } else {
    for (const side of [-1, 1]) part(b, side > 0 ? 'legL' : 'legR', side * m.legX, 1.04, 0, () => shoeHigh(b, shoe, -0.96, skin, shoeColours, fine));
  }
  // The garment below the waist
  if (legs === 'wrapper') {
    if (sitting) b.box(0, 1.02, 0.24, 0.56, 0.3, 0.8, wrapper[0]);
    else {
      // Iro: a wrapper from the waist to the ankles, with its overlapping edge down the front.
      const rings = smooth([[0.1, 0.3], [0.45, 0.275], [0.9, m.hip + 0.014], [1.04, m.hip * 0.94]], per);
      loft(b, rings, fine || plain ? wrapper[0] : weave(look, colours), { seg: SEG, aspect: 0.74 });
      band(b, rings, 0.125, 0.05, plain ? shade(bottoms, -0.2) : colours[2], { seg: SEG, aspect: 0.74 });
      cloth(rings, { aspect: 0.74, from: 0.16, to: 0.98, around: 9, seg: SEG });
      strip(b, rings, 0.1, 1.0, 0.5, 0.035, plain ? shade(bottoms, 0.2) : colours[1], { aspect: 0.74, lift: 0.012, thick: 0.02 });
      if (fine) for (const a of [1.5, 2.4, 3.3, 4.2, 5.3]) strip(b, rings, 0.12, 0.9, a, 0.014, shade(wrapper[0], -0.14), { aspect: 0.74, lift: 0.002, thick: 0.012 }); // folds
    }
  } else if (legs === 'dress') {
    if (sitting) b.box(0, 1.02, 0.24, 0.56, 0.3, 0.8, top);
    else {
      const rings = smooth([[0.09, 0.45], [0.5, 0.37], [0.92, m.hip + 0.045], [1.13, m.hip * 0.99], [1.3, m.waist + 0.03]], per);
      loft(b, rings, dyed, { seg: SEG, aspect: 0.84 });
      band(b, rings, 0.12, 0.06, bottoms, { seg: SEG, aspect: 0.84 });
      cloth(rings, { aspect: 0.84, from: 0.2, to: 1.2, around: 10, seg: SEG });
      if (fine) for (let i = 0; i < 12; i++) strip(b, rings, 0.16, 0.86 + (i % 3) * 0.07, (i + 0.5) / 12 * TAU, 0.016, shade(top, i % 2 ? -0.13 : 0.1), { aspect: 0.84, lift: 0.002, thick: 0.014 }); // the fall of the skirt
    }
  } else if (legs === 'skirt') {
    if (sitting) b.box(0, 1.03, 0.2, 0.52, 0.28, 0.7, bottoms);
    else {
      const rings = smooth([[0.6, m.hip - 0.02], [0.88, m.hip + 0.01], [0.99, m.hip - 0.004]], per);
      loft(b, rings, bottoms, { seg: SEG, aspect: 0.82 });
      band(b, rings, 0.615, 0.03, shade(bottoms, -0.2), { seg: SEG, aspect: 0.82 });
      b.cyl(0, 0.63, 0, m.hip - 0.026, 0.01, shade(bottoms, -0.55), { seg: SEG, sz: 0.82 });
      if (fine) strip(b, rings, 0.6, 0.72, Math.PI, 0.01, shade(bottoms, -0.5), { aspect: 0.82, lift: 0.003 }); // back vent
    }
  }
  // Hips and seat
  const seat = legs === 'wrapper' ? wrapper[0] : legs === 'dress' ? top : bottoms;
  b.at(0, HIP_Y, 0, 0, () => {
    loft(b, padded(clip(body, -0.14, 0.02), 0.004), seat, { seg: SEG, aspect, capped: true });
    b.ball(0, -0.13, 0, m.hip * 0.9, 0.075, m.hip * aspect * 0.9, seat, { seg: 16 });
  });

  b.at(0, HIP_Y, 0, 0, () => {
    const hem = sitting ? Math.max(style.hem, -0.14) : style.tunic && woman ? -0.84 : style.hem;
    let keys = torsoKeys(m);
    keys[0] = [-0.16, m.hip + 0.006]; // a top hangs straight from the hips
    if (hem < -0.14) keys = [[hem, m.hip + (woman ? 0.085 : 0.03)], [(hem - 0.16) / 2, m.hip + (woman ? 0.05 : 0.022)], ...keys.slice(1)];
    const wear = padded(smooth(keys, per), 0.016 + bulk), depthAt = (y) => radiusAt(wear, y) * aspect;
    const front = (y, a = 0, lift = 0.008) => onLoft(wear, aspect, y, a, lift);
    // Skin under the neckline, then the garment over it
    loft(b, clip(body, 0.5, 0.8), skin, { seg: SEG, aspect });
    b.cyl(0, 0.9, 0, m.neck, 0.24, skin, { seg: 18, top: 0.92 });
    const neckline = style.open ? 0.72 : style.dress ? 0.68 : 0.755;
    const garment = clip(wear, hem, neckline);
    loft(b, garment, dyed, { seg: SEG, aspect });
    band(b, wear, hem + 0.02, 0.04, style.gown && !plain ? colours[2] : trim, { seg: SEG, aspect });
    b.cyl(0, hem + 0.03, 0, radiusAt(wear, hem + 0.03) - 0.006, 0.03, hem < -0.2 ? shade(top, -0.55) : seat, { seg: SEG, sz: aspect }); // closes the hem
    cloth(garment, { aspect, from: hem + 0.05, to: style.vest ? 0.1 : style.robe ? hem + 0.05 : 0.7, around: 7, seg: SEG });
    if (fine) for (const side of [-1, 1]) strip(b, wear, hem + 0.05, 0.46, side * Math.PI / 2, 0.007, shade(top, -0.28), { aspect, lift: 0.003 }); // side seams

    if (style.open) {
      // An unbuttoned camp shirt over a vest: the opening runs down the front between two plackets.
      strip(b, wear, hem + 0.03, 0.72, 0, 0.13, CLOTH_WHITE, { aspect, lift: 0.004 });
      for (const side of [-1, 1]) {
        strip(b, wear, hem + 0.03, 0.72, side * 0.3, 0.028, trim, { aspect, lift: 0.008, thick: 0.014 });
        b.box(side * 0.105, 0.738, depthAt(0.738) + 0.008, 0.14, 0.055, 0.02, top, { rz: side * 0.5, ry: side * 0.3 }); // camp collar
        if (fine) for (const y of [0.1, 0.3, 0.5]) { const p = front(y, side * 0.3, 0.018); b.cyl(p.x, y, p.z, 0.011, 0.006, CLOTH_WHITE, { seg: 8, rx: Math.PI / 2, ry: p.ry }); }
      }
      if (fine) { const p = front(0.46, 0.75, 0.008); b.box(p.x, 0.46, p.z, 0.1, 0.1, 0.008, shade(top, -0.12), { ry: p.ry }); }
    } else if (style.collar) {
      // A blazer: one clear white V of shirt between two broad lapels, a tie or a pendant, two buttons.
      const tie = colours[2] === top ? shade(top, -0.5) : colours[1], lapel = shade(top, -0.16);
      strip(b, wear, 0.43, 0.76, 0, 0.21, CLOTH_WHITE, { aspect, lift: 0.004 });
      if (!woman) {
        strip(b, wear, 0.44, 0.7, 0, 0.05, tie, { aspect, lift: 0.01 });
        b.box(0, 0.722, depthAt(0.722) + 0.014, 0.062, 0.05, 0.02, shade(tie, -0.15));
      } else if (fine) b.ball(0, 0.66, depthAt(0.66) + 0.012, 0.018, 0.018, 0.01, GOLD, { seg: 8 });
      for (const side of [-1, 1]) {
        const tilt = Math.atan2((radiusAt(wear, 0.76) - radiusAt(wear, 0.4)) * aspect, 0.36);
        b.box(side * 0.094, 0.575, depthAt(0.575) + 0.014, 0.125, 0.43, 0.016, lapel, { rz: side * -0.4, rx: tilt });
        b.box(side * 0.075, 0.782, depthAt(0.782) * 0.72, 0.11, 0.05, 0.03, CLOTH_WHITE, { rz: side * -0.5, ry: side * 0.5 }); // shirt collar
      }
      b.cyl(0, 0.79, 0, m.neck + 0.022, 0.05, CLOTH_WHITE, { seg: 18, top: 0.95, open: true });
      for (const y of [0.27, 0.14]) { const p = front(y, 0, 0.01); b.cyl(0, y, p.z, 0.022, 0.01, shade(top, -0.5), { seg: 10, rx: Math.PI / 2 }); }
      if (fine) {
        strip(b, wear, hem + 0.04, 0.36, 0.04, 0.008, shade(top, -0.3), { aspect, lift: 0.004 }); // the front edge of the jacket
        const pocket = front(0.5, 0.72, 0.01);
        b.box(pocket.x, 0.5, pocket.z, 0.09, 0.012, 0.01, CLOTH_WHITE, { ry: pocket.ry });
        for (const side of [-1, 1]) { const p = front(0.06, side * 0.75, 0.008); b.box(p.x, 0.06, p.z, 0.12, 0.014, 0.01, lapel, { ry: p.ry }); }
      }
    } else if (style.hood) {
      band(b, wear, hem + 0.045, 0.09, trim, { seg: SEG, aspect, lift: 0.008 }); // ribbed hem
      b.ball(0, 0.77, -0.15, 0.2, 0.16, 0.13, top, { seg: 18, rx: 0.5 }); // the hood, resting behind the neck
      b.cyl(0, 0.795, -0.012, m.neck + 0.075, 0.11, top, { seg: 20, top: 1.2, sz: 1.05, open: true });
      b.cyl(0, 0.85, -0.012, (m.neck + 0.075) * 1.2, 0.012, trim, { seg: 20, sz: 1.05, open: true });
      const pouch = front(0.14, 0, 0.012);
      b.box(0, 0.15, pouch.z, 0.34, 0.19, 0.03, shade(top, -0.1));
      for (const side of [-1, 1]) {
        b.box(side * 0.165, 0.15, pouch.z + 0.006, 0.014, 0.15, 0.03, shade(top, -0.32), { rz: side * -0.35 });
        const cord = front(0.6, side * 0.22, 0.012);
        b.cyl(cord.x, 0.6, cord.z, 0.009, 0.2, CLOTH_WHITE, { seg: 6, rx: -0.12 });
        b.ball(cord.x, 0.495, cord.z + 0.012, 0.014, 0.02, 0.014, CLOTH_WHITE, { seg: 6 });
      }
      if (fine) strip(b, wear, 0.26, 0.74, 0, 0.008, shade(top, -0.3), { aspect, lift: 0.004 }); // zip line
    } else if (style.gown) {
      // Buba: an embroidered round neckline, a coral necklace and an ipele over the shoulder.
      band(b, wear, neckline - 0.02, 0.04, GOLD, { seg: SEG, aspect, lift: 0.006 });
      for (let i = 0, n = fine ? 16 : 8; i < n; i++) { const a = i / n * TAU; b.ball(Math.sin(a) * (m.neck + 0.05), 0.79 - Math.cos(a) * 0.035 - 0.02, Math.cos(a) * (m.neck + 0.05) * 0.95 + 0.01, 0.021, 0.021, 0.021, CORAL, { seg: 8 }); }
      const sash = plain ? shade(top, 0.3) : colours[1];
      for (const face of [0.62, Math.PI - 0.62]) strip(b, wear, 0.2, 0.7, face, 0.12, sash, { aspect, lift: 0.012, thick: 0.022 });
      b.box(m.shoulder * 0.52, 0.735, 0, 0.12, 0.03, radiusAt(wear, 0.7) * aspect * 1.75, sash, { rz: -0.3 });
      for (const side of [-1, 1]) b.at(0, -HIP_Y, 0, 0, () => b.ball(side * 0.262, 2.09, 0, 0.022, 0.034, 0.022, GOLD, { seg: 8 })); // ear studs
    } else if (style.sport) {
      // Jersey: contrast side panels, a V-neck, and a number front and back.
      const second = bottoms === top ? CLOTH_WHITE : bottoms;
      for (const side of [-1, 1]) strip(b, wear, hem + 0.04, 0.5, side * Math.PI / 2, 0.11, second, { aspect, lift: 0.004 });
      band(b, wear, neckline - 0.012, 0.03, second, { seg: SEG, aspect, lift: 0.006 });
      b.quad(0, 0.705, depthAt(0.705) + 0.008, 0.11, 0.11, second, { rz: Math.PI / 4, rx: -0.25 });
      b.quad(0, 0.725, depthAt(0.725) + 0.011, 0.07, 0.07, skin, { rz: Math.PI / 4, rx: -0.25 });
      const digits = { 1: ['010', '110', '010', '010', '111'], 0: ['111', '101', '101', '101', '111'] };
      const number = (text, a0, y0, size) => [...text].forEach((digit, n) => digits[digit].forEach((row, j) => [...row].forEach((on, i) => {
        if (on !== '1') return;
        const dx = ((n - (text.length - 1) / 2) * 4 + (i - 1)) * size, p = onLoft(wear, aspect, y0 - j * size, a0, 0.006);
        b.quad(p.x + Math.cos(p.ry) * dx, y0 - j * size, p.z - Math.sin(p.ry) * dx, size * 1.04, size * 1.04, CLOTH_WHITE, { ry: p.ry });
      })));
      number('10', 0, 0.5, fine ? 0.034 : 0.04);
      number('10', Math.PI, 0.6, fine ? 0.05 : 0.06);
    } else if (style.tunic) {
      // Kaftan: a stand collar, a buttoned placket with embroidery beside it, and slits at the sides.
      b.cyl(0, 0.79, 0, m.neck + 0.024, 0.06, shade(top, -0.12), { seg: 20, top: 0.94, open: true });
      strip(b, wear, 0.3, 0.76, 0, 0.055, shade(top, -0.14), { aspect, lift: 0.006 });
      for (const side of [-1, 1]) strip(b, wear, 0.26, 0.74, side * 0.17, 0.012, GOLD, { aspect, lift: 0.008 });
      for (const y of [0.38, 0.5, 0.62, 0.72]) { const p = front(y, 0, 0.014); b.cyl(0, y, p.z, 0.013, 0.008, GOLD, { seg: 8, rx: Math.PI / 2 }); }
      band(b, wear, 0.27, 0.014, GOLD, { seg: SEG, aspect, lift: 0.004 });
      if (hem < -0.2) for (const side of [-1, 1]) strip(b, wear, hem, hem + 0.2, side * Math.PI / 2, 0.014, shade(top, -0.6), { aspect, lift: 0.004 });
      if (woman && fine) for (const a of [0.9, 2.1, 3.14, 4.2, 5.4]) strip(b, wear, hem + 0.04, -0.1, a, 0.014, shade(top, -0.14), { aspect, lift: 0.002, thick: 0.012 }); // folds
      if (fine) { const p = front(0.5, 0.78, 0.008); b.box(p.x, 0.5, p.z, 0.085, 0.09, 0.008, shade(top, -0.1), { ry: p.ry }); }
    } else if (style.dress) {
      // Gown: a scooped neckline, a sash at the waist with a bow, and a pendant.
      band(b, wear, neckline - 0.014, 0.028, bottoms, { seg: SEG, aspect, lift: 0.006 });
      band(b, wear, 0.25, 0.07, bottoms, { seg: SEG, aspect, lift: 0.01 });
      const knot = onLoft(wear, aspect, 0.25, 0.6, 0.02);
      b.ball(knot.x, 0.25, knot.z, 0.035, 0.035, 0.025, shade(bottoms, -0.15), { seg: 10 });
      for (const tail of [-0.3, 0.25]) b.box(knot.x + tail * 0.12, 0.17, knot.z + 0.008, 0.045, 0.16, 0.012, bottoms, { rz: tail, ry: knot.ry });
      if (fine) b.ball(0, 0.71, radiusAt(body, 0.71) * aspect + 0.008, 0.016, 0.02, 0.01, GOLD, { seg: 8 });
    } else if (!style.robe) {
      // A crew-neck tee: ribbed collar and a chest pocket.
      band(b, wear, neckline - 0.014, 0.03, trim, { seg: SEG, aspect, lift: 0.006 });
      if (!style.vest) { const p = front(0.5, 0.66, 0.008); b.box(p.x, 0.5, p.z, 0.095, 0.1, 0.008, shade(top, -0.12), { ry: p.ry }); if (fine) b.box(p.x, 0.552, p.z + 0.002, 0.097, 0.012, 0.01, trim, { ry: p.ry }); }
    }
    if (style.robe) {
      // Agbada: a wide open robe over the tunic, its sides gathered up onto the shoulders, embroidered at the chest.
      const robe = smooth([[sitting ? -0.14 : -0.64, 0.41], [-0.2, 0.42], [0.3, 0.375], [0.6, 0.34], [0.72, 0.305], [0.775, 0.27]], per), ra = 0.5;
      b.cyl(0, 0.79, 0, m.neck + 0.024, 0.05, shade(top, -0.12), { seg: 20, top: 0.94, open: true }); // the buba's collar
      loft(b, robe, dyed, { seg: SEG, aspect: ra });
      band(b, robe, robe[0][0] + 0.025, 0.05, trim, { seg: SEG, aspect: ra });
      b.cyl(0, robe[0][0] + 0.03, 0, 0.4, 0.02, shade(top, -0.6), { seg: SEG, sz: ra });
      cloth(robe, { aspect: ra, from: robe[0][0] + 0.06, to: 0.2, around: 10, seg: SEG });
      const emb = plain ? GOLD : colours[1];
      strip(b, robe, 0.22, 0.74, 0, 0.25, emb, { aspect: ra, lift: 0.006 });
      strip(b, robe, 0.27, 0.74, 0, 0.17, shade(top, -0.1), { aspect: ra, lift: 0.009 });
      strip(b, robe, 0.3, 0.74, 0, 0.02, shade(top, -0.6), { aspect: ra, lift: 0.012 }); // neck slit
      for (const side of [-1, 1]) {
        strip(b, robe, 0.3, 0.7, side * 0.11, 0.012, emb, { aspect: ra, lift: 0.012 });
        if (fine) for (const y of [0.36, 0.46, 0.56]) { const p = onLoft(robe, ra, y, side * 0.22, 0.014); b.quad(p.x, y, p.z, 0.04, 0.04, emb, { ry: p.ry, rz: Math.PI / 4 }); }
        // Folds of cloth gathered on each shoulder
        for (let i = 0; i < 3; i++) b.ball(side * (m.shoulder + 0.07 + i * 0.012), 0.69 - i * 0.055, 0, 0.16 - i * 0.012, 0.045, 0.2 - i * 0.012, i % 2 ? shade(top, -0.1) : top, { seg: 16, rz: side * -0.42 });
        if (fine) for (const a of [0.75, 1.15, 2.0, 2.4]) strip(b, robe, robe[0][0] + 0.06, 0.52, side * a, 0.018, shade(top, -0.13), { aspect: ra, lift: 0.002, thick: 0.014 });
      }
    }
    if (style.vest) {
      // Hi-vis vest: reflective bands round the body and over both shoulders.
      const vest = padded(wear, 0.024), panel = clip(vest, 0.04, 0.72), reflect = '#eef0b4';
      loft(b, panel, '#f47f1b', { seg: SEG, aspect });
      for (const y of [0.16, 0.38]) band(b, vest, y, 0.06, reflect, { seg: SEG, aspect });
      for (const side of [-1, 1]) for (const face of [0, Math.PI]) strip(b, vest, 0.41, 0.7, face + side * 0.5, 0.055, reflect, { aspect });
      strip(b, vest, 0.05, 0.7, 0, 0.02, '#c9650f', { aspect, lift: 0.004 }); // zip
      if (fine) band(b, vest, 0.055, 0.03, '#c9650f', { seg: SEG, aspect, lift: 0.002 });
    }
    // Things worn on the body
    if (has('chain')) {
      if (!fine) b.cyl(0, 0.77, 0.02, m.neck + 0.05, 0.02, GOLD, { seg: 14, sz: 1.1, rx: 0.5, open: true });
      for (let i = 0; i < (fine ? 30 : 0); i++) {
        const a = i / 30 * TAU, t = (1 + Math.cos(a)) / 2, y = 0.8 - t * 0.17, x = Math.sin(a) * (m.neck + 0.03 + t * 0.045);
        const z = Math.cos(a) > 0 ? Math.max(Math.cos(a) * (m.neck + 0.03), depthAt(y) * Math.sqrt(Math.max(0, 1 - (x / radiusAt(wear, y)) ** 2)) * t + 0.012) : Math.cos(a) * (m.neck + 0.035);
        b.ball(x, y, z, 0.012, 0.012, 0.012, GOLD, { seg: 6 });
      }
      b.box(0, 0.61, depthAt(0.61) + 0.016, 0.03, 0.04, 0.008, GOLD, { rz: Math.PI / 4 });
    }
    if (has('backpack')) {
      const pack = '#3b4658', back = depthAt(0.42), accent = accessoryColour(look, colours);
      b.ball(0, 0.4, -(back + 0.08), 0.19, 0.26, 0.115, pack, { seg: 18 });
      b.ball(0, 0.27, -(back + 0.16), 0.135, 0.11, 0.05, shade(pack, 0.25), { seg: 12 }); // front pocket
      b.box(0, 0.33, -(back + 0.208), 0.16, 0.008, 0.01, accent); // zip
      b.cyl(0, 0.67, -(back + 0.06), 0.03, 0.012, shade(pack, -0.3), { seg: 8, rz: Math.PI / 2, sz: 1.8 }); // grab handle
      for (const side of [-1, 1]) {
        strip(b, wear, 0.16, 0.745, side * 0.48, 0.05, shade(pack, -0.2), { aspect, lift: 0.01, thick: 0.016 });
        b.box(side * radiusAt(wear, 0.73) * 0.46, 0.775, -0.02, 0.05, 0.016, depthAt(0.73) * 1.5, shade(pack, -0.2));
      }
    }
    if (has('handbag')) {
      const leather = '#b5763a', p = onLoft(wear, aspect, -0.03, 2.25, 0.07);
      b.box(p.x, -0.05, p.z, 0.25, 0.19, 0.085, leather, { ry: p.ry });
      b.box(p.x + Math.sin(p.ry) * 0.045, 0.0, p.z + Math.cos(p.ry) * 0.045, 0.255, 0.09, 0.012, shade(leather, -0.22), { ry: p.ry }); // flap
      b.box(p.x + Math.sin(p.ry) * 0.054, -0.04, p.z + Math.cos(p.ry) * 0.054, 0.03, 0.03, 0.01, GOLD, { ry: p.ry });
      sling(b, wear, aspect, [0.05, 1.75], [0.75, -0.42], 0.013, shade(leather, -0.22), fine ? 9 : 5, 0.02);
      sling(b, wear, aspect, [0.05, 2.75], [0.75, Math.PI + 0.42], 0.013, shade(leather, -0.22), fine ? 9 : 5, 0.02);
    }

    part(b, 'head', 0, 0.86, 0, () => b.at(0, -HIP_Y - 0.86, 0, 0, () => {
      headHigh(b, look, woman, fine);
      const hat = style.helmet || look.hair === 'gele' ? null : look.accessories.find((id) => ACCESSORY_SLOTS[id] === 'head');
      const hair = (style.helmet || hat) && !HANGING.has(look.hair) ? 'lowcut' : look.hair;
      (HAIR_HIGH[hair] || HAIR_HIGH.lowcut)(b, look.hairColor, look, colours, fine);
      if (hat) headwear(b, hat, accessoryColour(look, colours), fine);
      if (has('sunglasses')) eyewear(b, 'sunglasses', FACES[look.face], fine);
      else if (has('glasses')) eyewear(b, 'glasses', FACES[look.face], fine);
      if (has('earrings')) for (const side of [-1, 1]) {
        if (!fine) { b.ball(side * 0.262, 2.085, 0.002, 0.024, 0.03, 0.024, GOLD, { seg: 8 }); continue; }
        const hoop = Array.from({ length: 9 }, (_, i) => [side * 0.258, 2.078 + Math.cos(i / 8 * TAU) * 0.034, 0.002 + Math.sin(i / 8 * TAU) * 0.034]);
        chain(b, hoop, 0.006, 0.006, GOLD, 5);
      }
      if (style.helmet) {
        const hard = '#f2c230';
        b.ball(0, 2.39, -0.01, 0.3, 0.23, 0.31, hard, { seg: 24 });
        b.cyl(0, 2.36, 0.03, 0.34, 0.03, hard, { seg: 24, sz: 1.12 });
        b.box(0, 2.6, -0.01, 0.07, 0.05, 0.5, shade(hard, -0.12));
        b.cyl(0, 2.39, -0.01, 0.303, 0.035, shade(hard, -0.14), { seg: 24, sz: 1.03, open: true });
      }
      markerOf(b, marker);
    }));

    // Arms and hands
    const sp = 0.014 + bulk * 0.35;
    const upperArm = smooth([[-0.42, m.elbow], [-0.2, (m.arm + m.elbow) / 2 + 0.005], [0, m.arm]], per);
    const foreArm = smooth([[-0.38, m.wrist], [-0.14, m.elbow * 1.02], [0, m.elbow]], per);
    for (const side of [0, 1]) {
      const dir = side ? 1 : -1, [pitch, roll] = joints.arm[side];
      const sleeve = style.sleeve, wide = sleeve === 'wide', covered = sleeve === 'long';
      const sleeveColour = wide && !plain ? colours[1] : top;
      const cap = (r, colour) => b.ball(0, 0, 0, r, r * 0.92, r, colour, { seg: 14 });
      const worn = () => {
        if (side && has('watch')) {
          const r = radiusAt(foreArm, -0.325) + (covered ? sp : 0);
          b.cyl(0, -0.325, 0, r + 0.006, 0.028, '#23262d', { seg: 14 });
          b.cyl(dir * (r + 0.008), -0.325, 0, 0.025, 0.01, GOLD, { seg: 12, rz: Math.PI / 2 });
          b.cyl(dir * (r + 0.014), -0.325, 0, 0.018, 0.004, '#101216', { seg: 12, rz: Math.PI / 2 });
        }
        if (!side && has('beads')) {
          const r = radiusAt(foreArm, -0.335) + (covered ? sp : 0) + 0.008, count = fine ? 14 : 0;
          if (!fine) b.cyl(0, -0.335, 0, r + 0.004, 0.026, CORAL, { seg: 14 });
          for (let i = 0; i < count; i++) b.ball(Math.sin(i / count * TAU) * r, -0.335 + (i % 2) * 0.004, Math.cos(i / count * TAU) * r, 0.014, 0.014, 0.014, i % 3 === 0 ? GOLD : i % 3 === 1 ? CORAL : '#2f7d6b', { seg: 6 });
        }
      };
      const upper = covered
        ? { length: 0.42, rings: padded(upperArm, sp), colour: top, extra: () => { cap(m.arm + sp, top); cloth(padded(upperArm, sp), { from: -0.4, to: -0.04, size: 0.62, around: 4, seg: 16 }); } }
        : { length: 0.42, rings: upperArm, colour: skin, extra: () => {
          if (wide) {
            const bell = smooth([[-0.42, m.arm + 0.105], [-0.2, m.arm + 0.058], [0, m.arm + 0.02]], per);
            cap(m.arm + 0.02, sleeveColour);
            loft(b, bell, sleeveColour, { seg: 16 });
            b.cyl(0, -0.405, 0, m.arm + 0.108, 0.04, plain ? GOLD : colours[2], { seg: 16, open: true });
            b.cyl(0, -0.418, 0, m.arm + 0.1, 0.004, shade(sleeveColour, -0.5), { seg: 16 });
          } else if (sleeve === 'cap') {
            b.ball(0, -0.025, 0, m.arm + 0.034, 0.075, m.arm + 0.034, top, { seg: 16 });
            b.cyl(0, -0.085, 0, m.arm + 0.02, 0.02, bottoms, { seg: 16, open: true });
          } else {
            cap(m.arm + sp, top);
            cover(b, upperArm, -0.2, 0, sp, top, 16);
            b.cyl(0, -0.195, 0, radiusAt(upperArm, -0.195) + sp + 0.004, 0.03, style.sport && bottoms !== top ? bottoms : trim, { seg: 16, open: true });
            b.cyl(0, -0.208, 0, radiusAt(upperArm, -0.2) + sp - 0.002, 0.004, shade(top, -0.55), { seg: 16 });
            cloth(padded(clip(upperArm, -0.2, 0), sp), { from: -0.19, to: -0.02, size: 0.6, around: 4, seg: 16 });
          }
        } };
      const lower = covered
        ? { length: 0.38, rings: padded(foreArm, sp), colour: top, extra: () => {
          b.cyl(0, -0.352, 0, m.wrist + sp + 0.005, 0.05, style.collar ? CLOTH_WHITE : style.tunic || style.robe ? GOLD : trim, { seg: 16, open: true });
          b.cyl(0, -0.378, 0, m.wrist + sp, 0.004, shade(top, -0.55), { seg: 16 });
          if (fine && style.collar) b.ball(dir * (m.wrist + sp + 0.008), -0.35, 0, 0.008, 0.008, 0.008, GOLD, { seg: 6 }); // cufflink
          worn();
        } }
        : { length: 0.38, rings: foreArm, colour: skin, extra: () => { if (style.vest) b.cyl(0, -0.3, 0, radiusAt(foreArm, -0.3) + 0.005, 0.035, INK, { seg: 16, open: true }); worn(); } };
      upper.joint = covered ? top : skin;
      limbHigh(b, side ? 'armL' : 'armR', dir * (m.shoulder - 0.004 + bulk), SHOULDER_Y, 0, pitch, dir * (style.robe ? Math.max(roll, 0.3) : roll), upper, joints.fore[side], lower, (end) => {
        if (fine) handHigh(b, m, end, dir, skin);
        else { b.ball(0, end - 0.074, 0, m.wrist * 0.74, 0.098, m.wrist * 1.3, skin, { seg: 10 }); b.ball(dir * -0.01, end - 0.058, m.wrist * 1.24, 0.023, 0.046, 0.025, skin, { seg: 6, rx: 0.3 }); }
      });
    }
  }, joints.lean);
}

/**
 * Draw one avatar into a batch.
 * options: { x, y, z, ry, pose (one of POSES), stride (the phase of 'walk' or 'jog', 0 … 1), seat
 * (seat height when sitting), seed, scale, marker ('crown' = you, 'npc' = green dot, 'player' =
 * blue dot), detail ('low' — the default — | 'medium' | 'high'; see the top of this file) }
 * Returns { look, top } where top is the height just above the head, for a name tag.
 */
export function drawAvatar(b, input, { x = 0, y = 0, z = 0, ry = 0, pose = 'stand', stride, seat = 0.6, seed, scale = 1, marker = null, detail = 'low' } = {}) {
  const look = normalizeLook(input, seed);
  // A rig is drawn upright and still: its pose is set afterwards by turning its parts (poseAvatar).
  const posed = jointsOf(pose, stride), joints = b.part ? { ...posed, lean: 0, bob: 0 } : posed, sitting = pose === 'sit';
  const lift = (sitting ? seat + 0.13 - 1.05 : 0) + (joints.bob || 0);
  b.at(x, y + lift * scale, z, ry, () => {
    if (detail === 'high' || detail === 'medium') drawHigh(b, look, { joints, sitting, marker }, detail === 'high');
    else drawLow(b, look, { joints, sitting, marker });
  }, 0, 0, scale);
  return { look, top: y + (lift + 2.95) * scale };
}

/** A batch that draws each named part (see part()) into a batch of its own, in that part's own coordinates. */
function rigBatch(THREE) {
  const root = createBatch(THREE), parts = new Map(), pivots = new Map();
  let current = root;
  const rig = {
    isBatch: true, root, parts, pivots,
    part(name, x, y, z, fn) {
      pivots.set(name, current.world(x, y, z));
      if (!parts.has(name)) parts.set(name, createBatch(THREE));
      const previous = current;
      current = parts.get(name);
      try { fn(rig); } finally { current = previous; }
    },
    world: (x, y, z) => current.world(x, y, z),
    get triangles() { return [root, ...parts.values()].reduce((sum, batch) => sum + batch.triangles, 0); },
  };
  for (const name of ['box', 'cyl', 'cone', 'ball', 'ico', 'quad', 'disc', 'at', 'light']) rig[name] = (...args) => { current[name](...args); return rig; };
  return rig;
}

/**
 * Pose a rigged avatar by turning its parts — no geometry is rebuilt, so this is what a scene
 * calls while its player walks. options: { pose (default 'stand'), stride (0 … 1 for 'walk' and
 * 'jog') }. Shoulders and hips turn, the torso leans and the whole body bobs; elbows and knees
 * keep the bend the rig was built with. Returns the avatar.
 */
export function poseAvatar(avatar, { pose = 'stand', stride } = {}) {
  const parts = avatar?.userData?.parts;
  if (!parts) return avatar;
  const joints = jointsOf(pose, stride);
  parts.torso.rotation.x = joints.lean || 0;
  parts.body.position.y = joints.bob || 0;
  parts.legR.rotation.x = joints.leg[0]; parts.legL.rotation.x = joints.leg[1];
  parts.armR.rotation.set(joints.arm[0][0], 0, -joints.arm[0][1]); parts.armL.rotation.set(joints.arm[1][0], 0, joints.arm[1][1]);
  return avatar;
}

/**
 * One avatar as its own THREE.Group. Call group.userData.dispose() (or dispose the kit) to free it.
 * userData: { look, top, triangles, dispose }.
 *
 * With `rig: true` the avatar is built as movable parts instead of one mesh, so a scene can animate
 * it by rotating transforms only: userData.parts = { body, torso, head, armL, armR, legL, legR },
 * each a THREE.Group whose origin is its pivot (hips, neck, shoulders, hip joints; rotation order
 * 'YXZ'). `body` holds everything and is what bobs; head and arms are children of `torso`, so they
 * follow its lean. Use poseAvatar(avatar, { pose, stride }) to pose it. A rig costs one draw call
 * per part (six, plus one for a marker) instead of one or two.
 */
export function buildAvatar(kit, look, options = {}) {
  const { THREE } = kit;
  const { x = 0, y = 0, z = 0, ry = 0, rig = false, ...rest } = options;
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = ry;
  const registry = kitResources(kit).disposers, meshes = [];
  const dispose = () => { registry.delete(dispose); releaseObjects(meshes); group.parent?.remove(group); if (group.userData.parts) group.clear(); };
  if (!rig) {
    const batch = createBatch(THREE);
    const drawn = drawAvatar(batch, look, rest);
    const built = batch.build(sceneMaterials(kit));
    built.meshes.forEach((mesh) => { meshes.push(mesh); group.add(mesh); });
    registry.add(dispose);
    group.userData = { look: drawn.look, top: drawn.top, triangles: built.triangles, dispose };
    return group;
  }
  const { scale = 1, pose = 'stand', stride, ...still } = rest;
  const batch = rigBatch(THREE);
  // Built with the pose's elbow and knee bends, then posed by its transforms.
  const drawn = drawAvatar(batch, look, { ...still, pose: pose === 'sit' ? 'stand' : pose, stride });
  const materials = sceneMaterials(kit);
  const holder = (name, parent, pivot, origin) => {
    const node = new THREE.Group();
    node.name = name; node.rotation.order = 'YXZ';
    node.position.set(pivot.x - origin.x, pivot.y - origin.y, pivot.z - origin.z);
    parent.add(node);
    return node;
  };
  const fill = (node, source, offset) => source?.build(materials).meshes.forEach((mesh) => { mesh.position.set(-offset.x, -offset.y, -offset.z); meshes.push(mesh); node.add(mesh); });
  const zero = { x: 0, y: 0, z: 0 }, hips = { x: 0, y: HIP_Y, z: 0 };
  const body = holder('body', group, zero, zero);
  const parts = { body, torso: holder('torso', body, hips, zero) };
  fill(parts.torso, batch.root, hips);
  for (const name of ['head', 'armL', 'armR', 'legL', 'legR']) {
    const pivot = batch.pivots.get(name) ?? hips, upper = name === 'legL' || name === 'legR' ? body : parts.torso;
    parts[name] = holder(name, upper, pivot, upper === body ? zero : hips);
    fill(parts[name], batch.parts.get(name), zero);
  }
  group.scale.setScalar(scale);
  registry.add(dispose);
  group.userData = { look: drawn.look, top: y + 2.95 * scale, triangles: batch.triangles, dispose, parts };
  return poseAvatar(group, { pose: pose === 'sit' ? 'stand' : pose, stride });
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
      x: person.x || 0, y: person.y || 0, z: person.z || 0, ry: person.ry || 0, pose: person.pose, seat: person.seat, detail: person.detail,
      seed: person.seed ?? person.id ?? person.name ?? index, marker: person.marker === undefined ? kind : person.marker,
    });
    return tagFor(person, index, drawn.top);
  });
}

/**
 * A small crowd of other players and NPCs, merged into at most two meshes.
 * people: [{ id, name, kind: 'player' | 'npc', look?, seed?, x, z, y?, ry?, pose?, seat?, detail? }]
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
