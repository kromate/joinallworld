/**
 * OWNER: scenes
 * Procedural low-poly people.
 *
 *   normalizeLook(look, seed)            → a complete look; anything missing or unknown is chosen
 *                                          deterministically from `seed` (e.g. a public player id)
 *   drawAvatar(batch, look, options)     → draws one avatar into a geometry batch (build.js)
 *   buildAvatar(kit, look, options)      → THREE.Group holding one avatar (one or two meshes)
 *   buildCrowd(kit, people, options)     → { group, tags, triangles, dispose } — every person in
 *                                          one merged mesh, with name-tag data for the DOM
 *
 * A look is `{ body, hair, outfit, fabric, skin, hairColor, outfitColor, bottomsColor }`
 * (state.onboarding.look). Option ids are listed in LOOK_OPTIONS; matching ignores case, spaces
 * and punctuation ('Low cut' = 'lowcut'). Colours may be a swatch id, a swatch index or '#rrggbb'.
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

const OUTFIT = {
  casual: { sleeve: 'short' },
  office: { sleeve: 'long', collar: true },
  owambe: { sleeve: 'wide', gown: true },
  sitework: { sleeve: 'short', vest: true, helmet: true, shoe: '#8a6a3c' },
  hoodie: { sleeve: 'long', hood: true },
  chill: { sleeve: 'short', shorts: true, open: true, shoe: '#d9cfb8' },
};

const shade = (hex, amount) => {
  const n = parseInt(hex.slice(1), 16);
  const channel = (shift) => Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * (1 + amount) + (amount > 0 ? 255 * amount * 0.25 : 0))));
  return `#${((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, '0')}`;
};

/** Colour list a fabric is woven from: [main, second, third]. */
function fabricColours(look) {
  const main = look.outfitColor, palette = LOOK_OPTIONS.outfitColor, at = palette.findIndex((swatch) => swatch.hex === main);
  const other = (step) => palette[((at < 0 ? hash(main) : at) + step) % palette.length].hex;
  if (look.fabric === 'ankara') return [main, other(3), other(7)];
  if (look.fabric === 'adire') return [main, '#e6ebf3', shade(main, -0.3)];
  if (look.fabric === 'asooke') return [main, '#e2c15a', shade(main, -0.35)];
  return [main, main, main];
}

/** A box of cloth, split into blocks, bands or stripes according to the fabric. */
function cloth(b, x, y, z, w, h, d, look, colours) {
  const [main, second, third] = colours;
  if (look.fabric === 'ankara') {
    const order = [main, second, third, third, main, second];
    for (let row = 0; row < 3; row++) for (let col = 0; col < 2; col++) b.box(x + (col - 0.5) * w / 2, y + (1 - row) * h / 3, z, w / 2, h / 3, d, order[row * 2 + col]);
  } else if (look.fabric === 'adire') {
    const bands = [0.3, 0.1, 0.2, 0.1, 0.3];
    let top = y + h / 2;
    bands.forEach((part, i) => { b.box(x, top - part * h / 2, z, w, part * h, d, i % 2 ? second : i === 2 ? third : main); top -= part * h; });
  } else if (look.fabric === 'asooke') {
    const stripes = [0.26, 0.08, 0.32, 0.08, 0.26];
    let left = x - w / 2;
    stripes.forEach((part, i) => { b.box(left + part * w / 2, y, z, part * w, h, d, i % 2 ? second : i === 2 ? third : main); left += part * w; });
  } else {
    b.box(x, y, z, w, h, d, main);
  }
}

