/**
 * OWNER: scenes
 * Civic venues: hospital, police station and places of worship (church and mosque variants).
 * Scene definition format: see venues-outdoor.js.
 */
import { GLOW, GLASS } from './build.js';
import {
  room, table, chair, stool, bench, counter, screen, plant, shelf, bed, desk, laptop, rug, column, flag, windowPane, door, sign, landmark, extra,
  WOOD, WOOD_DARK, WOOD_LIGHT, METAL, METAL_DARK, WHITE, BLACK, WARM,
} from './props.js';

const PI = Math.PI, HALF = Math.PI / 2;
const cross = (b, x, y, z, size, color, o) => { b.box(x, y, z, size * 0.3, size, 0.06, color, o); b.box(x, y, z, size, size * 0.3, 0.06, color, o); };

const hospital = {
  mood: 'indoor', accent: '#3fae8a',
  build(b, { accent }) {
    room(b, { floor: '#e3e9e6', wall: '#eef2ee', side: '#e6ece8', trim: '#9fb8ae' });
    b.box(0, 1.3, -9.94, 24, 0.3, 0.06, accent); b.box(-11.94, 1.3, 0, 0.06, 0.3, 20, accent);
    b.box(1.6, 0.056, 3, 0.5, 0.02, 14, accent); b.box(5, 0.056, -3.9, 7.2, 0.02, 0.5, accent);
    // Reception
    counter(b, 0.6, -6.6, { w: 6, d: 1.1, color: WHITE, top: '#cfd9d4', stripe: accent });
    b.box(0.6, 3.9, -9.76, 2, 2, 0.1, WHITE); cross(b, 0.6, 3.9, -9.68, 1.3, '#e0483f', GLOW);
    sign(b, 0.6, 0.75, -6.02, 'RECEPTION', { size: 0.24, color: '#4a6a60' });
    laptop(b, -0.6, 1.36, -6.7, { ry: PI }); b.box(1.9, 1.42, -6.5, 0.6, 0.06, 0.44, '#f4f1e4');
    extra(b, 'hospital-nurse', 0.2, -7.8, 0, 'work', { look: { body: 'woman', outfit: 'office', outfitColor: 'cream', bottomsColor: 'cream', hair: 'bun' } });
    // Ward: beds along the left wall
    [-7, -3.2, 0.6].forEach((z, i) => {
      bed(b, -9.9, z, { ry: HALF, blanket: i % 2 ? '#9fd0c0' : '#7fb0c9' });
      b.cyl(-11, 1.3, z + 1.2, 0.03, 2.6, METAL, { seg: 4 }); b.box(-11, 2.5, z + 1.2, 0.26, 0.4, 0.1, '#cfeaf2', GLASS);
      b.box(-11.2, 0.5, z - 1.2, 0.7, 1, 0.6, WHITE); b.box(-11.2, 1.3, z - 1.2, 0.5, 0.4, 0.3, '#2a2d33'); b.quad(-10.94, 1.3, z - 1.2, 0.24, 0.3, '#7fe0a8', { ry: HALF, ...GLOW });
      if (i < 2) { b.box(-9.6, 1.4, z + 1.9, 4, 2.4, 0.05, '#cfe3dc'); b.box(-9.6, 2.64, z + 1.9, 4, 0.06, 0.06, METAL); }
    });
    extra(b, 'hospital-patient', -9.8, -3.2, HALF, 'sit', { seat: 0.74, look: { outfit: 'casual', outfitColor: 'cream' } });
    extra(b, 'hospital-ward-nurse', -7.6, -6.6, -HALF - 0.3, 'work', { look: { body: 'woman', outfit: 'office', outfitColor: 'teal', bottomsColor: 'teal' } });
    // Pharmacy
    counter(b, 8.6, -7.2, { w: 5, d: 1, color: WHITE, top: '#cfd9d4', stripe: '#2f8f55' });
    shelf(b, 8.6, -9.6, { w: 5, h: 3.4, rows: 4, per: 10, color: WHITE, items: [WHITE, '#9fd0c0', '#e0483f', '#f2c14e', '#7fb0c9'], y: 0.6 });
    b.box(8.6, 4.75, -9.76, 4.4, 0.7, 0.1, '#2f8f55'); sign(b, 8.6, 4.75, -9.7, 'PHARMACY', { size: 0.3, color: WHITE, lit: true });
    cross(b, 11.2, 4.75, -9.6, 0.5, '#7fe0a8', GLOW);
    extra(b, 'hospital-pharmacist', 8.2, -8.4, 0, 'stand', { look: { outfit: 'office', outfitColor: 'cream' } });
    // Consulting corner
    b.box(5.2, 1.4, -1, 0.08, 2.8, 5.6, '#cfe3dc');
    desk(b, 8.6, -1.6, { ry: PI, color: WHITE, seatColor: '#3a6a5c' });
    chair(b, 8.6, 0.2, { ry: PI, color: '#9fb8ae' });
    extra(b, 'hospital-doctor', 8.6, -2.55, 0, 'sit', { look: { body: 'man', outfit: 'office', outfitColor: 'cream', hair: 'lowcut' } });
    b.at(10.6, 0, 1, 0, () => { b.box(0, 0.7, 0, 1, 0.2, 2.6, '#9fd0c0'); for (const sz of [-1.1, 1.1]) b.box(0, 0.3, sz, 0.8, 0.6, 0.08, METAL); b.box(0, 0.86, -1, 0.7, 0.14, 0.5, WHITE); });
    b.box(11.2, 2.8, -1.6, 0.06, 1.4, 1, WHITE); for (let i = 0; i < 4; i++) b.quad(11.16, 3.2 - i * 0.26, -1.6, 0.6 - i * 0.1, 0.12, BLACK, { ry: -HALF });
    // Waiting area
    for (const z of [3, 5.2]) for (let i = 0; i < 4; i++) chair(b, -3.6 + i * 0.9, z, { ry: PI, color: i % 2 ? accent : '#7fb0c9' });
    extra(b, 'hospital-waiting-1', -3.6, 3, PI, 'sit'); extra(b, 'hospital-waiting-2', -1.8, 5.2, PI, 'sit'); extra(b, 'hospital-waiting-3', -0.9, 3, PI, 'sit');
    // Wheelchair, trolley, dispenser, plant
    b.at(4.6, 0, 5.6, -0.6, () => { b.box(0, 0.6, 0, 0.7, 0.1, 0.7, '#2a2d33'); b.box(0, 1, -0.34, 0.7, 0.8, 0.08, '#2a2d33'); for (const side of [-1, 1]) b.cyl(side * 0.42, 0.45, -0.1, 0.45, 0.06, METAL, { seg: 10, rz: HALF }); });
    b.at(-5.4, 0, -6.6, 0.2, () => { b.box(0, 0.9, 0, 0.9, 0.06, 0.6, METAL); b.box(0, 0.4, 0, 0.9, 0.06, 0.6, METAL); for (const sx of [-0.4, 0.4]) for (const sz of [-0.25, 0.25]) b.box(sx, 0.5, sz, 0.04, 1, 0.04, METAL); b.box(0.1, 1, 0, 0.3, 0.14, 0.2, '#e0483f'); });
    b.cyl(-4.6, 0.6, 8.6, 0.3, 1.2, WHITE, { seg: 8 }); b.cyl(-4.6, 1.5, 8.6, 0.26, 0.6, '#bfe3f2', { seg: 8, ...GLASS });
    plant(b, 10.8, 8.8, { s: 1.3, pot: WHITE }); plant(b, -3.6, -9, { s: 1.1, pot: WHITE });
    b.light(0.6, 4.4, -3, '#f2fff8', 20, 14);
    return {
      spots: [
        landmark('reception', /reception|register|card|front|desk|queue|nurse|emergency/, 0.6, -4.8, PI),
        landmark('ward', /ward|bed|admit|rest|treat|drip|recover|sleep/, -6.8, 0.6, -HALF, { act: { pose: 'sit', x: -9.8, z: 0.6, ry: HALF, seat: 0.74 } }),
        landmark('doctor', /doctor|consult|check|test|clinic|see|cure|lab|scan/, 7, 0.4, HALF, { act: { pose: 'sit', x: 8.6, z: 0.2, ry: PI, seat: 0.6 } }),
        landmark('pharmacy', /pharmac|drug|medicine|chemist|pill|buy/, 8.6, -5.4, PI),
        landmark('waiting', /wait|seat|sit|volunteer|work|job|shift/, 1, 4, -HALF, { act: { pose: 'sit', x: -0.9, z: 5.2, ry: PI, seat: 0.6 } }),
        landmark('people', /people|crowd|meet/, 2.6, 7.6, 0),
      ],
      crowd: [[4.6, 8, 0.4], [0.6, 8.4, -0.5], [-2.4, 7.6, 1.2], [3.4, 1.6, 2.4], [-5.4, 1.4, 1.6], [-3.4, -4.4, PI], [3.6, -4.6, PI], [6.4, -5.4, PI], [-6.4, 5.6, 1.2], [7.4, 4.6, -0.8], [-6.6, -1.6, -HALF], [2.6, -1.6, 0.6]],
    };
  },
};

