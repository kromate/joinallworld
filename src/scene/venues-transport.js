/**
 * OWNER: scenes
 * The airport terminal and the refinery yard. Scene definition format: see venues-outdoor.js.
 * Their walkable descriptions (WALK) are with the other kinds in venue-scenes.js.
 */
import { GLOW, GLASS } from './build.ts';
import {
  ground, table, chair, bench, counter, plant, lampPost, kiosk, ropeLine, fence, rug, sign, landmark, extra,
  WOOD_LIGHT, METAL, METAL_DARK, WHITE, BLACK, WARM,
} from './props.js';

const PI = Math.PI, HALF = Math.PI / 2;
const AMBER = '#ffc94a', NAVY = '#2f4a66', TANK = '#dfe2e0';

/** An airliner on the ground, nose along local +z. */
function airliner(b, x, y, z, ry, tail) {
  b.at(x, y, z, ry, () => {
    b.cyl(0, 1.75, 0, 0.95, 9, WHITE, { seg: 10, rx: HALF });
    b.cone(0, 1.75, 5.3, 0.95, 1.6, WHITE, { seg: 10, rx: HALF });
    b.cone(0, 1.95, -5.4, 0.9, 1.8, WHITE, { seg: 10, rx: -HALF });
    for (const side of [-1, 1]) {
      b.box(side * 0.94, 1.95, 0.4, 0.05, 0.24, 6.6, '#33414f');
      b.box(side * 3.1, 1.45, 0.1 - 0.5, 4.6, 0.16, 1.8, '#d9d4c4', { ry: side * 0.28 });
      b.cyl(side * 2.5, 0.95, 0.5, 0.42, 1.5, '#7d858c', { seg: 8, rx: HALF });
      b.box(side * 1.2, 2.15, -5, 1.7, 0.12, 0.9, '#d9d4c4');
      b.cyl(side * 0.6, 0.3, -0.4, 0.3, 0.2, BLACK, { seg: 6, rz: HALF });
    }
    b.cyl(0, 0.3, 3.6, 0.3, 0.2, BLACK, { seg: 6, rz: HALF });
    b.box(0, 3.45, -5, 0.16, 2.5, 1.5, tail);
    b.box(0, 2.25, 4.9, 0.9, 0.22, 0.5, '#33414f');
  });
}

