/**
 * OWNER: scenes
 * Kano's old city, each scene asked for through `scene.variant` and held in VARIANTS[kind][variant]; they reach the
 * scene registry through src/scene/venues-kano.ts, which also uses the helpers exported here.
 *
 *   walk / kano-palace-gate       the forecourt outside a palace gate: a high earth wall, a gatehouse with moulded relief and horned pinnacles
 *   worship / kano-central-mosque a white mosque with a green dome and twin minarets over a wide prayer court
 *   market / kano-dye-pits        a mud-walled yard of round indigo pits, dyers at work and long cloths drying
 *   market / kano-kurmi           narrow lanes of small earth booths under mat awnings: leather, calabashes, caps, crafts
 *   office / kano-museum          a low earth house with a decorated porch round a court of outdoor exhibits
 *   walk / kano-dala              the flat top of a hill at the head of a long flight of steps, the flat-roofed city below
 *   walk / kano-goron-dutse       the foot of a rocky hill: boulders, a trail winding up, thorn trees
 *   walk / kano-gate-nassarawa    a city gate with one tall arch between two round towers, a road through it
 *   walk / kano-gate-mata         a long gate with twin arches and a stepped parapet over a divided road
 *   walk / kano-kabuga-site       a road passing under a modern bridge, with a fenced fragment of old earth wall and a plaque
 *
 * Every sign is drawn from the venue's own label (context.label) or is a plain word; nothing here names a place.
 * Scenes are static and keep to the geometry budget of the others. Scene definition format: see venues-outdoor.ts.
 */
import { GLOW } from './build.ts';
import type { Batch, Colour, SceneCamera, SceneDef } from './types.ts';
import { ground, bench, palm, bush, lampPost, ropeLine, fence, sign, landmark, extra, table, stool, car, WOOD, WOOD_DARK, WOOD_LIGHT, METAL, METAL_DARK, BLACK, WARM } from './props.ts';
import { PI, HALF, OPEN, seeded, plain, fit, labelled, horse, drum, adireCloth, FRONT_CROWD, FRONT_SPARE } from './venues-ogun-a.ts';

// ---------------------------------------------------------------------------------------------
// Shared: the colours of earth plaster and dust, Hausa building details, dry-country trees, people.

export const EARTH: readonly Colour[] = ['#c79f6b', '#bb8f5c', '#b08453', '#d3ae7c'];
export const EARTH_DARK = '#8f6a44', RELIEF = '#f0dfb6', DUST = '#d9bc8c', DUST_EDGE = '#a98b5f', MAT = '#cdb06a';
const NEEM: readonly Colour[] = ['#5f8a4a', '#6f9a52', '#4f7a44'];
/** A scene with something tall at its back starts with the whole of it in view. */
export const TALL: SceneCamera = { landscape: [19, 27, 35], portrait: [21, 47, 62], start: 4.2 };
export const LOW: SceneCamera = { landscape: [16.5, 21.8, 28], portrait: [20, 44, 58], start: 4.2 };

export const MAN = (colour: string, more: Record<string, unknown> = {}): Record<string, unknown> => ({ body: 'man', outfit: 'kaftan', outfitColor: colour, accessories: ['fila'], hair: 'lowcut', ...more });
export const WOMAN = (colour: string, more: Record<string, unknown> = {}): Record<string, unknown> => ({ body: 'woman', outfit: 'kaftan', outfitColor: colour, accessories: ['headwrap'], ...more });
export const crowdFront = (): [number, number, number][] => FRONT_CROWD.map(([x, z, r]) => [x, z, r]);
export const spareFront = (): [number, number][] => FRONT_SPARE.map(([x, z]) => [x, z]);

/** The three places every scene here offers: where a visitor stands, where staff work, where people gather. */
export function places(visit: [number, number, number], work: [number, number, number], people: [number, number]): ReturnType<typeof landmark>[] {
  return [
    landmark('visit', /visit|guest|view|learn|look/, visit[0], visit[1], visit[2]),
    landmark('work', /work|staff|job|shift/, work[0], work[1], work[2], { act: { pose: 'work' } }),
    landmark('people', /people|crowd|meet/, people[0], people[1], 0),
  ];
}

/** Dry, dusty ground with paler swept patches. */
export function dust(b: Batch, rand: () => number, tone: Colour = DUST, edge: Colour = DUST_EDGE): void {
  ground(b, { w: 30, d: 26, color: tone, edge });
  for (let i = 0; i < 9; i++) b.disc(-13 + rand() * 26, 0.045, -11 + rand() * 22, 1.2 + rand() * 1.8, i % 2 ? '#e2c89a' : '#cfae7c', { seg: 9, sz: 0.6 });
}
/** A zanko: the horn-shaped pinnacle at the corner of a Hausa roof. */
export function zanko(b: Batch, x: number, y: number, z: number, s = 1, tone: Colour = EARTH[3]!): void {
  b.cyl(x, y + 0.5 * s, z, 0.3 * s, s, tone, { seg: 5, top: 0.2 });
}
/** A neem tree: a short forked trunk under a wide, feathery crown. */
export function neem(b: Batch, x: number, z: number, s = 1, tone = 0): void {
  b.cyl(x, 1.3 * s, z, 0.24 * s, 2.6 * s, '#6e5a44', { seg: 6, top: 0.7 });
  for (const side of [-1, 1]) b.cyl(x + side * 0.5 * s, 3 * s, z, 0.12 * s, 1.6 * s, '#6e5a44', { seg: 5, rz: -side * 0.6 });
  b.ico(x, 4.3 * s, z, 2.6 * s, 1.3 * s, 2.4 * s, NEEM[tone % 3]!);
  b.ico(x - 1.5 * s, 3.8 * s, z + 0.5 * s, 1.6 * s, 0.9 * s, 1.5 * s, NEEM[(tone + 1) % 3]!);
  b.ico(x + 1.4 * s, 4 * s, z - 0.6 * s, 1.7 * s, s, 1.5 * s, NEEM[(tone + 2) % 3]!);
  b.ico(x + 0.2 * s, 5.1 * s, z + 0.2 * s, 1.5 * s, 0.8 * s, 1.4 * s, NEEM[(tone + 1) % 3]!);
}
/** A thorn tree of the dry country: a thin leaning trunk under a flat crown. */
export function thornTree(b: Batch, x: number, z: number, s = 1): void {
  b.cyl(x, 1.5 * s, z, 0.14 * s, 3 * s, '#75614a', { seg: 5, rz: 0.12 });
  b.ico(x - 0.2 * s, 3.3 * s, z, 2.1 * s, 0.5 * s, 1.8 * s, '#7c9450');
  b.ico(x + 0.9 * s, 3.6 * s, z + 0.3 * s, 1.3 * s, 0.4 * s, 1.2 * s, '#8aa05a');
}
export interface EarthWallOptions { t?: number; tone?: number; gap?: number; pinnacles?: boolean }
/** A length of earth wall along x at depth z: a battered foot, a pale coping and pinnacles along its top. */
export function earthWall(b: Batch, x0: number, x1: number, z: number, h: number, { t = 0.8, tone = 0, gap = 3.2, pinnacles = true }: EarthWallOptions = {}): void {
  const w = x1 - x0, cx = (x0 + x1) / 2;
  b.box(cx, h / 2, z, w, h, t, EARTH[tone % 4]!);
  b.box(cx, 0.5, z, w + 0.1, 1, t + 0.3, EARTH[(tone + 2) % 4]!);
  b.box(cx, h + 0.1, z, w + 0.1, 0.2, t + 0.16, EARTH[3]!);
  if (pinnacles) for (let x = x0 + 0.4; x <= x1 - 0.3; x += gap) zanko(b, x, h + 0.2, z, 0.8);
}
/** The same wall running along z at a given x. */
export function earthWallZ(b: Batch, x: number, z0: number, z1: number, h: number, { t = 0.8, tone = 0, gap = 3.2, pinnacles = true }: EarthWallOptions = {}): void {
  const d = z1 - z0, cz = (z0 + z1) / 2;
  b.box(x, h / 2, cz, t, h, d, EARTH[tone % 4]!);
  b.box(x, 0.5, cz, t + 0.3, 1, d + 0.1, EARTH[(tone + 2) % 4]!);
  b.box(x, h + 0.1, cz, t + 0.16, 0.2, d + 0.1, EARTH[3]!);
  if (pinnacles) for (let z = z0 + 0.4; z <= z1 - 0.3; z += gap) zanko(b, x, h + 0.2, z, 0.8);
}
/**
 * A panel of moulded relief on a wall, centred on x, y, z and facing +z: a raised border round one of four geometric
 * patterns (0 a lattice of diamonds, 1 a knot of interlaced squares, 2 bands of chevrons, 3 upright bars with bosses).
 */