const HAIR = {
  bald() {},
  lowcut(b, c) { b.ball(0, 2.31, -0.015, 0.273, 0.2, 0.27, c, { seg: 7 }); },
  classic(b, c, look) {
    b.ball(0, 2.33, -0.02, 0.285, 0.21, 0.28, c, { seg: 7 });
    if (look.body === 'woman') b.ball(0, 2.13, -0.09, 0.33, 0.34, 0.27, c, { seg: 7 });
    else b.ball(0.07, 2.45, 0.1, 0.17, 0.08, 0.14, c, { seg: 6 });
  },
  afro(b, c) { b.ball(0, 2.38, -0.05, 0.43, 0.4, 0.41, c, { seg: 8 }); },
  curls(b, c) {
    b.ball(0, 2.32, -0.02, 0.28, 0.2, 0.275, c, { seg: 7 });
    for (let i = 0; i < 6; i++) b.ico(Math.sin(i * 1.05) * 0.19, 2.47 + (i % 2) * 0.04, Math.cos(i * 1.05) * 0.17 - 0.02, 0.12, 0.11, 0.12, c);
  },
  bun(b, c) {
    b.ball(0, 2.32, -0.02, 0.28, 0.2, 0.275, c, { seg: 7 });
    b.ball(0, 2.6, -0.1, 0.16, 0.15, 0.16, c, { seg: 6 });
  },
  ponytail(b, c) {
    b.ball(0, 2.32, -0.02, 0.28, 0.2, 0.275, c, { seg: 7 });
    b.ball(0, 2.42, -0.28, 0.1, 0.1, 0.1, c, { seg: 6 });
    b.ball(0, 2.08, -0.4, 0.1, 0.34, 0.1, c, { seg: 6, rx: 0.3 });
  },
  long(b, c) {
    b.ball(0, 2.33, -0.02, 0.29, 0.21, 0.285, c, { seg: 7 });
    b.box(0, 1.84, -0.2, 0.52, 0.8, 0.14, c);
    for (const side of [-1, 1]) b.box(side * 0.26, 1.98, -0.03, 0.1, 0.52, 0.22, c);
  },
  braids(b, c) {
    b.ball(0, 2.32, -0.02, 0.28, 0.2, 0.275, c, { seg: 7 });
    for (let i = 0; i < 7; i++) {
      const turn = (i - 3) * 0.42, length = 0.62 + (i % 2) * 0.12;
      b.box(Math.sin(turn) * 0.27, 2.3 - length / 2, -Math.cos(turn) * 0.26, 0.075, length, 0.075, c);
    }
  },
  locs(b, c) {
    b.ball(0, 2.34, -0.02, 0.29, 0.21, 0.285, c, { seg: 7 });
    for (let i = 0; i < 6; i++) {
      const turn = (i - 2.5) * 0.5;
      b.box(Math.sin(turn) * 0.29, 2.08, -Math.cos(turn) * 0.27, 0.12, 0.5 + (i % 3) * 0.06, 0.12, c, { rz: Math.sin(turn) * 0.16 });
    }
  },
  gele(b, c, look, colours) {
    b.ball(0, 2.28, -0.02, 0.272, 0.17, 0.27, c, { seg: 7 });
    b.cyl(0, 2.47, -0.02, 0.27, 0.3, colours[0], { top: 1.45, seg: 8 });
    b.box(0, 2.7, -0.06, 0.8, 0.26, 0.09, colours[1], { rx: -0.25 });
    b.box(0.1, 2.76, 0.06, 0.56, 0.2, 0.08, colours[0], { rx: 0.15, rz: 0.12 });
  },
};

function limb(b, x, y, z, pitch, roll, upper, bend, lower, end) {
  b.at(x, y, z, 0, () => {
    b.cyl(0, -upper.length / 2, 0, upper.radius, upper.length, upper.colour, { seg: 5, top: upper.top || 1 });
    b.at(0, -upper.length, 0, 0, () => {
      if (lower) b.cyl(0, -lower.length / 2, 0, lower.radius, lower.length, lower.colour, { seg: 5, open: true });
      end?.(lower ? -lower.length : 0);
    }, bend);
  }, pitch, roll);
}

/**
 * Draw one avatar into a batch.
 * options: { x, y, z, ry, pose ('stand' | 'sit' | 'walk' | 'wave' | 'work' | 'dance'), seat (seat
 * height when sitting), seed, scale, marker ('crown' = you, 'npc' = green dot, 'player' = blue dot) }
 * Returns { look, top } where top is the height just above the head, for a name tag.
 */