const airport = {
  mood: 'indoor', accent: '#3f9ad0',
  build(b, { accent }) {
    // The hall: a floor, a solid left wall, and a back wall of glass on the apron (drawn here instead of room(), which has no glass).
    b.walls?.({ w: 24, d: 20 });
    b.box(0, -0.25, 0, 25, 0.5, 21, '#565c63');
    b.box(0, 0.02, 0, 24, 0.06, 20, '#d5dadd');
    b.box(-12.2, 2.75, 0, 0.4, 5.5, 20, '#e6e9ea');
    b.box(-11.96, 0.2, 0, 0.08, 0.4, 20, '#9aa6ad'); b.box(-12.2, 5.6, 0, 0.5, 0.2, 20, '#9aa6ad');
    b.box(0, 0.45, -10.2, 24.8, 0.9, 0.4, '#e6e9ea');
    b.box(0, 3.05, -10.2, 24.8, 4.3, 0.1, '#cfeaf5', GLASS);
    for (let i = 0; i <= 8; i++) b.box(-12 + i * 3, 3.05, -10.2, 0.14, 4.3, 0.3, METAL);
    b.box(0, 5.35, -10.2, 24.8, 0.5, 0.5, '#9aa6ad');
    b.box(0, 0.06, 2, 1.2, 0.02, 15, accent); b.box(-3, 0.06, -4.4, 15, 0.02, 0.5, accent);
    // Outside: the apron, one plane nose-in at its stand (seen through the glass from the viewing deck), the control tower.
    b.box(0, -0.2, -17, 30, 0.2, 13, '#8d9296');
    for (let i = 0; i < 7; i++) b.box(-12 + i * 4, -0.09, -22, 2, 0.02, 0.3, WHITE);
    b.box(3, -0.09, -15, 0.2, 0.02, 8, AMBER);
    airliner(b, 3, -0.1, -17.6, 0, accent);
    b.cyl(9.5, 4, -20, 0.9, 8.2, '#d9d4c4', { seg: 8 });
    b.cyl(9.5, 8.75, -20, 1.75, 1.3, '#55707c', { seg: 8, top: 1.2 });
    b.cyl(9.5, 8.8, -20, 1.9, 0.5, '#bfe9f5', { seg: 8, top: 1.14, open: true, ...GLOW });
    b.cyl(9.5, 9.5, -20, 2.2, 0.2, '#d9d4c4', { seg: 8 });
    b.cyl(9.5, 10.4, -20, 0.04, 1.6, METAL, { seg: 4 }); b.ico(9.5, 11.3, -20, 0.16, 0.16, 0.16, '#ff3b30', GLOW);
    // Check-in: three desks under a gantry of screens, a belt beside each.
    for (let i = 0; i < 3; i++) {
      const x = -9.4 + i * 3;
      counter(b, x, -6.6, { w: 1.9, d: 0.9, color: NAVY, top: '#cfd6dc', stripe: accent });
      b.box(x + 1.35, 0.3, -6.6, 0.6, 0.5, 1.7, '#3d444b'); b.box(x + 1.35, 0.57, -6.6, 0.5, 0.04, 1.6, '#22252a');
      b.box(x, 3.5, -6.9, 1.7, 0.7, 0.12, BLACK); b.quad(x, 3.5, -6.83, 1.5, 0.5, i === 1 ? '#7fe0a8' : '#9fd8ff', GLOW);
      b.box(x + 1.35, 0.85, -6.3 - i * 0.3, 0.44, 0.52, 0.3, ['#c9423a', '#3f9a5a', '#7a4bb0'][i]);
    }
    for (const x of [-10.9, -1.9]) b.box(x, 1.95, -6.9, 0.12, 3.9, 0.12, METAL_DARK);
    b.box(-6.4, 3.95, -6.9, 9.2, 0.14, 0.16, METAL_DARK);
    sign(b, -6.4, 4.4, -6.86, 'CHECK-IN', { size: 0.34, color: WHITE, lit: true, board: NAVY, pad: 0.16 });
    const staff = { outfit: 'office', outfitColor: 'navy', bottomsColor: 'navy', fabric: 'plain' };
    extra(b, 'airport-checkin-1', -9.4, -7.7, 0, 'work', { look: { body: 'woman', hair: 'bun', ...staff } });
    extra(b, 'airport-checkin-2', -3.4, -7.7, 0, 'work', { look: { body: 'man', hair: 'lowcut', ...staff } });
    ropeLine(b, [[-10.4, -4.9], [-8.2, -4.9], [-8.2, -3.4]], { post: METAL, rope: NAVY });
    // The departures board on the left wall.
    b.box(-11.92, 3.3, -1.4, 0.12, 2.6, 6.4, BLACK);
    for (let row = 0; row < 6; row++) {
      [[-3.3, 2.2], [-1, 1.5], [1.2, 0.7]].forEach(([dz, w], col) => b.quad(-11.84, 4.25 - row * 0.38, -1.4 - dz - w / 2 + 0.6, w - ((row * 3 + col) % 3) * 0.2, 0.14, col === 2 ? (row % 3 === 1 ? '#ff7a5a' : '#7fe0a8') : AMBER, { ry: HALF, ...GLOW }));
    }
    sign(b, -11.9, 4.98, -1.4, 'DEPARTURES', { size: 0.3, color: NAVY, ry: HALF });
    // Waiting seats, back to back, with luggage.
    bench(b, 1.6, -1.5, { w: 5.2, ry: PI, back: true, color: '#4d6f8f', leg: METAL_DARK });
    bench(b, 1.6, -0.6, { w: 5.2, back: true, color: '#4d6f8f', leg: METAL_DARK });
    extra(b, 'airport-waiting-1', 0.2, -1.5, PI, 'sit'); extra(b, 'airport-waiting-2', 2.9, -0.6, 0, 'sit', { look: { accessories: ['backpack'] } });
    b.box(3.9, 0.45, 0.1, 0.5, 0.8, 0.34, '#c9423a'); b.box(3.9, 0.92, 0.1, 0.26, 0.14, 0.04, BLACK); b.box(-0.9, 0.36, -2.3, 0.7, 0.6, 0.4, '#e8a13a');
    // The viewing deck along the glass: a rail and a telescope.
    rug(b, 4, -8.5, 5.6, 1.9, '#3f5f7a', { border: '#cfd6dc' });
    for (let i = 0; i <= 3; i++) b.cyl(1.3 + i * 1.8, 0.55, -9.7, 0.05, 1.1, METAL, { seg: 5 });
    b.box(4, 1.1, -9.7, 5.6, 0.08, 0.08, METAL);
    b.cyl(6.4, 0.7, -9.2, 0.07, 1.4, METAL_DARK, { seg: 5 }); b.cyl(6.4, 1.5, -9.3, 0.15, 0.7, '#c9423a', { seg: 7, rx: HALF + 0.2 });
    // Arrivals: a portal, the baggage carousel behind it and a rope for the people who came to meet somebody.
    for (const x of [7.5, 11.3]) b.box(x, 1.7, -6.6, 0.3, 3.4, 0.3, NAVY);
    b.box(9.4, 3.5, -6.6, 4.3, 0.7, 0.3, NAVY);
    sign(b, 9.4, 3.5, -6.42, 'ARRIVALS', { size: 0.32, color: AMBER, lit: true });
    b.cyl(9.4, 0.3, -8.3, 1.5, 0.6, '#3d444b', { seg: 12, sz: 0.62 }); b.cyl(9.4, 0.62, -8.3, 1.3, 0.06, '#22252a', { seg: 12, sz: 0.6 });
    for (const [dx, dz, colour] of [[-0.8, 0.3, '#3f72c4'], [0.3, -0.5, '#c9423a'], [0.9, 0.4, '#2f8f55']]) b.box(9.4 + dx, 0.86, -8.3 + dz, 0.6, 0.42, 0.4, colour);
    ropeLine(b, [[7.3, -4.6], [9.4, -4.6], [11.5, -4.6]]);
    extra(b, 'airport-greeter', 10.5, -3.6, PI, 'wave', { look: { body: 'woman', outfit: 'owambe', hair: 'gele', fabric: 'ankara' } });
    b.at(6.4, 0, -2.6, 0.5, () => { b.box(0, 0.5, 0, 0.7, 0.06, 1.1, METAL); b.box(0, 0.75, 0.1, 0.56, 0.44, 0.8, '#7a4bb0'); b.box(0, 1, -0.55, 0.7, 0.06, 0.06, METAL); for (const sx of [-0.3, 0.3]) b.box(sx, 0.75, -0.55, 0.05, 0.5, 0.05, METAL); });
    // Food court on the left wall.
    counter(b, -10.8, 5.2, { w: 5.6, d: 1.1, ry: HALF, color: '#b5483f', top: WOOD_LIGHT, stripe: WARM });
    sign(b, -11.92, 3.3, 5.2, 'FOOD COURT', { size: 0.3, color: '#b5483f', ry: HALF });
    b.box(-10.9, 1.75, 3.4, 0.7, 0.8, 0.8, '#2a2d33'); b.quad(-10.54, 1.8, 3.4, 0.3, 0.2, '#ffb070', { ry: HALF, ...GLOW });
    for (let i = 0; i < 3; i++) b.cyl(-10.7, 1.5, 4.6 + i * 0.5, 0.2, 0.3, ['#3a3d42', '#8b9096', '#3a3d42'][i], { seg: 8, top: 1.1 });
    extra(b, 'airport-cook', -11.2, 6.6, HALF, 'work', { look: { outfit: 'casual', outfitColor: 'cream' } });
    table(b, -6.4, 5.6, { round: true, w: 1.5 }); chair(b, -7.5, 5.6, { ry: HALF, color: '#b5483f' }); chair(b, -5.3, 5.6, { ry: -HALF, color: '#b5483f' });
    table(b, -4.6, 8.4, { round: true, w: 1.5 }); chair(b, -5.7, 8.4, { ry: HALF, color: '#b5483f' }); chair(b, -3.5, 8.4, { ry: -HALF, color: '#b5483f' });
    b.cyl(-6.4, 1.14, 5.6, 0.2, 0.06, WHITE, { seg: 8 }); b.cyl(-6.1, 1.2, 5.8, 0.07, 0.2, '#6b3a1e', { seg: 5 });
    // The travel desk and its board of flights.
    counter(b, 8.6, 4.4, { w: 4.2, d: 1, color: '#1f5f5a', top: '#cfd6dc', stripe: AMBER });
    for (const x of [6.5, 10.7]) b.box(x, 1.7, 2.7, 0.12, 3.4, 0.12, METAL_DARK);
    b.box(8.6, 2.8, 2.7, 4.6, 1.9, 0.12, BLACK);
    sign(b, 8.6, 3.42, 2.78, 'FLIGHTS', { size: 0.26, color: WHITE, lit: true });
    sign(b, 7.3, 2.86, 2.78, 'ABUJA', { size: 0.2, color: AMBER, lit: true });
    sign(b, 8.26, 2.4, 2.78, 'PORT HARCOURT', { size: 0.2, color: AMBER, lit: true });
    for (const y of [2.86, 2.4]) b.quad(10.3, y, 2.78, 0.5, 0.08, '#8a8f95', GLOW);
    extra(b, 'airport-agent', 8.6, 3.4, 0, 'work', { look: { body: 'man', hair: 'fade', outfit: 'office', outfitColor: 'teal', fabric: 'plain' } });
    b.box(9.8, 1.42, 4.4, 0.5, 0.06, 0.36, '#f4f1e4'); b.cyl(7.2, 1.5, 4.5, 0.16, 0.3, accent, { seg: 8 });
    plant(b, 11, 8.9, { s: 1.3, pot: WHITE }); plant(b, -11, 9.2, { s: 1.1, pot: WHITE }); plant(b, -0.6, -9.2, { s: 1, pot: WHITE });
    b.light(-4, 4.6, -3, '#f2f8ff', 20, 14); b.light(6, 4.6, 1, '#f2f8ff', 18, 13);
    return {
      spots: [
        landmark('departures', /depart|check|board|hall|flight|gate|plane|terminal/, -5.6, -3.4, PI),
        landmark('arrivals', /arriv|welcome|meet|bag|carry|luggage|porter/, 8.6, -3.2, PI, { act: { pose: 'wave' } }),
        landmark('deck', /deck|view|photo|runway|watch|glass|window/, 4, -8.2, PI, { act: { pose: 'work' } }),
        landmark('lounge', /food|court|lounge|eat|drink|cafe|canteen|restroom|rest/, -8.9, 4.4, -HALF, { act: { pose: 'sit', x: -7.5, z: 5.6, ry: HALF, seat: 0.6 } }),
        landmark('desk', /desk|travel|ticket|route|agent|book|work|job|shift/, 8.6, 6.1, PI),
        landmark('people', /people|crowd|meet/, 1.2, 4.6, 0),
      ],
      crowd: [[3.4, 7.6, 0.4], [-1.6, 7.2, -0.5], [-1.4, 2.4, 1.2], [4.6, 2.2, 2.4], [-3.4, -2.6, 2.6], [5.6, -3.4, PI], [-8.6, 0.6, 1.2], [0.6, 8.8, 0.2], [5.4, 8.4, -0.6], [-5.6, 1.2, 1.8], [10.6, 0.6, -1.2], [1.6, -5.6, PI]],
    };
  },
};