export function relief(b: Batch, x: number, y: number, z: number, w: number, h: number, pattern: number, ry = 0, tone: Colour = RELIEF): void {
  b.at(x, y, z, ry, () => {
    b.quad(0, h / 2 - 0.06, 0, w, 0.12, tone); b.quad(0, -h / 2 + 0.06, 0, w, 0.12, tone);
    b.quad(-w / 2 + 0.06, 0, 0, 0.12, h, tone); b.quad(w / 2 - 0.06, 0, 0, 0.12, h, tone);
    const p = ((pattern % 4) + 4) % 4;
    if (p === 0) {
      const n = Math.max(1, Math.round(w / 0.8)), m = Math.max(1, Math.round(h / 0.8)), s = Math.min(w / n, h / m) * 0.46;
      for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) b.quad(-w / 2 + (i + 0.5) * (w / n), -h / 2 + (j + 0.5) * (h / m), 0.01, s, s, tone, { rz: PI / 4 });
    } else if (p === 1) {
      const s = Math.min(w, h) * 0.5;
      b.quad(0, 0, 0.01, s, s, tone, { rz: PI / 4 }); b.quad(0, 0, 0.02, s * 0.74, s * 0.74, EARTH_DARK, { rz: PI / 4 });
      b.quad(0, 0, 0.03, s * 0.66, s * 0.66, tone); b.quad(0, 0, 0.04, s * 0.42, s * 0.42, EARTH_DARK); b.quad(0, 0, 0.05, s * 0.2, s * 0.2, tone, { rz: PI / 4 });
    } else if (p === 2) {
      const rows = Math.max(1, Math.round(h / 0.7)), n = Math.max(2, Math.round(w / 0.5));
      for (let j = 0; j < rows; j++) for (let i = 0; i < n; i++) b.quad(-w / 2 + (i + 0.5) * (w / n), -h / 2 + (j + 0.5) * (h / rows), 0.01, (w / n) * 1.05, 0.1, tone, { rz: i % 2 ? 0.7 : -0.7 });
    } else {
      const n = Math.max(2, Math.round(w / 0.55));
      for (let i = 0; i < n; i++) { const px = -w / 2 + (i + 0.5) * (w / n); b.quad(px, 0, 0.01, 0.1, h * 0.62, tone); b.quad(px, h * 0.36, 0.012, 0.22, 0.22, tone, { rz: PI / 4 }); }
    }
  });
}
/** A flat-roofed earth house: a parapet with a pinnacle at each corner, a rain spout, a dark door under a pale lintel. */
export function earthHouse(b: Batch, x: number, z: number, w: number, d: number, h: number, tone = 0, ry = 0): void {
  b.at(x, 0, z, ry, () => {
    b.box(0, h / 2, 0, w, h, d, EARTH[tone % 4]!);
    b.box(0, h + 0.14, 0, w + 0.12, 0.28, d + 0.12, EARTH[(tone + 3) % 4]!);
    b.box(0, h + 0.29, 0, w - 0.5, 0.03, d - 0.5, EARTH[(tone + 2) % 4]!);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) zanko(b, sx * (w / 2 - 0.15), h + 0.28, sz * (d / 2 - 0.15), 0.7, EARTH[(tone + 3) % 4]!);
    b.box(w / 2 + 0.25, h - 0.3, d * 0.2, 0.5, 0.1, 0.16, '#6e5a44');
    b.box(-w * 0.18, 0.95, d / 2 + 0.02, 0.9, 1.9, 0.05, '#4a3626'); b.box(-w * 0.18, 2, d / 2 + 0.03, 1.2, 0.12, 0.05, RELIEF);
    b.box(w * 0.26, h * 0.6, d / 2 + 0.02, 0.5, 0.5, 0.05, '#3a2c20');
  });
}
/**
 * The masonry over an arched opening, facing +z: stepped haunches that close in from the piers on either side and the
 * wall above them, so the arch is a real opening that can be walked through.
 */
export function archSpan(b: Batch, cx: number, z: number, half: number, spring: number, rise: number, top: number, depth: number, colour: Colour, pointed = false): void {
  const steps = 6;
  for (let k = 0; k < steps; k++) {
    const t = (k + 0.5) / steps, open = pointed ? half * (1 - t ** 1.7) : half * Math.sqrt(1 - t * t), fill = half - open;
    if (fill > 0.02) for (const s of [-1, 1]) b.box(cx + s * (open + fill / 2), spring + (k + 0.5) * (rise / steps), z, fill, rise / steps + 0.01, depth, colour);
  }
  b.box(cx, (spring + rise + top) / 2, z, half * 2, top - spring - rise, depth, colour);
}
/** An upright slab of earth plaster carrying the venue's own name. */
export function stele(b: Batch, label: string, x: number, z: number, ry = 0, width = 5.4): void {
  const text = plain(label);
  b.at(x, 0, z, ry, () => {
    b.box(0, 1.1, 0, width + 0.8, 2.2, 0.5, EARTH[1]!); b.box(0, 0.3, 0, width + 1.1, 0.6, 0.8, EARTH[2]!); b.box(0, 2.28, 0, width + 1, 0.16, 0.66, EARTH[3]!);
    for (const s of [-1, 1]) zanko(b, s * (width / 2 + 0.3), 2.36, 0, 0.6);
    sign(b, 0, 1.4, 0.27, text, { size: fit(text, width, 0.4), color: '#f6e9c6', board: '#4a3626', pad: 0.16, depth: 0.04 });
  });
}
/** A yellow three-wheeled taxi, its nose at +z. */
export function tricycle(b: Batch, x: number, z: number, ry: number): void {
  b.at(x, 0, z, ry, () => {
    b.box(0, 0.85, -0.3, 1.3, 0.9, 1.7, '#e8b820'); b.box(0, 1.78, -0.1, 1.4, 0.1, 2.3, '#2f2a24');
    for (const sx of [-1, 1]) for (const sz of [-1, 0.75]) b.cyl(sx * 0.62, 1.3, sz, 0.04, 0.9, '#2f2a24', { seg: 4 });
    b.box(0, 0.7, 0.9, 0.5, 0.7, 0.8, '#e8b820'); b.box(0, 1.34, 0.78, 1.1, 0.62, 0.05, '#9cc0d0');
    for (const [sx, sz] of [[-0.62, -0.9], [0.62, -0.9], [0, 1.25]] as [number, number][]) b.cyl(sx, 0.28, sz, 0.28, 0.2, BLACK, { seg: 6, rz: HALF });
  });
}
/** A lantern on a pole: a small lit box under a cap. */
export function lantern(b: Batch, x: number, z: number, h = 2.4, y = 0): void {
  b.cyl(x, y + h / 2, z, 0.05, h, WOOD_DARK, { seg: 4 });
  b.box(x, y + h + 0.16, z, 0.3, 0.36, 0.3, '#ffcf7a', GLOW); b.box(x, y + h + 0.38, z, 0.4, 0.07, 0.4, METAL_DARK);
}
const streaks = (b: Batch, rand: () => number, n: number, x0: number, x1: number, y: number, z: number, skip?: (x: number) => boolean): void => {
  for (let i = 0; i < n; i++) { const x = x0 + rand() * (x1 - x0); if (!skip?.(x)) b.quad(x, y - rand() * 1.4, z, 0.1 + rand() * 0.12, 1 + rand() * 1.6, '#a67d50'); }
};

// ---------------------------------------------------------------------------------------------
// Palace gate: the public forecourt outside the gate. Visitors stay on this side of the rope; the doors are shut.

const palaceGate: SceneDef = {
  mood: 'outdoor', accent: '#c9423a', camera: TALL, walk: OPEN,
  build(b, context) {
    const rand = seeded(11), front = -5.8;
    dust(b, rand);
    b.box(0, 0.05, 3.4, 9, 0.03, 17, '#e6d2a6');
    // The palace wall, high and earth-plastered, right across the back
    earthWall(b, -15, -5.2, -8, 5.6, { t: 1.2 }); earthWall(b, 5.2, 15, -8, 5.6, { t: 1.2, tone: 1 });
    streaks(b, rand, 16, -14.6, 14.6, 5, -7.38, (x) => Math.abs(x) < 5.6);
    for (const x of [-11.6, -8.2, 8.2, 11.6]) relief(b, x, 2.9, -7.37, 2, 2, x < -9 || (x > 0 && x < 9) ? 0 : 3);
    // The gatehouse: two piers and the wall over the arch, taller than the wall beside it
    for (const s of [-1, 1]) { b.box(s * 3.6, 4.3, -8, 3.2, 8.6, 4.4, EARTH[0]!); b.box(s * 3.6, 0.8, -8, 3.5, 1.6, 4.7, EARTH[2]!); }
    archSpan(b, 0, -8, 2, 3.6, 2, 8.6, 4.4, EARTH[0]!);
    b.box(0, 8.72, -8, 10.7, 0.26, 4.7, EARTH[3]!);
    for (const x of [-5.1, -2.55, 0, 2.55, 5.1]) zanko(b, x, 8.85, -6, x === 0 ? 1.9 : 1.5);
    for (const x of [-5.1, 0, 5.1]) zanko(b, x, 8.85, -10, 1.5);
    for (const s of [-1, 1]) { b.box(s * 5.5, 7.4, -7, 0.7, 0.12, 0.2, WOOD_DARK); relief(b, s * 3.6, 3.2, front + 0.03, 2.3, 2.9, 1); relief(b, s * 3.6, 6.5, front + 0.03, 2.3, 1.7, 0); }
    relief(b, 0, 7.3, front + 0.03, 3.6, 1.5, 2);
    // The doors, shut: heavy timber leaves with iron bands and studs
    b.box(0, 2.8, -6.4, 4, 5.6, 0.24, '#4a3626');
    b.box(0, 2.8, -6.26, 0.08, 5.6, 0.04, '#2a1f18');
    for (const y of [1, 2.4, 3.8]) { b.box(0, y, -6.26, 4, 0.14, 0.04, '#2f2a26'); for (let i = 0; i < 8; i++) b.quad(-1.75 + i * 0.5, y + 0.5, -6.26, 0.1, 0.1, '#b9a070'); }
    // The forecourt: a rope line, two gate guards, a held horse in its trappings
    ropeLine(b, [[-4.6, -3.4], [-2.3, -3.4], [0, -3.4], [2.3, -3.4], [4.6, -3.4]], { post: WOOD, rope: '#8a3a2e' });
    extra(b, 'kano-palace-guard-1', -2.7, -4.7, 0.1, 'stand', { look: MAN('red') });
    extra(b, 'kano-palace-guard-2', 2.7, -4.7, -0.1, 'stand', { look: MAN('green') });
    horse(b, 9.6, -3.6, -HALF, '#6a4a34', '#c9423a');
    extra(b, 'kano-palace-groom', 7.6, -3.2, HALF, 'stand', { look: MAN('cream') });
    extra(b, 'kano-palace-guide', 5.6, 0.2, PI - 0.3, 'wave', { look: MAN('teal') });
    extra(b, 'kano-palace-visitor', -4.6, 1.2, PI, 'stand', { look: WOMAN('violet') });
    palm(b, -10, -11.4, { s: 1.5 }); palm(b, 11, -11.6, { s: 1.6, ry: 2 });
    neem(b, -11.6, 3, 1.3); neem(b, 12.2, 6, 1.15, 1);
    bench(b, -11.4, 5.6, { w: 2.8, ry: HALF, color: '#8a6644' });
    stele(b, context.label, -7.4, 6.4, 0.35);
    lampPost(b, 5.4, 5.4, { light: true }); lampPost(b, -5.4, -1.4);
    return { spots: places([0, -1.2, PI], [5.4, 1.8, PI], [0.6, 7.6]), crowd: crowdFront(), spare: spareFront() };
  },
};

// ---------------------------------------------------------------------------------------------
// Central mosque: a white prayer hall under a green dome between twin minarets, seen from its wide court.