const police = {
  mood: 'indoor', accent: '#3f72c4',
  build(b, { accent }) {
    room(b, { floor: '#b9b2a2', wall: '#e3dcc2', side: '#d9d2b8', trim: '#243a66' });
    b.box(0, 0.9, -9.94, 24, 1.8, 0.06, '#243a66'); b.box(-11.94, 0.9, 0, 0.06, 1.8, 20, '#243a66');
    // Sign and crest
    b.box(2, 4.7, -9.76, 5.4, 0.9, 0.1, '#243a66'); sign(b, 2, 4.7, -9.7, 'POLICE', { size: 0.44, color: WHITE, lit: true });
    b.cyl(2, 3.4, -9.76, 0.6, 0.08, '#d6a83a', { seg: 10, rx: HALF }); b.cyl(2, 3.4, -9.7, 0.36, 0.06, '#243a66', { seg: 8, rx: HALF });
    // Front desk
    counter(b, 2, -5.4, { w: 6.4, d: 1.2, color: '#243a66', top: WOOD_LIGHT, stripe: '#d6a83a' });
    b.box(1, 1.42, -5.4, 0.8, 0.08, 0.6, '#3a2f2a'); b.box(3.4, 1.5, -5.6, 0.5, 0.3, 0.3, '#2a2d33');
    b.ball(4.4, 1.46, -5.2, 0.1, 0.08, 0.1, '#d6a83a', { seg: 6 });
    const officer = { body: 'man', outfit: 'office', outfitColor: 'navy', bottomsColor: 'navy', hair: 'lowcut', fabric: 'plain' };
    extra(b, 'police-desk', 1.6, -6.7, 0, 'work', { look: officer });
    b.cyl(2, 5.3, -5.4, 0.02, 0.9, BLACK, { seg: 4 }); b.cyl(2, 4.8, -5.4, 0.3, 0.3, accent, { seg: 8, top: 0.5, ...GLOW });
    b.light(2, 4.2, -5, '#cfe0ff', 22, 13);
    // Cell in the back-left corner
    const x0 = -11.6, x1 = -5.6, zFront = -4.6;
    for (let x = x0 + 0.4; x < x1; x += 0.46) if (x < -8.2 || x > -6.9) b.cyl(x, 2, zFront, 0.05, 4, '#3a3f46', { seg: 5 });
    for (let z = zFront; z > -9.7; z -= 0.46) b.cyl(x1, 2, z, 0.05, 4, '#3a3f46', { seg: 5 });
    b.box((x0 + x1) / 2, 4, zFront, x1 - x0, 0.12, 0.12, '#3a3f46'); b.box(x1, 4, (zFront - 9.8) / 2, 0.12, 0.12, 9.8 + zFront, '#3a3f46');
    b.box((x0 + x1) / 2, 0.1, zFront, x1 - x0, 0.12, 0.12, '#3a3f46');
    b.at(-8.25, 0, zFront, 0.7, () => { for (let i = 0; i < 4; i++) b.cyl(0.16 + i * 0.4, 2, 0, 0.05, 4, '#3a3f46', { seg: 5 }); b.box(0.7, 2, 0, 1.5, 0.1, 0.1, '#3a3f46'); b.box(0.7, 3.96, 0, 1.5, 0.1, 0.1, '#3a3f46'); b.box(1.36, 2, 0.04, 0.18, 0.3, 0.1, METAL); });
    b.box(-8.6, 0.06, -7.2, 5.6, 0.03, 5, '#8f8a7e');
    bench(b, -9.4, -9.2, { w: 3.6, color: '#6f767e', leg: '#3a3f46' });
    extra(b, 'police-detainee', -9.8, -9.2, 0, 'sit', { look: { outfit: 'chill', body: 'man' } });
    b.cyl(-6.6, 0.3, -9, 0.3, 0.6, METAL, { seg: 7, top: 1.1 });
    // Notice board
    b.box(8.4, 3, -9.74, 4.6, 2.6, 0.1, '#a67c4a'); b.box(8.4, 3, -9.7, 4.2, 2.2, 0.06, '#c9a878');
    sign(b, 8.4, 3.8, -9.66, 'WANTED', { size: 0.24, color: '#a8323a' });
    for (let i = 0; i < 3; i++) { b.quad(6.9 + i * 1.5, 2.8, -9.66, 1.1, 1.3, '#f4f1e4'); b.quad(6.9 + i * 1.5, 3, -9.65, 0.6, 0.6, ['#6e422c', '#845236', '#573323'][i]); b.quad(6.9 + i * 1.5, 2.4, -9.65, 0.8, 0.08, BLACK); b.cyl(6.9 + i * 1.5, 3.42, -9.63, 0.05, 0.04, '#e0483f', { seg: 5, rx: HALF }); }
    // Filing cabinets and statement desk
    for (let i = 0; i < 3; i++) { b.box(-3.6 + i * 1, 1.1, -9.4, 0.94, 2.2, 0.9, i % 2 ? '#6f767e' : '#7d858c'); for (let d = 0; d < 3; d++) b.box(-3.6 + i * 1, 0.5 + d * 0.66, -8.93, 0.4, 0.06, 0.04, '#2a2d33'); }
    desk(b, 8.4, -1.6, { ry: PI, color: WOOD, seatColor: '#243a66' });
    chair(b, 8.4, 0.4, { ry: PI, color: '#6f767e' });
    b.box(9.2, 1.14, -1.6, 0.5, 0.14, 0.4, '#3a3f46');
    extra(b, 'police-detective', 8.4, -2.55, 0, 'sit', { look: officer });
    b.box(10.9, 1.2, 3.4, 1, 2.4, 2.2, '#55657a'); for (let i = 0; i < 2; i++) b.box(10.38, 1.3, 2.9 + i * 1, 0.04, 0.3, 0.08, METAL);
    // Waiting bench, height chart, flag
    bench(b, -11, 3.6, { w: 4.4, ry: HALF, back: true });
    extra(b, 'police-waiting', -10.9, 4.4, HALF, 'sit');
    b.box(-11.9, 2.4, -1.6, 0.06, 3.2, 2.4, '#f4f1e4'); for (let i = 0; i < 6; i++) b.quad(-11.86, 1.2 + i * 0.5, -1.6, 2.2, 0.05, BLACK, { ry: HALF });
    flag(b, -4.4, -8, { h: 4.6, w: 1.5 });
    b.cyl(-3.4, 0.6, 8.8, 0.3, 1.2, WHITE, { seg: 8 }); b.cyl(-3.4, 1.5, 8.8, 0.26, 0.6, '#bfe3f2', { seg: 8, ...GLASS });
    rug(b, 2, 7.6, 4.4, 2, '#243a66', { border: '#d6a83a' });
    extra(b, 'police-patrol', 5.6, 4.6, -2.4, 'stand', { look: officer });
    return {
      spots: [
        landmark('desk', /desk|counter|report|complain|front|bail|pay|officer|bribe|settle|fine/, 2, -3.6, PI),
        landmark('cell', /cell|jail|lock|detain|arrest|bars|time|serve/, -7.2, -3.2, PI - 0.3, { act: { pose: 'sit', x: -8.4, z: -9.2, ry: 0, seat: 0.6 } }),
        landmark('board', /board|notice|wanted|poster|tip/, 8.4, -7.6, PI),
        landmark('office', /statement|office|interrogat|question|detective|invest|work|job|shift|patrol/, 6.6, 0.6, HALF, { act: { pose: 'sit', x: 8.4, z: 0.4, ry: PI, seat: 0.6 } }),
        landmark('bench', /bench|wait|sit|lawyer/, -8.8, 2.4, -HALF, { act: { pose: 'sit', x: -10.9, z: 2.4, ry: HALF, seat: 0.6 } }),
        landmark('people', /people|crowd|meet/, 0.6, 4.6, 0),
      ],
      crowd: [[2.6, 6, 0.4], [-1.6, 5.6, -0.5], [-2.4, 1.6, 1.2], [3.4, 1.4, 2.4], [-3.6, -2.4, 2.6], [5.6, -3.4, PI], [-6.4, 6.6, 1.2], [0.4, 8.4, 0.2], [6.4, 7.4, -0.6], [-5.6, 0.2, 1.8], [9.6, 6.6, -1.2], [-0.4, -2.2, PI]],
    };
  },
};