const refinery = {
  mood: 'outdoor', accent: '#f2c230',
  build(b, { accent }) {
    ground(b, { w: 30, d: 26, color: '#a39d8f', edge: '#77736a' });
    b.box(0.5, 0.04, 3.4, 5.4, 0.04, 17.6, '#6b6f75');                       // the road in from the gate
    b.box(3.4, 0.04, -3.2, 21, 0.04, 2.6, '#6b6f75');
    for (let i = 0; i < 6; i++) b.box(0.5, 0.07, -2 + i * 2.4, 0.16, 0.02, 1.2, accent);
    // The tank farm, the columns and the flare stack, along the back.
    for (const [x, z, r, h] of [[4.8, -9.2, 2.5, 4.2], [10.6, -9.4, 2.5, 4.2]]) {
      b.cyl(x, h / 2, z, r, h, TANK, { seg: 14 });
      b.cyl(x, h + 0.2, z, r * 0.97, 0.4, '#b8bcba', { seg: 14, top: 0.45 });
      b.cyl(x, h * 0.62, z, r * 1.01, 0.4, '#3f72c4', { seg: 14, open: true });
      b.box(x + r * 0.72, h / 2, z + r * 0.72, 0.5, h, 0.08, METAL_DARK, { ry: PI / 4 });
    }
    for (const [x, z, r, h] of [[-3.6, -9.6, 0.75, 9.4], [-1.5, -10.2, 0.55, 7.2]]) {
      b.cyl(x, h / 2, z, r, h, '#aab0b3', { seg: 10 });
      b.cyl(x, h + 0.25, z, r, 0.5, '#8a8f95', { seg: 10, top: 0.3 });
      for (let level = 1; level <= 3; level++) b.cyl(x, (h / 4) * level + 0.6, z, r * 1.7, 0.1, METAL_DARK, { seg: 10 });
      for (let band = 0; band < 2; band++) b.cyl(x, h - 0.9 - band * 1.1, z, r * 1.02, 0.36, band ? WHITE : '#c9423a', { seg: 10, open: true });
    }
    b.box(-2.55, 5.4, -9.9, 2.2, 0.2, 0.2, '#8a8f95', { ry: 0.28 });
    b.cyl(13, 6, -11.2, 0.2, 12, '#8a8f95', { seg: 6 });
    for (let i = 0; i < 4; i++) b.box(13, 1.5 + i * 3, -11.2, 0.9 - i * 0.14, 0.08, 0.9 - i * 0.14, METAL_DARK);
    b.cone(13, 12.8, -11.2, 0.5, 1.7, '#ff7a2f', { seg: 6, ...GLOW }); b.cone(13, 12.6, -11.2, 0.28, 1.1, '#ffe08a', { seg: 5, ...GLOW });
    // The pipe rack between the plant and the yard.
    for (let i = 0; i < 5; i++) {
      const x = -5.6 + i * 4.6;
      for (const dz of [-0.55, 0.55]) b.box(x, 1.45, -5.6 + dz, 0.16, 2.9, 0.16, METAL_DARK);
      b.box(x, 2.9, -5.6, 0.16, 0.14, 1.5, METAL_DARK);
    }
    [[-0.4, '#c9ced3', 0.17], [0, accent, 0.13], [0.4, '#a85c40', 0.17]].forEach(([dz, colour, r]) => b.cyl(3.6, 3.14, -5.6 + dz, r, 19, colour, { seg: 7, rz: HALF }));
    b.cyl(4.8, 3.9, -6.4, 0.17, 1.6, '#c9ced3', { seg: 7 }); b.cyl(10.6, 3.9, -6.5, 0.17, 1.6, '#c9ced3', { seg: 7 });
    // The control room: a block with a window wall, and the operators' console under its canopy.
    b.box(-10.4, 1.7, -8.6, 6.4, 3.4, 4.4, '#d9d4c4');
    b.box(-10.4, 3.5, -8, 6.8, 0.2, 5.8, '#55707c');
    b.box(-10.4, 2, -6.38, 5.2, 1.5, 0.06, '#9fd0e6', GLASS);
    sign(b, -10.4, 3.02, -6.36, 'CONTROL', { size: 0.26, color: WHITE, board: '#55707c', pad: 0.12 });
    for (const x of [-13.5, -7.3]) b.box(x, 1.7, -5.3, 0.14, 3.4, 0.14, METAL_DARK);
    counter(b, -10.4, -4.7, { w: 4.4, d: 0.9, h: 1.1, color: '#3d444b', top: '#2a2d33' });
    for (let i = 0; i < 3; i++) { b.box(-11.8 + i * 1.4, 1.62, -4.9, 1.1, 0.8, 0.1, BLACK, { rx: -0.2 }); b.quad(-11.8 + i * 1.4, 1.62, -4.83, 0.94, 0.62, ['#7fe0a8', '#9fd8ff', AMBER][i], { rx: -0.2, ...GLOW }); }
    b.cyl(-8.7, 1.2, -4.5, 0.12, 0.08, '#e0483f', { seg: 8, ...GLOW });
    const crew = { outfit: 'sitework', fabric: 'plain' };
    extra(b, 'refinery-operator', -11.8, -3.5, PI + 0.2, 'work', { look: { body: 'woman', hair: 'bun', ...crew } });
    // The main gate: fence, gantry, gate house and a raised boom.
    fence(b, [-14.4, 10.6], [-2.6, 10.6], { h: 1.5, color: METAL, gap: 1.6 });
    fence(b, [3.6, 10.6], [14.4, 10.6], { h: 1.5, color: METAL, gap: 1.6 });
    for (const x of [-2.6, 3.6]) b.box(x, 2.3, 10.6, 0.3, 4.6, 0.3, '#2f4a45');
    b.box(0.5, 4.6, 10.6, 6.6, 0.9, 0.3, '#2f4a45');
    sign(b, 0.5, 4.6, 10.78, 'REFINERY', { size: 0.44, color: WHITE });
    b.box(-4.8, 1.3, 8.6, 2.2, 2.6, 2.2, '#ece2c6'); b.box(-4.8, 2.7, 8.6, 2.7, 0.2, 2.7, '#2f4a45');
    b.box(-3.68, 1.6, 8.6, 0.04, 0.9, 1.4, '#9fd0e6', GLASS);
    for (let i = 0; i < 3; i++) b.ball(-5.4 + i * 0.5, 2.92, 8.6, 0.2, 0.14, 0.2, i === 1 ? WHITE : accent, { seg: 6 });
    b.box(-2.9, 0.6, 9.9, 0.3, 1.2, 0.3, '#3d444b');
    for (let i = 0; i < 4; i++) b.box(-2.74 + i * 0.26, 1.5 + i * 0.72, 9.9, 0.14, 0.8, 0.14, i % 2 ? WHITE : '#c9423a', { rz: -0.34 });
    extra(b, 'refinery-guard', -3, 8.3, HALF, 'stand', { look: { body: 'man', hair: 'lowcut', accessories: ['cap'], ...crew } });
    // The loading bay: a flat-bed truck, drums on a pallet, a tanker waiting behind.
    b.box(9.6, 0.05, 4.2, 8.4, 0.03, 6.4, '#8f8b7c');
    for (const z of [1.1, 7.3]) b.box(9.6, 0.08, z, 8.4, 0.02, 0.2, accent);
    b.at(10.8, 0, 4.6, 0, () => {
      b.box(0, 0.75, -0.6, 2.1, 0.24, 4.6, '#3d444b'); b.box(0, 1.5, 2.5, 2.1, 1.9, 1.6, '#2f8f55'); b.box(0, 1.85, 3.32, 1.8, 0.7, 0.04, '#8fb8cc');
      for (const sx of [-1, 1]) for (const sz of [-2, 0.2, 2.4]) b.cyl(sx * 0.98, 0.42, sz, 0.42, 0.26, BLACK, { seg: 8, rz: HALF });
      for (const [dx, dz] of [[-0.5, -2.2], [0.5, -2.2], [-0.5, -1.2]]) b.cyl(dx, 1.36, dz, 0.36, 0.98, '#2b5fa8', { seg: 8 });
    });
    b.box(7.6, 0.1, 2.6, 1.7, 0.16, 1.7, WOOD_LIGHT);
    for (const [dx, dz, colour] of [[-0.4, -0.4, '#2b5fa8'], [0.4, -0.4, '#2b5fa8'], [-0.4, 0.4, '#c9423a'], [0.4, 0.4, '#2b5fa8']]) b.cyl(7.6 + dx, 0.67, 2.6 + dz, 0.36, 0.98, colour, { seg: 8 });
    b.at(12.6, 0, -2.2, HALF, () => {
      b.box(0, 0.7, 0, 1.9, 0.2, 5.4, '#3d444b'); b.cyl(0, 1.75, -0.7, 0.95, 3.8, TANK, { seg: 10, rx: HALF }); b.box(0, 1.5, 2.1, 1.9, 1.7, 1.2, '#c9423a');
      for (const sx of [-1, 1]) for (const sz of [-2, 1.9]) b.cyl(sx * 0.9, 0.42, sz, 0.42, 0.26, BLACK, { seg: 8, rz: HALF });
    });
    extra(b, 'refinery-loader', 8.6, 0.6, 0.6, 'work', { look: { body: 'man', hair: 'fade', ...crew } });
    // The canteen: a serving hatch and one long table.
    kiosk(b, -11.6, 4.4, { ry: HALF, w: 3.4, color: '#c9b48a', roof: '#2f8f55', fascia: '#ece2c6', text: 'CANTEEN', textColor: '#2f4a45' });
    table(b, -5.8, 5.6, { w: 2.4, d: 1 }); bench(b, -5.8, 4.7, { w: 2.4 }); bench(b, -5.8, 6.5, { w: 2.4 });
    extra(b, 'refinery-lunch', -5.2, 6.5, PI, 'sit', { look: { body: 'woman', ...crew } });
    b.cyl(-6.2, 1.1, 5.6, 0.2, 0.06, WHITE, { seg: 8 });
    // The viewpoint: a rail towards the plant and a tripod left standing.
    fence(b, [-0.6, -3.9], [-5.2, -3.9], { h: 1.05, color: accent, gap: 1.2 });
    b.box(-2.9, 0.05, -2.6, 5, 0.03, 2.4, '#8f8b7c');
    for (let i = 0; i < 3; i++) b.box(-4.6 + Math.sin(i * 2.1) * 0.24, 0.6, -3 + Math.cos(i * 2.1) * 0.24, 0.05, 1.3, 0.05, BLACK, { rz: Math.sin(i * 2.1) * 0.3, rx: -Math.cos(i * 2.1) * 0.3 });
    b.box(-4.6, 1.34, -3, 0.34, 0.24, 0.22, BLACK);
    lampPost(b, -7.2, 0.6, { light: true }); lampPost(b, 4.8, 8.8); lampPost(b, 4.4, -1.4, { light: true });
    return {
      spots: [
        landmark('gate', /gate|induct|safety|sign|guard|entrance|visitor/, -1.6, 7.6, -HALF),
        landmark('control', /control|room|operator|console|learn|class|process/, -10.4, -3, PI, { act: { pose: 'work' } }),
        landmark('loading', /load|bay|drum|truck|tanker|carry|tally|work|job|shift/, 8.2, 4.6, HALF, { act: { pose: 'work' } }),
        landmark('canteen', /canteen|eat|food|rice|water|drink|restroom|lunch/, -8.3, 5.3, -HALF, { act: { pose: 'sit', x: -6.6, z: 4.7, ry: 0, seat: 0.6 } }),
        landmark('view', /view|photo|flare|tank|watch|look/, -2.9, -2.6, PI, { act: { pose: 'work' } }),
        landmark('people', /people|crowd|meet/, 3.4, 3.2, 0),
      ],
      crowd: [[2.6, 8.2, 0.4], [-1.6, 4.4, -0.5], [4.6, 5.4, 1.2], [5.4, -0.6, 2.4], [-7.6, -1.6, 2.6], [1.6, -3.2, PI], [-9.6, 1.4, 1.2], [0.4, 0.6, 0.2], [6.4, 9, -0.6], [-3.6, 2.2, 1.8], [8.6, -3.4, -1.2], [-12.4, 9, 0.8]],
    };
  },
};

export const SCENES = { airport, refinery };