const MOSQUE_WHITE = '#f4f0e2', MOSQUE_TRIM = '#dcd6c2', MOSQUE_GREEN = '#2f8f6a';
function tallMinaret(b: Batch, x: number, z: number, h: number): void {
  b.box(x, 2.6, z, 2.4, 5.2, 2.4, MOSQUE_WHITE); b.box(x, 5.3, z, 2.7, 0.24, 2.7, MOSQUE_TRIM);
  b.cyl(x, 5.2 + (h - 5.2) / 2, z, 0.85, h - 5.2, MOSQUE_WHITE, { seg: 8, top: 0.8 });
  for (const y of [h * 0.62, h * 0.88]) { b.cyl(x, y, z, 1.25, 0.22, MOSQUE_TRIM, { seg: 8 }); b.cyl(x, y + 0.55, z, 1.18, 0.07, MOSQUE_GREEN, { seg: 8 }); }
  for (const y of [2, 3.6]) b.box(x, y, z + 1.21, 0.3, 0.9, 0.04, '#2f6f5c');
  b.cyl(x, h + 0.5, z, 0.6, 1, MOSQUE_WHITE, { seg: 8 }); b.cone(x, h + 1.9, z, 0.78, 1.8, MOSQUE_GREEN, { seg: 8 });
  b.cyl(x, h + 3.2, z, 0.04, 0.9, '#d6a83a', { seg: 4 }); b.ball(x, h + 3.7, z, 0.16, 0.16, 0.16, '#d6a83a', { seg: 5 });
}