function church(b, accent) {
  room(b, { floor: '#b9966a', wall: '#ece3cf', side: '#e3dac4', trim: '#8a6644', h: 6.4 });
  b.box(0, 0.06, 2.4, 2.2, 0.03, 15, '#a8323a');
  // Chancel, altar and cross
  b.box(0, 0.25, -7.6, 16, 0.5, 4.6, '#a67c4a'); b.box(0, 0.52, -7.6, 2.2, 0.03, 4.6, '#a8323a');
  b.box(0, 0.14, -5.1, 16, 0.26, 0.5, '#96704a');
  b.cyl(0, 4.3, -9.74, 1.7, 0.06, '#ffe6a8', { seg: 16, rx: HALF, ...GLOW });
  b.box(0, 3.9, -9.66, 0.4, 3.2, 0.14, WOOD_DARK); b.box(0, 4.5, -9.66, 2, 0.4, 0.14, WOOD_DARK);
  b.box(0, 1.1, -8.4, 3.4, 1.2, 1.1, WOOD); b.box(0, 1.74, -8.4, 3.8, 0.08, 1.3, WHITE); b.box(0, 1.2, -7.82, 1.2, 1, 0.03, accent);
  for (const dx of [-1.3, 1.3]) { b.cyl(dx, 2.05, -8.4, 0.05, 0.56, '#d6a83a', { seg: 5 }); b.cone(dx, 2.42, -8.4, 0.05, 0.18, '#ffcf6a', { seg: 4, ...GLOW }); }
  b.box(0, 1.84, -8.4, 0.5, 0.12, 0.4, '#d6a83a');
  b.light(0, 3.6, -6.6, '#ffe6b0', 24, 12);
  // Pulpit and pastor
  b.box(-4.6, 1.1, -6.2, 1.2, 1.3, 0.8, WOOD_DARK); b.box(-4.6, 1.8, -6.2, 1.4, 0.08, 1, WOOD, { rx: 0.2 });
  extra(b, 'church-pastor', -4.6, -7, 0, 'wave', { y: 0.5, look: { body: 'man', outfit: 'office', outfitColor: 'cream', bottomsColor: 'navy' } });
  // Choir and instruments
  for (let i = 0; i < 2; i++) bench(b, 5.6, -8.6 + i * 1.3, { w: 4, color: WOOD_DARK });
  for (let i = 0; i < 3; i++) extra(b, `church-choir-${i}`, 4.4 + i * 1.2, -7.9, -0.2, i === 1 ? 'wave' : 'stand', { y: 0.5, look: { body: i % 2 ? 'man' : 'woman', outfit: 'owambe', outfitColor: 'violet', bottomsColor: 'violet', fabric: 'plain' } });
  b.at(7.6, 0.5, -5.9, -0.5, () => { b.box(0, 0.9, 0, 1.8, 0.14, 0.5, '#1c1614'); b.box(0, 0.98, 0.06, 1.6, 0.03, 0.34, WHITE); for (const sx of [-0.7, 0.7]) b.box(sx, 0.42, 0, 0.06, 0.84, 0.4, METAL_DARK); });
  // Pews
  [-2.6, -0.6, 1.4, 3.4, 5.4, 7.4].forEach((z) => { for (const x of [-4.4, 4.4]) bench(b, x, z, { w: 5.6, ry: PI, back: true, color: '#8a6644', leg: '#5f4630' }); });
  extra(b, 'church-member-1', -5.6, -2.6, PI, 'sit'); extra(b, 'church-member-2', -3, -0.6, PI, 'sit'); extra(b, 'church-member-3', 3.6, -2.6, PI, 'sit');
  extra(b, 'church-member-4', 5.8, 1.4, PI, 'sit', { look: { body: 'woman', outfit: 'owambe', hair: 'gele', fabric: 'asooke' } }); extra(b, 'church-member-5', -4.4, 3.4, PI, 'sit');
  // Stained glass on the left wall
  for (let i = 0; i < 4; i++) {
    const z = -6.6 + i * 4.6;
    b.box(-11.92, 3.4, z, 0.1, 3.8, 1.8, '#8a6644'); b.cyl(-11.92, 5.3, z, 0.9, 0.1, '#8a6644', { seg: 10, rz: HALF });
    ['#e0483f', '#f2c14e', '#3f72c4', '#3fae6a'].forEach((color, k) => b.quad(-11.84, 2 + k * 0.9, z, 1.5, 0.84, (i + k) % 5 === 0 ? '#8055c2' : color, { ry: HALF, ...GLOW }));
    b.cyl(-11.86, 5.3, z, 0.74, 0.02, '#ffe6a8', { seg: 10, rz: HALF, ...GLOW });
  }
  // Offering box, font, flowers
  b.box(-1.9, 0.6, 8.6, 0.8, 1.2, 0.8, WOOD_DARK); b.box(-1.9, 1.22, 8.6, 0.4, 0.03, 0.08, BLACK); b.quad(-1.9, 0.7, 9.01, 0.4, 0.4, '#d6a83a');
  b.cyl(2.2, 0.5, 8.6, 0.2, 1, '#cfc8b8', { seg: 7 }); b.cyl(2.2, 1.06, 8.6, 0.5, 0.2, '#cfc8b8', { seg: 9, top: 1.3 }); b.cyl(2.2, 1.17, 8.6, 0.56, 0.02, '#9fd0e6', { seg: 9 });
  for (const dx of [-2.6, 2.6]) plant(b, dx, -6, { s: 0.9, pot: WHITE, leaf: '#3f8a57' });
  return {
    spots: [
      landmark('pews', /pew|seat|service|pray|worship|sermon|mass|sit|listen/, 0, 3.4, PI, { act: { pose: 'sit', x: 2.4, z: 3.4, ry: PI, seat: 0.6 } }),
      landmark('altar', /altar|pastor|priest|bless|confess|counsel|thanksgiv|testimon|pulpit|deliver/, 0, -6.2, PI, { y: 0.53, approach: [0, -4.5] }),
      landmark('choir', /choir|sing|music|praise|band|instrument|rehears/, 5.6, -6.4, 0, { y: 0.5, act: { pose: 'wave' }, approach: [5.6, -4.5] }),
      landmark('offering', /offer|tithe|give|donat|charity|volunteer|work|job|seed/, -0.6, 8.6, -HALF, { act: { pose: 'work' } }),
      landmark('people', /people|crowd|meet/, 8.8, 4.4, -HALF),
    ],
    // The chancel is one step up, taken at its front edge.
    raised: [{ rect: [-8, -9.9, 8, -5.35], y: 0.5, lip: 0.5 }],
    crowd: [[9, 2.4, -HALF], [9.4, 6.4, -HALF], [-9, 4.6, HALF], [-9.2, 0.6, HALF], [0.6, 9.4, PI], [4.4, 9.4, PI], [-4.6, 9.4, PI], [8.8, -1.6, -2], [-8.8, -2.4, 2], [0, 6.2, PI], [8.6, 8.6, -2.4], [-8.8, 8.4, 2.4]],
  };
}