export function drawAvatar(b, input, { x = 0, y = 0, z = 0, ry = 0, pose = 'stand', seat = 0.6, seed, scale = 1, marker = null } = {}) {
  const look = normalizeLook(input, seed);
  const style = OUTFIT[look.outfit] || OUTFIT.casual;
  const joints = POSE[pose] || POSE.stand;
  const woman = look.body === 'woman', sitting = pose === 'sit';
  const colours = fabricColours(look);
  const top = look.outfitColor, bottoms = look.bottomsColor, skin = look.skin;
  const skirt = woman && look.outfit === 'office';
  const bareCalf = style.shorts || skirt;
  const shoulder = woman ? 0.33 : 0.4, torsoWidth = (woman ? 0.52 : 0.62) + (style.hood ? 0.08 : 0), torsoDepth = style.hood ? 0.4 : 0.34;
  const lift = sitting ? seat + 0.13 - 1.05 : 0;

  b.at(x, y + lift * scale, z, ry, () => {
    // Legs and lower garment
    if (!style.gown || sitting) {
      for (const side of [0, 1]) {
        const sx = (side ? 1 : -1) * 0.16;
        limb(b, sx, 1.04, 0, joints.leg[side], 0,
          { length: 0.5, radius: 0.12, colour: style.gown || skirt ? shade(bottoms, -0.12) : bottoms },
          joints.calf[side],
          { length: 0.46, radius: 0.095, colour: style.gown ? bottoms : bareCalf ? skin : bottoms },
          (end) => b.box(0, end - 0.06, 0.07, 0.22, 0.13, 0.42, style.shoe || '#262b31'));
      }
    } else {
      for (const side of [-1, 1]) b.box(side * 0.16, 0.065, 0.07, 0.22, 0.13, 0.42, '#262b31');
    }
    if (style.gown) {
      const rings = look.fabric === 'plain' ? [bottoms, bottoms, shade(bottoms, -0.15)] : [colours[0], colours[1], colours[2]];
      if (sitting) b.box(0, 1.02, 0.24, 0.56, 0.3, 0.8, rings[0]);
      else rings.forEach((colour, i) => b.cyl(0, 0.92 - i * 0.33, 0, 0.3 + i * 0.045, 0.34, colour, { seg: 8, top: 0.87 }));
    } else if (skirt) {
      if (sitting) b.box(0, 1.03, 0.2, 0.54, 0.28, 0.7, bottoms);
      else b.cyl(0, 0.84, 0, 0.33, 0.52, bottoms, { seg: 8, top: 0.8 });
    }
    b.box(0, 1.06, 0, woman ? 0.52 : 0.48, 0.24, 0.3, style.gown ? colours[0] : bottoms);

    // Upper body leans from the hips
    b.at(0, 1.06, 0, 0, () => {
      const cy = 0.42;
      cloth(b, 0, cy, 0, torsoWidth, style.open ? 0.82 : 0.72, torsoDepth, look, colours);
      if (style.open) b.quad(0, cy + 0.02, torsoDepth / 2 + 0.012, 0.17, 0.74, '#f1ede2');
      if (style.collar) {
        b.box(0, cy + 0.36, 0.02, 0.36, 0.07, 0.32, '#f1ede2');
        if (!woman) b.box(0, cy + 0.08, torsoDepth / 2 + 0.012, 0.08, 0.5, 0.02, colours[2] === top ? shade(top, -0.45) : colours[1]);
      }
      if (style.vest) {
        b.box(0, cy + 0.02, 0, torsoWidth + 0.05, 0.6, torsoDepth + 0.06, '#f08a1d');
        for (const band of [0.14, -0.12]) b.box(0, cy + band, 0, torsoWidth + 0.07, 0.07, torsoDepth + 0.08, '#eeeacb');
      }
      if (style.hood) {
        b.ball(0, cy + 0.42, -0.17, 0.24, 0.17, 0.15, top, { seg: 6 });
        b.box(0, cy - 0.18, torsoDepth / 2 + 0.012, 0.36, 0.18, 0.03, shade(top, -0.2));
      }
      if (style.gown) b.box(0, cy + 0.04, torsoDepth / 2 + 0.012, 0.15, 0.86, 0.03, colours[1] === top ? shade(top, 0.35) : colours[1], { rz: 0.62 });
      b.cyl(0, cy + 0.44, 0, 0.09, 0.18, skin, { seg: 5 });
      b.ball(0, 1.14, 0, 0.26, 0.27, 0.26, skin, { seg: 7 });
      b.at(0, -1.06, 0, 0, () => {
        (HAIR[look.hair] || HAIR.lowcut)(b, look.hairColor, look, colours);
        if (style.helmet) {
          b.ball(0, 2.36, 0, 0.31, 0.2, 0.31, '#f2c230', { seg: 7 });
          b.box(0, 2.33, 0.22, 0.42, 0.04, 0.24, '#f2c230');
        }
        if (marker === 'crown') {
          b.cyl(0, 3.1, 0, 0.13, 0.16, '#ffd34d', { seg: 6, top: 1.5, ...GLOW });
          b.cone(0, 2.92, 0, 0.1, 0.16, '#ffd34d', { seg: 4, rz: Math.PI, ...GLOW });
        } else if (marker === 'npc') {
          b.ico(0, 3.02, 0, 0.12, 0.12, 0.12, '#58d68a', GLOW);
        } else if (marker === 'player') {
          b.ico(0, 3.02, 0, 0.11, 0.14, 0.11, '#6fb4ff', GLOW);
        }
      });
      for (const side of [0, 1]) {
        const dir = side ? 1 : -1, [pitch, roll] = joints.arm[side];
        const wide = style.sleeve === 'wide';
        limb(b, dir * shoulder, cy + 0.3, 0, pitch, dir * roll,
          { length: 0.42, radius: wide ? 0.15 : 0.105, colour: wide && look.fabric !== 'plain' ? colours[1] : top, top: wide ? 0.7 : 1 },
          joints.fore[side],
          { length: 0.38, radius: 0.078, colour: style.sleeve === 'long' ? top : skin },
          (end) => b.box(0, end - 0.06, 0, 0.13, 0.15, 0.13, skin));
      }
    }, joints.lean);
  }, 0, 0, scale);
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