const centralMosque: SceneDef = {
  mood: 'outdoor', accent: MOSQUE_GREEN,
  camera: { landscape: [28, 40, 53], portrait: [29, 65, 85], start: 9 }, walk: OPEN,
  build(b, context) {
    ground(b, { w: 30, d: 26, color: '#e2dac2', edge: '#aea488' });
    for (let x = -13; x <= 13; x += 2) for (let z = -3; z <= 11; z += 2) if ((x + z + 40) % 4 === 0) b.box(x, 0.05, z, 2, 0.02, 2, '#d3c9ac');
    // The prayer hall with its arcade of arches; a taller portal in the middle
    b.box(0, 3, -9.2, 21, 6, 6.4, MOSQUE_WHITE); b.box(0, 6.15, -9.2, 21.6, 0.3, 7, MOSQUE_TRIM);
    for (let i = 0; i < 8; i++) {
      const x = (i < 4 ? -9.2 : 2.6) + (i % 4) * 2.2;
      b.box(x, 1.5, -5.96, 1.4, 3, 0.1, '#2f6f5c'); b.cyl(x, 3, -5.96, 0.7, 0.1, '#2f6f5c', { seg: 10, rx: HALF });
      b.box(x, 4.9, -5.97, 0.7, 0.7, 0.06, '#6fb09a');
    }
    b.box(0, 3.3, -5.7, 4.2, 6.6, 0.7, MOSQUE_WHITE); b.box(0, 6.72, -5.7, 4.6, 0.26, 0.9, MOSQUE_TRIM);
    b.box(0, 1.9, -5.32, 2.2, 3.8, 0.1, '#2f6f5c'); b.cyl(0, 3.8, -5.32, 1.1, 0.1, '#2f6f5c', { seg: 12, rx: HALF });
    for (const s of [-1, 1]) b.ball(s * 1.9, 7.1, -5.7, 0.36, 0.5, 0.36, MOSQUE_GREEN, { seg: 6 });
    labelled(b, context.label, 0, 5.75, -5.33, 3.7, 0.3, '#f4e6b8', '#1f6f4a', false);
    // The green dome on its drum, and the twin minarets at the corners of the front
    b.cyl(0, 6.9, -9.4, 3.5, 1.3, MOSQUE_WHITE, { seg: 16 });
    b.ball(0, 7.5, -9.4, 3.5, 3.1, 3.5, MOSQUE_GREEN, { seg: 14 });
    b.cyl(0, 11, -9.4, 0.05, 1.2, '#d6a83a', { seg: 4 }); b.ball(0, 11.7, -9.4, 0.2, 0.2, 0.2, '#d6a83a', { seg: 5 });
    tallMinaret(b, -11.6, -5.6, 12.8); tallMinaret(b, 11.6, -5.6, 12.8);
    // The court: rows of prayer mats, a wall of washing taps, a shoe rack, date palms along the edge
    for (let row = 0; row < 3; row++) for (let i = 0; i < 6; i++) b.box(-6.9 + i * 2.76, 0.07, -3.2 + row * 2.2, 2.4, 0.04, 1.2, (i + row) % 2 ? '#2f8f6a' : '#a8323a');
    b.box(12.6, 0.5, 4.4, 0.5, 1, 7, MOSQUE_TRIM);
    for (let i = 0; i < 4; i++) { b.cyl(12.3, 1.05, 2 + i * 1.6, 0.07, 0.28, METAL, { seg: 5 }); b.box(11.8, 0.15, 2 + i * 1.6, 0.5, 0.3, 0.5, '#8aa0aa'); }
    b.box(-12.4, 0.6, 5, 0.9, 1.2, 3.2, WOOD); for (let i = 0; i < 6; i++) b.box(-12.2, 0.9, 3.8 + i * 0.5, 0.3, 0.14, 0.34, ['#8a5a3a', '#3a3d42', '#c9a56a'][i % 3]!);
    b.box(-8.7, 0.6, 12.4, 12, 1.2, 0.4, MOSQUE_TRIM); b.box(8.7, 0.6, 12.4, 12, 1.2, 0.4, MOSQUE_TRIM);
    for (const x of [-2.5, 2.5]) { b.box(x, 1.3, 12.4, 0.7, 2.6, 0.7, MOSQUE_WHITE); b.ball(x, 2.8, 12.4, 0.35, 0.4, 0.35, MOSQUE_GREEN, { seg: 6 }); }
    for (const [x, z, t] of ([[-14, 1, 0], [14, -1.6, 1.4], [14, 9.6, 2.6], [-14, 9.4, 4]] as [number, number, number][])) palm(b, x, z, { s: 1.1, ry: t });
    lampPost(b, -6, 7.4, { light: true }); lampPost(b, 6, 7.4);
    extra(b, 'kano-mosque-attendant', 3.4, -4.2, PI, 'stand', { look: MAN('cream', { outfit: 'agbada' }) });
    extra(b, 'kano-mosque-visitor-1', -5.4, 4.6, 2.6, 'stand', { look: MAN('teal') });
    extra(b, 'kano-mosque-visitor-2', 9.6, 5.4, -1.2, 'stand', { look: WOMAN('navy') });
    return {
      spots: places([0, 3.4, PI], [5.2, -4.2, PI], [0.6, 8]),
      crowd: [[2.6, 6, 0.4], [-2.6, 7.8, -0.5], [7.6, 8, 2.4], [-8, 7.2, 1.2], [8.6, 10.2, -0.8], [-8.4, 10, 0.8], [4, 10.6, 2.8], [-5.2, 10.4, 2.4], [-11, 8, 1.6], [10.6, 1.2, -0.4], [0.2, 9.8, 3.1], [-9.6, 2.6, 0.6]],
      spare: spareFront(),
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Dye pits: round pits sunk in the ground and filled with dark indigo, in rows inside a mud-walled yard.

const PITS: readonly (readonly [number, number, boolean])[] = [
  [-8.4, -5.4, false], [-5.2, -5.4, true], [-2, -5.4, false], [1.2, -5.4, false], [4.4, -5.4, true],
  [-8.4, -2.2, true], [-5.2, -2.2, false], [-2, -2.2, false], [1.2, -2.2, true], [4.4, -2.2, false],
  [-8.4, 1, false], [-5.2, 1, false], [-2, 1, true], [1.2, 1, false], [4.4, 1, false],
];
function dyePit(b: Batch, x: number, z: number, covered: boolean): void {
  b.disc(x, 0.05, z, 1.5, '#9a8f9c', { seg: 12 });
  b.cyl(x, 0.12, z, 0.98, 0.24, '#8f6f55', { seg: 12 });
  if (covered) { b.cone(x, 0.5, z, 1.02, 0.55, '#c9a45a', { seg: 10 }); b.cyl(x, 0.26, z, 1.04, 0.06, '#a8843f', { seg: 10 }); return; }
  b.disc(x, 0.25, z, 0.82, '#141a3c', { seg: 12 });
  b.disc(x - 0.2, 0.26, z + 0.15, 0.3, '#3a4f9a', { seg: 7 }); b.disc(x + 0.3, 0.26, z - 0.25, 0.16, '#5f77c0', { seg: 6 });
}
/** A long cloth hung by its top edge: indigo with resist patterns, or tie-dyed in rings. */
export function longCloth(b: Batch, x: number, y: number, z: number, w: number, h: number, i: number, ry = 0): void {
  if (i % 3 !== 2) { adireCloth(b, x, y, z, w, h, i, ry, i % 4 === 1 ? '#1b2a5e' : '#233c7c'); return; }
  b.at(x, y, z, ry, () => {
    b.quad(0, 0, 0, w, h, '#2b3f8a');
    for (let j = 0; j < 3; j++) { const cy = -h / 3 + j * (h / 3); b.quad(0, cy, 0.012, w * 0.6, w * 0.6, '#9fb4e6', { rz: PI / 4 }); b.quad(0, cy, 0.014, w * 0.36, w * 0.36, '#2b3f8a', { rz: PI / 4 }); b.quad(0, cy, 0.016, w * 0.14, w * 0.14, '#eae4d0'); }
  });
}

const dyePits: SceneDef = {
  mood: 'outdoor', accent: '#3f5fc0', camera: LOW,
  walk: { bounds: [-14.2, -12.2, 14.2, 12.2], entrance: [0, 11.4], open: true, block: PITS.map(([x, z]): [number, number, number] => [x, z, 0.8]) },
  build(b, context) {
    const rand = seeded(29);
    dust(b, rand, '#cfae80', '#9c7d55');
    // The yard's mud wall along the back and the left, cloths spread on it to dry
    earthWall(b, -14.6, 14.6, -11.8, 3, { pinnacles: false }); earthWallZ(b, -14.4, -11.8, 5.6, 3, { pinnacles: false, tone: 1 });
    for (let i = 0; i < 6; i++) longCloth(b, -11.6 + i * 4.4, 1.75, -11.3, 2.4, 2.5, i);
    for (let i = 0; i < 3; i++) longCloth(b, -13.9, 1.75, -8 + i * 4.6, 2.6, 2.5, i + 1, HALF);
    // Lines of long cloths on poles behind the pits and down the right side
    for (const [x0, x1, z, off] of ([[-12.6, -1.6, -8.6, 0], [0.6, 9.6, -8.9, 2]] as [number, number, number, number][])) {
      for (const x of [x0, x1]) b.cyl(x, 2.3, z, 0.09, 4.6, WOOD_DARK, { seg: 5 });
      b.box((x0 + x1) / 2, 4.5, z, x1 - x0, 0.06, 0.06, '#c9b88f');
      const n = Math.floor((x1 - x0) / 1.8);
      for (let i = 0; i < n; i++) longCloth(b, x0 + 1 + i * ((x1 - x0 - 1.6) / Math.max(1, n - 1)), 2.75, z + 0.05, 1.5, 3.4, i + off, 0.04 * ((i % 3) - 1));
    }
    for (const z of [-6.4, 2.4]) b.cyl(12.4, 2.1, z, 0.09, 4.2, WOOD_DARK, { seg: 5 });
    b.box(12.4, 4.1, -2, 0.06, 0.06, 8.8, '#c9b88f');
    for (let i = 0; i < 4; i++) longCloth(b, 12.36, 2.5, -5.2 + i * 2.1, 1.6, 3.1, i + 1, -HALF);
    // The pits, some under woven covers; stirring poles, low stools, dyers at work
    for (const [x, z, covered] of PITS) dyePit(b, x, z, covered);
    for (const [x, z] of ([[-8.4, -5.4], [1.2, -5.4], [-5.2, 1], [4.4, -2.2]] as [number, number][])) b.cyl(x + 0.3, 1.1, z - 0.1, 0.05, 2.4, WOOD_LIGHT, { seg: 4, rz: -0.35 });
    for (const [x, z] of ([[-6.8, -5.4], [-3.6, -2.2], [-0.4, -5.4], [2.8, -2.2], [-3.6, 1], [6, 1]] as [number, number][])) stool(b, x, z, { h: 0.4, r: 0.28, color: WOOD_LIGHT });
    extra(b, 'kano-dyer-1', -6.8, -5.4, -HALF, 'sit', { seat: 0.4, look: MAN('navy', { fabric: 'adire' }) });
    extra(b, 'kano-dyer-2', -0.4, -2.2, -HALF, 'work', { look: MAN('blue', { fabric: 'adire' }) });
    extra(b, 'kano-dyer-3', 6, 1, -HALF, 'sit', { seat: 0.4, look: MAN('navy') });
    for (const [x, z] of ([[7.2, -5], [7.6, -1.2], [-10.8, 3.2]] as [number, number][])) { b.cyl(x, 0.3, z, 0.34, 0.6, '#7a7a7e', { seg: 7, top: 1.2 }); b.disc(x, 0.61, z, 0.3, '#1b2552', { seg: 7 }); }
    // A mat shade where finished cloth is folded and shown
    for (const [x, z] of ([[7.6, 3.4], [12, 3.4], [7.6, 6.8], [12, 6.8]] as [number, number][])) b.cyl(x, 1.5, z, 0.08, 3, WOOD_DARK, { seg: 5 });
    b.box(9.8, 3.05, 5.1, 5.2, 0.1, 4.2, MAT); for (let i = 0; i < 5; i++) b.box(7.6 + i * 1.1, 3.12, 5.1, 0.06, 0.05, 4.2, '#a8843f');
    table(b, 10.6, 5.4, { w: 2.6, d: 1.1, h: 0.9, color: '#7a5c3c' });
    for (let i = 0; i < 5; i++) b.box(9.7 + i * 0.45, 1.02 + (i % 2) * 0.1, 5.4, 0.4, 0.2 + (i % 2) * 0.2, 0.9, ['#233c7c', '#eae4d0', '#1b2a5e', '#6f8fc7', '#2b3f8a'][i]!);
    extra(b, 'kano-dye-seller', 11.4, 4.2, 0.2, 'stand', { look: MAN('cream') });
    extra(b, 'kano-dye-visitor', -2.6, 5.4, PI, 'stand', { look: WOMAN('orange') });
    neem(b, -11.6, 8.6, 1.25, 2);
    stele(b, context.label, -6, 8.4, 0.3, 5);
    lampPost(b, 4.4, 8.4, { light: true });
    return {
      spots: places([-0.4, 3.4, PI], [8.6, 4.4, HALF], [1.6, 7.4]),
      crowd: [[2.4, 5.4, 0.4], [-1.4, 7, -0.5], [6.4, 9, 2.4], [-8, 4.4, 1.2], [8.6, 10, -0.8], [-9, 10.6, 0.8], [3, 10.4, 2.8], [-3.4, 10.4, 2.4], [-11.6, 5.4, 1.6], [11, 9.4, -0.4], [0.2, 9.2, 3.1], [5.6, 4, 0.6]],
      spare: [[2.4, 9], [-2, 8.8], [6.4, 7.6], [0, 10.4]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Old market: rows of small earth booths under mat awnings with narrow lanes between them.

const LEATHER: readonly Colour[] = ['#8a5a34', '#a86a3c', '#5f3d26', '#c08a4f', '#7a2f26'];
/** One booth: three earth walls, a mat awning on two poles, a low platform of goods and more hung on the back wall. */
function booth(b: Batch, x: number, z: number, w: number, goods: number, tone: number, n = 3): void {
  b.at(x, 0, z, 0, () => {
    b.box(0, 1.3, -0.9, w, 2.6, 0.24, EARTH[tone % 4]!);
    for (const s of [-1, 1]) { b.box(s * (w / 2 - 0.1), 1.2, -0.1, 0.2, 2.4, 1.6, EARTH[(tone + 1) % 4]!); b.cyl(s * (w / 2 - 0.1), 1.1, 1.5, 0.05, 2.2, WOOD_DARK, { seg: 4 }); }
    b.box(0, 2.56, 0.3, w + 0.2, 0.1, 2.8, tone % 2 ? '#bfa05c' : MAT, { rx: 0.14 });
    b.box(0, 0.3, 0.1, w - 0.5, 0.6, 1.3, EARTH[2]!);
    const span = w - 1.1, kind = ((goods % 4) + 4) % 4;
    for (let i = 0; i < n; i++) {
      const gx = -span / 2 + i * (span / (n - 1)), gz = 0.05 + (i % 2) * 0.4;
      if (kind === 0) {
        b.box(gx, 0.82, gz, 0.36, 0.42, 0.2, LEATHER[i % 5]!); b.box(gx, 1.08, gz, 0.2, 0.1, 0.05, '#3a2a1c');
        b.box(gx, 0.64, 0.64, 0.3, 0.06, 0.14, LEATHER[(i + 2) % 5]!); if (n > 2) b.box(gx, 1.9, -0.75, 0.34, 0.44, 0.08, LEATHER[(i + 1) % 5]!);
      } else if (kind === 1) {
        b.ball(gx, 0.82, gz, 0.26, 0.22, 0.26, ['#e3c77a', '#d6a84f', '#edd699'][i % 3]!, { seg: 5 }); b.cyl(gx, 0.86, gz, 0.265, 0.05, '#6a4a2a', { seg: 5 });
        if (n > 2) b.cyl(gx, 1.9, -0.74, 0.2, 0.05, '#e3c77a', { seg: 6, rx: HALF });
      } else if (kind === 2) {
        for (let k = 0; k < 2; k++) b.cyl(gx, 0.7 + k * 0.2, gz, 0.19, 0.2, ['#f1efe8', '#2a4fa6', '#a8323a', '#2f8f55', '#d6a83a'][(i + k) % 5]!, { seg: 5 });
        b.cyl(gx, 0.9, gz, 0.195, 0.05, '#d6a83a', { seg: 5 });
        if (n > 2) b.cyl(gx, 1.9, -0.72, 0.19, 0.2, ['#2a4fa6', '#f1efe8', '#a8323a'][i % 3]!, { seg: 5, rx: HALF });
      } else {
        if (i % 2) b.cyl(gx, 0.78, gz, 0.22, 0.36, '#c9a45a', { seg: 6, top: 1.4 });
        else b.ball(gx, 0.84, gz, 0.26, 0.26, 0.26, '#a8573a', { seg: 5 });
        if (n > 2) b.cyl(gx, 1.9, -0.74, 0.22, 0.04, i % 2 ? '#d6a83a' : '#a8323a', { seg: 6, rx: HALF });
      }
    }
  });
}

const kurmi: SceneDef = {
  mood: 'outdoor', accent: '#c08a4f', camera: LOW, walk: OPEN,
  build(b, context) {
    const rand = seeded(41);
    dust(b, rand, '#cdae80', '#9a7c54');
    b.box(0, 0.05, 0, 3.6, 0.03, 25, '#dcc294');
    // Three rows of booths, a narrow lane behind each, one cross lane up the middle
    const rows = [-9.8, -4.9, 0];
    rows.forEach((z, row) => {
      for (let i = 0; i < 8; i++) {
        const x = (i < 4 ? -12.4 : 4) + (i % 4) * 2.8;
        booth(b, x, z, 2.6, i + row * 3 + (i > 3 ? 1 : 0), i + row, row === 2 ? 3 : 2);
      }
    });
    // Mats slung across the middle lane, and bundles of poles leaning at the corners
    for (const z of [-7.6, -2.7]) { b.box(0, 3.1, z, 5, 0.08, 1.8, z < -5 ? '#bfa05c' : MAT); for (const s of [-1, 1]) b.cyl(s * 2.4, 1.55, z, 0.05, 3.1, WOOD_DARK, { seg: 4 }); }
    // Sellers in a few booths, a leather worker on a mat in front, a calabash seller on another
    b.box(-8.4, 0.06, 5.4, 3.4, 0.04, 2.4, MAT); b.box(-8.4, 0.07, 5.4, 3, 0.04, 2, '#b99a52');
    for (let i = 0; i < 5; i++) b.box(-9.6 + i * 0.6, 0.2, 5.9, 0.4, 0.24, 0.5, LEATHER[i]!);
    b.box(-8.2, 0.14, 4.9, 0.9, 0.08, 0.6, '#c08a4f'); stool(b, -8.4, 4.4, { h: 0.3, r: 0.26, color: WOOD_LIGHT });
    extra(b, 'kano-kurmi-leather', -8.4, 4.4, 0.2, 'sit', { seat: 0.3, look: MAN('orange') });
    b.box(8.6, 0.06, 5.6, 3.2, 0.04, 2.4, '#bfa05c');
    for (let i = 0; i < 6; i++) { b.ball(7.5 + (i % 3) * 0.9, 0.3, 5.1 + Math.floor(i / 3) * 0.9, 0.34, 0.3, 0.34, ['#e3c77a', '#d6a84f', '#edd699'][i % 3]!, { seg: 5 }); b.cyl(7.5 + (i % 3) * 0.9, 0.36, 5.1 + Math.floor(i / 3) * 0.9, 0.345, 0.05, '#6a4a2a', { seg: 5 }); }
    extra(b, 'kano-kurmi-calabash', 10.4, 5.6, -HALF, 'sit', { seat: 0.2, look: WOMAN('teal') });
    // A handcart of hides, a water pot stand, the market's name on a slab by the way in
    b.at(4.2, 0, 8.6, 0.4, () => { b.box(0, 0.7, 0, 1.3, 0.12, 2.2, WOOD); for (const s of [-1, 1]) b.cyl(s * 0.75, 0.42, -0.2, 0.42, 0.1, '#3a3028', { seg: 8, rz: HALF }); b.box(0, 0.7, 1.5, 0.08, 0.08, 1, WOOD_DARK); for (let i = 0; i < 3; i++) b.box(0, 0.86 + i * 0.14, -0.1, 1.1, 0.12, 1.6, LEATHER[i + 1]!); });
    for (const x of [12.4, 13.2]) { b.ball(x, 0.5, 9.4, 0.42, 0.5, 0.42, '#a8573a', { seg: 7 }); b.cyl(x, 0.98, 9.4, 0.2, 0.1, '#8a4a30', { seg: 7 }); }
    stele(b, context.label, -6.6, 9.2, 0.3, 4.6);
    neem(b, -12.6, 9.4, 1.1, 1);
    lampPost(b, 2.6, 4.4, { light: true });
    return {
      spots: places([-3.4, 3.4, PI], [4.6, 3.2, PI], [0.4, 7.6]),
      crowd: [[2.4, 6.4, 0.4], [-2.4, 7.6, -0.5], [6.4, 8.2, 2.4], [-4.6, 6.2, 1.2], [8.6, 9.8, -0.8], [-10.4, 8, 0.8], [1.6, 10.4, 2.8], [-3.2, 10.4, 2.4], [0.4, -2.6, 0], [11.4, 7.8, -0.4], [0.2, 9, 3.1], [-0.6, -7.4, 0.6]],
      spare: [[-1.4, 5.4], [1.4, 8.6], [-3, 9], [6.4, 10.4]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Museum: a low, historic earth house round a small court where the larger exhibits stand in the open.

function kettleDrum(b: Batch, x: number, z: number, r: number): void {
  b.cyl(x, r * 0.55, z, r, r * 1.1, '#6a3f27', { seg: 9, top: 2 }); b.cyl(x, r * 1.12, z, r * 1.02, 0.08, '#3a2a1c', { seg: 9 });
  b.disc(x, r * 1.17, z, r * 0.96, '#e8d9b0', { seg: 9 });
}

const museum: SceneDef = {
  mood: 'outdoor', accent: '#c79f6b', camera: LOW, walk: OPEN,
  build(b, context) {
    const rand = seeded(53);
    dust(b, rand);
    b.box(1, 0.05, 3.6, 3, 0.03, 17, '#e6d2a6');
    // The house: a long low wing across the back and another down the left, flat-roofed, with small deep windows
    b.box(0, 1.9, -10, 26, 3.8, 4.6, EARTH[0]!); b.box(0, 0.5, -10, 26.2, 1, 4.9, EARTH[2]!); b.box(0, 3.94, -10, 26.2, 0.28, 4.8, EARTH[3]!);
    b.box(-12.4, 1.7, -2.4, 4.4, 3.4, 10.6, EARTH[1]!); b.box(-12.4, 3.54, -2.4, 4.6, 0.28, 10.8, EARTH[3]!);
    for (let x = -12.6; x <= 12.6; x += 3.15) zanko(b, x, 4.08, -7.9, 0.9);
    for (let z = -6.4; z <= 2.6; z += 3) zanko(b, -10.4, 3.68, z, 0.8);
    streaks(b, rand, 12, -9.6, 12.6, 3.6, -7.68, (x) => Math.abs(x - 1) < 3.4);
    for (const x of [-7.4, -4.2, 6.6, 9.8]) { b.box(x, 2.2, -7.68, 0.6, 0.8, 0.06, '#3a2c20'); b.box(x, 2.66, -7.67, 0.9, 0.1, 0.06, RELIEF); }
    for (const z of [-5, -1.6, 1.4]) { b.box(-10.18, 2, z, 0.06, 0.8, 0.6, '#3a2c20'); b.box(-10.17, 2.46, z, 0.06, 0.1, 0.9, RELIEF); }
    b.box(-10.18, 1, -3.2, 0.06, 2, 1, '#4a3626');
    // The entrance: a taller porch with relief on either side of its door, a lattice over it, pinnacles at its corners
    b.box(1, 2.5, -7.2, 5.6, 5, 1.4, EARTH[0]!); b.box(1, 5.1, -7.2, 5.9, 0.24, 1.7, EARTH[3]!);
    for (const s of [-1, 1]) { zanko(b, 1 + s * 2.6, 5.2, -6.7, 1.3); relief(b, 1 + s * 1.9, 2, -6.47, 1.3, 2.6, 1); }
    zanko(b, 1, 5.2, -6.7, 1);
    relief(b, 1, 4.1, -6.47, 4.6, 1.2, 0);
    b.box(1, 1.3, -6.46, 1.5, 2.6, 0.08, '#3a2a1c'); b.cyl(1, 2.6, -6.46, 0.75, 0.08, '#3a2a1c', { seg: 10, rx: HALF });
    // Exhibits in the court: an old gate door under a shelter, royal drums on a plinth, pots, a board of pictures
    for (const [x, z] of ([[6.2, -4.6], [10, -4.6], [6.2, -2.2], [10, -2.2]] as [number, number][])) b.cyl(x, 1.9, z, 0.09, 3.8, WOOD_DARK, { seg: 5 });
    b.box(8.1, 3.86, -3.4, 4.6, 0.12, 3.2, MAT); b.box(8.1, 3.95, -3.4, 4.2, 0.1, 2.8, '#bfa05c');
    b.box(8.1, 0.15, -3.6, 3.4, 0.3, 1.2, '#8d887a');
    b.box(8.1, 2, -3.7, 2.4, 3.4, 0.22, '#5a3d26', { rx: -0.08 });
    for (const y of [0.9, 2, 3.1]) { b.box(8.1, y, -3.56 - (y - 2) * 0.08, 2.4, 0.16, 0.04, '#2f2a26'); for (let i = 0; i < 5; i++) b.quad(7.2 + i * 0.45, y + 0.5, -3.55 - (y - 1.5) * 0.08, 0.1, 0.1, '#b9a070'); }
    ropeLine(b, [[6.4, -1.4], [8.1, -1.4], [9.8, -1.4]], { post: WOOD, rope: '#8a3a2e', h: 0.9 });
    b.box(-4.6, 0.2, -2.4, 4.4, 0.4, 2.4, '#8d887a');
    kettleDrum(b, -5.8, -2.4, 0.62); kettleDrum(b, -4.4, -2.6, 0.5); kettleDrum(b, -3.3, -2.2, 0.4);
    drum(b, -5, 0.4, '#6a3f27'); drum(b, -3.8, 0.6, '#7a4a2c');
    b.box(-6.2, 0.2, 3.4, 3, 0.4, 1, '#8d887a');
    for (let i = 0; i < 3; i++) { b.ball(-7.1 + i * 0.9, 0.82, 3.4, 0.36, 0.44, 0.36, ['#a8573a', '#8a4a30', '#b8683f'][i]!, { seg: 7 }); b.cyl(-7.1 + i * 0.9, 1.26, 3.4, 0.17, 0.1, '#7a4028', { seg: 7 }); }
    b.at(5.4, 0, 1.6, -0.5, () => {
      for (const s of [-1, 1]) b.box(s * 1.2, 1.1, 0, 0.1, 2.2, 0.1, WOOD_DARK);
      b.box(0, 1.5, 0, 2.6, 1.4, 0.08, '#4a3626');
      for (let i = 0; i < 3; i++) b.quad(-0.8 + i * 0.8, 1.6, 0.05, 0.6, 0.8, ['#e9dcb4', '#d9c9a0', '#efe4c4'][i]!);
      for (let i = 0; i < 3; i++) b.quad(-0.8 + i * 0.8, 1, 0.05, 0.6, 0.12, '#c9b88f');
    });
    extra(b, 'kano-museum-guide', 3.6, -4.6, PI - 0.2, 'wave', { look: MAN('teal') });
    extra(b, 'kano-museum-visitor-1', 8.4, 0.2, PI, 'stand', { look: WOMAN('green') });
    extra(b, 'kano-museum-visitor-2', -3.6, 2.8, -2.4, 'stand', { look: MAN('cream') });
    bench(b, 11.6, 5.4, { w: 2.8, ry: -HALF, color: '#8a6644' });
    neem(b, 13.2, 1.6, 1); neem(b, -11.4, 7.6, 1.3, 2); palm(b, 13.4, -4.4, { s: 1.1, ry: 1 });
    stele(b, context.label, -5.6, 8.4, 0.3, 5.2);
    lampPost(b, 3.4, 6.4, { light: true });
    return { spots: places([1, -1.4, PI], [3.4, -3.2, PI], [1.6, 7.6]), crowd: crowdFront(), spare: spareFront() };
  },
};

// ---------------------------------------------------------------------------------------------
// Dala: the flat top of the hill. A long flight of steps climbs the slope to the terrace; the flat roofs of the old
// city spread out below it on every side.

const PLAIN_Y = -10, STEPS_TURN = 0.5, TOP_R = 14.5;

function flatRoofCity(b: Batch, rand: () => number): void {
  const walls: Colour[] = ['#c79f6b', '#bb8f5c', '#d3ae7c', '#b08453', '#cfa56f', '#d9c9a8', '#c4b393'];
  b.box(0, PLAIN_Y - 3, -40, 420, 6, 380, '#b0895c'); b.box(0, PLAIN_Y + 0.02, -40, 420, 0.1, 380, '#cfae7c');
  for (let gx = -66; gx <= 66; gx += 6) {
    for (let gz = -70; gz <= 46; gz += 5.6) {
      const far = Math.hypot(gx, gz);
      if (far < 31.5 || rand() < 0.46) continue;
      // Clear of the foot of the steps
      const along = gx * Math.sin(STEPS_TURN) + gz * Math.cos(STEPS_TURN), across = gx * Math.cos(STEPS_TURN) - gz * Math.sin(STEPS_TURN);
      if (along > 0 && Math.abs(across) < 4.4) continue;
      const x = gx + (rand() - 0.5) * 1.6, z = gz + (rand() - 0.5) * 1.6, w = 3 + rand() * 1.8, d = 2.8 + rand() * 1.6, h = 1.5 + rand() * 1.5, tone = walls[Math.floor(rand() * walls.length)]!;
      b.at(x, PLAIN_Y, z, (rand() - 0.5) * 0.5, () => {
        b.box(0, h / 2, 0, w, h, d, tone);
        if (far < 50) b.box(0, h + 0.03, 0, w - 0.5, 0.06, d - 0.5, '#a88458');
      });
    }
  }
  for (let i = 0; i < 10; i++) { const a = rand() * PI * 2, r = 34 + rand() * 26; b.ico(Math.sin(a) * r, PLAIN_Y + 1.6, Math.cos(a) * r - 6, 1.6 + rand() * 0.8, 1.2, 1.6 + rand() * 0.8, NEEM[i % 3]!); }
  // Far off: a second, rockier hill, and a dome between two slim towers
  b.ball(-46, PLAIN_Y, -30, 12, 6.5, 8, '#9c7b5c', { seg: 7 }); b.ico(-46, PLAIN_Y + 6, -30, 2.4, 1.6, 2, '#8d7a68');
  b.box(-16, PLAIN_Y + 1.6, -52, 7, 3.2, 3.4, MOSQUE_WHITE); b.ball(-16, PLAIN_Y + 3.2, -52, 1.6, 1.6, 1.6, MOSQUE_GREEN, { seg: 8 });
  for (const s of [-1, 1]) { b.cyl(-16 + s * 4.4, PLAIN_Y + 3.6, -51, 0.34, 7.2, MOSQUE_WHITE, { seg: 6 }); b.cone(-16 + s * 4.4, PLAIN_Y + 7.8, -51, 0.44, 1.2, MOSQUE_GREEN, { seg: 6 }); }
}

const dala: SceneDef = {
  mood: 'outdoor', accent: '#e0a43a',
  camera: { landscape: [20, 31, 39], portrait: [19, 42, 55], start: 4.2 },
  walk: { bounds: [-9.4, -9.4, 9.4, 9.4], entrance: [4.6, 8.6], open: true },
  build(b, context) {
    const rand = seeded(67), sin = Math.sin(STEPS_TURN), cos = Math.cos(STEPS_TURN);
    flatRoofCity(b, rand);
    // The hill: a broad cone of red laterite with a flat top, rock and dry scrub on its slopes
    b.cyl(0, PLAIN_Y / 2 - 0.08, 0, TOP_R * 2, -PLAIN_Y, '#a8683f', { top: 0.5, seg: 18 });
    b.cyl(0, -0.06, 0, TOP_R, 0.14, '#cfa672', { seg: 18 });
    for (let i = 0; i < 9; i++) b.disc(-9 + rand() * 18, 0.03, -9 + rand() * 18, 1 + rand() * 1.6, i % 2 ? '#dab986' : '#c39a64', { seg: 9, sz: 0.7 });
    for (let i = 0; i < 24; i++) {
      const a = rand() * PI * 2, t = 0.12 + rand() * 0.8, r = TOP_R * (1 + t), y = PLAIN_Y * t;
      const across = Math.sin(a - STEPS_TURN) * r;
      if (Math.cos(a - STEPS_TURN) > 0 && Math.abs(across) < 3.4) continue;
      if (i % 3 === 0) b.ico(Math.sin(a) * r, y + 0.3, Math.cos(a) * r, 0.9 + rand(), 0.6 + rand() * 0.4, 0.8 + rand(), i % 2 ? '#8d6a52' : '#9c7b5c');
      else b.ico(Math.sin(a) * r, y + 0.3, Math.cos(a) * r, 0.7 + rand() * 0.5, 0.5, 0.7 + rand() * 0.5, i % 2 ? '#8a9a52' : '#a39a5c');
    }
    // The long flight: pale steps straight down the slope, a landing half way, a rail on either side
    b.at(0, 0, 0, STEPS_TURN, () => {
      const n = 32, run = TOP_R / n, fall = -PLAIN_Y / n;
      for (let i = 0; i < n; i++) b.box(0, -(i + 1) * fall + 0.1, TOP_R + (i + 0.5) * run, i === 15 || i === 16 ? 4.4 : 3.2, 0.6, run + 0.02, i % 2 ? '#e6dabd' : '#d6c8a6');
      const slope = Math.atan2(-PLAIN_Y, TOP_R), length = Math.hypot(TOP_R, PLAIN_Y);
      for (const s of [-1, 1]) {
        b.box(s * 1.7, PLAIN_Y / 2 + 1, TOP_R * 1.5, 0.08, 0.08, length, METAL_DARK, { rx: slope });
        for (let i = 0; i <= 8; i++) b.box(s * 1.7, (PLAIN_Y * i) / 8 + 0.5, TOP_R + (TOP_R * i) / 8, 0.08, 1, 0.08, METAL_DARK);
      }
      b.box(0, PLAIN_Y + 0.06, TOP_R * 2 + 3, 5.4, 0.1, 6, '#dcc294');
      for (const s of [-1, 1]) { b.box(s * 2.2, 0.8, TOP_R - 0.5, 0.7, 1.6, 0.7, EARTH[1]!); zanko(b, s * 2.2, 1.6, TOP_R - 0.5, 0.9); }
    });
    extra(b, 'kano-dala-climber-1', sin * 19.4, cos * 19.4, STEPS_TURN + PI, 'walk', { y: PLAIN_Y * (4.9 / TOP_R) + 0.4, look: MAN('blue') });
    extra(b, 'kano-dala-climber-2', sin * 24 + cos * 0.6, cos * 24 - sin * 0.6, STEPS_TURN + PI, 'walk', { y: PLAIN_Y * (9.5 / TOP_R) + 0.4, look: WOMAN('orange') });
    // The viewing terrace: a low earth parapet round the edge, open at the head of the steps
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * PI * 2, gap = Math.abs(((a - STEPS_TURN + PI * 3) % (PI * 2)) - PI);
      if (gap < 0.2) continue;
      b.box(Math.sin(a) * 13.5, 0.5, Math.cos(a) * 13.5, 4, 1, 0.6, EARTH[i % 3]!, { ry: a }); b.box(Math.sin(a) * 13.5, 1.05, Math.cos(a) * 13.5, 4.1, 0.12, 0.76, EARTH[3]!, { ry: a });
    }
    // A mat shade with a bench, a survey pillar, a board that points out the view, rocks
    for (const [x, z] of ([[-7.6, -5.6], [-3.4, -5.6], [-7.6, -2.8], [-3.4, -2.8]] as [number, number][])) b.cyl(x, 1.4, z, 0.08, 2.8, WOOD_DARK, { seg: 5 });
    b.box(-5.5, 2.86, -4.2, 5, 0.1, 3.6, MAT); for (let i = 0; i < 5; i++) b.box(-7.6 + i * 1.05, 2.93, -4.2, 0.06, 0.05, 3.6, '#a8843f');
    bench(b, -5.5, -4.6, { w: 3, color: '#8a6644' });
    extra(b, 'kano-dala-sitter', -5.5, -4.6, 0, 'sit', { seat: 0.6, look: MAN('cream') });
    b.box(2.6, 0.7, -6.4, 0.6, 1.4, 0.6, '#e9e4d6'); b.box(2.6, 1.44, -6.4, 0.3, 0.08, 0.3, METAL_DARK);
    b.at(6.6, 0, -4.6, -0.7, () => { for (const s of [-1, 1]) b.box(s * 1.1, 0.5, 0, 0.1, 1, 0.1, METAL_DARK); b.box(0, 1.1, 0, 2.6, 0.08, 1, '#4a3626', { rx: 0.5 }); b.quad(0, 1.16, 0.02, 2.3, 0.7, '#e9dcb4', { rx: -HALF + 0.5 }); });
    extra(b, 'kano-dala-guide', 5.2, -2.6, PI + 0.6, 'wave', { look: MAN('teal') });
    for (const [x, z, r] of ([[-8.6, 4.6, 0.8], [8.4, 2.2, 0.6], [-2.4, 8.6, 0.5]] as [number, number, number][])) b.ico(x, r * 0.4, z, r * 1.2, r * 0.7, r, '#8d6a52');
    stele(b, context.label, -4.4, 4.2, 0.4, 4.2);
    lampPost(b, 1.6, 6.8, { light: true });
    return {
      spots: places([-0.4, -5.6, PI], [4.6, -4, PI], [0.6, 2.4]),
      crowd: [[2.4, 2.4, 0.4], [-1.6, 0.6, -0.5], [5.6, 3.6, 2.4], [-6.4, 0.4, 1.2], [7.4, 6.4, -0.8], [-7.6, 7.2, 0.8], [1.4, 7.6, 2.8], [-3.4, 7.8, 2.4], [-8.6, -0.6, 1.6], [8.4, -1.4, -0.4], [0.2, 5.2, 3.1], [3.6, -7.4, PI]],
      spare: [[-2, 2.6], [2.6, 4.6], [-5.4, 6.8], [4.6, 0.6]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Goron Dutse: the foot of a rockier hill. No steps here: a worn trail winds up between granite boulders.

const ROCK: readonly Colour[] = ['#9a8a78', '#a8957f', '#8a7a6a', '#b3a08a', '#7d6f62'];
/** How far forward the hill's face is at (x, y): the hill is half an ellipsoid standing behind the scene. */
const hillFace = (x: number, y: number): number => -14 + 8.5 * Math.sqrt(Math.max(0, 1 - ((x + 2) / 16) ** 2 - (y / 10.5) ** 2));

const goronDutse: SceneDef = {
  mood: 'outdoor', accent: '#b3a08a', camera: TALL,
  walk: { bounds: [-14.2, -3.2, 14.2, 12.2], entrance: [0, 11.4], open: true },
  build(b, context) {
    const rand = seeded(79);
    dust(b, rand, '#cfa877', '#9a7850');
    // The hill: a mass of red-brown earth and rock, a tor of great boulders on its crest
    b.ball(-2, 0, -14, 16, 10.5, 8.5, '#a3795a', { seg: 10 });
    b.ball(8, 0, -13, 8, 6, 6, '#9c7253', { seg: 8 }); b.ball(-12, 0, -12.4, 7, 5.4, 6, '#aa8060', { seg: 8 });
    for (const [x, y, z, r, t] of ([[-3, 10.2, -14, 2.4, 0], [-0.4, 10.8, -13.4, 1.8, 1], [-5.6, 9.6, -13.2, 1.9, 2], [-2.2, 12.3, -13.8, 1.5, 3], [2.4, 9.4, -13, 1.5, 4], [-8.4, 8.2, -12.6, 1.6, 1]] as [number, number, number, number, number][])) b.ball(x, y, z, r * 1.15, r * 0.9, r, ROCK[t]!, { seg: 7 });
    // Boulders all over the face, larger towards the top, and a scree of them at the foot
    for (let i = 0; i < 34; i++) {
      const x = -15 + rand() * 26, y = 0.6 + rand() * 8.4, z = hillFace(x, y), r = 0.6 + rand() * 1.1;
      if (z < -13.5) continue;
      if (i % 2) b.ico(x, y, z + 0.2, r * 1.2, r * 0.8, r, ROCK[i % 5]!); else b.ball(x, y, z + 0.2, r * 1.2, r * 0.8, r, ROCK[i % 5]!, { seg: 6 });
    }
    for (let i = 0; i < 14; i++) { const x = -13.6 + rand() * 27, r = 0.4 + rand() * 0.7; b.ico(x, r * 0.4, -4.6 + rand() * 0.9, r * 1.2, r * 0.75, r, ROCK[i % 5]!); }
    // The trail: pale worn ground zigzagging up the face from the gap in the scree, a cairn at each turn
    for (let i = 0; i < 46; i++) {
      const t = i / 45, y = 0.3 + t * 8.9, x = -2 + Math.sin(t * PI * 3.2) * (6.4 - t * 3.4), z = hillFace(x, y);
      b.ball(x, y, z + 0.05, 0.62, 0.2, 0.5, i % 2 ? '#e3cfa4' : '#d9c294', { seg: 5 });
      if (i % 9 === 4) { b.ico(x + 0.9, y + 0.2, z + 0.3, 0.3, 0.26, 0.3, '#c9bca6'); b.ico(x + 0.9, y + 0.56, z + 0.3, 0.2, 0.18, 0.2, '#d6cab4'); }
    }
    extra(b, 'kano-goron-walker-1', 3.6, hillFace(3.6, 2) + 0.5, PI + 0.6, 'walk', { y: 1.9, look: MAN('blue') });
    extra(b, 'kano-goron-walker-2', -5.4, hillFace(-5.4, 4.4) + 0.5, PI - 0.6, 'walk', { y: 4.3, look: MAN('orange', { outfit: 'casual', accessories: ['backpack'] }) });
    for (const [x, y] of ([[6.4, 4.6], [-10.4, 3.4], [1.6, 7.2], [-7.2, 6.8], [10.6, 2.4]] as [number, number][])) b.ico(x, y + 0.3, hillFace(x, y) + 0.3, 0.8, 0.5, 0.7, '#8a9a52');
    // At the foot: the start of the trail between two marker stones, thorn trees, dry scrub, a rest shade
    b.box(-1.6, 0.05, 1, 2.6, 0.03, 9.4, '#e0c898');
    for (const s of [-1, 1]) { b.box(-1.6 + s * 1.9, 0.5, -2.8, 0.6, 1, 0.6, '#c9bca6'); b.box(-1.6 + s * 1.9, 1.06, -2.8, 0.7, 0.12, 0.7, '#e9e4d6'); }
    thornTree(b, -9.6, -1.6, 1.3); thornTree(b, 9.4, -2.2, 1.5); thornTree(b, 12.6, 5.4, 1.1); thornTree(b, -12.8, 6.6, 1.2);
    for (const [x, z, s] of ([[-6.4, 0.6, 0.9], [5.6, 1.6, 0.8], [-11.6, 2.6, 1.1], [12.2, 0.4, 0.9], [7.6, 9.6, 0.8], [-9.4, 10.4, 0.9]] as [number, number, number][])) bush(b, x, z, { s, color: '#9aa05a' });
    for (const [x, z] of ([[6.2, 3.6], [9.8, 3.6], [6.2, 6.2], [9.8, 6.2]] as [number, number][])) b.cyl(x, 1.3, z, 0.08, 2.6, WOOD_DARK, { seg: 5 });
    b.box(8, 2.66, 4.9, 4.4, 0.1, 3.4, MAT);
    bench(b, 8, 5.4, { w: 2.8, ry: PI, color: '#8a6644' });
    extra(b, 'kano-goron-rest', 8, 5.4, PI, 'sit', { seat: 0.6, look: MAN('cream') });
    for (const x of [10.2, 10.9]) { b.ball(x, 0.4, 3.9, 0.34, 0.4, 0.34, '#a8573a', { seg: 7 }); b.cyl(x, 0.8, 3.9, 0.16, 0.08, '#8a4a30', { seg: 7 }); }
    extra(b, 'kano-goron-guide', 3.4, 2.6, PI + 0.5, 'wave', { look: MAN('green') });
    stele(b, context.label, -6.8, 5.6, 0.3, 4.6);
    return { spots: places([-1.6, -0.6, PI], [4.6, 3.6, PI], [0.6, 7.6]), crowd: [[2.4, 7.4, 0.4], [-2.4, 7.6, -0.5], [4.6, 9.4, 2.4], [-4, 2.6, 1.2], [8.6, 9, -0.8], [-10.4, 8.4, 0.8], [3, 10.6, 2.8], [-5.2, 10.4, 2.4], [-11, 4.6, 1.6], [11.6, 9.6, -0.4], [0.2, 9.2, 3.1], [1.6, 0.4, 0.6]], spare: spareFront() };
  },
};

// ---------------------------------------------------------------------------------------------
// City gates. Each stands across a road in earth plaster; only stretches of the old wall remain beside them.

/** What is left of the old wall beyond a gate: a stretch that steps down and ends in worn lumps. */
function wallFragment(b: Batch, x0: number, dir: 1 | -1, z: number, h: number, rand: () => number): void {
  let x = x0;
  for (let i = 0; i < 4; i++) {
    const w = 1.6 + rand() * 1.2, hh = h * (1 - i * 0.24) - rand() * 0.3;
    b.box(x + dir * w / 2, hh / 2, z, w + 0.04, hh, 1.4 - i * 0.14, EARTH[i % 3]!);
    b.box(x + dir * w / 2, hh * 0.2, z, w + 0.06, hh * 0.4, 1.9 - i * 0.14, EARTH[(i + 2) % 3]!);
    b.ico(x + dir * (w / 2 + 0.2), hh - 0.1, z, w * 0.7, 0.6, 0.8, EARTH[(i + 1) % 3]!);
    x += dir * w;
  }
  b.ico(x + dir * 0.6, 0.3, z + 0.3, 0.9, 0.5, 0.8, EARTH[2]!);
}
function road(b: Batch, x: number, w: number, dashes = true): void {
  b.box(x, 0.05, 0, w, 0.04, 26, '#5f5d5b');
  for (const s of [-1, 1]) b.box(x + s * (w / 2 + 0.12), 0.07, 0, 0.24, 0.08, 26, '#cfc8b4');
  if (dashes) for (let z = -12; z < 12.6; z += 2.6) b.box(x, 0.08, z, 0.14, 0.02, 1.3, '#e9e2c8');
}

const gateNassarawa: SceneDef = {
  mood: 'outdoor', accent: '#c79f6b', camera: TALL, walk: OPEN,
  build(b, context) {
    const rand = seeded(83), z = -5, front = z + 2.3;
    dust(b, rand);
    road(b, 0, 5.2);
    // Two massive piers, each with a round tower on its face, and one tall pointed arch between them
    for (const s of [-1, 1]) {
      b.box(s * 4.7, 3.8, z, 4, 7.6, 4.6, EARTH[0]!); b.box(s * 4.7, 0.8, z, 4.3, 1.6, 4.9, EARTH[2]!);
      b.cyl(s * 5, 4.2, front, 1.9, 8.4, EARTH[1]!, { seg: 10, top: 0.82 }); b.cyl(s * 5, 8.5, front, 1.7, 0.24, EARTH[3]!, { seg: 10 });
      for (let i = 0; i < 5; i++) { const a = (i / 5) * PI * 2; zanko(b, s * 5 + Math.sin(a) * 1.4, 8.6, front + Math.cos(a) * 1.4, 0.9); }
      b.box(s * 5, 5.6, front + 1.74, 0.36, 1, 0.1, '#3a2c20');
      relief(b, s * 5, 3, front + 1.86, 1.5, 1.6, 1);
    }
    archSpan(b, 0, z, 2.7, 3.2, 3, 7.6, 4.6, EARTH[0]!, true);
    b.box(0, 7.72, z, 13.6, 0.26, 4.9, EARTH[3]!);
    for (let x = -2.4; x <= 2.4; x += 1.2) { b.box(x, 8.2, front - 0.3, 0.7, 0.8, 0.6, EARTH[1]!); zanko(b, x, 8.6, front - 0.3, 0.7); }
    relief(b, 0, 6.9, front + 0.03, 5, 1, 2);
    streaks(b, rand, 8, -6.4, 6.4, 6.4, front + 0.02, (x) => Math.abs(x) < 3 || Math.abs(Math.abs(x) - 5) < 1.9);
    // The wall: a standing stretch on the left, a worn fragment on the right
    earthWall(b, -11.4, -6.7, z, 4.6, { t: 1.6, tone: 1, gap: 2.2 }); wallFragment(b, -11.4, -1, z, 3.8, rand);
    wallFragment(b, 6.7, 1, z, 4.2, rand);
    // Houses of the old town seen through and beside the gate
    earthHouse(b, -9.4, -10.6, 4.6, 3.4, 2.8, 1); earthHouse(b, 8.6, -10.8, 5, 3.4, 3.2, 2); earthHouse(b, 13, -9.6, 3.4, 3, 2.4, 0);
    tricycle(b, 1.2, 2.4, PI);
    extra(b, 'kano-gate-n-guide', 5.4, 0.6, PI - 0.4, 'wave', { look: MAN('teal') });
    extra(b, 'kano-gate-n-visitor', -5.6, 0.4, PI, 'stand', { look: WOMAN('green') });
    extra(b, 'kano-gate-n-walker', -1.4, -7.6, 0, 'walk', { look: MAN('cream') });
    stele(b, context.label, -8.4, 5.6, 0.35, 4.8);
    neem(b, 11.6, 4.6, 1.3); neem(b, -12.6, 9.6, 1.1, 2); palm(b, 12.6, -5.6, { s: 1.2, ry: 1 });
    bench(b, 9.4, 7.6, { w: 2.8, ry: -HALF, color: '#8a6644' });
    lampPost(b, 3.6, 6.4, { light: true }); lampPost(b, -3.6, -1);
    return { spots: places([-4.4, 2.4, PI], [5.4, 2.4, PI], [-4.6, 7.6]), crowd: crowdFront(), spare: spareFront() };
  },
};

const gateMata: SceneDef = {
  mood: 'outdoor', accent: '#3f5fc0', camera: TALL, walk: OPEN,
  build(b, context) {
    const rand = seeded(89), z = -5.4, front = z + 1.8, pale = '#f4ecd6';
    dust(b, rand, '#d6b888');
    // A divided road: one carriageway through each arch, a planted strip between them
    road(b, -2.9, 3.6, false); road(b, 2.9, 3.6, false);
    b.box(0, 0.12, 4, 1.4, 0.2, 14, '#b8a888');
    for (let i = 0; i < 4; i++) b.ico(0, 0.5, 0.4 + i * 3, 0.5, 0.36, 0.5, i % 2 ? '#8a9a52' : '#6f9a52');
    // A long, lower gatehouse: three piers, two round arches, a stepped parapet with a raised panel in the middle
    for (const [x, w] of ([[-6.2, 2.9], [0, 1.9], [6.2, 2.9]] as [number, number][])) { b.box(x, 3.1, z, w, 6.2, 3.6, EARTH[3]!); b.box(x, 0.7, z, w + 0.3, 1.4, 3.9, EARTH[1]!); }
    for (const s of [-1, 1]) {
      archSpan(b, s * 2.85, z, 1.9, 3, 1.9, 6.2, 3.6, EARTH[3]!);
      relief(b, s * 6.2, 3.2, front + 0.03, 2, 3, 3, 0, pale); relief(b, s * 2.85, 5.6, front + 0.03, 3.4, 0.8, 2, 0, pale);
      b.box(s * 5.6, 6.7, z, 4, 0.9, 3.4, EARTH[3]!);
    }
    relief(b, 0, 2.8, front + 0.03, 1.2, 2.4, 0, 0, pale);
    b.box(0, 6.33, z, 15.6, 0.26, 3.9, pale);
    b.box(0, 7.3, z, 6.4, 2, 3.2, EARTH[3]!); b.box(0, 8.4, z, 6.7, 0.22, 3.4, pale);
    relief(b, 0, 7.35, front - 0.17, 3, 1.6, 1, 0, pale);
    for (let i = 0; i < 9; i++) { const x = -7.2 + i * 1.8, y = Math.abs(x) < 3.3 ? 8.5 : 7.15; zanko(b, x, y, front - 0.3, 0.8, pale); }
    // The wall beside the gate: a long standing stretch on the left with dyed cloths spread on it to dry, a fragment on the right
    earthWall(b, -14.6, -7.7, z, 3.8, { t: 1.4, tone: 1, pinnacles: false });
    for (let i = 0; i < 3; i++) longCloth(b, -13 + i * 2.2, 2.2, z + 0.74, 1.8, 2.8, i);
    wallFragment(b, 7.7, 1, z, 3.6, rand);
    for (const x of [-13.6, -8.6]) b.cyl(x, 1.6, 0.6, 0.08, 3.2, WOOD_DARK, { seg: 5 });
    b.box(-11.1, 3.1, 0.6, 5, 0.06, 0.06, '#c9b88f');
    for (let i = 0; i < 3; i++) longCloth(b, -12.6 + i * 1.6, 1.9, 0.64, 1.3, 2.4, i + 2);
    earthHouse(b, 10.6, -10.6, 5, 3.4, 3, 1); earthHouse(b, -10.6, -10.8, 4.4, 3.2, 2.6, 2);
    tricycle(b, 2.9, -1.4, 0); tricycle(b, -2.9, 5.4, PI);
    extra(b, 'kano-gate-m-guide', 7.4, 0.8, PI - 0.5, 'wave', { look: MAN('blue') });
    extra(b, 'kano-gate-m-dyer', -9.6, 1.8, PI, 'work', { look: MAN('navy', { fabric: 'adire' }) });
    extra(b, 'kano-gate-m-visitor', 6.4, 4.6, 2.8, 'stand', { look: WOMAN('violet') });
    stele(b, context.label, 9.6, 6.4, -0.35, 4);
    neem(b, 12.8, 1.6, 1.2, 1); palm(b, -12.8, 9.6, { s: 1.1 }); palm(b, 13.2, -5.6, { s: 1.2, ry: 2 });
    lampPost(b, 5.6, 8.6, { light: true }); lampPost(b, -5.6, 8.6);
    return {
      spots: places([-6.4, 3.6, PI], [7.4, 2.4, PI], [-6.4, 8]),
      crowd: [[5.6, 6.4, 0.4], [-5.4, 7.6, -0.5], [7.6, 9.2, 2.4], [-7.4, 5.6, 1.2], [9.6, 10.4, -0.8], [-8.4, 10, 0.8], [6, 10.6, 2.8], [-5.2, 10.4, 2.4], [-11, 7.4, 1.6], [11.4, 9.2, -0.4], [0.2, 11.6, 3.1], [9.4, 3.2, 0.6]],
      spare: [[-6, 9.2], [6, 9], [-9.4, 8.4], [8.4, 7.4]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Historic gate site: the gate itself is gone. A road runs under a modern bridge; a fenced fragment of the old earth
// wall and a plaque mark the place.

const kabugaSite: SceneDef = {
  mood: 'outdoor', accent: '#8f9aa3', camera: TALL, walk: OPEN,
  build(b, context) {
    const rand = seeded(97), concrete = '#bdb9ae', dark = '#9a968b';
    dust(b, rand, '#d2b88e');
    // The lower road, running under the bridge; a marked crossing in front
    road(b, 2, 6.4);
    for (let i = 0; i < 6; i++) b.box(-0.6 + i * 1.04, 0.08, 6.4, 0.6, 0.02, 2.2, '#e9e2c8');
    // The bridge: a concrete deck on round piers and abutments, parapets, lamps and a car crossing it
    b.box(0, 5, -6.4, 30.8, 0.8, 6.6, concrete); b.box(0, 5.42, -6.4, 30.8, 0.06, 5.6, '#5f5d5b');
    for (const s of [-1, 1]) { b.box(0, 5.8, -6.4 + s * 3.1, 30.8, 0.8, 0.3, concrete); b.box(0, 6.22, -6.4 + s * 3.1, 30.8, 0.08, 0.4, dark); }
    for (const x of [-2.2, 6.2]) for (const dz of [-2, 2]) { b.cyl(x, 2.3, -6.4 + dz, 0.5, 4.6, concrete, { seg: 10 }); b.box(x, 4.5, -6.4 + dz, 1.5, 0.3, 1.5, dark); }
    for (const [x0, x1] of ([[-15.2, -3.8], [7.8, 15.2]] as [number, number][])) {
      b.box((x0 + x1) / 2, 2.3, -6.4, x1 - x0, 4.6, 6.4, dark);
      for (let x = x0 + 1.9; x < x1 - 0.4; x += 1.9) b.box(x, 2.3, -3.18, 0.1, 4.6, 0.04, '#8a867b');
    }
    b.box(2, 4.3, -3.06, 7.4, 0.5, 0.1, '#e8b820'); for (let i = 0; i < 7; i++) b.quad(-1.2 + i * 1.06, 4.3, -3, 0.5, 0.5, '#22252a', { rz: 0.5 });
    b.at(-6.4, 5.45, -5.2, HALF, () => car(b, 0, 0, { color: '#c9c4b4' }));
    for (const x of [-10, 0, 10]) { b.cyl(x, 8, -9.2, 0.08, 4, METAL_DARK, { seg: 5 }); b.box(x, 10, -8.7, 0.3, 0.12, 1.2, METAL_DARK); b.box(x, 9.92, -8.2, 0.3, 0.08, 0.4, WARM, GLOW); }
    tricycle(b, 3.4, 1.6, PI);
    // The fragment: a short, worn stretch of earth wall behind a low rail, with a plaque that names the site
    b.box(-10, 0.3, -0.4, 7.6, 0.6, 2.1, EARTH[2]!);
    wallFragment(b, -13.6, 1, -0.4, 3.2, rand);
    b.ico(-13.4, 1.2, -0.4, 0.8, 1.2, 0.8, EARTH[1]!);
    for (let i = 0; i < 5; i++) b.quad(-13.2 + rand() * 3.6, 1 + rand() * 0.9, 0.37, 0.1, 0.7 + rand() * 0.5, '#a67d50');
    fence(b, [-13.8, 1.4], [-5.4, 1.4], { h: 0.9, color: METAL, gap: 1.7 }); fence(b, [-5.4, 1.4], [-5.4, -1.2], { h: 0.9, color: METAL, gap: 1.3 });
    b.at(-8.6, 0, 3.2, 0.2, () => {
      const text = plain(context.label);
      for (const s of [-1, 1]) b.box(s * 2.4, 0.7, 0, 0.12, 1.4, 0.12, METAL_DARK);
      b.box(0, 1.6, 0, 5.6, 1.5, 0.12, '#2f3b36');
      const cut = text.search(/ historic site$/i), name = cut > 0 ? text.slice(0, cut) : text;
      sign(b, 0, 1.92, 0.08, name, { size: fit(name, 5, 0.36), color: '#f1e6c4' });
      sign(b, 0, 1.34, 0.08, 'HISTORIC SITE', { size: 0.24, color: '#d6c38a' });
    });
    extra(b, 'kano-kabuga-guide', -5.6, 4.2, PI + 0.6, 'wave', { look: MAN('teal') });
    extra(b, 'kano-kabuga-visitor', -10.4, 4.6, PI, 'stand', { look: WOMAN('orange') });
    extra(b, 'kano-kabuga-walker', 7.4, 3.6, -0.4, 'walk', { look: MAN('cream') });
    bench(b, 9.4, 6.6, { w: 2.8, ry: -HALF, back: true, color: '#6a6e72', leg: METAL_DARK });
    neem(b, 11.8, 2.4, 1.2); neem(b, -12.4, 8.8, 1.1, 1);
    lampPost(b, -2.6, 8.6, { light: true }); lampPost(b, 6.6, 8.6);
    return { spots: places([-8.4, 5.4, PI], [-4.6, 5.4, PI], [-3.4, 9]), crowd: [[7.4, 7.4, 0.4], [-2.4, 6.6, -0.5], [8.6, 4.2, 2.4], [-6, 8.4, 1.2], [8.6, 9.8, -0.8], [-8.4, 9.6, 0.8], [6.4, 10.6, 2.8], [-5.2, 10.6, 2.4], [-11.4, 6.6, 1.6], [11.4, 9.6, -0.4], [-1.6, 9.4, 3.1], [10.4, 0.4, 0.6]], spare: [[-6, 7.2], [6.6, 9], [-3, 10.6], [8.4, 8.4]] };
  },
};

/** The old city's scenes by kind, then by variant. */
export const OLD_CITY: Record<string, Record<string, SceneDef>> = {
  walk: { 'kano-palace-gate': palaceGate, 'kano-dala': dala, 'kano-goron-dutse': goronDutse, 'kano-gate-nassarawa': gateNassarawa, 'kano-gate-mata': gateMata, 'kano-kabuga-site': kabugaSite },
  worship: { 'kano-central-mosque': centralMosque },
  market: { 'kano-dye-pits': dyePits, 'kano-kurmi': kurmi },
  office: { 'kano-museum': museum },
};