function arch(b, x, y, z, w, h, color, o = {}) {
  b.box(x, y + (h - w / 2) / 2, z, w, h - w / 2, 0.08, color, o);
  b.cyl(x, y + h - w / 2, z, w / 2, 0.08, color, { seg: 12, rx: HALF, ...o });
}

function mosque(b, accent) {
  room(b, { floor: '#2f8580', wall: '#efe6cf', side: '#e6dcc4', trim: '#c9a14a', h: 6.4 });
  // Carpet rows
  for (let i = 0; i < 9; i++) b.box(0, 0.056, -6 + i * 1.8, 22, 0.02, 0.16, '#d6b45a');
  for (let i = 0; i < 9; i++) for (let k = 0; k < 9; k++) if ((i + k) % 2) b.disc(-9.6 + k * 2.4, 0.057, -6.9 + i * 1.8, 0.34, '#3f9a94', { seg: 6 });
  b.box(0, 3.3, -9.94, 24, 0.24, 0.06, accent); b.box(-11.94, 3.3, 0, 0.06, 0.24, 20, accent);
  // Mihrab
  arch(b, 0, 0, -9.82, 3.8, 5.2, '#c9a14a'); arch(b, 0, 0, -9.76, 3.2, 4.8, '#1f5f5a');
  arch(b, 0, 0, -9.7, 2.2, 3.9, '#2f8580'); b.cyl(0, 3.3, -9.64, 0.3, 0.06, '#ffe6a8', { seg: 8, rx: HALF, ...GLOW });
  b.cyl(0, 5.75, -9.76, 0.44, 0.06, '#d6a83a', { seg: 10, rx: HALF }); b.cyl(0.16, 5.8, -9.72, 0.36, 0.08, '#efe6cf', { seg: 10, rx: HALF });
  rug(b, 0, -7.6, 2.4, 3, '#a8323a', { border: '#d6b45a' });
  extra(b, 'mosque-imam', 0, -7.4, PI, 'stand', { look: { body: 'man', outfit: 'chill', outfitColor: 'cream', bottomsColor: 'cream', hair: 'lowcut', fabric: 'plain' } });
  // Minbar
  b.at(4.2, 0, -8.6, 0, () => {
    for (let i = 0; i < 5; i++) b.box(0, 0.2 + i * 0.2, 1.6 - i * 0.6, 1.3, 0.4 + i * 0.4, 0.62, i % 2 ? '#8a6644' : '#96704a');
    for (const side of [-1, 1]) b.box(side * 0.62, 1.7, 0.4, 0.06, 0.08, 3.2, '#c9a14a', { rx: 0.32 });
    for (const sx of [-0.56, 0.56]) for (const sz of [-1.1, -0.5]) b.box(sx, 3, sz, 0.1, 2, 0.1, '#8a6644');
    b.box(0, 4, -0.8, 1.4, 0.14, 0.9, '#8a6644'); b.cone(0, 4.5, -0.8, 0.7, 0.9, '#2f8580', { seg: 8 }); b.ball(0, 5.05, -0.8, 0.1, 0.1, 0.1, '#d6a83a', { seg: 5 });
  });
  // Columns with an arch beam along the back
  for (const x of [-8.4, -3.2, 8.4]) column(b, x, -5.4, { h: 5.4, r: 0.32, color: '#f5efdc' });
  b.box(0, 5.6, -5.4, 18, 0.4, 0.7, '#efe6cf'); b.box(0, 5.36, -5.04, 18, 0.1, 0.04, '#c9a14a');
  // Chandelier
  b.cyl(0, 5.9, 0.6, 0.02, 1.4, '#c9a14a', { seg: 4 }); b.cyl(0, 5, 0.6, 1.4, 0.12, '#c9a14a', { seg: 12, open: true });
  for (let i = 0; i < 8; i++) b.ball(Math.sin(i * PI / 4) * 1.4, 4.86, 0.6 + Math.cos(i * PI / 4) * 1.4, 0.13, 0.16, 0.13, WARM, { seg: 5, ...GLOW });
  b.light(0, 4.4, 0.6, '#ffe6b0', 30, 16);
  // Arched lattice windows
  for (let i = 0; i < 4; i++) {
    const z = -6.6 + i * 4.6;
    b.at(-11.9, 0, z, HALF, () => { arch(b, 0, 1.4, 0, 1.9, 3.6, '#c9a14a'); arch(b, 0, 1.56, 0.04, 1.5, 3.2, '#cfeee6', GLOW); for (let k = 0; k < 3; k++) b.box(-0.5 + k * 0.5, 2.9, 0.1, 0.05, 2.9, 0.03, '#c9a14a'); for (let k = 0; k < 4; k++) b.box(0, 1.9 + k * 0.6, 0.1, 1.5, 0.05, 0.03, '#c9a14a'); });
  }
  // Worshippers in rows
  const worshipper = (seed, x, z, pose, seat) => extra(b, seed, x, z, PI, pose, { seat, look: { body: 'man', outfit: 'chill', fabric: 'plain', bottomsColor: 'cream' } });
  [[-3.6, -2.5], [-1.2, -2.5], [1.2, -2.5], [3.6, -2.5]].forEach(([x, z], i) => worshipper(`mosque-row-${i}`, x, z, 'stand'));
  [[-4.8, 1.1], [2.4, 1.1], [0, 2.9]].forEach(([x, z], i) => worshipper(`mosque-sit-${i}`, x, z, 'sit', 0.04));
  // Ablution taps
  b.box(-9.6, 0.5, 7.4, 4.4, 1, 0.5, '#d9d2c0'); b.box(-9.6, 0.1, 6.7, 4.4, 0.2, 0.9, '#9fb8b4');
  for (let i = 0; i < 3; i++) { b.box(-11 + i * 1.4, 0.9, 7.1, 0.08, 0.08, 0.3, METAL); b.box(-11 + i * 1.4, 0.82, 6.98, 0.06, 0.16, 0.06, METAL); stool(b, -11 + i * 1.4, 6, { h: 0.4, color: '#d9d2c0' }); }
  extra(b, 'mosque-wudu', -9.6, 6, 0, 'sit', { seat: 0.4, look: { body: 'man', outfit: 'chill' } });
  // Shoe rack, donation box, book stands
  shelf(b, 9.6, 9.2, { ry: PI, w: 3.6, h: 1.8, rows: 3, per: 7, color: WOOD, items: ['#2a2d33', '#8a5a36', '#e9e4d8', '#3a3f46'] });
  b.box(6.6, 0.6, 8.6, 0.8, 1.2, 0.8, '#1f5f5a'); b.box(6.6, 1.22, 8.6, 0.4, 0.03, 0.08, BLACK); b.quad(6.6, 0.7, 8.19, 0.4, 0.4, '#d6a83a', { ry: PI });
  for (const [x, z] of [[-7.6, 1], [7.6, -1.6]]) { b.box(x, 0.3, z, 0.7, 0.05, 0.4, WOOD, { rz: 0.5 }); b.box(x, 0.3, z, 0.7, 0.05, 0.4, WOOD, { rz: -0.5 }); b.box(x, 0.52, z, 0.5, 0.08, 0.36, '#2f8f55'); }
  return {
    spots: [
      landmark('prayer', /prayer|pray|hall|salah|salat|jum|row|worship|listen|sermon|khutb/, 0, -0.7, PI),
      landmark('mihrab', /mihrab|imam|minbar|bless|counsel|learn|quran|study|class|lecture/, -2.2, -6.8, PI - 0.4),
      landmark('ablution', /ablution|wudu|wash|water|clean/, -7, 5, 0.6, { act: { pose: 'sit', x: -8.2, z: 6, ry: 0, seat: 0.4 } }),
      landmark('charity', /zakat|sadaq|charity|give|donat|offer|volunteer|work|job/, 6.6, 6.8, 0, { act: { pose: 'work' } }),
      landmark('people', /people|crowd|meet/, 6, 3.4, -HALF),
    ],
    crowd: [[7.6, 1.6, -HALF], [8.4, 5, -HALF], [-7.4, 2.6, HALF], [-3.6, 4.7, PI], [-1.2, 4.7, PI], [1.2, 4.7, PI], [3.6, 4.7, PI], [-2.4, 6.5, PI], [2.4, 6.5, PI], [0, 8.3, PI], [9, -2.4, -2], [-8.6, -1.6, 2]],
  };
}

const worship = {
  mood: 'indoor', accent: '#c9a14a',
  build(b, { variant, accent }) { return variant === 'mosque' ? mosque(b, accent) : church(b, accent); },
};

export const SCENES = { hospital, police, worship };
